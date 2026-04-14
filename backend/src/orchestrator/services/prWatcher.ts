/**
 * PR Watcher service.
 *
 * Polls GitHub for open PRs, tracks their state (CI, reviews, conflicts),
 * notifies via Slack (one editable message per PR), auto-responds to bot reviews,
 * and triggers auto-fixes for merge conflicts and CI failures.
 */

import Anthropic from "@anthropic-ai/sdk";
import {logger} from "@terreno/api";
import {DateTime} from "luxon";
import {loadAppConfig} from "../../models/appConfig";
import {PrWatch} from "../../models/prWatch";
import type {PrWatchDocument} from "../../types";
import {
  type GitHubCheckRun,
  GitHubClient,
  type GitHubPR,
  type GitHubReview,
} from "../../utils/github";
import type {ChannelManager} from "../channels/manager";
import type {AgentRunner} from "../runners/types";

const BOT_RESPONSE_MODEL = "claude-haiku-4-5-20251001";
const anthropic = new Anthropic();

// ── Skill prompts (loaded from disk at start) ─────────────────────────────

const FIX_CONFLICTS_PROMPT = `Pull latest from master, resolve merge conflicts, validate with lint/compile checks, and push.

Instructions:
1. Ensure the working tree is clean (git status). If there are uncommitted changes, stash them.
2. Fetch and merge latest master:
   git fetch origin master
   git merge origin/master
3. Check for merge conflicts: git diff --name-only --diff-filter=U
4. For each conflicted file: read it, resolve both sides intelligently, stage it.
5. After all conflicts resolved: git commit --no-edit
6. Run lint and compile checks at the project root (bun lint, bun compile). Fix any issues.
7. If fixes were needed, commit them.
8. Push: git push origin HEAD`;

const CHECK_WATCHER_PROMPT = `Monitor GitHub Actions checks and auto-fix failures.

Instructions:
1. Get the PR number: gh pr view --json number -q .number
2. Wait for CI: gh pr checks --watch --fail-fast
   - All passing -> done
   - Failed -> continue
3. Get failure details: gh run view <run-id> --log-failed
4. If failure is flaky (not in changed code + flaky signals), rerun: gh run rerun <run-id> --failed
5. If failure IS related to PR changes: fix the code, run lint/compile, commit and push, then repeat from step 2
6. Cap fix attempts at 5.`;

// ── Types ──────────────────────────────────────────────────────────────────

type PrEvent =
  | "new_pr"
  | "ci_passed"
  | "ci_failed"
  | "conflicts_detected"
  | "conflicts_resolved"
  | "new_bot_review"
  | "new_human_review"
  | "approved"
  | "changes_requested"
  | "ready_to_merge"
  | "pr_closed"
  | "pr_merged";

interface PrStateChange {
  event: PrEvent;
  detail?: string;
}

// ── Service ────────────────────────────────────────────────────────────────

export class PrWatcher {
  private channelManager: ChannelManager;
  private agentRunner: AgentRunner | null = null;
  private github: GitHubClient | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(channelManager: ChannelManager, agentRunner?: AgentRunner) {
    this.channelManager = channelManager;
    this.agentRunner = agentRunner || null;
  }

  async start(): Promise<void> {
    const config = await loadAppConfig();
    if (!config.prWatch.enabled) {
      logger.info("PR watcher is disabled");
      return;
    }

    if (!config.prWatch.groupId) {
      logger.warn("PR watcher enabled but no groupId configured");
      return;
    }

    if (!config.prWatch.githubUsername) {
      logger.warn("PR watcher enabled but no githubUsername configured");
      return;
    }

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      logger.warn("PR watcher enabled but GITHUB_TOKEN not set");
      return;
    }

    this.github = new GitHubClient(githubToken);

