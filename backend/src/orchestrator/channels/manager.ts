import {logger} from "@terreno/api";
import type express from "express";
import {nanoid} from "nanoid";
import {CHANNEL_STATUS} from "../../constants/statuses";
import {loadAppConfig} from "../../models/appConfig";
import {Channel} from "../../models/channel";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import type {ChannelDocument, GroupDocument} from "../../types";
import {logError} from "../errors";
import {pickRenderer} from "../responses/renderers";
import type {RenderContext, SlackRenderResult} from "../responses/renderers/types";
import {RichResponse} from "../responses/schema";
import {truncateRichResponse} from "../responses/truncate";
import {ChatCommandRouter} from "./commandRouter";
import {createEdgeAgentConnector} from "./edgeAgent";
import {createEmailConnector} from "./email";
import {createSlackConnector} from "./slack";
import type {ChannelConnector, ChannelHealth, ConnectorFactory, InboundMessage} from "./types";
import {createWebhookConnector} from "./webhook";

/** Model backends allowed to send through privileged channels (e.g. iMessage) */
const PRIVILEGED_ALLOWED_BACKENDS = new Set(["ollama", "gemini"]);

const defaultConnectorFactories: Record<string, ConnectorFactory> = {
  slack: createSlackConnector,
  webhook: createWebhookConnector,
  imessage: createEdgeAgentConnector,
  email: createEmailConnector,
};

export class ChannelManager {
  private connectors = new Map<string, ChannelConnector>();
  private groupCache = new Map<string, GroupDocument>();
  private expressApp: express.Application | null = null;
  private connectorFactories: Record<string, ConnectorFactory>;
  private commandRouter: ChatCommandRouter;

  constructor(factories?: Record<string, ConnectorFactory>, commandRouter?: ChatCommandRouter) {
    this.connectorFactories = factories ?? defaultConnectorFactories;
    this.commandRouter = commandRouter ?? new ChatCommandRouter();
  }

  setExpressApp(app: express.Application): void {
    this.expressApp = app;
  }

  async initialize(): Promise<void> {
    logger.info("Initializing channel manager...");

    const channels = await Channel.find({});
    if (channels.length === 0) {
      logger.info("No channels configured, orchestrator will idle");
      return;
    }

    logger.info(`Found ${channels.length} channel(s) to connect`);

    // Cache all groups for external ID lookups
    const groups = await Group.find({});
    for (const group of groups) {
      this.groupCache.set(group.externalId, group);
      this.groupCache.set(group._id.toString(), group);
    }
    logger.info(`Cached ${groups.length} group(s)`);

    for (const channelDoc of channels) {
      try {
        await this.connectChannel(channelDoc);
      } catch (err) {
        logError(`Failed to connect channel "${channelDoc.name}"`, err);
        try {
          await Channel.findByIdAndUpdate(channelDoc._id, {
            $set: {status: CHANNEL_STATUS.error},
          });
        } catch (dbErr) {
          logger.error(`Failed to update channel error status in DB: ${dbErr}`);
        }
      }
    }

    logger.info(
      `Channel manager initialized: ${this.connectors.size} connected, ${channels.length - this.connectors.size} failed`
    );
  }

