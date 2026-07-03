import {afterEach, describe, expect, test} from "bun:test";
import {AppConfig, loadAppConfig, reloadAppConfig} from "./appConfig";

describe("AppConfig richResponses + maps additions", () => {
  test("loadAppConfig returns documents with the new sections populated by defaults", async () => {
    await AppConfig.deleteMany({});
    const cfg = await loadAppConfig();
    expect(cfg.richResponses).toBeDefined();
    expect(cfg.richResponses.enabled).toBe(true);
    expect(cfg.richResponses.autoTruncate).toBe(true);
    expect(cfg.maps).toBeDefined();
    expect(cfg.maps.mapboxAccessToken).toBe("");
  });

  test("strict: throw rejects unknown fields but accepts the new ones", async () => {
    await AppConfig.deleteMany({});
    const doc = await AppConfig.create({
      richResponses: {enabled: false, autoTruncate: false},
      maps: {mapboxAccessToken: "pk.test"},
    });
    expect(doc.richResponses.enabled).toBe(false);
    expect(doc.richResponses.autoTruncate).toBe(false);
    expect(doc.maps.mapboxAccessToken).toBe("pk.test");
  });

  test("loadAppConfig returns memory defaults", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.memory).toBeDefined();
    expect(cfg.memory.enabled).toBe(true);
    expect(cfg.memory.maxFileChars).toBe(6000);
    expect(cfg.memory.maxSkillChars).toBe(8000);
    expect(cfg.memory.historySearchLimit).toBe(8);
  });

  test("strict: throw accepts explicit memory values", async () => {
    await AppConfig.deleteMany({});
    const doc = await AppConfig.create({
      memory: {enabled: false, maxFileChars: 1000, maxSkillChars: 2000, historySearchLimit: 3},
    });
    expect(doc.memory.enabled).toBe(false);
    expect(doc.memory.maxFileChars).toBe(1000);
    expect(doc.memory.maxSkillChars).toBe(2000);
    expect(doc.memory.historySearchLimit).toBe(3);
  });

  test("loadAppConfig returns taskWorker defaults", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.taskWorker).toBeDefined();
    expect(cfg.taskWorker.enabled).toBe(true);
    expect(cfg.taskWorker.concurrency).toBe(2);
    expect(cfg.taskWorker.pollMs).toBe(5000);
    expect(cfg.taskWorker.heartbeatMs).toBe(15000);
    expect(cfg.taskWorker.staleMs).toBe(60000);
    expect(cfg.taskWorker.taskTimeoutMs).toBe(900000);
  });

  test("strict: throw accepts explicit taskWorker values", async () => {
    await AppConfig.deleteMany({});
    const doc = await AppConfig.create({
      taskWorker: {
        enabled: false,
        concurrency: 4,
        pollMs: 1000,
        heartbeatMs: 2000,
        staleMs: 5000,
        taskTimeoutMs: 60000,
      },
    });
    expect(doc.taskWorker.enabled).toBe(false);
    expect(doc.taskWorker.concurrency).toBe(4);
    expect(doc.taskWorker.pollMs).toBe(1000);
    expect(doc.taskWorker.heartbeatMs).toBe(2000);
    expect(doc.taskWorker.staleMs).toBe(5000);
    expect(doc.taskWorker.taskTimeoutMs).toBe(60000);
  });

  test("cache invalidates on deleteMany so a stale doc is never saved", async () => {
    const original = await loadAppConfig();
    await AppConfig.deleteMany({});
    const fresh = await loadAppConfig();
    expect(fresh._id.toString()).not.toBe(original._id.toString());
    fresh.set("memory.enabled", false);
    await fresh.save();
  });

  test("cache invalidates on save", async () => {
    await AppConfig.deleteMany({});
    const original = await loadAppConfig();
    expect(original.richResponses.enabled).toBe(true);
    original.richResponses.enabled = false;
    await original.save();
    const reloaded = await reloadAppConfig();
    expect(reloaded.richResponses.enabled).toBe(false);
  });
});

describe("AppConfig gateway/worker split additions (IP-010)", () => {
  afterEach(async () => {
    // Leave a fresh default config behind so other suites see pristine state.
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });

  test("loadAppConfig returns taskWorker.runInGateway default true", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.taskWorker.runInGateway).toBe(true);
  });

  test("loadAppConfig returns scheduler.useTaskBoard default false", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.scheduler).toBeDefined();
    expect(cfg.scheduler.useTaskBoard).toBe(false);
  });

  test("strict: throw accepts explicit runInGateway and useTaskBoard values", async () => {
    await AppConfig.deleteMany({});
    const doc = await AppConfig.create({
      taskWorker: {runInGateway: false},
      scheduler: {useTaskBoard: true},
    });
    expect(doc.taskWorker.runInGateway).toBe(false);
    expect(doc.scheduler.useTaskBoard).toBe(true);
    // Sibling taskWorker defaults still apply when only runInGateway is set.
    expect(doc.taskWorker.enabled).toBe(true);
    expect(doc.taskWorker.taskTimeoutMs).toBe(900000);
  });
});

describe("AppConfig agent model tiers (IP-011)", () => {
  afterEach(async () => {
    // Leave a fresh default config behind so other suites see pristine state.
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });

  test("agent.auxiliaryModel defaults to the cheap Haiku tier", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.agent.auxiliaryModel).toBe("claude-haiku-4-5-20251001");
  });

  test("agent.model defaults to empty string (Agent SDK default)", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.agent.model).toBe("");
  });

  test("models.detector defaults to empty string, deferring to agent.auxiliaryModel", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.models.detector).toBe("");
  });

  test("strict: throw accepts explicit model tier values", async () => {
    await AppConfig.deleteMany({});
    const doc = await AppConfig.create({
      agent: {model: "claude-opus-4-6", auxiliaryModel: "claude-haiku-4-5-20251001"},
      models: {detector: "claude-haiku-4-5-20251001"},
    });
    expect(doc.agent.model).toBe("claude-opus-4-6");
    expect(doc.agent.auxiliaryModel).toBe("claude-haiku-4-5-20251001");
    expect(doc.models.detector).toBe("claude-haiku-4-5-20251001");
    // Sibling agent defaults still apply when only the models are set.
    expect(doc.agent.maxTurns).toBe(50);
    expect(doc.agent.enableSubagents).toBe(true);
  });
});
