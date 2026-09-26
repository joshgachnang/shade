import {spawn as nodeSpawn} from "node:child_process";
import type {SpawnedProcess, SpawnOptions} from "@anthropic-ai/claude-agent-sdk";
import {logger} from "@terreno/api";
import {loadAppConfig} from "../../models/appConfig";
import type {AppConfigZerg} from "../../types/models/appConfigTypes";
import type {GroupExecutionConfig} from "../../types/models/groupTypes";
import {DirectAgentRunner, type RunPreparation} from "./direct";
import type {AgentAttachInfo, AgentRunConfig, AgentRunResult, ContainerTarget} from "./types";

/**
 * Runs agent turns inside a zerg-managed container instead of on the Shade
 * host. Per run it:
 *
 *   1. brings the `<repo>-<feature>` session up (`zerg run <repo> <feature>`,
 *      idempotent — an existing container is reused, a dead one rebuilt), and
 *   2. drives the Agent SDK exactly like DirectAgentRunner, except the Claude
 *      Code process is `docker exec`'d into that container. The SDK's stdio
 *      control channel rides the exec, so Shade's in-process MCP tools
 *      (send_message, task board, memory…) keep working unchanged while the
 *      agent gets the image's full toolchain and the repo checkout.
 *
 * The container outlives the turn. Its tmux window (created by `up`) holds an
 * interactive claude the operator can attach to at any time with
 * `zerg attach <repo> <feature>` and, inside it, `claude --resume <id>` to
 * pick up the exact conversation Shade was driving. Every result carries that
 * attach info.
 *
 * Runs on the zerg host directly, or from another machine over SSH when
 * AppConfig.zerg.sshHost is set.
 */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a one-shot host command to completion. Injected in tests. */
export type ExecFn = (argv: string[], opts: {timeoutMs: number}) => Promise<ExecResult>;

/** Spawns the long-lived docker exec that carries the SDK session. Injected in tests. */
export type SpawnFn = typeof nodeSpawn;

/** Env var stamped on every in-container claude so a stop can find it by pid. */
export const ZERG_RUN_ID_ENV = "SHADE_ZERG_RUN_ID";

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_FEATURE_LENGTH = 40;

/** Docker container name, matching hive's `sessionName`. */
export const zergSessionName = ({repo, feature}: ContainerTarget): string => `${repo}-${feature}`;

/** tmux session/window name, matching hive's `tmuxName`. */
export const zergTmuxName = ({repo, feature}: ContainerTarget): string => `${repo}|${feature}`;

/**
 * Derives a feature slug from a group name: lowercase, runs of non-alphanumerics
 * collapsed to a single dash, trimmed, capped. Empty input yields "main".
 */
export const slugifyFeature = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FEATURE_LENGTH)
    .replace(/-+$/, "");
  return slug || "main";
};

/**
 * The container target for a group, or undefined when the group runs on the
 * host. A container-mode group without a repo still returns a target (with an
 * empty repo) so the runner reports the misconfiguration as a failed run the
 * user can see, rather than silently falling back to the host.
 */
export const resolveContainerTarget = (group: {
  name: string;
  executionConfig?: GroupExecutionConfig;
}): ContainerTarget | undefined => {
  if (group.executionConfig?.mode !== "container") {
    return undefined;
  }
  const repo = group.executionConfig.zergRepo?.trim() ?? "";
  const feature = group.executionConfig.zergFeature?.trim() || slugifyFeature(group.name);
  return {repo, feature};
};

/** Throws when repo/feature cannot safely become a container name and argv. */
export const validateContainerTarget = (target: ContainerTarget): void => {
  if (!target.repo) {
    throw new Error(
      "Group is in container mode but executionConfig.zergRepo is not set (the repo name in zerg's repos.json)"
    );
  }
  if (!NAME_PATTERN.test(target.repo)) {
    throw new Error(`Invalid zerg repo name '${target.repo}'`);
  }
  if (!NAME_PATTERN.test(target.feature)) {
    throw new Error(`Invalid zerg feature name '${target.feature}'`);
  }
};

/**
 * Reads the `started <session>` / `reusing <session>` line `zerg run` prints.
 * Undefined when neither appears (an older or different session manager).
 */
export const parseUpOutput = (stdout: string): {created: boolean; session: string} | undefined => {
  const match = stdout.match(/^(started|reusing)\s+(\S+)/m);
  if (!match) {
    return undefined;
  }
  return {created: match[1] === "started", session: match[2] as string};
};

