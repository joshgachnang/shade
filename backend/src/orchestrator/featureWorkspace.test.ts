import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensureLocalRepo,
  expandHome,
  featureSlugForRepo,
  planFeatureWorkspace,
  workspaceInstructions,
} from "./featureWorkspace";
import type {ExecFn} from "./hostExec";

const baseExecution = {
  mode: "direct" as const,
  timeout: 900000,
  idleTimeout: 60000,
  maxConcurrent: 1,
};

describe("featureSlugForRepo", () => {
  test("drops the feat- prefix and a leading repo name", () => {
    expect(featureSlugForRepo({channelName: "feat-lede-front-page-explainer", repo: "lede"})).toBe(
      "front-page-explainer"
    );
  });

  test("keeps the name when it doesn't start with the repo", () => {
    expect(featureSlugForRepo({channelName: "feat-dark-mode", repo: "lede"})).toBe("dark-mode");
  });

  test("uses the repo basename for owner/repo", () => {
    expect(featureSlugForRepo({channelName: "feat-lede-x", repo: "joshgachnang/lede"})).toBe("x");
  });
});

describe("expandHome", () => {
  test("expands a leading ~/", () => {
    expect(expandHome("~/src")).toBe(path.join(os.homedir(), "src"));
  });

  test("leaves absolute paths alone", () => {
    expect(expandHome("/opt/repos")).toBe("/opt/repos");
  });
});

describe("ensureLocalRepo", () => {
  let reposDir: string;
  let calls: string[][];
  const cloningExec: ExecFn = async (argv) => {
    calls.push(argv);
    await fs.mkdir(argv[argv.length - 1], {recursive: true});
    return {code: 0, stdout: "", stderr: ""};
  };

  beforeEach(async () => {
    reposDir = await fs.mkdtemp(path.join(os.tmpdir(), "feature-repos-"));
    calls = [];
  });

  afterEach(async () => {
    await fs.rm(reposDir, {recursive: true, force: true});
  });

  test("returns an existing checkout without cloning", async () => {
    await fs.mkdir(path.join(reposDir, "lede"));

    const result = await ensureLocalRepo({repo: "lede", reposDir, exec: cloningExec});

    expect(result).toEqual({repoPath: path.join(reposDir, "lede"), isCloned: false});
    expect(calls).toHaveLength(0);
  });

  test("clones a missing repo with gh into <reposDir>/<name>", async () => {
    const result = await ensureLocalRepo({repo: "joshgachnang/lede", reposDir, exec: cloningExec});

    expect(result).toEqual({repoPath: path.join(reposDir, "lede"), isCloned: true});
    expect(calls).toEqual([
      ["gh", "repo", "clone", "joshgachnang/lede", path.join(reposDir, "lede")],
    ]);
  });

  test("throws with gh's stderr when the clone fails", async () => {
    const failingExec: ExecFn = async () => ({code: 1, stdout: "", stderr: "repository not found"});

    await expect(ensureLocalRepo({repo: "nope", reposDir, exec: failingExec})).rejects.toThrow(
      "repository not found"
    );
  });

  test("rejects repo names that could escape the repos dir", async () => {
    await expect(ensureLocalRepo({repo: "../etc", reposDir, exec: cloningExec})).rejects.toThrow(
      "Invalid repo"
    );
    expect(calls).toHaveLength(0);
  });
});

describe("planFeatureWorkspace", () => {
  test("runs on zerg when a repo is given and zerg is enabled", async () => {
    const plan = await planFeatureWorkspace({
      channelName: "feat-lede-front-page-explainer",
      repo: "lede",
      baseExecutionConfig: baseExecution,
      isZergEnabled: true,
      localReposDir: "/unused",
      exec: async () => {
        throw new Error("must not clone when running on zerg");
      },
    });

    expect(plan.executionConfig).toEqual({
      ...baseExecution,
      mode: "container",
      zergRepo: "lede",
      zergFeature: "front-page-explainer",
    });
    expect(plan.workspace).toEqual({kind: "zerg", repo: "lede", feature: "front-page-explainer"});
  });

  test("falls back to a local clone when zerg is disabled", async () => {
    const reposDir = await fs.mkdtemp(path.join(os.tmpdir(), "feature-plan-"));
    await fs.mkdir(path.join(reposDir, "lede"));

    const plan = await planFeatureWorkspace({
      channelName: "feat-lede-x",
      repo: "lede",
      baseExecutionConfig: baseExecution,
      isZergEnabled: false,
      localReposDir: reposDir,
    });

    expect(plan.executionConfig).toEqual(baseExecution);
    expect(plan.workspace).toEqual({
      kind: "local",
      repo: "lede",
      repoPath: path.join(reposDir, "lede"),
    });
    await fs.rm(reposDir, {recursive: true, force: true});
  });

  test("stays direct with no repo so the agent can ask which one", async () => {
    const plan = await planFeatureWorkspace({
      channelName: "feat-mystery",
      repo: undefined,
      baseExecutionConfig: baseExecution,
      isZergEnabled: true,
      localReposDir: "/unused",
    });

    expect(plan.executionConfig).toEqual(baseExecution);
    expect(plan.workspace).toEqual({kind: "unknown"});
  });
});

describe("workspaceInstructions", () => {
  test("zerg: points at the session checkout and forbids host searches", () => {
    const text = workspaceInstructions({
      workspace: {kind: "zerg", repo: "lede", feature: "front-page-explainer"},
      localReposDir: "~/src",
    });
    expect(text).toContain("zerg session `lede-front-page-explainer`");
    expect(text).toContain("current working directory");
    expect(text).toContain("Do not search the filesystem");
  });

  test("local: names the checkout path", () => {
    const text = workspaceInstructions({
      workspace: {kind: "local", repo: "lede", repoPath: "/Users/me/src/lede"},
      localReposDir: "~/src",
    });
    expect(text).toContain("`/Users/me/src/lede`");
    expect(text).toContain("git worktree");
  });

  test("unknown: ask for the repo and say where to clone it", () => {
    const text = workspaceInstructions({workspace: {kind: "unknown"}, localReposDir: "~/src"});
    expect(text).toContain("ask in the channel");
    expect(text).toContain("gh repo clone <repo> ~/src/<repo>");
  });
});
