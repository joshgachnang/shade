import {logger} from "@terreno/api";
import type express from "express";
import {Channel} from "../../models/channel";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import type {ChannelDocument, GroupDocument} from "../../types";
import {SlackChannelConnector} from "./slack";
import type {ChannelConnector, InboundMessage} from "./types";
import {WebhookChannelConnector} from "./webhook";

export class ChannelManager {
  private connectors = new Map<string, ChannelConnector>();
  private groupCache = new Map<string, GroupDocument>();
  private expressApp: express.Application | null = null;

  setExpressApp(app: express.Application): void {
    this.expressApp = app;
  }

  async initialize(): Promise<void> {
    const channels = await Channel.find({});
    if (channels.length === 0) {
      logger.info("No channels configured, orchestrator will idle");
      return;
    }

    // Cache all groups for external ID lookups
    const groups = await Group.find({});
    for (const group of groups) {
      this.groupCache.set(group.externalId, group);
      this.groupCache.set(group._id.toString(), group);
    }

    for (const channelDoc of channels) {
      try {
        await this.connectChannel(channelDoc);
      } catch (err) {
        logger.error(`Failed to connect channel "${channelDoc.name}": ${err}`);
        await Channel.findByIdAndUpdate(channelDoc._id, {$set: {status: "error"}});
      }
    }
  }

  private async connectChannel(channelDoc: ChannelDocument): Promise<void> {
    let connector: ChannelConnector;

    switch (channelDoc.type) {
      case "slack":
        connector = new SlackChannelConnector(channelDoc);
        break;
      case "webhook": {
        const webhookConnector = new WebhookChannelConnector(channelDoc);
        if (this.expressApp) {
          webhookConnector.registerRoutes(this.expressApp);
        }
        connector = webhookConnector;
        break;
      }
      default:
        logger.warn(`Unknown channel type: ${channelDoc.type}`);
        return;
    }

    connector.onMessage(async (inbound) => {
      await this.handleInboundMessage(channelDoc, inbound);
    });

    await connector.connect();
    this.connectors.set(channelDoc._id.toString(), connector);
  }

  private async handleInboundMessage(
    channelDoc: ChannelDocument,
    inbound: InboundMessage
  ): Promise<void> {
    // Find the group by its external ID
    const group = this.groupCache.get(inbound.groupExternalId);
    if (!group) {
      logger.debug(`No registered group for external ID ${inbound.groupExternalId}`);
      return;
    }

    // Store the message
    await Message.create({
      groupId: group._id,
      channelId: channelDoc._id,
      externalId: inbound.externalId,
      sender: inbound.sender,
      senderExternalId: inbound.senderExternalId,
      content: inbound.content,
      isFromBot: false,
      metadata: inbound.metadata ?? {},
    });

    logger.debug(`Stored message from ${inbound.sender} in group ${group.name}`);
  }

  async sendMessage(channelId: string, groupExternalId: string, content: string): Promise<void> {
    const connector = this.connectors.get(channelId);
    if (!connector) {
      logger.error(`No connector for channel ${channelId}`);
      return;
    }

    await connector.sendMessage(groupExternalId, content);
  }

  async sendMessageToGroup(groupId: string, content: string): Promise<void> {
    const group = this.groupCache.get(groupId);
    if (!group) {
      logger.error(`Group ${groupId} not found in cache`);
      return;
    }

    const channelId = group.channelId.toString();
    await this.sendMessage(channelId, group.externalId, content);

    // Store outbound message
    await Message.create({
      groupId: group._id,
      channelId: group.channelId,
      sender: "Shade",
      content,
      isFromBot: true,
      metadata: {},
    });
  }

  getConnectedChannelCount(): number {
    let count = 0;
    for (const connector of this.connectors.values()) {
      if (connector.isConnected()) {
        count++;
      }
    }
    return count;
  }

  getGroup(groupId: string): GroupDocument | undefined {
    return this.groupCache.get(groupId);
  }

  getGroupByExternalId(externalId: string): GroupDocument | undefined {
    return this.groupCache.get(externalId);
  }

  getAllGroups(): GroupDocument[] {
    const seen = new Set<string>();
    const groups: GroupDocument[] = [];
    for (const group of this.groupCache.values()) {
      const id = group._id.toString();
      if (!seen.has(id)) {
        seen.add(id);
        groups.push(group);
      }
    }
    return groups;
  }

  async disconnectAll(): Promise<void> {
    for (const [id, connector] of this.connectors) {
      try {
        await connector.disconnect();
      } catch (err) {
        logger.error(`Error disconnecting channel ${id}: ${err}`);
      }
    }
    this.connectors.clear();
    this.groupCache.clear();
  }
}
