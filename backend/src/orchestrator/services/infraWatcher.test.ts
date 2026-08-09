import {beforeEach, describe, expect, test} from "bun:test";
import {InfraChange} from "../../models/infraChange";
import type {GitHubClient, GitHubPRDetails, GitHubReview} from "../../utils/github";
import type {ChannelManager} from "../channels/manager";
import {deriveCiPassing, deriveReviewDecision, InfraWatcher} from "./infraWatcher";

const review = (state: GitHubReview["state"]): GitHubReview => ({
  reviewer: "alice",
  state,
  body: "",
  submittedAt: "2026-01-01T00:00:00Z",
  isBot: false,
});

const details = (over: Partial<GitHubPRDetails>): GitHubPRDetails => ({
  mergeable: true,
  mergeableState: "clean",
  hasConflicts: false,
  isDraft: false,
  headSha: "abc123",
  state: "open",
  merged: false,
  ...over,
});

// A GitHubClient stand-in returning canned data — no network.
const fakeGh = (opts: {
  details: GitHubPRDetails;
  reviews?: GitHubReview[];
  checks?: Awaited<ReturnType<GitHubClient["getPRChecks"]>>;
}): GitHubClient =>
  ({
    getPRDetails: async () => ({data: opts.details, etag: null, notModified: false}),
    getPRReviews: async () => opts.reviews ?? [],
    getPRChecks: async () => opts.checks ?? [],
  }) as unknown as GitHubClient;

const makeWatcher = () => {
  const sent: {groupId: string; content: string}[] = [];
  const channelManager = {
    sendMessageToGroup: async (groupId: string, content: string) => {
      sent.push({groupId, content});
    },
  } as unknown as ChannelManager;
  return {watcher: new InfraWatcher(channelManager), sent};
};

const seedChange = () =>
  InfraChange.create({
    repoName: "stacks",
    owner: "acme",
    repo: "stacks",
    prNumber: 7,
    url: "https://github.com/acme/stacks/pull/7",
    branch: "infra-bot/x",
    title: "Add nginx",
    groupId: "g1",
    status: "open",
  });

describe("derive helpers", () => {
  test("review decision prioritizes changes_requested over approved", () => {
    expect(deriveReviewDecision([review("APPROVED"), review("CHANGES_REQUESTED")])).toBe(
      "changes_requested"
    );
    expect(deriveReviewDecision([review("APPROVED")])).toBe("approved");
    expect(deriveReviewDecision([])).toBe("review_required");
  });

  test("ci passing only true when all checks completed successfully", () => {
    expect(deriveCiPassing([])).toBeNull();
    expect(
      deriveCiPassing([{name: "t", status: "in_progress", conclusion: null, detailsUrl: ""}])
    ).toBeNull();
    expect(
      deriveCiPassing([{name: "t", status: "completed", conclusion: "success", detailsUrl: ""}])
    ).toBe(true);
    expect(
      deriveCiPassing([{name: "t", status: "completed", conclusion: "failure", detailsUrl: ""}])
    ).toBe(false);
  });
});

describe("InfraWatcher.processChange", () => {
  beforeEach(async () => {
    await InfraChange.deleteMany({});
  });

  test("announces a merge and stops tracking", async () => {
    const doc = await seedChange();
    const {watcher, sent} = makeWatcher();

    await (watcher as any).processChange(doc, fakeGh({details: details({merged: true})}));

    const reloaded = await InfraChange.findById(doc._id);
    expect(reloaded?.status).toBe("merged");
    expect(reloaded?.mergedAt).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain("merged");
    expect(sent[0].groupId).toBe("g1");
  });

  test("announces a close-without-merge", async () => {
    const doc = await seedChange();
    const {watcher, sent} = makeWatcher();

    await (watcher as any).processChange(
      doc,
      fakeGh({details: details({state: "closed", merged: false})})
    );

    const reloaded = await InfraChange.findById(doc._id);
    expect(reloaded?.status).toBe("closed");
    expect(sent[0].content).toContain("closed without merging");
  });

  test("reports a review/CI status change once, then stays quiet when unchanged", async () => {
    const doc = await seedChange();
    const {watcher, sent} = makeWatcher();
    const gh = fakeGh({
      details: details({}),
      reviews: [review("APPROVED")],
      checks: [{name: "ci", status: "completed", conclusion: "success", detailsUrl: ""}],
    });

    await (watcher as any).processChange(doc, gh);
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain("Review: approved");
    expect(sent[0].content).toContain("CI: passing");

    const reloaded = await InfraChange.findById(doc._id);
    expect(reloaded?.reviewDecision).toBe("approved");
    expect(reloaded?.ciPassing).toBe(true);
    expect(reloaded?.status).toBe("open");

    // Second poll with identical state → no new message.
    await (watcher as any).processChange(reloaded, gh);
    expect(sent).toHaveLength(1);
  });
});
