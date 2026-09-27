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

describe("resolveAgentTimeout", () => {
  test("defaults to 15 minutes when unset", async () => {
    const {resolveAgentTimeout} = await import("./groupQueue");
    expect(resolveAgentTimeout(undefined)).toBe(900000);
    expect(resolveAgentTimeout(0)).toBe(900000);
  });

  test("treats the legacy persisted 5-minute default as unset", async () => {
    const {resolveAgentTimeout} = await import("./groupQueue");
    expect(resolveAgentTimeout(300000)).toBe(900000);
  });

  test("honors an explicitly configured timeout", async () => {
    const {resolveAgentTimeout} = await import("./groupQueue");
    expect(resolveAgentTimeout(600000)).toBe(600000);
    expect(resolveAgentTimeout(1800000)).toBe(1800000);
  });
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

  test("selectRunner routes container-mode groups to the container runner", async () => {
    const GroupQueue = await getGroupQueue();
    const runner = createMockRunner();
    const planner = createMockRunner();
    const container = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(
      runner as any,
      channelManager as any,
      planner as any,
      container as any
    );

    expect(queue.selectRunner({executionConfig: {mode: "container"}} as any)).toBe(
      container as any
    );
    expect(queue.selectRunner({executionConfig: {mode: "direct"}} as any)).toBe(runner as any);
    expect(queue.selectRunner({} as any)).toBe(runner as any);
    // Planning still wins for feature channels, whatever the execution mode.
    expect(
      queue.selectRunner({featurePhase: "planning", executionConfig: {mode: "container"}} as any)
    ).toBe(planner as any);
  });

  test("selectRunner falls back to the default runner when no container runner is wired", async () => {
    const GroupQueue = await getGroupQueue();
    const runner = createMockRunner();
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(runner as any, channelManager as any);

    expect(queue.selectRunner({executionConfig: {mode: "container"}} as any)).toBe(runner as any);
  });
});

describe("GroupQueue failed-run reporting", () => {
  const runCompletion = async (result: Record<string, unknown>) => {
    const mongoose = (await import("mongoose")).default;
    const {GroupQueue} = await import("./groupQueue");
    const channelManager = createMockChannelManager();
    const queue = new GroupQueue(createMockRunner() as any, channelManager as any);
    const reported: {context: string; error: unknown; extra?: Record<string, unknown>}[] = [];
    queue.setReportError((context, error, extra) => {
      reported.push({context, error, extra});
    });

    const groupId = new mongoose.Types.ObjectId();
    await (queue as any).handleAgentCompletion(
      {_id: groupId, name: "general", modelConfig: {}},
      groupId.toString(),
      {sessionId: "session-1"},
      new mongoose.Types.ObjectId(),
      {output: "", sessionId: "session-1", durationMs: 5, ...result},
      {content: "build a thing"},
      []
    );
    return {reported, channelManager};
  };

  test("reports a failed run to the error reporter and tells the channel", async () => {
    const {reported, channelManager} = await runCompletion({
      status: "failed",
      error: "There's an issue with the selected model",
    });

    expect(reported).toHaveLength(1);
    expect(reported[0].context).toContain("general");
    expect(String(reported[0].error)).toContain("issue with the selected model");
    expect(reported[0].extra).toMatchObject({group: "general", status: "failed"});
    const notices = channelManager.sendMessageToGroup.mock.calls.map((c: unknown[]) => c[1]);
    expect(notices.some((n) => String(n).includes("didn't finish"))).toBe(true);
  });

  test("does not report a completed run", async () => {
    const {reported} = await runCompletion({status: "completed", output: "done"});

    expect(reported).toHaveLength(0);
  });
});
