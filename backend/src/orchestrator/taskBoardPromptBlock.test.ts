import {describe, expect, test} from "bun:test";
import {taskBoardSystemPromptBlock} from "./taskBoardPromptBlock";

describe("taskBoardSystemPromptBlock", () => {
  test("returns empty string when disabled", () => {
    expect(taskBoardSystemPromptBlock({enabled: false})).toBe("");
  });

  test("returns a block naming each task board tool when enabled", () => {
    const out = taskBoardSystemPromptBlock({enabled: true});
    expect(out).toContain("## Background Task Delegation");
    expect(out).toContain("delegate_task");
    expect(out).toContain("get_task_result");
    expect(out).toContain("list_agent_tasks");
    expect(out).toContain("cancel_agent_task");
  });

  test("covers the key delegation guidance", () => {
    const out = taskBoardSystemPromptBlock({enabled: true});
    expect(out).toContain("in the background");
    expect(out).toContain("deliverResult");
    expect(out).toContain("cannot delegate further");
  });

  test("stays under a sensible token budget (rough char count)", () => {
    // ~4 chars per token; keep this well under the rich-response block's cap.
    const out = taskBoardSystemPromptBlock({enabled: true});
    expect(out.length).toBeLessThan(2000);
  });
});
