import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {paths} from "../../config";
import {AgentTask} from "../../models/agentTask";
import {loadAppConfig} from "../../models/appConfig";
import {LlmFixture} from "../../models/llmFixture";
import {MockAgentRunner} from "./mock";
import type {AgentRunConfig} from "./types";

const GROUP_ID = "6543210987654321fedcba98";

const makeConfig = (prompt: string, overrides: Partial<AgentRunConfig> = {}): AgentRunConfig => ({
  groupId: GROUP_ID,
  groupFolder: "/tmp/mock-runner-test",
  sessionId: `mock-session-${Math.random().toString(36).slice(2)}`,
  prompt,
  modelBackend: "mock",
  timeout: 5000,
  idleTimeout: 5000,
  env: {SHADE_CHANNEL_ID: "test-channel-id"},
  ...overrides,
});

describe("MockAgentRunner", () => {
  const runner = new MockAgentRunner();
  let ipcDir: string;
  const originalIpcDir = paths.ipc;

  beforeAll(async () => {
    await loadAppConfig();
    ipcDir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-runner-ipc-"));
    paths.ipc = ipcDir;
  });

  afterEach(async () => {
    await LlmFixture.deleteMany({});
    await AgentTask.deleteMany({});
    for (const file of await fs.readdir(ipcDir)) {
      await fs.rm(path.join(ipcDir, file), {force: true});
    }
  });

  afterAll(async () => {
    paths.ipc = originalIpcDir;
    await fs.rm(ipcDir, {recursive: true, force: true});
  });

  test("echoes the prompt when no fixture matches", async () => {
    const result = await runner.run(makeConfig("nothing scripted here"));
    expect(result.status).toBe("completed");
    expect(result.output).toContain("[mock] received:");
    expect(result.output).toContain("nothing scripted here");
    expect(result.costUsd).toBe(0);
  });

  test("highest-priority matching fixture wins", async () => {
    await LlmFixture.create({
      name: "generic",
      match: {pattern: ".*"},
      response: "generic",
      priority: 1,
    });
    await LlmFixture.create({
      name: "specific",
      match: {pattern: "the answer"},
      response: "specific",
      priority: 10,
    });

    const result = await runner.run(makeConfig("what is the answer?"));
    expect(result.output).toBe("specific");
  });

  test("groupId-scoped fixtures only match their group", async () => {
    await LlmFixture.create({
      name: "other-group",
      match: {groupId: "0000000000000000000000ff"},
      response: "wrong group",
      priority: 10,
    });

    const result = await runner.run(makeConfig("hello"));
    expect(result.output).toContain("[mock] received:");
  });

  test("consumeOnce fixtures fire exactly once under concurrency", async () => {
    await LlmFixture.create({
      name: "one-shot",
      match: {pattern: "one-shot"},
      response: "claimed!",
      consumeOnce: true,
      priority: 5,
    });

    const [a, b] = await Promise.all([
      runner.run(makeConfig("trigger the one-shot now")),
      runner.run(makeConfig("trigger the one-shot now")),
    ]);

    const outputs = [a.output, b.output];
    expect(outputs.filter((o) => o === "claimed!")).toHaveLength(1);
    expect(outputs.filter((o) => o.includes("[mock] received:"))).toHaveLength(1);
  });

  test("skips fixtures whose stored pattern no longer compiles", async () => {
    // Bypass save-time validation to simulate a corrupt pattern in the DB.
    await LlmFixture.collection.insertOne({
      name: "corrupt",
      match: {pattern: "("},
      response: "should never fire",
      actions: [],
      delayMs: 0,
      priority: 100,
      consumeOnce: false,
      deleted: false,
      created: new Date(),
      updated: new Date(),
    });
    await LlmFixture.create({
      name: "valid",
      match: {pattern: "hello"},
      response: "valid",
      priority: 1,
    });

    const result = await runner.run(makeConfig("hello there"));
    expect(result.output).toBe("valid");
  });

  test("executes send_message and schedule_task actions through real IPC files", async () => {
    await LlmFixture.create({
      name: "actions",
      match: {pattern: "do things"},
      response: "done",
      actions: [
        {tool: "send_message", args: {content: "scripted side effect"}},
        {
          tool: "schedule_task",
          args: {
            name: "later",
            prompt: "later work",
            scheduleType: "once",
            schedule: "2030-01-01T00:00:00Z",
          },
        },
      ],
    });

    const result = await runner.run(makeConfig("please do things"));
    expect(result.output).toBe("done");

    const files = (await fs.readdir(ipcDir)).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(2);

    const payloads = await Promise.all(
      files.map(async (f) => JSON.parse(await fs.readFile(path.join(ipcDir, f), "utf-8")))
    );
    const types = payloads.map((p) => p.type).sort();
    expect(types).toEqual(["create_task", "send_message"]);

    const send = payloads.find((p) => p.type === "send_message");
    expect(send.content).toBe("scripted side effect");
    expect(send.groupId).toBe(GROUP_ID);
    expect(send.channelId).toBe("test-channel-id");
  });

  test("create_task actions insert a board task directly", async () => {
    await LlmFixture.create({
      name: "board",
      match: {pattern: "delegate"},
      response: "delegated",
      actions: [{tool: "create_task", args: {title: "bg work", prompt: "do it in the background"}}],
    });

    await runner.run(makeConfig("delegate this"));

    const task = await AgentTask.findExactlyOne({title: "bg work"});
    expect(task.status).toBe("pending");
    expect(task.deliverResult).toBe(true);
  });
});
