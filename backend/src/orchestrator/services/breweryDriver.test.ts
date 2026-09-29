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