/**
 * Only vars with an allowed prefix cross into the container. The host's PATH,
 * HOME, shell and credentials are the container's own business; the SDK's
 * CLAUDE_CODE_* markers and Shade's SHADE_* context must follow the process.
 */
export const filterContainerEnv = (
  env: Record<string, string | undefined>,
  prefixes: string[]
): Record<string, string> => {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      filtered[key] = value;
    }
  }
  return filtered;
};

/** POSIX single-quote quoting for argv that passes through a remote shell. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Prefixes argv with an SSH hop when `sshHost` is set. ssh hands the remote
 * shell a single string, so every argument is quoted to survive the trip.
 */
export const withSshHost = (argv: string[], sshHost: string): string[] => {
  const host = sshHost.trim();
  if (!host) {
    return argv;
  }
  return ["ssh", "-T", "-o", "BatchMode=yes", host, argv.map(shellQuote).join(" ")];
};

/** `docker exec -i -w <workdir> -e K=V… <session> <command> <args…>` */
export const buildDockerExecArgs = ({
  session,
  workdir,
  env,
  command,
  args,
}: {
  session: string;
  workdir: string;
  env: Record<string, string>;
  command: string;
  args: string[];
}): string[] => {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  return ["docker", "exec", "-i", "-w", workdir, ...envArgs, session, command, ...args];
};

/**
 * `docker exec` does not forward signals to the process it started, so killing
 * the host-side client leaves claude running in the container. This script,
 * run inside the container, finds every process stamped with the run id and
 * terminates it.
 */
export const buildKillScript = (runId: string): string =>
  [
    "for p in /proc/[0-9]*; do",
    `  if tr '\\0' '\\n' < "$p/environ" 2>/dev/null | grep -qx '${ZERG_RUN_ID_ENV}=${runId}'; then`,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
    '    kill -TERM "${p#/proc/}" 2>/dev/null;',
    "  fi;",
    "done",
  ].join(" ");

/** The `up` argv: `<command> <upVerb…> <repo> <feature>`. */
export const buildUpArgs = (zerg: AppConfigZerg, target: ContainerTarget): string[] => [
  zerg.command,
  ...zerg.upVerb.split(/\s+/).filter(Boolean),
  target.repo,
  target.feature,
];

/** What the channel sees once per session so the operator knows how to take over. */
export const formatAttachNotice = (attach: AgentAttachInfo): string =>
  `_Running in zerg session \`${attach.tmux}\`. Take over with \`${attach.attachCommand}\`, then \`${attach.resumeCommand}\` inside it._`;

const isMissingConversation = (error?: string): boolean =>
  /no conversation found/i.test(error ?? "");

const STDERR_TAIL_CHARS = 2000;

/** Default one-shot exec through Bun.spawn with a hard timeout. */
export const defaultExec: ExecFn = async (argv, {timeoutMs}) => {
  const proc = Bun.spawn(argv, {stdin: "ignore", stdout: "pipe", stderr: "pipe"});
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      code,
      stdout,
      stderr: timedOut ? `${stderr}\n(timed out after ${timeoutMs}ms)` : stderr,
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Builds the SDK's `spawnClaudeCodeProcess` for one run: every spawn becomes a
 * `docker exec -i` into the session (optionally over SSH). Abort and kill both
 * terminate the in-container process by run id, not just the local client.
 */
export const createContainerSpawner = ({
  session,
  workdir,
  runId,
  envPrefixes,
  sshHost,
  exec,
  spawn = nodeSpawn,
}: {
  session: string;
  workdir: string;
  runId: string;
  envPrefixes: string[];
  sshHost: string;
  exec: ExecFn;
  spawn?: SpawnFn;
}): ((options: SpawnOptions) => SpawnedProcess) => {
  return (options: SpawnOptions): SpawnedProcess => {
    const env = {
      ...filterContainerEnv(options.env, envPrefixes),
      [ZERG_RUN_ID_ENV]: runId,
    };
    const argv = withSshHost(
      buildDockerExecArgs({
        session,
        workdir: options.cwd ?? workdir,
        env,
        command: options.command,
        args: options.args,
      }),
      sshHost
    );
    logger.info(`Spawning Claude Code in zerg session ${session} (run ${runId})`);
    logger.debug(`zerg exec argv: ${argv.join(" ")}`);

    const child = spawn(argv[0] as string, argv.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      signal: options.signal,
    });

    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-STDERR_TAIL_CHARS);
    });
    child.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        logger.warn(
          `zerg exec for run ${runId} exited ${code}${stderrTail ? `: ${stderrTail.trim()}` : ""}`
        );
      } else if (signal) {
        logger.debug(`zerg exec for run ${runId} terminated by ${signal}`);
      }
    });

    let containerKilled = false;
    const killInContainer = (): void => {
      if (containerKilled) {
        return;
      }
      containerKilled = true;
      const argvKill = withSshHost(
        ["docker", "exec", session, "sh", "-c", buildKillScript(runId)],
        sshHost
      );
      exec(argvKill, {timeoutMs: 15000}).catch((error) => {
        logger.warn(`Failed to stop run ${runId} inside ${session}: ${error}`);
      });
    };
    options.signal.addEventListener("abort", killInContainer, {once: true});

    return {
      stdin: child.stdin!,
      stdout: child.stdout!,
      get killed(): boolean {
        return child.killed;
      },
      get exitCode(): number | null {
        return child.exitCode;
      },
      kill: (signal: NodeJS.Signals): boolean => {
        killInContainer();
        return child.kill(signal);
      },
      on: child.on.bind(child),
      once: child.once.bind(child),
      off: child.off.bind(child),
    };
  };
};

