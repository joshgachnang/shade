import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {AppConfigInfraRepo} from "../types/models/appConfigTypes";
import {
  addFeatureWorktree,
  assertFeatureBranch,
  authenticatedUrl,
  commitAndPush,
  ensureRepoCloned,
  removeWorktree,
  resolveManagedRepo,
  runGit,
  slugifyBranch,
  worktreeDirName,
} from "./infraGit";

const repos: AppConfigInfraRepo[] = [
  {
    name: "docker-stacks",
    gitUrl: "https://github.com/acme/docker-stacks.git",
    owner: "acme",
    repo: "docker-stacks",
    deployBranch: "main",
    description: "Docker compose stacks",
  },
];

describe("resolveManagedRepo (allowlist = blast radius)", () => {
  test("returns the matching repo", () => {
    expect(resolveManagedRepo({repos, name: "docker-stacks"}).owner).toBe("acme");
  });

  test("throws for a repo not on the allowlist, listing known repos", () => {
    expect(() => resolveManagedRepo({repos, name: "prod-secrets"})).toThrow(
      /not in the infra-bot allowlist.*docker-stacks/s
    );
  });
});

describe("assertFeatureBranch (never the deploy branch)", () => {
  const args = {branchPrefix: "infra-bot/", deployBranch: "main"};

  test("accepts a prefixed feature branch", () => {
    expect(() => assertFeatureBranch({...args, branchName: "infra-bot/bump-plex"})).not.toThrow();
  });

  test("refuses the deploy branch", () => {
    expect(() => assertFeatureBranch({...args, branchName: "main"})).toThrow(/deploy branch/);
  });

  test("refuses an empty branch name", () => {
    expect(() => assertFeatureBranch({...args, branchName: ""})).toThrow();
  });

  test("refuses a branch without the required prefix", () => {
    expect(() => assertFeatureBranch({...args, branchName: "hotfix/whatever"})).toThrow(
      /must start with the required prefix/
    );
  });
});

describe("slugifyBranch", () => {
  test("produces a ref-safe slug", () => {
    expect(slugifyBranch("Bump Plex to 1.40!")).toBe("bump-plex-to-1-40");
  });

  test("falls back to 'change' for empty input", () => {
    expect(slugifyBranch("  ***  ")).toBe("change");
  });
});

describe("authenticatedUrl", () => {
  test("injects the token for github https URLs", () => {
    expect(authenticatedUrl("https://github.com/acme/x.git", "tok")).toBe(
      "https://x-access-token:tok@github.com/acme/x.git"
    );
  });

  test("leaves non-github or tokenless URLs unchanged", () => {
    expect(authenticatedUrl("https://git.home/acme/x.git", "tok")).toBe(
      "https://git.home/acme/x.git"
    );
    expect(authenticatedUrl("https://github.com/acme/x.git", "")).toBe(
      "https://github.com/acme/x.git"
    );
  });
});

describe("worktreeDirName", () => {
  test("flattens branch slashes into a filesystem-safe name", () => {
    expect(worktreeDirName({repoName: "stacks", branch: "infra-bot/add-nginx-0809"})).toBe(
      "stacks-wt-infra-bot-add-nginx-0809"
    );
  });
});

