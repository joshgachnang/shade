import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

export type JxaRunner = (script: string) => Promise<string>;

const defaultRunJxa: JxaRunner = async (script: string): Promise<string> => {
  const {stdout} = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim();
};

// Injectable for testing
export let runJxa: JxaRunner = defaultRunJxa;
export const setRunJxa = (fn: JxaRunner): void => {
  runJxa = fn;
};
export const resetRunJxa = (): void => {
  runJxa = defaultRunJxa;
};

/**
 * Shared JXA preamble: imports EventKit, creates an EKEventStore, and defines
 * helpers to spin the run loop and request access. EventKit (rather than
 * Application("Reminders")/Application("Calendar") scripting) is used because it
 * expands recurring calendar events into occurrences and is dramatically faster
 * for bulk reads.
 */
export const EVENTKIT_PREAMBLE = `
ObjC.import("EventKit");
ObjC.import("Foundation");

const store = $.EKEventStore.alloc.init;

const spinUntil = (isDone, timeoutSeconds) => {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (!isDone() && Date.now() < deadline) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
  }
  return isDone();
};

// EKAuthorizationStatus: 0 notDetermined, 1 restricted, 2 denied,
// 3 authorized/fullAccess, 4 writeOnly (macOS 14+)
const requestAccess = (entityType) => {
  const kind = entityType === $.EKEntityTypeReminder ? "Reminders" : "Calendars";
  const status = Number($.EKEventStore.authorizationStatusForEntityType(entityType));
  if (status === 3) {
    return; // already authorized — no prompt needed
  }
  if (status === 1 || status === 2 || status === 4) {
    throw new Error(
      "EventKit " + kind + " access is " + (status === 4 ? "write-only" : "denied") +
      ". Grant Full Access to the shade agent under System Settings > Privacy & Security > " + kind + "."
    );
  }

  // notDetermined: request access. The prompt only renders when the requesting
  // process has usage-description strings, which a bare launchd binary lacks —
  // so keep the wait short and fail with instructions instead of hanging.
  let done = false;
  let granted = false;
  const handler = (ok, _err) => {
    granted = ok;
    done = true;
  };
  if (
    entityType === $.EKEntityTypeEvent &&
    store.respondsToSelector("requestFullAccessToEventsWithCompletion:")
  ) {
    store.requestFullAccessToEventsWithCompletion(handler);
  } else if (
    entityType === $.EKEntityTypeReminder &&
    store.respondsToSelector("requestFullAccessToRemindersWithCompletion:")
  ) {
    store.requestFullAccessToRemindersWithCompletion(handler);
  } else {
    store.requestAccessToEntityTypeCompletion(entityType, handler);
  }
  if (!spinUntil(() => done, 20)) {
    throw new Error(
      "EventKit " + kind + " permission is undetermined and the consent prompt could not be " +
      "answered. Pre-grant access for the shade agent (kTCCService" +
      (entityType === $.EKEntityTypeReminder ? "Reminders" : "Calendar") + ")."
    );
  }
  if (!granted) {
    throw new Error(
      "EventKit " + kind + " access denied. Grant access in System Settings > Privacy & Security."
    );
  }
};
`;
