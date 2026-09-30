import {afterEach, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {AppConfig} from "../../models/appConfig";
import {Feature} from "../../models/feature";
import {Group} from "../../models/group";
import {defaultExec, type ExecFn} from "../hostExec";
import {BreweryDriver} from "./breweryDriver";

test("rejects an empty request, persists error and reports a fix to the channel", async () => {
  const feature = await Feature.create({name: "Startup test"});
  const group = new Group({name: "feat-shade-example", externalId: "test-channel"});
  const messages: string[] = [];
  const driver = new BreweryDriver({
    sendMessage: async (_channel, _target, text) => {
      messages.push(text);
    },
  });
  await expect(driver.start({feature, group, request: " ", repo: "shade"})).rejects.toThrow(
    "request"
  );
  expect((await Feature.findById(feature._id))?.status).toBe("error");
  expect(messages.join(" ")).toContain("request");
  await feature.deleteOne();
});

// Real filesystem, git, MongoDB and detached spawn; only the external brewery CLI is fake.
const report =
  "Agents:\n  ✓ fake command\nStages:\n" +
  ["distill", "cut", "pick", "roast", "review", "brew", "taste"]
    .map((stage) => `  ${stage} first of fake`)
    .join("\n");
const dirs: string[] = [];
const features: InstanceType<typeof Feature>[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, {recursive: true, force: true})));
  await Promise.all(features.splice(0).map((feature) => feature.deleteOne()));
});
const fixture = async (zerg = true) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brewery startup "));
  dirs.push(dir);
  const config = new AppConfig({
    zerg: {enabled: zerg, sshHost: ""},
    featureChannels: {localReposDir: dir},
  });
  const feature = await Feature.create({name: "Example"});
  features.push(feature);
  const group = new Group({name: "feat-shade-example", externalId: "test-channel"});
  const messages: string[] = [];
  const options = {
    loadConfig: async () => config,
    sendMessage: async (_channel: string, _target: string, text: string) => {
      messages.push(text);
    },
  };
  return {dir, config, feature, group, messages, options};
};

