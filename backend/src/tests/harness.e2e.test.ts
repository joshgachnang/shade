import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import type {Server} from "node:http";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import {AgentTask} from "../models/agentTask";
import {reloadAppConfig} from "../models/appConfig";
import {Group} from "../models/group";
import {LlmFixture} from "../models/llmFixture";
import {ScheduledTask} from "../models/scheduledTask";
import {TaskRunLog} from "../models/taskRunLog";
import {startOrchestrator, stopOrchestrator} from "../orchestrator";
import {start} from "../server";
import {TEST_GROUP_NAME} from "../testMode/constants";
import {
  ADMIN_EMAIL,
  getOutbox,
  loginAsUser,
  resetHarness,
  sendCommand,
  tickHarness,
  waitFor,
} from "./testHelper";

/**
 * IP-012 harness self-test: drives the full loop strictly over HTTP —
 * program a fixture, send a command, observe the outbox, tick the loops,
 * reset. This is the test that proves an AI can use the harness.
 */
describe("AI testability harness (e2e over HTTP)", () => {
  const originalTestMode = process.env.SHADE_TEST_MODE;
  const originalDataDir = process.env.SHADE_DATA_DIR;
  let dataDir: string;
  let server: Server;
  let baseUrl: string;
  let token: string;
  let groupId: string;

  beforeAll(async () => {
    process.env.SHADE_TEST_MODE = "1";
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "shade-harness-"));
    process.env.SHADE_DATA_DIR = dataDir;

    // Fresh database so the boot seed builds the harness world from scratch.
    const collections = Object.values(mongoose.connection.collections);
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
    await reloadAppConfig();

    const app = await start(true /* skipListen */);
    server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to get server address");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;

    await startOrchestrator(app);

    token = await loginAsUser(baseUrl, ADMIN_EMAIL);
    const group = await Group.findExactlyOne({name: TEST_GROUP_NAME});
    groupId = group._id.toString();
  }, 30000);

  afterAll(async () => {
    await stopOrchestrator();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (originalTestMode === undefined) {
      delete process.env.SHADE_TEST_MODE;
    } else {
      process.env.SHADE_TEST_MODE = originalTestMode;
    }
    if (originalDataDir === undefined) {
      delete process.env.SHADE_DATA_DIR;
    } else {
      process.env.SHADE_DATA_DIR = originalDataDir;
    }
    await fs.rm(dataDir, {recursive: true, force: true});

    // Leave a clean slate for whatever test file runs next.
    const collections = Object.values(mongoose.connection.collections);
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
    await reloadAppConfig();
  });

  test("fixture-scripted command: reply lands in outbox, action creates a ScheduledTask", async () => {
    const fixtureRes = await fetch(`${baseUrl}/test/llm-fixtures`, {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
      body: JSON.stringify({
        name: "meaning-of-life",
        match: {pattern: "meaning of life"},
        response: "The answer is 42.",
        actions: [
          {
            tool: "schedule_task",
            args: {
              name: "e2e-scheduled",
              prompt: "follow up later",
              scheduleType: "once",
              schedule: "2030-01-01T00:00:00Z",
            },
          },
        ],
        priority: 10,
      }),
    });
    expect(fixtureRes.status).toBe(201);

    await sendCommand(baseUrl, token, "What is the meaning of life?", {groupId});
    await tickHarness(baseUrl, token, "messageLoop");

    await waitFor(async () => {
      const outbox = await getOutbox(baseUrl, token, {groupId});
      return outbox.some((m) => m.content.includes("The answer is 42."));
    });

    // The scripted schedule_task action went through a real IPC file →
    // IpcWatcher → ScheduledTask.
    await tickHarness(baseUrl, token, "ipc");
    await waitFor(async () => (await ScheduledTask.countDocuments({name: "e2e-scheduled"})) === 1);

    // Audit parity: the run is logged with the mock backend at zero cost.
    await waitFor(async () => {
      const log = await TaskRunLog.findOneOrNone({groupId, status: "completed"});
      return log?.modelBackend === "mock";
    });
  }, 20000);

  test("unscripted command falls back to echo", async () => {
    // Fixture patterns match against the full prompt — which includes recent
    // conversation history — so test 1's fixture would keep winning here.
    // Retire it the way a harness user would between scenarios.
    await LlmFixture.updateMany({}, {$set: {deleted: true}});

    await sendCommand(baseUrl, token, "nobody scripted this exact sentence", {groupId});
    await tickHarness(baseUrl, token, "messageLoop");

    await waitFor(async () => {
      const outbox = await getOutbox(baseUrl, token, {groupId});
      return outbox.some(
        (m) => m.content.includes("[mock] received") || m.content.includes("nobody scripted")
      );
    });
  }, 20000);

  test("board task completes via taskWorker tick and delivers its result", async () => {
    await AgentTask.create({
      groupId,
      title: "board-e2e",
      prompt: "background board work",
      deliverResult: true,
    });

    await tickHarness(baseUrl, token, "taskWorker");

    await waitFor(async () => {
      const task = await AgentTask.findOneOrNone({title: "board-e2e"});
      return task?.status === "completed";
    });

    await waitFor(async () => {
      const outbox = await getOutbox(baseUrl, token, {groupId});
      return outbox.some((m) => m.content.includes("board-e2e"));
    });
  }, 20000);

  test("due scheduled task runs after a scheduler tick", async () => {
    await ScheduledTask.create({
      groupId,
      name: "due-now",
      prompt: "run immediately",
      scheduleType: "once",
      schedule: new Date(Date.now() - 1000).toISOString(),
      nextRunAt: new Date(Date.now() - 1000),
      status: "active",
    });

    await tickHarness(baseUrl, token, "scheduler");

    await waitFor(async () => {
      const scheduledTask = await ScheduledTask.findOneOrNone({name: "due-now"});
      return Boolean(scheduledTask?.lastRunAt) || scheduledTask?.status === "completed";
    });
  }, 20000);

  test("/test/state reports loop counts", async () => {
    const res = await fetch(`${baseUrl}/test/state`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    expect(res.status).toBe(200);
    const {data} = (await res.json()) as {data: Record<string, number>};

    for (const key of [
      "pendingMessages",
      "activeAgentRuns",
      "activeBoardRuns",
      "pendingAgentTasks",
      "runningAgentTasks",
      "dueScheduledTasks",
    ]) {
      expect(typeof data[key]).toBe("number");
    }
  });

  test("control API validates input: bad tick target and bad since are 400s", async () => {
    const tickRes = await fetch(`${baseUrl}/test/tick`, {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
      body: JSON.stringify({target: "warp-drive"}),
    });
    expect(tickRes.status).toBe(400);

    const outboxRes = await fetch(`${baseUrl}/test/outbox?since=not-a-date`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    expect(outboxRes.status).toBe(400);
  });

  test("DELETE /test/llm-fixtures/:id retires a fixture from the active list", async () => {
    const createRes = await fetch(`${baseUrl}/test/llm-fixtures`, {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
      body: JSON.stringify({name: "to-delete", match: {pattern: "never"}, response: "x"}),
    });
    const created = ((await createRes.json()) as {data: {id: string}}).data;

    const deleteRes = await fetch(`${baseUrl}/test/llm-fixtures/${created.id}`, {
      method: "DELETE",
      headers: {Authorization: `Bearer ${token}`},
    });
    expect(deleteRes.status).toBe(204);

    const listRes = await fetch(`${baseUrl}/test/llm-fixtures`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    const fixtures = ((await listRes.json()) as {data: {name: string}[]}).data;
    expect(fixtures.some((f) => f.name === "to-delete")).toBe(false);
  });

  test("/test/reset wipes to a freshly-seeded world", async () => {
    const seeded = await resetHarness(baseUrl, token);
    expect(seeded.groupId).toBeTruthy();

    const outbox = await getOutbox(baseUrl, token, {});
    expect(outbox).toHaveLength(0);
    expect(await LlmFixture.countDocuments({})).toBe(0);
    expect(await Group.countDocuments({name: TEST_GROUP_NAME})).toBe(1);

    // Identity survives the reset — the same token still works.
    const res = await fetch(`${baseUrl}/test/state`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    expect(res.status).toBe(200);

    // And the re-seeded group is live: a command round-trips end to end.
    const group = await Group.findExactlyOne({name: TEST_GROUP_NAME});
    await sendCommand(baseUrl, token, "post-reset ping", {groupId: group._id.toString()});
    await tickHarness(baseUrl, token, "messageLoop");
    await waitFor(async () => {
      const messages = await getOutbox(baseUrl, token, {groupId: group._id.toString()});
      return messages.some((m) => m.content.includes("post-reset ping"));
    });
  }, 20000);

  test("harness routes are absent when SHADE_TEST_MODE is unset", async () => {
    delete process.env.SHADE_TEST_MODE;
    try {
      const plainApp = await start(true /* skipListen */);
      const plainServer = plainApp.listen(0);
      const addr = plainServer.address();
      if (!addr || typeof addr === "string") {
        throw new Error("Failed to get server address");
      }
      const res = await fetch(`http://127.0.0.1:${addr.port}/test/state`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      expect(res.status).toBe(404);
      await new Promise<void>((resolve) => plainServer.close(() => resolve()));
    } finally {
      process.env.SHADE_TEST_MODE = "1";
    }
  }, 20000);
});
