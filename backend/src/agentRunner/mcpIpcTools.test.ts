import {afterEach, beforeAll, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {buildTools, type McpContext} from "./mcpServer";

/**
 * The messaging/scheduling MCP tools — everything an agent turn uses to act on
 * the world — write IPC files consumed by the gateway's IpcWatcher. These
 * tests call the tool handlers directly and assert the exact payloads land on
 * disk, using the same seam the harness's MockAgentRunner scripts through.
 */

let ipcDir: string;

const makeContext = (overrides: Partial<McpContext> = {}): McpContext => ({
  groupId: "6543210987654321fedcba98",
  channelId: "6543210987654321fedcba99",
  ipcDir,
  groupFolder: "/tmp/mcp-ipc-tools-test",
  agentRunId: "run-abc",
  messageTs: "1234.5678",
  ...overrides,
});

const callTool = async (
  ctx: McpContext,
  name: string,
  args: Record<string, unknown>
): Promise<string> => {
  const tools = buildTools(ctx);
  const toolDef = tools.find((t) => t.name === name);
  if (!toolDef) {
    throw new Error(`Tool ${name} not registered`);
  }
  const handler = toolDef.handler as (
    a: unknown,
    e: unknown
  ) => Promise<{content: {text: string}[]}>;
  const result = await handler(args, {});
  return result.content[0].text;
};

const readIpcFiles = async (): Promise<Record<string, unknown>[]> => {
  const files = (await fs.readdir(ipcDir)).filter((f) => f.endsWith(".json"));
  return Promise.all(
    files.map(async (f) => JSON.parse(await fs.readFile(path.join(ipcDir, f), "utf-8")))
  );
};

describe("MCP IPC tools", () => {
  beforeAll(async () => {
    ipcDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ipc-tools-"));
  });

  afterEach(async () => {
    for (const file of await fs.readdir(ipcDir)) {
      await fs.rm(path.join(ipcDir, file), {force: true});
    }
  });

  test("send_message writes a send_message IPC file with the run id", async () => {
    const ctx = makeContext();
    const reply = await callTool(ctx, "send_message", {content: "hello world"});
    expect(reply).toContain("Message queued");

    const [payload] = await readIpcFiles();
    expect(payload).toMatchObject({
      type: "send_message",
      groupId: ctx.groupId,
      channelId: ctx.channelId,
      content: "hello world",
      agentRunId: "run-abc",
    });
  });

  test("send_message forwards targetGroupId for cross-group sends", async () => {
    await callTool(makeContext(), "send_message", {
      content: "cross-group",
      targetGroupId: "0000000000000000000000ff",
    });

    const [payload] = await readIpcFiles();
    expect(payload.targetGroupId).toBe("0000000000000000000000ff");
  });

  test("respond_with_card writes a rich_response file threaded to the triggering message", async () => {
    const ctx = makeContext();
    const reply = await callTool(ctx, "respond_with_card", {
      v: "1",
      fallbackText: "fallback",
      cards: [{kind: "text", markdown: "Hi there"}],
    });
    expect(reply).toContain("Rich response queued");

    const [payload] = await readIpcFiles();
    expect(payload.type).toBe("rich_response");
    expect(payload.threadTs).toBe("1234.5678");
    expect((payload.payload as {fallbackText: string}).fallbackText).toBe("fallback");
  });

  test("respond_with_card rejects invalid payloads without writing a file", async () => {
    const reply = await callTool(makeContext(), "respond_with_card", {
      v: "1",
      fallbackText: "fallback",
      cards: [{kind: "not-a-real-card-kind"}],
    });
    expect(reply).toContain("validation failed");
    expect(await readIpcFiles()).toHaveLength(0);
  });

  test("add_reaction defaults to the triggering message's ts", async () => {
    await callTool(makeContext(), "add_reaction", {emoji: "eyes"});

    const [payload] = await readIpcFiles();
    expect(payload).toMatchObject({type: "add_reaction", emoji: "eyes", messageTs: "1234.5678"});
  });

  test("add_reaction errors when no ts is available", async () => {
    const reply = await callTool(makeContext({messageTs: undefined}), "add_reaction", {
      emoji: "eyes",
    });
    expect(reply).toContain("No message timestamp");
    expect(await readIpcFiles()).toHaveLength(0);
  });

  test("schedule_task writes a create_task file with an active schedule", async () => {
    // classification is passed explicitly: the SDK applies zod defaults before
    // invoking handlers, but these tests call the handlers directly.
    await callTool(makeContext(), "schedule_task", {
      name: "nightly",
      prompt: "do nightly things",
      scheduleType: "cron",
      schedule: "0 3 * * *",
      classification: "internal",
    });

    const [payload] = await readIpcFiles();
    expect(payload.type).toBe("create_task");
    expect(payload.data).toMatchObject({
      name: "nightly",
      scheduleType: "cron",
      schedule: "0 3 * * *",
      status: "active",
      classification: "internal",
    });
  });
});
