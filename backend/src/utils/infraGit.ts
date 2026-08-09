import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import {logger} from "@terreno/api";
import type {AppConfigInfraRepo} from "../types/models/appConfigTypes";

const execFileAsync = promisify(execFile);

const DEFAULT_GIT_TIMEOUT_MS = 60000;

// GIT_TERMINAL_PROMPT=0 makes git fail fast instead of hanging on a credential
// prompt when auth is missing — critical for a non-interactive agent.
const gitEnv = {...process.env, GIT_TERMINAL_PROMPT: "0"};

export interface RunGitParams {
  cwd: string;
  args: string[];
  timeoutMs?: number;
}

/** Run a git subcommand, returning trimmed stdout. Throws on non-zero exit. */
export const runGit = async ({cwd, args, timeoutMs}: RunGitParams): Promise<string> => {
  try {
    const {stdout} = await execFileAsync("git", args, {
      cwd,
      env: gitEnv,
      timeout: timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err: any) {
    // Surface git's own stderr — it explains *why* far better than the exit code.
    const detail = (err?.stderr || err?.message || "").toString().trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
};

/**
 * Resolve a repo handle against the allowlist. The allowlist IS the blast
 * radius, so an unknown handle is a hard error, not a silent no-op.
 */
export const resolveManagedRepo = ({
  repos,
  name,
}: {
  repos: AppConfigInfraRepo[];
  name: string;
}): AppConfigInfraRepo => {
  const match = repos.find((r) => r.name === name);
  if (!match) {
    const known =
      repos
        .map((r) => r.name)
        .filter(Boolean)
        .join(", ") || "(none configured)";
    throw new Error(`Repo "${name}" is not in the infra-bot allowlist. Managed repos: ${known}`);
  }
  return match;
};

/**
 * Enforce the two branch guardrails that keep the AI behind PR review:
 *  1. it can only push branches under `branchPrefix`, and
 *  2. it may never push a repo's deploy branch.
 * Throws on violation.
 */
export const assertFeatureBranch = ({
  branchName,
  branchPrefix,
  deployBranch,
}: {
  branchName: string;
  branchPrefix: string;
  deployBranch: string;
}): void => {
  if (!branchName || branchName === deployBranch) {
    throw new Error(
      `Refusing to operate on the deploy branch "${deployBranch}". The infra bot only ever pushes feature branches; a human merges the PR.`
    );
  }
  if (branchPrefix && !branchName.startsWith(branchPrefix)) {
    throw new Error(
      `Branch "${branchName}" must start with the required prefix "${branchPrefix}".`
    );
  }
};

/** Turn a free-text summary into a git-ref-safe slug. */
export const slugifyBranch = (summary: string): string => {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "change";
};

/**
 * Inject a GitHub token into an https github.com clone URL so pushes
 * authenticate non-interactively. Non-github or non-https URLs are returned
 * unchanged (the operator is expected to bake credentials into those).
 */
export const authenticatedUrl = (gitUrl: string, token: string): string => {
  if (!token || !gitUrl.startsWith("https://github.com/")) {
    return gitUrl;
  }
  return gitUrl.replace("https://github.com/", `https://x-access-token:${token}@github.com/`);
};

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

export interface EnsureRepoParams {
  gitUrl: string;
  repoDir: string;
  token?: string;
  timeoutMs?: number;
}

/**
 * Ensure the repo is present at `repoDir`: clone it if missing, otherwise fetch
 * the latest. Returns the resolved repo directory.
 */
export const ensureRepoCloned = async ({
  gitUrl,
  repoDir,
  token,
  timeoutMs,
}: EnsureRepoParams): Promise<string> => {
  const url = authenticatedUrl(gitUrl, token ?? "");
  if (await pathExists(path.join(repoDir, ".git"))) {
    await runGit({cwd: repoDir, args: ["remote", "set-url", "origin", url], timeoutMs});
    await runGit({cwd: repoDir, args: ["fetch", "origin", "--prune"], timeoutMs});
    return repoDir;
  }
  await fs.mkdir(path.dirname(repoDir), {recursive: true});
  await runGit({
    cwd: path.dirname(repoDir),
    args: ["clone", url, path.basename(repoDir)],
    timeoutMs,
  });
  return repoDir;
};

/**
 * Deterministic directory name for a change's worktree, so prepare and submit
 * (which only knows the branch) resolve to the same path. Git branch names can
 * contain slashes; flatten them for a filesystem path.
 */
export const worktreeDirName = ({repoName, branch}: {repoName: string; branch: string}): string =>
  `${repoName}-wt-${branch.replace(/[^a-zA-Z0-9._-]/g, "-")}`;

export interface RemoveWorktreeParams {
  baseDir: string;
  worktreePath: string;
  timeoutMs?: number;
}

/** Remove a worktree, best-effort — cleanup should never fail the caller's flow. */
export const removeWorktree = async ({
  baseDir,
  worktreePath,
  timeoutMs,
}: RemoveWorktreeParams): Promise<void> => {
  if (!(await pathExists(worktreePath))) {
    try {
      await runGit({cwd: baseDir, args: ["worktree", "prune"], timeoutMs});
    } catch {
      // Nothing to prune; ignore.
    }
    return;
  }
  try {
    await runGit({cwd: baseDir, args: ["worktree", "remove", "--force", worktreePath], timeoutMs});
  } catch {
    // Fall back to deleting the directory and pruning the dangling registration.
    await fs.rm(worktreePath, {recursive: true, force: true});
    try {
      await runGit({cwd: baseDir, args: ["worktree", "prune"], timeoutMs});
    } catch {
      // Best-effort.
    }
  }
};

export interface AddWorktreeParams {
  baseDir: string;
  worktreePath: string;
  deployBranch: string;
  branchName: string;
  branchPrefix: string;
  gitUserName: string;
  gitUserEmail: string;
  timeoutMs?: number;
}

/**
 * Create an isolated git worktree holding a fresh feature branch cut from the
 * latest deploy branch. Each in-flight change gets its own worktree, so
 * concurrent infra sessions never fight over a single working tree. Guardrails
 * run before any ref is written.
 */
export const addFeatureWorktree = async ({
  baseDir,
  worktreePath,
  deployBranch,
  branchName,
  branchPrefix,
  gitUserName,
  gitUserEmail,
  timeoutMs,
}: AddWorktreeParams): Promise<void> => {
  assertFeatureBranch({branchName, branchPrefix, deployBranch});
  await runGit({cwd: baseDir, args: ["fetch", "origin", "--prune"], timeoutMs});
  // Clear any stale worktree registered at this path before re-adding it.
  await removeWorktree({baseDir, worktreePath, timeoutMs});
  // Branch off the *remote* deploy branch so we always start from what GitOps
  // will actually deploy, never a stale local copy.
  await runGit({
    cwd: baseDir,
    args: ["worktree", "add", "-B", branchName, worktreePath, `origin/${deployBranch}`],
    timeoutMs,
  });
  await runGit({cwd: worktreePath, args: ["config", "user.name", gitUserName], timeoutMs});
  await runGit({cwd: worktreePath, args: ["config", "user.email", gitUserEmail], timeoutMs});
};

export interface CommitAndPushParams {
  repoDir: string;
  branchName: string;
  branchPrefix: string;
  deployBranch: string;
  message: string;
  timeoutMs?: number;
}

export interface CommitAndPushResult {
  pushed: boolean;
  reason?: string;
}

/**
 * Stage everything, commit, and push the feature branch. Refuses to push the
 * deploy branch. Returns pushed:false (rather than throwing) when there is
 * nothing to commit, so the caller can report that cleanly.
 */
export const commitAndPush = async ({
  repoDir,
  branchName,
  branchPrefix,
  deployBranch,
  message,
  timeoutMs,
}: CommitAndPushParams): Promise<CommitAndPushResult> => {
  assertFeatureBranch({branchName, branchPrefix, deployBranch});

  const current = await runGit({
    cwd: repoDir,
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    timeoutMs,
  });
  if (current !== branchName) {
    throw new Error(
      `Working tree is on "${current}", not "${branchName}". Run prepare_infra_change first.`
    );
  }

  const status = await runGit({cwd: repoDir, args: ["status", "--porcelain"], timeoutMs});
  if (!status) {
    return {pushed: false, reason: "No changes to commit."};
  }

  await runGit({cwd: repoDir, args: ["add", "-A"], timeoutMs});
  await runGit({cwd: repoDir, args: ["commit", "-m", message], timeoutMs});
  await runGit({
    cwd: repoDir,
    args: ["push", "--set-upstream", "origin", branchName, "--force-with-lease"],
    timeoutMs,
  });
  logger.info(`[infraGit] pushed feature branch ${branchName} in ${repoDir}`);
  return {pushed: true};
};
