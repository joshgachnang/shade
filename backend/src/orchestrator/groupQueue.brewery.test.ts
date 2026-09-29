import {expect, mock, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {Types} from "mongoose";
import {loadAppConfig} from "../models/appConfig";
import {Feature} from "../models/feature";
import {Group} from "../models/group";
import {Message} from "../models/message";
import type {ChannelManager} from "./channels/manager";
import {GroupQueue} from "./groupQueue";
import type {AgentRunner} from "./runners/types";

const fixture = () => {
  const run = mock(async () => {
    throw new Error("Agent runner must not run");
  });
  const runner: AgentRunner = {
    run,
    stop: async () => {},
    isRunning: () => false,
    sendFollowUp: async () => {},
  };
  const sendMessage = mock(async (_channel: string, _target: string, _text: string) => {});
  const manager = {sendMessage} as unknown as ChannelManager;
  const queue = new GroupQueue(runner, manager, runner, runner);
  const group = new Group({
    name: "brewery-routing-test",
    channelId: new Types.ObjectId(),
    externalId: "test-channel",
    featureDriver: "brewery",
    featurePhase: "planning",
    executionConfig: {mode: "container"},
  });
  const message = (content: string, isFromBot = false) =>
    new Message({groupId: group._id, channelId: group.channelId, content, isFromBot});
  return {queue, group, message, run, sendMessage};
};

const drain = async (queue: GroupQueue, id: string) => {
  const deadline = Date.now() + 3000;
  while (queue.isGroupActive(id) || queue.getQueueDepth(id)) {
    if (Date.now() > deadline) throw new Error("Queue did not drain");
    await Bun.sleep(5);
  }
};

test("brewery runner selection fails closed even with planner and container runners", () => {
  const {queue, group, run} = fixture();
  expect(() => queue.selectRunner(group)).toThrow("brewery");
  expect(run).not.toHaveBeenCalled();
});

test("seeded request and replies reach the real brewery driver without agent execution", async () => {
  const {queue, group, message, run, sendMessage} = fixture();
  queue.enqueue(group, message("Build the requested feature", true));
  queue.enqueue(group, message("/implement"));
  queue.enqueue(group, message(""));
  queue.enqueue(group, message("now: "));
  await drain(queue, String(group._id));
  expect(sendMessage.mock.calls.map((call) => call[2])).toEqual([
    "No brewery run exists for this feature channel. Start a feature first.",
    "No brewery run exists for this feature channel. Start a feature first.",
    "Send a reply, a note, `now: <text>`, `stop`, or `resume`.",
    "Add a note after `now:` before interrupting brewery.",
  ]);
  expect(sendMessage.mock.calls[0]?.slice(0, 2)).toEqual([
    String(group.channelId),
    group.externalId,
  ]);
  expect(group.featurePhase).toBe("planning");
  expect(queue.getActiveAgentCount()).toBe(0);
  expect(run).not.toHaveBeenCalled();
});

test("brewery delivery failure releases the queue without retrying through an agent", async () => {
  const {queue, group, message, run, sendMessage} = fixture();
  const report = mock(() => {});
  queue.setReportError(report);
  sendMessage.mockImplementationOnce(async () => {
    throw new Error("transport unavailable");
  });
  queue.enqueue(group, message(""));
  queue.enqueue(group, message("now:"));
  await drain(queue, String(group._id));
  expect(report).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(sendMessage.mock.calls[1]?.[2]).toContain("Add a note");
  expect(queue.getActiveAgentCount()).toBe(0);
  expect(run).not.toHaveBeenCalled();
});

test("seed and ordered replies execute brewery notes in the saved workspace", async () => {
  const {queue, group, message, run, sendMessage} = fixture();
  const config = await loadAppConfig();
  const originalCommand = config.brewery.command;
  const dir = await fs.mkdtemp(path.join(process.cwd(), ".queue-brewery-"));
  const feature = await Feature.create({
    name: "Queue routing",
    groupId: group._id,
    status: "in_progress",
    brewery: {
      slug: "queue-test",
      repo: "shade",
      workspace: {kind: "local", repoPath: dir},
      phase: "build",
      eventsOffset: 0,
      stepMessages: [],
    },
  });
  try {
    const command = path.join(dir, "fake-brewery.cjs");
    await fs.writeFile(
      command,
      `#!${process.execPath}\nrequire("node:fs").appendFileSync("calls.jsonl", JSON.stringify(process.argv.slice(2))+"\\n");`,
      {mode: 0o700}
    );
    config.brewery.command = command;
    await config.save();
    for (const [index, content] of ["Seed request", "  café 'quoted'  ", "/implement"].entries()) {
      queue.enqueue(group, message(content, index === 0));
    }
    expect(queue.isGroupActive(String(group._id))).toBe(true);
    expect(queue.getActiveAgentCount()).toBe(0);
    await drain(queue, String(group._id));
    const calls = (await fs.readFile(path.join(dir, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls).toEqual([
      ["note", "queue-test", "Seed request", "--repo", dir],
      ["note", "queue-test", "  café 'quoted'  ", "--repo", dir],
      ["note", "queue-test", "/implement", "--repo", dir],
    ]);
    expect(sendMessage.mock.calls.map((call) => call[2])).toEqual(
      Array(3).fill("Queued for the next check-in (current: build)")
    );
    expect(group.featurePhase).toBe("planning");
    expect(run).not.toHaveBeenCalled();
  } finally {
    config.brewery.command = originalCommand;
    await config.save();
    await feature.deleteOne();
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test("handled brewery messages are marked processed so polling cannot replay replies", async () => {
  const {queue, group, message, run} = fixture();
  const reply = message("now:");
  reply.sender = "test-sender";
  await reply.save();
  try {
    queue.enqueue(group, reply);
    await drain(queue, String(group._id));
    expect((await Message.findById(reply._id))?.processedAt).toBeInstanceOf(Date);
    expect(run).not.toHaveBeenCalled();
  } finally {
    await reply.deleteOne();
  }
});

test("a reply deferred by the poller lease stays pending and is handled on the next message poll", async () => {
  const {MessageLoop} = await import("./messageLoop");
  const {queue, group, message, run, sendMessage} = fixture();
  group.requiresTrigger = false;
  const reply = message("ok");
  reply.sender = "test-sender";
  await reply.save();
  const feature = await Feature.create({
    name: "Lease race",
    groupId: group._id,
    status: "awaiting_approval",
    brewery: {
      slug: "lease-race",
      repo: "shade",
      workspace: {kind: "local", repoPath: "/unused"},
      waiting: {kind: "signoff", since: new Date()},
      pollLeaseUntil: new Date(Date.now() + 60000),
    },
  });
  const loop = new MessageLoop({getAllGroups: () => [group]} as unknown as ChannelManager, queue);
  try {
    await loop.tickNow();
    await drain(queue, String(group._id));
    expect((await Message.findById(reply._id))?.processedAt).toBeUndefined();
    expect((await Feature.findById(feature._id))?.status).toBe("awaiting_approval");
    expect(sendMessage.mock.calls[0]?.[2]).toContain("Brewery is processing an update");
    // The poller's final snapshot becomes visible before it releases the lease.
    // A completed run gives a safe observable response without launching a CLI.
    await Feature.updateOne(
      {_id: feature._id},
      {
        $set: {status: "complete"},
        $unset: {"brewery.pollLeaseUntil": 1},
      }
    );
    await loop.tickNow();
    await drain(queue, String(group._id));
    expect((await Message.findById(reply._id))?.processedAt).toBeInstanceOf(Date);
    expect(sendMessage.mock.calls.at(-1)?.[2]).toBe(
      "This brewery run is complete. Start a new feature for more work."
    );
    await loop.tickNow();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  } finally {
    await reply.deleteOne();
    await feature.deleteOne();
  }
});
