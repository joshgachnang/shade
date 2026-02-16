import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {
  buildAgentEnv,
  createPreToolUseHook,
  getSanitizedEnvForShell,
  redactSecrets,
} from "./security";

describe("buildAgentEnv", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test("passes through ANTHROPIC_API_KEY when present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    const env = buildAgentEnv();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test-key");
  });

  test("omits ANTHROPIC_API_KEY when not set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const env = buildAgentEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("merges extra env vars", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const env = buildAgentEnv({SHADE_GROUP_ID: "group1", CUSTOM_VAR: "value"});
    expect(env.SHADE_GROUP_ID).toBe("group1");
    expect(env.CUSTOM_VAR).toBe("value");
  });

  test("extra env vars override defaults", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    const env = buildAgentEnv({ANTHROPIC_API_KEY: "override-key"});
    expect(env.ANTHROPIC_API_KEY).toBe("override-key");
  });

  test("returns empty object with no key and no extras", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const env = buildAgentEnv();
    expect(Object.keys(env).length).toBe(0);
  });
});

describe("getSanitizedEnvForShell", () => {
  test("returns unset commands for sensitive vars", () => {
    const commands = getSanitizedEnvForShell();
    expect(commands).toContain("unset ANTHROPIC_API_KEY");
    expect(commands).toContain("unset MONGO_URI");
    expect(commands).toContain("unset SLACK_BOT_TOKEN");
    expect(commands).toContain("unset JWT_SECRET");
  });

  test("returns an array of strings", () => {
    const commands = getSanitizedEnvForShell();
    expect(Array.isArray(commands)).toBe(true);
    for (const cmd of commands) {
      expect(typeof cmd).toBe("string");
      expect(cmd).toMatch(/^unset /);
    }
  });
});

describe("createPreToolUseHook", () => {
  test("returns semicolon-separated unset commands", () => {
    const hook = createPreToolUseHook();
    expect(hook).toContain("unset ANTHROPIC_API_KEY");
    expect(hook).toContain("; ");
  });

  test("is a single string", () => {
    const hook = createPreToolUseHook();
    expect(typeof hook).toBe("string");
  });
});

describe("redactSecrets", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      MONGO_URI: process.env.MONGO_URI,
    };
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  test("redacts known secret values from text", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret-12345";
    const text = "Error: authentication failed with key sk-ant-secret-12345";
    const result = redactSecrets(text);
    expect(result).toContain("[REDACTED:ANTHROPIC_API_KEY]");
    expect(result).not.toContain("sk-ant-secret-12345");
  });

  test("redacts multiple secrets", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret-12345";
    process.env.MONGO_URI = "mongodb://user:pass@host/db";
    const text = "Key: sk-ant-secret-12345, DB: mongodb://user:pass@host/db";
    const result = redactSecrets(text);
    expect(result).not.toContain("sk-ant-secret-12345");
    expect(result).not.toContain("mongodb://user:pass@host/db");
  });

  test("leaves text unchanged when no secrets in env", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MONGO_URI;
    const text = "normal text with no secrets";
    expect(redactSecrets(text)).toBe(text);
  });

  test("skips secrets with 4 or fewer characters", () => {
    process.env.ANTHROPIC_API_KEY = "tiny";
    const text = "the word tiny appears here";
    const result = redactSecrets(text);
    expect(result).toBe("the word tiny appears here");
  });

  test("redacts secrets longer than 4 characters", () => {
    process.env.ANTHROPIC_API_KEY = "longer-secret";
    const text = "found longer-secret in output";
    const result = redactSecrets(text);
    expect(result).toContain("[REDACTED:ANTHROPIC_API_KEY]");
  });
});