test("local start uses an isolated default-branch worktree and detached CLI with the verbatim request", async () => {
  const f = await fixture(false);
  const repoPath = path.join(f.dir, "shade");
  const run = async (argv: string[]) => {
    const result = await defaultExec(argv, {timeoutMs: 10000});
    expect(result.code).toBe(0);
  };
  await run(["git", "init", "-b", "main", repoPath]);
  await run([
    "git",
    "-C",
    repoPath,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
  await run(["git", "-C", repoPath, "update-ref", "refs/remotes/origin/main", "HEAD"]);
  await run([
    "git",
    "-C",
    repoPath,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);
  await run(["git", "-C", repoPath, "checkout", "-b", "unrelated"]);
  await run([
    "git",
    "-C",
    repoPath,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "Unrelated",
  ]);
  await fs.writeFile(path.join(repoPath, "untracked.txt"), "base remains untouched");
  // /tmp can be mounted noexec; keep the executable on the repository filesystem.
  const executableDir = await fs.mkdtemp(path.join(process.cwd(), ".brewery-test-"));
  dirs.push(executableDir);
  const executable = path.join(executableDir, "fake brewery.cjs");
  await fs.writeFile(
    executable,
    `#!${process.execPath}\nif(process.argv[2]==="agents") console.log(${JSON.stringify(report)}); else { const fs=require("node:fs"); fs.writeFileSync("invocation.json", JSON.stringify({argv:process.argv.slice(2),request:fs.readFileSync(process.argv[process.argv.indexOf("--file")+1],"utf8")})); }`,
    {mode: 0o700}
  );
  f.config.brewery.command = executable;
  f.config.brewery.agents = "distill=fake,pick=fake";
  const request = "Build café\n'quoted' $(touch forbidden) `uname`\n";
  const driver = new BreweryDriver(f.options);
  const state = await driver.start({...f, repo: "owner/shade", request});
  expect(state.workspace.kind).toBe("local");
  if (state.workspace.kind !== "local") throw new Error("wrong workspace");
  const cwd = state.workspace.repoPath;
  let invocation = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    invocation = await fs.readFile(path.join(cwd, "invocation.json"), "utf8").catch(() => "");
    if (invocation) break;
    await Bun.sleep(20);
  }
  expect(JSON.parse(invocation)).toEqual({
    argv: [
      "distill",
      "--file",
      `.terreno/brewery/${state.slug}/request.md`,
      "--slug",
      state.slug,
      "--no-wait",
      "--agents",
      "distill=fake,pick=fake",
    ],
    request,
  });
  expect(await fs.readFile(path.join(repoPath, "untracked.txt"), "utf8")).toBe(
    "base remains untouched"
  );
  expect(await fs.stat(path.join(cwd, "untracked.txt")).catch(() => null)).toBeNull();
  expect(
    (
      await defaultExec(["git", "-C", cwd, "log", "-1", "--format=%s"], {timeoutMs: 10000})
    ).stdout.trim()
  ).toBe("Initial");
  expect((await Feature.findById(f.feature._id))?.toObject().brewery).toMatchObject({
    slug: `example-${f.feature._id}`,
    repo: "owner/shade",
    workspace: {kind: "local", repoPath: cwd},
    phase: "distill",
    eventsOffset: 0,
    stepMessages: [],
  });
  expect((await Feature.findById(f.feature._id))?.status).toBe("in_progress");
  await expect(driver.start({...f, repo: "shade", request})).rejects.toThrow("already");
  expect((await Feature.findById(f.feature._id))?.status).toBe("in_progress");
  const failed = await Feature.create({name: "Failed launch"});
  features.push(failed);
  await expect(
    new BreweryDriver({
      ...f.options,
      launch: async () => {
        throw new Error("Synthetic spawn failure");
      },
    }).start({feature: failed, group: f.group, repo: "shade", request: "Another example"})
  ).rejects.toThrow("Unable to launch");
  expect((await Feature.findById(failed._id))?.status).toBe("error");
  expect(f.messages).toHaveLength(1);
  expect(f.messages[0]).toContain("launch.log");
}, 20000);

test.each([
  "released",
  "expired",
])("approval deferred by a %s poller lease launches once it clears", async (mode) => {
  const f = await replyFixture();
  const lease = new Date(Date.now() + 60000);
  await Feature.updateOne(
    {_id: f.feature._id},
    {
      $set: {
        status: "awaiting_approval",
        "brewery.waiting": {kind: "signoff", since: new Date()},
        "brewery.pollLeaseUntil": lease,
      },
    }
  );
  expect(await f.driver.handleMessage(f.group, {content: "ok"})).toBe("deferred");
  expect(await Bun.file(path.join(f.dir, "calls.jsonl")).exists()).toBe(false);
  expect((await Feature.findById(f.feature._id))?.brewery?.pollLeaseUntil).toEqual(lease);
  await Feature.updateOne(
    {_id: f.feature._id},
    mode === "released"
      ? {$unset: {"brewery.pollLeaseUntil": 1}}
      : {$set: {"brewery.pollLeaseUntil": new Date(0)}}
  );
  await f.driver.handleMessage(f.group, {content: "ok"});
  expect(await f.calls(1)).toEqual([
    ["answer", "reply-test", "ok", "--go", "--no-wait", "--repo", f.dir],
  ]);
  expect((await Feature.findById(f.feature._id))?.status).toBe("in_progress");
  expect(f.messages.at(-1)).toBe("Reply sent to brewery.");
});

test.each([
  "",
  "remote-host",
])("zerg start uses configured session/workdir and detached docker over host %s", async (host) => {
  const f = await fixture();
  f.config.zerg.sshHost = host;
  f.config.zerg.workdir = f.dir;
  const calls: string[][] = [];
  const exec: ExecFn = async (argv) => {
    calls.push(argv);
    return {code: 0, stdout: calls.length === 1 ? "started shade-session\n" : report, stderr: ""};
  };
  const state = await new BreweryDriver({...f.options, exec}).start({
    ...f,
    repo: "owner/shade",
    request: "Line one\n'line two' $(false)",
  });
  expect(state.workspace).toMatchObject({kind: "zerg", session: "shade-session"});
  expect(calls).toHaveLength(4);
  expect((await Feature.findById(f.feature._id))?.toObject().brewery).toMatchObject({
    slug: `example-${f.feature._id}`,
    repo: "owner/shade",
    workspace: {kind: "zerg", session: "shade-session"},
    phase: "distill",
    eventsOffset: 0,
    stepMessages: [],
  });
  if (!host) {
    expect(calls[1]).toEqual(["docker", "exec", "-w", f.dir, "shade-session", "brewery", "agents"]);
    expect(calls[2]!.slice(0, 7)).toEqual([
      "docker",
      "exec",
      "-w",
      f.dir,
      "shade-session",
      "sh",
      "-c",
    ]);
    expect(calls[3]!.slice(0, 8)).toEqual([
      "docker",
      "exec",
      "-d",
      "-w",
      f.dir,
      "shade-session",
      "sh",
      "-c",
    ]);
    const writer = Bun.spawn(["sh", "-c", calls[2]![7]!], {cwd: f.dir});
    expect(await writer.exited).toBe(0);
    expect(
      await fs.readFile(path.join(f.dir, ".terreno/brewery", state.slug, "request.md"), "utf8")
    ).toBe("Line one\n'line two' $(false)");
  } else {
    for (const call of calls.slice(1)) expect(call[5]).toContain("'shade-session'");
  }
  const commands = calls.map((argv) => argv.join(" ")).join("\n");
  expect(commands).toContain(host ? "'docker' 'exec' '-d'" : "docker exec -d");
  expect(commands).toContain(f.dir);
  expect(commands).toContain("--no-wait");
  expect(commands).toContain("request.md");
  if (host) expect(calls.every((argv) => argv[0] === "ssh" && argv[4] === host)).toBe(true);
});

test.each([
  "missing binary",
  "no agent",
  "malformed report",
  "session failed",
  "request write failed",
  "launch failed",
])("startup reports %s without falling back", async (reason) => {
  const f = await fixture();
  let count = 0;
  const exec: ExecFn = async () => {
    count++;
    const fails =
      (reason === "session failed" && count === 1) ||
      (reason === "missing binary" && count === 2) ||
      (reason === "request write failed" && count === 3) ||
      (reason === "launch failed" && count === 4);
    return {
      code: fails ? 1 : 0,
      stdout:
        reason === "no agent"
          ? report.replace("✓", "✗")
          : reason === "malformed report"
            ? ""
            : report,
      stderr: "sensitive external output",
    };
  };
  await expect(
    new BreweryDriver({...f.options, exec}).start({...f, repo: "shade", request: "Build example"})
  ).rejects.toThrow();
  expect((await Feature.findById(f.feature._id))?.status).toBe("error");
  expect(f.messages).toHaveLength(1);
  expect(f.messages[0]).toContain("retry");
  expect(f.messages[0]).not.toContain("sensitive external output");
  expect(count).toBe(
    reason === "session failed"
      ? 1
      : reason === "request write failed"
        ? 3
        : reason === "launch failed"
          ? 4
          : 2
  );
});

test.each([
  undefined,
  "",
  "../shade",
  "owner/repo; echo bad",
])("missing/invalid repo %s fails before OS execution", async (repo) => {
  const f = await fixture();
  let executed = false;
  const exec: ExecFn = async () => {
    executed = true;
    throw new Error("unexpected execution");
  };
  await expect(
    new BreweryDriver({...f.options, exec}).start({...f, repo, request: "Build example"})
  ).rejects.toThrow("repository");
  expect(executed).toBe(false);
  expect(f.feature.status).toBe("error");
});

test("waiting replies launch brewery answer with the verbatim reply", async () => {
  const f = await fixture(false);
  f.feature.groupId = f.group._id;
  f.feature.brewery = {
    slug: "reply-test",
    repo: "shade",
    workspace: {kind: "local", repoPath: f.dir},
    eventsOffset: 0,
    stepMessages: [],
    waiting: {kind: "signoff", since: new Date()},
  };
  await f.feature.save();
  const launches: string[][] = [];
  const driver = new BreweryDriver({
    ...f.options,
    launch: async (argv) => {
      launches.push(argv);
    },
  });
  await driver.handleMessage(f.group, {content: "ok, 2b"});
  expect(launches).toEqual([
    ["brewery", "answer", "reply-test", "ok, 2b", "--go", "--no-wait", "--repo", f.dir],
  ]);
});

const replyFixture = async (zerg = false) => {
  const f = await fixture(zerg);
  f.group.featureDriver = "brewery";
  f.feature.groupId = f.group._id;
  f.feature.status = "in_progress";
  f.feature.brewery = {
    slug: "reply-test",
    repo: "shade",
    workspace: zerg ? {kind: "zerg", session: "shade-session"} : {kind: "local", repoPath: f.dir},
    phase: "build",
    eventsOffset: 0,
    stepMessages: [{seq: 3, ts: "3", label: "T3 roast (codex)"}],
  };
  await f.feature.save();
  await fs.mkdir(path.join(f.dir, ".terreno/brewery/reply-test"), {recursive: true});
  const executableDir = await fs.mkdtemp(path.join(process.cwd(), ".brewery-reply-"));
  dirs.push(executableDir);
  f.config.brewery.command = path.join(executableDir, "fake brewery.cjs");
  await fs.writeFile(
    f.config.brewery.command,
    `#!${process.execPath}\nrequire("node:fs").appendFileSync("calls.jsonl", JSON.stringify(process.argv.slice(2))+"\\n");`,
    {mode: 0o700}
  );
  const calls = async (count: number) => {
    let lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines = (await fs.readFile(path.join(f.dir, "calls.jsonl"), "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean);
      if (lines.length >= count) break;
      await Bun.sleep(20);
    }
    return lines.map((line): string[] => JSON.parse(line));
  };
  return {...f, calls, driver: new BreweryDriver(f.options)};
};

test("running notes preserve whitespace, Unicode and shell-sensitive text", async () => {
  const f = await replyFixture();
  const note = "  --go café\n'quoted' $(touch forbidden) `uname`  ";
  await f.driver.handleMessage(f.group, {content: note});
  expect(await f.calls(1)).toEqual([["note", "reply-test", note, "--repo", f.dir]]);
  expect(f.messages).toEqual(["Queued for the next check-in (current: T3 roast)"]);
  expect(await fs.stat(path.join(f.dir, "forbidden")).catch(() => null)).toBeNull();
  expect((await Feature.findById(f.feature._id))?.status).toBe("in_progress");
});

test.each([
  "signoff",
  "gate",
] as const)("%s answers launch detached and retain waiting until CLI acceptance", async (kind) => {
  const f = await replyFixture();
  f.feature.brewery!.waiting = {kind, since: new Date()};
  f.feature.status = "awaiting_approval";
  await f.feature.save();
  f.config.brewery.agents = "pick=fake";
  const reply = "no: café\n'quoted' $(touch forbidden)";
  await f.driver.handleMessage(f.group, {content: reply});
  expect(await f.calls(1)).toEqual([
    ["answer", "reply-test", reply, "--go", "--no-wait", "--repo", f.dir, "--agents", "pick=fake"],
  ]);
  expect((await Feature.findById(f.feature._id))?.brewery?.waiting?.kind).toBe(kind);
  expect(f.messages).toEqual(["Reply sent to brewery."]);
});

test.each([
  "stop",
  "now: change direction",
])("%s terminates a real process group before acknowledgement or restart", async (content) => {
  const f = await replyFixture();
  const {spawn} = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  await fs.writeFile(path.join(f.dir, ".terreno/brewery/reply-test/run.pid"), String(child.pid));
  try {
    await f.driver.handleMessage(f.group, {content});
    expect(() => process.kill(child.pid!, 0)).toThrow();
    await exited;
    if (content === "stop") {
      expect((await Feature.findById(f.feature._id))?.status).toBe("paused");
      expect(f.messages).toEqual(["Brewery stopped. Reply `resume` to continue."]);
      expect(await fs.stat(path.join(f.dir, "calls.jsonl")).catch(() => null)).toBeNull();
    } else {
      expect(await f.calls(2)).toEqual([
        ["note", "reply-test", " change direction", "--repo", f.dir],
        ["resume", "reply-test", "--go", "--no-wait", "--repo", f.dir],
      ]);
      expect(f.messages).toEqual(["Interrupted T3 roast; restarting with your note"]);
    }
  } finally {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
  }
});

test("stop without a PID is idempotent; resume restores polling and clears old errors", async () => {
  const f = await replyFixture();
  await f.driver.handleMessage(f.group, {content: " stop "});
  await f.driver.handleMessage(f.group, {content: "stop"});
  expect((await Feature.findById(f.feature._id))?.status).toBe("paused");
  await Feature.updateOne({_id: f.feature._id}, {$set: {errorMessage: "old failure"}});
  await f.driver.handleMessage(f.group, {content: "resume"});
  expect(await f.calls(1)).toEqual([
    ["resume", "reply-test", "--go", "--no-wait", "--repo", f.dir],
  ]);
  const saved = await Feature.findById(f.feature._id);
  expect(saved?.status).toBe("in_progress");
  expect(saved?.errorMessage).toBeUndefined();
  expect(saved?.brewery?.lastEventAt).toBeInstanceOf(Date);
});

test.each([
  "",
  "   ",
  "now:",
  "now:  ",
])("empty input %j does not execute commands", async (content) => {
  const f = await replyFixture();
  await f.driver.handleMessage(f.group, {content});
  expect(await fs.stat(path.join(f.dir, "calls.jsonl")).catch(() => null)).toBeNull();
  expect((await Feature.findById(f.feature._id))?.status).toBe("in_progress");
  expect(f.messages).toHaveLength(1);
});

test("missing and complete runs do not launch commands", async () => {
  const f = await replyFixture();
  await f.driver.handleMessage(new Group({name: "missing", externalId: "missing"}), {
    content: "ok",
  });
  expect(f.messages[0]).toContain("No brewery run");
  await Feature.updateOne({_id: f.feature._id}, {$set: {status: "complete"}});
  await f.driver.handleMessage(f.group, {content: "now: work"});
  expect(f.messages[1]).toContain("complete");
  expect(await fs.stat(path.join(f.dir, "calls.jsonl")).catch(() => null)).toBeNull();
});

test.each([
  "bad",
  "0",
  "1",
  "-42",
])("invalid PID %s fails safely without restart or success acknowledgement", async (pid) => {
  const f = await replyFixture();
  await fs.writeFile(path.join(f.dir, ".terreno/brewery/reply-test/run.pid"), pid);
  await f.driver.handleMessage(f.group, {content: "now: work"});
  expect((await Feature.findById(f.feature._id))?.status).toBe("error");
  expect(f.messages).toHaveLength(1);
  expect(f.messages[0]).toContain("could not process");
  expect(await fs.stat(path.join(f.dir, "calls.jsonl")).catch(() => null)).toBeNull();
});

test.each([
  "note",
  "launch",
])("%s failure is sanitized, releases lease, and has no success ack", async (failure) => {
  const f = await replyFixture();
  const driver = new BreweryDriver({
    ...f.options,
    exec: async () => ({code: 1, stdout: "sensitive output", stderr: "sensitive output"}),
    launch: async () => {
      throw new Error("sensitive output");
    },
  });
  await driver.handleMessage(f.group, {content: failure === "note" ? "a note" : "resume"});
  const saved = await Feature.findById(f.feature._id);
  expect(saved?.status).toBe("error");
  expect(saved?.brewery?.pollLeaseUntil).toBeUndefined();
  expect(f.messages).toHaveLength(1);
  expect(f.messages[0]).toContain("launch.log");
  expect(f.messages[0]).not.toContain("sensitive output");
});

test("busy poll lease prevents a conflicting reply without changing run status", async () => {
  const f = await replyFixture();
  await Feature.updateOne(
    {_id: f.feature._id},
    {$set: {"brewery.pollLeaseUntil": new Date(Date.now() + 60000)}}
  );
  await f.driver.handleMessage(f.group, {content: "stop"});
  expect(f.messages[0]).toContain("retry");
  expect((await Feature.findById(f.feature._id))?.status).toBe("in_progress");
});

test.each([
  "",
  "remote-host",
])("zerg replies use the saved workspace and configured SSH host %s", async (host) => {
  const f = await replyFixture(true);
  f.config.zerg.enabled = false; // Existing workspace identity wins over today's startup mode.
  f.config.zerg.sshHost = host;
  const commands: string[][] = [];
  const driver = new BreweryDriver({
    ...f.options,
    exec: async (argv) => {
      commands.push(argv);
      return {code: 0, stdout: "", stderr: ""};
    },
  });
  await driver.handleMessage(f.group, {content: "now: 'quoted' $(false)"});
  expect(commands).toHaveLength(3);
  if (host) {
    expect(commands.every((argv) => argv[0] === "ssh" && argv[4] === host)).toBe(true);
    expect(commands[2]![5]).toContain("setsid");
    expect(commands[2]![5]).toContain("shade-session");
  } else {
    expect(commands[0]!.slice(0, 7)).toEqual([
      "docker",
      "exec",
      "-w",
      f.config.zerg.workdir,
      "shade-session",
      "bun",
      "-e",
    ]);
    expect(commands[1]).toContain(" 'quoted' $(false)");
    expect(commands[2]!.slice(0, 8)).toEqual([
      "docker",
      "exec",
      "-d",
      "-w",
      f.config.zerg.workdir,
      "shade-session",
      "sh",
      "-c",
    ]);
    expect(commands[2]![8]).toContain("exec setsid");
    expect(commands[2]![8]).toContain("'resume' 'reply-test' '--go' '--no-wait'");
  }
  expect(f.messages).toEqual(["Interrupted T3 roast; restarting with your note"]);
});

test("interrupt kills a TERM-resistant process group before recording the note or acknowledging", async () => {
  const f = await replyFixture();
  f.config.zerg.upTimeoutMs = 2000;
  const {spawn} = await import("node:child_process");
  const ready = path.join(f.dir, "ready.json");
  const descendantScript = `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const child = spawn(
    process.execPath,
    [
      "-e",
      `process.on("SIGTERM", () => {}); require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], {stdio: "ignore"}); setInterval(() => {}, 1000);`,
    ],
    {detached: true, stdio: "ignore"}
  );
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  let descendant = "";
  try {
    for (let i = 0; i < 100; i++) {
      descendant = await fs.readFile(ready, "utf8").catch(() => "");
      if (descendant) break;
      await Bun.sleep(20);
    }
    expect(Number(descendant)).toBeGreaterThan(1);
    await fs.writeFile(path.join(f.dir, ".terreno/brewery/reply-test/run.pid"), String(child.pid));
    await fs.writeFile(
      f.config.brewery.command,
      `#!${process.execPath}\nconst fs = require("node:fs"); if (process.argv[2] === "note") { let alive = false; try {process.kill(${child.pid}, 0); alive = true;} catch {} fs.writeFileSync("alive-at-note", String(alive)); } fs.appendFileSync("calls.jsonl", JSON.stringify(process.argv.slice(2))+"\\n");`,
      {mode: 0o700}
    );
    let aliveAtAck = true;
    const driver = new BreweryDriver({
      ...f.options,
      sendMessage: async (_channel, _target, text) => {
        try {
          process.kill(child.pid!, 0);
        } catch {
          aliveAtAck = false;
        }
        f.messages.push(text);
      },
    });
    await driver.handleMessage(f.group, {content: "now: new direction"});
    await exited;
    expect(await fs.readFile(path.join(f.dir, "alive-at-note"), "utf8")).toBe("false");
    expect(aliveAtAck).toBe(false);
    const status = await defaultExec(["ps", "-o", "stat=", "-p", descendant], {timeoutMs: 2000});
    // An orphan may briefly remain a zombie until PID 1 reaps it; it is no longer running.
    expect(status.stdout.trim() === "" || status.stdout.trim().startsWith("Z")).toBe(true);
    expect(await f.calls(2)).toHaveLength(2);
    expect(f.messages).toEqual(["Interrupted T3 roast; restarting with your note"]);
  } finally {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
  }
});

