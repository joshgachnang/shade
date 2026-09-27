// Launch one agent as its own process. Nothing is shared between calls except the
// repository and the files brewery hands over, so every step is a fresh context.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AgentProfile } from "./config.ts";

export type Status = "PASS" | "FAIL" | "BLOCKED" | "PENDING";

export interface Ask {
  q: string;
  rec: string;
  opts?: string[];
}

export interface Finding {
  id?: string;
  severity: "blocking" | "should-fix" | "nit";
  axis?: string;
  where?: string;
  attack: string;
  evidence: string;
  fix?: string;
  agent?: string;
}

// What every step writes to its result file. A superset of terreno's stage result.
export interface StepResult {
  status: Status;
  action: string;
  next?: string | null;
  summary?: string;
  ip?: string;
  pr?: number | string;
  sha?: string;
  ask?: Ask[];
  fail?: { need: string; want: string; got: string; ev: string }[];
  block?: { kind: "human" | "environment" | "access" | "external"; why: string; ev?: string }[];
  findings?: Finding[];
  structural?: boolean;
  tally?: { edited: number; moved: number; rebutted: number };
}

export interface RunRequest {
  name: string;
  profile: AgentProfile;
  cwd: string;
  prompt: string;
  promptFile: string;
  resultFile: string;
  logFile: string;
  timeoutMin: number;
}

export interface RunOutcome {
  result: StepResult;
  exitCode: number | null;
  seconds: number;
}

const tomlString = (value: string): string => JSON.stringify(value);

export const agentArgv = (profile: AgentProfile, cwd: string): string[] => {
  switch (profile.type) {
    case "claude":
      return [
        "claude",
        "-p",
        "--dangerously-skip-permissions",
        ...(profile.model ? ["--model", profile.model] : []),
        ...(profile.args ?? []),
      ];
    case "codex": {
      const provider = profile.provider;
      const providerArgs = provider
        ? [
            "-c",
            `model_provider=${tomlString(provider.name)}`,
            "-c",
            `model_providers.${provider.name}.name=${tomlString(provider.name)}`,
            "-c",
            `model_providers.${provider.name}.base_url=${tomlString(provider.baseUrl)}`,
            "-c",
            `model_providers.${provider.name}.env_key=${tomlString(provider.envKey)}`,
            "-c",
            `model_providers.${provider.name}.wire_api=${tomlString(provider.wireApi ?? "responses")}`,
          ]
        : [];
      return [
        "codex",
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-C",
        cwd,
        ...(profile.model ? ["-m", profile.model] : []),
        ...providerArgs,
        ...(profile.args ?? []),
        "-",
      ];
    }
    case "command":
      if (!profile.command?.length) throw new Error("brewery: command agent needs `command`");
      return profile.command;
  }
};

const childEnv = (profile: AgentProfile, req: RunRequest): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // A nested claude must not think it is running inside the parent session.
    if (value !== undefined && key !== "CLAUDECODE" && !key.startsWith("CLAUDE_CODE_")) env[key] = value;
  }
  return {
    ...env,
    ...profile.env,
    BREWERY_PROMPT_FILE: req.promptFile,
    BREWERY_RESULT_FILE: req.resultFile,
  };
};

const STATUSES: ReadonlySet<string> = new Set(["PASS", "FAIL", "BLOCKED", "PENDING"]);

export const readResult = (resultFile: string): StepResult | string => {
  if (!existsSync(resultFile)) return "agent exited without writing its result file";
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resultFile, "utf8"));
  } catch (error) {
    return `result file is not JSON: ${(error as Error).message}`;
  }
  const result = raw as Partial<StepResult>;
  if (!result || typeof result !== "object") return "result is not an object";
  if (!STATUSES.has(String(result.status))) return `result status "${result.status}" is not PASS/FAIL/BLOCKED/PENDING`;
  if (typeof result.action !== "string" || !result.action) return "result has no action";
  return result as StepResult;
};

export const availability = async (profile: AgentProfile): Promise<string | null> => {
  const argv = agentArgv(profile, process.cwd());
  const bin = Bun.which(argv[0]);
  if (!bin) return `${argv[0]} not on PATH`;
  if (profile.type === "command") return null;
  const proc = Bun.spawn([bin, "--version"], { stdout: "ignore", stderr: "ignore", timeout: 15_000 });
  if ((await proc.exited) !== 0) return `${argv[0]} --version failed (broken install?)`;
  if (profile.provider && !process.env[profile.provider.envKey]) return `${profile.provider.envKey} is not set`;
  return null;
};

export const runAgent = async (req: RunRequest): Promise<RunOutcome> => {
  writeFileSync(req.promptFile, req.prompt);
  writeFileSync(req.logFile, `# ${req.name} in ${req.cwd}\n# prompt: ${req.promptFile}\n\n`);
  const started = Date.now();
  const proc = Bun.spawn(agentArgv(req.profile, req.cwd), {
    cwd: req.cwd,
    env: childEnv(req.profile, req),
    stdin: Bun.file(req.promptFile),
    stdout: "pipe",
    stderr: "pipe",
    timeout: req.timeoutMin * 60_000,
  });
  const pump = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) appendFileSync(req.logFile, decoder.decode(chunk));
  };
  await Promise.all([pump(proc.stdout), pump(proc.stderr), proc.exited]);
  const seconds = Math.round((Date.now() - started) / 1000);
  const parsed = readResult(req.resultFile);
  const result: StepResult =
    typeof parsed === "string"
      ? {
          status: "FAIL",
          action: `Rerun ${req.name}: ${parsed}`,
          fail: [{ need: "a result file", want: req.resultFile, got: parsed, ev: req.logFile }],
        }
      : parsed;
  return { result, exitCode: proc.exitCode, seconds };
};