    const intervalMs = config.prWatch.pollIntervalMs || 120000;
    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        logger.error(`PR watcher poll error: ${err}`);
      });
    }, intervalMs);

    // Run an initial poll immediately
    this.poll().catch((err) => {
      logger.error(`PR watcher initial poll error: ${err}`);
    });

    logger.info(
      `PR watcher started (user: ${config.prWatch.githubUsername}, interval: ${intervalMs}ms)`
    );
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      logger.info("PR watcher stopped");
    }
  }

  setAgentRunner(runner: AgentRunner): void {
    this.agentRunner = runner;
  }

  // ── Main poll loop ────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    const config = await loadAppConfig();
    if (!config.prWatch.enabled || !this.github) {
      return;
    }

    this.isProcessing = true;
    try {
      const username = config.prWatch.githubUsername;
      const groupId = config.prWatch.groupId;

      // Step 1: Discover open PRs
      const openPRs = await this.github.getMyOpenPRs(username);
      logger.debug(`PR watcher found ${openPRs.length} open PRs`);

      // Step 2: Mark closed PRs
      await this.markClosedPRs(openPRs);

      // Step 3: Process each open PR
      for (const pr of openPRs) {
        try {
          await this.processPR(pr, groupId, config);
        } catch (err) {
          logger.error(`Error processing PR ${pr.repo}#${pr.prNumber}: ${err}`);
        }
      }
    } catch (err) {
      logger.error(`PR watcher poll error: ${err}`);
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Process a single PR ───────────────────────────────────────────────

  private async processPR(
    pr: GitHubPR,
    groupId: string,
    config: Awaited<ReturnType<typeof loadAppConfig>>
  ): Promise<void> {
    if (!this.github) {
      return;
    }

    const [owner, repo] = pr.repo.split("/");

    // Find or create the PrWatch doc
    let doc = await PrWatch.findOne({repo: pr.repo, prNumber: pr.prNumber});
    const isNew = !doc;

    if (!doc) {
      doc = await PrWatch.create({
        repo: pr.repo,
        prNumber: pr.prNumber,
        title: pr.title,
        url: pr.url,
        branch: pr.branch || "",
        baseBranch: pr.baseBranch || "",
        status: "open",
        isDraft: pr.isDraft,
        slackGroupId: groupId,
      });
    }

    // Fetch PR details (with ETag for conditional requests)
    const detailsResult = await this.github.getPRDetails(owner, repo, pr.prNumber);

    if (detailsResult.notModified && !isNew) {
      // Nothing changed since last poll
      await PrWatch.findByIdAndUpdate(doc._id, {$set: {lastPolledAt: new Date()}});
      return;
    }

    const events: PrStateChange[] = [];
    if (isNew) {
      events.push({event: "new_pr"});
    }

    const details = detailsResult.data;
    let headSha = "";

    if (details) {
      headSha = details.headSha;

      // Detect conflict changes
      if (details.hasConflicts && !doc.hasConflicts) {
        events.push({event: "conflicts_detected"});
      } else if (!details.hasConflicts && doc.hasConflicts) {
        events.push({event: "conflicts_resolved"});
      }

      doc.hasConflicts = details.hasConflicts;
      doc.mergeable = details.mergeable;
      doc.isDraft = details.isDraft;
    }

    // Fetch reviews
    const reviews = await this.github.getPRReviews(owner, repo, pr.prNumber);
    const reviewEvents = this.detectReviewChanges(doc, reviews);
    events.push(...reviewEvents);

    // Update reviews on doc
    doc.reviews = reviews.map((r) => ({
      reviewer: r.reviewer,
      state: r.state.toLowerCase() as any,
      isBot: r.isBot,
      body: r.body,
      submittedAt: new Date(r.submittedAt),
      // Preserve respondedAt if we already responded to this reviewer
      respondedAt: doc!.reviews.find(
        (existing) => existing.reviewer === r.reviewer && existing.respondedAt
      )?.respondedAt,
      responseBody: doc!.reviews.find(
        (existing) => existing.reviewer === r.reviewer && existing.responseBody
      )?.responseBody,
    }));

    // Count unreplied human comments
    doc.unrepliedHumanComments = reviews.filter(
      (r) =>
        !r.isBot &&
        (r.state === "CHANGES_REQUESTED" || r.state === "COMMENTED") &&
        !doc!.reviews.find((existing) => existing.reviewer === r.reviewer && existing.respondedAt)
    ).length;

    // Fetch CI checks
    if (headSha) {
      const checks = await this.github.getPRChecks(owner, repo, headSha);
      const ciEvents = this.detectCIChanges(doc, checks);
      events.push(...ciEvents);

      doc.checks = checks.map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
        detailsUrl: c.detailsUrl,
      }));

      const completedChecks = checks.filter((c) => c.status === "completed");
      if (completedChecks.length === checks.length && checks.length > 0) {
        doc.ciPassing = completedChecks.every((c) => c.conclusion === "success");
      } else if (checks.length === 0) {
        doc.ciPassing = null;
      }
    }

    // Detect review decision
    const approvals = reviews.filter((r) => r.state === "APPROVED");
    const changesRequested = reviews.filter((r) => r.state === "CHANGES_REQUESTED");
    if (changesRequested.length > 0) {
      doc.reviewDecision = "changes_requested";
    } else if (approvals.length > 0) {
      doc.reviewDecision = "approved";
    } else {
      doc.reviewDecision = "review_required";
    }

    // Ready to merge?
    if (
      doc.reviewDecision === "approved" &&
      doc.ciPassing === true &&
      !doc.hasConflicts &&
      !doc.isDraft
    ) {
      events.push({event: "ready_to_merge"});
    }

    // Act on events
    for (const change of events) {
      await this.handleEvent(doc, change, config);
    }

    // Update Slack message
    await this.updateSlackMessage(doc);

    // Persist
    doc.lastPolledAt = new Date();
    if (events.length > 0) {
      doc.lastChangedAt = new Date();
    }
    if (detailsResult.etag) {
      doc.etag = detailsResult.etag;
    }
    doc.title = pr.title;

    await doc.save();
  }

  // ── Detect state transitions ──────────────────────────────────────────

  private detectReviewChanges(doc: PrWatchDocument, reviews: GitHubReview[]): PrStateChange[] {
    const events: PrStateChange[] = [];
    const existingReviewers = new Set(doc.reviews.map((r) => `${r.reviewer}:${r.state}`));

    for (const review of reviews) {
      const key = `${review.reviewer}:${review.state.toLowerCase()}`;
      if (!existingReviewers.has(key)) {
        if (review.isBot) {
          events.push({
            event: "new_bot_review",
            detail: `${review.reviewer}: ${review.body.substring(0, 200)}`,
          });
        } else if (review.state === "APPROVED") {
          events.push({event: "approved", detail: review.reviewer});
        } else if (review.state === "CHANGES_REQUESTED") {
          events.push({
            event: "changes_requested",
            detail: `${review.reviewer}: ${review.body.substring(0, 200)}`,
          });
        } else if (review.state === "COMMENTED") {
          events.push({
            event: "new_human_review",
            detail: `${review.reviewer}: ${review.body.substring(0, 200)}`,
          });
        }
      }
    }

    return events;
  }

  private detectCIChanges(doc: PrWatchDocument, checks: GitHubCheckRun[]): PrStateChange[] {
    const events: PrStateChange[] = [];
    const completedChecks = checks.filter((c) => c.status === "completed");

    if (completedChecks.length === checks.length && checks.length > 0) {
      const allPassing = completedChecks.every((c) => c.conclusion === "success");
      const failedChecks = completedChecks.filter((c) => c.conclusion !== "success");

      if (allPassing && doc.ciPassing !== true) {
        events.push({event: "ci_passed"});
      } else if (!allPassing && doc.ciPassing !== false) {
        events.push({
          event: "ci_failed",
          detail: failedChecks.map((c) => c.name).join(", "),
        });
      }
    }

    return events;
  }

  // ── Handle events ─────────────────────────────────────────────────────

  private async handleEvent(
    doc: PrWatchDocument,
    change: PrStateChange,
    config: Awaited<ReturnType<typeof loadAppConfig>>
  ): Promise<void> {
    logger.info(
      `[${doc.repo}#${doc.prNumber}] Event: ${change.event}${change.detail ? ` — ${change.detail}` : ""}`
    );

    switch (change.event) {
      case "new_bot_review":
        if (config.prWatch.autoRespondToBots) {
          await this.handleBotReview(doc, change.detail || "");
        }
        break;

      case "conflicts_detected":
        if (config.prWatch.autoFixConflicts && doc.autoFixStatus !== "in_progress") {
          this.triggerAutoFix(doc, "conflicts", config).catch((err) => {
            logger.error(`Auto-fix error for ${doc.repo}#${doc.prNumber}: ${err}`);
          });
        }
        break;

      case "ci_failed":
        if (config.prWatch.autoFixConflicts && doc.autoFixStatus !== "in_progress") {
          this.triggerAutoFix(doc, "ci", config).catch((err) => {
            logger.error(`Auto-fix error for ${doc.repo}#${doc.prNumber}: ${err}`);
          });
        }
        break;

      default:
        break;
    }
  }

  // ── Bot review auto-response ──────────────────────────────────────────

  private async handleBotReview(doc: PrWatchDocument, detail: string): Promise<void> {
    if (!this.github) {
      return;
    }

    try {
      const response = await anthropic.messages.create({
        model: BOT_RESPONSE_MODEL,
        max_tokens: 512,
        system:
          "You are responding to an automated code review bot comment on a GitHub PR. " +
          "Generate a brief, appropriate response acknowledging the feedback. " +
          "If the bot is reporting a lint/formatting issue that should be fixed, say you'll fix it. " +
          "If the bot is reporting something informational, acknowledge it briefly. " +
          'Return JSON: { "response": "your response text", "shouldFix": true/false, "fixType": "lint"|"format"|"other" }',
        messages: [{role: "user", content: `Bot comment:\n${detail}`}],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const [owner, repo] = doc.repo.split("/");

      await this.github.postReviewComment(owner, repo, doc.prNumber, parsed.response);

      // Mark bot review as responded in doc
      const botReviewerName = detail.split(":")[0]?.trim();
      const review = doc.reviews.find((r) => r.isBot && r.reviewer === botReviewerName);
      if (review) {
        review.respondedAt = new Date();
        review.responseBody = parsed.response;
      }

      logger.info(
        `[${doc.repo}#${doc.prNumber}] Responded to bot review: ${parsed.response.substring(0, 80)}`
      );
    } catch (err) {
      logger.error(`Failed to respond to bot review on ${doc.repo}#${doc.prNumber}: ${err}`);
    }
  }

  // ── Auto-fix ──────────────────────────────────────────────────────────

  private async triggerAutoFix(
    doc: PrWatchDocument,
    fixType: "conflicts" | "ci",
    config: Awaited<ReturnType<typeof loadAppConfig>>
  ): Promise<void> {
    if (!this.agentRunner) {
      logger.warn("No agent runner available for auto-fix");
      return;
    }

    const [owner, repo] = doc.repo.split("/");
    const reposBaseDir = config.prWatch.reposBaseDir || "data/repos";
    const repoPath = `${reposBaseDir}/${owner}/${repo}`;

    doc.autoFixStatus = "in_progress";
    doc.autoFixType = fixType;
    doc.lastAutoFixAttempt = new Date();
    await doc.save();
    await this.updateSlackMessage(doc);

    const prompt = fixType === "conflicts" ? FIX_CONFLICTS_PROMPT : CHECK_WATCHER_PROMPT;

    const sessionId = `pr-fix-${doc.repo.replace("/", "-")}-${doc.prNumber}-${Date.now()}`;

    try {
      // Ensure repo is cloned and branch is checked out
      const {execSync} = await import("node:child_process");
      const fs = await import("node:fs");

      if (!fs.existsSync(repoPath)) {
        fs.mkdirSync(repoPath, {recursive: true});
        execSync(`git clone https://github.com/${doc.repo}.git ${repoPath}`, {
          timeout: 60000,
          stdio: "pipe",
        });
      }

      // Fetch and checkout the branch
      execSync(`git fetch origin && git checkout ${doc.branch}`, {
        cwd: repoPath,
        timeout: 30000,
        stdio: "pipe",
      });

      execSync(`git pull origin ${doc.branch}`, {
        cwd: repoPath,
        timeout: 30000,
        stdio: "pipe",
      });

      const result = await this.agentRunner.run({
        groupId: doc.slackGroupId,
        groupFolder: `pr-watch/${owner}/${repo}`,
        sessionId,
        prompt,
        modelBackend: "claude",
        env: {
          SHADE_CWD: repoPath,
        },
        timeout: fixType === "conflicts" ? 300000 : 600000,
        idleTimeout: 120000,
      });

      doc.autoFixStatus = result.status === "completed" ? "succeeded" : "failed";
      logger.info(
        `[${doc.repo}#${doc.prNumber}] Auto-fix ${fixType}: ${result.status} (${result.durationMs}ms)`
      );
    } catch (err) {
      doc.autoFixStatus = "failed";
      logger.error(`Auto-fix ${fixType} failed for ${doc.repo}#${doc.prNumber}: ${err}`);
    }

    await doc.save();
    await this.updateSlackMessage(doc);
  }

  // ── Slack message management ──────────────────────────────────────────

  private async updateSlackMessage(doc: PrWatchDocument): Promise<void> {
    const content = this.formatSlackMessage(doc);

    if (doc.slackMessageTs) {
      // Edit existing message
      await this.channelManager.updateMessageInGroup(doc.slackGroupId, doc.slackMessageTs, content);
    } else {
      // Send new message and store the ts
      const ts = await this.channelManager.sendMessageToGroupWithTs(doc.slackGroupId, content);
      if (ts) {
        doc.slackMessageTs = ts;
      }
    }
  }

  private formatSlackMessage(doc: PrWatchDocument): string {
    const parts: string[] = [];

    // Header
    const statusEmoji = doc.hasConflicts
      ? ":warning:"
      : doc.ciPassing === false
        ? ":x:"
        : doc.ciPassing === true
          ? ":white_check_mark:"
          : ":hourglass:";

    parts.push(`${statusEmoji} *<${doc.url}|${doc.repo}#${doc.prNumber}>* — ${doc.title}`);

    // Status line
    const statusParts: string[] = [];
    statusParts.push(`Status: ${doc.isDraft ? "Draft" : "Open"}`);

    if (doc.ciPassing === true) {
      statusParts.push("CI: Passing");
    } else if (doc.ciPassing === false) {
      const failedChecks = doc.checks.filter(
        (c) => c.status === "completed" && c.conclusion !== "success"
      );
      statusParts.push(`CI: Failed (${failedChecks.map((c) => c.name).join(", ")})`);
    } else {
      const inProgress = doc.checks.filter((c) => c.status !== "completed");
      statusParts.push(inProgress.length > 0 ? "CI: Running" : "CI: Unknown");
    }

    const approvals = doc.reviews.filter((r) => r.state === "approved" && !r.isBot);
    statusParts.push(`Reviews: ${approvals.length} approved`);

    if (doc.hasConflicts) {
      statusParts.push("*CONFLICTS*");
    }

    parts.push(statusParts.join(" | "));

    // Auto-fix status
    if (doc.autoFixStatus === "in_progress") {
      parts.push(`:wrench: Auto-fixing ${doc.autoFixType}...`);
    } else if (doc.autoFixStatus === "succeeded") {
      parts.push(`:white_check_mark: Auto-fix ${doc.autoFixType} succeeded`);
    } else if (doc.autoFixStatus === "failed") {
      parts.push(`:x: Auto-fix ${doc.autoFixType} failed`);
    }

    // Review details requiring action
    const actionableReviews = doc.reviews.filter(
      (r) =>
        !r.isBot && !r.respondedAt && (r.state === "changes_requested" || r.state === "commented")
    );

    if (actionableReviews.length > 0) {
      parts.push("--- Needs your response ---");
      for (const review of actionableReviews) {
        const ago = DateTime.fromJSDate(review.submittedAt).toRelative() || "recently";
        const stateLabel = review.state === "changes_requested" ? "requested changes" : "commented";
        parts.push(`• *${review.reviewer}* ${stateLabel} (${ago})`);
        if (review.body) {
          parts.push(`  _${review.body.substring(0, 150)}_`);
        }
      }
    }

    // Ready to merge
    if (
      doc.reviewDecision === "approved" &&
      doc.ciPassing === true &&
      !doc.hasConflicts &&
      !doc.isDraft
    ) {
      parts.push(":rocket: *Ready to merge*");
    }

    // Last checked
    if (doc.lastPolledAt) {
      const ago = DateTime.fromJSDate(doc.lastPolledAt).toRelative() || "just now";
      parts.push(`_Last checked: ${ago}_`);
    }

    return parts.join("\n");
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  private async markClosedPRs(openPRs: GitHubPR[]): Promise<void> {
    const openKeys = new Set(openPRs.map((pr) => `${pr.repo}:${pr.prNumber}`));

    const trackedOpen = await PrWatch.find({status: "open", unwatchedAt: null});
    for (const doc of trackedOpen) {
      const key = `${doc.repo}:${doc.prNumber}`;
      if (!openKeys.has(key)) {
        doc.status = "closed";
        doc.unwatchedAt = new Date();
        await doc.save();

        // Update slack message one last time
        await this.updateSlackMessage(doc);
        logger.info(`[${doc.repo}#${doc.prNumber}] PR no longer open, marked as closed`);
      }
    }
  }
}
