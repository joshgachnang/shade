# Architecture Assessment & Hermes Agent Comparison

*Written July 2026. Evaluates Shade's architecture against its goal and against Nous Research's Hermes Agent.*

**The goal:** an autonomous agent that (1) runs cron jobs as agent tasks, (2) builds software, (3) performs advanced requests with sets of sub-agents working together, and (4) pulls information from the user, iMessage, email, etc. and takes actions against all of them.

## Verdict in one paragraph

Shade's core pipeline — channel connectors → `Message` → `MessageLoop` → per-group queue → Claude Agent SDK runner → IPC → outbound — is the right shape and worth keeping. It already delivers goals 1 and 4 credibly. The two real gaps against the goal are **multi-agent coordination** (goal 3: originally none — agents were strictly sequential per group; since addressed by IP-009 — see gap #1 below) and **durable memory/learning** (context is a 2-hour message window plus a static per-group `CLAUDE.md`; since addressed by IP-008 — see gap #2 below). A third, structural risk was that **everything ran in one process**, so a watchdog restart killed in-flight agent runs, radio transcription, and movie processing together (since addressed by IP-010 — see gap #4 below). None of this requires a rewrite; it requires adding a coordination layer and a memory layer to an otherwise sound foundation — and Hermes Agent is a good source of proven designs for both.

## What Shade gets right

- **Channel abstraction.** One `ChannelConnector` interface, five transports, one send path. Adding a channel is additive. The rich-response schema (see `research.md`) layers on cleanly.
- **Scheduler-as-synthetic-message.** A due `ScheduledTask` becomes a normal agent turn through the same queue, trigger, audit, and delivery machinery. This is exactly how Hermes models cron ("cron jobs are agent tasks, not shell scripts") — Shade independently landed on the right design.
- **Ops discipline.** `AppConfig` for all runtime config with an admin UI, `AIRequest` cost tracking per LLM call, `TaskRunLog` per task run, admin scripts for status/spend/key-testing. Hermes is notably weaker here (config split across YAML/env, no cost ledger).
- **Local-first iMessage.** The edge-agent design (registered, approved, heartbeating daemon on a Mac with encrypted secrets) keeps iMessage fully under your control. Hermes's iMessage goes through Photon Spectrum, a third-party hosted line pool — a privacy trade-off Shade doesn't make.
- **Session resume.** `AgentSession` checkpoints (`resumeSessionAt`) let timed-out SDK runs continue instead of restarting.

## Gaps against the goal

### 1. Sub-agents working together (the big one) — ✅ addressed (IP-009)

*Original gap:* there was no multi-agent layer. `GroupQueue` ran one agent per group at a time; "collaboration" was limited to whatever the Claude Agent SDK did inside a single turn. There was no durable task board, no worker identity, no way for a long job to be decomposed, claimed, retried, or survive a process restart.

Hermes's answer, worth copying nearly wholesale: a **Kanban task model** — durable tasks with states, worker heartbeats, reclaim of tasks from dead workers, zombie detection, per-task retry budgets, and an output-verification gate — plus `delegate_task(background=true)` for spawning concurrent background workers. Shade already had the primitives (Mongo models, `TaskRunLog`, edge-agent heartbeat code that could be generalized to workers).

**Shipped as IP-009** (see `docs/implementationPlans/Agent-Task-Board.md`), closely following the recommendation:
1. A durable `AgentTask` board — claimable (atomic `findOneAndUpdate`, Mongo is the queue), heartbeated, reclaimed from dead workers, with per-task retry budgets (`attempts`/`maxAttempts`) and cancellation (`cancelRequested`, honored between heartbeats).
2. An in-process `TaskWorkerService` worker pool (`AppConfig.taskWorker`: enabled/concurrency/poll/heartbeat/stale/timeout) that runs board tasks through `DirectAgentRunner` outside GroupQueue; every attempt is audited in `TaskRunLog` (`trigger: "delegated"`).
3. `delegate_task` / `get_task_result` / `list_agent_tasks` / `cancel_agent_task` MCP tools (one-level depth limit; optional `deliverResult` posts to the group channel) plus a system-prompt delegation block, and Claude Agent SDK subagents enabled in `DirectAgentRunner` (`agent.enableSubagents`) for intra-turn parallelism.

