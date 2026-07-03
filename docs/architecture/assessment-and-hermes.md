# Architecture Assessment & Hermes Agent Comparison

*Written July 2026. Evaluates Shade's architecture against its goal and against Nous Research's Hermes Agent.*

**The goal:** an autonomous agent that (1) runs cron jobs as agent tasks, (2) builds software, (3) performs advanced requests with sets of sub-agents working together, and (4) pulls information from the user, iMessage, email, etc. and takes actions against all of them.

## Verdict in one paragraph

Shade's core pipeline — channel connectors → `Message` → `MessageLoop` → per-group queue → Claude Agent SDK runner → IPC → outbound — is the right shape and worth keeping. It already delivers goals 1 and 4 credibly. The two real gaps against the goal are **multi-agent coordination** (goal 3: there is none — agents are strictly sequential per group) and **durable memory/learning** (context is a 2-hour message window plus a static per-group `CLAUDE.md`). A third, structural risk is that **everything runs in one process**, so a watchdog restart kills in-flight agent runs, radio transcription, and movie processing together. None of this requires a rewrite; it requires adding a coordination layer and a memory layer to an otherwise sound foundation — and Hermes Agent is a good source of proven designs for both.

## What Shade gets right

- **Channel abstraction.** One `ChannelConnector` interface, five transports, one send path. Adding a channel is additive. The rich-response schema (see `research.md`) layers on cleanly.
- **Scheduler-as-synthetic-message.** A due `ScheduledTask` becomes a normal agent turn through the same queue, trigger, audit, and delivery machinery. This is exactly how Hermes models cron ("cron jobs are agent tasks, not shell scripts") — Shade independently landed on the right design.
- **Ops discipline.** `AppConfig` for all runtime config with an admin UI, `AIRequest` cost tracking per LLM call, `TaskRunLog` per task run, admin scripts for status/spend/key-testing. Hermes is notably weaker here (config split across YAML/env, no cost ledger).
- **Local-first iMessage.** The edge-agent design (registered, approved, heartbeating daemon on a Mac with encrypted secrets) keeps iMessage fully under your control. Hermes's iMessage goes through Photon Spectrum, a third-party hosted line pool — a privacy trade-off Shade doesn't make.
- **Session resume.** `AgentSession` checkpoints (`resumeSessionAt`) let timed-out SDK runs continue instead of restarting.

## Gaps against the goal

### 1. Sub-agents working together (the big one)

There is no multi-agent layer. `GroupQueue` runs one agent per group at a time; "collaboration" is limited to whatever the Claude Agent SDK does inside a single turn. There is no durable task board, no worker identity, no way for a long job to be decomposed, claimed, retried, or survive a process restart.

Hermes's answer, worth copying nearly wholesale: a **Kanban task model** — durable tasks with states, worker heartbeats, reclaim of tasks from dead workers, zombie detection, per-task retry budgets, and an output-verification gate — plus `delegate_task(background=true)` for spawning concurrent background workers. Shade already has the primitives (Mongo models, `TaskRunLog`, the underused `@shade/worker` package, edge-agent heartbeat code that could be generalized to workers).

**Recommendation:** add a `Task` model (decomposable, claimable, heartbeated) and turn `@shade/worker` into an agent worker pool that claims tasks. Expose `delegate_task` / `list_tasks`-style MCP tools so the orchestrator agent can fan work out. In the near term, enable Claude Agent SDK subagents inside `DirectAgentRunner` for intra-turn parallelism — it's the cheapest 80%.

### 2. Memory and learning

Per-turn context is the last ~2 hours of messages plus a static group `CLAUDE.md` and manual `save_data` blobs. Nothing is learned across sessions; nothing older than 2 hours is retrievable; there is no model of the user.

Hermes's signature feature is the closed learning loop: small curated memory docs (`MEMORY.md` ~800 tokens, `USER.md` ~500 tokens), **full-text search over all past session transcripts** (SQLite FTS5 + LLM summarization at query time), and **agent-authored skill documents** persisted after hard problems. Nous claims large speedups from accumulated skills; directionally this matches what we'd expect.

