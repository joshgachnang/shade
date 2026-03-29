import {exec} from "node:child_process";
import {promisify} from "node:util";
import {logger} from "@terreno/api";
import {DateTime} from "luxon";

const defaultExecAsync = promisify(exec);

// Injectable for testing
export let execAsync = defaultExecAsync;
export const setExecAsync = (fn: typeof defaultExecAsync) => {
  execAsync = fn;
};
export const resetExecAsync = () => {
  execAsync = defaultExecAsync;
};

export interface AppleCalendarInfo {
  name: string;
  id: string;
}

export interface AppleCalendarEvent {
  id: string;
  summary: string;
  startDate: string;
  endDate: string;
  location: string;
  notes: string;
  calendarName: string;
  isAllDay: boolean;
  url: string;
}

export interface CreateEventInput {
  summary: string;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  calendarName: string;
  location?: string;
  notes?: string;
  isAllDay?: boolean;
}

const runAppleScriptFile = async (script: string): Promise<string> => {
  // For multi-line scripts, use heredoc via stdin
  try {
    const {stdout} = await execAsync(`osascript <<'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, {
      timeout: 15000,
    });
    return stdout.trim();
  } catch (error) {
    logger.error(`AppleScript execution failed: ${error}`);
    throw new Error(`AppleScript failed: ${(error as Error).message}`);
  }
};

export const listCalendars = async (): Promise<AppleCalendarInfo[]> => {
  const script = `
tell application "Calendar"
  set calList to {}
  repeat with cal in calendars
    set end of calList to (name of cal) & "|||" & (uid of cal)
  end repeat
  set AppleScript's text item delimiters to "\\n"
  return calList as text
end tell`;

  const output = await runAppleScriptFile(script);
  return parseCalendarList(output);
};

export const parseCalendarList = (output: string): AppleCalendarInfo[] => {
  if (!output) {
    return [];
  }
  return output.split("\n").map((line) => {
    const [name, id] = line.split("|||");
    return {name: name?.trim() ?? "", id: id?.trim() ?? ""};
  });
};

export const getEvents = async ({
  calendarNames,
  startDate,
  endDate,
}: {
  calendarNames: string[];
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
}): Promise<AppleCalendarEvent[]> => {
  const start = DateTime.fromISO(startDate);
  const end = DateTime.fromISO(endDate);

  if (!start.isValid || !end.isValid) {
    throw new Error("Invalid date format. Use ISO 8601.");
  }

  // AppleScript date format
  const startStr = start.toFormat("MMMM d, yyyy h:mm:ss a");
  const endStr = end.toFormat("MMMM d, yyyy h:mm:ss a");

  const calendarFilter = calendarNames.map((name) => `"${name}"`).join(", ");

  const script = `
tell application "Calendar"
  set startDate to date "${startStr}"
  set endDate to date "${endStr}"
  set eventList to {}
  set calNames to {${calendarFilter}}

  repeat with cal in calendars
    if (name of cal) is in calNames then
      set calEvents to (every event of cal whose start date ≥ startDate and start date ≤ endDate)
      repeat with evt in calEvents
        set evtStart to start date of evt
        set evtEnd to end date of evt
        set evtSummary to summary of evt
        set evtLocation to " "
        set evtNotes to " "
        set evtUrl to " "
        set evtAllDay to allday event of evt
        set evtId to uid of evt

        try
          set evtLocation to location of evt
        end try
        try
          set evtNotes to description of evt
        end try
        try
          set evtUrl to url of evt
        end try

        set end of eventList to evtId & "|||" & evtSummary & "|||" & (evtStart as string) & "|||" & (evtEnd as string) & "|||" & evtLocation & "|||" & evtNotes & "|||" & (name of cal) & "|||" & (evtAllDay as string) & "|||" & evtUrl
      end repeat
    end if
  end repeat

  set AppleScript's text item delimiters to "\\n"
  return eventList as text
end tell`;

  const output = await runAppleScriptFile(script);
  return parseEventList(output);
};

export const parseEventList = (output: string): AppleCalendarEvent[] => {
  if (!output) {
    return [];
  }
  return output.split("\n").map((line) => {
    const parts = line.split("|||");
    return {
      id: parts[0]?.trim() ?? "",
      summary: parts[1]?.trim() ?? "",
      startDate: parts[2]?.trim() ?? "",
      endDate: parts[3]?.trim() ?? "",
      location: parts[4]?.trim() ?? "",
      notes: parts[5]?.trim() ?? "",
      calendarName: parts[6]?.trim() ?? "",
      isAllDay: parts[7]?.trim() === "true",
      url: parts[8]?.trim() ?? "",
    };
  });
};

export const createEvent = async (input: CreateEventInput): Promise<AppleCalendarEvent> => {
  const start = DateTime.fromISO(input.startDate);
  const end = DateTime.fromISO(input.endDate);

  if (!start.isValid || !end.isValid) {
    throw new Error("Invalid date format. Use ISO 8601.");
  }

  const startStr = start.toFormat("MMMM d, yyyy h:mm:ss a");
  const endStr = end.toFormat("MMMM d, yyyy h:mm:ss a");

  const locationLine = input.location
    ? `set location of newEvent to "${input.location.replace(/"/g, '\\"')}"`
    : "";
  const notesLine = input.notes
    ? `set description of newEvent to "${input.notes.replace(/"/g, '\\"')}"`
    : "";
  const allDayLine = input.isAllDay ? "set allday event of newEvent to true" : "";

  const script = `
tell application "Calendar"
  set targetCal to first calendar whose name is "${input.calendarName.replace(/"/g, '\\"')}"
  set startDate to date "${startStr}"
  set endDate to date "${endStr}"

  set newEvent to make new event at end of events of targetCal with properties {summary:"${input.summary.replace(/"/g, '\\"')}", start date:startDate, end date:endDate}
  ${locationLine}
  ${notesLine}
  ${allDayLine}

  set evtId to uid of newEvent
  set evtAllDay to allday event of newEvent
  set evtLocation to " "
  set evtNotes to " "
  set evtUrl to " "
  try
    set evtLocation to location of newEvent
  end try
  try
    set evtNotes to description of newEvent
  end try
  try
    set evtUrl to url of newEvent
  end try

  return evtId & "|||" & summary of newEvent & "|||" & (start date of newEvent as string) & "|||" & (end date of newEvent as string) & "|||" & evtLocation & "|||" & evtNotes & "|||" & (name of targetCal) & "|||" & (evtAllDay as string) & "|||" & evtUrl
end tell`;

  const output = await runAppleScriptFile(script);
  return parseEventOutput(output);
};

export const parseEventOutput = (output: string): AppleCalendarEvent => {
  const parts = output.split("|||");
  return {
    id: parts[0]?.trim() ?? "",
    summary: parts[1]?.trim() ?? "",
    startDate: parts[2]?.trim() ?? "",
    endDate: parts[3]?.trim() ?? "",
    location: parts[4]?.trim() ?? "",
    notes: parts[5]?.trim() ?? "",
    calendarName: parts[6]?.trim() ?? "",
    isAllDay: parts[7]?.trim() === "true",
    url: parts[8]?.trim() ?? "",
  };
};
