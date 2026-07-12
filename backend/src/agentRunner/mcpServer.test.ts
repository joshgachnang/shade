import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import {clearPathOverride, paths} from "../config";
import {AgentTask} from "../models/agentTask";
import {reloadAppConfig} from "../models/appConfig";
import {Channel} from "../models/channel";
import {Group} from "../models/group";
import {Message} from "../models/message";
import {buildTools, type McpContext} from "./mcpServer";

// Track created fixtures so afterEach can remove them — leftover slack
// channels/main groups break ChannelManager tests in other files.
const createdChannelIds: mongoose.Types.ObjectId[] = [];
const createdGroupIds: mongoose.Types.ObjectId[] = [];

const makeGroup = async ({isMain = false}: {isMain?: boolean} = {}) => {
  const suffix = new mongoose.Types.ObjectId().toString();
  const channel = await Channel.create({
    name: `test-channel-${suffix}`,
    type: "slack",
    status: "connected",
    privileged: false,
    config: {},
  });
  const group = await Group.create({
    name: `test-group-${suffix}`,
    externalId: `ext-${suffix}`,
    channelId: channel._id,
    isMain,
    folder: `test-${suffix}`,
  });
  createdChannelIds.push(channel._id);
  createdGroupIds.push(group._id);
  return {group, channel};
};

const makeContext = (groupId: string, channelId: string): McpContext => ({
  groupId,
  channelId,
  ipcDir: path.join(process.cwd(), `tmp-test-ipc-${Date.now()}`),
  groupFolder: `/tmp/test-group-folder`,
});

const callTool = async (
  ctx: McpContext,
  name: string,
  args: Record<string, unknown>
): Promise<string> => {
  const tools = buildTools(ctx);
  const toolDef = tools.find((t) => t.name === name);
  if (!toolDef) {
    throw new Error(`Tool ${name} not registered`);
  }
  const handler = toolDef.handler as (
    a: unknown,
    e: unknown
  ) => Promise<{content: {text: string}[]}>;
  const result = await handler(args, {});
  return result.content[0].text;
};

const setMemoryConfig = async (patch: Record<string, unknown>): Promise<void> => {
  // reload, don't load: another test file may have deleted the cached doc.
  const config = await reloadAppConfig();
  for (const [key, value] of Object.entries(patch)) {
    config.set(`memory.${key}`, value);
  }
  await config.save();
};

const resetMemoryConfig = async (): Promise<void> => {
  await setMemoryConfig({
    enabled: true,
    maxFileChars: 6000,
    maxSkillChars: 8000,
    historySearchLimit: 8,
  });
};

const setTaskWorkerEnabled = async (enabled: boolean): Promise<void> => {
  // reload, don't load: another test file may have deleted the cached doc.
  const config = await reloadAppConfig();
  config.set("taskWorker.enabled", enabled);
  await config.save();
};

afterEach(async () => {
  await resetMemoryConfig();
  await setTaskWorkerEnabled(true);
  if (createdGroupIds.length > 0) {
    await AgentTask.deleteMany({groupId: {$in: createdGroupIds}});
    await Message.deleteMany({groupId: {$in: createdGroupIds}});
    await Group.deleteMany({_id: {$in: createdGroupIds}});
    createdGroupIds.length = 0;
  }
  if (createdChannelIds.length > 0) {
    await Channel.deleteMany({_id: {$in: createdChannelIds}});
    createdChannelIds.length = 0;
  }
});