test.each([
  "answer",
  "interrupt",
])("a detached %s acknowledges while the CLI remains running", async (mode) => {
  const f = await replyFixture();
  if (mode === "answer") f.feature.brewery!.waiting = {kind: "gate", since: new Date()};
  await f.feature.save();
  await fs.writeFile(
    f.config.brewery.command,
    `#!${process.execPath}\nif (process.argv[2] === "note") process.exit(0); require("node:fs").writeFileSync("answer.pid", String(process.pid)); setInterval(() => {}, 1000);`,
    {mode: 0o700}
  );
  let pid = 0;
  try {
    await f.driver.handleMessage(f.group, {
      content: mode === "answer" ? "continue" : "now: adjust",
    });
    for (let i = 0; i < 100; i++) {
      pid = Number(await fs.readFile(path.join(f.dir, "answer.pid"), "utf8").catch(() => "0"));
      if (pid) break;
      await Bun.sleep(20);
    }
    expect(pid).toBeGreaterThan(1);
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect(f.messages).toEqual([
      mode === "answer"
        ? "Reply sent to brewery."
        : "Interrupted T3 roast; restarting with your note",
    ]);
  } finally {
    if (pid) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    }
  }
});

// A waiting event is visible before the preceding command releases its run lock.
test.each([
  "signoff",
  "gate",
] as const)("%s approval stays queued while the real brewery run lock is held", async (kind) => {
  const f = await replyFixture();
  f.feature.brewery!.waiting = {kind, since: new Date()};
  f.feature.status = "awaiting_approval";
  await f.feature.save();
  const {newState, withRunLock} = await import("../../../../tools/brewery/src/state");
  const state = newState({slug: "reply-test", repo: f.dir, ip: "", base: "main", phase: "signoff"});
  await withRunLock(state, async () => {
    expect(await f.driver.handleMessage(f.group, {content: "ok"})).toBe("deferred");
    expect(await Bun.file(path.join(f.dir, "calls.jsonl")).exists()).toBe(false);
    const saved = await Feature.findById(f.feature._id);
    expect(saved?.status).toBe("awaiting_approval");
    expect(saved?.brewery?.pollLeaseUntil).toBeUndefined();
    expect(f.messages.at(-1)).toContain("retry automatically");
  });
  expect(await f.driver.handleMessage(f.group, {content: "ok"})).toBeUndefined();
  expect(await f.calls(1)).toEqual([
    ["answer", "reply-test", "ok", "--go", "--no-wait", "--repo", f.dir],
  ]);
  expect(f.messages.at(-1)).toBe("Reply sent to brewery.");
});

