import path from "node:path";
import {tool} from "@anthropic-ai/claude-agent-sdk";
import {logger} from "@terreno/api";
import {DateTime} from "luxon";
import {z} from "zod";
import {loadAppConfig} from "../models/appConfig";
import {InfraChange} from "../models/infraChange";
import type {AppConfigInfraBot, AppConfigInfraRepo} from "../types/models/appConfigTypes";
import {GitHubClient} from "../utils/github";
import {
  addFeatureWorktree,
  commitAndPush,
  ensureRepoCloned,
  removeWorktree,
  resolveManagedRepo,
  slugifyBranch,
  worktreeDirName,
} from "../utils/infraGit";
import type {McpContext} from "./mcpServer";

const text = (s: string) => ({content: [{type: "text" as const, text: s}]});
const errorText = (s: string) => ({content: [{type: "text" as const, text: s}], isError: true});

const DISABLED_TEXT =
  "The infra bot is disabled. An operator must enable it and configure managed repos in AppConfig.infraBot.";

/**
 * Load config and enforce the coarse gates shared by every infra tool:
 * the feature must be enabled, and — when a groupId is pinned — the call must
 * come from that group. Returns the infraBot config or an error payload.
 */
const gateInfraBot = async (
  ctx: McpContext
): Promise<
  | {ok: true; cfg: AppConfigInfraBot; token: string}
  | {ok: false; payload: ReturnType<typeof errorText>}
> => {
  const config = await loadAppConfig();
  const cfg = config.infraBot;
  if (!cfg?.enabled) {
    return {ok: false, payload: errorText(DISABLED_TEXT)};
  }
  if (cfg.groupId && ctx.groupId !== cfg.groupId) {
    return {
      ok: false,
      payload: errorText("The infra bot can only be driven from its configured group."),
    };
  }
  return {ok: true, cfg, token: config.apiKeys.github || ""};
};

const resolvedReposBase = (cfg: AppConfigInfraBot): string =>
  path.isAbsolute(cfg.reposBaseDir) ? cfg.reposBaseDir : path.join(process.cwd(), cfg.reposBaseDir);

/** The shared base clone for a repo; worktrees hang off this. */
const baseDirFor = (cfg: AppConfigInfraBot, repo: AppConfigInfraRepo): string =>
  path.join(resolvedReposBase(cfg), repo.name);

/** Per-change worktree path, resolved the same way from prepare and submit. */
const worktreePathFor = (
  cfg: AppConfigInfraBot,
  repo: AppConfigInfraRepo,
  branch: string
): string => path.join(resolvedReposBase(cfg), worktreeDirName({repoName: repo.name, branch}));