  private async connectChannel(channelDoc: ChannelDocument): Promise<void> {
    const factory = this.connectorFactories[channelDoc.type];
    if (!factory) {
      logger.warn(`Unknown channel type: ${channelDoc.type}`);
      return;
    }

    const connector = factory(channelDoc, {expressApp: this.expressApp});

    connector.onMessage(async (inbound) => {
      try {
        await this.handleInboundMessage(channelDoc, inbound);
      } catch (err) {
        logError(
          `Error handling inbound message in channel "${channelDoc.name}" from ${inbound.sender}`,
          err
        );
      }
    });

    await connector.connect();
    this.connectors.set(channelDoc._id.toString(), connector);

    // Announce only in the main group's Slack channel (skip iMessage — don't text people on connect)
    if (channelDoc.type === "slack") {
      const mainGroup = await Group.findOne({channelId: channelDoc._id, isMain: true});
      if (mainGroup) {
        try {
          await connector.sendMessage(mainGroup.externalId, "Shade is online :wave:");
          logger.info(`Announced in ${mainGroup.name} (${mainGroup.externalId})`);
        } catch (err) {
          logger.warn(`Could not announce in ${mainGroup.name}: ${err}`);
        }
      }
    }
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

    // Dedupe by (groupId, externalId). Slack fires both `message` and
    // `app_mention` events for a tagged message, so without this guard we
    // were storing every tagged message twice and running the agent on each
    // copy. The unique pair is (group, provider-side message id / ts).
    if (inbound.externalId) {
      const existing = await Message.findOne({
        groupId: group._id,
        externalId: inbound.externalId,
      }).lean();
      if (existing) {
        logger.debug(
          `Duplicate inbound message ${inbound.externalId} in group ${group.name} — skipping`
        );
        return;
      }
    }

    logger.debug(
      `Storing inbound message from ${inbound.sender} in group ${group.name} (${inbound.content.substring(0, 80)})`
    );

    // Let the command router intercept chat-prefix commands (!moviesearch, …)
    // before the message falls through to the regular storage pipeline.
    const commandReply = await this.commandRouter.tryHandle(inbound);
    if (commandReply !== undefined) {
      if (commandReply) {
        await this.sendMessage(
          channelDoc._id.toString(),
          inbound.groupExternalId,
          commandReply.content
        );
      }
      return;
    }

    // If this is an action round-trip (Slack button click), the connector
    // attached metadata.action — promote it to dedicated Message fields so
    // the router can render <user_action> and so future queries can index it.
    const meta = (inbound.metadata ?? {}) as Record<string, unknown>;
    const actionRaw = meta.action as
      | {actionId?: string; value?: string; parentCorrelationId?: string}
      | undefined;
    const isAction =
      typeof actionRaw === "object" && actionRaw !== null && typeof actionRaw.actionId === "string";

    try {
      await Message.create({
        groupId: group._id,
        channelId: channelDoc._id,
        externalId: inbound.externalId,
        sender: inbound.sender,
        senderExternalId: inbound.senderExternalId,
        content: inbound.content,
        isFromBot: false,
        metadata: meta,
        ...(isAction
          ? {
              parentCorrelationId: actionRaw?.parentCorrelationId,
              actionMetadata: {
                actionId: actionRaw!.actionId!,
                value: actionRaw?.value,
              },
            }
          : {}),
      });
      logger.debug(`Stored message from ${inbound.sender} in group ${group.name}`);
    } catch (err) {
      logger.error(`Failed to store message from ${inbound.sender} in group ${group.name}: ${err}`);
    }
  }

  async sendMessage(channelId: string, groupExternalId: string, content: string): Promise<void> {
    const connector = this.connectors.get(channelId);
    if (!connector) {
      logger.error(`No connector for channel ${channelId}`);
      return;
    }

    try {
      await connector.sendMessage(groupExternalId, content);
    } catch (err) {
      logger.error(`Failed to send message via channel ${channelId} to ${groupExternalId}: ${err}`);
      throw err;
    }
  }

  async sendMessageWithTs(
    channelId: string,
    groupExternalId: string,
    content: string
  ): Promise<string> {
    const connector = this.connectors.get(channelId);
    if (!connector) {
      logger.error(`No connector for channel ${channelId}`);
      return "";
    }
    return connector.sendMessageWithTs(groupExternalId, content);
  }

  async updateMessage(
    channelId: string,
    groupExternalId: string,
    messageTs: string,
    content: string
  ): Promise<void> {
    const connector = this.connectors.get(channelId);
    if (!connector) {
      return;
    }
    await connector.updateMessage(groupExternalId, messageTs, content);
  }

