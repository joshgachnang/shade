import {describe, expect, test} from "bun:test";
import path from "node:path";
import {clearPathOverride, paths} from "./config";

describe("paths.skills", () => {
  test("defaults to the skills directory under the data dir", () => {
    expect(paths.skills).toBe(path.join(paths.data, "skills"));
  });

  test("setter overrides the computed default and clearPathOverride restores it", () => {
    const overridePath = path.join(process.cwd(), "tmp-test-skills-override");
    paths.skills = overridePath;
    expect(paths.skills).toBe(overridePath);
    clearPathOverride("skills");
    expect(paths.skills).toBe(path.join(paths.data, "skills"));
  });
});
