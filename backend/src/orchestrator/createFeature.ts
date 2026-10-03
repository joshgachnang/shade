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

    // A start that failed before brewery launched leaves its group and feature behind;
    // a retry reuses them. Anything further along is a live feature, not a retry.
    const folder = `features/${data.name}`;
    const existingGroup = await Group.findOne({folder});
    const existingFeature = existingGroup
      ? await Feature.findOne({groupId: existingGroup._id})
      : null;
    if (existingGroup && (existingFeature?.status !== "error" || existingFeature.brewery)) {
      throw new Error(
        `#${data.name} already exists with a feature in progress. Continue it in that channel or choose another name`
      );
    }

    const {slackChannelId} = await channelManager.createFeatureChannel(
      sourceGroup.channelId.toString(),
      data.name,
      data.senderExternalId
    );
    // Persist the driver before registering the channel: even startup errors must
    // never expose a new feature channel to an agent runner.
    const groupFields = {
      name: data.name,
      folder,
      channelId: sourceGroup.channelId,
      externalId: slackChannelId,
      trigger: "@Shade",
      requiresTrigger: false,
      isMain: false,
      modelConfig: sourceGroup.modelConfig,
      featureDriver: "brewery" as const,
      featurePhase: "implementing" as const,
    };
    const group = existingGroup
      ? await existingGroup.set(groupFields).save()
      : await Group.create(groupFields);
    const featureFields = {
      name: data.name,
      description: data.description ?? data.request?.slice(0, 500),
      groupId: group._id,
      status: "in_progress" as const,
      errorMessage: undefined,
    };
    const feature = existingFeature
      ? await existingFeature.set(featureFields).save()
      : await Feature.create(featureFields);
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
