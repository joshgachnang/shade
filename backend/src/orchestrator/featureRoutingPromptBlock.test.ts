import {describe, expect, test} from "bun:test";
import {featureRoutingPromptBlock} from "./featureRoutingPromptBlock";

describe("featureRoutingPromptBlock", () => {
  test("returns the routing instructions for main groups", () => {
    const block = featureRoutingPromptBlock({isMain: true});
    expect(block).toContain("create_feature");
    expect(block).toContain("kebab-case");
    // The block must forbid inline planning/implementation, not just suggest the tool.
    expect(block).toContain("do NOT plan");
  });

  test("returns an empty string for non-main groups", () => {
    expect(featureRoutingPromptBlock({isMain: false})).toBe("");
  });
});
