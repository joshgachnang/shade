import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import {createSdkMcpServer, tool} from "@anthropic-ai/claude-agent-sdk";
import {z} from "zod";
import {Message} from "../models/message";
import {ScheduledTask} from "../models/scheduledTask";

const execFileAsync = promisify(execFile);

interface McpContext {
  groupId: string;
  channelId: string;
  ipcDir: string;
}

const writeIpcFile = async (ipcDir: string, data: Record<string, unknown>): Promise<string> => {
  await fs.mkdir(ipcDir, {recursive: true});

  const fileId = randomUUID();
  const tmpPath = path.join(ipcDir, `${fileId}.tmp`);
  const finalPath = path.join(ipcDir, `${fileId}.json`);

  await fs.writeFile(tmpPath, JSON.stringify(data), "utf-8");
  await fs.rename(tmpPath, finalPath);

  return fileId;
};

const buildTools = (ctx: McpContext) => {
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
      });
      return {
        content: [{type: "text" as const, text: `Message queued (${fileId})`}],
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

  // --- Apple Reminders tools (macOS only, uses JXA via osascript) ---

  const runJxa = async (script: string): Promise<string> => {
    const {stdout} = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
      timeout: 15_000,
    });
    return stdout.trim();
  };

  const listReminderListsTool = tool(
    "list_reminder_lists",
    "List all Apple Reminders lists on this Mac. Returns list names and their reminder counts.",
    {},
    async () => {
      try {
        const script = `
          const app = Application("Reminders");
          const lists = app.lists();
          JSON.stringify(lists.map(l => ({
            name: l.name(),
            id: l.id(),
            count: l.reminders.whose({completed: false})().length
          })));
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: result}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error listing reminder lists: ${msg}`}]};
      }
    }
  );

  const listRemindersTool = tool(
    "list_reminders",
    "List reminders from an Apple Reminders list. Returns reminder names, due dates, priorities, and completion status.",
    {
      listName: z.string().describe("Name of the reminders list (e.g., 'Reminders', 'Shopping')"),
      includeCompleted: z
        .boolean()
        .default(false)
        .describe("Include completed reminders (default: false)"),
    },
    async (args) => {
      try {
        const listNameEscaped = args.listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `
          const app = Application("Reminders");
          const list = app.lists.byName("${listNameEscaped}");
          const reminders = ${args.includeCompleted ? "list.reminders()" : "list.reminders.whose({completed: false})()"};
          JSON.stringify(reminders.map(r => ({
            name: r.name(),
            id: r.id(),
            completed: r.completed(),
            dueDate: r.dueDate() ? r.dueDate().toISOString() : null,
            priority: r.priority(),
            body: r.body() || null
          })));
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: result}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error listing reminders: ${msg}`}]};
      }
    }
  );

  const createReminderTool = tool(
    "create_reminder",
    "Create a new reminder in Apple Reminders. Supports setting name, due date, priority, notes, and target list.",
    {
      name: z.string().describe("The reminder title"),
      listName: z.string().default("Reminders").describe("Target list name (default: 'Reminders')"),
      notes: z.string().optional().describe("Body/notes for the reminder"),
      dueDate: z
        .string()
        .optional()
        .describe("Due date as ISO 8601 string (e.g., '2025-12-25T09:00:00')"),
      priority: z
        .number()
        .min(0)
        .max(9)
        .default(0)
        .describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
    },
    async (args) => {
      try {
        const listNameEscaped = args.listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const nameEscaped = args.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const notesEscaped = args.notes
          ? args.notes.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
          : "";

        let dueDateJs = "null";
        if (args.dueDate) {
          dueDateJs = `new Date("${args.dueDate}")`;
        }

        const script = `
          const app = Application("Reminders");
          const list = app.lists.byName("${listNameEscaped}");
          const props = {
            name: "${nameEscaped}",
            priority: ${args.priority}
          };
          ${args.notes ? `props.body = "${notesEscaped}";` : ""}
          const dueDate = ${dueDateJs};
          if (dueDate) { props.dueDate = dueDate; }
          const r = app.Reminder(props);
          list.reminders.push(r);
          JSON.stringify({id: r.id(), name: r.name()});
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: `Reminder created: ${result}`}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error creating reminder: ${msg}`}]};
      }
    }
  );

  const completeReminderTool = tool(
    "complete_reminder",
    "Mark an Apple Reminder as completed by its name and list.",
    {
      name: z.string().describe("The exact name of the reminder to complete"),
      listName: z
        .string()
        .default("Reminders")
        .describe("The list containing the reminder (default: 'Reminders')"),
    },
    async (args) => {
      try {
        const listNameEscaped = args.listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const nameEscaped = args.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `
          const app = Application("Reminders");
          const list = app.lists.byName("${listNameEscaped}");
          const matches = list.reminders.whose({name: "${nameEscaped}", completed: false})();
          if (matches.length === 0) {
            JSON.stringify({error: "No matching incomplete reminder found"});
          } else {
            matches[0].completed = true;
            JSON.stringify({completed: true, name: matches[0].name()});
          }
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: result}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error completing reminder: ${msg}`}]};
      }
    }
  );

  const deleteReminderTool = tool(
    "delete_reminder",
    "Delete an Apple Reminder by its name and list. This permanently removes the reminder.",
    {
      name: z.string().describe("The exact name of the reminder to delete"),
      listName: z
        .string()
        .default("Reminders")
        .describe("The list containing the reminder (default: 'Reminders')"),
    },
    async (args) => {
      try {
        const listNameEscaped = args.listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const nameEscaped = args.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `
          const app = Application("Reminders");
          const list = app.lists.byName("${listNameEscaped}");
          const matches = list.reminders.whose({name: "${nameEscaped}"})();
          if (matches.length === 0) {
            JSON.stringify({error: "No matching reminder found"});
          } else {
            app.delete(matches[0]);
            JSON.stringify({deleted: true, name: "${nameEscaped}"});
          }
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: result}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error deleting reminder: ${msg}`}]};
      }
    }
  );

  return [
    sendMessageTool,
    scheduleTaskTool,
    listTasksTool,
    pauseTaskTool,
    resumeTaskTool,
    cancelTaskTool,
    getWeatherTool,
    getChannelHistoryTool,
    listReminderListsTool,
    listRemindersTool,
    createReminderTool,
    completeReminderTool,
    deleteReminderTool,
  ];
};

export const createShadeMcpServer = (ctx: McpContext) => {
  return createSdkMcpServer({
    name: "shade-orchestrator",
    version: "1.0.0",
    tools: buildTools(ctx),
  });
};
