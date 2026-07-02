import {App, LogLevel} from "@slack/bolt";
import type {GenericMessageEvent} from "@slack/types";
import {logger} from "@terreno/api";
import {logError} from "../errors";
import {BaseChannelConnector} from "./baseConnector";
import type {ConnectorFactory} from "./types";

/**
 * Slack Socket Mode connector.
 *
 * Reliability note: Slack load-balances events across every socket open for
 * the app token. If a previous `bun --watch` restart leaves a zombie socket
 * alive for ~30-60s, Slack will route some events to it and we lose them
 * silently (symptom: "sometimes the bot doesn't reply to untagged messages
 * in feature channels"). Mitigations here:
 *   1. Enable Bolt DEBUG logs so socket lifecycle (connected / reconnecting /
 *      disconnected) is visible in our log stream.
 *   2. Listen to SocketModeClient lifecycle events and surface them at info
 *      level so operators can correlate missing events with socket flaps.
 *   3. Make `disconnect()` actually wait for the socket to close so a clean
 *      SIGTERM (what `bun --watch` sends on file change) fully tears it down
 *      before the replacement process opens a new one.
 */
export class SlackChannelConnector extends BaseChannelConnector {
  private app: App | null = null;

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

    // Surface socket lifecycle at info level via @slack/socket-mode's
    // EventEmitter, which Bolt exposes via `app.receiver.client`. We cast to
    // loose types because Bolt doesn't export the receiver type directly.
    const receiver = (this.app as unknown as {receiver?: {client?: {on?: Function}}})
      .receiver;
    const socketClient = receiver?.client;
    if (socketClient && typeof socketClient.on === "function") {
      const on = socketClient.on.bind(socketClient);
      for (const state of [
        "connecting",
        "connected",
        "authenticated",
        "reconnecting",
        "disconnecting",
        "disconnected",
        "error",
      ] as const) {
        on(state, (arg: unknown) => {
          const detail =
            state === "error" && arg instanceof Error ? `: ${arg.message}` : "";
          logger.info(
            `Slack socket "${this.channelDoc.name}" state=${state}${detail}`
          );
        });
      }
    }

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

    // Handle Slack errors at the app level
    this.app.error(async (error) => {
      logger.error(`Slack app error in "${this.channelDoc.name}": ${error.message ?? error}`);
    });

    await this.app.start();
    this.connected = true;
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
      const socketClient = (this.app as unknown as {
        receiver?: {client?: {disconnect?: () => Promise<void>}};
      }).receiver?.client;
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

    await this.persistStatus("disconnected");

    logger.info(`Slack channel "${this.channelDoc.name}" disconnected`);
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
