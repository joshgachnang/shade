import {afterEach, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import {AppConfig} from "../../models/appConfig";
import {Feature} from "../../models/feature";
import {Group} from "../../models/group";
import {BreweryPoller} from "./breweryPoller";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const fixture = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brewery-poll-"));
  const run = path.join(dir, ".terreno/brewery/example");
  await fs.mkdir(run, {recursive: true});
  const group = await Group.create({
    name: "Example",
    channelId: new mongoose.Types.ObjectId(),
    externalId: "channel",
    folder: `poll-${path.basename(dir)}`,
    featureDriver: "brewery",
  });
  const feature = await Feature.create({
    name: "Example",
    groupId: group._id,
    status: "in_progress",
    startedAt: new Date(),
    brewery: {
      slug: "example",
      repo: "example",
      workspace: {kind: "local", repoPath: dir},
      eventsOffset: 0,
      stepMessages: [],
    },
  });
  cleanups.push(async () => {
    await feature.deleteOne();
    await group.deleteOne();
    await fs.rm(dir, {recursive: true, force: true});
  });
  const config = new AppConfig({brewery: {maxNarrationLines: 2, narrationFlushMs: 4000}});
  let now = Date.now();
  const messages: string[] = [];
  const edits: string[] = [];
  const options = {
    loadConfig: async () => config,
    now: () => now,
    transport: {
      post: async (_group: unknown, text: string) => {
        messages.push(text);
        return String(messages.length);
      },
      update: async (_group: unknown, ts: string, text: string) => {
        edits.push(text);
        messages[Number(ts) - 1] = text;
      },
    },
  };
  const append = async (...events: object[]) =>
    fs.appendFile(
      path.join(run, "events.jsonl"),
      events
        .map((event) => `${JSON.stringify({t: new Date(now).toISOString(), ...event})}\n`)
        .join("")
    );
  return {
    dir,
    run,
    feature,
    group,
    config,
    messages,
    edits,
    options,
    append,
    advance: (ms: number) => {
      now += ms;
    },
    fresh: async () => (await Feature.findById(feature._id))!,
  };
};

test("polls byte offsets, edits one step message and restores it after restart", async () => {
  const f = await fixture();
  const poller = new BreweryPoller(f.options);
  await f.append({kind: "step.start", seq: 1, stage: "roast", task: "T2", agent: "claude"});
  await poller.tick();
  expect(f.messages).toEqual(["▸ T2 roast (claude)"]);
  await f.append(
    {kind: "narration", seq: 1, text: "café"},
    {kind: "narration", seq: 1, text: "two"},
    {kind: "narration", seq: 1, text: "three"}
  );
  await poller.tick();
  expect(f.edits).toHaveLength(0);
  f.advance(4000);
  await new BreweryPoller(f.options).tick();
  expect(f.messages).toEqual(["▸ T2 roast (claude)\ntwo\nthree"]);
  await f.append({kind: "step.end", seq: 1, status: "PASS", seconds: 312, action: "Continue"});
  await poller.tick();
  expect(f.messages).toEqual(["✓ T2 roast PASS in 312s: Continue\ntwo\nthree"]);
  expect((await f.fresh()).brewery?.eventsOffset).toBe(
    (await fs.stat(path.join(f.run, "events.jsonl"))).size
  );
  await poller.tick();
  expect(f.messages).toHaveLength(1);
});

test("partial UTF-8 records wait for newline; empty/missing streams do nothing", async () => {
  const f = await fixture();
  const poller = new BreweryPoller(f.options);
  await poller.tick();
  expect(f.messages).toEqual([]);
  const file = path.join(f.run, "events.jsonl");
  const record = Buffer.from(
    `${JSON.stringify({kind: "step.start", seq: 1, stage: "café", agent: "codex"})}\n`
  );
  const cut = record.indexOf(Buffer.from("é")) + 1;
  await fs.writeFile(file, record.subarray(0, cut));
  await poller.tick();
  expect((await f.fresh()).brewery?.eventsOffset).toBe(0);
  await fs.appendFile(file, record.subarray(cut));
  await poller.tick();
  expect(f.messages).toEqual(["▸ café (codex)"]);
  expect((await f.fresh()).brewery?.eventsOffset).toBe(record.length);
});

