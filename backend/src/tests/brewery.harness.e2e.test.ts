import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {type ChildProcess, spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import {reloadAppConfig} from "../models/appConfig";
import {defaultExec, shellQuote} from "../orchestrator/hostExec";
import {TEST_ADMIN_EMAIL as ADMIN_EMAIL} from "../testMode/constants";
import {getOutbox, loginAsUser, sendCommand, tickHarness, waitFor} from "./harnessClient";
import {testMongoUri} from "./preload";

interface HarnessFeature {
  id: string;
  groupId: string;
  status: string;
  brewery: {workspace: {repoPath: string}; slug: string; phase: string; pr?: number};
}

describe("brewery feature channel through bun run dev:test", () => {
  const baseUrl = "http://127.0.0.1:4020";
  let dir: string;
  let executableDir: string;
  let server: ChildProcess;
  let token: string;
  let mainGroupId: string;
  let ownsDatabase = false;
  const runDirs: string[] = [];
  const headers = () => ({Authorization: `Bearer ${token}`, "Content-Type": "application/json"});
  const get = async <T>(route: string): Promise<T> => {
    const res = await fetch(`${baseUrl}${route}`, {headers: headers()});
    expect(res.status).toBe(200);
    return ((await res.json()) as {data: T}).data;
  };
  const clearHarnessDatabase = async () => {
    // The subprocess registers models that this HTTP-only parent never imports.
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  };
  const git = async (...args: string[]) => {
    const child = Bun.spawn(["git", ...args], {stdout: "pipe", stderr: "pipe"});
    const error = await new Response(child.stderr).text();
    if (await child.exited) throw new Error(error);
  };

  beforeAll(async () => {
    // Never attach to (or reset) an already-running developer server.
    const occupied = await fetch(`${baseUrl}/health`).then(
      () => true,
      () => false
    );
    if (occupied) throw new Error("Port 4020 is occupied; stop that server before this test");
    const dbName = mongoose.connection.db?.databaseName ?? "";
    if (dbName !== "test" && !dbName.endsWith("-test")) {
      throw new Error("Brewery harness requires a disposable test database");
    }
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "shade brewery harness "));
    // Run the unchanged package script with all cwd-relative logs in the sandbox.
    const serverDir = path.join(dir, "server");
    await fs.mkdir(serverDir);
    const backendDir = path.resolve(import.meta.dir, "../..");
    for (const entry of ["package.json", "src", "node_modules"]) {
      await fs.symlink(path.join(backendDir, entry), path.join(serverDir, entry));
    }
    const repo = path.join(dir, "reading-room");
    await git("init", "-b", "main", repo);
    await git(
      "-C",
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial fixture"
    );
    await git("-C", repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    await git("-C", repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    // /tmp may be noexec; keep only the executable wrapper on the repo filesystem.
    executableDir = await fs.mkdtemp(path.join(process.cwd(), ".brewery-test-"));
    const command = path.join(executableDir, "fake brewery");
    await fs.writeFile(
      command,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(import.meta.dir, "fixtures/fake-brewery.ts"))} "$@"\n`,
      {mode: 0o700}
    );
    const preflight = await defaultExec([command, "agents"], {timeoutMs: 5000});
    if (preflight.code !== 0) throw new Error(preflight.stderr);
    ownsDatabase = true;
    await clearHarnessDatabase();
    const config = await reloadAppConfig();
    config.zerg.enabled = false;
    config.featureChannels.localReposDir = dir;
    config.brewery.command = command;
    config.brewery.pollIntervalMs = 100;
    config.brewery.narrationFlushMs = 0;
    await config.save();
    const log = await fs.open(path.join(dir, "server.log"), "a");
    try {
      server = spawn(process.execPath, ["run", "dev:test"], {
        cwd: serverDir,
        env: {
          ...process.env,
          NODE_ENV: "development",
          MONGO_URI: testMongoUri,
          TRIVIA_MONGO_URI: testMongoUri,
          SHADE_DATA_DIR: path.join(dir, "data"),
        },
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      });
    } finally {
      await log.close();
    }
    await waitFor(
      async () => {
        if (server.exitCode !== null) throw new Error(`dev:test exited; see ${dir}/server.log`);
        return fetch(`${baseUrl}/health`).then(
          (r) => r.ok,
          () => false
        );
      },
      {timeoutMs: 30000}
    );
    token = await loginAsUser(baseUrl, ADMIN_EMAIL);
    const groups = await get<{id: string; name: string}[]>("/groups");
    mainGroupId = groups.find((g) => g.name === "test-harness-group")!.id;
  }, 40000);

  afterAll(async () => {
    // Stop the watch process and its server before removing their database/files.
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const closed = new Promise<void>((resolve) => server.once("close", () => resolve()));
      process.kill(-server.pid, "SIGKILL");
      await closed;
    }
    for (const runDir of runDirs) {
      const pid = await fs.readFile(path.join(runDir, "run.pid"), "utf8").catch(() => "");
      if (Number(pid) > 1) {
        try {
          process.kill(-Number(pid), "SIGKILL");
        } catch {}
      }
    }
    if (executableDir) await fs.rm(executableDir, {recursive: true, force: true});
    if (dir) await fs.rm(dir, {recursive: true, force: true});
    if (ownsDatabase) {
      await clearHarnessDatabase();
      await reloadAppConfig();
    }
  });

  const requestFeature = async (name: string, request: string): Promise<HarnessFeature> => {
    const res = await fetch(`${baseUrl}/test/llm-fixtures`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name,
        match: {groupId: mainGroupId, pattern: name},
        response: "Feature requested",
        consumeOnce: true,
        actions: [
          {
            tool: "create_feature",
            args: {name, repo: "reading-room", request, senderExternalId: "harness-user"},
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    await sendCommand(baseUrl, token, `Create ${name}`, {groupId: mainGroupId});
    let feature: HarnessFeature | undefined;
    await waitFor(async () => {
      await tickHarness(baseUrl, token, "all");
      feature = (await get<HarnessFeature[]>(`/features?name=${name}`))[0];
      return Boolean(feature?.brewery);
    });
    runDirs.push(
      path.join(feature!.brewery.workspace.repoPath, ".terreno/brewery", feature!.brewery.slug)
    );
    return feature!;
  };

  test("request → plan → ok → live progress edit → PR and completion, without a feature agent", async () => {
    const request = "Add a quiet reading room. Preserve café & 'quotes'.";
    const feature = await requestFeature("feat-reading-room-success", request);
    const runDir = runDirs[0]!;
    expect(await fs.readFile(path.join(runDir, "request.md"), "utf8")).toBe(request);
    await waitFor(
      async () =>
        (await get<HarnessFeature>(`/features/${feature.id}`)).status === "awaiting_approval"
    );
    const planPosts = await getOutbox(baseUrl, token, {groupId: feature.groupId});
    const plan = planPosts.find((m) => m.content.includes("Plan summary:"));
    expect(plan?.content).toContain("Add a quiet reading room.");
    expect(plan?.content).toContain("- [ ] T1 Add the reading room");
    expect(plan?.content).toContain("Reply `ok`, `ok, 2b`, or `no: <why>`");
    expect(planPosts.some((m) => m.content.includes("T1 pick") || m.content.includes("PR #"))).toBe(
      false
    );
    expect(
      (await fs.readFile(path.join(runDir, "invocations.jsonl"), "utf8")).trim().split("\n")
    ).toHaveLength(1);

    await sendCommand(baseUrl, token, "ok", {groupId: feature.groupId});
    await tickHarness(baseUrl, token, "messageLoop");
    await waitFor(async () =>
      (await getOutbox(baseUrl, token, {groupId: feature.groupId})).some(
        (m) => m.content === "▸ T1 pick (fake)\nBuilding the quiet reading room"
      )
    );
    expect(
      (await getOutbox(baseUrl, token, {groupId: feature.groupId})).filter(
        (m) => m.content === "Reply sent to brewery."
      )
    ).toHaveLength(1);
    const live = (await getOutbox(baseUrl, token, {groupId: feature.groupId})).find((m) =>
      m.content.startsWith("▸ T1 pick")
    )!;
    await fs.writeFile(path.join(runDir, "finish"), "");
    await waitFor(
      async () => (await get<HarnessFeature>(`/features/${feature.id}`)).status === "complete"
    );
    const posts = await getOutbox(baseUrl, token, {groupId: feature.groupId});
    expect(posts.find((m) => m.id === live.id)?.content).toBe(
      "✓ T1 pick PASS in 2s: Reading room ready\nBuilding the quiet reading room"
    );
    expect(posts.filter((m) => m.content.includes("T1 pick"))).toHaveLength(1);
    expect(
      posts.filter((m) => m.content === "PR #42: https://example.invalid/reading-room/pull/42")
    ).toHaveLength(1);
    expect(posts.at(-1)?.content).toBe("Brewery complete: feat-reading-room-success — PR #42.");
    const complete = await get<HarnessFeature>(`/features/${feature.id}`);
    expect(complete.brewery.phase).toBe("done");
    expect(complete.brewery.pr).toBe(42);
    expect(await get<unknown[]>(`/taskRunLogs?groupId=${feature.groupId}`)).toHaveLength(0);
    expect(posts.some((m) => m.content.includes("[mock]"))).toBe(false);
  }, 30000);

  test("CLI error is posted with recovery logs and never falls back to an agent", async () => {
    const feature = await requestFeature("feat-reading-room-error", "Simulate brewery failure");
    await waitFor(
      async () => (await get<HarnessFeature>(`/features/${feature.id}`)).status === "error"
    );
    const posts = await getOutbox(baseUrl, token, {groupId: feature.groupId});
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toContain("Brewery failed: Fake brewery failed deliberately");
    expect(posts[0]!.content).toContain(`/brewery/${feature.brewery.slug}/launch.log`);
    expect(await get<unknown[]>(`/taskRunLogs?groupId=${feature.groupId}`)).toHaveLength(0);
  }, 20000);
});
