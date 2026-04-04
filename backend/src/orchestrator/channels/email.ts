import {logger} from "@terreno/api";
import {ImapFlow} from "imapflow";
import type {ParsedMail} from "mailparser";
import {simpleParser} from "mailparser";
import type {Transporter} from "nodemailer";
import nodemailer from "nodemailer";
import {Channel} from "../../models/channel";
import type {ChannelDocument} from "../../types";
import {logError} from "../errors";
import type {ChannelConnector, ConnectorFactory, InboundMessage} from "./types";

interface EmailChannelConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
  tls?: boolean;
  pollIntervalMs?: number;
  mailbox?: string;
}

const DEFAULT_POLL_INTERVAL = 30_000;
const DEFAULT_MAILBOX = "INBOX";

/**
 * Extract the root Message-ID from an email thread.
 * Uses the first entry in the References header (the original message),
 * falling back to In-Reply-To, then the message's own Message-ID.
 */
const extractThreadId = (parsed: ParsedMail): string => {
  // References header contains the full thread chain, first entry is the root
  if (parsed.references && parsed.references.length > 0) {
    return parsed.references[0];
  }

  // In-Reply-To points to the immediate parent — use it if no References
  if (parsed.inReplyTo) {
    return parsed.inReplyTo;
  }

  // New thread — use this message's own ID
  return parsed.messageId || `unknown-${Date.now()}`;
};

/**
 * Build a plain-text content string from a parsed email.
 * Prefers text/plain, falls back to stripping HTML.
 */
