import { describe, expect, test } from "bun:test";

describe("models", () => {
  test("all models export correctly", async () => {
    const models = await import("./index");
    expect(models.User).toBeDefined();
    expect(models.Channel).toBeDefined();
    expect(models.Group).toBeDefined();
    expect(models.Message).toBeDefined();
    expect(models.ScheduledTask).toBeDefined();
    expect(models.TaskRunLog).toBeDefined();
    expect(models.AgentSession).toBeDefined();
    expect(models.RemoteAgent).toBeDefined();
    expect(models.CommandClassification).toBeDefined();
    expect(models.Plugin).toBeDefined();
    expect(models.WebhookSource).toBeDefined();
  });
});
