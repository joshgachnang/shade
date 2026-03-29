import {Database} from "bun:sqlite";
import {execSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {logger} from "@terreno/api";
import {Channel} from "../../models/channel";
import type {ChannelDocument} from "../../types";
import {logError} from "../errors";
import type {ChannelConnector, ConnectorFactory, InboundMessage} from "./types";

interface IMessageRow {
  rowid: number;
  guid: string;
  text: string;
  date: number;
  is_from_me: number;
  sender_id: string | null;
  chat_identifier: string;
  display_name: string | null;
}

/** Apple epoch offset: seconds between Unix epoch (1970) and Apple epoch (2001-01-01) */
const APPLE_EPOCH_OFFSET = 978307200;

/** Convert Apple nanosecond timestamp to JS Date */
const appleNanosToDate = (appleNanos: number): Date => {
  const unixSeconds = appleNanos / 1_000_000_000 + APPLE_EPOCH_OFFSET;
  return new Date(unixSeconds * 1000);
};

/** Escape a string for use inside AppleScript double quotes */
const escapeAppleScript = (str: string): string => {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

export class IMessageChannelConnector implements ChannelConnector {
  readonly channelDoc: ChannelDocument;
  private connected = false;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private db: Database | null = null;
  private lastRowId = 0;

  constructor(channelDoc: ChannelDocument) {
    this.channelDoc = channelDoc;
  }

  async connect(): Promise<void> {
    const config = this.channelDoc.config as {
      dbPath?: string;
      pollIntervalMs?: number;
    };

    const dbPath = config.dbPath || path.join(os.homedir(), "Library/Messages/chat.db");
    const pollInterval = config.pollIntervalMs || 5000;

    logger.info(`Connecting iMessage channel "${this.channelDoc.name}" (db: ${dbPath})`);

    try {
      this.db = new Database(dbPath, {readonly: true});
    } catch (err) {
      throw new Error(
        `Failed to open iMessage database at ${dbPath}. Ensure Full Disk Access is granted: ${err}`
      );
    }

    // Start from the most recent message to avoid replaying history
    const latest = this.db
      .query<{max_rowid: number}, []>("SELECT COALESCE(MAX(ROWID), 0) as max_rowid FROM message")
      .get();
    this.lastRowId = latest?.max_rowid ?? 0;

    logger.info(`iMessage starting from ROWID ${this.lastRowId}`);

    this.pollTimer = setInterval(() => {
      this.pollMessages().catch((err) => {
        logError(`iMessage poll error for "${this.channelDoc.name}"`, err);
      });
    }, pollInterval);

    this.connected = true;

    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {
        $set: {status: "connected", lastConnectedAt: new Date()},
      });
    } catch (err) {
      logger.error(`Failed to update iMessage channel status: ${err}`);
    }

    logger.info(
      `iMessage channel "${this.channelDoc.name}" connected, polling every ${pollInterval}ms`
    );
  }

  private async pollMessages(): Promise<void> {
    if (!this.db || !this.messageHandler) {
      return;
    }

    const rows = this.db
      .query<IMessageRow, [number]>(`
      SELECT
        m.ROWID as rowid,
        m.guid,
        m.text,
        m.date,
        m.is_from_me,
        h.id as sender_id,
        c.chat_identifier,
        c.display_name
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.ROWID > ?1 AND m.is_from_me = 0 AND m.text IS NOT NULL
      ORDER BY m.ROWID ASC
      LIMIT 50
    `)
      .all(this.lastRowId);

    for (const row of rows) {
      this.lastRowId = row.rowid;

      const timestamp = appleNanosToDate(row.date);
      const sender = row.sender_id || "unknown";

      logger.debug(
        `iMessage from ${sender} in ${row.chat_identifier}: "${row.text.substring(0, 80)}"`
      );

      try {
        await this.messageHandler({
          externalId: row.guid,
          sender,
          senderExternalId: row.sender_id || "",
          content: row.text,
          groupExternalId: row.chat_identifier,
          metadata: {
            chatIdentifier: row.chat_identifier,
            displayName: row.display_name,
            timestamp: timestamp.toISOString(),
            rowid: row.rowid,
          },
        });
      } catch (err) {
        logError(`Error handling iMessage from ${sender}`, err);
      }
    }
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting iMessage channel "${this.channelDoc.name}"...`);

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.connected = false;

    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {
        $set: {status: "disconnected"},
      });
    } catch (err) {
      logger.error(`Failed to update iMessage channel status: ${err}`);
    }

    logger.info(`iMessage channel "${this.channelDoc.name}" disconnected`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(groupExternalId: string, content: string): Promise<void> {
    logger.debug(`Sending iMessage to ${groupExternalId} (${content.length} chars)`);

    const escapedContent = escapeAppleScript(content);
    const escapedTarget = escapeAppleScript(groupExternalId);

    // Determine if this is a group chat or individual
    // Group chats start with "chat" in their identifier
    const isGroupChat = groupExternalId.startsWith("chat");

    const script = isGroupChat
      ? `tell application "Messages"
  set targetChat to a reference to text chat id "${escapedTarget}"
  send "${escapedContent}" to targetChat
end tell`
      : `tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant "${escapedTarget}" of targetService
  send "${escapedContent}" to targetBuddy
end tell`;

    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        timeout: 10000,
        stdio: "pipe",
      });
      logger.debug(`iMessage sent to ${groupExternalId}`);
    } catch (err) {
      logger.error(`Failed to send iMessage to ${groupExternalId}: ${err}`);
      throw new Error(`Failed to send iMessage: ${err}`);
    }
  }

  async addReaction(_groupExternalId: string, _messageTs: string, _emoji: string): Promise<void> {
    // iMessage reactions (tapbacks) are not supported via AppleScript
  }

  async removeReaction(
    _groupExternalId: string,
    _messageTs: string,
    _emoji: string
  ): Promise<void> {
    // iMessage reactions (tapbacks) are not supported via AppleScript
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }
}

export const createIMessageConnector: ConnectorFactory = (channelDoc) => {
  return new IMessageChannelConnector(channelDoc);
};