test("sign-off includes the IP summary/tasks, gates retain options, resumed clears waiting, PR/done complete", async () => {
  const f = await fixture();
  const poller = new BreweryPoller(f.options);
  const ip = path.join(f.dir, "plan.md");
  await fs.writeFile(
    ip,
    "# Example\n\nBuild an example.\n\n## Design\nImplementation details\n\n## Tasks\n- [ ] T1: Build\n- [ ] T2: Verify\n"
  );
  await f.append({kind: "waiting", waitingKind: "signoff", message: "Approve this plan", ip});
  await poller.tick();
  expect(f.messages[0]).toContain("Build an example.");
  expect(f.messages[0]).toContain("T2: Verify");
  expect(f.messages[0]).not.toContain("Implementation details");
  expect(f.messages[0]).toContain("Reply `ok`, `ok, 2b`, or `no: <why>`");
  expect((await f.fresh()).status).toBe("awaiting_approval");
  f.advance(31 * 60_000);
  await poller.tick();
  expect(f.messages).toHaveLength(1);
  await f.append(
    {kind: "resumed"},
    {kind: "waiting", waitingKind: "gate", message: "Choose: a) retry b) stop"}
  );
  await poller.tick();
  expect(f.messages.at(-1)).toContain("a) retry b) stop");
  expect((await f.fresh()).brewery?.waiting?.kind).toBe("gate");
  await f.append(
    {kind: "resumed"},
    {kind: "pr", number: 42, url: "https://example.invalid/pull/42"},
    {kind: "ci", state: "pass"},
    {kind: "done"}
  );
  await poller.tick();
  const saved = await f.fresh();
  expect(saved.status).toBe("complete");
  expect(saved.brewery?.pr).toBe(42);
  expect(saved.brewery?.prUrl).toBe("https://example.invalid/pull/42");
  expect(saved.brewery?.waiting).toBeUndefined();
  expect(saved.completedAt).toBeInstanceOf(Date);
  expect(f.messages).toContain("PR #42: https://example.invalid/pull/42");
  expect(f.messages.at(-1)).toBe("Brewery complete: Example — PR #42.");
});

test("Slack failures retain the event offset and retry; failed final edit uses the original message", async () => {
  const f = await fixture();
  const poller = new BreweryPoller({
    ...f.options,
    transport: {
      ...f.options.transport,
      post: async () => {
        throw new Error("unavailable");
      },
    },
  });
  await f.append({kind: "step.start", seq: 1, stage: "pick", agent: "codex"});
  await poller.tick();
  expect((await f.fresh()).brewery?.eventsOffset).toBe(0);
  const good = new BreweryPoller(f.options);
  await good.tick();
  const offset = (await f.fresh()).brewery!.eventsOffset;
  await f.append({kind: "step.end", seq: 1, status: "FAIL", seconds: 2, action: "Fix tests"});
  await new BreweryPoller({
    ...f.options,
    transport: {
      ...f.options.transport,
      update: async () => {
        throw new Error("unavailable");
      },
    },
  }).tick();
  expect((await f.fresh()).brewery!.eventsOffset).toBe(offset);
  await good.tick();
  expect(f.messages).toEqual(["✗ pick FAIL in 2s: Fix tests"]);
});

test("error events post the failure with logs and persist error status", async () => {
  const f = await fixture();
  await f.append({kind: "error", message: "Tests failed"});
  await new BreweryPoller(f.options).tick();
  expect(f.messages[0]).toContain("Tests failed");
  expect(f.messages[0]).toContain(".terreno/brewery/example/steps/");
  expect((await f.fresh()).status).toBe("error");
});