  async sendMessageToGroupWithTs(groupId: string, content: string): Promise<string> {
    const group = this.groupCache.get(groupId);
    if (!group) {
      logger.error(`Group ${groupId} not found in cache`);
      return "";
    }
    return this.sendMessageWithTs(group.channelId.toString(), group.externalId, content);
  }

  async updateMessageInGroup(groupId: string, messageTs: string, content: string): Promise<void> {
    const group = this.groupCache.get(groupId);
    if (!group) {
      return;
    }
    await this.updateMessage(group.channelId.toString(), group.externalId, messageTs, content);
  }

  async addReaction(
    channelId: string,
    groupExternalId: string,
    messageTs: string,
    emoji: string
  ): Promise<void> {
    const connector = this.connectors.get(channelId);
    if (connector) {
      await connector.addReaction(groupExternalId, messageTs, emoji);
    }
  }

  async removeReaction(
    channelId: string,
    groupExternalId: string,
    messageTs: string,
    emoji: string
  ): Promise<void> {
    const connector = this.connectors.get(channelId);
    if (connector) {
      await connector.removeReaction(groupExternalId, messageTs, emoji);
    }
  }

  async sendMessageToGroup(groupId: string, content: string): Promise<void> {
    const group = this.groupCache.get(groupId);
    if (!group) {
      logger.error(`Group ${groupId} not found in cache`);
      return;
    }

    const channelId = group.channelId.toString();

    // Enforce privilege: privileged channels only allow sends from local/gemini backends
    const connector = this.connectors.get(channelId);
    if (connector?.channelDoc.privileged) {
      const backend = group.modelConfig?.defaultBackend || "claude";
      if (!PRIVILEGED_ALLOWED_BACKENDS.has(backend)) {
        logger.error(
          `Blocked send to privileged channel "${connector.channelDoc.name}" — ` +
            `group "${group.name}" uses backend "${backend}" (allowed: ${[...PRIVILEGED_ALLOWED_BACKENDS].join(", ")})`
        );
        return;
      }
    }

    logger.debug(
      `Sending message to group ${group.name} via channel ${channelId} (${content.length} chars)`
    );

    try {
      await this.sendMessage(channelId, group.externalId, content);
    } catch (err) {
      logger.error(`Failed to send outbound message to group ${group.name}: ${err}`);
      // Don't throw — still try to store the message
    }

    // Store outbound message
    try {
      await Message.create({
        groupId: group._id,
        channelId: group.channelId,
        sender: "Shade",
        content,
        isFromBot: true,
        metadata: {},
        correlationId: nanoid(12),
      });
    } catch (err) {
      logger.error(`Failed to store outbound message for group ${group.name}: ${err}`);
    }
  }

