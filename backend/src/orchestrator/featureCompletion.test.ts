import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {reloadAppConfig} from "../models/appConfig";
import {Feature} from "../models/feature";
import {Group} from "../models/group";
import {Message} from "../models/message";
import type {GroupDocument} from "../types";
import {
  completeFeature,
  type FeatureCompletionDeps,
  FeatureCompletionWatcher,
  fetchPrState,
  latestPrUrl,
} from "./featureCompletion";
import type {ExecFn} from "./hostExec";

const createdGroupIds: mongoose.Types.ObjectId[] = [];

const makeFeatureGroup = async (
  overrides: Record<string, unknown> = {}
): Promise<GroupDocument> => {
  const suffix = new mongoose.Types.ObjectId().toString();
  const group = await Group.create({
    name: `feat-done-${suffix}`,
    folder: `features/feat-done-${suffix}`,
    channelId: new mongoose.Types.ObjectId(),
    externalId: `C-${suffix}`,
    featurePhase: "implementing",
    ...overrides,
  });
  createdGroupIds.push(group._id);
  await Feature.create({name: group.name, groupId: group._id, status: "in_progress"});
  return group;
};

const postBotMessage = async (group: GroupDocument, content: string): Promise<void> => {
  await Message.create({
    groupId: group._id,
    channelId: group.channelId,
    sender: "Shade",
    content,
    isFromBot: true,
    metadata: {},
  });
};

const makeDeps = () => {
  const archived: string[] = [];
  const sent: {groupId: string; content: string}[] = [];
  const reported: string[] = [];
  const deps: FeatureCompletionDeps = {
    archiveGroupChannel: async (groupId) => {
      archived.push(groupId);
    },
    sendMessageToGroup: async (groupId, content) => {
      sent.push({groupId, content});
    },
    reportError: (context) => {
      reported.push(context);
    },
  };
  return {deps, archived, sent, reported};
};

const ghReturning =
  (states: Record<string, string>): ExecFn =>
  async (argv) => {
    const url = argv[3];
    const state = states[url];
    if (!state) {
      return {code: 1, stdout: "", stderr: "not found"};
    }
    return {code: 0, stdout: `${state}\n`, stderr: ""};
  };

afterEach(async () => {
  if (createdGroupIds.length > 0) {
    await Message.deleteMany({groupId: {$in: createdGroupIds}});
    await Feature.deleteMany({groupId: {$in: createdGroupIds}});
    await Group.deleteMany({_id: {$in: createdGroupIds}});
    createdGroupIds.length = 0;
  }
});

describe("latestPrUrl", () => {
  test("returns the most recent PR link across messages (oldest first)", () => {
    expect(
      latestPrUrl({
        texts: [
          "Opened https://github.com/josh/lede/pull/3",
          "Replaced it with <https://github.com/josh/lede/pull/7|PR #7>",
        ],
      })
    ).toBe("https://github.com/josh/lede/pull/7");
  });

  test("prefers PRs in the feature's repo when one is known", () => {
    expect(
      latestPrUrl({
        texts: [
          "https://github.com/josh/lede/pull/7 depends on https://github.com/josh/shade/pull/99",
        ],
        repo: "lede",
      })
    ).toBe("https://github.com/josh/lede/pull/7");
  });

  test("returns undefined with no PR links", () => {
    expect(latestPrUrl({texts: ["working on it"]})).toBeUndefined();
  });
});

describe("fetchPrState", () => {
  test("reads the state gh reports", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (argv) => {
      calls.push(argv);
      return {code: 0, stdout: "MERGED\n", stderr: ""};
    };

    expect(await fetchPrState({url: "https://github.com/josh/lede/pull/7", exec})).toBe("MERGED");
    expect(calls[0]).toEqual([
      "gh",
      "pr",
      "view",
      "https://github.com/josh/lede/pull/7",
      "--json",
      "state",
      "--jq",
      ".state",
    ]);
  });

  test("returns undefined when gh fails", async () => {
    const exec: ExecFn = async () => ({code: 1, stdout: "", stderr: "boom"});
    expect(await fetchPrState({url: "https://github.com/josh/lede/pull/7", exec})).toBeUndefined();
  });
});

