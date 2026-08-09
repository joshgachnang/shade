/**
 * Infra Watcher service.
 *
 * Polls the open infra pull requests the bot proposed (InfraChange docs) and
 * reports review / CI / merge transitions back to the group. This closes the
 * feedback loop the "AI dev platform" post called out as missing: once a human
 * merges, GitOps deploys, and the group hears about it — the bot never merges
 * or deploys itself.
 */

import {logger} from "@terreno/api";
import {loadAppConfig} from "../../models/appConfig";
import {InfraChange} from "../../models/infraChange";
import type {InfraChangeDocument} from "../../types/models/infraChangeTypes";
import {type GitHubCheckRun, GitHubClient, type GitHubReview} from "../../utils/github";
import type {ChannelManager} from "../channels/manager";

export const deriveReviewDecision = (
  reviews: GitHubReview[]
): "approved" | "changes_requested" | "review_required" => {
  if (reviews.some((r) => r.state === "CHANGES_REQUESTED")) {
    return "changes_requested";
  }
  if (reviews.some((r) => r.state === "APPROVED")) {
    return "approved";
  }
  return "review_required";
};

export const deriveCiPassing = (checks: GitHubCheckRun[]): boolean | null => {
  if (checks.length === 0) {
    return null;
  }
  const completed = checks.filter((c) => c.status === "completed");
  if (completed.length !== checks.length) {
    return null; // still running
  }
  return completed.every((c) => c.conclusion === "success");
};

const ciLabel = (ciPassing: boolean | null): string =>
  ciPassing === true ? "passing" : ciPassing === false ? "failing" : "pending";

export class InfraWatcher {
  private channelManager: ChannelManager;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(channelManager: ChannelManager) {
    this.channelManager = channelManager;
  }

  async start(): Promise<void> {
    const config = await loadAppConfig();
    if (!config.infraBot.enabled) {
      logger.debug("Infra watcher is disabled");
      return;
    }
    if (!config.apiKeys.github) {
      logger.warn("Infra watcher enabled but no GitHub token configured; not starting");
      return;
    }

    const intervalMs = config.infraBot.watchPollIntervalMs || 300000;
    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => logger.error(`Infra watcher poll error: ${err}`));
    }, intervalMs);

    this.poll().catch((err) => logger.error(`Infra watcher initial poll error: ${err}`));
    logger.info(`Infra watcher started (interval: ${intervalMs}ms)`);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      logger.info("Infra watcher stopped");
    }
  }

  async poll(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    const config = await loadAppConfig();
    if (!config.infraBot.enabled || !config.apiKeys.github) {
      return;
    }

    this.isProcessing = true;
    try {
      // A fresh client each poll keeps GitHubClient's per-PR ETag cache from
      // short-circuiting getPRDetails into a data-less "not modified" response.
      const github = new GitHubClient(config.apiKeys.github);
      const open = await InfraChange.find({status: "open"});
      for (const doc of open) {
        try {
          await this.processChange(doc, github);
        } catch (err) {
          logger.error(`Infra watcher error on ${doc.repoName}#${doc.prNumber}: ${err}`);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processChange(doc: InfraChangeDocument, github: GitHubClient): Promise<void> {
    const detailsResult = await github.getPRDetails(doc.owner, doc.repo, doc.prNumber);
    const details = detailsResult.data;
    const reviews = await github.getPRReviews(doc.owner, doc.repo, doc.prNumber);
    const checks = details?.headSha
      ? await github.getPRChecks(doc.owner, doc.repo, details.headSha)
      : [];

    const reviewDecision = deriveReviewDecision(reviews);
    const ciPassing = deriveCiPassing(checks);
    doc.reviewDecision = reviewDecision;
    doc.ciPassing = ciPassing;
    doc.lastPolledAt = new Date();

    // Terminal transitions first — they stop the watcher following this PR.
    if (details?.merged) {
      doc.status = "merged";
      doc.mergedAt = new Date();
      await doc.save();
      await this.notify(
        doc,
        `:rocket: *<${doc.url}|${doc.repoName}#${doc.prNumber}>* merged — GitOps is deploying.`
      );
      return;
    }
    if (details && details.state === "closed") {
      doc.status = "closed";
      doc.closedAt = new Date();
      await doc.save();
      await this.notify(
        doc,
        `:no_entry: *<${doc.url}|${doc.repoName}#${doc.prNumber}>* was closed without merging.`
      );
      return;
    }

    // Non-terminal: only speak up when the compact status actually changes.
    const summary = `review=${reviewDecision} ci=${ciLabel(ciPassing)} conflicts=${
      details?.hasConflicts ?? "?"
    }`;
    if (summary !== doc.lastSummary) {
      doc.lastSummary = summary;
      await doc.save();
      const bits = [`Review: ${reviewDecision.replace("_", " ")}`, `CI: ${ciLabel(ciPassing)}`];
      if (details?.hasConflicts) {
        bits.push("*conflicts*");
      }
      await this.notify(
        doc,
        `:mag: *<${doc.url}|${doc.repoName}#${doc.prNumber}>* — ${bits.join(" | ")}`
      );
      return;
    }

    await doc.save();
  }

  private async notify(doc: InfraChangeDocument, content: string): Promise<void> {
    if (!doc.groupId) {
      return;
    }
    await this.channelManager.sendMessageToGroup(doc.groupId, content);
  }
}
