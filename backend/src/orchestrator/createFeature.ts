import {logger} from "@terreno/api";
import {Feature} from "../models/feature";
import {Group} from "../models/group";
import type {ChannelManager} from "./channels/manager";
import type {IpcCreateFeature} from "./ipc";
import {BreweryDriver} from "./services/breweryDriver";

/** Shared by the IPC watcher and tests; external transport/process boundaries are injectable. */
export const createFeatureHandler =
  (
    channelManager: Pick<ChannelManager, "createFeatureChannel" | "registerGroup" | "sendMessage">,
    breweryOptions: Omit<ConstructorParameters<typeof BreweryDriver>[0], "sendMessage"> = {}
  ) =>
  async (data: IpcCreateFeature): Promise<void> => {
    const sourceGroup = await Group.findById(data.groupId);
    if (!sourceGroup) {
      throw new Error(`Source group ${data.groupId} not found`);
    }

    const {slackChannelId} = await channelManager.createFeatureChannel(
      sourceGroup.channelId.toString(),
      data.name,
      data.senderExternalId
    );
    // Persist the driver before registering the channel: even startup errors must
    // never expose a new feature channel to an agent runner.
    const group = await Group.create({
      name: data.name,
      folder: `features/${data.name}`,
      channelId: sourceGroup.channelId,
      externalId: slackChannelId,
      trigger: "@Shade",
      requiresTrigger: false,
      isMain: false,
      modelConfig: sourceGroup.modelConfig,
      featureDriver: "brewery",
      featurePhase: "implementing",
    });
    const feature = await Feature.create({
      name: data.name,
      description: data.description ?? data.request?.slice(0, 500),
      groupId: group._id,
      status: "in_progress",
    });
    channelManager.registerGroup(group);

    // The driver owns workspace preparation, request persistence, and actionable
    // startup errors. No synthetic inbound message or agent workflow is needed.
    const driver = new BreweryDriver({
      ...breweryOptions,
      sendMessage: (channel, target, content) =>
        channelManager.sendMessage(channel, target, content),
    });
    await driver.start({feature, group, request: data.request ?? "", repo: data.repo});
    logger.info(
      `Brewery feature channel created: #${data.name} (${slackChannelId}), group ${group._id}`
    );
  };
