import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {createSdkMcpServer, tool} from "@anthropic-ai/claude-agent-sdk";
import {z} from "zod";

const getIpcDir = (): string => {
  return process.env.SHADE_IPC_DIR || path.join(process.cwd(), "../../data/ipc");
};

const getGroupId = (): string => {
  return process.env.SHADE_GROUP_ID || "";
};

const getChannelId = (): string => {
  return process.env.SHADE_CHANNEL_ID || "";
};

const writeIpcFile = async (data: Record<string, unknown>): Promise<string> => {
  const ipcDir = getIpcDir();
  await fs.mkdir(ipcDir, {recursive: true});

  const fileId = randomUUID();
  const tmpPath = path.join(ipcDir, `${fileId}.tmp`);
  const finalPath = path.join(ipcDir, `${fileId}.json`);

  await fs.writeFile(tmpPath, JSON.stringify(data), "utf-8");
  await fs.rename(tmpPath, finalPath);

  return fileId;
};

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
    const fileId = await writeIpcFile({
      type: "send_message",
      groupId: getGroupId(),
      channelId: getChannelId(),
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
    const fileId = await writeIpcFile({
      type: "create_task",
      groupId: getGroupId(),
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
  "List scheduled tasks for the current group.",
  {
    status: z
      .enum(["active", "paused", "completed", "cancelled"])
      .optional()
      .describe("Filter by status"),
  },
  async (_args) => {
    // Tasks are read directly from MongoDB via the agent's file system access
    // This tool provides a convenience wrapper
    return {
      content: [
        {
          type: "text" as const,
          text: `Use the Read tool to query the API at GET /scheduledTasks?groupId=${getGroupId()}`,
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
    const fileId = await writeIpcFile({
      type: "pause_task",
      groupId: getGroupId(),
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
    const fileId = await writeIpcFile({
      type: "resume_task",
      groupId: getGroupId(),
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
    const fileId = await writeIpcFile({
      type: "cancel_task",
      groupId: getGroupId(),
      taskId: args.taskId,
    });
    return {
      content: [{type: "text" as const, text: `Task cancel queued (${fileId})`}],
    };
  }
);

export const createShadeMcpServer = () => {
  return createSdkMcpServer({
    name: "shade-orchestrator",
    version: "1.0.0",
    tools: [
      sendMessageTool,
      scheduleTaskTool,
      listTasksTool,
      pauseTaskTool,
      resumeTaskTool,
      cancelTaskTool,
    ],
  });
};
