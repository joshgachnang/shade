import {afterEach, describe, expect, test} from "bun:test";
import {Database} from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {IMessageReader, parseAttributedBody} from "./reader";

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

// Real attributedBody prefix from an SMS in chat.db whose `text` column was
// NULL — the case that made the reader silently drop messages.
const REAL_BLOB_HEX =
  "040B73747265616D747970656481E803840140848484194E534D757461626C6541747472696275746564537472696E67008484124E5341747472696275746564537472696E67008484084E534F626A6563740085928484840F4E534D757461626C65537472696E67018484084E53537472696E67019584012B4142756C6B534D532E636F6D20636F76657273206F7665722031323030206E6574776F726B7320776F726C64776964652C20696E636C7564696E6720796F757273218684026949010B928484840C4E";

describe("parseAttributedBody", () => {
  test("extracts text from a real typedstream blob (NULL text column SMS)", () => {
    expect(parseAttributedBody(hexToBytes(REAL_BLOB_HEX))).toBe(
      "BulkSMS.com covers over 1200 networks worldwide, including yours!"
    );
  });

  test("handles the 0x81 two-byte length form for long messages", () => {
    const text = "x".repeat(300);
    const prefix = new TextEncoder().encode("NSString");
    const blob = new Uint8Array([
      ...prefix,
      0x01,
      0x95,
      0x84,
      0x01,
      0x2b, // '+' start-of-string tag
      0x81,
      300 & 0xff,
      (300 >> 8) & 0xff,
      ...new TextEncoder().encode(text),
    ]);
    expect(parseAttributedBody(blob)).toBe(text);
  });

  test("returns null for null, empty, or non-typedstream input", () => {
    expect(parseAttributedBody(null)).toBeNull();
    expect(parseAttributedBody(new Uint8Array(0))).toBeNull();
    expect(parseAttributedBody(new TextEncoder().encode("not a typedstream"))).toBeNull();
  });

  test("returns null when the declared length overruns the blob", () => {
    const prefix = new TextEncoder().encode("NSString");
    const blob = new Uint8Array([...prefix, 0x01, 0x95, 0x84, 0x01, 0x2b, 0xff, 0x61, 0x62]);
    expect(parseAttributedBody(blob)).toBeNull();
  });
});

describe("getServiceForChat", () => {
  const tempPaths: string[] = [];

  afterEach(() => {
    for (const p of tempPaths.splice(0)) {
      fs.rmSync(p, {force: true});
    }
  });

  // Minimal chat.db slice: just the tables/columns the reader queries.
  const createFixtureDb = (): string => {
    const dbPath = path.join(os.tmpdir(), `chatdb-test-${Math.random().toString(36).slice(2)}.db`);
    tempPaths.push(dbPath);

    const db = new Database(dbPath);
    db.run(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, date INTEGER)`);
    db.run(
      `CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, service_name TEXT)`
    );
    db.run(`CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER)`);

    // +15550001111 has both an old iMessage chat and a newer SMS chat.
    db.run(`INSERT INTO chat VALUES (1, '+15550001111', 'iMessage')`);
    db.run(`INSERT INTO chat VALUES (2, '+15550001111', 'SMS')`);
    db.run(`INSERT INTO chat VALUES (3, '+15550002222', 'iMessage')`);
    db.run(`INSERT INTO message VALUES (1, 100)`);
    db.run(`INSERT INTO message VALUES (2, 200)`);
    db.run(`INSERT INTO message VALUES (3, 150)`);
    db.run(`INSERT INTO chat_message_join VALUES (1, 1)`);
    db.run(`INSERT INTO chat_message_join VALUES (2, 2)`);
    db.run(`INSERT INTO chat_message_join VALUES (3, 3)`);
    db.close();

    return dbPath;
  };

  test("returns the service of the most recently active chat for the identifier", () => {
    const reader = new IMessageReader(createFixtureDb());
    reader.open();
    expect(reader.getServiceForChat("+15550001111")).toBe("SMS");
    expect(reader.getServiceForChat("+15550002222")).toBe("iMessage");
    reader.close();
  });

  test("returns null for an unknown identifier", () => {
    const reader = new IMessageReader(createFixtureDb());
    reader.open();
    expect(reader.getServiceForChat("+19998887777")).toBeNull();
    reader.close();
  });

  test("returns null when the reader is not open", () => {
    const reader = new IMessageReader(createFixtureDb());
    expect(reader.getServiceForChat("+15550001111")).toBeNull();
  });
});
