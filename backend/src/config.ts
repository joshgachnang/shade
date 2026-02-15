import path from "node:path";

const dataDir = process.env.SHADE_DATA_DIR || path.join(process.cwd(), "data");

export const config = {
  assistantName: process.env.SHADE_ASSISTANT_NAME || "Shade",

  pollIntervals: {
    message: Number(process.env.SHADE_POLL_MESSAGE_MS) || 2000,
    task: Number(process.env.SHADE_POLL_TASK_MS) || 60000,
    ipc: Number(process.env.SHADE_POLL_IPC_MS) || 1000,
  },

  concurrency: {
    maxGlobal: Number(process.env.SHADE_MAX_GLOBAL_CONCURRENCY) || 5,
  },

  paths: {
    data: dataDir,
    groups: path.join(dataDir, "groups"),
    sessions: path.join(dataDir, "sessions"),
    ipc: path.join(dataDir, "ipc"),
    plugins: path.join(dataDir, "plugins"),
  },

  triggerPattern: process.env.SHADE_TRIGGER_PATTERN || "@Shade",
};
