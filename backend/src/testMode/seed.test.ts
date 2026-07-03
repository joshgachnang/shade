import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {AppConfig, loadAppConfig, reloadAppConfig} from "../models/appConfig";
import {Channel} from "../models/channel";
import {Group} from "../models/group";
import {User} from "../models/user";
import {TEST_ADMIN_EMAIL, TEST_CHANNEL_NAME, TEST_GROUP_NAME} from "./constants";
import {seedTestMode} from "./seed";

describe("seedTestMode", () => {
  beforeAll(async () => {
    await Promise.all([
      User.deleteMany({}),
      Channel.deleteMany({}),
      Group.deleteMany({}),
      AppConfig.deleteMany({}),
    ]);
    await loadAppConfig();
  });

  afterAll(async () => {
    await Promise.all([
      User.deleteMany({}),
      Channel.deleteMany({}),
      Group.deleteMany({}),
      AppConfig.deleteMany({}),
    ]);
  });

  test("is idempotent and tunes AppConfig for the harness", async () => {
    const first = await seedTestMode();
    const second = await seedTestMode();

    expect(second.adminId).toBe(first.adminId);
    expect(second.groupId).toBe(first.groupId);

    expect(await User.countDocuments({email: TEST_ADMIN_EMAIL})).toBe(1);
    expect(await Channel.countDocuments({name: TEST_CHANNEL_NAME})).toBe(1);
    expect(await Group.countDocuments({name: TEST_GROUP_NAME})).toBe(1);

    const group = await Group.findExactlyOne({name: TEST_GROUP_NAME});
    expect(group.requiresTrigger).toBe(false);
    expect(group.modelConfig.defaultBackend).toBe("mock");

    const appConfig = await reloadAppConfig();
    expect(appConfig.pollIntervals.message).toBe(250);
    expect(appConfig.taskWorker.pollMs).toBe(250);
    expect(appConfig.taskWorker.runInGateway).toBe(true);
    expect(appConfig.scheduler.useTaskBoard).toBe(false);
  });
});
