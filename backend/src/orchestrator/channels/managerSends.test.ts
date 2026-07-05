import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {Channel} from "../../models/channel";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import {ChannelManager} from "./manager";

/**
 * Outbound send variants and the privileged-channel gate, exercised through
 * the harness's "test" channel type — no network, everything observable via
 * Message docs and connector return values.
 */
describe("ChannelManager sends via test connector", () => {
  let manager: ChannelManager;
  let groupId: string;
  let privilegedGroupId: string;
  let allowedBackendGroupId: string;
  let channelId: string;
  const createdIds: mongoose.Types.ObjectId[] = [];

  beforeAll(async () => {
    await Promise.all([Channel.deleteMany({}), Group.deleteMany({}), Message.deleteMany({})]);

    const channel = await Channel.create({
      name: "sends-test-channel",
      type: "test",
      status: "connected",
      config: {},
    });
    const privilegedChannel = await Channel.create({
      name: "sends-privileged-channel",
      type: "test",
      privileged: true,
      status: "connected",
      config: {},
    });

    const group = await Group.create({
      name: "sends-group",
      folder: "sends-group",
      channelId: channel._id,
      externalId: "sends-ext",
    });
    const privilegedGroup = await Group.create({
      name: "sends-privileged-group",
      folder: "sends-privileged-group",
      channelId: privilegedChannel._id,
      externalId: "sends-priv-ext",
      modelConfig: {defaultBackend: "mock"},
    });
    const allowedGroup = await Group.create({
      name: "sends-allowed-group",
      folder: "sends-allowed-group",
      channelId: privilegedChannel._id,
      externalId: "sends-allowed-ext",
      modelConfig: {defaultBackend: "ollama"},
    });

    groupId = group._id.toString();
    privilegedGroupId = privilegedGroup._id.toString();
    allowedBackendGroupId = allowedGroup._id.toString();
    channelId = channel._id.toString();
    createdIds.push(
      channel._id,
      privilegedChannel._id,
      group._id,
      privilegedGroup._id,
      allowedGroup._id
    );

    manager = new ChannelManager();
    await manager.initialize();
  });

  afterAll(async () => {
    await manager.disconnectAll();
    await Message.deleteMany({});
    await Group.deleteMany({_id: {$in: createdIds}});
    await Channel.deleteMany({_id: {$in: createdIds}});
  });

  test("sendMessageToGroupWithTs returns the connector's synthetic ts", async () => {
    const ts = await manager.sendMessageToGroupWithTs(groupId, "with ts please");
    expect(ts).toMatch(/^test-ts-/);
  });

  test("updateMessageInGroup and reactions route through the connector without error", async () => {
    await manager.updateMessageInGroup(groupId, "test-ts-1", "edited content");
    await manager.addReaction(channelId, "sends-ext", "test-ts-1", "eyes");
    await manager.removeReaction(channelId, "sends-ext", "test-ts-1", "eyes");
  });

  test("privileged channel blocks sends from non-allowlisted backends", async () => {
    await manager.sendMessageToGroup(privilegedGroupId, "should be blocked");

    const blocked = await Message.findOneOrNone({groupId: privilegedGroupId, isFromBot: true});
    expect(blocked).toBeNull();
  });

  test("privileged channel allows sends from ollama-backed groups", async () => {
    await manager.sendMessageToGroup(allowedBackendGroupId, "allowed through");

    const message = await Message.findExactlyOne({
      groupId: allowedBackendGroupId,
      isFromBot: true,
    });
    expect(message.content).toBe("allowed through");
  });

  test("createFeatureChannel returns the test connector's synthetic channel id", async () => {
    const {slackChannelId} = await manager.createFeatureChannel(channelId, "new-feature", "U123");
    expect(slackChannelId).toBe("test-channel-new-feature");
  });

  test("sendMessage to an unknown channel logs and returns without throwing", async () => {
    await manager.sendMessage(new mongoose.Types.ObjectId().toString(), "nowhere", "dropped");
  });
});
