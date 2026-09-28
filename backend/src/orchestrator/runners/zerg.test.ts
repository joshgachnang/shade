import {afterEach, describe, expect, mock, test} from "bun:test";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {AppConfig, reloadAppConfig} from "../../models/appConfig";
import type {AppConfigZerg} from "../../types/models/appConfigTypes";
import {DirectAgentRunner} from "./direct";
import type {AgentRunConfig} from "./types";
import {
  buildDockerExecArgs,
  buildKillScript,
  buildUpArgs,
  createContainerSpawner,
  type ExecFn,
  filterContainerEnv,
  formatAttachNotice,
  parseUpOutput,
  redactExecArgs,
  resolveContainerTarget,
  shellQuote,
  slugifyFeature,
  validateContainerTarget,
  withSshHost,
  ZERG_RUN_ID_ENV,
  ZergAgentRunner,
  zergSessionName,
  zergTmuxName,
} from "./zerg";

const ZERG_DEFAULTS: AppConfigZerg = {
  enabled: true,
  sshHost: "",
  command: "zerg",
  upVerb: "run",
  attachVerb: "attach",
  workdir: "/workspace",
  claudeCommand: "claude",
  upTimeoutMs: 1000,
  envPrefixes: ["SHADE_", "CLAUDE_", "ANTHROPIC_"],
  dashVerb: "dash --json",
  inboxVerb: "inbox --json",
  cacheMs: 5000,
};

const baseRunConfig = (overrides: Partial<AgentRunConfig> = {}): AgentRunConfig => ({
  groupId: "group-1",
  groupFolder: "/tmp/group-1",
  sessionId: "session-1",
  prompt: "hello",
  modelBackend: "claude",
  timeout: 5000,
  idleTimeout: 1000,
  ...overrides,
});

const okExec =
  (stdout = "started shade-feature\n"): ExecFn =>
  async () => ({code: 0, stdout, stderr: ""});

/** A child_process-shaped stand-in the spawner can wrap. */
const fakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    exitCode: number | null;
    kill: ReturnType<typeof mock>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = mock((_signal?: string) => {
    child.killed = true;
    return true;
  });
  return child;
};

describe("zerg naming", () => {
  test("session and tmux names match hive's conventions", () => {
    const target = {repo: "shade", feature: "export-data"};
    expect(zergSessionName(target)).toBe("shade-export-data");
    expect(zergTmuxName(target)).toBe("shade|export-data");
  });

  test("slugifyFeature lowercases, collapses punctuation, trims and caps", () => {
    expect(slugifyFeature("Feature: Export User Data!")).toBe("feature-export-user-data");
    expect(slugifyFeature("   ")).toBe("main");
    expect(slugifyFeature("a".repeat(60)).length).toBe(40);
    expect(slugifyFeature(`${"a".repeat(39)}-b`)).toBe("a".repeat(39));
  });
});

describe("resolveContainerTarget", () => {
  test("is undefined for direct-mode and unset groups", () => {
    expect(resolveContainerTarget({name: "g", executionConfig: {mode: "direct"}})).toBeUndefined();
    expect(resolveContainerTarget({name: "g"})).toBeUndefined();
  });

  test("uses the configured repo and feature", () => {
    expect(
      resolveContainerTarget({
        name: "Export Data",
        executionConfig: {mode: "container", zergRepo: "shade", zergFeature: "lc-1"},
      })
    ).toEqual({repo: "shade", feature: "lc-1"});
  });

  test("derives the feature from the group name when unset", () => {
    expect(
      resolveContainerTarget({
        name: "Export Data",
        executionConfig: {mode: "container", zergRepo: "shade"},
      })
    ).toEqual({repo: "shade", feature: "export-data"});
  });

  test("keeps a container-mode group without a repo so the run fails visibly", () => {
    const target = resolveContainerTarget({
      name: "Export Data",
      executionConfig: {mode: "container"},
    });
    expect(target).toEqual({repo: "", feature: "export-data"});
    expect(() => validateContainerTarget(target!)).toThrow(/zergRepo/);
  });

  test("validateContainerTarget rejects names that are not safe for docker/argv", () => {
    expect(() => validateContainerTarget({repo: "sha de", feature: "x"})).toThrow(/repo/);
    expect(() => validateContainerTarget({repo: "shade", feature: "x;rm -rf"})).toThrow(/feature/);
    expect(() => validateContainerTarget({repo: "-shade", feature: "x"})).toThrow(/repo/);
    expect(() => validateContainerTarget({repo: "shade", feature: "lc-1.2_3"})).not.toThrow();
  });
});