describe("search_history tool", () => {
  beforeEach(async () => {
    await Message.init();
  });

  test("returns matching messages scoped to the group, formatted with ISO date and sender", async () => {
    const {group, channel} = await makeGroup();
    const {group: otherGroup, channel: otherChannel} = await makeGroup();
    await Message.create({
      groupId: group._id,
      channelId: channel._id,
      sender: "alice",
      content: "the greenhouse thermostat needs recalibration",
      isFromBot: false,
    });
    await Message.create({
      groupId: group._id,
      channelId: channel._id,
      sender: "bob",
      content: "unrelated chatter about lunch",
      isFromBot: false,
    });
    await Message.create({
      groupId: otherGroup._id,
      channelId: otherChannel._id,
      sender: "carol",
      content: "greenhouse thermostat gossip from another group",
      isFromBot: false,
    });

    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "greenhouse thermostat"});

    const lines = text.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("alice: the greenhouse thermostat needs recalibration");
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toContain("carol");
  });

  test("labels bot messages as Shade", async () => {
    const {group, channel} = await makeGroup();
    await Message.create({
      groupId: group._id,
      channelId: channel._id,
      sender: "some-bot-id",
      content: "zeppelin maintenance completed successfully",
      isFromBot: true,
    });

    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "zeppelin maintenance"});
    expect(text).toContain("Shade: zeppelin maintenance");
  });

  test("orders results by text score (best match first)", async () => {
    const {group, channel} = await makeGroup();
    await Message.create({
      groupId: group._id,
      channelId: channel._id,
      sender: "alice",
      content:
        "we briefly mentioned quasar readings during a long conversation about many other things entirely",
      isFromBot: false,
    });
    await Message.create({
      groupId: group._id,
      channelId: channel._id,
      sender: "bob",
      content: "quasar quasar quasar readings",
      isFromBot: false,
    });

    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "quasar readings"});
    const lines = text.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("bob");
    expect(lines[1]).toContain("alice");
  });

  test("caps results at historySearchLimit even when a larger limit is requested", async () => {
    await setMemoryConfig({historySearchLimit: 2});
    const {group, channel} = await makeGroup();
    for (let i = 0; i < 4; i++) {
      await Message.create({
        groupId: group._id,
        channelId: channel._id,
        sender: "alice",
        content: `flamingo sighting number ${i}`,
        isFromBot: false,
      });
    }

    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "flamingo", limit: 50});
    expect(text.split("\n").length).toBe(2);
  });

  test("respects a smaller caller-provided limit", async () => {
    const {group, channel} = await makeGroup();
    for (let i = 0; i < 3; i++) {
      await Message.create({
        groupId: group._id,
        channelId: channel._id,
        sender: "alice",
        content: `walrus report ${i}`,
        isFromBot: false,
      });
    }

    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "walrus", limit: 1});
    expect(text.split("\n").length).toBe(1);
  });

  test("excludes messages older than the days cutoff", async () => {
    const {group, channel} = await makeGroup();
    const oldMessage = await Message.create({
      groupId: group._id,
      channelId: channel._id,
      sender: "alice",
      content: "ancient mongoose sighting",
      isFromBot: false,
    });
    await Message.collection.updateOne(
      {_id: oldMessage._id},
      {$set: {created: DateTime.now().minus({days: 120}).toJSDate()}}
    );
    await Message.create({
      groupId: group._id,
      channelId: channel._id,
      sender: "bob",
      content: "recent mongoose sighting",
      isFromBot: false,
    });

    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "mongoose sighting", days: 30});
    expect(text).toContain("recent mongoose");
    expect(text).not.toContain("ancient mongoose");
  });

  test("truncates message content to 300 characters", async () => {
    const {group, channel} = await makeGroup();
    const longContent = `aardvark ${"x".repeat(400)}`;
    await Message.create({
      groupId: group._id,
      channelId: channel._id,
      sender: "alice",
      content: longContent,
      isFromBot: false,
    });

    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "aardvark"});
    expect(text).toContain(longContent.slice(0, 300));
    expect(text).not.toContain(longContent);
  });

  test("returns 'No matches.' when nothing matches", async () => {
    const {group, channel} = await makeGroup();
    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "xylophone-nonexistent-term"});
    expect(text).toBe("No matches.");
  });

  test("reports disabled when memory.enabled is false", async () => {
    await setMemoryConfig({enabled: false});
    const {group, channel} = await makeGroup();
    const ctx = makeContext(group._id.toString(), channel._id.toString());
    const text = await callTool(ctx, "search_history", {query: "anything"});
    expect(text).toBe("Memory features are disabled");
  });
});

