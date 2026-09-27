import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {logger} from "@terreno/api";
import type {GroupExecutionConfig} from "../types/models/groupTypes";
import {defaultExec, type ExecFn} from "./hostExec";
import {slugifyFeature} from "./runners/zerg";

/** `repo` or `owner/repo`; no path traversal, no shell metacharacters. */
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const CLONE_TIMEOUT_MS = 5 * 60 * 1000;

/** Where a feature channel's agent does its work. */
export type FeatureWorkspace =
  | {kind: "zerg"; repo: string; feature: string}
  | {kind: "local"; repo: string; repoPath: string}
  | {kind: "unknown"};

export const expandHome = (dir: string): string => {
  if (dir === "~") {
    return os.homedir();
  }
  if (dir.startsWith("~/")) {
    return path.join(os.homedir(), dir.slice(2));
  }
  return dir;
};

const repoBasename = (repo: string): string => repo.split("/").pop() ?? repo;

/**
 * zerg feature slug for a feature channel: `feat-lede-front-page-explainer`
 * targeting `lede` becomes `front-page-explainer`, so the session is
 * `lede-front-page-explainer` rather than `lede-feat-lede-…`.
 */
export const featureSlugForRepo = ({
  channelName,
  repo,
}: {
  channelName: string;
  repo: string;
}): string => {
  const repoPrefix = `${repoBasename(repo).toLowerCase()}-`;
  let name = channelName.toLowerCase().replace(/^feat-/, "");
  if (name.startsWith(repoPrefix) && name.length > repoPrefix.length) {
    name = name.slice(repoPrefix.length);
  }
  return slugifyFeature(name);
};

/** Returns `<reposDir>/<repo name>`, cloning it with `gh` first when missing. */
export const ensureLocalRepo = async ({
  repo,
  reposDir,
  exec = defaultExec,
}: {
  repo: string;
  reposDir: string;
  exec?: ExecFn;
}): Promise<{repoPath: string; isCloned: boolean}> => {
  if (!REPO_PATTERN.test(repo) || repo.split("/").some((part) => part.startsWith("."))) {
    throw new Error(`Invalid repo "${repo}" (expected "repo" or "owner/repo")`);
  }

  const baseDir = expandHome(reposDir);
  const repoPath = path.join(baseDir, repoBasename(repo));
  const isPresent = await fs
    .stat(repoPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (isPresent) {
    return {repoPath, isCloned: false};
  }

  await fs.mkdir(baseDir, {recursive: true});
  logger.info(`Cloning ${repo} into ${repoPath} for a feature channel`);
  const result = await exec(["gh", "repo", "clone", repo, repoPath], {
    timeoutMs: CLONE_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw new Error(
      `gh repo clone ${repo} failed: ${result.stderr.trim() || result.stdout.trim()}`
    );
  }
  return {repoPath, isCloned: true};
};

/**
 * Decide where a new feature channel runs. A known repo runs in its own zerg
 * session; with zerg disabled it runs on the host against a checkout under
 * `localReposDir` (cloned if missing). Without a repo the agent asks.
 */
export const planFeatureWorkspace = async ({
  channelName,
  repo,
  baseExecutionConfig,
  isZergEnabled,
  localReposDir,
  exec,
}: {
  channelName: string;
  repo: string | undefined;
  baseExecutionConfig: GroupExecutionConfig;
  isZergEnabled: boolean;
  localReposDir: string;
  exec?: ExecFn;
}): Promise<{executionConfig: GroupExecutionConfig; workspace: FeatureWorkspace}> => {
  const trimmedRepo = repo?.trim();
  if (!trimmedRepo) {
    return {executionConfig: baseExecutionConfig, workspace: {kind: "unknown"}};
  }

  if (isZergEnabled) {
    const zergRepo = repoBasename(trimmedRepo);
    const feature = featureSlugForRepo({channelName, repo: trimmedRepo});
    return {
      executionConfig: {
        ...baseExecutionConfig,
        mode: "container",
        zergRepo,
        zergFeature: feature,
      },
      workspace: {kind: "zerg", repo: zergRepo, feature},
    };
  }

  const {repoPath} = await ensureLocalRepo({repo: trimmedRepo, reposDir: localReposDir, exec});
  return {
    executionConfig: baseExecutionConfig,
    workspace: {kind: "local", repo: trimmedRepo, repoPath},
  };
};

/** The "where to work" step of a feature channel's pinned workflow memory. */
export const workspaceInstructions = ({
  workspace,
  localReposDir,
}: {
  workspace: FeatureWorkspace;
  localReposDir: string;
}): string => {
  if (workspace.kind === "zerg") {
    return `**Work in the zerg session \`${workspace.repo}-${workspace.feature}\`.** Every
   turn in this channel runs inside that container; the \`${workspace.repo}\`
   checkout is your current working directory and is already isolated from
   other sessions. Do not search the filesystem for the repo. Create a
   kebab-case branch off the default branch there, then run
   \`bun bootstrap\` (fall back to \`bun install\` if missing and say so).`;
  }

  if (workspace.kind === "local") {
    return `**Work in a dedicated git worktree, never on a main checkout.** The
   \`${workspace.repo}\` repo is checked out at \`${workspace.repoPath}\` — do
   not search the filesystem for it. Create a git worktree off its default
   branch with a kebab-case branch name, then run \`bun bootstrap\` at its
   root (fall back to \`bun install\` if missing and say so).`;
  }

  return `**Confirm the target repo first.** No repo was given for this feature,
   so ask in the channel which repo it targets before starting. Local
   checkouts live in \`${localReposDir}/<repo>\`; if it's missing, clone it
   with \`gh repo clone <repo> ${localReposDir}/<repo>\` rather than searching
   the filesystem. Then work in a git worktree off the default branch and run
   \`bun bootstrap\` at its root.`;
};
