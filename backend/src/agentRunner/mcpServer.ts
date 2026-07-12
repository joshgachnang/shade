import fs from "node:fs/promises";
import path from "node:path";
import {createSdkMcpServer, tool} from "@anthropic-ai/claude-agent-sdk";
import {logger} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import {z} from "zod";
import {AgentTask} from "../models/agentTask";
import {AppConfig, loadAppConfig} from "../models/appConfig";
import {Channel} from "../models/channel";
import {Group} from "../models/group";
import {Message} from "../models/message";
import {RadioStream} from "../models/radioStream";
import {ScheduledTask} from "../models/scheduledTask";
import {writeIpcFile} from "../orchestrator/ipcWriter";
import {
  applyMemoryUpdate,
  canWriteGlobalMemory,
  getGlobalMemoryPath,
  getGroupMemoryPath,
  getUserProfilePath,
} from "../orchestrator/memory";
import {RichResponse} from "../orchestrator/responses/schema";
import {listSkills, loadSkill, saveSkill} from "../orchestrator/skills";
import {
  addShadeContext,
  createContact,
  getContactById,
  matchContactByEmail,
  matchContactByPhone,
  searchContacts,
  updateContact,
} from "../utils/appleContacts";
import {isHandleAllowed} from "../utils/smsAllowlist";
import {buildAppleTools} from "./appleTools";

export interface McpContext {
  groupId: string;
  channelId: string;
  ipcDir: string;
  groupFolder: string;
  /** Slack ts of the triggering message; used both for reactions and as thread_ts on rich-response replies. */
  messageTs?: string;
  senderExternalId?: string;
  /** Stable per-agent-run identifier; lets the IPC consumer dedupe send_message + rich_response in the same run. */
  agentRunId?: string;
  /** Slack thread_ts to use when replying. Falls back to messageTs when omitted by the runner. */
  threadTs?: string;
  /**
   * True when this run executes an AgentTask from the task board (set by
   * TaskWorkerService via AgentRunConfig.isBoardTask). Used by delegate_task
   * to enforce the one-level delegation rule.
   */
  isBoardTask?: boolean;
}

const MEMORY_DISABLED_TEXT = "Memory features are disabled";
const TASK_BOARD_DISABLED_TEXT = "The task board is disabled";