describe("infra worktree flow against a local bare repo", () => {
  let tmpRoot: string;
  let bareDir: string;
  let baseDir: string;

  const worktreeArgs = {
    branchPrefix: "infra-bot/",
    gitUserName: "Shade Infra Bot",
    gitUserEmail: "infra-bot@shade.local",
    deployBranch: "main",
  };

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "infra-git-"));
    bareDir = path.join(tmpRoot, "origin.git");
    baseDir = path.join(tmpRoot, "base");
    const seedDir = path.join(tmpRoot, "seed");

    await runGit({cwd: tmpRoot, args: ["init", "--bare", "--initial-branch=main", bareDir]});
    await runGit({cwd: tmpRoot, args: ["init", "--initial-branch=main", seedDir]});
    await runGit({cwd: seedDir, args: ["config", "user.name", "Seed"]});
    await runGit({cwd: seedDir, args: ["config", "user.email", "seed@test.local"]});
    await fs.writeFile(path.join(seedDir, "README.md"), "seed\n");
    await runGit({cwd: seedDir, args: ["add", "-A"]});
    await runGit({cwd: seedDir, args: ["commit", "-m", "initial"]});
    await runGit({cwd: seedDir, args: ["remote", "add", "origin", bareDir]});
    await runGit({cwd: seedDir, args: ["push", "-u", "origin", "main"]});

    await ensureRepoCloned({gitUrl: bareDir, repoDir: baseDir});
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, {recursive: true, force: true});
  });

  test("adds a worktree, commits and pushes — leaving deploy untouched", async () => {
    const mainSha = await runGit({cwd: bareDir, args: ["rev-parse", "main"]});
    const worktreePath = path.join(tmpRoot, "wt-service");

    await addFeatureWorktree({
      ...worktreeArgs,
      baseDir,
      worktreePath,
      branchName: "infra-bot/add-service",
    });

    await fs.writeFile(path.join(worktreePath, "service.yml"), "image: nginx\n");
    const result = await commitAndPush({
      repoDir: worktreePath,
      branchName: "infra-bot/add-service",
      branchPrefix: "infra-bot/",
      deployBranch: "main",
      message: "Add nginx service",
    });

    expect(result.pushed).toBe(true);
    const branches = await runGit({
      cwd: bareDir,
      args: ["branch", "--list", "infra-bot/add-service"],
    });
    expect(branches).toContain("infra-bot/add-service");

    // The deploy branch was never moved.
    expect(await runGit({cwd: bareDir, args: ["rev-parse", "main"]})).toBe(mainSha);
  });

  test("two concurrent worktrees on the same repo do not clobber each other", async () => {
    const wtA = path.join(tmpRoot, "wt-a");
    const wtB = path.join(tmpRoot, "wt-b");

    await addFeatureWorktree({
      ...worktreeArgs,
      baseDir,
      worktreePath: wtA,
      branchName: "infra-bot/a",
    });
    await addFeatureWorktree({
      ...worktreeArgs,
      baseDir,
      worktreePath: wtB,
      branchName: "infra-bot/b",
    });

    // Edit both working trees independently, then push both.
    await fs.writeFile(path.join(wtA, "a.txt"), "a\n");
    await fs.writeFile(path.join(wtB, "b.txt"), "b\n");

    const [ra, rb] = await Promise.all([
      commitAndPush({
        repoDir: wtA,
        branchName: "infra-bot/a",
        branchPrefix: "infra-bot/",
        deployBranch: "main",
        message: "change a",
      }),
      commitAndPush({
        repoDir: wtB,
        branchName: "infra-bot/b",
        branchPrefix: "infra-bot/",
        deployBranch: "main",
        message: "change b",
      }),
    ]);

    expect(ra.pushed).toBe(true);
    expect(rb.pushed).toBe(true);
    // Each branch has exactly its own file — no cross-contamination.
    expect(await runGit({cwd: bareDir, args: ["ls-tree", "--name-only", "infra-bot/a"]})).toContain(
      "a.txt"
    );
    const bTree = await runGit({cwd: bareDir, args: ["ls-tree", "--name-only", "infra-bot/b"]});
    expect(bTree).toContain("b.txt");
    expect(bTree).not.toContain("a.txt");
  });

  test("reports no-op when there is nothing to commit", async () => {
    const worktreePath = path.join(tmpRoot, "wt-noop");
    await addFeatureWorktree({
      ...worktreeArgs,
      baseDir,
      worktreePath,
      branchName: "infra-bot/noop",
    });
    const result = await commitAndPush({
      repoDir: worktreePath,
      branchName: "infra-bot/noop",
      branchPrefix: "infra-bot/",
      deployBranch: "main",
      message: "nothing",
    });
    expect(result.pushed).toBe(false);
  });

  test("removeWorktree tears the worktree down", async () => {
    const worktreePath = path.join(tmpRoot, "wt-remove");
    await addFeatureWorktree({
      ...worktreeArgs,
      baseDir,
      worktreePath,
      branchName: "infra-bot/remove-me",
    });
    await removeWorktree({baseDir, worktreePath});
    await expect(fs.access(worktreePath)).rejects.toThrow();
  });

  test("commitAndPush refuses the deploy branch outright", async () => {
    await expect(
      commitAndPush({
        repoDir: baseDir,
        branchName: "main",
        branchPrefix: "infra-bot/",
        deployBranch: "main",
        message: "should never happen",
      })
    ).rejects.toThrow(/deploy branch/);
  });
});
