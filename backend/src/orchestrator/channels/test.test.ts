import {afterEach, beforeAll, describe, expect, test} from "bun:test";
import {Channel} from "../../models/channel";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import {ChannelManager} from "./manager";

const ORIGINAL_TEST_MODE = process.env.SHADE_TEST_MODE;

describe("TestChannelConnector", () => {
  beforeAll(async () => {
    await Promise.all([Message.deleteMany({}), Group.deleteMany({}), Channel.deleteMany({})]);
  });

  afterEach(async () => {
    if (ORIGINAL_TEST_MODE === undefined) {
      delete process.env.SHADE_TEST_MODE;
    } else {
      process.env.SHADE_TEST_MODE = ORIGINAL_TEST_MODE;
    }
    await Promise.all([Message.deleteMany({}), Group.deleteMany({}), Channel.deleteMany({})]);
  });

  test("initializes a test channel and persists outbound messages", async () => {
    const channel = await Channel.create({
      name: "harness",
      type: "test",
      status: "disconnected",
      config: {},
    });
    const group = await Group.create({
      name: "harness-group",
      folder: "harness-group",
      channelId: channel._id,
      externalId: "harness-ext",
      requiresTrigger: false,
    });

    const manager = new ChannelManager();
    await manager.initialize();

    expect(manager.getConnectedChannelCount()).toBe(1);

    await manager.sendMessageToGroup(group._id.toString(), "hello from the agent");

    const outbound = await Message.findExactlyOne({groupId: group._id, isFromBot: true});
    expect(outbound.content).toBe("hello from the agent");
    expect(outbound.correlationId).toBeTruthy();

    await manager.sendRichMessageToGroup(String(group._id), {
      v: "1",
      fallbackText: "Rich reply",
      cards: [{kind: "text", markdown: "Rich reply"}],
    });
    const posts = await Message.find({groupId: group._id, isFromBot: true});
    expect(posts).toHaveLength(2);
    expect(posts.find((post) => post.content === "Rich reply")?.richPayload?.fallbackText).toBe(
      "Rich reply"
    );

    await manager.disconnectAll();
  });

  test("direct notices are recorded once and scoped by channel and external target", async () => {
    const channel = await Channel.create({name: "notices", type: "test", config: {}});
    const group = await Group.create({
      name: "notices",
      folder: "notices",
      channelId: channel._id,
      externalId: "notice-target",
    });
    const otherChannel = await Channel.create({name: "other-notices", type: "test", config: {}});
    const otherGroup = await Group.create({
      name: "other-notices",
      folder: "other-notices",
      channelId: otherChannel._id,
      externalId: group.externalId,
    });
    const manager = new ChannelManager();
    await manager.initialize();
    try {
      await manager.sendMessage(
        String(channel._id),
        group.externalId,
        "Brewery is processing an update"
      );
      const posts = await Message.find({groupId: group._id, isFromBot: true});
      expect(posts).toHaveLength(1);
      expect(await Message.countDocuments({groupId: otherGroup._id})).toBe(0);
      expect(posts[0]?.content).toBe("Brewery is processing an update");
      expect(posts[0]?.channelId.toString()).toBe(String(channel._id));
    } finally {
      await manager.disconnectAll();
    }
  });

  test("test mode skips real channel types entirely", async () => {
    process.env.SHADE_TEST_MODE = "1";

    await Channel.create({
      name: "leftover-slack",
      type: "slack",
      status: "disconnected",
      config: {botToken: "xoxb-bogus", appToken: "xapp-bogus"},
    });
    const testChannel = await Channel.create({
      name: "harness",
      type: "test",
      status: "disconnected",
      config: {},
    });
    await Group.create({
      name: "harness-group",
      folder: "harness-group-2",
      channelId: testChannel._id,
      externalId: "harness-ext-2",
      requiresTrigger: false,
    });

    const manager = new ChannelManager();
    await manager.initialize();

    // Only the test channel connected; the Slack doc was skipped without any
    // network attempt (a connect attempt with bogus tokens would throw/hang).
    expect(manager.getConnectedChannelCount()).toBe(1);
    expect(manager.getHealthSnapshot().map((h) => h.type)).toEqual(["test"]);

    await manager.disconnectAll();
  });
});