describe("completeFeature", () => {
  test("marks the group and feature complete, announces, and archives", async () => {
    const group = await makeFeatureGroup();
    const {deps, archived, sent} = makeDeps();

    const result = await completeFeature({group, reason: "PR merged", deps});

    expect(result.isCompleted).toBe(true);
    expect((await Group.findExactlyOne({_id: group._id})).featurePhase).toBe("complete");
    const feature = await Feature.findExactlyOne({groupId: group._id});
    expect(feature.status).toBe("complete");
    expect(feature.completedAt).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain("PR merged");
    expect(sent[0].content).toContain("Archiving");
    expect(archived).toEqual([group._id.toString()]);
  });

  test("is a no-op for an already complete feature", async () => {
    const group = await makeFeatureGroup({featurePhase: "complete"});
    const {deps, archived, sent} = makeDeps();

    const result = await completeFeature({group, reason: "again", deps});

    expect(result.isCompleted).toBe(false);
    expect(archived).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  test("refuses non-feature groups", async () => {
    const group = await makeFeatureGroup({featurePhase: undefined});
    const {deps, archived} = makeDeps();

    const result = await completeFeature({group, reason: "nope", deps});

    expect(result.isCompleted).toBe(false);
    expect(archived).toHaveLength(0);
  });

  test("reports an archive failure but still completes the feature", async () => {
    const group = await makeFeatureGroup();
    const {deps, reported} = makeDeps();
    deps.archiveGroupChannel = async () => {
      throw new Error("missing_scope");
    };

    const result = await completeFeature({group, reason: "PR merged", deps});

    expect(result.isCompleted).toBe(true);
    expect((await Group.findExactlyOne({_id: group._id})).featurePhase).toBe("complete");
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("archive");
  });
});

describe("FeatureCompletionWatcher", () => {
  beforeEach(async () => {
    const config = await reloadAppConfig();
    config.set("featureChannels.archiveOnMerge", true);
    await config.save();
  });

  afterEach(async () => {
    const config = await reloadAppConfig();
    config.set("featureChannels.archiveOnMerge", true);
    await config.save();
  });

  test("completes and archives features whose PR merged, leaves open ones", async () => {
    const merged = await makeFeatureGroup({executionConfig: {mode: "container", zergRepo: "lede"}});
    const open = await makeFeatureGroup();
    const noPr = await makeFeatureGroup();
    await postBotMessage(merged, "PR is up: https://github.com/josh/lede/pull/7");
    await postBotMessage(open, "PR is up: https://github.com/josh/lede/pull/8");
    await postBotMessage(noPr, "Still planning");
    const {deps, archived} = makeDeps();

    const watcher = new FeatureCompletionWatcher({
      deps,
      exec: ghReturning({
        "https://github.com/josh/lede/pull/7": "MERGED",
        "https://github.com/josh/lede/pull/8": "OPEN",
      }),
    });
    await watcher.tickNow();

    expect(archived).toEqual([merged._id.toString()]);
    expect((await Group.findExactlyOne({_id: open._id})).featurePhase).toBe("implementing");
    expect((await Group.findExactlyOne({_id: noPr._id})).featurePhase).toBe("implementing");
  });

  test("does nothing when archiveOnMerge is off", async () => {
    const config = await reloadAppConfig();
    config.set("featureChannels.archiveOnMerge", false);
    await config.save();
    const group = await makeFeatureGroup();
    await postBotMessage(group, "https://github.com/josh/lede/pull/7");
    const {deps, archived} = makeDeps();

    const watcher = new FeatureCompletionWatcher({
      deps,
      exec: ghReturning({"https://github.com/josh/lede/pull/7": "MERGED"}),
    });
    await watcher.tickNow();

    expect(archived).toHaveLength(0);
  });
});