export class ZergAgentRunner extends DirectAgentRunner {
  private readonly exec: ExecFn;
  private readonly spawn: SpawnFn;

  constructor({exec = defaultExec, spawn = nodeSpawn}: {exec?: ExecFn; spawn?: SpawnFn} = {}) {
    super();
    this.exec = exec;
    this.spawn = spawn;
  }

  protected override supportsContainer(): boolean {
    return true;
  }

  /**
   * Creates or reuses the session. Returns hive's own report of what it did;
   * a session manager that prints nothing recognizable is treated as reused.
   */
  async ensureSession(
    target: ContainerTarget,
    zerg: AppConfigZerg
  ): Promise<{session: string; created: boolean}> {
    const argv = withSshHost(buildUpArgs(zerg, target), zerg.sshHost);
    const result = await this.exec(argv, {timeoutMs: zerg.upTimeoutMs});
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      throw new Error(
        `${argv.join(" ")} failed (exit ${result.code})${detail ? `: ${detail}` : ""}`
      );
    }
    const expected = zergSessionName(target);
    const parsed = parseUpOutput(result.stdout);
    if (parsed && parsed.session !== expected) {
      logger.warn(`zerg reported session '${parsed.session}', expected '${expected}'`);
    }
    return {session: parsed?.session ?? expected, created: parsed?.created ?? false};
  }

  protected override async prepare(config: AgentRunConfig): Promise<RunPreparation> {
    const target = config.container;
    if (!target) {
      throw new Error(
        'ZergAgentRunner requires a container target (Group.executionConfig.mode = "container")'
      );
    }
    validateContainerTarget(target);

    const {zerg} = await loadAppConfig();
    if (!zerg.enabled) {
      throw new Error("zerg execution is disabled (AppConfig.zerg.enabled = false)");
    }

    const {session, created} = await this.ensureSession(target, zerg);
    logger.info(
      `zerg session ${session} ${created ? "started" : "reused"} for run ${config.sessionId}`
    );

    const runId = crypto.randomUUID();
    return {
      cwd: zerg.workdir,
      pathToClaudeCodeExecutable: zerg.claudeCommand,
      spawnClaudeCodeProcess: createContainerSpawner({
        session,
        workdir: zerg.workdir,
        runId,
        envPrefixes: zerg.envPrefixes,
        sshHost: zerg.sshHost,
        exec: this.exec,
        spawn: this.spawn,
      }),
      attach: {
        session,
        tmux: zergTmuxName(target),
        attachCommand: `${zerg.command} ${zerg.attachVerb} ${target.repo} ${target.feature}`,
      },
    };
  }

  /**
   * A resume checkpoint points at a transcript in the container's home. When
   * that home was rebuilt (`--fresh`, a new template) the CLI rejects the id;
   * rerun the turn once from scratch rather than surfacing a dead checkpoint.
   */
  override async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const result = await super.run(config);
    if (result.status === "failed" && config.resume && isMissingConversation(result.error)) {
      logger.warn(
        `Resume checkpoint ${config.resumeSessionAt ?? "?"} not found in container for ${config.sessionId}; rerunning without resume`
      );
      return super.run({...config, resume: false, resumeSessionAt: undefined});
    }
    return result;
  }
}
