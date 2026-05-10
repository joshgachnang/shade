import {describe, expect, test} from "bun:test";
import {richResponseSystemPromptBlock} from "./promptBlock";

describe("richResponseSystemPromptBlock", () => {
  test("returns empty string when disabled", () => {
    expect(richResponseSystemPromptBlock({enabled: false})).toBe("");
  });

  test("returns a block containing the schema name and example kinds when enabled", () => {
    const out = richResponseSystemPromptBlock({enabled: true});
    expect(out).toContain("respond_with_card");
    expect(out).toContain("yes_no");
    expect(out).toContain("weather");
    expect(out).toContain("code");
    expect(out).toContain("fallbackText");
  });

  test("stays under a sensible token budget (rough char count)", () => {
    // ~4 chars per token; cap at ~6000 chars (~1500 tokens) to keep prompt cost down.
    const out = richResponseSystemPromptBlock({enabled: true});
    expect(out.length).toBeLessThan(8000);
  });
});
