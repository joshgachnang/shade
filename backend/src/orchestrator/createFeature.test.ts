import {afterEach, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import {clearPathOverride, paths} from "../config";
import {AppConfig} from "../models/appConfig";
import {Feature} from "../models/feature";
import {Group} from "../models/group";
import {Message} from "../models/message";
import type {GroupDocument} from "../types/models/groupTypes";
import {createFeatureHandler} from "./createFeature";
import type {ExecFn} from "./hostExec";
import type {IpcCreateFeature} from "./ipc";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  clearPathOverride("groups");
});

const fixture = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "create-feature-"));
  paths.groups = dir;
  cleanup.push(() => fs.rm(dir, {recursive: true, force: true}));
  const channelId = new mongoose.Types.ObjectId();
  const source = await Group.create({
    name: "main",
    folder: `main-${channelId}`,
    channelId,
    externalId: "main",
    isMain: true,
  });
  cleanup.push(async () => {
    const groups = await Group.find({channelId});
    await Message.deleteMany({groupId: {$in: groups.map((group) => group._id)}});
    await Feature.deleteMany({groupId: {$in: groups.map((group) => group._id)}});
    await Group.deleteMany({channelId});
  });
  const data: IpcCreateFeature = {
    type: "create_feature",
    groupId: String(source._id),
    channelId: String(channelId),
    name: `feat-shade-${channelId}`,
    senderExternalId: "requester",
    repo: "owner/shade",
    request: "Build café\n'quotes' $(touch forbidden) `uname`\n",
  };
  const config = new AppConfig({zerg: {enabled: true, sshHost: ""}});
  const registered: GroupDocument[] = [];
  const notices: string[] = [];
  const invitations: string[][] = [];
  const commands: string[][] = [];
  const exec: ExecFn = async (argv) => {
    commands.push(argv);
    if (argv.join(" ").includes("agents"))
      return {
        code: 0,
        stderr: "",
        stdout:
          "Agents:\n  ✓ fake command\nStages:\n" +
          ["distill", "cut", "pick", "roast", "review", "brew", "taste"]
            .map((stage) => `  ${stage} first of fake`)
            .join("\n"),
      };
    return {code: 0, stdout: "", stderr: ""};
  };
  const transport = {
    createFeatureChannel: async (...args: string[]) => {
      invitations.push(args);
      return {slackChannelId: "feature-channel"};
    },
    registerGroup: (group: GroupDocument) => {
      registered.push(group);
    },
    sendMessage: async (_channel: string, _target: string, text: string) => {
      notices.push(text);
    },
  };
  return {dir, source, data, config, registered, notices, invitations, commands, exec, transport};
};

test("create_feature starts brewery with the original request, without agent memory, greeting or seed", async () => {
  const f = await fixture();
  await createFeatureHandler(f.transport, {exec: f.exec, loadConfig: async () => f.config})(f.data);
  const group = await Group.findOneOrNone({
    externalId: "feature-channel",
    channelId: f.source.channelId,
  });
  expect(group?.featureDriver).toBe("brewery");
  expect(group?.requiresTrigger).toBe(false);
  expect(f.registered[0]?.featureDriver).toBe("brewery");
  expect(f.invitations).toEqual([[String(f.source.channelId), f.data.name, "requester"]]);
  const feature = await Feature.findOneOrNone({groupId: group!._id});
  expect(feature?.status).toBe("in_progress");
  expect(feature?.brewery?.repo).toBe("owner/shade");
  expect(feature?.brewery?.phase).toBe("distill");
  expect(f.commands.some((argv) => argv.includes("-d") && argv.join(" ").includes("distill"))).toBe(
    true
  );
  expect(f.commands.some((argv) => argv.join(" ").includes("Build café"))).toBe(true);
  expect(await Message.countDocuments({groupId: group!._id})).toBe(0);
  expect(await fs.readdir(path.join(f.dir, group!.folder)).catch(() => [])).toEqual([]);
  expect(f.notices).toEqual([]);
  expect((await Group.findById(f.source._id))?.featureDriver).toBeUndefined();
});

for (const [label, input, expected] of [
  ["missing request", {request: undefined}, "request"],
  ["empty request", {request: " \n"}, "request"],
  ["missing repository", {repo: undefined}, "repository"],
  ["invalid repository", {repo: "../shade"}, "repository"],
] as const) {
  test(`${label} leaves a brewery-only error channel and reports the fix`, async () => {
    const f = await fixture();
    await expect(
      createFeatureHandler(f.transport, {
        exec: f.exec,
        loadConfig: async () => f.config,
      })({...f.data, ...input})
    ).rejects.toThrow(expected);
    const group = f.registered[0]!;
    const feature = await Feature.findOneOrNone({groupId: group._id});
    expect(group.featureDriver).toBe("brewery");
    expect(feature?.status).toBe("error");
    expect(feature?.errorMessage).toContain(expected);
    expect(f.notices.join(" ")).toContain("Brewery could not start");
    expect(f.commands).toEqual([]);
    expect(await Message.countDocuments({groupId: group._id})).toBe(0);
  });
}

