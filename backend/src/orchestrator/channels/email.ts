import {logger} from "@terreno/api";
import {ImapFlow} from "imapflow";
import type {ParsedMail} from "mailparser";
import {simpleParser} from "mailparser";
import type {Transporter} from "nodemailer";
import nodemailer from "nodemailer";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import type {ChannelDocument} from "../../types";
import {logError} from "../errors";
import {BaseChannelConnector} from "./baseConnector";
import type {ConnectorFactory, InboundMessage} from "./types";

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

/**
 * Normalize a References value (mailparser yields string | string[] | undefined,
 * and stored metadata is untyped) into a clean string array.
 */
const normalizeReferences = (references: unknown): string[] => {
  if (Array.isArray(references)) {
    return references.filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
  }
  if (typeof references === "string" && references.length > 0) {
    return [references];
  }
  return [];
};

/**
 * Build a reply subject, prefixing `Re: ` unless the subject already has a
 * Re: prefix (case-insensitive).
 */
const buildReplySubject = (subject: string | undefined): string | undefined => {
  if (!subject) {
    return undefined;
  }
  if (/^\s*re:/i.test(subject)) {
    return subject;
  }
  return `Re: ${subject}`;
};

/**
 * Resolved threading target for an outbound reply, derived from the most
 * recent inbound email message in the group.
 */
interface EmailThreadTarget {
  to: string;
  subject?: string;
  inReplyTo: string;
  references: string[];
}

/**
 * Build the InboundMessage payload (including threading metadata persisted on
 * the Message document) from a parsed inbound email. Exported for tests.
 */
export const buildInboundEmailMessage = (parsed: ParsedMail, uid: number): InboundMessage => {
  const sender = formatSender(parsed);
  const content = extractContent(parsed);
  const threadId = extractThreadId(parsed);

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

  return {
    externalId: parsed.messageId || `uid-${uid}`,
    sender: sender.name,
    senderExternalId: sender.address,
    content,
    groupExternalId: threadId,
    metadata: {
      subject: parsed.subject,
      messageId: parsed.messageId,
      // Canonical key used by sendMessage to resolve reply threading.
      emailMessageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: normalizeReferences(parsed.references),
      threadId,
      from: sender.address,
      to: toAddresses,
      cc: ccAddresses,
      date: parsed.date?.toISOString(),
      uid,
      hasAttachments: (parsed.attachments?.length || 0) > 0,
      attachmentCount: parsed.attachments?.length || 0,
    },
  };
};

export class EmailChannelConnector extends BaseChannelConnector {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private imapClient: ImapFlow | null = null;
  private smtpTransport: Transporter | null = null;
  private config: EmailChannelConfig;
  private lastSeenUid = 0;

  constructor(channelDoc: ChannelDocument) {
    super(channelDoc);
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

    await this.persistStatus("connected");

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
            const inbound = buildInboundEmailMessage(parsed, msg.uid);

            logger.debug(
              `Email from ${inbound.senderExternalId}: "${parsed.subject}" (thread: ${inbound.groupExternalId.substring(0, 40)})`
            );

            await this.messageHandler(inbound);

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

    await this.persistStatus("disconnected");

    logger.info(`Email channel "${this.channelDoc.name}" disconnected`);
  }

  /**
   * Find the most recent inbound email Message in the group and derive reply
   * threading (recipient, In-Reply-To, References, Re: subject) from its
   * stored metadata. Returns null when the group or a threadable message
   * can't be found, in which case callers fall back to a direct send.
   */
  private async resolveThreadTarget(groupExternalId: string): Promise<EmailThreadTarget | null> {
    const group = await Group.findOneOrNone({
      channelId: this.channelDoc._id,
      externalId: groupExternalId,
    });
    if (!group) {
      return null;
    }

    const [lastInbound] = await Message.find({
      groupId: group._id,
      isFromBot: false,
      "metadata.emailMessageId": {$exists: true, $ne: null},
    })
      .sort({created: -1, _id: -1})
      .limit(1);
    if (!lastInbound) {
      return null;
    }

    const meta = (lastInbound.metadata ?? {}) as Record<string, unknown>;
    const emailMessageId = typeof meta.emailMessageId === "string" ? meta.emailMessageId : "";
    const from = typeof meta.from === "string" ? meta.from : "";
    if (!emailMessageId || !from.includes("@")) {
      return null;
    }

    // References for the reply = the original chain plus the message we're replying to.
    const references = normalizeReferences(meta.references);
    if (!references.includes(emailMessageId)) {
      references.push(emailMessageId);
    }

    return {
      to: from,
      subject: buildReplySubject(typeof meta.subject === "string" ? meta.subject : undefined),
      inReplyTo: emailMessageId,
      references,
    };
  }

  async sendMessage(groupExternalId: string, content: string): Promise<void> {
    if (!this.smtpTransport) {
      throw new Error("SMTP transport not initialized");
    }

    const {user} = this.config;

    // Prefer replying to the most recent inbound email in the group so the
    // reply goes to the actual sender and threads in their mail client.
    const threadTarget = await this.resolveThreadTarget(groupExternalId);
    if (threadTarget) {
      logger.debug(
        `Email reply resolved thread target ${threadTarget.to} (In-Reply-To: ${threadTarget.inReplyTo})`
      );
      await this.smtpTransport.sendMail({
        from: user,
        to: threadTarget.to,
        subject: threadTarget.subject,
        inReplyTo: threadTarget.inReplyTo,
        references: threadTarget.references,
        text: content,
      });
      logger.debug(`Email reply sent to ${threadTarget.to} (${content.length} chars)`);
      return;
    }

    // Fallback: no inbound email with threading metadata (e.g. a scheduled
    // task's first outbound). For direct sends, groupExternalId can be an
    // email address; thread IDs are wrapped in angle brackets.
    const isEmailAddress = groupExternalId.includes("@") && !groupExternalId.startsWith("<");

    if (isEmailAddress) {
      logger.debug(
        `Email thread target not resolved for ${groupExternalId} — falling back to direct send`
      );
      await this.smtpTransport.sendMail({
        from: user,
        to: groupExternalId,
        text: content,
      });
      logger.debug(`Email sent to ${groupExternalId} (${content.length} chars)`);
    } else {
      logger.warn(
        `Email thread reply to ${groupExternalId} — no inbound email with threading metadata found and the external ID is not an address. Skipping send.`
      );
    }
  }

  async sendMessageWithTs(_groupExternalId: string, _content: string): Promise<string> {
    return "";
  }

  async updateMessage(
    _groupExternalId: string,
    _messageTs: string,
    _content: string
  ): Promise<void> {}

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
}

export const createEmailConnector: ConnectorFactory = (channelDoc) => {
  return new EmailChannelConnector(channelDoc);
};
