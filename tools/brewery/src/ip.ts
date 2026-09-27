// Deterministic reads and writes of a distilled IP. brewery, not the agent, owns the
// Status line and the task checkboxes, so approval and progress cannot be faked.
import { readFileSync, writeFileSync } from "node:fs";

export interface IpTask {
  id: string;
  title: string;
  done: boolean;
}

const TASK_LINE = /^- \[( |x|X)\] \*\*(T\d+)\*\*\s*[—–:-]\s*(.+)$/gm;
const STATUS_LINE = /^Status:[ \t]*(.*)$/m;

export const parseTasks = (text: string): IpTask[] =>
  [...text.matchAll(TASK_LINE)].map((m) => ({ id: m[2], title: m[3].trim(), done: m[1] !== " " }));

export const readStatus = (text: string): string | null => STATUS_LINE.exec(text)?.[1]?.trim() ?? null;

export const isApproved = (text: string): boolean => /^approved\b/i.test(readStatus(text) ?? "");

export const setStatus = (text: string, status: string): string => {
  if (STATUS_LINE.test(text)) return text.replace(STATUS_LINE, `Status: ${status}`);
  return `${text.trimEnd()}\n\n## Sign-off\n\nStatus: ${status}\n`;
};

export const markTask = (text: string, id: string): string =>
  text.replace(new RegExp(`^- \\[ \\] \\*\\*${id}\\*\\*`, "m"), `- [x] **${id}**`);

export const title = (text: string): string => /^# (.+)$/m.exec(text)?.[1]?.trim() ?? "Untitled plan";

// First prose paragraph after the H1: the orientation paragraph of the brief.
export const orientation = (text: string): string => {
  const afterTitle = text.split(/^# .+$/m)[1] ?? "";
  const para = afterTitle
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith(">") && !/^Status:/.test(p));
  return para?.replace(/\s+/g, " ") ?? "";
};

export const readIp = (path: string): string => readFileSync(path, "utf8");
export const writeIp = (path: string, text: string): void => writeFileSync(path, text);
