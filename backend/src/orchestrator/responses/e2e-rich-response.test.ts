import {afterEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {AppConfig, reloadAppConfig} from "../../models/appConfig";
import {Channel} from "../../models/channel";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import {ChannelManager} from "../channels/manager";
import type {
  ChannelConnector,
  ConnectorFactory,
  InboundMessage,
  RichSendOpts,
} from "../channels/types";
import type {RichResponse} from "./schema";
import {SCHEMA_VERSION} from "./schema";

/**
 * Fake connector that records its calls without doing any network I/O.
 * Used by both the happy-path test (Slack-like, supportsRichMessages = true)
 * and the flag-off test (asserts the fallback path).
 */
class FakeSlackConnector implements ChannelConnector {
  readonly channelDoc: import("../../types").ChannelDocument;
  readonly supportsRichMessages = true;
  sendMessageCalls: Array<{externalId: string; content: string}> = [];
  sendRichMessageCalls: Array<{externalId: string; rendered: unknown; opts: RichSendOpts}> = [];

  constructor(channelDoc: import("../../types").ChannelDocument) {
    this.channelDoc = channelDoc;
  }
  async connect() {}
  async disconnect() {}
  isConnected() {
    return true;
  }
  async sendMessage(externalId: string, content: string) {
    this.sendMessageCalls.push({externalId, content});
  }
  async sendMessageWithTs(externalId: string, content: string) {
    this.sendMessageCalls.push({externalId, content});
    return "fake-ts";
  }
  async updateMessage() {}
  async addReaction() {}
  async removeReaction() {}
  async sendRichMessage(externalId: string, rendered: unknown, opts: RichSendOpts) {
    this.sendRichMessageCalls.push({externalId, rendered, opts});
  }
  async createChannel() {
    return {id: "fake-channel"};
  }
  async inviteToChannel() {}
  onMessage(_handler: (m: InboundMessage) => Promise<void>) {}
}

const setup = async (richEnabled: boolean) => {
  // Start from a clean slate: leftover channels/groups from other test files
  // would be connected by manager.initialize() and greeted via the fake
  // connector, polluting sendMessageCalls.
  await Promise.all([Channel.deleteMany({}), Group.deleteMany({}), Message.deleteMany({})]);
  await AppConfig.deleteMany({});
  await AppConfig.create({richResponses: {enabled: richEnabled, autoTruncate: true}});
  await reloadAppConfig();

  const suffix = new mongoose.Types.ObjectId().toString();
  const channel = await Channel.create({
    name: `slack-${suffix}`,
    type: "slack",
    status: "connected",
    privileged: false,
    config: {},
  });
  const group = await Group.create({
    name: `g-${suffix}`,
    externalId: `ext-${suffix}`,
    channelId: channel._id,
    isMain: false,
    folder: `f-${suffix}`,
    modelConfig: {defaultBackend: "claude"},
  });

  const fake = new FakeSlackConnector(channel);
  const factory: ConnectorFactory = () => fake;
  const manager = new ChannelManager({
    slack: factory,
    webhook: factory,
    imessage: factory,
    email: factory,
  });
  await manager.initialize();
  // ensure the group is in the cache (initialize loads channels but our test
  // created the channel + group; initialize() should pick it up)
  manager.registerGroup(group);
  return {manager, fake, group, channel};
};

const sampleRichResponse = (): RichResponse => ({
  v: SCHEMA_VERSION,
  fallbackText: "Delete branch feature/x? Reply yes or no.",
  cards: [
    {
      kind: "yes_no",
      question: "Delete branch feature/x?",
      actionId: "delete_branch",
      yesLabel: "Yes",
      noLabel: "No",
    },
  ],
});

afterEach(async () => {
  await Promise.all([
    Message.deleteMany({}),
    Group.deleteMany({}),
    Channel.deleteMany({}),
    AppConfig.deleteMany({}),
  ]);
  await reloadAppConfig();
});

describe("ChannelManager.sendRichMessageToGroup — happy path (flag on)", () => {
  test("calls connector.sendRichMessage with rendered blocks + persists Message with richPayload", async () => {
    const {manager, fake, group} = await setup(true);
    const payload = sampleRichResponse();

    await manager.sendRichMessageToGroup(group._id.toString(), payload, {threadTs: "1234.5678"});

    expect(fake.sendRichMessageCalls).toHaveLength(1);
    expect(fake.sendMessageCalls).toHaveLength(0);

    const call = fake.sendRichMessageCalls[0];
    expect(call.externalId).toBe(group.externalId);
    expect(call.opts.groupId).toBe(group._id.toString());
    expect(call.opts.correlationId.length).toBe(12);
    expect(call.opts.threadTs).toBe("1234.5678");
    const rendered = call.rendered as {blocks: unknown[]; text: string};
    expect(rendered.blocks.length).toBeGreaterThan(0);
    expect(rendered.text).toBe(payload.fallbackText);

    const msg = await Message.findOne({groupId: group._id, isFromBot: true});
    expect(msg).not.toBeNull();
    expect(msg?.richPayload?.fallbackText).toBe(payload.fallbackText);
    expect(msg?.correlationId).toBe(call.opts.correlationId);
    expect(msg?.content).toBe(payload.fallbackText);
  });
});

describe("ChannelManager.sendRichMessageToGroup — flag off", () => {
  test("falls back to sendMessage(fallbackText) but still persists richPayload", async () => {
    const {manager, fake, group} = await setup(false);
    const payload = sampleRichResponse();

    await manager.sendRichMessageToGroup(group._id.toString(), payload);

    expect(fake.sendRichMessageCalls).toHaveLength(0);
    expect(fake.sendMessageCalls).toHaveLength(1);
    expect(fake.sendMessageCalls[0].content).toBe(payload.fallbackText);

    const msg = await Message.findOne({groupId: group._id, isFromBot: true});
    expect(msg).not.toBeNull();
    // richPayload is still persisted for audit even when the flag is off
    expect(msg?.richPayload?.fallbackText).toBe(payload.fallbackText);
  });
});

describe("ChannelManager.sendRichMessageToGroup — privileged channel guard", () => {
  test("blocks rich send to privileged channel with Claude-backed group", async () => {
    await AppConfig.deleteMany({});
    await AppConfig.create({richResponses: {enabled: true, autoTruncate: true}});
    await reloadAppConfig();

    const suffix = new mongoose.Types.ObjectId().toString();
    const channel = await Channel.create({
      name: `im-${suffix}`,
      type: "imessage",
      status: "connected",
      privileged: true,
      config: {},
    });
    const group = await Group.create({
      name: `g-${suffix}`,
      externalId: `ext-${suffix}`,
      channelId: channel._id,
      isMain: false,
      folder: `f-${suffix}`,
      modelConfig: {defaultBackend: "claude"},
    });

    const fake = new FakeSlackConnector(channel);
    const factory: ConnectorFactory = () => fake;
    const manager = new ChannelManager({
      slack: factory,
      webhook: factory,
      imessage: factory,
      email: factory,
    });
    await manager.initialize();
    manager.registerGroup(group);

    await manager.sendRichMessageToGroup(group._id.toString(), sampleRichResponse());

    expect(fake.sendRichMessageCalls).toHaveLength(0);
    expect(fake.sendMessageCalls).toHaveLength(0);

    const msg = await Message.findOne({groupId: group._id, isFromBot: true});
    expect(msg).toBeNull(); // blocked before persistence
  });
});
