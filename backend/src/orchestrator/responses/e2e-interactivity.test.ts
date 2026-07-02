import {afterEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {AppConfig, reloadAppConfig} from "../../models/appConfig";
import {Channel} from "../../models/channel";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import {ChannelManager} from "../channels/manager";
import type {ChannelConnector, ConnectorFactory, InboundMessage} from "../channels/types";
import {formatMessagesAsXml} from "../router";

/**
 * Fake connector — captures inbound messages dispatched via onMessage().
 * For the interactivity test we manually invoke the handler to simulate a
 * Slack action payload arriving over Socket Mode.
 */
class FakeConnector implements ChannelConnector {
  readonly channelDoc: import("../../types").ChannelDocument;
  readonly supportsRichMessages = true;
  private handler: ((m: InboundMessage) => Promise<void>) | null = null;

  constructor(channelDoc: import("../../types").ChannelDocument) {
    this.channelDoc = channelDoc;
  }
  async connect() {}
  async disconnect() {}
  isConnected() {
    return true;
  }
  async sendMessage() {}
  async sendMessageWithTs() {
    return "ts";
  }
  async updateMessage() {}
  async addReaction() {}
  async removeReaction() {}
  async createChannel() {
    return {id: "c"};
  }
  async inviteToChannel() {}
  onMessage(handler: (m: InboundMessage) => Promise<void>) {
    this.handler = handler;
  }
  async simulateInbound(m: InboundMessage) {
    if (this.handler) await this.handler(m);
  }
}

const setupManager = async () => {
  await AppConfig.deleteMany({});
  await AppConfig.create({richResponses: {enabled: true, autoTruncate: true}});
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

  const fake = new FakeConnector(channel);
  const factory: ConnectorFactory = () => fake;
  const manager = new ChannelManager({
    slack: factory,
    webhook: factory,
    imessage: factory,
    email: factory,
  });
  await manager.initialize();
  manager.registerGroup(group);
  return {manager, fake, group, channel};
};

afterEach(async () => {
  await Promise.all([
    Message.deleteMany({}),
    Group.deleteMany({}),
    Channel.deleteMany({}),
    AppConfig.deleteMany({}),
  ]);
  await reloadAppConfig();
});

describe("Phase 3 interactivity — synthetic inbound action message", () => {
  test("inbound with metadata.action persists parentCorrelationId + actionMetadata", async () => {
    const {fake, group} = await setupManager();

    await fake.simulateInbound({
      externalId: "1234.5678:action:confirm",
      sender: "U123",
      senderExternalId: "U123",
      content: "[user_action confirm=yes]",
      groupExternalId: group.externalId,
      metadata: {
        ts: "1234.5678",
        threadTs: "1234.5678",
        action: {actionId: "confirm", value: "yes", parentCorrelationId: "parent-abc"},
      },
    });

    const msg = await Message.findOne({groupId: group._id, isFromBot: false});
    expect(msg).not.toBeNull();
    expect(msg?.isFromBot).toBe(false);
    expect(msg?.parentCorrelationId).toBe("parent-abc");
    expect(msg?.actionMetadata?.actionId).toBe("confirm");
    expect(msg?.actionMetadata?.value).toBe("yes");
  });

  test("non-action inbound does NOT populate the action fields", async () => {
    const {fake, group} = await setupManager();

    await fake.simulateInbound({
      externalId: "9999.1",
      sender: "U999",
      senderExternalId: "U999",
      content: "hello",
      groupExternalId: group.externalId,
      metadata: {ts: "9999.1"},
    });

    const msg = await Message.findOne({groupId: group._id});
    expect(msg).not.toBeNull();
    expect(msg?.actionMetadata).toBeUndefined();
    expect(msg?.parentCorrelationId).toBeUndefined();
  });
});

describe("Phase 3 interactivity — router XML formatter", () => {
  test("renders <user_action> for action-driven messages", () => {
    const fakeMsg = {
      _id: new mongoose.Types.ObjectId(),
      groupId: new mongoose.Types.ObjectId(),
      channelId: new mongoose.Types.ObjectId(),
      sender: "U123",
      content: "[user_action confirm=yes]",
      isFromBot: false,
      metadata: {},
      created: new Date(),
      parentCorrelationId: "parent-abc",
      actionMetadata: {actionId: "confirm", value: "yes"},
    } as unknown as import("../../types").MessageDocument;

    const xml = formatMessagesAsXml([fakeMsg], "Shade");
    expect(xml).toContain("<user_action");
    expect(xml).toContain('actionId="confirm"');
    expect(xml).toContain('value="yes"');
    expect(xml).toContain('parentCorrelationId="parent-abc"');
    expect(xml).not.toContain("[user_action confirm=yes]"); // raw content not duplicated
  });

  test("escapes XML metacharacters in value", () => {
    const fakeMsg = {
      _id: new mongoose.Types.ObjectId(),
      groupId: new mongoose.Types.ObjectId(),
      channelId: new mongoose.Types.ObjectId(),
      sender: "U123",
      content: "[ua]",
      isFromBot: false,
      metadata: {},
      created: new Date(),
      parentCorrelationId: "parent-abc",
      actionMetadata: {actionId: "confirm", value: '"></user_action><foo>'},
    } as unknown as import("../../types").MessageDocument;

    const xml = formatMessagesAsXml([fakeMsg], "Shade");
    expect(xml).not.toContain("</user_action><foo>");
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&lt;foo&gt;");
  });

  test("regular messages still render as <message>", () => {
    const fakeMsg = {
      _id: new mongoose.Types.ObjectId(),
      groupId: new mongoose.Types.ObjectId(),
      channelId: new mongoose.Types.ObjectId(),
      sender: "alice",
      content: "hi",
      isFromBot: false,
      metadata: {},
      created: new Date(),
    } as unknown as import("../../types").MessageDocument;

    const xml = formatMessagesAsXml([fakeMsg], "Shade");
    expect(xml).toContain('<message role="user"');
    expect(xml).toContain("hi");
    expect(xml).not.toContain("<user_action");
  });
});
