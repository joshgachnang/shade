import {afterEach, describe, expect, test} from "bun:test";
import {AppConfig, reloadAppConfig} from "../../models/appConfig";
import {buildAllowedTools, resolveModel, SHADE_MCP_WILDCARD} from "./direct";

const CONFIGURED_DEFAULTS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

describe("buildAllowedTools", () => {
  test("includes Task and the shade MCP wildcard when subagents are enabled", () => {
    const tools = buildAllowedTools({configured: CONFIGURED_DEFAULTS, enableSubagents: true});
    expect(tools).toContain("Task");
    expect(tools).toContain(SHADE_MCP_WILDCARD);
    for (const tool of CONFIGURED_DEFAULTS) {
      expect(tools).toContain(tool);
    }
  });

  test("omits Task when subagents are disabled", () => {
    const tools = buildAllowedTools({configured: CONFIGURED_DEFAULTS, enableSubagents: false});
    expect(tools).not.toContain("Task");
    expect(tools).toContain(SHADE_MCP_WILDCARD);
    expect(tools).toEqual([...CONFIGURED_DEFAULTS, SHADE_MCP_WILDCARD]);
  });

  test("preserves configured order and does not duplicate existing entries", () => {
    const configured = ["Task", SHADE_MCP_WILDCARD, "Read"];
    const tools = buildAllowedTools({configured, enableSubagents: true});
    expect(tools).toEqual(configured);
    expect(tools.filter((t) => t === "Task")).toHaveLength(1);
    expect(tools.filter((t) => t === SHADE_MCP_WILDCARD)).toHaveLength(1);
  });

  test("does not mutate the configured array", () => {
    const configured = ["Read"];
    buildAllowedTools({configured, enableSubagents: true});
    expect(configured).toEqual(["Read"]);
  });

  test("handles an empty configured list", () => {
    expect(buildAllowedTools({configured: [], enableSubagents: true})).toEqual([
      SHADE_MCP_WILDCARD,
      "Task",
    ]);
    expect(buildAllowedTools({configured: [], enableSubagents: false})).toEqual([
      SHADE_MCP_WILDCARD,
    ]);
  });
});

describe("resolveModel", () => {
  test("per-group override wins over the global default", () => {
    expect(
      resolveModel({groupModel: "claude-opus-4-6", globalModel: "claude-sonnet-4-20250514"})
    ).toBe("claude-opus-4-6");
  });

  test("falls back to the global default when the group has no override", () => {
    expect(resolveModel({groupModel: undefined, globalModel: "claude-sonnet-4-20250514"})).toBe(
      "claude-sonnet-4-20250514"
    );
    expect(resolveModel({groupModel: "", globalModel: "claude-sonnet-4-20250514"})).toBe(
      "claude-sonnet-4-20250514"
    );
  });

  test("returns undefined when neither is set (SDK default)", () => {
    expect(resolveModel({})).toBeUndefined();
    expect(resolveModel({groupModel: "", globalModel: ""})).toBeUndefined();
  });

  test("treats whitespace-only values as unset", () => {
    expect(resolveModel({groupModel: "   ", globalModel: "claude-sonnet-4-20250514"})).toBe(
      "claude-sonnet-4-20250514"
    );
    expect(resolveModel({groupModel: "  ", globalModel: " "})).toBeUndefined();
  });
});

describe("AppConfig agent.model", () => {
  afterEach(async () => {
    // Leave AppConfig in its default state for other test files.
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });

  test("defaults to empty string, resolving to the SDK default model", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.agent.model).toBe("");
    expect(resolveModel({groupModel: undefined, globalModel: cfg.agent.model})).toBeUndefined();
  });

  test("a configured global model applies to groups without an override", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    cfg.set("agent.model", "claude-opus-4-6");
    await cfg.save();

    const reloaded = await reloadAppConfig();
    expect(resolveModel({groupModel: undefined, globalModel: reloaded.agent.model})).toBe(
      "claude-opus-4-6"
    );
    // A group-level override still wins over the configured global default.
    expect(
      resolveModel({groupModel: "claude-haiku-4-5-20251001", globalModel: reloaded.agent.model})
    ).toBe("claude-haiku-4-5-20251001");
  });
});

describe("AppConfig agent.enableSubagents", () => {
  afterEach(async () => {
    // Leave AppConfig in its default state for other test files.
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });

  test("defaults to true", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.agent.enableSubagents).toBe(true);
  });

  test("can be disabled, which excludes Task from allowed tools", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    cfg.set("agent.enableSubagents", false);
    await cfg.save();

    const reloaded = await reloadAppConfig();
    expect(reloaded.agent.enableSubagents).toBe(false);

    const tools = buildAllowedTools({
      configured: reloaded.agent.allowedTools ?? [],
      enableSubagents: reloaded.agent.enableSubagents !== false,
    });
    expect(tools).not.toContain("Task");
    expect(tools).toContain(SHADE_MCP_WILDCARD);
  });
});
