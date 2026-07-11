import {describe, expect, test} from "bun:test";
import {parseAttributedBody} from "./reader";

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
