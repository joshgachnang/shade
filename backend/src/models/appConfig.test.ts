import {describe, expect, test} from "bun:test";
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
