import {describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {Feature} from "./feature";
import {Group} from "./group";

const groupFields = () => ({
  name: "Feature channel",
  folder: "features/model-test",
  channelId: new mongoose.Types.ObjectId(),
  externalId: "channel-1",
});

describe("brewery feature model", () => {
  test("accepts brewery groups while preserving legacy groups without a driver", () => {
    const legacy = new Group({...groupFields(), featurePhase: "implementing"});
    const brewery = new Group({
      ...groupFields(),
      featurePhase: "planning",
      featureDriver: "brewery",
    });

    expect(legacy.validateSync()).toBeUndefined();
    expect(legacy.toObject().featureDriver).toBeUndefined();
    expect(brewery.validateSync()).toBeUndefined();
    expect(brewery.toObject().featureDriver).toBe("brewery");
    expect(new Group({...groupFields(), featureDriver: "agent"}).validateSync()).toBeDefined();
  });

  test("persists zerg run state and approval status", async () => {
    const since = new Date("2026-09-28T12:00:00Z");
    const lastEventAt = new Date("2026-09-28T12:01:00Z");
    const feature = new Feature({
      name: "Example feature",
      status: "awaiting_approval",
      brewery: {
        slug: "example-feature",
        repo: "shade",
        workspace: {kind: "zerg", session: "feature-example"},
        phase: "distill",
        waiting: {kind: "signoff", since},
        eventsOffset: 128,
        stepMessages: [{seq: 1, ts: "1727524800.000001"}],
        pr: 42,
        lastEventAt,
      },
    });

    await feature.save();
    const reloaded = await Feature.findById(feature._id);
    if (!reloaded) throw new Error("Saved feature was not found");
    const state = reloaded.toObject();
    expect(state.status).toBe("awaiting_approval");
    expect(state.brewery?.workspace).toMatchObject({kind: "zerg", session: "feature-example"});
    expect(state.brewery?.waiting).toMatchObject({kind: "signoff", since});
    expect(state.brewery?.eventsOffset).toBe(128);
    expect(state.brewery?.stepMessages).toMatchObject([{seq: 1, ts: "1727524800.000001"}]);
    expect(state.brewery?.pr).toBe(42);
    expect(state.brewery?.lastEventAt).toEqual(lastEventAt);
    await feature.deleteOne();
  });

  test("accepts local run state and keeps brewery optional for legacy features", () => {
    const legacy = new Feature({name: "Legacy feature"});
    const local = new Feature({
      name: "Local feature",
      brewery: {
        slug: "local-feature",
        repo: "shade",
        workspace: {kind: "local", repoPath: "/tmp/shade-feature"},
        waiting: {kind: "gate", since: new Date("2026-09-28T12:00:00Z")},
        eventsOffset: 0,
        stepMessages: [],
      },
    });

    expect(legacy.validateSync()).toBeUndefined();
    expect(legacy.toObject().brewery).toBeUndefined();
    expect(local.validateSync()).toBeUndefined();
    expect(local.toObject().brewery?.workspace).toMatchObject({
      kind: "local",
      repoPath: "/tmp/shade-feature",
    });
    expect(
      new Feature({
        name: "Missing local path",
        brewery: {slug: "missing-path", repo: "shade", workspace: {kind: "local"}},
      }).validateSync()
    ).toBeDefined();
    expect(
      new Feature({
        name: "Missing zerg session",
        brewery: {slug: "missing-session", repo: "shade", workspace: {kind: "zerg"}},
      }).validateSync()
    ).toBeDefined();
  });

  test("rejects incomplete run state and unsupported status or waiting kind", () => {
    expect(
      new Feature({name: "Incomplete", brewery: {slug: "incomplete"}}).validateSync()
    ).toBeDefined();
    expect(new Feature({name: "Invalid", status: "reviewing"}).validateSync()).toBeDefined();
    expect(
      new Feature({
        name: "Invalid gate",
        brewery: {
          slug: "invalid-gate",
          repo: "shade",
          workspace: {kind: "local", repoPath: "/tmp/invalid"},
          waiting: {kind: "unknown", since: new Date()},
          eventsOffset: 0,
          stepMessages: [],
        },
      }).validateSync()
    ).toBeDefined();
  });
});