**Recommendation:** three incremental steps, all cheap in Shade's stack:
1. A `search_history` MCP tool over `Message` + session transcripts (Mongo text index or Atlas Search — already used for frame analyses).
2. Agent-curated `MEMORY.md` / `USER.md` per group (the group folder already exists; add a `update_memory` tool with a token budget).
3. A skills directory the agent can write to after solving novel problems, loaded progressively into the system prompt.

### 3. Software building

Feature channels (OpenAI planner → `/implement` → Claude SDK) are a reasonable v1, but implementation runs inside the orchestrator process on the production server with no filesystem isolation, and long builds fight the timeout/`maxResumes` ceiling.

**Recommendation:** run implementing-phase agents in git worktrees (or containers) via the worker pool from gap 1, so builds are isolated, parallelizable, and survive orchestrator restarts. Reconsider whether the OpenAI planner still earns its keep versus a second Claude configuration — it's the only reason there are two runner code paths.

### 4. Process architecture

One process hosts the orchestrator, all channel connectors, ffmpeg radio streaming, movie processing, and every agent run. The external watchdog's restart is a blunt instrument: it kills healthy in-flight work to fix a stuck Slack socket.

**Recommendation:** split along the seam that already exists — orchestrator/channels stay in the main service; agent execution and media pipelines move to `@shade/worker` processes. Then the watchdog restarting the gateway costs nothing in-flight. (This is Hermes's gateway-daemon vs. execution-backend split.)

### Smaller items

- Email reply threading is incomplete (`channels/email.ts` TODO) — replies don't go back to the original sender's thread.
- Scheduler tick is 5 minutes; fine for digests, too coarse for "remind me in 2 minutes." Make the tick adaptive (sleep until `min(nextRunAt)`).
- Model routing is coarse (global + feature-phase). Per-group/per-task model config plus a cheap "auxiliary" tier for summarization/detection (Shade already does this ad hoc: Haiku for trivia detection) could be formalized.

## Shade vs. Hermes Agent, head to head

Hermes Agent (github.com/NousResearch/hermes-agent, MIT, ~208k stars, v0.18.0 as of July 2026) is the same product category: self-hosted personal autonomous agent with cron, sub-agents, and messaging surfaces.

| Dimension | Shade | Hermes |
|---|---|---|
| Cron agents | ✅ Same design (task → agent turn), Mongo-backed, audited | ✅ Fresh isolated session per job, 60s tick, deliver-to-any-channel |
| Sub-agents | ❌ None (sequential per group) | ✅ Background worker fleet + Kanban board w/ heartbeats & reclaim |
| Memory/learning | ⚠️ 2h window + static CLAUDE.md + save_data | ✅ Curated memory docs + FTS session search + self-authored skills |
| Channels | 5 (Slack, iMessage, email, webhook, edge) | 22 (incl. Telegram, WhatsApp, Signal, Discord…) |
| iMessage | ✅ Local edge agent (private) | ⚠️ Third-party hosted relay (Photon Spectrum) |
| Model support | Claude SDK + OpenAI planner, coarse routing | ~20 providers, local models, mid-session switching, fallbacks |
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

1. **Memory** (`search_history` tool + curated MEMORY/USER docs + skills dir) — highest leverage per effort.
2. **Worker pool + durable Task board** (multi-agent, resilient long jobs, isolated software builds) — the biggest capability unlock.
3. **Process split** (gateway vs. workers) — falls out of #2 and fixes the watchdog blast radius.
4. **Channel & scheduler polish** (email threading, adaptive scheduler tick, per-group model routing).

## Sources

- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/ (cron: `/docs/user-guide/features/cron`)
- https://blakecrosley.com/guides/hermes (practitioner deep dive)
- https://blogs.nvidia.com/blog/rtx-ai-garage-hermes-agent-dgx-spark/
