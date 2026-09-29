import path from "node:path";
import {WebClient} from "@slack/web-api";
import {logger} from "@terreno/api";
import {z} from "zod";
import {loadAppConfig} from "../../models/appConfig";
import {Channel} from "../../models/channel";
import {Feature} from "../../models/feature";
import {Group} from "../../models/group";
import {breweryHarnessTransport} from "../../testMode/breweryTransport";
import {isTestMode} from "../../testMode/flag";
import type {FeatureDocument} from "../../types/models/featureTypes";
import type {GroupDocument} from "../../types/models/groupTypes";
import {defaultExec, type ExecFn, shellQuote, withSshHost} from "../hostExec";

const seq = z.number().int().nonnegative();
const eventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("step.start"),
    seq,
    stage: z.string(),
    task: z.string().optional(),
    agent: z.string(),
  }),
  z.object({
    kind: z.literal("step.end"),
    seq,
    status: z.string(),
    action: z.string(),
    seconds: z.number(),
  }),
  z.object({kind: z.literal("narration"), seq, text: z.string()}),
  z.object({
    kind: z.literal("waiting"),
    waitingKind: z.enum(["signoff", "gate"]),
    message: z.string(),
    ip: z.string().optional(),
  }),
  z.object({kind: z.literal("pr"), number: z.number().int().positive(), url: z.string().url()}),
  z.object({kind: z.literal("error"), message: z.string()}),
  z.object({kind: z.literal("ci"), state: z.enum(["pass", "fail", "pending"])}),
  z.object({kind: z.literal("note"), text: z.string()}),
  z.object({kind: z.literal("resumed")}),
  z.object({kind: z.literal("done")}),
]);
type Event = z.infer<typeof eventSchema>;
interface Transport {
  post: (group: GroupDocument, text: string) => Promise<string>;
  update: (group: GroupDocument, ts: string, text: string) => Promise<void>;
}

