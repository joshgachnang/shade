import {describe, expect, test} from "bun:test";
import type {GroupDocument, MessageDocument} from "../types";
import {formatMessagesAsXml, formatOutboundMessage, matchesTrigger, shouldTrigger} from "./router";

const makeMessage = (overrides: Partial<MessageDocument> = {}): MessageDocument => {
  return {
    _id: "msg1",
    content: "hello",
    sender: "alice",
    isFromBot: false,
    created: new Date(),
    ...overrides,
  } as unknown as MessageDocument;
};

const makeGroup = (overrides: Partial<GroupDocument> = {}): GroupDocument => {
  return {
    _id: "group1",
    name: "test-group",
    trigger: "@Shade",
    requiresTrigger: false,
    ...overrides,
  } as unknown as GroupDocument;
};

describe("matchesTrigger", () => {
  test("matches exact trigger text", () => {
    expect(matchesTrigger("@Shade do something", "@Shade")).toBe(true);
  });

  test("matches case-insensitively", () => {
    expect(matchesTrigger("@shade do something", "@Shade")).toBe(true);
    expect(matchesTrigger("@SHADE do something", "@Shade")).toBe(true);
  });

  test("returns false when trigger is absent", () => {
    expect(matchesTrigger("hello world", "@Shade")).toBe(false);
  });

  test("escapes regex special characters in trigger", () => {
    expect(matchesTrigger("use @Bot++ now", "@Bot++")).toBe(true);
    expect(matchesTrigger("hello world", "@Bot++")).toBe(false);
  });

  test("matches trigger anywhere in content", () => {
    expect(matchesTrigger("hey @Shade what's up", "@Shade")).toBe(true);
    expect(matchesTrigger("what's up @Shade", "@Shade")).toBe(true);
  });
});

describe("formatMessagesAsXml", () => {
  test("formats user messages correctly", () => {
    const messages = [makeMessage({content: "hello", sender: "alice", isFromBot: false})];
    const result = formatMessagesAsXml(messages, "Shade");

    expect(result).toContain('<message role="user" sender="alice">');
    expect(result).toContain("hello");
    expect(result).toContain("<conversation>");
    expect(result).toContain("</conversation>");
  });

  test("formats bot messages with assistant role", () => {
    const messages = [makeMessage({content: "hi there", sender: "Shade", isFromBot: true})];
    const result = formatMessagesAsXml(messages, "Shade");

    expect(result).toContain('<message role="assistant" sender="Shade">');
    expect(result).toContain("hi there");
  });

  test("escapes XML special characters in content", () => {
    const messages = [makeMessage({content: '<script>alert("xss")</script>'})];
    const result = formatMessagesAsXml(messages, "Shade");

    expect(result).toContain("&lt;script&gt;");
    expect(result).toContain("&quot;xss&quot;");
    expect(result).not.toContain("<script>");
  });

  test("escapes XML special characters in sender", () => {
    const messages = [makeMessage({sender: 'Bob "The Builder"'})];
    const result = formatMessagesAsXml(messages, "Shade");

    expect(result).toContain("Bob &quot;The Builder&quot;");
  });

  test("handles empty message list", () => {
    const result = formatMessagesAsXml([], "Shade");
    expect(result).toBe("<conversation>\n</conversation>");
  });

  test("preserves message order", () => {
    const messages = [
      makeMessage({content: "first", sender: "alice"}),
      makeMessage({content: "second", sender: "bob"}),
      makeMessage({content: "third", sender: "alice"}),
    ];
    const result = formatMessagesAsXml(messages, "Shade");
    const firstIdx = result.indexOf("first");
    const secondIdx = result.indexOf("second");
    const thirdIdx = result.indexOf("third");

    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });
});

describe("formatOutboundMessage", () => {
  test("returns plain text unchanged", () => {
    expect(formatOutboundMessage("Hello world", "Shade")).toBe("Hello world");
  });

  test("strips internal tags", () => {
    const input = "Hello <internal>thinking about response</internal> world";
    expect(formatOutboundMessage(input, "Shade")).toBe("Hello  world");
  });

  test("strips multiple internal tags", () => {
    const input = "<internal>thought 1</internal>Hello<internal>thought 2</internal>";
    expect(formatOutboundMessage(input, "Shade")).toBe("Hello");
  });

  test("strips multiline internal tags", () => {
    const input = "Hello\n<internal>\nsome\nthoughts\n</internal>\nworld";
    expect(formatOutboundMessage(input, "Shade")).toBe("Hello\n\nworld");
  });

  test("trims whitespace", () => {
    expect(formatOutboundMessage("  Hello  ", "Shade")).toBe("Hello");
  });

  test("handles empty string", () => {
    expect(formatOutboundMessage("", "Shade")).toBe("");
  });
});

describe("shouldTrigger", () => {
  test("always returns true when requiresTrigger is false", () => {
    const group = makeGroup({requiresTrigger: false});
    expect(shouldTrigger("anything", group)).toBe(true);
    expect(shouldTrigger("", group)).toBe(true);
  });

  test("checks trigger when requiresTrigger is true", () => {
    const group = makeGroup({requiresTrigger: true, trigger: "@Shade"});
    expect(shouldTrigger("@Shade help me", group)).toBe(true);
    expect(shouldTrigger("hello world", group)).toBe(false);
  });

  test("uses case-insensitive matching", () => {
    const group = makeGroup({requiresTrigger: true, trigger: "@Shade"});
    expect(shouldTrigger("@shade help", group)).toBe(true);
  });
});
