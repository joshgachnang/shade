import {describe, expect, mock, test} from "bun:test";

// Test the GroupQueue's public queue management API without triggering
// async agent execution (which requires DB, filesystem, and SDK mocks).
// We import the class dynamically to avoid module-level side effects.

const createMockRunner = () => ({
  run: mock(() =>
    Promise.resolve({
      output: "Hello!",
      sessionId: "session1",
      durationMs: 100,
      status: "completed" as const,
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
  // We use dynamic import so this test file doesn't pull in DB models
  // at the module level and cause issues with mock.module in other files.
  const getGroupQueue = async () => {
    const mod = await import("./groupQueue");
    return mod.GroupQueue;
  };

  test("isGroupActive returns false for unknown group", async () => {
    const GroupQueue = await getGroupQueue();
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner as any, channelManager as any);

    expect(queue.isGroupActive("nonexistent")).toBe(false);
  });

  test("getQueueDepth returns 0 for unknown group", async () => {
    const GroupQueue = await getGroupQueue();
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner as any, channelManager as any);

    expect(queue.getQueueDepth("nonexistent")).toBe(0);
  });

  test("getActiveAgentCount starts at 0", async () => {
    const GroupQueue = await getGroupQueue();
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner as any, channelManager as any);

    expect(queue.getActiveAgentCount()).toBe(0);
  });
});
