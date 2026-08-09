import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import {clearPathOverride, paths} from "../config";
import {AppConfig, reloadAppConfig} from "../models/appConfig";
import {Group} from "../models/group";
import {ScheduledTask} from "../models/scheduledTask";
import {BUILTIN_SKILLS, ensureBuiltinScheduledTasks, seedBuiltinSkills} from "./builtinSkills";
import {loadSkill} from "./skills";

const tmpDir = path.join(process.cwd(), `tmp-test-builtin-skills-${Date.now()}`);

const createdGroupIds: mongoose.Types.ObjectId[] = [];

const makeMainGroup = async () => {
  const group = await Group.create({
    name: "Builtin Test Main Group",
    folder: `builtin-test-${new mongoose.Types.ObjectId().toString()}`,
    channelId: new mongoose.Types.ObjectId(),
    externalId: `builtin-test-${Date.now()}-${Math.random()}`,
    isMain: true,
  });
  createdGroupIds.push(group._id);
  return group;
};

const setBuiltinTask = async (
  key: "dailyTriage" | "sessionReview",
  settings: {enabled: boolean; cron?: string}
) => {
  const update: Record<string, unknown> = {[`builtinTasks.${key}.enabled`]: settings.enabled};
  if (settings.cron) {
    update[`builtinTasks.${key}.cron`] = settings.cron;
  }
  await AppConfig.findOneAndUpdate({}, {$set: update});
  await reloadAppConfig();
};

beforeEach(async () => {
  await fs.mkdir(tmpDir, {recursive: true});
  paths.skills = tmpDir;
  // These tests assert behavior as a function of the main-group count, so the
  // precondition must be controlled. The suite shares one Mongo DB with every
  // other test file; an isMain group leaked by another file (bun file order is
  // not fixed) would otherwise make `Group.findExactlyOne({isMain})` throw
  // "multiple documents". Clear the slate so each test controls it explicitly.
  await Group.deleteMany({isMain: true});
});

afterEach(async () => {
  clearPathOverride("skills");
  await fs.rm(tmpDir, {recursive: true, force: true});

  await ScheduledTask.deleteMany({groupId: {$in: createdGroupIds}});
  await Group.deleteMany({_id: {$in: createdGroupIds}});
  createdGroupIds.length = 0;

  await AppConfig.findOneAndUpdate(
    {},
    {
      $set: {
        "builtinTasks.dailyTriage": {enabled: false, cron: "30 6 * * *"},
        "builtinTasks.sessionReview": {enabled: false, cron: "0 8 * * *"},
      },
    }
  );
  await reloadAppConfig();
});

describe("seedBuiltinSkills", () => {
  test("seeds all builtin skills into the skills directory", async () => {
    await seedBuiltinSkills();

    for (const skill of BUILTIN_SKILLS) {
      const loaded = await loadSkill({name: skill.name});
      expect(loaded.found).toBe(true);
      expect(loaded.description).toBe(skill.description);
      expect(loaded.content).toBe(skill.content);
    }
  });

  test("includes daily-triage and session-review", () => {
    const names = BUILTIN_SKILLS.map((skill) => skill.name);
    expect(names).toContain("daily-triage");
    expect(names).toContain("session-review");
  });

  test("does not overwrite an existing (edited) skill file", async () => {
    const edited = "---\nname: daily-triage\ndescription: Edited\n---\nMy custom triage steps";
    await fs.writeFile(path.join(tmpDir, "daily-triage.md"), edited, "utf-8");

    await seedBuiltinSkills();

    const loaded = await loadSkill({name: "daily-triage"});
    expect(loaded.content).toBe("My custom triage steps");
    expect(loaded.description).toBe("Edited");

    // The other skill was still seeded.
    const other = await loadSkill({name: "session-review"});
    expect(other.found).toBe(true);
  });

  test("is idempotent across repeated runs", async () => {
    await seedBuiltinSkills();
    await seedBuiltinSkills();

    const entries = await fs.readdir(tmpDir);
    expect(entries.sort()).toEqual(BUILTIN_SKILLS.map((skill) => `${skill.name}.md`).sort());
  });

  test("builtin skill bodies fit under the default skill char cap", () => {
    for (const skill of BUILTIN_SKILLS) {
      const serialized = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${skill.content}`;
      expect(serialized.length).toBeLessThanOrEqual(8000);
    }
  });
});

describe("ensureBuiltinScheduledTasks", () => {
  test("does nothing when there is no main group", async () => {
    await setBuiltinTask("dailyTriage", {enabled: true});

    await ensureBuiltinScheduledTasks();

    const tasks = await ScheduledTask.find({name: "Daily triage"});
    expect(tasks).toHaveLength(0);
  });

  test("creates an active cron task when enabled", async () => {
    const group = await makeMainGroup();
    await setBuiltinTask("dailyTriage", {enabled: true, cron: "15 7 * * *"});

    await ensureBuiltinScheduledTasks();

    const task = await ScheduledTask.findOneOrNone({name: "Daily triage", groupId: group._id});
    expect(task).not.toBeNull();
    expect(task?.status).toBe("active");
    expect(task?.scheduleType).toBe("cron");
    expect(task?.schedule).toBe("15 7 * * *");
    expect(task?.prompt).toContain("daily-triage");
  });

  test("does not create tasks when disabled", async () => {
    const group = await makeMainGroup();

    await ensureBuiltinScheduledTasks();

    const tasks = await ScheduledTask.find({groupId: group._id});
    expect(tasks).toHaveLength(0);
  });

  test("pauses an existing task when disabled", async () => {
    const group = await makeMainGroup();
    await setBuiltinTask("sessionReview", {enabled: true});
    await ensureBuiltinScheduledTasks();

    await setBuiltinTask("sessionReview", {enabled: false});
    await ensureBuiltinScheduledTasks();

    const task = await ScheduledTask.findOneOrNone({name: "Session review", groupId: group._id});
    expect(task?.status).toBe("paused");
  });

  test("reactivates and updates the schedule when config changes", async () => {
    const group = await makeMainGroup();
    await setBuiltinTask("dailyTriage", {enabled: true, cron: "30 6 * * *"});
    await ensureBuiltinScheduledTasks();

    await setBuiltinTask("dailyTriage", {enabled: false});
    await ensureBuiltinScheduledTasks();

    await setBuiltinTask("dailyTriage", {enabled: true, cron: "0 9 * * 1-5"});
    await ensureBuiltinScheduledTasks();

    const task = await ScheduledTask.findOneOrNone({name: "Daily triage", groupId: group._id});
    expect(task?.status).toBe("active");
    expect(task?.schedule).toBe("0 9 * * 1-5");
    expect(task?.nextRunAt).toBeFalsy();
  });

  test("does not duplicate tasks across repeated runs", async () => {
    const group = await makeMainGroup();
    await setBuiltinTask("dailyTriage", {enabled: true});

    await ensureBuiltinScheduledTasks();
    await ensureBuiltinScheduledTasks();

    const tasks = await ScheduledTask.find({name: "Daily triage", groupId: group._id});
    expect(tasks).toHaveLength(1);
  });
});