// Workers need only Slack's HTTP API, never a second Socket Mode connection.
const slackClient = async (group: GroupDocument): Promise<WebClient> => {
  if (isTestMode()) throw new Error("Real brewery Slack transport disabled in test mode");
  const channel = await Channel.findOneOrNone({_id: group.channelId, type: "slack"});
  const token = (channel?.config as {botToken?: string} | undefined)?.botToken;
  if (!token) throw new Error("Brewery feature channel has no Slack token");
  const config = await loadAppConfig();
  return new WebClient(token, {timeout: config.zerg.upTimeoutMs, retryConfig: {retries: 0}});
};
const slackTransport: Transport = {
  post: async (group, text) => {
    const result = await (await slackClient(group)).chat.postMessage({
      channel: group.externalId,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!result.ts) throw new Error("Slack did not return a message timestamp");
    return result.ts;
  },
  update: async (group, ts, text) => {
    await (await slackClient(group)).chat.update({channel: group.externalId, ts, text});
  },
};

/** One sequential, restartable events reader per worker process. */
export class BreweryPoller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private ticking = false;
  private pending: Promise<void> = Promise.resolve();
  constructor(
    private readonly options: {
      transport?: Transport;
      exec?: ExecFn;
      loadConfig?: typeof loadAppConfig;
      now?: () => number;
    } = {}
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    let interval = (await (this.options.loadConfig ?? loadAppConfig)()).brewery.pollIntervalMs;
    this.running = true;
    const loop = async () => {
      try {
        await this.tick();
        interval = (await (this.options.loadConfig ?? loadAppConfig)()).brewery.pollIntervalMs;
      } catch {
        logger.warn("Brewery polling failed; retrying next tick");
      }
      if (!this.running) return;
      this.timer = setTimeout(() => {
        this.pending = loop();
      }, interval);
    };
    this.pending = loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.pending;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const config = await (this.options.loadConfig ?? loadAppConfig)();
      const now = this.options.now ?? Date.now;
      const candidates = await Feature.find({
        brewery: {$exists: true},
        status: {$in: ["in_progress", "awaiting_approval"]},
      }).select("_id");
      for (const candidate of candidates) {
        // Atomic lease also protects overlap during gateway/worker rollout.
        const leaseMs = Math.max(config.zerg.upTimeoutMs, config.brewery.pollIntervalMs) * 3;
        const feature = await Feature.findOneAndUpdate(
          {
            _id: candidate._id,
            status: {$in: ["in_progress", "awaiting_approval"]},
            $or: [
              {"brewery.pollLeaseUntil": {$exists: false}},
              {"brewery.pollLeaseUntil": {$lte: new Date(now())}},
            ],
          },
          {$set: {"brewery.pollLeaseUntil": new Date(now() + leaseMs)}},
          {new: true}
        );
        if (!feature) continue;
        try {
          await this.poll(feature, config, now, leaseMs);
        } catch {
          // Don't log OS/Slack payloads: they can carry request text or credentials.
          logger.warn(`Brewery poll failed for feature ${feature._id}; offset retained for retry`);
        } finally {
          await Feature.updateOne({_id: feature._id}, {$unset: {"brewery.pollLeaseUntil": 1}});
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async poll(
    feature: FeatureDocument,
    config: Awaited<ReturnType<typeof loadAppConfig>>,
    now: () => number,
    leaseMs: number
  ): Promise<void> {
    const state = feature.brewery!;
    const group = await Group.findOneOrNone({_id: feature.groupId, featureDriver: "brewery"});
    if (!group) return;
    const transport =
      this.options.transport ?? (isTestMode() ? breweryHarnessTransport : slackTransport);
    const runDir = path.posix.join(".terreno/brewery", state.slug);
    const workspace = state.workspace;
    const exec = async (script: string) => {
      const argv =
        workspace.kind === "local"
          ? ["sh", "-c", `cd ${shellQuote(workspace.repoPath)} && ${script}`]
          : withSshHost(
              ["docker", "exec", "-w", config.zerg.workdir, workspace.session, "sh", "-c", script],
              config.zerg.sshHost
            );
      const result = await (this.options.exec ?? defaultExec)(argv, {
        timeoutMs: config.zerg.upTimeoutMs,
      });
      if (result.code !== 0) throw new Error("Brewery workspace read failed");
      return result.stdout;
    };
    const save = async () => {
      state.pollLeaseUntil = new Date(now() + leaseMs);
      feature.markModified("brewery");
      await feature.save();
    };
    const file = shellQuote(`${runDir}/events.jsonl`);
    // Read through the last newline only. Incomplete UTF-8/JSON is reread on the next poll.
    const raw = await exec(
      `if [ -f ${file} ]; then tail -c +${state.eventsOffset + 1} ${file}; fi`
    );
    const complete = raw.slice(0, raw.lastIndexOf("\n") + 1);
    for (const line of complete.split("\n").slice(0, -1)) {
      let event: Event;
      try {
        event = eventSchema.parse(JSON.parse(line));
      } catch {
        throw new Error("Invalid brewery event record");
      }
      const step =
        "seq" in event ? state.stepMessages.find((entry) => entry.seq === event.seq) : undefined;
      switch (event.kind) {
        case "step.start": {
          state.phase = event.stage;
          feature.status = "in_progress";
          state.waiting = undefined;
          if (!step) {
            const label = `${event.task ? `${event.task} ` : ""}${event.stage}`;
            const ts = await transport.post(group, `▸ ${label} (${event.agent})`);
            state.stepMessages.push({
              seq: event.seq,
              ts,
              label: `${label} (${event.agent})`,
              lines: [],
              flushedAt: new Date(now()),
            });
          }
          break;
        }
        case "narration":
          if (!step) throw new Error("Narration has no step message");
          step.lines = [...(step.lines ?? []), event.text.slice(0, 300)].slice(
            -config.brewery.maxNarrationLines
          );
          step.dirty = true;
          break;
        case "step.end":
          if (!step) throw new Error("Result has no step message");
          step.final = `${event.status === "PASS" ? "✓" : "✗"} ${(step.label ?? `Step ${event.seq}`).replace(/ \([^)]*\)$/, "")} ${event.status} in ${event.seconds}s: ${event.action}`;
          await transport.update(group, step.ts, [step.final, ...(step.lines ?? [])].join("\n"));
          step.dirty = false;
          step.flushedAt = new Date(now());
          break;
        case "waiting": {
          let plan = "";
          if (event.waitingKind === "signoff" && event.ip) {
            const root = workspace.kind === "local" ? workspace.repoPath : config.zerg.workdir;
            const relative = path.posix.relative(root, path.posix.resolve(root, event.ip));
            if (relative.startsWith("../") || relative === "..")
              throw new Error("Invalid plan path");
            const contents = await exec(`cat ${shellQuote(relative)}`);
            const summary =
              contents.match(
                /^## (?:Summary|Overview)\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/im
              )?.[1] ??
              contents.split(/^## /m)[0] ??
              "";
            const tasks = contents.split("\n").filter((line) => /^\s*- \[([ x])\]/.test(line));
            plan = `Plan summary:\n${summary.trim().slice(0, 4000)}\n\nTasks:\n${tasks.join("\n").slice(0, 24000)}`;
          }
          await transport.post(
            group,
            [
              event.message,
              plan,
              event.waitingKind === "signoff" ? "Reply `ok`, `ok, 2b`, or `no: <why>`" : "",
            ]
              .filter(Boolean)
              .join("\n\n")
          );
          state.waiting = {kind: event.waitingKind, since: new Date(now())};
          if (event.waitingKind === "signoff") feature.status = "awaiting_approval";
          break;
        }
        case "resumed":
          state.waiting = undefined;
          feature.status = "in_progress";
          await transport.post(group, "Brewery resumed.");
          break;
        case "pr":
          await transport.post(group, `PR #${event.number}: ${event.url}`);
          state.pr = event.number;
          break;
        case "done":
          await transport.post(
            group,
            `Brewery complete: ${feature.name}${state.pr ? ` — PR #${state.pr}` : ""}.`
          );
          feature.status = "complete";
          feature.completedAt = new Date(now());
          state.phase = "done";
          state.waiting = undefined;
          break;
        case "error":
          await transport.post(
            group,
            `Brewery failed: ${event.message}\nLogs: ${runDir}/launch.log and ${runDir}/steps/`
          );
          feature.status = "error";
          feature.errorMessage = event.message;
          state.waiting = undefined;
          break;
        case "ci":
          await transport.post(group, `Brewery CI: ${event.state}`);
          break;
        case "note":
          break; // CLI notes are acknowledged by the reply driver.
      }
      state.lastEventAt = new Date(now());
      state.eventsOffset += Buffer.byteLength(`${line}\n`);
      await save();
    }
    for (const step of state.stepMessages) {
      if (!step.dirty || now() - (step.flushedAt?.getTime() ?? 0) < config.brewery.narrationFlushMs)
        continue;
      await transport.update(
        group,
        step.ts,
        [step.final ?? `▸ ${step.label}`, ...(step.lines ?? [])].join("\n")
      );
      step.dirty = false;
      step.flushedAt = new Date(now());
      await save();
    }
    const stateFile = shellQuote(`${runDir}/state.json`);
    const snapshot = await exec(`if [ -f ${stateFile} ]; then cat ${stateFile}; fi`);
    if (snapshot) {
      const phase = z.object({phase: z.string()}).parse(JSON.parse(snapshot)).phase;
      if (state.phase !== phase) {
        state.phase = phase;
        await save();
      }
    }
    if (state.waiting || feature.status !== "in_progress") return;
    const last = state.lastEventAt ?? feature.startedAt;
    if (!last || now() - last.getTime() < config.brewery.stepSilenceAlertMin * 60_000) return;
    const pidFile = shellQuote(`${runDir}/run.pid`);
    const alive = await exec(
      `if [ -f ${pidFile} ]; then pid=$(cat ${pidFile}) || exit 1; case "$pid" in ''|*[!0-9]*) exit 1;; esac; if kill -0 "$pid" 2>/dev/null; then printf alive; fi; fi`
    );
    if (alive === "alive") return;
    await transport.post(
      group,
      `Brewery died during ${state.phase ?? "startup"}. Reply \`resume\` to continue. Logs: ${runDir}/launch.log`
    );
    feature.status = "error";
    feature.errorMessage = "Brewery died; resume the run to continue.";
    await save();
  }
}
