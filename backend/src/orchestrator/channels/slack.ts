import {App, LogLevel} from "@slack/bolt";
import type {GenericMessageEvent, KnownBlock} from "@slack/types";
import {logger} from "@terreno/api";
import {logError} from "../errors";
import {SHADE_CORR_PLACEHOLDER, SHADE_GROUP_PLACEHOLDER} from "../responses/renderers/types";
import {BaseChannelConnector} from "./baseConnector";
import type {ChannelHealth, ConnectorFactory, RichSendOpts} from "./types";

const SLACK_ACTION_ID_MAX = 255;

/**
 * Slack Socket Mode connector.
 *
 * Reliability note: Slack load-balances events across every socket open for
 * the app token. If a previous `bun --watch` restart leaves a zombie socket
 * alive for ~30-60s, Slack will route some events to it and we lose them
 * silently (symptom: "sometimes the bot doesn't reply to untagged messages
 * in feature channels"). Mitigations here:
 *   1. Enable Bolt INFO logs so socket lifecycle (connected / reconnecting /
 *      disconnected) is visible in our log stream.
 *   2. Listen to SocketModeClient lifecycle events and surface them at info
 *      level so operators can correlate missing events with socket flaps, and
 *      track them as a real liveness signal for `getHealth()`.
 *   3. Make `disconnect()` actually wait for the socket to close so a clean
 *      SIGTERM (what `bun --watch` sends on file change) fully tears it down
 *      before the replacement process opens a new one.
 */
export class SlackChannelConnector extends BaseChannelConnector {
  readonly supportsRichMessages = true;
  private app: App | null = null;
  // Socket-mode liveness, tracked from the underlying client's lifecycle events.
  // `connected` (from the base class) stays true across silent socket deaths; these don't.
  private socketState = "initializing";
  private lastConnectedAt: Date | null = null;
  private lastEventAt: Date | null = null;

  private isUserAllowed(userId: string): boolean {
    const config = this.channelDoc.config as {allowedUserIds?: string[]};
    if (!config.allowedUserIds || config.allowedUserIds.length === 0) {
      return true;
    }
    return config.allowedUserIds.includes(userId);
  }

