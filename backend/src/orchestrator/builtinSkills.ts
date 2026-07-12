import fs from "node:fs/promises";
import {logger} from "@terreno/api";
import {loadAppConfig} from "../models/appConfig";
import {Group} from "../models/group";
import {ScheduledTask} from "../models/scheduledTask";
import type {AppConfigBuiltinTasks} from "../types";
import {logError} from "./errors";
import {wakeScheduler} from "./services/scheduler";
import {getSkillPath, saveSkill} from "./skills";

export interface BuiltinSkill {
  name: string;
  description: string;
  content: string;
}

const DAILY_TRIAGE_SKILL: BuiltinSkill = {
  name: "daily-triage",
  description:
    "Morning triage: turn today's calendar, reminders, tasks, and overnight messages into a prioritized time-blocked plan.",
  content: `# Daily Triage & Time-Block Plan

Produce ONE concise morning briefing that turns today's calendar, open
reminders, running tasks, and overnight messages into a prioritized,
time-blocked plan. You are acting as an executive assistant running the
daily catch-up.

## 1. Gather (use tools, never guess)

- list_calendar_events for today through tomorrow morning, across calendars.
- list_reminder_lists, then list_reminders for incomplete reminders; note
  due dates and anything overdue.
- list_tasks for scheduled tasks firing today.
- list_agent_tasks for board work currently pending or running.
- get_channel_history for roughly the last 12 hours; flag anything that
  needs a reply or that created a commitment.
- get_weather only if an event looks outdoor- or travel-related.

## 2. Triage

Bucket everything you found:
- Fixed: meetings/appointments with set times.
- Must do today: hard deadlines and overdue reminders.
- Should do: moves something important forward.
- Waiting on: blocked on someone else.
- Can wait: mention only as a count.

Also detect: double-bookings, more than 2 hours of back-to-back meetings
with no break, overdue reminders, and messages unanswered for over a day.

## 3. Plan the blocks

- Fill the gaps between fixed events with Must and Should items; put the
  hardest work in the largest early gap.
- Blocks run 30 minutes to 2 hours. Leave ~15 minutes before meetings and
  keep a lunch gap.
- Every Must item gets a block; Should items only if there is room.

## 4. Deliver

Send one message in this shape (omit any empty section):

*Today: {weekday, date}*
{one line: N meetings, first at {time}, M must-dos}

Warnings: {conflicts / overdue / unanswered items}

*Schedule*
- 9:00-9:45 {fixed event}
- 10:00-11:30 {work block: task}
...

*Waiting on:* {people/items}

End with at most one question, and only if the answer materially changes
the plan.

## 5. Rules

- Read-only by default: do not create, complete, or move anything unless
  the user asks.
- If a data source fails, say so in one line and continue with the rest.
- Use the user's local timezone. Never invent events or deadlines.
- If the day is empty, say so, propose the top 3 items to tackle, and skip
  the schedule section.`,
};

const SESSION_REVIEW_SKILL: BuiltinSkill = {
  name: "session-review",
  description:
    "Audit recent agent sessions for red flags — long, expensive, failing, or off-course runs — and report findings.",
  content: `# Session Red-Flag Review

Audit Shade's own recent activity and surface anything that looks like the
system going astray: runaway sessions, repeated failures, surprising cost.
This is a report-only review — never mutate state while running it.

## 1. Collect

Call review_sessions (thresholds and lookback come from server config).
It returns:
- totals: AI request count, failures, tokens, and cost in the window
- flaggedRuns: task runs that failed, timed out, or ran unusually long
- flaggedSessions: sessions with unusually many messages or high cost,
  each with a transcriptPath when known

## 2. Inspect

For each flagged item decide: explainable, or a red flag? When unsure,
Read the transcript at transcriptPath (JSONL — skim the tool calls and the
last few entries to see what the session was actually doing).

Treat as red flags:
- the same tool call or error repeating in a loop
- a scheduled task that failed on every recent run
- outbound messages the user never asked for
- cost concentrated in a single session or group
- activity at times with no plausible trigger

## 3. Report

- All clear: reply with exactly one line, e.g.
  "Session review: N runs, $X.XX, no red flags."
- Otherwise list each finding ordered by severity: what happened, the
  evidence (duration / cost / repeat count), and one recommended action
  (pause task X, cancel task Y, tighten a prompt, raise a threshold).
- Recommend only. Do not pause or cancel anything unless the user tells
  you to afterwards.`,
};