const AGENT_TASK_STATUSES = [
  "pending",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

// Exported for tests; production code should use createShadeMcpServer.
export const buildTools = (ctx: McpContext) => {
  const sendMessageTool = tool(
    "send_message",
    "Send a message to a channel. Use this to respond to users or communicate with other groups.",
    {
      content: z.string().describe("The message content to send"),
      targetGroupId: z
        .string()
        .optional()
        .describe("Target group ID. Omit to send to the current group."),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "send_message",
        groupId: ctx.groupId,
        channelId: ctx.channelId,
        content: args.content,
        targetGroupId: args.targetGroupId,
        agentRunId: ctx.agentRunId,
      });
      return {
        content: [{type: "text" as const, text: `Message queued (${fileId})`}],
      };
    }
  );

  const respondWithCardTool = tool(
    "respond_with_card",
    "Reply to the user with a structured RichResponse card payload (text, yes/no buttons, weather, code, map, list, error, image, or table). " +
      "Use this when structure materially helps comprehension. Always include fallbackText for non-rich channels. " +
      "Do NOT call this in addition to send_message in the same response — choose one.",
    RichResponse.shape,
    async (args) => {
      // Defensive parse — the SDK already validates against shape, but discriminated
      // union refinements (e.g. table row consistency) need the full parser.
      const parsed = RichResponse.safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `respond_with_card validation failed: ${parsed.error.message}`,
            },
          ],
          isError: true,
        };
      }
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "rich_response",
        groupId: ctx.groupId,
        channelId: ctx.channelId,
        agentRunId: ctx.agentRunId,
        threadTs: ctx.threadTs ?? ctx.messageTs,
        payload: parsed.data,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Rich response queued (${fileId}, ${parsed.data.cards.length} card(s))`,
          },
        ],
      };
    }
  );

  const addReactionTool = tool(
    "add_reaction",
    "Add an emoji reaction to a message. If no messageTs is provided, reacts to the message that triggered this agent run.",
    {
      emoji: z
        .string()
        .describe("Emoji name without colons (e.g., 'eyes', 'thumbsup', 'white_check_mark')"),
      messageTs: z
        .string()
        .optional()
        .describe("Message timestamp to react to. Omit to react to the triggering message."),
    },
    async (args) => {
      const ts = args.messageTs ?? ctx.messageTs;
      if (!ts) {
        return {
          content: [
            {type: "text" as const, text: "Error: No message timestamp available to react to."},
          ],
        };
      }
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "add_reaction",
        groupId: ctx.groupId,
        channelId: ctx.channelId,
        messageTs: ts,
        emoji: args.emoji,
      });
      return {
        content: [{type: "text" as const, text: `Reaction queued (${fileId})`}],
      };
    }
  );

  const scheduleTaskTool = tool(
    "schedule_task",
    "Schedule a new recurring or one-time task for this group.",
    {
      name: z.string().describe("Task name"),
      prompt: z.string().describe("The prompt/instruction for the task"),
      scheduleType: z.enum(["cron", "interval", "once"]).describe("Schedule type"),
      schedule: z.string().describe("Cron expression, interval in ms, or ISO date for once"),
      classification: z
        .enum(["public", "internal", "sensitive", "critical"])
        .default("internal")
        .describe("Security classification"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "create_task",
        groupId: ctx.groupId,
        data: {
          name: args.name,
          prompt: args.prompt,
          scheduleType: args.scheduleType,
          schedule: args.schedule,
          classification: args.classification,
          status: "active",
        },
      });
      return {
        content: [{type: "text" as const, text: `Task scheduled (${fileId})`}],
      };
    }
  );

  const listTasksTool = tool(
    "list_tasks",
    "List scheduled tasks for the current group. Returns task details including name, schedule, status, and last/next run times.",
    {
      status: z
        .enum(["active", "paused", "completed", "cancelled"])
        .optional()
        .describe("Filter by status"),
    },
    async (args) => {
      const filter: Record<string, string> = {groupId: ctx.groupId};
      if (args.status) {
        filter.status = args.status;
      }

      const tasks = await ScheduledTask.find(filter).sort({created: -1}).limit(50).lean();

      if (tasks.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: args.status
                ? `No ${args.status} tasks found for this group.`
                : "No scheduled tasks found for this group.",
            },
          ],
        };
      }

      const taskList = tasks.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        scheduleType: t.scheduleType,
        schedule: t.schedule,
        status: t.status,
        classification: t.classification,
        nextRunAt: t.nextRunAt?.toISOString() ?? null,
        lastRunAt: t.lastRunAt?.toISOString() ?? null,
        runCount: t.runCount,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(taskList, null, 2),
          },
        ],
      };
    }
  );

  const pauseTaskTool = tool(
    "pause_task",
    "Pause an active scheduled task.",
    {
      taskId: z.string().describe("The task ID to pause"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "pause_task",
        groupId: ctx.groupId,
        taskId: args.taskId,
      });
      return {
        content: [{type: "text" as const, text: `Task pause queued (${fileId})`}],
      };
    }
  );

  const resumeTaskTool = tool(
    "resume_task",
    "Resume a paused scheduled task.",
    {
      taskId: z.string().describe("The task ID to resume"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "resume_task",
        groupId: ctx.groupId,
        taskId: args.taskId,
      });
      return {
        content: [{type: "text" as const, text: `Task resume queued (${fileId})`}],
      };
    }
  );

  const cancelTaskTool = tool(
    "cancel_task",
    "Cancel a scheduled task.",
    {
      taskId: z.string().describe("The task ID to cancel"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "cancel_task",
        groupId: ctx.groupId,
        taskId: args.taskId,
      });
      return {
        content: [{type: "text" as const, text: `Task cancel queued (${fileId})`}],
      };
    }
  );

  // --- Agent task board tools (background delegation, IP-009) ---

  const delegateTaskTool = tool(
    "delegate_task",
    "Delegate an independent subtask to a background agent via the task board. The task runs asynchronously with its own agent session — use this for work that takes more than a minute or that the user wants done in the background. Returns the task id: poll get_task_result to retrieve the output, or set deliverResult to have the result posted to this group's channel on completion.",
    {
      title: z.string().describe("Short human-readable task title"),
      prompt: z
        .string()
        .describe(
          "Complete, self-contained instructions for the background agent (it cannot see this conversation)"
        ),
      priority: z
        .number()
        .optional()
        .describe("Higher-priority tasks are claimed first (default 0)"),
      deliverResult: z
        .boolean()
        .optional()
        .describe(
          "Post the result to this group's channel when the task completes (default false)"
        ),
    },
    async (args) => {
      try {
        const taskWorker = (await loadAppConfig()).taskWorker;
        if (taskWorker?.enabled === false) {
          return {content: [{type: "text" as const, text: TASK_BOARD_DISABLED_TEXT}]};
        }
        if (ctx.isBoardTask) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: this run is itself a delegated board task, and board tasks cannot delegate further (delegation is limited to one level to prevent runaway fan-out). Do the work directly in this run instead.",
              },
            ],
          };
        }

        const task = await AgentTask.create({
          groupId: ctx.groupId,
          title: args.title,
          prompt: args.prompt,
          priority: args.priority ?? 0,
          deliverResult: args.deliverResult ?? false,
        });
        logger.info(
          `delegate_task: created board task "${args.title}" (${task._id}) for group ${ctx.groupId}`
        );

        const deliveryNote = args.deliverResult
          ? "The result will also be posted to this group's channel when it finishes."
          : "Poll get_task_result with this id to check status and retrieve the output (or delegate with deliverResult=true to have results messaged to the group).";
        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${task._id} ("${args.title}") created — running in background. ${deliveryNote}`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error delegating task: ${msg}`}]};
      }
    }
  );

  const getTaskResultTool = tool(
    "get_task_result",
    "Get the current status of a delegated background task by id. Completed tasks include their result; failed tasks include the error and attempt count.",
    {
      taskId: z.string().describe("The AgentTask id returned by delegate_task"),
    },
    async (args) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(args.taskId)) {
          return {content: [{type: "text" as const, text: `Task "${args.taskId}" not found.`}]};
        }
        const task = await AgentTask.findOneOrNone({_id: args.taskId, groupId: ctx.groupId});
        if (!task) {
          return {content: [{type: "text" as const, text: `Task "${args.taskId}" not found.`}]};
        }

        const lines = [`Task ${task._id} ("${task.title}") status: ${task.status}`];
        if (task.status === "completed") {
          lines.push(`Result:\n${task.result ?? "(no result recorded)"}`);
        } else if (task.status === "failed") {
          lines.push(
            `Error: ${task.error ?? "unknown"} (failed after ${task.attempts}/${task.maxAttempts} attempts)`
          );
        } else if (task.status === "cancelled") {
          lines.push("The task was cancelled.");
        } else {
          lines.push("Still in progress — check again later.");
        }
        return {content: [{type: "text" as const, text: lines.join("\n")}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error getting task result: ${msg}`}]};
      }
    }
  );

  const listAgentTasksTool = tool(
    "list_agent_tasks",
    "List this group's delegated background tasks (task board), newest first. Optionally filter by status.",
    {
      status: z
        .string()
        .optional()
        .describe("Filter by status: pending, claimed, running, completed, failed, or cancelled"),
      limit: z.number().min(1).max(50).default(10).describe("Maximum tasks to return (default 10)"),
    },
    async (args) => {
      try {
        if (args.status && !(AGENT_TASK_STATUSES as readonly string[]).includes(args.status)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid status "${args.status}". Valid statuses: ${AGENT_TASK_STATUSES.join(", ")}.`,
              },
            ],
          };
        }

        const filter: Record<string, string> = {groupId: ctx.groupId};
        if (args.status) {
          filter.status = args.status;
        }
        const tasks = await AgentTask.find(filter)
          .sort({created: -1})
          .limit(args.limit ?? 10);

        if (tasks.length === 0) {
          return {content: [{type: "text" as const, text: "No tasks."}]};
        }

        const lines = tasks.map((t) => {
          const age = DateTime.fromJSDate(t.created).toRelative() ?? "unknown age";
          return `${t._id} | ${t.title} | ${t.status} | ${age}`;
        });
        return {content: [{type: "text" as const, text: lines.join("\n")}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error listing tasks: ${msg}`}]};
      }
    }
  );

  const cancelAgentTaskTool = tool(
    "cancel_agent_task",
    "Cancel a delegated background task. Pending tasks are cancelled immediately; claimed/running tasks are flagged for cancellation and the worker aborts them at its next heartbeat.",
    {
      taskId: z.string().describe("The AgentTask id to cancel"),
    },
    async (args) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(args.taskId)) {
          return {content: [{type: "text" as const, text: `Task "${args.taskId}" not found.`}]};
        }

        // Atomic transitions so a status change between read and write can't
        // cancel a task that already started (or restart-cancel a finished one).
        const cancelledPending = await AgentTask.findOneAndUpdate(
          {_id: args.taskId, groupId: ctx.groupId, status: "pending"},
          {$set: {status: "cancelled", error: "Cancelled by request", completedAt: new Date()}},
          {new: true}
        );
        if (cancelledPending) {
          logger.info(`cancel_agent_task: cancelled pending board task ${args.taskId}`);
          return {
            content: [
              {
                type: "text" as const,
                text: `Task ${args.taskId} ("${cancelledPending.title}") cancelled — it had not started yet.`,
              },
            ],
          };
        }

        const flagged = await AgentTask.findOneAndUpdate(
          {_id: args.taskId, groupId: ctx.groupId, status: {$in: ["claimed", "running"]}},
          {$set: {cancelRequested: true}},
          {new: true}
        );
        if (flagged) {
          logger.info(`cancel_agent_task: requested cancellation of board task ${args.taskId}`);
          return {
            content: [
              {
                type: "text" as const,
                text: `Cancellation requested for task ${args.taskId} ("${flagged.title}") — it is currently ${flagged.status}; the worker will abort it at its next heartbeat.`,
              },
            ],
          };
        }

        const task = await AgentTask.findOneOrNone({_id: args.taskId, groupId: ctx.groupId});
        if (!task) {
          return {content: [{type: "text" as const, text: `Task "${args.taskId}" not found.`}]};
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${args.taskId} ("${task.title}") is already ${task.status} — nothing to cancel.`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error cancelling task: ${msg}`}]};
      }
    }
  );

  const getWeatherTool = tool(
    "get_weather",
    "Get current weather information for a location using wttr.in free API. Returns temperature, conditions, humidity, wind, and more.",
    {
      location: z
        .string()
        .describe(
          "City name, airport code, or 'here' for IP-based location (e.g., 'London', 'SFO', 'New York')"
        ),
      format: z
        .enum(["short", "detailed"])
        .default("detailed")
        .describe("Response format: 'short' for one-line summary, 'detailed' for full info"),
    },
    async (args) => {
      try {
        // Use wttr.in free weather API
        const location = encodeURIComponent(args.location);
        const url =
          args.format === "short"
            ? `https://wttr.in/${location}?format=%l:+%C+%t+%w+%h`
            : `https://wttr.in/${location}?format=j1`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Weather API returned ${response.status}`);
        }

        const data = await response.text();

        if (args.format === "short") {
          return {
            content: [{type: "text" as const, text: data}],
          };
        }

        // Parse JSON response for detailed format
        const weatherData = JSON.parse(data);
        const current = weatherData.current_condition[0];
        const area = weatherData.nearest_area[0];

        const formatted = [
          `📍 Location: ${area.areaName[0].value}, ${area.country[0].value}`,
          `🌡️  Temperature: ${current.temp_C}°C (${current.temp_F}°F)`,
          `🌤️  Conditions: ${current.weatherDesc[0].value}`,
          `💨 Wind: ${current.windspeedKmph} km/h ${current.winddir16Point}`,
          `💧 Humidity: ${current.humidity}%`,
          `👁️  Visibility: ${current.visibility} km`,
          `🌡️  Feels Like: ${current.FeelsLikeC}°C (${current.FeelsLikeF}°F)`,
          `☔ Precipitation: ${current.precipMM} mm`,
        ].join("\n");

        return {
          content: [{type: "text" as const, text: formatted}],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error fetching weather";
        return {
          content: [{type: "text" as const, text: `Error: ${errorMsg}`}],
        };
      }
    }
  );

  const getChannelHistoryTool = tool(
    "get_channel_history",
    "Fetch older messages from the current channel for additional context. Returns messages in chronological order.",
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of messages to fetch (default 20, max 100)"),
      before: z
        .string()
        .optional()
        .describe(
          "Fetch messages before this ISO date string. Omit to get the most recent messages."
        ),
    },
    async (args) => {
      const query: Record<string, unknown> = {groupId: ctx.groupId};
      if (args.before) {
        query.created = {$lt: new Date(args.before)};
      }

      const messages = await Message.find(query).sort({created: -1}).limit(args.limit);

      // Reverse to chronological order
      messages.reverse();

      if (messages.length === 0) {
        return {
          content: [{type: "text" as const, text: "No messages found."}],
        };
      }

      const formatted = messages
        .map((msg) => {
          const role = msg.isFromBot ? "assistant" : "user";
          const sender = msg.isFromBot ? "Shade" : msg.sender;
          const time = new Date(msg.created).toISOString();
          return `[${time}] ${role} (${sender}): ${msg.content}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Channel history (${messages.length} messages):\n${formatted}`,
          },
        ],
      };
    }
  );

  const searchHistoryTool = tool(
    "search_history",
    "Full-text search over this group's stored message history, reaching far beyond the recent context window (defaults to the last 90 days). Use this to recall older conversations before saying you don't know or don't remember something.",
    {
      query: z.string().describe("Full-text search query (keywords, not a regex)"),
      days: z.number().min(1).default(90).describe("How many days back to search (default 90)"),
      limit: z
        .number()
        .min(1)
        .optional()
        .describe("Maximum number of results (capped by server config)"),
    },
    async (args) => {
      try {
        const memory = (await loadAppConfig()).memory;
        if (!(memory?.enabled ?? true)) {
          return {content: [{type: "text" as const, text: MEMORY_DISABLED_TEXT}]};
        }

        const configLimit = memory?.historySearchLimit ?? 8;
        const limit = Math.min(args.limit ?? configLimit, configLimit);
        const cutoff = DateTime.now()
          .minus({days: args.days ?? 90})
          .toJSDate();

        const messages = await Message.find(
          {
            $text: {$search: args.query},
            groupId: ctx.groupId,
            created: {$gte: cutoff},
          },
          {score: {$meta: "textScore"}}
        )
          .sort({score: {$meta: "textScore"}})
          .limit(limit);

        if (messages.length === 0) {
          return {content: [{type: "text" as const, text: "No matches."}]};
        }

        const lines = messages.map((msg) => {
          const sender = msg.isFromBot ? "Shade" : msg.sender;
          const time = DateTime.fromJSDate(msg.created).toISO();
          return `[${time}] ${sender}: ${msg.content.slice(0, 300)}`;
        });

        return {content: [{type: "text" as const, text: lines.join("\n")}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error searching history: ${msg}`}]};
      }
    }
  );

  const updateMemoryTool = tool(
    "update_memory",
    "Update Shade's persistent memory files. Scopes: 'global' (shared across all groups; main group only), 'group' (this group's memory file), 'user' (the user profile USER.md; main group only). Mode 'append' adds to the existing file; 'replace' overwrites it. Content persists across sessions and is loaded into future system prompts.",
    {
      scope: z
        .enum(["global", "group", "user"])
        .describe("Which memory file to update: global, group, or user"),
      content: z.string().describe("The memory content to write"),
      mode: z
        .enum(["replace", "append"])
        .describe("'append' adds to the existing file; 'replace' overwrites it"),
    },
    async (args) => {
      try {
        const memory = (await loadAppConfig()).memory;
        if (!(memory?.enabled ?? true)) {
          return {content: [{type: "text" as const, text: MEMORY_DISABLED_TEXT}]};
        }

        const group = await Group.findById(ctx.groupId);
        if (!group) {
          return {content: [{type: "text" as const, text: "Error: Group not found."}]};
        }

        const isMainGroup = group.isMain === true;
        if (
          (args.scope === "global" || args.scope === "user") &&
          !canWriteGlobalMemory(isMainGroup)
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: only the main group can update ${args.scope} memory.`,
              },
            ],
          };
        }

        let targetPath: string;
        if (args.scope === "global") {
          targetPath = getGlobalMemoryPath();
        } else if (args.scope === "user") {
          targetPath = getUserProfilePath();
        } else {
          targetPath = getGroupMemoryPath(group.folder);
        }

        const result = await applyMemoryUpdate({
          filePath: targetPath,
          content: args.content,
          mode: args.mode,
          maxChars: memory?.maxFileChars ?? 6000,
        });

        if (!result.ok) {
          return {content: [{type: "text" as const, text: `Error: ${result.error}`}]};
        }

        logger.info(`update_memory: wrote ${args.scope} memory (${result.size} chars)`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Memory updated (scope: ${args.scope}, ${result.size} chars).`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error updating memory: ${msg}`}]};
      }
    }
  );

  const saveSkillTool = tool(
    "save_skill",
    "Save a reusable skill to Shade's skills library. Skills are procedures you authored — save one after solving a novel multi-step problem so future sessions can reuse the approach instead of re-deriving it. Overwrites an existing skill of the same name.",
    {
      name: z
        .string()
        .describe(
          'Kebab-case skill name: lowercase letters, digits, and hyphens (e.g. "check-plex-health")'
        ),
      description: z
        .string()
        .describe("One-line summary shown in the skills index (list_skills and the system prompt)"),
      content: z.string().describe("The reusable procedure, as a markdown body"),
    },
    async (args) => {
      try {
        const memory = (await loadAppConfig()).memory;
        if (!(memory?.enabled ?? true)) {
          return {content: [{type: "text" as const, text: MEMORY_DISABLED_TEXT}]};
        }

        const result = await saveSkill({
          name: args.name,
          description: args.description,
          content: args.content,
          maxChars: memory?.maxSkillChars ?? 8000,
        });

        if (!result.saved) {
          return {content: [{type: "text" as const, text: `Error: ${result.error}`}]};
        }

        return {content: [{type: "text" as const, text: `Skill "${args.name}" saved.`}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error saving skill: ${msg}`}]};
      }
    }
  );

  const listSkillsTool = tool(
    "list_skills",
    "List saved skills (name and one-line description). Skills are reusable procedures you previously authored with save_skill. Check this before re-deriving a multi-step procedure, then call load_skill to get the full content.",
    {},
    async () => {
      try {
        const memory = (await loadAppConfig()).memory;
        if (!(memory?.enabled ?? true)) {
          return {content: [{type: "text" as const, text: MEMORY_DISABLED_TEXT}]};
        }

        const skills = await listSkills();
        if (skills.length === 0) {
          return {content: [{type: "text" as const, text: "No skills saved yet."}]};
        }

        const lines = skills.map((skill) => `${skill.name} — ${skill.description}`);
        return {content: [{type: "text" as const, text: lines.join("\n")}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error listing skills: ${msg}`}]};
      }
    }
  );

  const loadSkillTool = tool(
    "load_skill",
    "Load the full content of a saved skill by name. Always load a skill before executing it — the skills index only shows names and descriptions.",
    {
      name: z.string().describe("The kebab-case name of the skill to load"),
    },
    async (args) => {
      try {
        const memory = (await loadAppConfig()).memory;
        if (!(memory?.enabled ?? true)) {
          return {content: [{type: "text" as const, text: MEMORY_DISABLED_TEXT}]};
        }

        const result = await loadSkill({name: args.name});
        if (!result.found) {
          const names = result.validNames?.length ? result.validNames.join(", ") : "(none)";
          return {
            content: [
              {
                type: "text" as const,
                text: `Skill "${args.name}" not found. Valid skills: ${names}`,
              },
            ],
          };
        }

        return {content: [{type: "text" as const, text: result.content ?? ""}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error loading skill: ${msg}`}]};
      }
    }
  );

  const STORE_DIR = "store";

  const getStorePath = (key: string): string => {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(ctx.groupFolder, STORE_DIR, `${safeKey}.json`);
  };

  const saveDataTool = tool(
    "save_data",
    "Save a named piece of data to persistent storage for this group. Data persists across sessions. Use for RSS feed lists, preferences, configuration, etc.",
    {
      key: z.string().describe("A unique name for this data (alphanumeric, hyphens, underscores)"),
      data: z.string().describe("The data to store (use JSON for structured data)"),
    },
    async (args) => {
      const storePath = getStorePath(args.key);
      await fs.mkdir(path.dirname(storePath), {recursive: true});
      await fs.writeFile(
        storePath,
        JSON.stringify({key: args.key, data: args.data, updatedAt: new Date().toISOString()}),
        "utf-8"
      );
      return {
        content: [{type: "text" as const, text: `Data saved with key "${args.key}".`}],
      };
    }
  );

  const loadDataTool = tool(
    "load_data",
    "Load a previously saved piece of data by key.",
    {
      key: z.string().describe("The key of the data to load"),
    },
    async (args) => {
      const storePath = getStorePath(args.key);
      try {
        const content = await fs.readFile(storePath, "utf-8");
        const parsed = JSON.parse(content);
        return {
          content: [{type: "text" as const, text: parsed.data}],
        };
      } catch {
        return {
          content: [{type: "text" as const, text: `No data found for key "${args.key}".`}],
        };
      }
    }
  );

  const listDataTool = tool(
    "list_data",
    "List all saved data keys for this group.",
    {},
    async () => {
      const storeDir = path.join(ctx.groupFolder, STORE_DIR);
      try {
        const files = await fs.readdir(storeDir);
        const keys = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
        if (keys.length === 0) {
          return {content: [{type: "text" as const, text: "No saved data found."}]};
        }
        return {content: [{type: "text" as const, text: keys.join("\n")}]};
      } catch {
        return {content: [{type: "text" as const, text: "No saved data found."}]};
      }
    }
  );

  const deleteDataTool = tool(
    "delete_data",
    "Delete a saved piece of data by key.",
    {
      key: z.string().describe("The key of the data to delete"),
    },
    async (args) => {
      const storePath = getStorePath(args.key);
      try {
        await fs.unlink(storePath);
        return {content: [{type: "text" as const, text: `Data "${args.key}" deleted.`}]};
      } catch {
        return {
          content: [{type: "text" as const, text: `No data found for key "${args.key}".`}],
        };
      }
    }
  );

  const createFeatureTool = tool(
    "create_feature",
    "Create a new Slack channel for a focused feature discussion. Creates the channel, invites the requesting user, and sets up a new Shade group pre-configured to drive the feature through the `/ip` planning skill and then `/implement` to execute the resulting plan. Use this when someone wants to start working on a new feature.",
    {
      name: z
        .string()
        .describe(
          "Short feature name in kebab-case (e.g., 'zoom-integration', 'rss-reader'). Used as the Slack channel name with a 'feat-' prefix."
        ),
      description: z
        .string()
        .optional()
        .describe("Brief description of the feature for the channel topic"),
    },
    async (args) => {
      logger.info(
        `MCP create_feature invoked: name="${args.name}" group=${ctx.groupId} sender=${ctx.senderExternalId ?? "<none>"}`
      );
      if (!ctx.senderExternalId) {
        logger.warn(
          `MCP create_feature aborted: no senderExternalId in context (group=${ctx.groupId})`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No sender information available to invite to the channel. The feature channel was NOT created.",
            },
          ],
        };
      }
      const channelName = `feat-${args.name}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 80);
      try {
        const fileId = await writeIpcFile(ctx.ipcDir, {
          type: "create_feature",
          groupId: ctx.groupId,
          channelId: ctx.channelId,
          name: channelName,
          description: args.description,
          senderExternalId: ctx.senderExternalId,
        });
        logger.info(
          `MCP create_feature queued IPC ${fileId} for #${channelName} (dir=${ctx.ipcDir})`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Feature channel creation queued (${fileId}). Creating #${channelName} and inviting you...`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          `MCP create_feature failed to queue IPC for #${channelName} (dir=${ctx.ipcDir}): ${msg}`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to queue feature channel creation: ${msg}. The channel was NOT created — ask the operator to check the backend logs.`,
            },
          ],
        };
      }
    }
  );

  // --- Apple Contacts tools ---

  const searchContactsTool = tool(
    "search_contacts",
    "Search Apple Contacts by name, email, phone number, company, or notes. Use this to find contacts when processing messages — match senders to known contacts for context.",
    {
      query: z
        .string()
        .describe(
          "Search query: a name, email address, phone number, company name, or keyword from notes"
        ),
    },
    async (args) => {
      try {
        const contacts = await searchContacts(args.query);
        if (contacts.length === 0) {
          return {
            content: [{type: "text" as const, text: `No contacts found matching "${args.query}"`}],
          };
        }
        return {content: [{type: "text" as const, text: JSON.stringify(contacts, null, 2)}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error searching contacts: ${msg}`}]};
      }
    }
  );

  const getContactTool = tool(
    "get_contact",
    "Get full details for a specific Apple Contact by ID, including all emails, phones, addresses, and Shade context notes.",
    {
      id: z.string().describe("The Apple Contacts ID of the person"),
    },
    async (args) => {
      try {
        const contact = await getContactById(args.id);
        if (!contact) {
          return {content: [{type: "text" as const, text: "Contact not found"}]};
        }
        return {content: [{type: "text" as const, text: JSON.stringify(contact, null, 2)}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error getting contact: ${msg}`}]};
      }
    }
  );

  const matchContactTool = tool(
    "match_contact",
    "Match an incoming message sender to an Apple Contact using their email address or phone number. Returns the full contact if found, or null. Use this when processing emails or texts to identify who is messaging.",
    {
      email: z.string().optional().describe("Email address to match"),
      phone: z.string().optional().describe("Phone number to match (any format)"),
    },
    async (args) => {
      try {
        let contact = null;
        if (args.email) {
          contact = await matchContactByEmail(args.email);
        }
        if (!contact && args.phone) {
          contact = await matchContactByPhone(args.phone);
        }
        if (!contact) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No contact found for ${args.email ? `email: ${args.email}` : ""}${args.email && args.phone ? ", " : ""}${args.phone ? `phone: ${args.phone}` : ""}`,
              },
            ],
          };
        }
        return {content: [{type: "text" as const, text: JSON.stringify(contact, null, 2)}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error matching contact: ${msg}`}]};
      }
    }
  );

  const createContactTool = tool(
    "create_contact",
    "Create a new contact in Apple Contacts. Use when you encounter a new person who should be tracked.",
    {
      firstName: z.string().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      company: z.string().optional().describe("Company/organization name"),
      jobTitle: z.string().optional().describe("Job title"),
      emails: z
        .array(z.object({label: z.string(), value: z.string()}))
        .optional()
        .describe('Email addresses with labels (e.g., [{label: "work", value: "j@co.com"}])'),
      phones: z
        .array(z.object({label: z.string(), value: z.string()}))
        .optional()
        .describe('Phone numbers with labels (e.g., [{label: "mobile", value: "+15551234567"}])'),
      note: z.string().optional().describe("Free-form notes about this person"),
    },
    async (args) => {
      try {
        const contact = await createContact({
          firstName: args.firstName,
          lastName: args.lastName,
          company: args.company,
          jobTitle: args.jobTitle,
          emails: args.emails,
          phones: args.phones,
          note: args.note,
        });
        return {
          content: [
            {type: "text" as const, text: `Contact created: ${JSON.stringify(contact, null, 2)}`},
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error creating contact: ${msg}`}]};
      }
    }
  );

  const updateContactTool = tool(
    "update_contact",
    "Update an existing Apple Contact's basic fields (name, company, job title, or full note text).",
    {
      id: z.string().describe("The Apple Contacts ID"),
      firstName: z.string().optional().describe("Updated first name"),
      lastName: z.string().optional().describe("Updated last name"),
      company: z.string().optional().describe("Updated company name"),
      jobTitle: z.string().optional().describe("Updated job title"),
      note: z
        .string()
        .optional()
        .describe("Replace the full note text (use add_contact_context for incremental updates)"),
    },
    async (args) => {
      try {
        const contact = await updateContact({
          id: args.id,
          firstName: args.firstName,
          lastName: args.lastName,
          company: args.company,
          jobTitle: args.jobTitle,
          note: args.note,
        });
        return {
          content: [
            {type: "text" as const, text: `Contact updated: ${JSON.stringify(contact, null, 2)}`},
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error updating contact: ${msg}`}]};
      }
    }
  );

  const addContactContextTool = tool(
    "add_contact_context",
    "Add or update structured Shade context in a contact's notes. This merges new information with existing context — interests, topics, and preferences are additive (won't remove existing ones). Recent updates are appended. Use this to continuously enrich contacts with things you learn from conversations.",
    {
      id: z.string().describe("The Apple Contacts ID"),
      relationship: z
        .string()
        .optional()
        .describe('Relationship type (e.g., "coworker", "friend", "manager", "client")'),
      metAt: z
        .string()
        .optional()
        .describe('How/where you met (e.g., "2025-03 tech conference in SF")'),
      interests: z
        .array(z.string())
        .optional()
        .describe('Hobbies and interests (e.g., ["hiking", "photography", "ML"])'),
      topics: z
        .array(z.string())
        .optional()
        .describe(
          'Current work/life topics (e.g., ["working on search feature", "learning Rust"])'
        ),
      preferences: z
        .array(z.string())
        .optional()
        .describe(
          'Communication preferences (e.g., ["prefers morning meetings", "likes concise emails"])'
        ),
      recentUpdates: z
        .array(z.string())
        .optional()
        .describe(
          'Recent life/work updates with date context (e.g., ["got promoted to staff engineer (2025-06)"])'
        ),
      customFields: z
        .record(z.string(), z.string())
        .optional()
        .describe("Any other key-value pairs to store"),
    },
    async (args) => {
      try {
        const contact = await addShadeContext(args.id, {
          relationship: args.relationship,
          metAt: args.metAt,
          interests: args.interests,
          topics: args.topics,
          preferences: args.preferences,
          recentUpdates: args.recentUpdates,
          customFields: args.customFields,
        });
        return {
          content: [
            {type: "text" as const, text: `Context added to ${contact.fullName}:\n${contact.note}`},
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error adding context: ${msg}`}]};
      }
    }
  );

  const setAllowedUsersTool = tool(
    "set_allowed_users",
    "Set which Slack users are allowed to interact with Shade in this workspace. Only messages from allowed users will be processed; all others are silently ignored. Pass an empty array to allow everyone. Note: this requires a restart to take effect.",
    {
      userIds: z
        .array(z.string())
        .describe(
          "Array of Slack user IDs to allow (e.g., ['U12345ABC']). Pass an empty array to remove the filter and allow all users."
        ),
      addSelf: z
        .boolean()
        .default(false)
        .describe(
          "If true, automatically adds the user who sent this message to the allowed list."
        ),
    },
    async (args) => {
      try {
        const userIds = [...args.userIds];
        if (args.addSelf && ctx.senderExternalId && !userIds.includes(ctx.senderExternalId)) {
          userIds.push(ctx.senderExternalId);
        }

        const channelDoc = await Channel.findById(ctx.channelId);
        if (!channelDoc) {
          return {
            content: [{type: "text" as const, text: "Error: Channel not found."}],
          };
        }

        const updatedConfig = {
          ...(channelDoc.config as Record<string, unknown>),
          allowedUserIds: userIds,
        };
        await Channel.findByIdAndUpdate(ctx.channelId, {$set: {config: updatedConfig}});

        const msg =
          userIds.length === 0
            ? "Allowed users filter removed — all users can now interact with Shade in this workspace. Restart required to take effect."
            : `Allowed users set to: ${userIds.join(", ")}. Only these users will be able to interact with Shade in this workspace. Restart required to take effect.`;

        return {
          content: [{type: "text" as const, text: msg}],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{type: "text" as const, text: `Error setting allowed users: ${errorMsg}`}],
        };
      }
    }
  );

  const listSmsReplyNumbersTool = tool(
    "list_sms_reply_numbers",
    "List the iMessage/SMS reply allowlist — the phone numbers and iMessage email handles Shade is allowed to reply to over text. Messages from anyone else are still catalogued (stored for context and searchable) but never get a reply.",
    {},
    async () => {
      try {
        const {replyAllowlist} = (await loadAppConfig()).imessage;
        if (replyAllowlist.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "The SMS reply allowlist is empty — Shade replies to no one over iMessage/SMS; all texts are catalogued only.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `SMS reply allowlist (${replyAllowlist.length}):\n${replyAllowlist.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error listing allowlist: ${msg}`}]};
      }
    }
  );

  const addSmsReplyNumberTool = tool(
    "add_sms_reply_number",
    "Add a phone number (or iMessage email handle) to the iMessage/SMS reply allowlist so Shade will reply to their texts. Takes effect immediately — no restart needed.",
    {
      handle: z
        .string()
        .describe(
          "Phone number (E.164 preferred, e.g. '+19102755241'; other formats are matched on digits) or an iMessage email address"
        ),
    },
    async (args) => {
      try {
        const handle = args.handle.trim();
        if (handle.length === 0) {
          return {content: [{type: "text" as const, text: "Error: handle is empty."}]};
        }

        const config = await loadAppConfig();
        if (isHandleAllowed(handle, config.imessage.replyAllowlist)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `${handle} is already on the SMS reply allowlist.`,
              },
            ],
          };
        }

        await AppConfig.findOneAndUpdate(
          {_id: config._id},
          {$addToSet: {"imessage.replyAllowlist": handle}}
        );
        logger.info(`add_sms_reply_number: added ${handle} to the SMS reply allowlist`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Added ${handle} to the SMS reply allowlist — Shade will now reply to their texts.`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error adding to allowlist: ${msg}`}]};
      }
    }
  );

  const removeSmsReplyNumberTool = tool(
    "remove_sms_reply_number",
    "Remove a phone number (or iMessage email handle) from the iMessage/SMS reply allowlist. Their texts will still be catalogued, but Shade will stop replying to them. Takes effect immediately.",
    {
      handle: z.string().describe("The phone number or email handle to remove (any format)"),
    },
    async (args) => {
      try {
        const config = await loadAppConfig();
        const remaining = config.imessage.replyAllowlist.filter(
          (entry) => !isHandleAllowed(entry, [args.handle])
        );

        if (remaining.length === config.imessage.replyAllowlist.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: `${args.handle} is not on the SMS reply allowlist.`,
              },
            ],
          };
        }

        await AppConfig.findOneAndUpdate(
          {_id: config._id},
          {$set: {"imessage.replyAllowlist": remaining}}
        );
        logger.info(`remove_sms_reply_number: removed ${args.handle} from the SMS reply allowlist`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Removed ${args.handle} from the SMS reply allowlist — their texts will be catalogued without a reply.`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error removing from allowlist: ${msg}`}]};
      }
    }
  );

  const startRadioStreamTool = tool(
    "start_radio_stream",
    "Start a radio stream transcription. Begins streaming audio from the configured URL, transcribing it with Deepgram, and posting transcripts to the configured Slack channel.",
    {
      radioStreamId: z.string().describe("The RadioStream document ID to start"),
    },
    async (args) => {
      try {
        const stream = await RadioStream.findById(args.radioStreamId);
        if (!stream) {
          return {content: [{type: "text" as const, text: "Error: Radio stream not found."}]};
        }
        if (stream.status === "active") {
          return {
            content: [{type: "text" as const, text: `Stream "${stream.name}" is already active.`}],
          };
        }
        const fileId = await writeIpcFile(ctx.ipcDir, {
          type: "start_radio_stream",
          groupId: ctx.groupId,
          radioStreamId: args.radioStreamId,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Stream "${stream.name}" start queued (${fileId}). Transcription will begin shortly.`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error starting stream: ${msg}`}]};
      }
    }
  );

  const stopRadioStreamTool = tool(
    "stop_radio_stream",
    "Stop a running radio stream transcription. Stops the audio capture and transcription pipeline.",
    {
      radioStreamId: z.string().describe("The RadioStream document ID to stop"),
    },
    async (args) => {
      try {
        const stream = await RadioStream.findById(args.radioStreamId);
        if (!stream) {
          return {content: [{type: "text" as const, text: "Error: Radio stream not found."}]};
        }
        if (stream.status !== "active") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Stream "${stream.name}" is not currently active (status: ${stream.status}).`,
              },
            ],
          };
        }
        const fileId = await writeIpcFile(ctx.ipcDir, {
          type: "stop_radio_stream",
          groupId: ctx.groupId,
          radioStreamId: args.radioStreamId,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Stream "${stream.name}" stop queued (${fileId}). Transcription will stop shortly.`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error stopping stream: ${msg}`}]};
      }
    }
  );

  const listRadioStreamsTool = tool(
    "list_radio_streams",
    "List all configured radio streams with their status, stream URL, and last transcript time.",
    {},
    async () => {
      try {
        const streams = await RadioStream.find({}).sort({created: -1}).limit(50).lean();
        if (streams.length === 0) {
          return {content: [{type: "text" as const, text: "No radio streams configured."}]};
        }
        const list = streams.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          status: s.status,
          streamUrl: s.streamUrl,
          lastTranscriptAt: s.lastTranscriptAt?.toISOString() ?? null,
          reconnectCount: s.reconnectCount,
          transcriptionEnabled: s.transcriptionEnabled,
          errorMessage: s.errorMessage ?? null,
        }));
        return {content: [{type: "text" as const, text: JSON.stringify(list, null, 2)}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error listing streams: ${msg}`}]};
      }
    }
  );

  const toggleTranscriptionTool = tool(
    "toggle_transcription",
    "Enable or disable radio stream transcription. When enabled, the stream transcribes speech to Slack and identifies songs via ACRCloud. When disabled, the stream stops entirely. Requires a restart to take effect.",
    {
      radioStreamId: z.string().describe("The RadioStream document ID"),
      enabled: z.boolean().describe("true to enable transcription, false to disable"),
    },
    async (args) => {
      try {
        const stream = await RadioStream.findById(args.radioStreamId);
        if (!stream) {
          return {content: [{type: "text" as const, text: "Error: Radio stream not found."}]};
        }
        await RadioStream.findByIdAndUpdate(args.radioStreamId, {
          $set: {transcriptionEnabled: args.enabled},
        });
        // Queue IPC to start or stop the stream immediately
        const fileId = await writeIpcFile(ctx.ipcDir, {
          type: args.enabled ? "start_radio_stream" : "stop_radio_stream",
          groupId: ctx.groupId,
          radioStreamId: args.radioStreamId,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Transcription ${args.enabled ? "enabled" : "disabled"} for "${stream.name}". Stream ${args.enabled ? "starting" : "stopping"} now (${fileId}).`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error toggling transcription: ${msg}`}]};
      }
    }
  );

  const toggleTriviaMonitorTool = tool(
    "toggle_trivia_monitor",
    "Enable or disable the trivia monitor. When enabled, Shade watches radio transcripts for trivia questions and automatically researches answers once music starts. When disabled, transcript monitoring stops.",
    {
      enabled: z.boolean().describe("true to enable trivia monitor, false to disable"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "toggle_trivia_auto_search",
        groupId: ctx.groupId,
        enabled: args.enabled,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Trivia monitor ${args.enabled ? "enable" : "disable"} queued (${fileId}).`,
          },
        ],
      };
    }
  );

  const triviaMonitorStatusTool = tool(
    "trivia_monitor_status",
    "Check the current status of the trivia monitor — whether it's enabled in config and the configured group.",
    {},
    async () => {
      try {
        const config = await loadAppConfig();
        const enabled = config.triviaMonitor.enabled;
        const groupId = config.triviaMonitor.groupId;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({enabled, groupId: groupId || null}, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error checking status: ${msg}`}]};
      }
    }
  );

  return [
    sendMessageTool,
    respondWithCardTool,
    addReactionTool,
    createFeatureTool,
    scheduleTaskTool,
    listTasksTool,
    pauseTaskTool,
    resumeTaskTool,
    cancelTaskTool,
    delegateTaskTool,
    getTaskResultTool,
    listAgentTasksTool,
    cancelAgentTaskTool,
    getWeatherTool,
    getChannelHistoryTool,
    searchHistoryTool,
    updateMemoryTool,
    saveSkillTool,
    listSkillsTool,
    loadSkillTool,
    saveDataTool,
    loadDataTool,
    listDataTool,
    deleteDataTool,
    ...buildAppleTools(),
    searchContactsTool,
    getContactTool,
    matchContactTool,
    createContactTool,
    updateContactTool,
    addContactContextTool,
    setAllowedUsersTool,
    listSmsReplyNumbersTool,
    addSmsReplyNumberTool,
    removeSmsReplyNumberTool,
    startRadioStreamTool,
    stopRadioStreamTool,
    listRadioStreamsTool,
    toggleTranscriptionTool,
    toggleTriviaMonitorTool,
    triviaMonitorStatusTool,
  ];
};

export const createShadeMcpServer = (ctx: McpContext) => {
  return createSdkMcpServer({
    name: "shade-orchestrator",
    version: "1.0.0",
    tools: buildTools(ctx),
  });
};
