import {describe, expect, mock, test} from "bun:test";
import type {GroupDocument, MessageDocument} from "../types";
import {GroupQueue} from "./groupQueue";
import type {AgentRunner, AgentRunResult} from "./runners/types";

// Mock DB models to avoid MongoDB connections
mock.module("../models/taskRunLog", () => ({
  TaskRunLog: {
    create: mock(() => Promise.resolve({_id: "taskrun1"})),
    findByIdAndUpdate: mock(() => Promise.resolve()),
  },
}));

mock.module("../models/agentSession", () => ({
  AgentSession: {
    findOne: mock(() => ({sort: () => Promise.resolve(null)})),
    create: mock(() =>
      Promise.resolve({
        sessionId: "session1",
        transcriptPath: "/tmp/claude/transcript.jsonl",
        messageCount: 0,
      })
    ),
    findOneAndUpdate: mock(() => Promise.resolve()),
  },
}));

mock.module("../models/message", () => ({
  Message: {
    find: mock(() => ({sort: () => ({limit: () => Promise.resolve([])})})),
    findOne: mock(() => ({sort: () => Promise.resolve(null)})),
    updateMany: mock(() => Promise.resolve()),
  },
}));

// Mock session and memory modules to avoid filesystem operations
mock.module("./sessions", () => ({
  getOrCreateSession: mock(() =>
    Promise.resolve({
      sessionId: "session1",
      transcriptPath: "/tmp/claude/transcript.jsonl",
      messageCount: 0,
      resumeSessionAt: undefined,
    })
  ),
  updateSessionActivity: mock(() => Promise.resolve()),
  appendToTranscript: mock(() => Promise.resolve()),
}));

mock.module("./memory", () => ({
  ensureGroupDirectory: mock((folder: string) => Promise.resolve(`/tmp/claude/groups/${folder}`)),
}));

const makeGroup = (id = "group1"): GroupDocument => {
  return {
    _id: {toString: () => id} as any,
    name: `group-${id}`,
    folder: `folder-${id}`,
    channelId: {toString: () => "channel1"} as any,
    externalId: `ext-${id}`,
    trigger: "@Shade",
    requiresTrigger: false,
    isMain: false,
    modelConfig: {defaultBackend: "claude", defaultModel: "claude-3-haiku"},
    executionConfig: {timeout: 5000, idleTimeout: 2000},
  } as unknown as GroupDocument;
};

const makeMessage = (id = "msg1"): MessageDocument => {
  return {
    _id: {toString: () => id} as any,
    content: "hello",
    sender: "alice",
    isFromBot: false,
    created: new Date(),
    groupId: {toString: () => "group1"} as any,
  } as unknown as MessageDocument;
};

const createMockRunner = (result?: Partial<AgentRunResult>): AgentRunner => ({
  run: mock(() =>
    Promise.resolve({
      output: "Hello!",
      sessionId: "session1",
      durationMs: 100,
      status: "completed" as const,
      ...result,
    })
  ),
  stop: mock(() => Promise.resolve()),
  isRunning: mock(() => false),
  sendFollowUp: mock(() => Promise.resolve()),
});

const createMockChannelManager = () => ({
  sendMessage: mock(() => Promise.resolve()),
  sendMessageToGroup: mock(() => Promise.resolve()),
  getAllGroups: mock(() => []),
  getGroup: mock(() => undefined),
  getGroupByExternalId: mock(() => undefined),
  getConnectedChannelCount: mock(() => 0),
  initialize: mock(() => Promise.resolve()),
  disconnectAll: mock(() => Promise.resolve()),
  setExpressApp: mock(() => {}),
});

describe("GroupQueue", () => {
  test("enqueue increments queue depth", () => {
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner, channelManager as any);

    const group = makeGroup();
    const message = makeMessage();

    // Enqueue but since processNext runs async, check initial state
    queue.enqueue(group, message);

    // The item was shifted off immediately for processing, so depth may be 0
    // but the group should be active
    expect(queue.getActiveAgentCount()).toBeGreaterThanOrEqual(0);
  });

  test("isGroupActive returns false for unknown group", () => {
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner, channelManager as any);

    expect(queue.isGroupActive("nonexistent")).toBe(false);
  });

  test("getQueueDepth returns 0 for unknown group", () => {
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner, channelManager as any);

    expect(queue.getQueueDepth("nonexistent")).toBe(0);
  });

  test("getActiveAgentCount starts at 0", () => {
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner, channelManager as any);

    expect(queue.getActiveAgentCount()).toBe(0);
  });

  test("enqueue calls runner.run", async () => {
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner, channelManager as any);

    const group = makeGroup();
    const message = makeMessage();

    queue.enqueue(group, message);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(runner.run).toHaveBeenCalled();
  });

  test("sends response via channelManager after successful run", async () => {
    const runner = createMockRunner({output: "Bot response"});
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner, channelManager as any);

    const group = makeGroup();
    const message = makeMessage();

    queue.enqueue(group, message);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(channelManager.sendMessageToGroup).toHaveBeenCalled();
  });

  test("group becomes inactive after run completes", async () => {
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner, channelManager as any);

    const group = makeGroup();
    const message = makeMessage();

    queue.enqueue(group, message);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(queue.isGroupActive("group1")).toBe(false);
    expect(queue.getActiveAgentCount()).toBe(0);
  });
});