describe("parseUpOutput", () => {
  test("reads started and reusing lines", () => {
    expect(parseUpOutput("started shade-x (resumed abc)\n")).toEqual({
      created: true,
      session: "shade-x",
    });
    expect(parseUpOutput("hive: mongo warming\nreusing shade-x\n")).toEqual({
      created: false,
      session: "shade-x",
    });
  });

  test("is undefined for unrecognized output", () => {
    expect(parseUpOutput("")).toBeUndefined();
    expect(parseUpOutput("promoted /srv/templates/shade")).toBeUndefined();
  });
});

describe("container env and argv", () => {
  test("filterContainerEnv keeps only allowed prefixes and drops undefined", () => {
    const env = filterContainerEnv(
      {
        PATH: "/usr/bin",
        HOME: "/Users/josh",
        SHADE_GROUP_ID: "g1",
        CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
        ANTHROPIC_API_KEY: "k",
        SLACK_BOT_TOKEN: "secret",
        SHADE_EMPTY: undefined,
      },
      ZERG_DEFAULTS.envPrefixes
    );
    expect(env).toEqual({
      SHADE_GROUP_ID: "g1",
      CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
      ANTHROPIC_API_KEY: "k",
    });
  });

  test("buildDockerExecArgs shapes the exec with workdir, env and command", () => {
    expect(
      buildDockerExecArgs({
        session: "shade-x",
        workdir: "/workspace",
        env: {SHADE_GROUP_ID: "g1"},
        command: "claude",
        args: ["--output-format", "stream-json"],
      })
    ).toEqual([
      "docker",
      "exec",
      "-i",
      "-w",
      "/workspace",
      "-e",
      "SHADE_GROUP_ID=g1",
      "shade-x",
      "claude",
      "--output-format",
      "stream-json",
    ]);
  });

  test("buildUpArgs uses the operator verb and accepts the hive fallback", () => {
    expect(buildUpArgs(ZERG_DEFAULTS, {repo: "shade", feature: "x"})).toEqual([
      "zerg",
      "run",
      "shade",
      "x",
    ]);
    expect(
      buildUpArgs({...ZERG_DEFAULTS, command: "hive", upVerb: "up"}, {repo: "shade", feature: "x"})
    ).toEqual(["hive", "up", "shade", "x"]);
  });

  test("withSshHost wraps argv in a quoted ssh command only when a host is set", () => {
    expect(withSshHost(["hive", "up", "shade", "x"], "")).toEqual(["hive", "up", "shade", "x"]);
    expect(withSshHost(["docker", "exec", "-e", "A=it's", "s", "claude"], "zerg")).toEqual([
      "ssh",
      "-T",
      "-o",
      "BatchMode=yes",
      "zerg",
      `'docker' 'exec' '-e' 'A=it'\\''s' 's' 'claude'`,
    ]);
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });

  test("buildKillScript targets processes stamped with the run id", () => {
    const script = buildKillScript("run-123");
    expect(script).toContain(`${ZERG_RUN_ID_ENV}=run-123`);
    expect(script).toContain("kill -TERM");
    expect(script).toContain("/proc/[0-9]*");
  });

  test("formatAttachNotice names the tmux window and both commands", () => {
    const notice = formatAttachNotice({
      session: "shade-x",
      tmux: "shade|x",
      attachCommand: "zerg attach shade x",
      claudeSessionId: "abc",
      resumeCommand: "claude --resume abc",
    });
    expect(notice).toContain("`shade|x`");
    expect(notice).toContain("`zerg attach shade x`");
    expect(notice).toContain("`claude --resume abc`");
  });
});

