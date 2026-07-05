import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import {paths} from "../config";
import {Channel} from "../models/channel";
import {Group} from "../models/group";
import {ScheduledTask} from "../models/scheduledTask";
import {IpcWatcher} from "./ipc";
import {writeIpcFile} from "./ipcWriter";
import type {RichResponse} from "./responses/schema";

/**
 * Drives the gateway's IPC pipeline the way the harness does: write real
 * files with the shared writer, force a poll with tickNow(), and assert the
 * registered handlers fire (or are correctly denied by authorization).
 */

interface SentMessage {
  channelId: string;
  groupExternalId: string;
  content: string;
}

describe("IpcWatcher", () => {
  let ipcDir: string;
  const originalIpcDir = paths.ipc;
  let watcher: IpcWatcher;
  let sent: SentMessage[];
  let richSent: {groupId: string; payload: RichResponse}[];
  let reactions: {emoji: string; groupExternalId: string}[];
  let featureCalls: string[];
  let mainGroupId: string;
  let sideGroupId: string;
  const createdIds: mongoose.Types.ObjectId[] = [];

  beforeAll(async () => {
    ipcDir = await fs.mkdtemp(path.join(os.tmpdir(), "ipc-watcher-"));
    paths.ipc = ipcDir;

    const channel = await Channel.create({
      name: `ipc-test-${new mongoose.Types.ObjectId()}`,
      type: "test",
      status: "connected",
      config: {},
    });
    const mainGroup = await Group.create({
      name: `ipc-main-${channel._id}`,
      folder: `ipc-main-${channel._id}`,
      channelId: channel._id,
      externalId: "ipc-main-ext",
      isMain: true,
    });
    const sideGroup = await Group.create({
      name: `ipc-side-${channel._id}`,
      folder: `ipc-side-${channel._id}`,
      channelId: channel._id,
      externalId: "ipc-side-ext",
      isMain: false,
    });
    mainGroupId = mainGroup._id.toString();
    sideGroupId = sideGroup._id.toString();
    createdIds.push(channel._id, mainGroup._id, sideGroup._id);

    watcher = new IpcWatcher();
    watcher.setSendMessage(async (channelId, groupExternalId, content) => {
      sent.push({channelId, groupExternalId, content});
    });
    watcher.setSendRichMessage(async (groupId, payload) => {
      richSent.push({groupId, payload});
    });
    watcher.setAddReaction(async (_channelId, groupExternalId, _ts, emoji) => {
      reactions.push({emoji, groupExternalId});
    });
    watcher.setCreateFeature(async (data) => {
      featureCalls.push(data.name);
    });
  });

  beforeEach(() => {
    sent = [];
    richSent = [];
    reactions = [];
    featureCalls = [];
  });

  afterEach(async () => {
    for (const file of await fs.readdir(ipcDir)) {
      await fs.rm(path.join(ipcDir, file), {force: true});
    }
    await ScheduledTask.deleteMany({groupId: {$in: [mainGroupId, sideGroupId]}});
  });

  afterAll(async () => {
    paths.ipc = originalIpcDir;
    await fs.rm(ipcDir, {recursive: true, force: true});
    await Group.deleteMany({_id: {$in: createdIds}});
    await Channel.deleteMany({_id: {$in: createdIds}});
  });

  test("delivers send_message to the target group's external id and consumes the file", async () => {
    await writeIpcFile(paths.ipc, {
      type: "send_message",
      groupId: mainGroupId,
      channelId: "chan-1",
      content: "hello",
    });

    await watcher.tickNow();

    expect(sent).toEqual([
      {channelId: "chan-1", groupExternalId: "ipc-main-ext", content: "hello"},
    ]);
    expect((await fs.readdir(ipcDir)).filter((f) => f.endsWith(".json"))).toHaveLength(0);
  });

  test("main group may send cross-group; non-main group is denied", async () => {
    await writeIpcFile(paths.ipc, {
      type: "send_message",
      groupId: mainGroupId,
      channelId: "chan-1",
      content: "from main",
      targetGroupId: sideGroupId,
    });
    await writeIpcFile(paths.ipc, {
      type: "send_message",
      groupId: sideGroupId,
      channelId: "chan-1",
      content: "from side",
      targetGroupId: mainGroupId,
    });

    await watcher.tickNow();

    expect(sent).toEqual([
      {channelId: "chan-1", groupExternalId: "ipc-side-ext", content: "from main"},
    ]);
  });

  test("rich_response preempts a co-arriving send_message with the same agentRunId", async () => {
    const payload = {
      cards: [{kind: "text" as const, markdown: "card body"}],
      fallbackText: "fallback",
    };
    await writeIpcFile(paths.ipc, {
      type: "rich_response",
      groupId: mainGroupId,
      channelId: "chan-1",
      agentRunId: "run-1",
      payload,
    });
    await watcher.tickNow();

    await writeIpcFile(paths.ipc, {
      type: "send_message",
      groupId: mainGroupId,
      channelId: "chan-1",
      content: "duplicate of the card",
      agentRunId: "run-1",
    });
    await watcher.tickNow();

    expect(richSent).toHaveLength(1);
    expect(richSent[0].groupId).toBe(mainGroupId);
    expect(sent).toHaveLength(0);
  });

  test("create_task creates a ScheduledTask; task lifecycle actions update it", async () => {
    await writeIpcFile(paths.ipc, {
      type: "create_task",
      groupId: mainGroupId,
      data: {
        name: "ipc-created",
        prompt: "do things",
        scheduleType: "once",
        schedule: "2030-01-01T00:00:00Z",
        status: "active",
      },
    });
    await watcher.tickNow();

    const task = await ScheduledTask.findExactlyOne({name: "ipc-created"});
    expect(task.status).toBe("active");

    await writeIpcFile(paths.ipc, {
      type: "pause_task",
      groupId: mainGroupId,
      taskId: task._id.toString(),
    });
    await watcher.tickNow();
    expect((await ScheduledTask.findExactlyOne({_id: task._id})).status).toBe("paused");

    await writeIpcFile(paths.ipc, {
      type: "update_task",
      groupId: mainGroupId,
      taskId: task._id.toString(),
      data: {prompt: "do different things"},
    });
    await writeIpcFile(paths.ipc, {
      type: "resume_task",
      groupId: mainGroupId,
      taskId: task._id.toString(),
    });
    await watcher.tickNow();

    const updated = await ScheduledTask.findExactlyOne({_id: task._id});
    expect(updated.prompt).toBe("do different things");
    expect(updated.status).toBe("active");

    await writeIpcFile(paths.ipc, {
      type: "cancel_task",
      groupId: mainGroupId,
      taskId: task._id.toString(),
    });
    await watcher.tickNow();
    expect((await ScheduledTask.findExactlyOne({_id: task._id})).status).toBe("cancelled");
  });

  test("add_reaction resolves the group and forwards the emoji", async () => {
    await writeIpcFile(paths.ipc, {
      type: "add_reaction",
      groupId: mainGroupId,
      channelId: "chan-1",
      messageTs: "111.222",
      emoji: "tada",
    });
    await watcher.tickNow();

    expect(reactions).toEqual([{emoji: "tada", groupExternalId: "ipc-main-ext"}]);
  });

  test("create_feature requires the main group", async () => {
    await writeIpcFile(paths.ipc, {
      type: "create_feature",
      groupId: sideGroupId,
      channelId: "chan-1",
      name: "sneaky-feature",
      senderExternalId: "U1",
    });
    await writeIpcFile(paths.ipc, {
      type: "create_feature",
      groupId: mainGroupId,
      channelId: "chan-1",
      name: "allowed-feature",
      senderExternalId: "U1",
    });
    await watcher.tickNow();

    expect(featureCalls).toEqual(["allowed-feature"]);
  });

  test("unknown source group is denied entirely", async () => {
    await writeIpcFile(paths.ipc, {
      type: "send_message",
      groupId: new mongoose.Types.ObjectId().toString(),
      channelId: "chan-1",
      content: "orphaned",
    });
    await watcher.tickNow();

    expect(sent).toHaveLength(0);
    expect((await fs.readdir(ipcDir)).filter((f) => f.endsWith(".json"))).toHaveLength(0);
  });
});