*Still future:* remote workers and the HTTP claim protocol (out-of-process same-host workers shipped as IP-010 — see gap #4), delegation trees/DAGs, cross-group tasks, and Hermes's output-verification ("hallucination gate") step.

### 2. Memory and learning — ✅ addressed (IP-008)

*Original gap:* per-turn context was the last ~2 hours of messages plus a static group `CLAUDE.md` and manual `save_data` blobs. Nothing was learned across sessions; nothing older than 2 hours was retrievable; there was no model of the user.

Hermes's signature feature is the closed learning loop: small curated memory docs (`MEMORY.md` ~800 tokens, `USER.md` ~500 tokens), **full-text search over all past session transcripts** (SQLite FTS5 + LLM summarization at query time), and **agent-authored skill documents** persisted after hard problems. Nous claims large speedups from accumulated skills; directionally this matches what we'd expect.

**Shipped as IP-008** (see `docs/implementationPlans/Agent-Memory-And-Learning.md`), closely following the recommendation:
1. `search_history` MCP tool over a Mongo text index on `Message.content` (per group, default 90 days, capped by `AppConfig.memory.historySearchLimit`).
2. Agent-curated memory via `update_memory` — global/group `CLAUDE.md` plus a global `USER.md` user profile (main-group-only writes for global/user), all char-budgeted and loaded into the system prompt.
3. A global skills directory (`SHADE_DATA_DIR/skills/`) the agent writes with `save_skill` after solving novel problems, surfaced as a name + description index in the system prompt and loaded progressively via `list_skills` / `load_skill`. A memory prompt block teaches when to use each tool; `AppConfig.memory.enabled` gates it all.

*Still future:* transcript-file (JSONL) search, embeddings/semantic search, per-group skills, and automatic post-task "should I save a skill?" reflection.

### 3. Software building

Feature channels (OpenAI planner → `/implement` → Claude SDK) are a reasonable v1, but implementation runs inside the orchestrator process on the production server with no filesystem isolation, and long builds fight the timeout/`maxResumes` ceiling.

**Recommendation:** run implementing-phase agents in git worktrees (or containers) via the worker pool from gap 1, so builds are isolated, parallelizable, and survive orchestrator restarts. Reconsider whether the OpenAI planner still earns its keep versus a second Claude configuration — it's the only reason there are two runner code paths.

### 4. Process architecture — ✅ addressed (IP-010)

*Original gap:* one process hosted the orchestrator, all channel connectors, ffmpeg radio streaming, movie processing, and every agent run. The external watchdog's restart was a blunt instrument: it killed healthy in-flight work to fix a stuck Slack socket. The recommendation — Hermes's gateway-daemon vs. execution-backend split — was to keep orchestrator/channels in the main service and move agent execution to worker processes, so a gateway restart costs nothing in-flight.

**Shipped as IP-010** (see `docs/implementationPlans/Gateway-Worker-Split.md`), closely following the recommendation:
1. A second entrypoint, `backend/src/workerMain.ts` (`bun run worker`, deployed as `shade-worker.service`), sharing the gateway's boot path via `backend/src/boot.ts` and running `TaskWorkerService` against the same Mongo board — with a `/health` endpoint (`WORKER_PORT`, default 4021) and SIGTERM/SIGINT drain (finish in-flight tasks up to `taskTimeoutMs`, abort stragglers for stale-heartbeat reclaim).
2. Cross-process result delivery through the filesystem: worker-run agents write `send_message` IPC files that the gateway's `IpcWatcher` delivers — results queue on disk across gateway restarts; no HTTP worker protocol needed on one host.
3. A flag-gated, step-reversible rollout: `taskWorker.runInGateway` (default true) keeps the in-process pool until workers are deployed; `scheduler.useTaskBoard` (default false) routes scheduled runs through the board (`AgentTask {deliverResult: true, scheduledTaskId}`) so the long-running jobs land on workers. The watchdog restarts only the gateway (workers intentionally out of scope), and the `systemStatus` script shows active workers and board counts.

*Still future:* remote/multi-host workers (requires the HTTP claim protocol), moving movie processing and radio streaming out of the gateway, and interactive turns on workers.

### Smaller items — ✅ addressed (IP-011)

*Original gap:* email reply threading was incomplete (`channels/email.ts` TODO) — replies didn't go back to the original sender's thread; the scheduler's fixed 5-minute tick was fine for digests but too coarse for "remind me in 2 minutes"; and model routing was coarse (global + feature-phase) — `Group.modelConfig` existed but wasn't honored, and the cheap-model tier existed only ad hoc (Haiku for trivia detection).

**Shipped as IP-011** (see `docs/implementationPlans/Channel-Scheduler-Polish.md`), closely following the recommendation:
1. **Email threading**: inbound emails persist `metadata: {emailMessageId, from, subject, references}`; replies resolve the most recent inbound email in the group and go back to its sender with `In-Reply-To`/`References` chains and a `Re:` subject, falling back to the configured recipient when no metadata exists (which also covers all pre-existing messages — no backfill).
2. **Adaptive scheduler tick**: the fixed `setInterval` is now a self-re-arming `setTimeout` chain sleeping `clamp(min(nextRunAt) − now, 5 s, pollIntervals.scheduler)` (empty board → max), plus a `wake()` called from the IPC task-mutation handlers — so "remind me in 2 minutes" fires on time and a far-future task doesn't cause busy polling.
3. **Model routing**: `Group.modelConfig.defaultModel` is honored end-to-end via `resolveModel()` (group override → new `AppConfig.agent.model` global default → SDK default), with the resolved model consistently logged to `AIRequest`/`TaskRunLog`; the cheap tier is formalized as `AppConfig.agent.auxiliaryModel` (default Haiku), adopted first by the trivia detector.

*Still future:* full multi-thread email conversations (multiple interleaved threads per group), HTML bodies and inbound attachments, sub-second scheduler precision, and per-task model overrides / automatic fallback chains (Hermes-style).

## Shade vs. Hermes Agent, head to head

Hermes Agent (github.com/NousResearch/hermes-agent, MIT, ~208k stars, v0.18.0 as of July 2026) is the same product category: self-hosted personal autonomous agent with cron, sub-agents, and messaging surfaces.

| Dimension | Shade | Hermes |
|---|---|---|
| Cron agents | ✅ Same design (task → agent turn), Mongo-backed, audited | ✅ Fresh isolated session per job, 60s tick, deliver-to-any-channel |
| Sub-agents | ✅ Durable AgentTask board w/ heartbeats & reclaim + worker processes + SDK subagents (IP-009/IP-010) | ✅ Background worker fleet + Kanban board w/ heartbeats & reclaim |
| Memory/learning | ✅ Curated memory docs (global/group/USER.md) + message text search + self-authored skills (IP-008) | ✅ Curated memory docs + FTS session search + self-authored skills |
| Channels | 5 (Slack, iMessage, email, webhook, edge) | 22 (incl. Telegram, WhatsApp, Signal, Discord…) |
| iMessage | ✅ Local edge agent (private) | ⚠️ Third-party hosted relay (Photon Spectrum) |
| Model support | Claude SDK + OpenAI planner; per-group routing + auxiliary cheap tier (IP-011), no fallback chains | ~20 providers, local models, mid-session switching, fallbacks |
| Ops/observability | ✅ AppConfig admin UI, cost ledger, run audit | ⚠️ Weaker: YAML/env config, no cost ledger |
| Structured app state | ✅ Mongo models + generated typed SDK + custom frontend | ❌ Files + SQLite; generic dashboard |
| Software building | ✅ Feature channels, PR watcher, movie/radio verticals | ⚠️ Generic terminal/coding tools; no PR workflow |
| Maturity/community | Personal project | 346+ contributors, very fast-moving (also churn risk) |

## Build, adopt, or steal?

**Keep Shade; steal Hermes's patterns.** Reasons:

- Shade's moats are real: native local iMessage, Mongo-backed structured state with a typed SDK and custom frontend, the AppConfig ops model, and domain verticals (features/PR watcher/radio/movies) Hermes doesn't have.
- The gaps (multi-agent, memory) are additive features on Shade's foundation, not architectural rewrites — and Hermes is MIT-licensed, so its designs (and even code) are freely study-able.
- Migrating to Hermes would mean abandoning the Terreno stack, the admin UI, and the edge system, then rebuilding the verticals in a Python codebase shipping 18 minor releases in 5 months.

Priority order for closing the gap:

1. **Memory** (`search_history` tool + curated MEMORY/USER docs + skills dir) — highest leverage per effort. ✅ Shipped as IP-008.
2. **Worker pool + durable Task board** (multi-agent, resilient long jobs, isolated software builds) — the biggest capability unlock. ✅ Shipped as IP-009 (in-process worker pool; out-of-process execution shipped as IP-010).
3. **Process split** (gateway vs. workers) — falls out of #2 and fixes the watchdog blast radius. ✅ Shipped as IP-010 (same-host worker processes; remote workers still future).
4. **Channel & scheduler polish** (email threading, adaptive scheduler tick, per-group model routing). ✅ Shipped as IP-011.

## Sources

- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/ (cron: `/docs/user-guide/features/cron`)
- https://blakecrosley.com/guides/hermes (practitioner deep dive)
- https://blogs.nvidia.com/blog/rtx-ai-garage-hermes-agent-dgx-spark/
