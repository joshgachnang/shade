import {describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import type {GroupDocument} from "../../types";
import {pickCachedGroup} from "./groupCache";

const fakeGroup = (
  name: string,
  isMain: boolean,
  _id = new mongoose.Types.ObjectId()
): GroupDocument => ({_id, name, isMain, externalId: "C123"}) as unknown as GroupDocument;

describe("pickCachedGroup", () => {
  test("keeps the incoming group when nothing is cached", () => {
    const incoming = fakeGroup("general", true);
    expect(pickCachedGroup({existing: undefined, incoming}).group).toBe(incoming);
    expect(pickCachedGroup({existing: undefined, incoming}).isConflict).toBe(false);
  });

  test("re-registering the same group is not a conflict", () => {
    const group = fakeGroup("general", true);
    const reloaded = fakeGroup("general", true, group._id as mongoose.Types.ObjectId);
    const result = pickCachedGroup({existing: group, incoming: reloaded});
    expect(result.isConflict).toBe(false);
  });

  test("a non-main group never displaces the main group on the same channel", () => {
    const main = fakeGroup("general", true);
    const result = pickCachedGroup({existing: main, incoming: fakeGroup("github", false)});
    expect(result.group).toBe(main);
    expect(result.isConflict).toBe(true);
  });

  test("the main group displaces a non-main group on the same channel", () => {
    const main = fakeGroup("general", true);
    const result = pickCachedGroup({existing: fakeGroup("github", false), incoming: main});
    expect(result.group).toBe(main);
    expect(result.isConflict).toBe(true);
  });
});