  /**
   * Send a structured RichResponse to a group.
   *
   * - Validates the payload (defense-in-depth — the MCP tool already did once).
   * - Truncates to MAX_CARDS per AppConfig.richResponses.autoTruncate.
   * - Generates a correlationId and persists the Message with richPayload.
   * - Enforces the same PRIVILEGED_ALLOWED_BACKENDS gate as plain sendMessageToGroup.
   * - If the channel doesn't support rich messages, falls back to sending fallbackText.
   * - If AppConfig.richResponses.enabled === false, falls back to fallbackText.
   */
  async sendRichMessageToGroup(
    groupId: string,
    payload: RichResponse,
    opts: {threadTs?: string} = {}
  ): Promise<void> {
    const group = this.groupCache.get(groupId);
    if (!group) {
      logger.error(`Group ${groupId} not found in cache (sendRichMessageToGroup)`);
      return;
    }

    const channelId = group.channelId.toString();
    const connector = this.connectors.get(channelId);
    if (!connector) {
      logger.error(`No connector for channel ${channelId} (sendRichMessageToGroup)`);
      return;
    }

    // Privileged-channel gate: parity with sendMessageToGroup.
    if (connector.channelDoc.privileged) {
      const backend = group.modelConfig?.defaultBackend || "claude";
      if (!PRIVILEGED_ALLOWED_BACKENDS.has(backend)) {
        logger.error(
          `Blocked rich send to privileged channel "${connector.channelDoc.name}" — ` +
            `group "${group.name}" uses backend "${backend}" (allowed: ${[...PRIVILEGED_ALLOWED_BACKENDS].join(", ")})`
        );
        return;
      }
    }

    // Defense-in-depth parse.
    const parsed = RichResponse.safeParse(payload);
    if (!parsed.success) {
      logger.warn(`Invalid RichResponse for group ${group.name}: ${parsed.error.message}`);
      return;
    }

    const appConfig = await loadAppConfig();
    const truncated = truncateRichResponse(parsed.data, {
      autoTruncate: appConfig.richResponses?.autoTruncate ?? true,
    });

    const correlationId = nanoid(12);
    const flagEnabled = appConfig.richResponses?.enabled ?? true;
    const useRich = flagEnabled && connector.supportsRichMessages && connector.sendRichMessage;

    if (useRich) {
      const renderer = pickRenderer(connector.channelDoc.type) as {
        render: (r: RichResponse, ctx?: RenderContext) => SlackRenderResult;
      };
      const renderContext: RenderContext = {
        mapboxAccessToken: appConfig.maps?.mapboxAccessToken || undefined,
      };
      const rendered = renderer.render(truncated, renderContext);
      try {
        await connector.sendRichMessage!(group.externalId, rendered, {
          groupId,
          correlationId,
          threadTs: opts.threadTs,
        });
      } catch (err) {
        logger.error(`Failed to send rich message to group ${group.name}: ${err}`);
      }
    } else {
      // Fallback: send only fallbackText via the plain path.
      try {
        await connector.sendMessage(group.externalId, truncated.fallbackText);
      } catch (err) {
        logger.error(
          `Failed to send fallbackText for rich response to group ${group.name}: ${err}`
        );
      }
    }

    // Persist the outbound Message with the rich payload (for audit even when
    // the flag is off or the channel can't render).
    try {
      await Message.create({
        groupId: group._id,
        channelId: group.channelId,
        sender: "Shade",
        content: truncated.fallbackText,
        isFromBot: true,
        metadata: {},
        richPayload: truncated,
        correlationId,
      });
    } catch (err) {
      logger.error(`Failed to store outbound rich message for group ${group.name}: ${err}`);
    }
  }

  registerGroup(group: GroupDocument): void {
    this.groupCache.set(group.externalId, group);
    this.groupCache.set(group._id.toString(), group);
    logger.info(`Registered group "${group.name}" (${group.externalId}) in cache`);
  }

  async createFeatureChannel(
    sourceChannelId: string,
    name: string,
    userId: string
  ): Promise<{slackChannelId: string}> {
    const connector = this.connectors.get(sourceChannelId);
    if (!connector) {
      throw new Error(`No connector for channel ${sourceChannelId}`);
    }

    const {id: slackChannelId} = await connector.createChannel(name);
    await connector.inviteToChannel(slackChannelId, userId);
    return {slackChannelId};
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

  /** Per-channel liveness for health endpoints / watchdogs. */
  getHealthSnapshot(): ChannelHealth[] {
    const snapshot: ChannelHealth[] = [];
    for (const connector of this.connectors.values()) {
      if (connector.getHealth) {
        snapshot.push(connector.getHealth());
        continue;
      }
      snapshot.push({
        name: connector.channelDoc.name,
        type: connector.channelDoc.type,
        connected: connector.isConnected(),
        healthy: connector.isConnected(),
      });
    }
    return snapshot;
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
    logger.info(`Disconnecting ${this.connectors.size} channel(s)...`);
    for (const [id, connector] of this.connectors) {
      try {
        await connector.disconnect();
      } catch (err) {
        logger.error(`Error disconnecting channel ${id}: ${err}`);
      }
    }
    this.connectors.clear();
    this.groupCache.clear();
    logger.info("All channels disconnected");
  }
}
