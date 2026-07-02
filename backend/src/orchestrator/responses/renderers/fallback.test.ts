import {describe, expect, test} from "bun:test";
import {SCHEMA_VERSION} from "../schema";
import {FallbackTextRenderer} from "./fallback";

describe("FallbackTextRenderer", () => {
  test("returns fallbackText regardless of card content", () => {
    const renderer = new FallbackTextRenderer("email");
    const out = renderer.render({
      v: SCHEMA_VERSION,
      fallbackText: "just the text",
      cards: [
        {kind: "weather", location: "x", summary: "y", tempF: 70},
        {kind: "text", markdown: "ignored"},
      ],
    });
    expect(out).toEqual({text: "just the text"});
  });

  test("supportsRich is false", () => {
    expect(new FallbackTextRenderer("webhook").supportsRich).toBe(false);
  });

  test("preserves channelType", () => {
    expect(new FallbackTextRenderer("imessage").channelType).toBe("imessage");
  });
});
