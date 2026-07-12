import {describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {Channel} from "./channel";
import {Group} from "./group";
import {Message} from "./message";

const makeGroupAndChannel = async () => {
  const suffix = new mongoose.Types.ObjectId().toString();
  const channel = await Channel.create({
    name: `test-channel-${suffix}`,
    type: "slack",
    status: "connected",
    privileged: false,
    config: {},
  });
  const group = await Group.create({
    name: `test-group-${suffix}`,
    externalId: `ext-${suffix}`,
    channelId: channel._id,
    isMain: false,
    folder: `test-${suffix}`,
  });
  return {groupId: group._id, channelId: channel._id};
};

describe("Message richResponse fields", () => {
  test("saves with richPayload, correlationId, parentCorrelationId, actionMetadata", async () => {
    const {groupId, channelId} = await makeGroupAndChannel();
    const doc = await Message.create({
      groupId,
      channelId,
      sender: "Shade",
      content: "hello",
      isFromBot: true,
      richPayload: {v: "1", cards: [{kind: "text", markdown: "hi"}], fallbackText: "hi"},
      correlationId: "corr-12345",
      parentCorrelationId: "parent-67890",
      actionMetadata: {actionId: "confirm", value: "yes"},
    });
    expect(doc.correlationId).toBe("corr-12345");
    expect(doc.parentCorrelationId).toBe("parent-67890");
    expect(doc.actionMetadata?.actionId).toBe("confirm");
    expect(doc.actionMetadata?.value).toBe("yes");
    expect(doc.richPayload?.fallbackText).toBe("hi");
  });

  test("saves without any of the new fields (backwards compatible)", async () => {
    const {groupId, channelId} = await makeGroupAndChannel();
    const doc = await Message.create({
      groupId,
      channelId,
      sender: "alice",
      content: "hi",
      isFromBot: false,
    });
    expect(doc.richPayload).toBeUndefined();
    expect(doc.correlationId).toBeUndefined();
    expect(doc.parentCorrelationId).toBeUndefined();
    expect(doc.actionMetadata).toBeUndefined();
  });

  test("correlationId is indexed (sanity check via collection.indexInformation)", async () => {
    await Message.init();
    const indexes = await Message.collection.indexInformation();
    const keys = Object.values(indexes).map((idx) => JSON.stringify(idx));
    const hasCorrIndex = keys.some((k) => k.includes("correlationId"));
    const hasParentIndex = keys.some((k) => k.includes("parentCorrelationId"));
    expect(hasCorrIndex).toBe(true);
    expect(hasParentIndex).toBe(true);
  });
});

describe("Message content text index", () => {
  test("content text index exists (sanity check via collection.indexInformation)", async () => {
    await Message.init();
    const indexes = await Message.collection.indexInformation();
    expect(Object.keys(indexes)).toContain("content_text");
  });

  test("$text query returns matching messages scoped to a group", async () => {
    await Message.init();
    const {groupId, channelId} = await makeGroupAndChannel();
    await Message.create({
      groupId,
      channelId,
      sender: "alice",
      content: "the plex server needs a restart tonight",
      isFromBot: false,
    });
    await Message.create({
      groupId,
      channelId,
      sender: "bob",
      content: "unrelated chatter about dinner plans",
      isFromBot: false,
    });

    const results = await Message.find({$text: {$search: "plex restart"}, groupId});
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("plex");
  });
});