export const buildInfraTools = (ctx: McpContext) => {
  const listInfraReposTool = tool(
    "list_infra_repos",
    "List the git-backed infrastructure repos the infra bot is allowed to modify (the allowlist). " +
      "Use this before proposing a change to see what you can touch and which branch each repo deploys from.",
    {},
    async () => {
      const gate = await gateInfraBot(ctx);
      if (!gate.ok) {
        return gate.payload;
      }
      const repos = gate.cfg.repos.map((r) => ({
        name: r.name,
        description: r.description,
        deployBranch: r.deployBranch,
        github: r.owner && r.repo ? `${r.owner}/${r.repo}` : "",
      }));
      return text(
        repos.length
          ? JSON.stringify(repos, null, 2)
          : "No managed repos are configured. An operator must add them to AppConfig.infraBot.repos."
      );
    }
  );

  const prepareInfraChangeTool = tool(
    "prepare_infra_change",
    "Clone/refresh a managed infra repo and check out a fresh feature branch in its own isolated worktree, " +
      "cut from the deploy branch. Returns the local working directory — edit the files there with your normal " +
      "file tools, then call submit_infra_change. Each change gets its own worktree, so you can have several in " +
      "flight at once. You cannot deploy: a human reviews and merges the PR.",
    {
      repo: z.string().describe("The repo handle from list_infra_repos (e.g. 'docker-stacks')."),
      summary: z.string().describe("Short summary of the change; used to name the feature branch."),
    },
    async (args) => {
      const gate = await gateInfraBot(ctx);
      if (!gate.ok) {
        return gate.payload;
      }
      try {
        const repo = resolveManagedRepo({repos: gate.cfg.repos, name: args.repo});
        const stamp = DateTime.now().toFormat("MMdd-HHmmss");
        const branchName = `${gate.cfg.branchPrefix}${slugifyBranch(args.summary)}-${stamp}`;
        const baseDir = baseDirFor(gate.cfg, repo);
        const worktreePath = worktreePathFor(gate.cfg, repo, branchName);

        await ensureRepoCloned({gitUrl: repo.gitUrl, repoDir: baseDir, token: gate.token});
        await addFeatureWorktree({
          baseDir,
          worktreePath,
          deployBranch: repo.deployBranch,
          branchName,
          branchPrefix: gate.cfg.branchPrefix,
          gitUserName: gate.cfg.gitUserName,
          gitUserEmail: gate.cfg.gitUserEmail,
        });

        return text(
          JSON.stringify(
            {
              repo: repo.name,
              branch: branchName,
              workingDir: worktreePath,
              deployBranch: repo.deployBranch,
              next: "Edit files under workingDir, then call submit_infra_change with this repo and branch.",
            },
            null,
            2
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error(`[infraTools] prepare_infra_change failed: ${msg}`);
        return errorText(`prepare_infra_change failed: ${msg}`);
      }
    }
  );

  const submitInfraChangeTool = tool(
    "submit_infra_change",
    "Commit and push the feature branch, then open a pull request into the deploy branch for human review. " +
      "This NEVER merges or deploys — it only proposes the change. Call prepare_infra_change first.",
    {
      repo: z.string().describe("The repo handle used in prepare_infra_change."),
      branch: z.string().describe("The feature branch returned by prepare_infra_change."),
      title: z.string().describe("Pull request title."),
      body: z.string().describe("Pull request body: what changed and why."),
    },
    async (args) => {
      const gate = await gateInfraBot(ctx);
      if (!gate.ok) {
        return gate.payload;
      }
      try {
        const repo = resolveManagedRepo({repos: gate.cfg.repos, name: args.repo});
        const baseDir = baseDirFor(gate.cfg, repo);
        const worktreePath = worktreePathFor(gate.cfg, repo, args.branch);

        const pushResult = await commitAndPush({
          repoDir: worktreePath,
          branchName: args.branch,
          branchPrefix: gate.cfg.branchPrefix,
          deployBranch: repo.deployBranch,
          message: args.title,
        });
        if (!pushResult.pushed) {
          // Keep the worktree so the agent can add changes and resubmit.
          return text(`Nothing to submit: ${pushResult.reason}`);
        }

        // The branch now lives in the origin; the worktree has served its
        // purpose, so reclaim it once the push has landed.
        const cleanup = () => removeWorktree({baseDir, worktreePath}).catch(() => undefined);

        if (!gate.token) {
          await cleanup();
          return text(
            `Pushed branch ${args.branch}, but no GitHub token is configured so I could not open the PR. ` +
              `Open it manually: ${args.branch} -> ${repo.deployBranch}.`
          );
        }
        if (!repo.owner || !repo.repo) {
          await cleanup();
          return text(
            `Pushed branch ${args.branch}. This repo has no GitHub owner/repo configured, so open the PR manually.`
          );
        }

        const gh = new GitHubClient(gate.token);
        const pr = await gh.createPullRequest({
          owner: repo.owner,
          repo: repo.repo,
          head: args.branch,
          base: repo.deployBranch,
          title: args.title,
          body: args.body,
        });
        if (!pr) {
          await cleanup();
          return errorText(
            `Pushed branch ${args.branch} but failed to open the PR (it may already exist). Check GitHub.`
          );
        }

        // Record the proposed change so the watcher can follow its review/CI/merge.
        await InfraChange.create({
          repoName: repo.name,
          owner: repo.owner,
          repo: repo.repo,
          prNumber: pr.prNumber,
          url: pr.url,
          branch: args.branch,
          title: args.title,
          groupId: gate.cfg.groupId || ctx.groupId,
          status: "open",
        });
        await cleanup();

        return text(
          `Opened PR #${pr.prNumber} for review: ${pr.url}\n` +
            `A human must review and merge it — merging is what triggers the deploy.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error(`[infraTools] submit_infra_change failed: ${msg}`);
        return errorText(`submit_infra_change failed: ${msg}`);
      }
    }
  );

  const getInfraChangeStatusTool = tool(
    "get_infra_change_status",
    "Report review and CI status for an infra pull request: whether it merged, review verdicts, and check-run results. " +
      "Use this to follow up on a change you proposed.",
    {
      repo: z.string().describe("The repo handle the PR belongs to."),
      prNumber: z.number().describe("The pull request number."),
    },
    async (args) => {
      const gate = await gateInfraBot(ctx);
      if (!gate.ok) {
        return gate.payload;
      }
      if (!gate.token) {
        return errorText("No GitHub token is configured, so PR status cannot be fetched.");
      }
      try {
        const repo = resolveManagedRepo({repos: gate.cfg.repos, name: args.repo});
        if (!repo.owner || !repo.repo) {
          return errorText(`Repo "${repo.name}" has no GitHub owner/repo configured.`);
        }
        const gh = new GitHubClient(gate.token);
        const details = await gh.getPRDetails(repo.owner, repo.repo, args.prNumber);
        const reviews = await gh.getPRReviews(repo.owner, repo.repo, args.prNumber);
        const checks = details.data?.headSha
          ? await gh.getPRChecks(repo.owner, repo.repo, details.data.headSha)
          : [];

        return text(
          JSON.stringify(
            {
              mergeable: details.data?.mergeable ?? null,
              mergeableState: details.data?.mergeableState ?? "unknown",
              hasConflicts: details.data?.hasConflicts ?? null,
              reviews: reviews.map((r) => ({reviewer: r.reviewer, state: r.state, isBot: r.isBot})),
              checks: checks.map((c) => ({
                name: c.name,
                status: c.status,
                conclusion: c.conclusion,
              })),
            },
            null,
            2
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return errorText(`get_infra_change_status failed: ${msg}`);
      }
    }
  );

  return [
    listInfraReposTool,
    prepareInfraChangeTool,
    submitInfraChangeTool,
    getInfraChangeStatusTool,
  ];
};
