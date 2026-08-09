import {Database} from "bun:sqlite";
import os from "node:os";
import path from "node:path";
import type {MessagePayload} from "@shade/edge-agent-types";

interface IMessageRow {
  rowid: number;
  guid: string;
  text: string | null;
  attributedBody: Uint8Array | null;
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

// Modern macOS often leaves message.text NULL and stores the body only in the
// attributedBody typedstream blob (common for SMS/RCS), so select both.
// associated_message_type = 0 excludes tapbacks/edits, which also carry an
// attributedBody but aren't real messages.
const QUERY = `
  SELECT
    m.ROWID as rowid,
    m.guid,
    m.text,
    m.attributedBody,
    m.date,
    m.is_from_me,
    h.id as sender_id,
    c.chat_identifier,
    c.display_name
  FROM message m
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON c.ROWID = cmj.chat_id
  LEFT JOIN handle h ON h.ROWID = m.handle_id
  WHERE m.ROWID > ?1 AND m.is_from_me = 0
    AND m.associated_message_type = 0
    AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
  ORDER BY m.ROWID ASC
  LIMIT 50
`;

// Service of the most recently active chat for an identifier. The same phone
// number can have both an iMessage and an SMS chat row; the one with the
// latest message is the conversation we're actually in.
const SERVICE_QUERY = `
  SELECT c.service_name as service_name
  FROM chat c
  JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
  JOIN message m ON m.ROWID = cmj.message_id
  WHERE c.chat_identifier = ?1
  ORDER BY m.date DESC
  LIMIT 1
`;

/**
 * Extracts the plain text from an Apple typedstream attributedBody blob.
 * Layout after the "NSString" class name: a few tag bytes, then '+' (0x2b),
 * then the byte length (one byte, or 0x81 + uint16 LE for longer strings, or
 * 0x82 + uint32 LE), then that many UTF-8 bytes.
 */
export const parseAttributedBody = (blob: Uint8Array | null): string | null => {
  if (!blob || blob.length === 0) {
    return null;
  }

  const marker = new TextEncoder().encode("NSString");
  const idx = findBytes(blob, marker);
  if (idx === -1) {
    return null;
  }

  // Scan a short window after the class name for the '+' start-of-string tag
  let plus = -1;
  for (let i = idx + marker.length; i < Math.min(idx + marker.length + 16, blob.length); i++) {
    if (blob[i] === 0x2b) {
      plus = i;
      break;
    }
  }
  if (plus === -1 || plus + 1 >= blob.length) {
    return null;
  }

  let p = plus + 1;
  let length: number;
  const lengthTag = blob[p];
  if (lengthTag === 0x81) {
    length = blob[p + 1] | (blob[p + 2] << 8);
    p += 3;
  } else if (lengthTag === 0x82) {
    length = blob[p + 1] | (blob[p + 2] << 8) | (blob[p + 3] << 16) | (blob[p + 4] << 24);
    p += 5;
  } else {
    length = lengthTag;
    p += 1;
  }

  if (length <= 0 || p + length > blob.length) {
    return null;
  }

  return new TextDecoder("utf-8").decode(blob.slice(p, p + length));
};

const findBytes = (haystack: Uint8Array, needle: Uint8Array): number => {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
};

export class IMessageReader {
  private db: Database | null = null;
  private lastRowId = 0;
  private dbPath: string;
  private chatFilters: string[];

  constructor(dbPath?: string, chatFilters?: string[]) {
    this.dbPath = dbPath || path.join(os.homedir(), "Library/Messages/chat.db");
    this.chatFilters = chatFilters ?? [];
  }

  open(): void {
    this.db = new Database(this.dbPath, {readonly: true});

    // Start from the most recent message
    const latest = this.db
      .query<{max_rowid: number}, []>("SELECT COALESCE(MAX(ROWID), 0) as max_rowid FROM message")
      .get();
    this.lastRowId = latest?.max_rowid ?? 0;

    console.info(`iMessage reader opened (db: ${this.dbPath}, starting ROWID: ${this.lastRowId})`);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * The Messages service ("iMessage", "SMS", "RCS", …) of the most recently
   * active chat with this identifier, or null when unknown. Used to reply over
   * the transport the conversation actually uses — sending iMessage to an
   * SMS-only contact fails asynchronously with "Not Delivered".
   */
  getServiceForChat(chatIdentifier: string): string | null {
    if (!this.db) {
      return null;
    }

    const row = this.db
      .query<{service_name: string | null}, [string]>(SERVICE_QUERY)
      .get(chatIdentifier);
    return row?.service_name ?? null;
  }

  poll(): MessagePayload[] {
    if (!this.db) {
      return [];
    }

    const rows = this.db.query<IMessageRow, [number]>(QUERY).all(this.lastRowId);
    const messages: MessagePayload[] = [];

    for (const row of rows) {
      this.lastRowId = row.rowid;

      // Apply chat filters if configured
      if (this.chatFilters.length > 0 && !this.chatFilters.includes(row.chat_identifier)) {
        continue;
      }

      const content = row.text ?? parseAttributedBody(row.attributedBody);
      if (!content) {
        continue; // Attachment-only or unparseable message
      }

      const timestamp = appleNanosToDate(row.date);
      const sender = row.sender_id || "unknown";

      messages.push({
        externalId: row.guid,
        sender,
        senderExternalId: row.sender_id || "",
        content,
        groupExternalId: row.chat_identifier,
        timestamp: timestamp.toISOString(),
        metadata: {
          chatIdentifier: row.chat_identifier,
          displayName: row.display_name,
          rowid: row.rowid,
        },
      });
    }

    return messages;
  }
}