describe("createContainerSpawner", () => {
  test("spawns docker exec with filtered env and the run id stamp", () => {
    const child = fakeChild();
    const spawn = mock((_cmd: string, _args: string[], _opts: unknown) => child);
    const exec = mock(okExec());
    const spawner = createContainerSpawner({
      session: "shade-x",
      workdir: "/workspace",
      runId: "run-1",
      envPrefixes: ZERG_DEFAULTS.envPrefixes,
      sshHost: "",
      exec,
      spawn: spawn as never,
    });
    const controller = new AbortController();
    const proc = spawner({
      command: "claude",
      args: ["--output-format", "stream-json"],
      cwd: "/workspace",
      env: {PATH: "/usr/bin", SHADE_GROUP_ID: "g1", CLAUDE_CODE_ENTRYPOINT: "sdk-ts"},
      signal: controller.signal,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe("docker");
    expect(args).toEqual([
      "exec",
      "-i",
      "-w",
      "/workspace",
      "-e",
      "SHADE_GROUP_ID=g1",
      "-e",
      "CLAUDE_CODE_ENTRYPOINT=sdk-ts",
      "-e",
      `${ZERG_RUN_ID_ENV}=run-1`,
      "shade-x",
      "claude",
      "--output-format",
      "stream-json",
    ]);
    expect(args).not.toContain("PATH=/usr/bin");
    expect(proc.stdin).toBe(child.stdin);
    expect(proc.stdout).toBe(child.stdout);
    expect(proc.exitCode).toBeNull();
    expect(proc.killed).toBe(false);
  });

  test("kill terminates the local client and the in-container process once", async () => {
    const child = fakeChild();
    const exec = mock(okExec());
    const spawner = createContainerSpawner({
      session: "shade-x",
      workdir: "/workspace",
      runId: "run-2",
      envPrefixes: [],
      sshHost: "",
      exec,
      spawn: (() => child) as never,
    });
    const controller = new AbortController();
    const proc = spawner({command: "claude", args: [], env: {}, signal: controller.signal});

    expect(proc.kill("SIGTERM")).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(proc.killed).toBe(true);
    // A later abort must not issue a second in-container kill.
    controller.abort();
    await Promise.resolve();
    expect(exec).toHaveBeenCalledTimes(1);
    const [argv] = exec.mock.calls[0] as unknown as [string[]];
    expect(argv.slice(0, 3)).toEqual(["docker", "exec", "shade-x"]);
    expect(argv[argv.length - 1]).toContain(`${ZERG_RUN_ID_ENV}=run-2`);
  });

  test("abort alone also reaches into the container", async () => {
    const child = fakeChild();
    const exec = mock(okExec());
    const spawner = createContainerSpawner({
      session: "shade-x",
      workdir: "/workspace",
      runId: "run-3",
      envPrefixes: [],
      sshHost: "zerg",
      exec,
      spawn: (() => child) as never,
    });
    const controller = new AbortController();
    spawner({command: "claude", args: [], env: {}, signal: controller.signal});
    controller.abort();
    await Promise.resolve();
    expect(exec).toHaveBeenCalledTimes(1);
    const [argv] = exec.mock.calls[0] as unknown as [string[]];
    expect(argv[0]).toBe("ssh");
    expect(argv[4]).toBe("zerg");
  });
});

describe("ZergAgentRunner", () => {
  afterEach(async () => {
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });

  test("ensureSession runs `zerg run <repo> <feature>` and reports created", async () => {
    const exec = mock(okExec("started shade-x\n"));
    const runner = new ZergAgentRunner({exec});
    const result = await runner.ensureSession({repo: "shade", feature: "x"}, ZERG_DEFAULTS);
    expect(result).toEqual({session: "shade-x", created: true});
    expect(exec).toHaveBeenCalledWith(["zerg", "run", "shade", "x"], {timeoutMs: 1000});
  });

  test("ensureSession treats a reusing line as not created and unknown output as reused", async () => {
    const reused = new ZergAgentRunner({exec: okExec("reusing shade-x\n")});
    expect(await reused.ensureSession({repo: "shade", feature: "x"}, ZERG_DEFAULTS)).toEqual({
      session: "shade-x",
      created: false,
    });
    const silent = new ZergAgentRunner({exec: okExec("")});
    expect(await silent.ensureSession({repo: "shade", feature: "x"}, ZERG_DEFAULTS)).toEqual({
      session: "shade-x",
      created: false,
    });
  });

  test("ensureSession surfaces a failed up with its stderr", async () => {
    const runner = new ZergAgentRunner({
      exec: async () => ({code: 1, stdout: "", stderr: "hive: unknown repo 'nope'\n"}),
    });
    await expect(runner.ensureSession({repo: "nope", feature: "x"}, ZERG_DEFAULTS)).rejects.toThrow(
      /exit 1.*unknown repo 'nope'/
    );
  });

  test("ensureSession goes over ssh when sshHost is set", async () => {
    const exec = mock(okExec("started shade-x\n"));
    const runner = new ZergAgentRunner({exec});
    await runner.ensureSession({repo: "shade", feature: "x"}, {...ZERG_DEFAULTS, sshHost: "zerg"});
    const [argv] = exec.mock.calls[0] as unknown as [string[]];
    expect(argv).toEqual(["ssh", "-T", "-o", "BatchMode=yes", "zerg", "'zerg' 'run' 'shade' 'x'"]);
  });

  test("run fails visibly without a container target and never spawns", async () => {
    const exec = mock(okExec());
    const spawn = mock(() => fakeChild());
    const runner = new ZergAgentRunner({exec, spawn: spawn as never});
    const result = await runner.run(baseRunConfig());
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/container target/);
    expect(exec).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test("run fails visibly when the group has no zergRepo", async () => {
    const exec = mock(okExec());
    const runner = new ZergAgentRunner({exec});
    const result = await runner.run(baseRunConfig({container: {repo: "", feature: "x"}}));
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/zergRepo/);
    expect(exec).not.toHaveBeenCalled();
  });

  test("run fails visibly when zerg is disabled in AppConfig", async () => {
    await AppConfig.deleteMany({});
    await AppConfig.create({zerg: {enabled: false}});
    await reloadAppConfig();
    const exec = mock(okExec());
    const runner = new ZergAgentRunner({exec});
    const result = await runner.run(baseRunConfig({container: {repo: "shade", feature: "x"}}));
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/disabled/);
    expect(exec).not.toHaveBeenCalled();
  });

  test("run reports a failed `up` as a failed result", async () => {
    const spawn = mock(() => fakeChild());
    const runner = new ZergAgentRunner({
      exec: async () => ({code: 2, stdout: "", stderr: "hive: usage"}),
      spawn: spawn as never,
    });
    const result = await runner.run(baseRunConfig({container: {repo: "shade", feature: "x"}}));
    expect(result.status).toBe("failed");
    // AppConfig defaults route through ssh to the zerg host.
    expect(result.error).toMatch(
      /^ssh -T -o BatchMode=yes zerg 'zerg' 'run' 'shade' 'x' failed \(exit 2\): hive: usage/
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("DirectAgentRunner container refusal", () => {
  test("refuses a container target instead of running on the host", async () => {
    const runner = new DirectAgentRunner();
    const result = await runner.run(baseRunConfig({container: {repo: "shade", feature: "x"}}));
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/container execution/);
    expect(runner.isRunning("session-1")).toBe(false);
  });
});

describe("redactExecArgs", () => {
  test("hides every -e value but keeps the variable names", () => {
    const args = buildDockerExecArgs({
      session: "lede-x",
      workdir: "/workspace",
      env: {ANTHROPIC_API_KEY: "sk-ant-secret", SHADE_GROUP_ID: "abc123"},
      command: "claude",
      args: ["--print"],
    });

    const redacted = redactExecArgs(args).join(" ");

    expect(redacted).not.toContain("sk-ant-secret");
    expect(redacted).not.toContain("abc123");
    expect(redacted).toContain("ANTHROPIC_API_KEY=<redacted>");
    expect(redacted).toContain("SHADE_GROUP_ID=<redacted>");
    expect(redacted).toContain("docker exec -i -w /workspace");
    expect(redacted).toContain("lede-x claude --print");
  });

  test("leaves args without env flags unchanged", () => {
    expect(redactExecArgs(["zerg", "run", "lede", "x"])).toEqual(["zerg", "run", "lede", "x"]);
  });
});