test("brewery preflight failure remains visible with no agent fallback or request leak", async () => {
  const f = await fixture();
  await expect(
    createFeatureHandler(f.transport, {
      loadConfig: async () => f.config,
      exec: async (argv, opts) =>
        argv.includes("agents")
          ? {code: 127, stdout: "", stderr: "private external output"}
          : f.exec(argv, opts),
    })(f.data)
  ).rejects.toThrow("preflight");
  const group = f.registered[0]!;
  expect((await Group.findById(group._id))?.featureDriver).toBe("brewery");
  expect((await Feature.findOneOrNone({groupId: group._id}))?.status).toBe("error");
  expect(f.notices.join(" ")).toContain("Install brewery");
  expect(f.notices.join(" ")).not.toContain("private external output");
  expect(f.notices.join(" ")).not.toContain(f.data.request!);
  expect(await Message.countDocuments({groupId: group._id})).toBe(0);
});

test("missing source and failed Slack creation do not start a run or register a group", async () => {
  const f = await fixture();
  const handler = createFeatureHandler(f.transport, {
    exec: f.exec,
    loadConfig: async () => f.config,
  });
  await expect(
    handler({...f.data, groupId: String(new mongoose.Types.ObjectId())})
  ).rejects.toThrow("not found");
  expect(f.invitations).toEqual([]);
  await expect(
    createFeatureHandler(
      {
        ...f.transport,
        createFeatureChannel: async () => {
          throw new Error("Slack unavailable");
        },
      },
      {exec: f.exec, loadConfig: async () => f.config}
    )(f.data)
  ).rejects.toThrow("Slack unavailable");
  expect(f.registered).toEqual([]);
  expect(f.commands).toEqual([]);
  expect(await Group.countDocuments({channelId: f.source.channelId})).toBe(1);
});

test("local configuration launches from an isolated worktree with the verbatim original request", async () => {
  const f = await fixture();
  f.config.zerg.enabled = false;
  f.config.featureChannels.localReposDir = f.dir;
  const repoPath = path.join(f.dir, "shade");
  const {defaultExec} = await import("./hostExec");
  for (const argv of [
    ["git", "init", "-b", "main", repoPath],
    [
      "git",
      "-C",
      repoPath,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ],
    ["git", "-C", repoPath, "update-ref", "refs/remotes/origin/main", "HEAD"],
    ["git", "-C", repoPath, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
  ])
    expect((await defaultExec(argv, {timeoutMs: 10000})).code).toBe(0);
  const launches: {argv: string[]; cwd: string; request: string}[] = [];
  await createFeatureHandler(f.transport, {
    loadConfig: async () => f.config,
    exec: async (argv, opts) => (argv[0] === "git" ? defaultExec(argv, opts) : f.exec(argv, opts)),
    launch: async (argv, cwd) => {
      launches.push({
        argv,
        cwd,
        request: await fs.readFile(path.join(cwd, argv[argv.indexOf("--file") + 1]!), "utf8"),
      });
    },
  })(f.data);
  const feature = await Feature.findOneOrNone({groupId: f.registered[0]!._id});
  expect(feature?.brewery?.workspace.kind).toBe("local");
  expect(feature?.brewery?.repo).toBe("owner/shade");
  expect(launches).toHaveLength(1);
  expect(launches[0]!.request).toBe(f.data.request!);
  expect(launches[0]!.cwd).not.toBe(repoPath);
  expect(launches[0]!.argv.slice(0, 3)).toEqual(["brewery", "distill", "--file"]);
  expect(launches[0]!.argv).toContain("--no-wait");
});

test("IPC dispatch authorizes main only and invokes the production brewery handler", async () => {
  const f = await fixture();
  const {IpcWatcher} = await import("./ipc");
  const {writeIpcFile} = await import("./ipcWriter");
  const ipcDir = path.join(f.dir, "ipc");
  await fs.mkdir(ipcDir);
  paths.ipc = ipcDir;
  cleanup.push(async () => clearPathOverride("ipc"));
  const watcher = new IpcWatcher();
  watcher.setCreateFeature(
    createFeatureHandler(f.transport, {exec: f.exec, loadConfig: async () => f.config})
  );
  watcher.setSendMessage(f.transport.sendMessage);
  await writeIpcFile(ipcDir, {...f.data});
  await watcher.tickNow();
  expect(f.registered).toHaveLength(1);
  expect((await Feature.findOneOrNone({groupId: f.registered[0]!._id}))?.brewery?.phase).toBe(
    "distill"
  );
  await writeIpcFile(ipcDir, {
    ...f.data,
    groupId: String(f.registered[0]!._id),
    name: "feat-denied",
  });
  await watcher.tickNow();
  expect(f.registered).toHaveLength(1);
  expect(f.notices.join(" ")).toContain("not permitted from this channel");
});