test.each([
  "guard",
  "missing pid",
  "dead owner",
  "invalid pid",
])("waiting approval handles %s lock state safely", async (mode) => {
  const f = await replyFixture();
  f.feature.brewery!.waiting = {kind: "signoff", since: new Date()};
  await f.feature.save();
  const dir = path.join(f.dir, ".terreno/brewery/reply-test");
  await fs.mkdir(path.join(dir, mode === "guard" ? "run.guard" : "run.lock"));
  if (mode === "dead owner" || mode === "invalid pid") {
    await fs.writeFile(path.join(dir, "run.pid"), mode === "dead owner" ? "2147483647" : "invalid");
  }
  const outcome = await f.driver.handleMessage(f.group, {content: "ok"});
  if (mode === "dead owner") {
    expect(await f.calls(1)).toEqual([
      ["answer", "reply-test", "ok", "--go", "--no-wait", "--repo", f.dir],
    ]);
  } else {
    expect(await Bun.file(path.join(f.dir, "calls.jsonl")).exists()).toBe(false);
    expect(outcome).toBe(mode === "invalid pid" ? undefined : "deferred");
    expect(f.messages.at(-1)).toContain(
      mode === "invalid pid" ? "could not process" : "retry automatically"
    );
  }
  expect((await Feature.findById(f.feature._id))?.brewery?.pollLeaseUntil).toBeUndefined();
});