describe("update_memory tool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      process.cwd(),
      `tmp-test-mcp-memory-${Date.now()}-${Math.floor(Math.random() * 100000)}`
    );
    await fs.mkdir(tmpDir, {recursive: true});
    paths.groups = tmpDir;
  });

  afterEach(async () => {
    clearPathOverride("groups");
    await fs.rm(tmpDir, {recursive: true, force: true});
  });

  test("main group can replace global memory", async () => {
    const {group, channel} = await makeGroup({isMain: true});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "update_memory", {
      scope: "global",
      content: "Global fact.",
      mode: "replace",
    });
    expect(text).toContain("Memory updated");

    const written = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(written).toBe("Global fact.");
  });

  test("append adds to existing content with a newline separator", async () => {
    const {group, channel} = await makeGroup({isMain: true});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    await callTool(ctx, "update_memory", {scope: "global", content: "line one", mode: "replace"});
    await callTool(ctx, "update_memory", {scope: "global", content: "line two", mode: "append"});

    const written = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(written).toBe("line one\nline two");
  });

  test("append works when the file does not exist yet", async () => {
    const {group, channel} = await makeGroup({isMain: true});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "update_memory", {
      scope: "user",
      content: "Prefers metric units.",
      mode: "append",
    });
    expect(text).toContain("Memory updated");

    const written = await fs.readFile(path.join(tmpDir, "USER.md"), "utf-8");
    expect(written).toBe("Prefers metric units.");
  });

  test("main group can write the user profile (USER.md)", async () => {
    const {group, channel} = await makeGroup({isMain: true});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    await callTool(ctx, "update_memory", {
      scope: "user",
      content: "User likes tea.",
      mode: "replace",
    });

    const written = await fs.readFile(path.join(tmpDir, "USER.md"), "utf-8");
    expect(written).toBe("User likes tea.");
  });

  test("any group can write its own group memory", async () => {
    const {group, channel} = await makeGroup({isMain: false});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "update_memory", {
      scope: "group",
      content: "Group-specific note.",
      mode: "replace",
    });
    expect(text).toContain("Memory updated");

    const written = await fs.readFile(path.join(tmpDir, group.folder, "CLAUDE.md"), "utf-8");
    expect(written).toBe("Group-specific note.");
  });

  test("non-main group cannot write global memory", async () => {
    const {group, channel} = await makeGroup({isMain: false});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "update_memory", {
      scope: "global",
      content: "sneaky global write",
      mode: "replace",
    });
    expect(text).toContain("only the main group can update global memory");

    const exists = await fs
      .stat(path.join(tmpDir, "CLAUDE.md"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  test("non-main group cannot write the user profile", async () => {
    const {group, channel} = await makeGroup({isMain: false});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "update_memory", {
      scope: "user",
      content: "sneaky user write",
      mode: "replace",
    });
    expect(text).toContain("only the main group can update user memory");

    const exists = await fs
      .stat(path.join(tmpDir, "USER.md"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  test("rejects writes that exceed maxFileChars and does not write the file", async () => {
    await setMemoryConfig({maxFileChars: 20});
    const {group, channel} = await makeGroup({isMain: true});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "update_memory", {
      scope: "global",
      content: "this content is definitely longer than twenty characters",
      mode: "replace",
    });
    expect(text.toLowerCase()).toContain("condense");

    const exists = await fs
      .stat(path.join(tmpDir, "CLAUDE.md"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  test("rejects appends whose resulting size exceeds maxFileChars, keeping the original", async () => {
    await setMemoryConfig({maxFileChars: 30});
    const {group, channel} = await makeGroup({isMain: true});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    await callTool(ctx, "update_memory", {
      scope: "global",
      content: "short original",
      mode: "replace",
    });
    const text = await callTool(ctx, "update_memory", {
      scope: "global",
      content: "this append pushes the file past the cap",
      mode: "append",
    });
    expect(text.toLowerCase()).toContain("condense");

    const written = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(written).toBe("short original");
  });

  test("reports disabled when memory.enabled is false", async () => {
    await setMemoryConfig({enabled: false});
    const {group, channel} = await makeGroup({isMain: true});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "update_memory", {
      scope: "global",
      content: "anything",
      mode: "replace",
    });
    expect(text).toBe("Memory features are disabled");
  });
});

describe("skill tools", () => {
  let tmpDir: string;

  const makeSkillContext = (): McpContext =>
    makeContext(new mongoose.Types.ObjectId().toString(), new mongoose.Types.ObjectId().toString());

  beforeEach(async () => {
    tmpDir = path.join(
      process.cwd(),
      `tmp-test-mcp-skills-${Date.now()}-${Math.floor(Math.random() * 100000)}`
    );
    await fs.mkdir(tmpDir, {recursive: true});
    paths.skills = tmpDir;
  });

  afterEach(async () => {
    clearPathOverride("skills");
    await fs.rm(tmpDir, {recursive: true, force: true});
  });

  test("save, list, and load round trip", async () => {
    const ctx = makeSkillContext();

    const saveText = await callTool(ctx, "save_skill", {
      name: "check-plex-health",
      description: "Check the Plex server health",
      content: "1. curl the status endpoint\n2. restart if down",
    });
    expect(saveText).toBe('Skill "check-plex-health" saved.');

    const listText = await callTool(ctx, "list_skills", {});
    expect(listText).toBe("check-plex-health — Check the Plex server health");

    const loadText = await callTool(ctx, "load_skill", {name: "check-plex-health"});
    expect(loadText).toBe("1. curl the status endpoint\n2. restart if down");
  });

  test("save_skill rejects invalid names with the helper's error", async () => {
    const ctx = makeSkillContext();
    const text = await callTool(ctx, "save_skill", {
      name: "Not Kebab",
      description: "desc",
      content: "body",
    });
    expect(text).toContain("Invalid skill name");
  });

  test("save_skill rejects skills over maxSkillChars", async () => {
    await setMemoryConfig({maxSkillChars: 50});
    const ctx = makeSkillContext();
    const text = await callTool(ctx, "save_skill", {
      name: "too-big",
      description: "desc",
      content: "x".repeat(200),
    });
    expect(text).toContain("50 character limit");
    expect(await fs.readdir(tmpDir)).toHaveLength(0);
  });

  test("list_skills reports when no skills are saved", async () => {
    const ctx = makeSkillContext();
    const text = await callTool(ctx, "list_skills", {});
    expect(text).toBe("No skills saved yet.");
  });

  test("list_skills sorts skills and formats one per line", async () => {
    const ctx = makeSkillContext();
    await callTool(ctx, "save_skill", {name: "zeta", description: "Last", content: "z"});
    await callTool(ctx, "save_skill", {name: "alpha", description: "First", content: "a"});

    const text = await callTool(ctx, "list_skills", {});
    expect(text).toBe("alpha — First\nzeta — Last");
  });

  test("load_skill reports not found with the valid names", async () => {
    const ctx = makeSkillContext();
    await callTool(ctx, "save_skill", {name: "existing", description: "Here", content: "body"});

    const text = await callTool(ctx, "load_skill", {name: "missing-skill"});
    expect(text).toBe('Skill "missing-skill" not found. Valid skills: existing');
  });

  test("load_skill reports not found with (none) when the library is empty", async () => {
    const ctx = makeSkillContext();
    const text = await callTool(ctx, "load_skill", {name: "missing-skill"});
    expect(text).toBe('Skill "missing-skill" not found. Valid skills: (none)');
  });

  test("all three tools report disabled when memory.enabled is false", async () => {
    await setMemoryConfig({enabled: false});
    const ctx = makeSkillContext();

    const saveText = await callTool(ctx, "save_skill", {
      name: "any-skill",
      description: "desc",
      content: "body",
    });
    const listText = await callTool(ctx, "list_skills", {});
    const loadText = await callTool(ctx, "load_skill", {name: "any-skill"});

    expect(saveText).toBe("Memory features are disabled");
    expect(listText).toBe("Memory features are disabled");
    expect(loadText).toBe("Memory features are disabled");
    expect(await fs.readdir(tmpDir)).toHaveLength(0);
  });
});

describe("delegate_task tool", () => {
  test("creates a pending AgentTask for the group and returns id + background guidance", async () => {
    const {group, channel} = await makeGroup();
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "delegate_task", {
      title: "Research llamas",
      prompt: "Find out everything about llamas and summarize it.",
    });

    const task = await AgentTask.findExactlyOne({groupId: group._id});
    expect(text).toContain(task._id.toString());
    expect(text).toContain("running in background");
    expect(text).toContain("get_task_result");
    expect(task.title).toBe("Research llamas");
    expect(task.prompt).toBe("Find out everything about llamas and summarize it.");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe(0);
    expect(task.deliverResult).toBe(false);
  });

  test("passes priority and deliverResult through, and mentions channel delivery", async () => {
    const {group, channel} = await makeGroup();
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "delegate_task", {
      title: "Urgent digest",
      prompt: "Compile the digest.",
      priority: 5,
      deliverResult: true,
    });

    const task = await AgentTask.findExactlyOne({groupId: group._id});
    expect(task.priority).toBe(5);
    expect(task.deliverResult).toBe(true);
    expect(text).toContain("posted to this group's channel");
  });

  test("rejects delegation when the current run is itself a board task", async () => {
    const {group, channel} = await makeGroup();
    const ctx: McpContext = {
      ...makeContext(group._id.toString(), channel._id.toString()),
      isBoardTask: true,
    };

    const text = await callTool(ctx, "delegate_task", {
      title: "Nested task",
      prompt: "Should never be created.",
    });

    expect(text).toContain("cannot delegate further");
    expect(await AgentTask.countDocuments({groupId: group._id})).toBe(0);
  });

  test("reports disabled when taskWorker.enabled is false", async () => {
    await setTaskWorkerEnabled(false);
    const {group, channel} = await makeGroup();
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "delegate_task", {title: "Any", prompt: "Anything."});

    expect(text).toBe("The task board is disabled");
    expect(await AgentTask.countDocuments({groupId: group._id})).toBe(0);
  });
});

describe("get_task_result tool", () => {
  test("returns a status line for an in-progress task", async () => {
    const {group, channel} = await makeGroup();
    const task = await AgentTask.create({
      groupId: group._id,
      title: "Slow research",
      prompt: "p",
      status: "running",
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "get_task_result", {taskId: task._id.toString()});

    expect(text).toContain(`Task ${task._id}`);
    expect(text).toContain("status: running");
    expect(text).toContain("Still in progress");
  });

  test("includes the result for a completed task", async () => {
    const {group, channel} = await makeGroup();
    const task = await AgentTask.create({
      groupId: group._id,
      title: "Done research",
      prompt: "p",
      status: "completed",
      result: "Llamas are camelids.",
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "get_task_result", {taskId: task._id.toString()});

    expect(text).toContain("status: completed");
    expect(text).toContain("Llamas are camelids.");
  });

  test("includes the error and attempt counts for a failed task", async () => {
    const {group, channel} = await makeGroup();
    const task = await AgentTask.create({
      groupId: group._id,
      title: "Broken task",
      prompt: "p",
      status: "failed",
      error: "boom",
      attempts: 2,
      maxAttempts: 2,
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "get_task_result", {taskId: task._id.toString()});

    expect(text).toContain("status: failed");
    expect(text).toContain("boom");
    expect(text).toContain("2/2 attempts");
  });

  test("reports not found for an unknown id and for a malformed id", async () => {
    const {group, channel} = await makeGroup();
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const unknown = await callTool(ctx, "get_task_result", {
      taskId: new mongoose.Types.ObjectId().toString(),
    });
    const malformed = await callTool(ctx, "get_task_result", {taskId: "not-an-object-id"});

    expect(unknown).toContain("not found");
    expect(malformed).toContain("not found");
  });

  test("does not leak tasks from other groups", async () => {
    const {group: otherGroup} = await makeGroup();
    const {group, channel} = await makeGroup();
    const foreignTask = await AgentTask.create({
      groupId: otherGroup._id,
      title: "Foreign secret task",
      prompt: "p",
      status: "completed",
      result: "secret result",
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "get_task_result", {taskId: foreignTask._id.toString()});

    expect(text).toContain("not found");
    expect(text).not.toContain("secret result");
  });
});

describe("list_agent_tasks tool", () => {
  test("lists group tasks newest first as id | title | status | age", async () => {
    const {group, channel} = await makeGroup();
    const older = await AgentTask.create({groupId: group._id, title: "Older", prompt: "p"});
    const newer = await AgentTask.create({groupId: group._id, title: "Newer", prompt: "p"});
    await AgentTask.collection.updateOne(
      {_id: older._id},
      {$set: {created: DateTime.now().minus({hours: 2}).toJSDate()}}
    );
    await AgentTask.collection.updateOne(
      {_id: newer._id},
      {$set: {created: DateTime.now().minus({minutes: 5}).toJSDate()}}
    );
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "list_agent_tasks", {});

    const lines = text.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain(`${newer._id} | Newer | pending |`);
    expect(lines[1]).toContain(`${older._id} | Older | pending |`);
  });

  test("respects the limit", async () => {
    const {group, channel} = await makeGroup();
    for (let i = 0; i < 4; i++) {
      await AgentTask.create({groupId: group._id, title: `Task ${i}`, prompt: "p"});
    }
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "list_agent_tasks", {limit: 2});

    expect(text.split("\n").length).toBe(2);
  });

  test("filters by status", async () => {
    const {group, channel} = await makeGroup();
    await AgentTask.create({groupId: group._id, title: "Pending one", prompt: "p"});
    await AgentTask.create({
      groupId: group._id,
      title: "Completed one",
      prompt: "p",
      status: "completed",
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "list_agent_tasks", {status: "completed"});

    expect(text).toContain("Completed one");
    expect(text).not.toContain("Pending one");
  });

  test("rejects an invalid status with the list of valid ones", async () => {
    const {group, channel} = await makeGroup();
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "list_agent_tasks", {status: "bogus"});

    expect(text).toContain('Invalid status "bogus"');
    expect(text).toContain("pending, claimed, running, completed, failed, cancelled");
  });

  test("excludes other groups' tasks and reports 'No tasks.' when empty", async () => {
    const {group: otherGroup} = await makeGroup();
    const {group, channel} = await makeGroup();
    await AgentTask.create({groupId: otherGroup._id, title: "Foreign", prompt: "p"});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "list_agent_tasks", {});

    expect(text).toBe("No tasks.");
  });
});

describe("cancel_agent_task tool", () => {
  test("cancels a pending task directly", async () => {
    const {group, channel} = await makeGroup();
    const task = await AgentTask.create({groupId: group._id, title: "Not started", prompt: "p"});
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "cancel_agent_task", {taskId: task._id.toString()});

    expect(text).toContain("cancelled");
    expect(text).toContain("had not started");
    const fresh = await AgentTask.findExactlyOne({_id: task._id});
    expect(fresh.status).toBe("cancelled");
  });

  test("flags a running task for cancellation without changing its status", async () => {
    const {group, channel} = await makeGroup();
    const task = await AgentTask.create({
      groupId: group._id,
      title: "In flight",
      prompt: "p",
      status: "running",
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "cancel_agent_task", {taskId: task._id.toString()});

    expect(text).toContain("Cancellation requested");
    expect(text).toContain("heartbeat");
    const fresh = await AgentTask.findExactlyOne({_id: task._id});
    expect(fresh.status).toBe("running");
    expect(fresh.cancelRequested).toBe(true);
  });

  test("flags a claimed task for cancellation", async () => {
    const {group, channel} = await makeGroup();
    const task = await AgentTask.create({
      groupId: group._id,
      title: "Claimed task",
      prompt: "p",
      status: "claimed",
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "cancel_agent_task", {taskId: task._id.toString()});

    expect(text).toContain("Cancellation requested");
    const fresh = await AgentTask.findExactlyOne({_id: task._id});
    expect(fresh.status).toBe("claimed");
    expect(fresh.cancelRequested).toBe(true);
  });

  test("reports terminal tasks as already terminal", async () => {
    const {group, channel} = await makeGroup();
    const task = await AgentTask.create({
      groupId: group._id,
      title: "Finished",
      prompt: "p",
      status: "completed",
      result: "done",
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "cancel_agent_task", {taskId: task._id.toString()});

    expect(text).toContain("already completed");
    const fresh = await AgentTask.findExactlyOne({_id: task._id});
    expect(fresh.status).toBe("completed");
    expect(fresh.cancelRequested).toBe(false);
  });

  test("cannot cancel another group's task", async () => {
    const {group: otherGroup} = await makeGroup();
    const {group, channel} = await makeGroup();
    const foreignTask = await AgentTask.create({
      groupId: otherGroup._id,
      title: "Foreign pending",
      prompt: "p",
    });
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "cancel_agent_task", {taskId: foreignTask._id.toString()});

    expect(text).toContain("not found");
    const fresh = await AgentTask.findExactlyOne({_id: foreignTask._id});
    expect(fresh.status).toBe("pending");
    expect(fresh.cancelRequested).toBe(false);
  });

  test("reports not found for a malformed id", async () => {
    const {group, channel} = await makeGroup();
    const ctx = makeContext(group._id.toString(), channel._id.toString());

    const text = await callTool(ctx, "cancel_agent_task", {taskId: "garbage"});

    expect(text).toContain("not found");
  });
});
