import {afterEach, expect, test} from "bun:test";
import {Channel} from "../models/channel";
import {Group} from "../models/group";
import {Message} from "../models/message";
import {breweryHarnessTransport} from "./breweryTransport";

const originalMode = process.env.SHADE_TEST_MODE;
const groups: InstanceType<typeof Group>[] = [];
const channels: InstanceType<typeof Channel>[] = [];
afterEach(async () => {
  if (originalMode === undefined) delete process.env.SHADE_TEST_MODE;
  else process.env.SHADE_TEST_MODE = originalMode;
  await Message.deleteMany({groupId: {$in: groups.map((g) => g._id)}});
  await Promise.all(groups.splice(0).map((g) => g.deleteOne()));
  await Promise.all(channels.splice(0).map((c) => c.deleteOne()));
});
const group = async (type = "test") => {
  const channel = await Channel.create({name: "Brewery transport", type, config: {}});
  channels.push(channel);
  const result = await Group.create({
    name: "Brewery transport",
    folder: `brewery-${channel._id}`,
    channelId: channel._id,
    externalId: "test-target",
  });
  groups.push(result);
  return result;
};

test("harness delivery refuses real channels and use outside test mode", async () => {
  const testGroup = await group();
  delete process.env.SHADE_TEST_MODE;
  await expect(breweryHarnessTransport.post(testGroup, "hello")).rejects.toThrow("test mode");
  process.env.SHADE_TEST_MODE = "1";
  const slackGroup = await group("slack");
  await expect(breweryHarnessTransport.post(slackGroup, "hello")).rejects.toThrow("test channel");
  expect(await Message.countDocuments({groupId: {$in: groups.map((g) => g._id)}})).toBe(0);
});

test("edits preserve the outbox ID and cannot cross groups or overwrite inbound messages", async () => {
  process.env.SHADE_TEST_MODE = "1";
  const first = await group();
  const second = await group();
  const id = await breweryHarnessTransport.post(first, "Starting");
  await breweryHarnessTransport.update(first, id, "Done");
  expect((await Message.findById(id))?.content).toBe("Done");
  expect(await Message.countDocuments({groupId: first._id})).toBe(1);
  await expect(breweryHarnessTransport.update(second, id, "Wrong group")).rejects.toThrow(
    "not found"
  );
  const inbound = await Message.create({
    groupId: first._id,
    channelId: first.channelId,
    sender: "Tester",
    content: "ok",
  });
  await expect(
    breweryHarnessTransport.update(first, inbound._id.toString(), "Wrong direction")
  ).rejects.toThrow("not found");
  expect((await Message.findById(inbound._id))?.content).toBe("ok");
});