  async connect(): Promise<void> {
    const config = this.channelDoc.config as {
      botToken?: string;
      appToken?: string;
      signingSecret?: string;
    };

    if (!config.botToken || !config.appToken) {
      throw new Error("Slack channel requires botToken and appToken in config");
    }

    logger.info(`Connecting Slack channel "${this.channelDoc.name}"...`);

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      // INFO surfaces socket lifecycle (connect/reconnect/disconnect) and
      // rate-limit warnings without flooding the log with every Web API
      // request body. Our own `logger.info` lifecycle wrapper below gives us
      // the bulk of what's useful on top of this.
      logLevel: LogLevel.INFO,
    });

    this.app.use(async ({body, next}) => {
      const eventType = "event" in body ? (body.event as {type?: string})?.type : undefined;
      logger.debug(`Slack event received: ${eventType ?? body.type ?? "unknown"}`);
      await next();
    });

    this.app.message(async ({message}) => {
      try {
        const msg = message as GenericMessageEvent;
        logger.debug(
          `Slack message in "${this.channelDoc.name}": subtype=${msg.subtype} bot_id=${msg.bot_id} channel=${msg.channel} text="${msg.text?.substring(0, 80)}"`
        );
        if (msg.subtype || msg.bot_id) {
          return;
        }

        if (!this.isUserAllowed(msg.user || "")) {
          logger.debug(
            `Slack message in "${this.channelDoc.name}" from non-allowed user ${msg.user}, skipping`
          );
          return;
        }

        await this.dispatchMessage({
          externalId: msg.ts,
          sender: msg.user || "unknown",
          senderExternalId: msg.user || "",
          content: msg.text || "",
          groupExternalId: msg.channel,
          metadata: {
            threadTs: msg.thread_ts,
            ts: msg.ts,
          },
        });
      } catch (err) {
        logError(`Error handling Slack message in "${this.channelDoc.name}"`, err);
      }
    });

    this.app.event("app_mention", async ({event}) => {
      try {
        logger.debug(
          `Slack app_mention in "${this.channelDoc.name}": channel=${event.channel} user=${event.user} text="${event.text?.substring(0, 80)}"`
        );

        if (!this.isUserAllowed(event.user || "")) {
          logger.debug(
            `Slack mention in "${this.channelDoc.name}" from non-allowed user ${event.user}, skipping`
          );
          return;
        }

        await this.dispatchMessage({
          externalId: event.ts,
          sender: event.user || "unknown",
          senderExternalId: event.user || "",
          content: event.text || "",
          groupExternalId: event.channel,
          metadata: {
            threadTs: event.thread_ts,
            ts: event.ts,
            isMention: true,
          },
        });
      } catch (err) {
        logError(`Error handling Slack mention in "${this.channelDoc.name}"`, err);
      }
    });

    // Interactive components: button clicks from rich-response cards.
    // action_id format: shade:<groupId>:<correlationId>:<actionId>
    this.app.action(/^shade:.+$/, async ({action, ack, body, respond: _respond}) => {
      // Always ack first to stay within Slack's 3-second window.
      try {
        await ack();
      } catch (err) {
        logger.warn(`Slack action ack failed: ${err}`);
      }

      try {
        // Feature flag check at click time. The handler is registered at boot
        // and previously-sent cards may still emit clicks after the flag flips.
        const {loadAppConfig} = await import("../../models/appConfig");
        const appConfig = await loadAppConfig();
        if (!appConfig.richResponses?.enabled) {
          logger.info(
            `Slack action suppressed (richResponses.enabled=false) in "${this.channelDoc.name}"`
          );
          return;
        }

        const actionIdRaw = (action as {action_id?: string}).action_id ?? "";
        const parts = actionIdRaw.split(":");
        if (parts.length < 4 || parts[0] !== "shade") {
          logger.warn(`Ignoring malformed action_id: ${actionIdRaw}`);
          return;
        }
        const [, groupId, parentCorrelationId, ...rest] = parts;
        const actionId = rest.join(":");
        const value = (action as {value?: string}).value;

        // Validate that the click came from a channel whose group matches the
        // groupId embedded in the action_id. Defense against cross-group leakage.
        const bodyAny = body as {
          channel?: {id?: string};
          user?: {id?: string};
          message?: {ts?: string; thread_ts?: string};
        };
        const channelExternalId = bodyAny.channel?.id;
        if (!channelExternalId) {
          logger.warn("Slack action with no channel.id; dropping");
          return;
        }

        // Look up the Group by id and confirm its externalId matches the click channel.
        const {Group} = await import("../../models/group");
        const dbGroup = await Group.findById(groupId);
        if (!dbGroup || dbGroup.externalId !== channelExternalId) {
          logger.warn(
            `Slack action groupId mismatch: actionId=${actionIdRaw} channel=${channelExternalId} groupExternal=${dbGroup?.externalId ?? "<none>"}`
          );
          return;
        }

        if (!this.isUserAllowed(bodyAny.user?.id || "")) {
          logger.debug(
            `Slack action from non-allowed user ${bodyAny.user?.id} in "${this.channelDoc.name}"`
          );
          return;
        }

        if (!this.messageHandler) {
          logger.debug("No message handler for Slack action");
          return;
        }

        const ts = bodyAny.message?.ts ?? `${Date.now()}`;
        const externalId = `${ts}:action:${actionId}`;
        const safeValue = typeof value === "string" ? value.slice(0, 2000) : undefined;

        await this.messageHandler({
          externalId,
          sender: bodyAny.user?.id || "unknown",
          senderExternalId: bodyAny.user?.id || "",
          content: `[user_action ${actionId}${safeValue ? `=${safeValue}` : ""}]`,
          groupExternalId: channelExternalId,
          metadata: {
            threadTs: bodyAny.message?.thread_ts,
            ts,
            action: {actionId, value: safeValue, parentCorrelationId},
          },
        });
      } catch (err) {
        logError(`Error handling Slack action in "${this.channelDoc.name}"`, err);
      }
    });

    // Handle Slack errors at the app level
    this.app.error(async (error) => {
      logger.error(`Slack app error in "${this.channelDoc.name}": ${error.message ?? error}`);
    });

    await this.app.start();
    this.connected = true;
    this.socketState = "connected";
    this.lastConnectedAt = new Date();
    this.attachSocketLifecycle();
    logger.info(`Slack channel "${this.channelDoc.name}" socket connected`);

    try {
      await this.app.client.users.setPresence({
        token: config.botToken,
        presence: "auto",
      });
      logger.debug(`Slack presence set to auto for "${this.channelDoc.name}"`);
    } catch (err) {
      logger.warn(`Could not set presence for "${this.channelDoc.name}": ${err}`);
    }

    await this.persistStatus("connected");

    logger.info(`Slack channel "${this.channelDoc.name}" fully connected`);
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting Slack channel "${this.channelDoc.name}"...`);
    if (this.app) {
      // Directly close the underlying SocketModeClient as well as stopping
      // the Bolt app. `app.stop()` alone has been observed to leave the WS
      // half-open across a `bun --watch` restart; the ghost socket keeps
      // receiving load-balanced events from Slack for ~30-60s, which is
      // exactly the "sometimes the bot doesn't see untagged messages"
      // symptom we were debugging.
      const socketClient = (
        this.app as unknown as {
          receiver?: {client?: {disconnect?: () => Promise<void>}};
        }
      ).receiver?.client;
      try {
        await this.app.stop();
      } catch (err) {
        logger.error(`Error stopping Slack app for "${this.channelDoc.name}": ${err}`);
      }
      if (socketClient && typeof socketClient.disconnect === "function") {
        try {
          await socketClient.disconnect();
        } catch (err) {
          logger.warn(`Error force-closing Slack socket for "${this.channelDoc.name}": ${err}`);
        }
      }
      this.app = null;
    }
    this.connected = false;
    this.socketState = "disconnected";

    await this.persistStatus("disconnected");

    logger.info(`Slack channel "${this.channelDoc.name}" disconnected`);
  }

  /**
   * Subscribe to the socket-mode client's lifecycle events so we have a true
   * liveness signal. Bolt's App keeps `connected` true even when the websocket
   * silently dies; the client's state transitions do not. Defensive about the
   * internal shape — if bolt changes it, health degrades to the coarse flag.
   */
  private attachSocketLifecycle(): void {
    const client = (this.app as unknown as {receiver?: {client?: NodeJS.EventEmitter}})?.receiver
      ?.client;
    if (!client || typeof client.on !== "function") {
      logger.warn(
        `Could not attach socket-mode lifecycle listeners for "${this.channelDoc.name}"; health will use the coarse connected flag`
      );
      return;
    }

    const setState = (state: string) => {
      this.socketState = state;
      if (state === "connected") {
        this.lastConnectedAt = new Date();
      }
      // INFO so operators can correlate missing events with socket flaps.
      logger.info(`Slack socket "${this.channelDoc.name}" → ${state}`);
    };

    client.on("connected", () => setState("connected"));
    client.on("connecting", () => setState("connecting"));
    client.on("reconnecting", () => setState("reconnecting"));
    client.on("disconnecting", () => setState("disconnecting"));
    client.on("disconnected", () => setState("disconnected"));
    client.on("slack_event", () => {
      this.lastEventAt = new Date();
    });
  }

  getHealth(): ChannelHealth {
    const now = Date.now();
    const secondsSinceConnected = this.lastConnectedAt
      ? Math.round((now - this.lastConnectedAt.getTime()) / 1000)
      : undefined;
    const secondsSinceEvent = this.lastEventAt
      ? Math.round((now - this.lastEventAt.getTime()) / 1000)
      : undefined;
    const healthy = this.connected && this.socketState === "connected";

    return {
      name: this.channelDoc.name,
      type: this.channelDoc.type,
      connected: this.connected,
      healthy,
      state: this.socketState,
      secondsSinceConnected,
      secondsSinceEvent,
      detail: healthy ? undefined : `socket state is "${this.socketState}"`,
    };
  }

  async sendMessage(groupExternalId: string, content: string): Promise<void> {
    if (!this.app) {
      logger.error(
        `Cannot send message to ${groupExternalId} — Slack channel "${this.channelDoc.name}" not connected`
      );
      throw new Error("Slack channel not connected");
    }

    const config = this.channelDoc.config as {botToken?: string};
    if (!config.botToken) {
      throw new Error("No bot token configured");
    }

    logger.debug(
      `Sending message to ${groupExternalId} via "${this.channelDoc.name}" (${content.length} chars)`
    );

    await this.app.client.chat.postMessage({
      token: config.botToken,
      channel: groupExternalId,
      text: content,
    });

    logger.debug(`Message sent to ${groupExternalId} via "${this.channelDoc.name}"`);
  }

  async sendMessageWithTs(groupExternalId: string, content: string): Promise<string> {
    if (!this.app) {
      throw new Error("Slack channel not connected");
    }

    const config = this.channelDoc.config as {botToken?: string};
    if (!config.botToken) {
      throw new Error("No bot token configured");
    }

    const result = await this.app.client.chat.postMessage({
      token: config.botToken,
      channel: groupExternalId,
      text: content,
    });

    return result.ts || "";
  }

  /**
   * Walk every action_id in a block tree and substitute the SHADE_GROUP /
   * SHADE_CORR placeholders with real values, then assert the result is
   * within Slack's 255-character action_id ceiling.
   */
  private substituteActionIds(blocks: KnownBlock[], groupId: string, correlationId: string): void {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.action_id === "string") {
        const next = obj.action_id
          .replaceAll(SHADE_GROUP_PLACEHOLDER, groupId)
          .replaceAll(SHADE_CORR_PLACEHOLDER, correlationId);
        if (next.length > SLACK_ACTION_ID_MAX) {
          throw new Error(
            `action_id exceeds Slack ceiling (${next.length} > ${SLACK_ACTION_ID_MAX}): ${next}`
          );
        }
        obj.action_id = next;
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
          for (const item of v) visit(item);
        } else if (v && typeof v === "object") {
          visit(v);
        }
      }
    };
    for (const b of blocks) visit(b);
  }

  async sendRichMessage(
    groupExternalId: string,
    rendered: {blocks: KnownBlock[]; text: string},
    opts: RichSendOpts
  ): Promise<void> {
    if (!this.app) {
      throw new Error("Slack channel not connected");
    }
    const config = this.channelDoc.config as {botToken?: string};
    if (!config.botToken) {
      throw new Error("No bot token configured");
    }

    this.substituteActionIds(rendered.blocks, opts.groupId, opts.correlationId);

    logger.debug(
      `Sending rich message to ${groupExternalId} via "${this.channelDoc.name}" ` +
        `(${rendered.blocks.length} blocks, text=${rendered.text.length} chars, ` +
        `thread=${opts.threadTs ?? "none"})`
    );

    await this.app.client.chat.postMessage({
      token: config.botToken,
      channel: groupExternalId,
      text: rendered.text,
      blocks: rendered.blocks,
      thread_ts: opts.threadTs,
    });

    logger.debug(`Rich message sent to ${groupExternalId} via "${this.channelDoc.name}"`);
  }

  async updateMessage(groupExternalId: string, messageTs: string, content: string): Promise<void> {
    if (!this.app) {
      return;
    }

    const config = this.channelDoc.config as {botToken?: string};
    try {
      await this.app.client.chat.update({
        token: config.botToken,
        channel: groupExternalId,
        ts: messageTs,
        text: content,
      });
    } catch (err) {
      logger.debug(`Could not update message: ${err}`);
    }
  }

  async createChannel(name: string): Promise<{id: string}> {
    if (!this.app) {
      throw new Error("Slack channel not connected");
    }
    const config = this.channelDoc.config as {botToken?: string};
    const result = await this.app.client.conversations.create({
      token: config.botToken,
      name,
      is_private: false,
    });
    if (!result.channel?.id) {
      throw new Error("Failed to create Slack channel — no channel ID returned");
    }
    return {id: result.channel.id};
  }

  async inviteToChannel(channelId: string, userId: string): Promise<void> {
    if (!this.app) {
      throw new Error("Slack channel not connected");
    }
    const config = this.channelDoc.config as {botToken?: string};
    await this.app.client.conversations.invite({
      token: config.botToken,
      channel: channelId,
      users: userId,
    });
  }

  async addReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void> {
    if (!this.app) {
      return;
    }
    const config = this.channelDoc.config as {botToken?: string};
    try {
      await this.app.client.reactions.add({
        token: config.botToken,
        channel: groupExternalId,
        timestamp: messageTs,
        name: emoji,
      });
    } catch (err) {
      logger.debug(`Could not add reaction: ${err}`);
    }
  }

  async removeReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void> {
    if (!this.app) {
      return;
    }
    const config = this.channelDoc.config as {botToken?: string};
    try {
      await this.app.client.reactions.remove({
        token: config.botToken,
        channel: groupExternalId,
        timestamp: messageTs,
        name: emoji,
      });
    } catch (err) {
      logger.debug(`Could not remove reaction: ${err}`);
    }
  }
}

export const createSlackConnector: ConnectorFactory = (channelDoc) => {
  return new SlackChannelConnector(channelDoc);
};