test("dead-run alert requires silence and a missing pid, is sent once, and covers startup with no events", async () => {
  const f = await fixture();
  const poller = new BreweryPoller(f.options);
  await fs.writeFile(path.join(f.run, "run.pid"), String(process.pid));
  f.advance(31 * 60_000);
  await poller.tick();
  expect(f.messages).toEqual([]);
  await fs.unlink(path.join(f.run, "run.pid"));
  await poller.tick();
  await poller.tick();
  expect(f.messages).toHaveLength(1);
  expect(f.messages[0]).toContain("Brewery died");
  expect(f.messages[0]).toContain("`resume`");
  expect((await f.fresh()).status).toBe("error");
});

test("malformed complete records and workspace errors retain offsets without a false dead-run notice", async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.run, "events.jsonl"), "not-json\n");
  await new BreweryPoller(f.options).tick();
  expect((await f.fresh()).brewery?.eventsOffset).toBe(0);
  f.advance(31 * 60_000);
  await new BreweryPoller({
    ...f.options,
    exec: async () => ({code: 1, stdout: "", stderr: "private output"}),
  }).tick();
  expect((await f.fresh()).status).toBe("in_progress");
  expect(f.messages).toEqual([]);
});

test("overlapping worker polls do not duplicate a step", async () => {
  const f = await fixture();
  await f.append({kind: "step.start", seq: 1, stage: "distill", agent: "claude"});
  await Promise.all([new BreweryPoller(f.options).tick(), new BreweryPoller(f.options).tick()]);
  expect(f.messages).toEqual(["▸ distill (claude)"]);
});

test.each([
  "",
  "remote-host",
])("zerg reads events and IP through configured host/workdir: %s", async (host) => {
  const f = await fixture();
  f.config.zerg.sshHost = host;
  f.config.zerg.workdir = "/workspace";
  f.feature.brewery!.workspace = {kind: "zerg", session: "example-session"};
  await f.feature.save();
  const calls: string[][] = [];
  await new BreweryPoller({
    ...f.options,
    exec: async (argv) => {
      calls.push(argv);
      return {
        code: 0,
        stderr: "",
        stdout:
          calls.length === 3
            ? ""
            : calls.length === 1
              ? `${JSON.stringify({
                  kind: "waiting",
                  waitingKind: "signoff",
                  message: "Approve",
                  ip: "/workspace/plan.md",
                })}\n`
              : "# Plan\nSummary\n## Tasks\n- [ ] T1: Ship",
      };
    },
  }).tick();
  expect(f.messages[0]).toContain("T1: Ship");
  expect(calls).toHaveLength(3);
  const command = calls[0]!.join(" ");
  expect(command).toContain("example-session");
  expect(command).toContain("/workspace");
  expect(command).toContain("tail -c +1");
  expect(calls[0]![0]).toBe(host ? "ssh" : "docker");
  if (host) expect(calls[0]![4]).toBe(host);
});

test("a missing plan retries sign-off; relative IP and state phase are read on recovery", async () => {
  const f = await fixture();
  await f.append({kind: "waiting", waitingKind: "signoff", message: "Approve", ip: "plan.md"});
  const poller = new BreweryPoller(f.options);
  await poller.tick();
  expect((await f.fresh()).brewery?.eventsOffset).toBe(0);
  expect(f.messages).toEqual([]);
  await fs.writeFile(
    path.join(f.dir, "plan.md"),
    "# Plan\n## Summary\nA summary\n## Tasks\n- [ ] T1: Verify"
  );
  await fs.writeFile(path.join(f.run, "state.json"), JSON.stringify({phase: "approved"}));
  await poller.tick();
  expect(f.messages[0]).toContain("A summary");
  expect((await f.fresh()).brewery?.phase).toBe("approved");
});

