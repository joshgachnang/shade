import {afterEach, describe, expect, test} from "bun:test";
import {AppConfig, reloadAppConfig} from "../../models/appConfig";
import {buildAllowedTools, SHADE_MCP_WILDCARD} from "./direct";

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
