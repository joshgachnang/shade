import type {CalendarSyncPush, DataPush, EdgeAgentConfig, RemindersSyncPush} from "@shade/edge-agent-types";
import {DateTime} from "luxon";
import {fetchCalendarSnapshot} from "./appleCalendar";
import {fetchRemindersSnapshot} from "./appleReminders";

export interface SyncOptions {
  pushData: (data: DataPush) => Promise<void>;
}

/** Compute the calendar sync window: start of the current week through daysAhead from now. */
export const getCalendarSyncRange = (
  daysAhead: number,
  now: DateTime = DateTime.now()
): {rangeStart: string; rangeEnd: string} => {
  const rangeStart = now.startOf("week").toUTC().toISO();
  const rangeEnd = now.plus({days: daysAhead}).endOf("day").toUTC().toISO();
  if (!rangeStart || !rangeEnd) {
    throw new Error("Failed to compute calendar sync range");
  }
  return {rangeStart, rangeEnd};
};

export const buildRemindersSyncPush = async (): Promise<RemindersSyncPush> => {
  const snapshot = await fetchRemindersSnapshot();
  return {
    type: "reminders_sync",
    payload: {
      lists: snapshot.lists,
      reminders: snapshot.reminders,
      syncedAt: new Date().toISOString(),
    },
  };
};

export const buildCalendarSyncPush = async (
  daysAhead: number,
  calendarFilters?: string[]
): Promise<CalendarSyncPush> => {
  const {rangeStart, rangeEnd} = getCalendarSyncRange(daysAhead);
  const snapshot = await fetchCalendarSnapshot({
    startDate: rangeStart,
    endDate: rangeEnd,
    calendarFilters,
  });
  return {
    type: "calendar_sync",
    payload: {
      calendars: snapshot.calendars,
      events: snapshot.events,
      rangeStart,
      rangeEnd,
      syncedAt: new Date().toISOString(),
    },
  };
};

/**
 * Runs full reminders + calendar syncs: once immediately on start (initial
 * import + on-launch synchronize) and then on a configurable interval so a
 * long-running agent stays fresh. Pushes full snapshots; the backend upserts
 * by externalId, so re-syncs are idempotent.
 */
export class AppleSyncService {
  private reminderTimer: ReturnType<typeof setInterval> | null = null;
  private calendarTimer: ReturnType<typeof setInterval> | null = null;
  private remindersSyncing = false;
  private calendarSyncing = false;

  constructor(private options: SyncOptions) {}

  start(config: EdgeAgentConfig): void {
    this.stop();

    const remindersConfig = config.reminders ?? {enabled: true, syncIntervalMs: 15 * 60 * 1000};
    const calendarConfig = config.calendar ?? {
      enabled: true,
      syncIntervalMs: 15 * 60 * 1000,
      daysAhead: 90,
    };

    if (remindersConfig.enabled) {
      this.syncReminders().catch((err) => {
        console.error(`Initial reminders sync failed: ${err}`);
      });
      this.reminderTimer = setInterval(() => {
        this.syncReminders().catch((err) => {
          console.error(`Reminders sync failed: ${err}`);
        });
      }, remindersConfig.syncIntervalMs);
      console.info(`Reminders sync every ${remindersConfig.syncIntervalMs}ms`);
    }

    if (calendarConfig.enabled) {
      this.syncCalendar(calendarConfig.daysAhead, calendarConfig.calendarFilters).catch((err) => {
        console.error(`Initial calendar sync failed: ${err}`);
      });
      this.calendarTimer = setInterval(() => {
        this.syncCalendar(calendarConfig.daysAhead, calendarConfig.calendarFilters).catch(
          (err) => {
            console.error(`Calendar sync failed: ${err}`);
          }
        );
      }, calendarConfig.syncIntervalMs);
      console.info(`Calendar sync every ${calendarConfig.syncIntervalMs}ms`);
    }
  }

  stop(): void {
    if (this.reminderTimer) {
      clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
    if (this.calendarTimer) {
      clearInterval(this.calendarTimer);
      this.calendarTimer = null;
    }
  }

  async syncReminders(): Promise<void> {
    if (this.remindersSyncing) {
      return;
    }
    this.remindersSyncing = true;
    try {
      const push = await buildRemindersSyncPush();
      await this.options.pushData(push);
      console.info(
        `Reminders synced: ${push.payload.lists.length} list(s), ${push.payload.reminders.length} reminder(s)`
      );
    } finally {
      this.remindersSyncing = false;
    }
  }

  async syncCalendar(daysAhead: number, calendarFilters?: string[]): Promise<void> {
    if (this.calendarSyncing) {
      return;
    }
    this.calendarSyncing = true;
    try {
      const push = await buildCalendarSyncPush(daysAhead, calendarFilters);
      await this.options.pushData(push);
      console.info(
        `Calendar synced: ${push.payload.calendars.length} calendar(s), ${push.payload.events.length} event(s)`
      );
    } finally {
      this.calendarSyncing = false;
    }
  }

  /** Run both syncs now (used by the sync_now command and after local mutations). */
  async syncAll(config: EdgeAgentConfig): Promise<void> {
    const calendarConfig = config.calendar ?? {
      enabled: true,
      syncIntervalMs: 15 * 60 * 1000,
      daysAhead: 90,
    };
    const results = await Promise.allSettled([
      config.reminders?.enabled === false ? Promise.resolve() : this.syncReminders(),
      calendarConfig.enabled === false
        ? Promise.resolve()
        : this.syncCalendar(calendarConfig.daysAhead, calendarConfig.calendarFilters),
    ]);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      throw new Error(
        failures.map((f) => String((f as PromiseRejectedResult).reason)).join("; ")
      );
    }
  }
}
