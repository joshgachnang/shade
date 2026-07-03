import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import {paths} from "./config";
import {Group} from "./models/group";
import type {DrainableWorker} from "./workerRuntime";
import {drainAndStop, IpcResultDeliverer, shouldRunTaskWorkerInGateway} from "./workerRuntime";

describe("shouldRunTaskWorkerInGateway", () => {
  test("defaults to true when taskWorker config is missing", () => {
    expect(shouldRunTaskWorkerInGateway({})).toBe(true);
    expect(shouldRunTaskWorkerInGateway({taskWorker: null})).toBe(true);
    expect(shouldRunTaskWorkerInGateway({taskWorker: {}})).toBe(true);
  });

  test("returns true when runInGateway is explicitly true", () => {
    expect(shouldRunTaskWorkerInGateway({taskWorker: {runInGateway: true}})).toBe(true);
  });

  test("returns false only when runInGateway is explicitly false", () => {
    expect(shouldRunTaskWorkerInGateway({taskWorker: {runInGateway: false}})).toBe(false);
  });
});

describe("drainAndStop", () => {
  const makeService = (waitForActiveRuns: () => Promise<void>): DrainableWorker => {
    return {
      activeCount: 1,
      waitForActiveRuns: mock(waitForActiveRuns),
      stop: mock(() => {}),
    };
  };

  test("returns true and stops the service when runs settle within the window", async () => {
    const service = makeService(() => Promise.resolve());
    const drained = await drainAndStop(service, 5000);
    expect(drained).toBe(true);
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  test("returns false and still stops (aborts) when runs outlive the window", async () => {
    // A run that never settles — the drain must give up at the timeout.
    const service = makeService(() => new Promise<void>(() => {}));
    const drained = await drainAndStop(service, 20);
    expect(drained).toBe(false);
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  test("stop() is called after waitForActiveRuns resolves, not before", async () => {
    const order: string[] = [];
    const service: DrainableWorker = {
      activeCount: 0,
      waitForActiveRuns: mock(async () => {
        order.push("wait");
      }),
      stop: mock(() => {
        order.push("stop");
      }),
    };
    await drainAndStop(service, 5000);
    expect(order).toEqual(["wait", "stop"]);
  });
});

describe("IpcResultDeliverer", () => {
  const tmpDir = path.join(process.cwd(), `tmp-test-worker-ipc-${Date.now()}`);
  const originalIpcPath = paths.ipc;
  const createdGroupIds: mongoose.Types.ObjectId[] = [];

  const makeGroup = async () => {
    const group = await Group.create({
      name: "Worker IPC Test Group",
      folder: `worker-ipc-test-${new mongoose.Types.ObjectId().toString()}`,
      channelId: new mongoose.Types.ObjectId(),
      externalId: `worker-ipc-test-${Date.now()}-${Math.random()}`,
    });
    createdGroupIds.push(group._id);
    return group;
  };

  const listIpcFiles = async (): Promise<string[]> => {
    const files = await fs.readdir(tmpDir);
    return files.filter((f) => f.endsWith(".json"));
  };

  beforeEach(async () => {
    await fs.mkdir(tmpDir, {recursive: true});
    paths.ipc = tmpDir;
  });

  afterEach(async () => {
    paths.ipc = originalIpcPath;
    await fs.rm(tmpDir, {recursive: true, force: true});
    if (createdGroupIds.length > 0) {
      await Group.deleteMany({_id: {$in: createdGroupIds}});
      createdGroupIds.length = 0;
    }
  });

  test("writes a send_message IPC file matching the MCP tool schema", async () => {
    const group = await makeGroup();
    const deliverer = new IpcResultDeliverer();

    await deliverer.sendMessageToGroup(group._id.toString(), "✅ Research: done");

    const files = await listIpcFiles();
    expect(files.length).toBe(1);

    const raw = await fs.readFile(path.join(tmpDir, files[0]), "utf-8");
    const data = JSON.parse(raw);
    expect(data).toEqual({
      type: "send_message",
      groupId: group._id.toString(),
      channelId: group.channelId.toString(),
      content: "✅ Research: done",
    });
  });

  test("does not write a file (and does not throw) when the group is missing", async () => {
    const deliverer = new IpcResultDeliverer();
    const missingId = new mongoose.Types.ObjectId().toString();

    await deliverer.sendMessageToGroup(missingId, "orphaned result");

    const files = await listIpcFiles();
    expect(files.length).toBe(0);
  });

  test("leaves no .tmp files behind (atomic write)", async () => {
    const group = await makeGroup();
    const deliverer = new IpcResultDeliverer();

    await deliverer.sendMessageToGroup(group._id.toString(), "first");
    await deliverer.sendMessageToGroup(group._id.toString(), "second");

    const files = await fs.readdir(tmpDir);
    expect(files.filter((f) => f.endsWith(".tmp")).length).toBe(0);
    expect(files.filter((f) => f.endsWith(".json")).length).toBe(2);
  });
});
