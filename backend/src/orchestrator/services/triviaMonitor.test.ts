import {afterEach, describe, expect, test} from "bun:test";
import {AppConfig, reloadAppConfig} from "../../models/appConfig";
import {resolveDetectorModel} from "./triviaMonitor";

const DEFAULT_AUXILIARY_MODEL = "claude-haiku-4-5-20251001";

describe("resolveDetectorModel", () => {
  test("env var override wins over everything", () => {
    expect(
      resolveDetectorModel({
        envModel: "claude-haiku-env",
        detectorModel: "claude-haiku-config",
        auxiliaryModel: "claude-haiku-aux",
      })
    ).toBe("claude-haiku-env");
  });

  test("trivia-specific models.detector override wins over auxiliaryModel", () => {
    expect(
      resolveDetectorModel({
        envModel: undefined,
        detectorModel: "claude-haiku-config",
        auxiliaryModel: "claude-haiku-aux",
      })
    ).toBe("claude-haiku-config");
  });

  test("falls back to agent.auxiliaryModel when no trivia-specific override is set", () => {
    expect(
      resolveDetectorModel({
        envModel: undefined,
        detectorModel: "",
        auxiliaryModel: "claude-haiku-aux",
      })
    ).toBe("claude-haiku-aux");
  });

  test("falls back to the compile-time default when nothing is configured", () => {
    expect(resolveDetectorModel({})).toBe(DEFAULT_AUXILIARY_MODEL);
    expect(resolveDetectorModel({envModel: "", detectorModel: "", auxiliaryModel: ""})).toBe(
      DEFAULT_AUXILIARY_MODEL
    );
  });

  test("treats whitespace-only values as unset", () => {
    expect(
      resolveDetectorModel({
        envModel: "  ",
        detectorModel: "   ",
        auxiliaryModel: "claude-haiku-aux",
      })
    ).toBe("claude-haiku-aux");
  });
});

describe("AppConfig-driven detector model resolution", () => {
  afterEach(async () => {
    // Leave AppConfig in its default state for other test files.
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });

  test("a default config resolves the detector to agent.auxiliaryModel", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    expect(cfg.models.detector).toBe("");
    expect(
      resolveDetectorModel({
        envModel: undefined,
        detectorModel: cfg.models.detector,
        auxiliaryModel: cfg.agent.auxiliaryModel,
      })
    ).toBe(DEFAULT_AUXILIARY_MODEL);
  });

  test("a configured models.detector overrides agent.auxiliaryModel", async () => {
    await AppConfig.deleteMany({});
    const cfg = await reloadAppConfig();
    cfg.set("models.detector", "claude-haiku-detector-override");
    await cfg.save();

    const reloaded = await reloadAppConfig();
    expect(
      resolveDetectorModel({
        envModel: undefined,
        detectorModel: reloaded.models.detector,
        auxiliaryModel: reloaded.agent.auxiliaryModel,
      })
    ).toBe("claude-haiku-detector-override");
  });
});
