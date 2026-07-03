import {describe, expect, test} from "bun:test";
import {memorySystemPromptBlock} from "./memoryPromptBlock";

describe("memorySystemPromptBlock", () => {
  test("returns empty string when disabled", () => {
    expect(memorySystemPromptBlock({enabled: false})).toBe("");
  });

  test("returns a block naming each memory tool when enabled", () => {
    const out = memorySystemPromptBlock({enabled: true});
    expect(out).toContain("## Memory & Learning");
    expect(out).toContain("search_history");
    expect(out).toContain("update_memory");
    expect(out).toContain("save_skill");
    expect(out).toContain("list_skills");
    expect(out).toContain("load_skill");
  });

  test("stays under a sensible token budget (rough char count)", () => {
    // ~4 chars per token; keep this well under the rich-response block's cap.
    const out = memorySystemPromptBlock({enabled: true});
    expect(out.length).toBeLessThan(2000);
  });
});
