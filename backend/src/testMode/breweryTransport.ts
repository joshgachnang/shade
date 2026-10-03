import {Channel} from "../models/channel";
import {Message} from "../models/message";
import type {GroupDocument} from "../types/models/groupTypes";
import {isTestMode} from "./flag";

const assertHarnessChannel = async (group: GroupDocument): Promise<void> => {
  if (!isTestMode() || !(await Channel.exists({_id: group.channelId, type: "test"}))) {
    throw new Error("Brewery harness transport requires test mode and a test channel");
  }
};

/** Slack's post/edit boundary represented by stable outbox message IDs, also usable by workers. */
export const breweryHarnessTransport = {
  post: async (group: GroupDocument, content: string): Promise<string> => {
    await assertHarnessChannel(group);
    const message = await Message.create({
      groupId: group._id,
      channelId: group.channelId,
      sender: "Shade",
      content,
      isFromBot: true,
      processedAt: new Date(),
    });
    return message._id.toString();
  },
  update: async (group: GroupDocument, id: string, content: string): Promise<void> => {
    await assertHarnessChannel(group);
    const result = await Message.updateOne(
      {_id: id, groupId: group._id, channelId: group.channelId, isFromBot: true},
      {$set: {content}}
    );
    if (!result.matchedCount) throw new Error("Brewery harness message not found");
  },
};
