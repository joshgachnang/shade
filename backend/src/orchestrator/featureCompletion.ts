import {logger} from "@terreno/api";
import {loadAppConfig} from "../models/appConfig";
import {Feature} from "../models/feature";
import {Group} from "../models/group";
import {Message} from "../models/message";
import type {GroupDocument} from "../types";
import type {ReportErrorFn} from "./errors";
import {defaultExec, type ExecFn} from "./hostExec";

const PR_URL_PATTERN = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)\/pull\/\d+/g;
const GH_TIMEOUT_MS = 30_000;
/** How far back in a channel to look for the feature's PR link. */
const MESSAGE_SCAN_LIMIT = 200;

export type PrState = "OPEN" | "MERGED" | "CLOSED";

export interface FeatureCompletionDeps {
  archiveGroupChannel: (groupId: string) => Promise<void>;
  sendMessageToGroup: (groupId: string, content: string) => Promise<void>;
  reportError: ReportErrorFn;
}

/**
 * The PR a feature channel is shipping: the last PR link in its messages
 * (oldest first). When the feature's repo is known, links to other repos
 * (dependencies, references) are ignored.
 */
export const latestPrUrl = ({
  texts,
  repo,
}: {
  texts: string[];
  repo?: string;
}): string | undefined => {
  const repoName = repo?.split("/").pop()?.toLowerCase();
  let latest: string | undefined;
  for (const text of texts) {
    for (const match of text.matchAll(PR_URL_PATTERN)) {
      if (repoName && match[1].toLowerCase() !== repoName) {
        continue;
      }
      latest = match[0];
    }
  }
  return latest;
};

export const fetchPrState = async ({
  url,
  exec = defaultExec,
}: {
  url: string;
  exec?: ExecFn;
}): Promise<PrState | undefined> => {
  const result = await exec(["gh", "pr", "view", url, "--json", "state", "--jq", ".state"], {
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    logger.warn(`gh pr view ${url} failed: ${result.stderr.trim()}`);
    return undefined;
  }
  const state = result.stdout.trim();
  if (state === "OPEN" || state === "MERGED" || state === "CLOSED") {
    return state;
  }
  return undefined;
};

/**
 * Close out a feature channel: mark the group and its Feature record
 * complete, say why in the channel, then archive it. Archiving last keeps the
 * wrap-up message visible in the archived history.
 */
export const completeFeature = async ({
  group,
  reason,
  deps,
}: {
  group: GroupDocument;
  reason: string;
  deps: FeatureCompletionDeps;
}): Promise<{isCompleted: boolean}> => {
  if (!group.featurePhase || group.featurePhase === "complete") {
    return {isCompleted: false};
  }

  const groupId = group._id.toString();
  await Group.findByIdAndUpdate(group._id, {$set: {featurePhase: "complete"}});
  group.featurePhase = "complete";
  await Feature.updateMany(
    {groupId: group._id, status: {$ne: "complete"}},
    {$set: {status: "complete", completedAt: new Date()}}
  );
  logger.info(`Feature ${group.name} complete: ${reason}`);

  try {
    await deps.sendMessageToGroup(
      groupId,
      `:white_check_mark: Feature complete — ${reason}. Archiving this channel.`
    );
  } catch (err) {
    logger.warn(`Could not post completion notice in ${group.name}: ${err}`);
  }

  try {
    await deps.archiveGroupChannel(groupId);
    logger.info(`Archived feature channel ${group.name} (${group.externalId})`);
  } catch (err) {
    deps.reportError(`Failed to archive feature channel ${group.name}`, err, {
      group: group.name,
      externalId: group.externalId,
    });
  }

  return {isCompleted: true};
};

/**
 * Polls in-progress feature channels and completes the ones whose PR has
 * merged. Uses the host `gh` (already authenticated for the Shade user), so
 * it works without the PR watcher's GitHub token.
 */
export class FeatureCompletionWatcher {
  private deps: FeatureCompletionDeps;
  private exec: ExecFn;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;

  constructor({deps, exec = defaultExec}: {deps: FeatureCompletionDeps; exec?: ExecFn}) {
    this.deps = deps;
    this.exec = exec;
  }

  async start(): Promise<void> {
    if (this.intervalId) {
      return;
    }
    const appConfig = await loadAppConfig();
    const interval = appConfig.featureChannels.completionPollMs;
    this.intervalId = setInterval(() => {
      this.tickNow().catch((err) => {
        this.deps.reportError("Feature completion poll failed", err);
      });
    }, interval);
    logger.info(`Feature completion watcher started (interval: ${interval}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async tickNow(): Promise<void> {
    if (this.isTicking) {
      return;
    }
    this.isTicking = true;
    try {
      const appConfig = await loadAppConfig();
      if (!appConfig.featureChannels.archiveOnMerge) {
        return;
      }

      const groups = await Group.find({featurePhase: {$in: ["planning", "implementing"]}});
      for (const group of groups) {
        await this.checkGroup(group);
      }
    } finally {
      this.isTicking = false;
    }
  }

  private async checkGroup(group: GroupDocument): Promise<void> {
    const messages = await Message.find({groupId: group._id, isFromBot: true})
      .sort({created: -1})
      .limit(MESSAGE_SCAN_LIMIT)
      .lean();
    const url = latestPrUrl({
      texts: messages.reverse().map((message) => message.content),
      repo: group.executionConfig?.zergRepo,
    });
    if (!url) {
      return;
    }

    const state = await fetchPrState({url, exec: this.exec});
    if (state !== "MERGED") {
      return;
    }

    await completeFeature({group, reason: `${url} was merged`, deps: this.deps});
  }
}