export const BUILTIN_SKILLS: BuiltinSkill[] = [DAILY_TRIAGE_SKILL, SESSION_REVIEW_SKILL];

/**
 * Write any builtin skill that doesn't already exist into the skills
 * directory. Existing files are never overwritten, so operator or
 * agent edits to a seeded skill survive restarts (delete the file to
 * re-seed the shipped version).
 */
export const seedBuiltinSkills = async (): Promise<void> => {
  const maxChars = (await loadAppConfig()).memory?.maxSkillChars ?? 8000;
  for (const skill of BUILTIN_SKILLS) {
    try {
      await fs.access(getSkillPath(skill.name));
      continue;
    } catch {
      // Missing — seed it below.
    }

    const result = await saveSkill({...skill, maxChars});
    if (result.saved) {
      logger.info(`Seeded builtin skill: ${skill.name}`);
    } else {
      logger.warn(`Failed to seed builtin skill ${skill.name}: ${result.error}`);
    }
  }
};

interface BuiltinTaskDef {
  taskName: string;
  skillName: string;
  configKey: keyof AppConfigBuiltinTasks;
}

const BUILTIN_TASKS: BuiltinTaskDef[] = [
  {taskName: "Daily triage", skillName: "daily-triage", configKey: "dailyTriage"},
  {taskName: "Session review", skillName: "session-review", configKey: "sessionReview"},
];

const builtinTaskPrompt = (skillName: string): string => {
  return `Use the load_skill tool to load the "${skillName}" skill and follow it exactly.`;
};

/**
 * Reconcile the builtin scheduled tasks against AppConfig.builtinTasks for
 * the main group. enabled=true upserts an active cron task (updating the
 * schedule if the config changed); enabled=false pauses an existing active
 * task. Tasks are matched by name within the main group. No-op when no main
 * group exists yet (retried on next boot).
 */
export const ensureBuiltinScheduledTasks = async (): Promise<void> => {
  const builtinTasks = (await loadAppConfig()).builtinTasks;
  const mainGroup = await Group.findOneOrNone({isMain: true});
  if (!mainGroup) {
    logger.debug("No main group found; skipping builtin scheduled task setup");
    return;
  }

  let mutated = false;
  for (const def of BUILTIN_TASKS) {
    try {
      const settings = builtinTasks?.[def.configKey];
      const existing = await ScheduledTask.findOneOrNone({
        name: def.taskName,
        groupId: mainGroup._id,
      });

      if (!settings?.enabled) {
        if (existing && existing.status === "active") {
          await ScheduledTask.findByIdAndUpdate(existing._id, {$set: {status: "paused"}});
          logger.info(`Paused builtin scheduled task "${def.taskName}" (disabled in config)`);
          mutated = true;
        }
        continue;
      }

      if (!existing) {
        await ScheduledTask.create({
          groupId: mainGroup._id,
          name: def.taskName,
          prompt: builtinTaskPrompt(def.skillName),
          scheduleType: "cron",
          schedule: settings.cron,
        });
        logger.info(`Created builtin scheduled task "${def.taskName}" (${settings.cron})`);
        mutated = true;
        continue;
      }

      if (existing.status !== "active" || existing.schedule !== settings.cron) {
        // Clear nextRunAt so the scheduler recomputes it from the (possibly
        // changed) cron expression on its next tick.
        await ScheduledTask.findByIdAndUpdate(existing._id, {
          $set: {status: "active", schedule: settings.cron, scheduleType: "cron"},
          $unset: {nextRunAt: ""},
        });
        logger.info(`Updated builtin scheduled task "${def.taskName}" (${settings.cron})`);
        mutated = true;
      }
    } catch (err) {
      logError(`Failed to ensure builtin scheduled task "${def.taskName}"`, err);
    }
  }

  if (mutated) {
    wakeScheduler();
  }
};
