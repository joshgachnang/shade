import {afterAll, describe, expect, test} from "bun:test";
import {LlmFixture, MAX_FIXTURE_PATTERN_LENGTH} from "./llmFixture";

describe("LlmFixture", () => {
  afterAll(async () => {
    await LlmFixture.deleteMany({});
  });

  test("creates a fixture with actions", async () => {
    const fixture = await LlmFixture.create({
      name: "greeting",
      match: {pattern: "hello"},
      response: "Hi there!",
      actions: [{tool: "send_message", args: {content: "side effect"}}],
      priority: 10,
    });

    expect(fixture.name).toBe("greeting");
    expect(fixture.actions).toHaveLength(1);
    expect(fixture.consumeOnce).toBe(false);
  });

  test("rejects an invalid regex pattern at save time", async () => {
    expect(LlmFixture.create({name: "bad", match: {pattern: "("}, response: "x"})).rejects.toThrow(
      /pattern/
    );
  });

  test("rejects patterns over the length cap", async () => {
    expect(
      LlmFixture.create({
        name: "long",
        match: {pattern: "a".repeat(MAX_FIXTURE_PATTERN_LENGTH + 1)},
        response: "x",
      })
    ).rejects.toThrow(/pattern/);
  });

  test("rejects unknown action tools", async () => {
    expect(
      LlmFixture.create({
        name: "bad-tool",
        response: "x",
        actions: [{tool: "rm_rf", args: {}}],
      })
    ).rejects.toThrow();
  });
});
