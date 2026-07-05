import {logger, signupUser} from "@terreno/api";
import {AppConfig, reloadAppConfig} from "../models/appConfig";
import {Channel} from "../models/channel";
import {Group} from "../models/group";
import {User} from "../models/user";
import type {ChannelDocument, GroupDocument, UserDocument} from "../types";
import {
  TEST_ADMIN_EMAIL,
  TEST_CHANNEL_NAME,
  TEST_GROUP_EXTERNAL_ID,
  TEST_GROUP_NAME,
  TEST_PASSWORD,
  TEST_USER_EMAIL,
} from "./constants";

export interface TestSeedResult {
  adminId: string;
  userId: string;
  channelId: string;
  groupId: string;
}

/**
 * Idempotent seed for the AI testability harness (IP-012): an admin + regular
 * user (same identity as `tests/testHelper.ts`), one `"test"` channel, one
 * auto-triggering group wired to the mock backend, and an AppConfig tuned for
 * a fast feedback loop (sub-second polls, board worker in-process, no real
 * services). Runs from `boot()` when `SHADE_TEST_MODE=1`; safe to re-run —
 * `POST /test/reset` calls it after wiping the database.
 */
export const seedTestMode = async (): Promise<TestSeedResult> => {
  let admin = (await User.findOneOrNone({email: TEST_ADMIN_EMAIL})) as UserDocument | null;
  if (!admin) {
    admin = (await signupUser(User as any, TEST_ADMIN_EMAIL, TEST_PASSWORD, {
      name: "Admin",
      admin: true,
    })) as unknown as UserDocument;
  }

  let user = (await User.findOneOrNone({email: TEST_USER_EMAIL})) as UserDocument | null;
  if (!user) {
    user = (await signupUser(User as any, TEST_USER_EMAIL, TEST_PASSWORD, {
      name: "Test User",
      admin: false,
    })) as unknown as UserDocument;
  }

  let channel = (await Channel.findOneOrNone({
    type: "test",
    name: TEST_CHANNEL_NAME,
  })) as ChannelDocument | null;
  if (!channel) {
    channel = await Channel.create({
      name: TEST_CHANNEL_NAME,
      type: "test",
      status: "connected",
      config: {},
    });
  }

  let group = (await Group.findOneOrNone({name: TEST_GROUP_NAME})) as GroupDocument | null;
  if (!group) {
    group = await Group.create({
      name: TEST_GROUP_NAME,
      folder: TEST_GROUP_NAME,
      channelId: channel._id,
      externalId: TEST_GROUP_EXTERNAL_ID,
      trigger: "@Shade",
      // Every message in the harness group is meant for the agent.
      requiresTrigger: false,
      // Main-group privileges so mock-scripted IPC actions (schedule_task,
      // cross-group send_message) pass IpcWatcher authorization.
      isMain: true,
      modelConfig: {defaultBackend: "mock"},
    });
  }

  // Pin the loop-speed and worker config the harness's determinism depends on.
  // The message/ipc polls are the fallback cadence; POST /test/tick forces
  // immediate passes when a test can't wait even 250ms.
  await AppConfig.findOneAndUpdate(
    {},
    {
      $set: {
        "pollIntervals.message": 250,
        "pollIntervals.ipc": 250,
        "concurrency.maxGlobal": 5,
        "taskWorker.enabled": true,
        "taskWorker.runInGateway": true,
        "taskWorker.pollMs": 250,
        "scheduler.useTaskBoard": false,
        "prWatch.enabled": false,
        "triviaMonitor.enabled": false,
        "radioTranscriber.enabled": false,
      },
    }
  );
  await reloadAppConfig();

  logger.info(
    `Test-mode seed ready: group "${group.name}" (${group._id}) on channel "${channel.name}"`
  );

  return {
    adminId: admin._id.toString(),
    userId: user._id.toString(),
    channelId: channel._id.toString(),
    groupId: group._id.toString(),
  };
};