test("legacy groups and completed features are ignored; a held lease expires", async () => {
  const f = await fixture();
  const poller = new BreweryPoller(f.options);
  await f.append({kind: "step.start", seq: 1, stage: "distill", agent: "claude"});
  await Group.updateOne({_id: f.group._id}, {$unset: {featureDriver: 1}});
  await poller.tick();
  expect(f.messages).toEqual([]);
  await Group.updateOne({_id: f.group._id}, {$set: {featureDriver: "brewery"}});
  await Feature.updateOne({_id: f.feature._id}, {$set: {status: "complete"}});
  await poller.tick();
  expect(f.messages).toEqual([]);
  await Feature.updateOne(
    {_id: f.feature._id},
    {$set: {status: "in_progress", "brewery.pollLeaseUntil": new Date(Date.now() + 60_000)}}
  );
  await poller.tick();
  expect(f.messages).toEqual([]);
  f.advance(61_000);
  await poller.tick();
  expect(f.messages).toEqual(["▸ distill (claude)"]);
});

test("loop repeats at the configured interval and drains an in-flight delivery on stop", async () => {
  const f = await fixture();
  f.config.brewery.pollIntervalMs = 10;
  let notifyPost!: () => void;
  let notifyEdit!: () => void;
  let releaseEdit!: () => void;
  const posted = new Promise<void>((resolve) => {
    notifyPost = resolve;
  });
  const editing = new Promise<void>((resolve) => {
    notifyEdit = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseEdit = resolve;
  });
  const poller = new BreweryPoller({
    ...f.options,
    transport: {
      post: async (group, text) => {
        const ts = await f.options.transport.post(group, text);
        notifyPost();
        return ts;
      },
      update: async (group, ts, text) => {
        notifyEdit();
        await release;
        await f.options.transport.update(group, ts, text);
      },
    },
  });
  try {
    await f.append({kind: "step.start", seq: 1, stage: "distill", agent: "claude"});
    await poller.start();
    await poller.start();
    await posted;
    // This event cannot have been read by the pass that posted the start.
    await f.append({kind: "step.end", seq: 1, status: "PASS", seconds: 1, action: "Approve"});
    await editing;
    let stopped = false;
    const stopping = poller.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseEdit();
    await stopping;
    expect(f.messages).toEqual(["✓ distill PASS in 1s: Approve"]);
    expect((await f.fresh()).brewery?.stepMessages[0]?.ts).toBe("1");
  } finally {
    releaseEdit();
    await poller.stop();
  }
});

test("stopped features retain their cursor and status even with unread step events", async () => {
  const f = await fixture();
  await f.append({kind: "step.start", seq: 1, stage: "pick", task: "T9", agent: "codex"});
  const {BreweryDriver} = await import("./breweryDriver");
  await new BreweryDriver({
    loadConfig: f.options.loadConfig,
    sendMessage: async () => {},
  }).handleMessage(f.group, {content: "stop"});
  await new BreweryPoller(f.options).tick();
  expect((await f.fresh()).status).toBe("paused");
  expect((await f.fresh()).brewery?.eventsOffset).toBe(0);
  expect(f.messages).toEqual([]);
});

test("a stop between candidate discovery and lease acquisition cannot be undone by polling", async () => {
  const first = await fixture();
  const second = await fixture();
  // Both candidates are discovered together; hold delivery for the first at the Slack boundary.
  await first.append({kind: "step.start", seq: 1, stage: "pick", agent: "codex"});
  await second.append({kind: "step.start", seq: 1, stage: "pick", agent: "codex"});
  let entered!: () => void;
  let release!: () => void;
  const posting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const postedGroups: string[] = [];
  const poller = new BreweryPoller({
    ...first.options,
    transport: {
      ...first.options.transport,
      post: async (group) => {
        postedGroups.push(String(group._id));
        if (String(group._id) === String(first.group._id)) {
          entered();
          await blocked;
        }
        return "1";
      },
    },
  });
  const tick = poller.tick();
  try {
    await posting;
    const {BreweryDriver} = await import("./breweryDriver");
    await new BreweryDriver({
      loadConfig: second.options.loadConfig,
      sendMessage: async () => {},
    }).handleMessage(second.group, {content: "stop"});
  } finally {
    release();
  }
  await tick;
  expect((await second.fresh()).status).toBe("paused");
  expect((await second.fresh()).brewery?.eventsOffset).toBe(0);
  expect(postedGroups).toEqual([String(first.group._id)]);
});
