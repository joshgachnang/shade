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

const requestAccess = (entityType) => {
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
  if (!spinUntil(() => done, 30)) {
    throw new Error("Timed out waiting for EventKit permission response");
  }
  if (!granted) {
    throw new Error(
      "EventKit access denied. Grant access in System Settings > Privacy & Security."
    );
  }
};
`;
