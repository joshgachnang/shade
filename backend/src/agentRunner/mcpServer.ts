import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {createSdkMcpServer, tool} from "@anthropic-ai/claude-agent-sdk";
import {z} from "zod";
import {Message} from "../models/message";
import {ScheduledTask} from "../models/scheduledTask";

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

  return [
    sendMessageTool,
    scheduleTaskTool,
    listTasksTool,
    pauseTaskTool,
    resumeTaskTool,
    cancelTaskTool,
    getWeatherTool,
    getChannelHistoryTool,
  ];
};

export const createShadeMcpServer = (ctx: McpContext) => {
  return createSdkMcpServer({
    name: "shade-orchestrator",
    version: "1.0.0",
    tools: buildTools(ctx),
  });
};
