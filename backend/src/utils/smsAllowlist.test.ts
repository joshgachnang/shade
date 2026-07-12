import {describe, expect, test} from "bun:test";
import {isHandleAllowed, normalizeHandle} from "./smsAllowlist";

describe("normalizeHandle", () => {
  test("strips formatting from phone numbers", () => {
    expect(normalizeHandle("+1 (910) 275-5241")).toBe("19102755241");
    expect(normalizeHandle("910.275.5241")).toBe("9102755241");
  });

  test("lowercases email handles", () => {
    expect(normalizeHandle("Josh@Nang.io")).toBe("josh@nang.io");
  });

  test("trims whitespace", () => {
    expect(normalizeHandle("  +19102755241  ")).toBe("19102755241");
  });
});

describe("isHandleAllowed", () => {
  const allowlist = ["+19102755241", "josh@nang.io"];

  test("matches exact E.164 number", () => {
    expect(isHandleAllowed("+19102755241", allowlist)).toBe(true);
  });

  test("matches number regardless of formatting", () => {
    expect(isHandleAllowed("(910) 275-5241", allowlist)).toBe(true);
  });

  test("matches bare 10-digit number against +1-prefixed entry", () => {
    expect(isHandleAllowed("9102755241", allowlist)).toBe(true);
  });

  test("matches +1-prefixed number against bare 10-digit entry", () => {
    expect(isHandleAllowed("+19102755241", ["9102755241"])).toBe(true);
  });

  test("matches email handles case-insensitively", () => {
    expect(isHandleAllowed("Josh@Nang.io", allowlist)).toBe(true);
  });

  test("rejects numbers not on the list", () => {
    expect(isHandleAllowed("+17158647606", allowlist)).toBe(false);
  });

  test("rejects short fragments that merely suffix-match", () => {
    expect(isHandleAllowed("5241", allowlist)).toBe(false);
  });

  test("rejects everything when the allowlist is empty", () => {
    expect(isHandleAllowed("+19102755241", [])).toBe(false);
  });

  test("rejects missing or empty handles", () => {
    expect(isHandleAllowed(undefined, allowlist)).toBe(false);
    expect(isHandleAllowed("", allowlist)).toBe(false);
  });

  test("does not treat an email as matching a phone entry", () => {
    expect(isHandleAllowed("josh@nang.io", ["+19102755241"])).toBe(false);
  });
});
