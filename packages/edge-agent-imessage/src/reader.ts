import {Database} from "bun:sqlite";
import os from "node:os";
import path from "node:path";
import type {MessagePayload} from "@shade/edge-agent-types";

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

const QUERY = `
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
`;

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

      const timestamp = appleNanosToDate(row.date);
      const sender = row.sender_id || "unknown";

      messages.push({
        externalId: row.guid,
        sender,
        senderExternalId: row.sender_id || "",
        content: row.text,
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
