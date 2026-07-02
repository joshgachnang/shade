import {CronExpressionParser} from "cron-parser";
import {DateTime, Duration} from "luxon";

export type ScheduleType = "cron" | "interval" | "once";

export interface ComputeNextRunArgs {
  scheduleType: ScheduleType;
  /**
   * Schedule value, interpreted by type:
   * - cron: a 5- or 6-field cron expression (e.g. "*\/5 * * * *")
   * - interval: seconds as an integer ("300"), shorthand ("5m", "1h", "30s", "2d"),
   *   or an ISO-8601 duration ("PT5M")
   * - once: an ISO-8601 datetime ("2026-06-01T09:00:00Z")
   */
  schedule: string;
  /** Reference time the next run is computed relative to. */
  from: Date;
}

const SHORTHAND_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Parse an interval schedule string into milliseconds.
 * Returns null when the value cannot be parsed or is non-positive.
 */
export const parseIntervalMs = (schedule: string): number | null => {
  const trimmed = schedule.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Bare integer → seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds > 0 ? seconds * 1000 : null;
  }

  // Shorthand like "5m", "1h", "30s", "2d"
  const shorthand = trimmed.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (shorthand) {
    const amount = Number.parseInt(shorthand[1], 10);
    const unitSeconds = SHORTHAND_UNIT_SECONDS[shorthand[2].toLowerCase()];
    const ms = amount * unitSeconds * 1000;
    return ms > 0 ? ms : null;
  }

  // ISO-8601 duration like "PT5M"
  const dur = Duration.fromISO(trimmed);
  if (dur.isValid) {
    const ms = dur.toMillis();
    return ms > 0 ? ms : null;
  }

  return null;
};

/**
 * Compute the next run time for a scheduled task.
 *
 * - cron: next matching instant strictly after `from`
 * - interval: `from` + interval
 * - once: the fixed scheduled instant (caller is responsible for completing the
 *   task after it fires so it does not run again)
 *
 * Returns null when the schedule is invalid or unparseable.
 */
export const computeNextRun = (args: ComputeNextRunArgs): Date | null => {
  const {scheduleType, schedule, from} = args;

  if (scheduleType === "interval") {
    const ms = parseIntervalMs(schedule);
    if (ms === null) {
      return null;
    }
    return new Date(from.getTime() + ms);
  }

  if (scheduleType === "once") {
    const dt = DateTime.fromISO(schedule, {zone: "utc"});
    if (!dt.isValid) {
      return null;
    }
    return dt.toJSDate();
  }

  if (scheduleType === "cron") {
    try {
      const expr = CronExpressionParser.parse(schedule, {currentDate: from});
      return expr.next().toDate();
    } catch {
      return null;
    }
  }

  return null;
};
