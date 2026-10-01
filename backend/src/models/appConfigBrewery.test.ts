import {describe, expect, test} from "bun:test";
import {AppConfig, reloadAppConfig} from "./appConfig";

describe("AppConfig brewery settings", () => {
  test("a fresh config exposes brewery defaults", async () => {
    await AppConfig.deleteMany({});
    const config = await reloadAppConfig();

    expect(config.brewery.command).toBe("brewery");
    expect(config.brewery.pollIntervalMs).toBe(5000);
    expect(config.brewery.narrationFlushMs).toBe(4000);
    expect(config.brewery.maxNarrationLines).toBe(8);
    expect(config.brewery.agents).toBe("");
    expect(config.brewery.stepSilenceAlertMin).toBe(30);
  });

  test("an existing config without brewery settings receives the defaults", async () => {
    await AppConfig.deleteMany({});
    await AppConfig.collection.insertOne({assistantName: "Legacy"});

    const config = await reloadAppConfig();
    expect(config.assistantName).toBe("Legacy");
    expect(config.brewery.command).toBe("brewery");
    expect(config.brewery.maxNarrationLines).toBe(8);
  });

  test("admin-editable brewery settings persist with sibling defaults", async () => {
    await AppConfig.deleteMany({});
    const config = await reloadAppConfig();
    config.set("brewery", {command: "/opt/bin/brewery", pollIntervalMs: 1000, agents: "codex"});
    await config.save();

    const reloaded = await reloadAppConfig();
    expect(reloaded.brewery.command).toBe("/opt/bin/brewery");
    expect(reloaded.brewery.pollIntervalMs).toBe(1000);
    expect(reloaded.brewery.agents).toBe("codex");
    expect(reloaded.brewery.narrationFlushMs).toBe(4000);
    expect(reloaded.brewery.maxNarrationLines).toBe(8);
    expect(reloaded.brewery.stepSilenceAlertMin).toBe(30);
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });
});