const extractContent = (parsed: ParsedMail): string => {
  if (parsed.text) {
    return parsed.text.trim();
  }

  // Fall back to HTML with tags stripped
  if (parsed.html) {
    return parsed.html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return "(empty message)";
};

/**
 * Format a sender address from parsed email headers.
 */
const formatSender = (parsed: ParsedMail): {name: string; address: string} => {
  const from = parsed.from?.value?.[0];
  return {
    name: from?.name || from?.address || "unknown",
    address: from?.address || "unknown",
  };
};

export class EmailChannelConnector implements ChannelConnector {
  readonly channelDoc: ChannelDocument;
  private connected = false;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private imapClient: ImapFlow | null = null;
  private smtpTransport: Transporter | null = null;
  private config: EmailChannelConfig;
  private lastSeenUid = 0;

  constructor(channelDoc: ChannelDocument) {
    this.channelDoc = channelDoc;
    this.config = channelDoc.config as unknown as EmailChannelConfig;
  }

  async connect(): Promise<void> {
    const {imapHost, imapPort, smtpHost, smtpPort, user, password, tls = true} = this.config;
    const pollInterval = this.config.pollIntervalMs || DEFAULT_POLL_INTERVAL;
    const mailbox = this.config.mailbox || DEFAULT_MAILBOX;

    logger.info(`Connecting email channel "${this.channelDoc.name}" (${user} via ${imapHost})`);

    // Set up IMAP client
    this.imapClient = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: tls,
      auth: {user, pass: password},
      logger: false,
    });

    try {
      await this.imapClient.connect();
    } catch (err) {
      throw new Error(`Failed to connect to IMAP server ${imapHost}:${imapPort}: ${err}`);
    }

    // Get the highest UID in the mailbox so we only poll new messages
    try {
      const lock = await this.imapClient.getMailboxLock(mailbox);
      try {
        const status = await this.imapClient.status(mailbox, {uidNext: true});
        this.lastSeenUid = (status.uidNext || 1) - 1;
        logger.info(`Email starting from UID ${this.lastSeenUid} in ${mailbox}`);
      } finally {
        lock.release();
      }
    } catch (err) {
      logger.warn(`Could not determine initial UID, starting from 0: ${err}`);
      this.lastSeenUid = 0;
    }

    // Disconnect IMAP after initial setup — we'll reconnect on each poll
    // This avoids holding a persistent connection that can time out
    await this.imapClient.logout();
    this.imapClient = null;

    // Set up SMTP transport
    this.smtpTransport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {user, pass: password},
    });

    // Verify SMTP connection
    try {
      await this.smtpTransport.verify();
      logger.info(`SMTP verified for ${user} via ${smtpHost}:${smtpPort}`);
    } catch (err) {
      logger.warn(`SMTP verification failed (will retry on send): ${err}`);
    }

    // Start polling
    this.pollTimer = setInterval(() => {
      this.pollMessages().catch((err) => {
        logError(`Email poll error for "${this.channelDoc.name}"`, err);
      });
    }, pollInterval);

    this.connected = true;

    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {
        $set: {status: "connected", lastConnectedAt: new Date()},
      });
    } catch (err) {
      logger.error(`Failed to update email channel status: ${err}`);
    }

    logger.info(
      `Email channel "${this.channelDoc.name}" connected, polling every ${pollInterval}ms`
    );
  }

  private async pollMessages(): Promise<void> {
    if (!this.messageHandler) {
      return;
    }

    const {imapHost, imapPort, user, password, tls = true} = this.config;
    const mailbox = this.config.mailbox || DEFAULT_MAILBOX;

    // Create a fresh IMAP connection for each poll
    const client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: tls,
      auth: {user, pass: password},
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock(mailbox);

      try {
        // Search for unseen messages with UID greater than our last seen
        const uids = await client.search({seen: false, uid: `${this.lastSeenUid + 1}:*`});

        if (!uids || uids.length === 0) {
          return;
        }

        logger.debug(`Email poll found ${uids.length} new message(s)`);

        for await (const msg of client.fetch(uids, {source: true, uid: true, flags: true})) {
          if (msg.uid <= this.lastSeenUid) {
            continue;
          }

          if (!msg.source) {
            logger.warn(`Email UID ${msg.uid} has no source, skipping`);
            continue;
          }

          try {
            const parsed: ParsedMail = await simpleParser(msg.source);
            const sender = formatSender(parsed);
            const content = extractContent(parsed);
            const threadId = extractThreadId(parsed);

            logger.debug(
              `Email from ${sender.address}: "${parsed.subject}" (thread: ${threadId.substring(0, 40)})`
            );

            const toAddresses = parsed.to
              ? Array.isArray(parsed.to)
                ? parsed.to.map((a) => a.text)
                : [parsed.to.text]
              : [];
            const ccAddresses = parsed.cc
              ? Array.isArray(parsed.cc)
                ? parsed.cc.map((a) => a.text)
                : [parsed.cc.text]
              : [];

            await this.messageHandler({
              externalId: parsed.messageId || `uid-${msg.uid}`,
              sender: sender.name,
              senderExternalId: sender.address,
              content,
              groupExternalId: threadId,
              metadata: {
                subject: parsed.subject,
                messageId: parsed.messageId,
                inReplyTo: parsed.inReplyTo,
                references: parsed.references,
                threadId,
                from: sender.address,
                to: toAddresses,
                cc: ccAddresses,
                date: parsed.date?.toISOString(),
                uid: msg.uid,
                hasAttachments: (parsed.attachments?.length || 0) > 0,
                attachmentCount: parsed.attachments?.length || 0,
              },
            });

            // Mark as seen
            await client.messageFlagsAdd({uid: msg.uid}, ["\\Seen"]);
            this.lastSeenUid = Math.max(this.lastSeenUid, msg.uid);
          } catch (err) {
            logError(`Error processing email UID ${msg.uid}`, err);
          }
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      logError(`Email IMAP poll failed for "${this.channelDoc.name}"`, err);
    } finally {
      try {
        await client.logout();
      } catch {
        // Ignore logout errors
      }
    }
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting email channel "${this.channelDoc.name}"...`);

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.imapClient) {
      try {
        await this.imapClient.logout();
      } catch {
        // Ignore
      }
      this.imapClient = null;
    }

    if (this.smtpTransport) {
      this.smtpTransport.close();
      this.smtpTransport = null;
    }

    this.connected = false;

    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {
        $set: {status: "disconnected"},
      });
    } catch (err) {
      logger.error(`Failed to update email channel status: ${err}`);
    }

    logger.info(`Email channel "${this.channelDoc.name}" disconnected`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(groupExternalId: string, content: string): Promise<void> {
    if (!this.smtpTransport) {
      throw new Error("SMTP transport not initialized");
    }

    const {user} = this.config;

    // groupExternalId is a thread ID (Message-ID of the root email).
    // We need to look up the actual recipient from stored message metadata.
    // For now, we need the recipient address passed in the content or stored in the group.
    // The ChannelManager resolves groupExternalId from the Group model,
    // so we need to figure out the recipient.
    //
    // Convention: groupExternalId for email threads is the root Message-ID.
    // The Group's externalId stores this. The actual "to" address needs to come
    // from the group metadata or the last message in the thread.
    //
    // For direct sends (not thread replies), groupExternalId can be an email address.
    const isEmailAddress = groupExternalId.includes("@") && !groupExternalId.startsWith("<");

    if (isEmailAddress) {
      // Direct send to an email address
      await this.smtpTransport.sendMail({
        from: user,
        to: groupExternalId,
        text: content,
      });
      logger.debug(`Email sent to ${groupExternalId} (${content.length} chars)`);
    } else {
      // Thread reply — we need to reconstruct the reply headers.
      // The message metadata should have the recipient and subject stored by the group.
      // For now, log a warning if we can't determine the recipient.
      logger.warn(
        `Email thread reply to ${groupExternalId} — thread replies require recipient resolution from group metadata. Skipping send.`
      );
      // TODO: Look up the last inbound message in this thread to get the reply-to address
      // and reconstruct In-Reply-To/References headers for proper threading.
    }
  }

  async addReaction(_groupExternalId: string, _messageTs: string, _emoji: string): Promise<void> {
    // Email does not support reactions
  }

  async removeReaction(
    _groupExternalId: string,
    _messageTs: string,
    _emoji: string
  ): Promise<void> {
    // Email does not support reactions
  }

  async createChannel(_name: string): Promise<{id: string}> {
    throw new Error("Email channels do not support creating sub-channels");
  }

  async inviteToChannel(_channelId: string, _userId: string): Promise<void> {
    throw new Error("Email channels do not support inviting users");
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }
}

export const createEmailConnector: ConnectorFactory = (channelDoc) => {
  return new EmailChannelConnector(channelDoc);
};
