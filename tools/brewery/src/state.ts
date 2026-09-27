// Per-run state lives in the target repo under .terreno/brewery/<slug>/ (git-ignored).
// A small global index maps slugs to repos so `brewery answer <slug>` works anywhere.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Ask, Status } from "./agents.ts";

export type Phase = "distill" | "signoff" | "approved" | "build" | "review" | "brew" | "finish" | "done";

export interface TaskState {
  status: "todo" | "passed" | "skipped";
  attempts: number;
  commit?: string;
  evidence?: string;
}

export interface HistoryEntry {
  seq: number;
  stage: string;
  agent: string;
  status: Status;
  action: string;
  seconds: number;
  log: string;
  task?: string;
}

export interface Answer {
  q: string;
  a: string;
  at: string;
}

export interface RunState {
  v: 1;
  slug: string;
  repo: string;
  ip: string;
  base: string;
  branch?: string;
  phase: Phase;
  seq: number;
  tasks: Record<string, TaskState>;
  pr?: number;
  waiting?: { kind: "signoff" | "gate"; asks: Ask[]; message: string; since: string; task?: string };
  answers: Answer[];
  cutRounds: number;
  reviewRounds: number;
  finish?: { startedAt: string; pushes: number; reactions: number; stuck: number; lastKey?: string };
  history: HistoryEntry[];
}

export const runDir = (repo: string, slug: string): string => join(repo, ".terreno", "brewery", slug);
const statePath = (repo: string, slug: string): string => join(runDir(repo, slug), "state.json");
export const contextPath = (repo: string, slug: string): string => join(runDir(repo, slug), "context.md");

const indexPath = (): string =>
  process.env.BREWERY_INDEX ?? join(homedir(), ".local", "state", "brewery", "runs.json");

export const readIndex = (): Record<string, string> => {
  const path = indexPath();
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
};

export const saveState = (state: RunState): void => {
  const dir = runDir(state.repo, state.slug);
  mkdirSync(join(dir, "steps"), { recursive: true });
  writeFileSync(statePath(state.repo, state.slug), `${JSON.stringify(state, null, 2)}\n`);
  const index = readIndex();
  if (index[state.slug] !== state.repo) {
    index[state.slug] = state.repo;
    mkdirSync(dirname(indexPath()), { recursive: true });
    writeFileSync(indexPath(), `${JSON.stringify(index, null, 2)}\n`);
  }
};

export const loadState = (slug: string, repo?: string): RunState => {
  const root = repo ?? readIndex()[slug];
  if (!root || !existsSync(statePath(root, slug))) {
    throw new Error(`brewery: no run "${slug}"${repo ? ` in ${repo}` : ""}. See \`brewery status\`.`);
  }
  return JSON.parse(readFileSync(statePath(root, slug), "utf8")) as RunState;
};

export const newState = (fields: { slug: string; repo: string; ip: string; base: string; phase: Phase }): RunState => ({
  v: 1,
  ...fields,
  seq: 0,
  tasks: {},
  answers: [],
  cutRounds: 0,
  reviewRounds: 0,
  history: [],
});

// The user-context packet: only what the human said, verbatim. Cut sees nothing else.
export const appendContext = (state: RunState, heading: string, body: string): void => {
  const path = contextPath(state.repo, state.slug);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `## ${heading}\n\n${body.trim()}\n\n`);
};

export const readContext = (state: RunState): string => {
  const path = contextPath(state.repo, state.slug);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/, "");
