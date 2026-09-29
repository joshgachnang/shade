# Orchestrator

`backend/src/orchestrator/` is the message-routing engine: it turns inbound messages (and due scheduled tasks) into agent runs, and agent output back into channel messages.

## Message lifecycle

1. **Inbound**: a channel connector receives a message, dedupes by `(groupId, externalId)`, and stores a `Message` doc. `CommandRouter` intercepts `!`-prefixed commands (`!trivia`, `!moviesearch`) before agents see them.
2. **MessageLoop** (`messageLoop.ts`): polls for unprocessed messages every ~5s (`AppConfig.pollIntervals`), checks the group's trigger condition (`requiresTrigger` / trigger pattern), and enqueues work.
3. **GroupQueue**: serializes execution per group (one agent at a time per conversation) and enforces a global concurrency cap (`AppConfig.concurrency.maxGlobal`).
4. **Runner**: `DirectAgentRunner` (Claude Agent SDK) by default; `OpenAIAgentRunner` when the group is a feature channel in its planning phase. Prompt = system prompt from group memory (`memory.ts`, group folder `CLAUDE.md`) + last ~2 hours of conversation formatted as XML (`router.ts` `buildPromptForGroup`).
5. **Output**: agents act through MCP tools that write **IPC files** to `data/ipc/`. `IpcWatcher` polls that directory and dispatches commands: `send_message`, `rich_response`, task scheduling ops, reactions, feature creation, etc.
6. **Outbound**: `ChannelManager.sendMessageToGroup` fans the response out through the group's channel connector. Rich responses (`responses/`) render per channel: Slack Block Kit, Terreno JSON, or `fallbackText`.

## Channels (`channels/`)

All connectors implement `ChannelConnector` (`channels/types.ts`).

| Channel | Transport | Notes |
|---|---|---|
| Slack | Socket Mode (`@slack/bolt`), real-time | Rich Block Kit cards, reactions, threads, message updates; per-channel bot/app tokens |
| iMessage | chat.db SQLite poll (~5s) + AppleScript send | Text only; requires a macOS host (or an [edge agent](./edge-agents.md)) |
| Email | IMAP poll (~30s, ImapFlow) + SMTP | Attachments supported outbound; replies thread back to the most recent inbound sender (`In-Reply-To`/`References`/`Re:` from stored `metadata`, IP-011), falling back to the configured recipient when no inbound metadata exists |
| Webhook | HTTP push | Inbound `WebhookSource` docs; outbound POST, responses ignored |
| EdgeAgent | HTTP push/pull | Remote daemons push messages, pull queued commands |

## Scheduler (`services/scheduler.ts`)

- Adaptive tick (IP-011): a self-re-arming `setTimeout` chain. After each tick, the service queries `min(nextRunAt)` over active tasks and sleeps `clamp(nextRunAt - now, 5s, AppConfig.pollIntervals.scheduler)` — so `pollIntervals.scheduler` (default 5 min, re-read from config on each re-arm) is the *maximum* sleep, an empty board sleeps the max, and near-term tasks fire on time.
- `wake()` cancels the pending sleep and ticks immediately (a wake during a tick is never lost). The gateway's IPC handlers call it when tasks are created, updated, or resumed (`schedule_task`/`resume_task`), so agent-created tasks fire promptly even from workers (IPC files flow to the gateway, ~one IPC-poll delay). Tasks created via admin CRUD don't wake the scheduler — they're picked up within one max interval.
- Each tick: query `ScheduledTask` docs with `status: "active"`, compare `nextRunAt` (computed by `scheduleMath.ts`) to now.
- Due task → by default a synthetic `Message` with the task's prompt pushed into GroupQueue with `metadata: {scheduledTaskId, scheduled: true}` — so a scheduled run is just a normal agent turn. With `AppConfig.scheduler.useTaskBoard` (default false, IP-010), the scheduler instead creates an `AgentTask {deliverResult: true, scheduledTaskId}` so the run executes via the task board — i.e. on a worker process (see below). Bookkeeping is identical in both modes, but board mode ignores group-queue busyness.
- Bookkeeping: `lastRunAt`, `runCount`, next run computed; `once` tasks marked completed; every run recorded in `TaskRunLog` (trigger, duration, cost, result).
- Schedule types: `cron` (cron expression), `interval` (ms), `once` (ISO date).
- Agents create and manage tasks themselves via the `schedule_task` / `list_tasks` / `pause_task` / `resume_task` / `cancel_task` MCP tools.
- Precision caveat: ~5 s worst case for tasks known when the sleep was armed (or created through a wake-calling path); a task created via admin CRUD can still land up to one max interval (~5 min) late. No sub-second precision.

## Agent task board (`services/taskBoard.ts`, `services/taskWorker.ts`)

Durable background delegation (IP-009, Hermes Kanban pattern). An agent turn can fan work out to background sub-agents via the `delegate_task` MCP tool; the work survives process restarts because Mongo is the queue.

- **`AgentTask` model** (`models/agentTask.ts`): `groupId`, `title`, `prompt`, `priority` (higher first), `status` (`pending → claimed → running → completed | failed | cancelled`), `attempts`/`maxAttempts` (default 2), `deliverResult`, `cancelRequested`, `workerId`, `claimedAt`/`heartbeatAt`/`startedAt`/`completedAt`, `result`/`error`, plus optional `scheduledTaskId` for lineage when a scheduled run is dispatched to the board (IP-010). Admin CRUD at `/agentTasks`.
- **Claim semantics** (`taskBoard.ts`): claiming is a single atomic `findOneAndUpdate` (`pending → claimed`, sorted `{priority: -1, created: 1}`) stamped with the worker id (`${hostname}:${pid}`) — no locking library, any number of workers can share the board. `attempts` increments at claim time, so the field always reads "runs started".
- **Heartbeat & reclaim**: running tasks are heartbeated every `heartbeatMs`; a sweep at each tick reclaims `claimed`/`running` tasks whose heartbeat is older than `staleMs` (worker died mid-run) — requeued to `pending` while retry budget remains, else `failed`. The heartbeat doubles as the cancellation check: `cancel_agent_task` sets `cancelRequested`, and the worker aborts the run (AbortController) at its next beat.
- **`TaskWorkerService`** (`taskWorker.ts`): worker pool behind `AppConfig.taskWorker.enabled`. The gateway starts it in-process only while `AppConfig.taskWorker.runInGateway` is true (default; gated by `shouldRunTaskWorkerInGateway()`, IP-010); dedicated worker processes run the same service against the same board. Each tick (`pollMs`, default 5s): reclaim stale tasks, then claim while below `concurrency` (default 2). Board runs execute through `DirectAgentRunner` with a fresh session per attempt, **bypassing GroupQueue** (background work, not conversation turns), capped at `taskTimeoutMs` (default 15 min) per attempt. Failure → requeue or terminal fail per the retry budget. Every attempt writes a `TaskRunLog` with `trigger: "delegated"`.
- **Delivery**: tasks with `deliverResult: true` post `✅ <title>: <result>` to the group's channel on completion; terminal failures post `❌` so they are never silent. Otherwise the parent agent polls `get_task_result`.
- **Depth limit**: board tasks run with `isBoardTask: true` threaded into the MCP context, and `delegate_task` rejects further delegation — one level only, no runaway fan-out.
- **Process placement (IP-010)**: the claim/heartbeat/reclaim primitives are process-agnostic — coordination is entirely through Mongo (atomic claims) and the filesystem, no HTTP worker protocol — so board execution runs in dedicated worker processes (`bun run worker`, see below) with the gateway's in-process pool as a rollout fallback. Remote/multi-host workers (which would need an HTTP claim protocol) remain future work.

## Background services (`services/`)

- **RadioTranscriber** — ffmpeg tails a radio stream, Deepgram transcribes, transcripts batch into the DB and post to Slack; ACRCloud identifies songs; failed streams restart with exponential backoff.
- **TriviaMonitor** — rolling 25-message transcript window through the cheap auxiliary model (`AppConfig.agent.auxiliaryModel`, default Haiku; trivia-specific override via `models.detector`/`DETECTOR_MODEL`) to detect trivia questions; on the `[MUSIC_START]` sentinel, finalizes questions, saves to the trivia DB, posts to webhooks, and launches a Claude Sonnet research agent with web search (Brave + Exa + Tavily). `!trivia <question>` researches manually.
- **PrWatcher** — polls GitHub PRs (`PrWatch` model), posts Slack notifications on state changes, can auto-review and fix merge conflicts with Claude.

## Gateway/worker split & process supervision

Since IP-010 the backend runs as two processes on the same host, sharing MongoDB and `SHADE_DATA_DIR`:

- **Gateway** (`server.ts`, `shade-backend.service`): channels, MessageLoop, IpcWatcher, scheduler, interactive conversation turns, radio streaming, movie processing — everything latency-sensitive or stateful. It also runs an in-process `TaskWorkerService` while `taskWorker.runInGateway` is true.
- **Worker** (`backend/src/workerMain.ts`, `bun run worker`, `shade-worker.service`): `AgentTask` board work only — including scheduled runs once `scheduler.useTaskBoard` is on. Owns the claim-loop interval and serves `GET /health` on `WORKER_PORT` (default 4021) → `{status, workerId, runningTasks, uptimeSeconds}`.

Both entrypoints share `backend/src/boot.ts`: Mongo connect → `loadAppConfig()` → `hydrateEnvFromConfig()` → init data directories.

**Cross-process result delivery**: agents running on a worker deliver output by writing a `send_message` IPC file (exact MCP schema, tmp+rename) into the shared `paths.ipc` directory; the gateway's `IpcWatcher` dispatches it like any other IPC command. Results queue on disk, so a task that finishes while the gateway is down is delivered when `IpcWatcher` resumes.

**Drain semantics**: on SIGTERM/SIGINT the worker stops claiming, waits for in-flight tasks up to `taskWorker.taskTimeoutMs` (default 15 min), aborts any stragglers (stale-heartbeat reclaim retries them), and exits 0.

**Rollout flags** (each step independently reversible): 1) ship code — nothing changes (`runInGateway=true`, `useTaskBoard=false`); 2) deploy `shade-worker.service` — gateway and worker both claim (safe, claims are atomic); 3) `taskWorker.runInGateway=false` — board work is worker-only; 4) `scheduler.useTaskBoard=true` — scheduled runs go through the board, i.e. run on workers.

Supervision is external — systemd for both units, plus `deploy/shade-watchdog.sh`, which polls the gateway's `/health` and `/health/slack` and restarts **only** `shade-backend.service`; the worker is intentionally not watchdog-managed, so a gateway restart never kills in-flight board tasks (see [Deployment](./deployment.md)). Worker liveness is visible in the `systemStatus` admin script's Workers section (active `workerId`s with heartbeat ages, board status counts).

## Brewery feature startup

`BreweryDriver.start({feature, group, request, repo})` prepares and launches a brewery run. Pass the repository from `create_feature` explicitly (especially for local execution); `group.executionConfig.zergRepo` is the fallback. The `create_feature` IPC handler calls this service directly; event delivery is handled by the poller below.

| Mode | Workspace and launch |
|---|---|
| `AppConfig.zerg.enabled=true` | Run the configured zerg up command locally or through `zerg.sshHost`; use its reported session, `zerg.workdir`, and detached `docker exec -d`. |
| `false` | Ensure `<featureChannels.localReposDir>/<repo>` exists with `gh repo clone`, then create a dedicated Git worktree under the sibling `.shade-worktrees` directory from `refs/remotes/origin/HEAD`. Spawn brewery detached with its log redirected. |

Run slugs combine a shortened channel slug and Feature ID to isolate similarly named features. The service writes the request verbatim to `.terreno/brewery/<slug>/request.md` with restrictive permissions, persists `Feature.brewery` (distill phase, zero event offset, empty step messages), and launches:

```sh
brewery distill --file .terreno/brewery/<slug>/request.md --slug <slug> --no-wait
```

`AppConfig.brewery.command` selects the executable and `agents` supplies an optional `--agents` argument to both preflight and launch. Before detaching, `brewery agents` must report an available configured agent for every stage. Missing executable/agents, invalid input, or workspace/launch failure sets the Feature to `error` and sends an actionable error to the supplied channel transport. External command output and request text are excluded from error notices. No agent runner is invoked by this service.

A successful return means the launch was accepted; completion and asynchronous failures belong to the event poller. Output is retained at `.terreno/brewery/<slug>/launch.log`. Starting a Feature with existing brewery metadata is rejected without changing its status; use the resume workflow for existing runs. Failed preparations retain their workspace for diagnosis; resolve worktree/branch conflicts before attempting a fresh start. Local repositories must have `origin/HEAD` set to their default branch.

Verification: `cd backend && bun test src/orchestrator/services/breweryDriver.test.ts` exercises real Git worktrees, MongoDB persistence, a detached fake CLI, and injected zerg/SSH transport failures. This service introduces no Shade frontend flow; browser QA belongs to the Features-screen task.

## Brewery event delivery

`BreweryPoller` reads each active brewery Feature's `events.jsonl` from its persisted **byte** offset. It runs beside the task worker: in the gateway while `taskWorker.runInGateway=true`, otherwise in dedicated workers. A per-feature Mongo lease prevents overlapping polls during worker rollout; expired leases recover after a crash. The loop starts immediately, reloads `AppConfig.brewery.pollIntervalMs` between passes, and drains on shutdown. Workers use Slack's HTTP API with the existing Channel bot token, without opening another Socket Mode connection. In test mode, the default transport persists brewery posts and edits as outbox Message records on test channels only; production uses Slack. Unit tests can also inject the transport.

| Event | Feature-channel behavior |
|---|---|
| `step.start` | Post `▸ T2 roast (claude)`; persist its Slack timestamp. |
| `narration` | Keep the last `maxNarrationLines` (each at most 300 characters); edit the same message no more often than `narrationFlushMs`. Pending lines and flush times survive process restarts. |
| `step.end` | Immediately finalize the same message, e.g. `✓ T2 roast PASS in 312s: Continue`, retaining recent narration. |
| `waiting` | Post the brewery message (including gate options). Sign-off also reads the IP's summary and checkbox task list, adds the reply grammar, and sets `awaiting_approval`. Both relative and workspace-contained absolute IP paths are supported. |
| `resumed` | Clear waiting and restore `in_progress`. |
| `pr`, `ci` | Post the PR link or CI state; persist the PR number. |
| `done`, `error` | Post completion or the failure with workspace-relative log paths; set the terminal Feature status. |

For example, the sign-off post ends with `Reply \`ok\`, \`ok, 2b\`, or \`no: <why>\``. The summary is capped at 4,000 characters and task list at 24,000; the brewery message contains the source plan path. No second ntfy notification is sent. CLI `note` events advance the cursor without another acknowledgement; reply handling owns that acknowledgement (T9).

The poller uses the same local or zerg/SSH workspace execution path as startup, and mirrors `state.json`'s phase when present. It advances the cursor only after a complete newline-terminated record has been handled and persisted. Empty/missing streams and partial records wait for another pass; invalid records, unavailable IP files, workspace failures, and failed Slack operations retain the cursor for retry. Failure in one feature does not stop the others. Slack and Mongo cannot be committed atomically: a process crash after Slack accepts a post but before Mongo persists its timestamp can duplicate that post on recovery. Persisted step timestamps prevent duplicates during normal restart/replay.

After `stepSilenceAlertMin` without an event, an active, non-waiting run whose `run.pid` is absent or dead receives one “Brewery died” notice with `resume` and the launch-log path, and becomes `error`. A live PID or failed workspace read does not trigger a death notice. Approval/gate waits and terminal features are excluded.

Verification: `cd backend && bun test src/orchestrator/services/breweryPoller.test.ts src/orchestrator/services/breweryDriver.test.ts`. These exercise real filesystem streams and Mongo, with injected Slack and zerg boundaries. No Shade frontend flow changes in T8; browser QA belongs to T13 and the full request/reply harness to T12. GroupQueue reply routing is described below; Channel creation is described below.

## Brewery feature replies

`BreweryDriver.handleMessage(group, {content})` resolves the channel's Feature and sends commands to its **saved workspace**, even if the startup mode has since changed. GroupQueue routes every `featureDriver: "brewery"` message to this driver before runner selection, including bot-authored seed requests and `/implement`. Replies serialize per group without consuming agent concurrency slots. Successfully handled messages are marked processed so MessageLoop cannot replay them; thrown delivery errors leave them unprocessed for a later poll. `selectRunner` rejects brewery groups, and driver errors release the queue without agent retries or fallback. Legacy groups without `featureDriver` retain planner/container/default runner routing. New channels are created as described below.

| Reply | Driver action |
|---|---|
| Any text while waiting for sign-off or a gate | Detach `brewery answer <slug> "<reply>" --go --no-wait`. Preserve waiting metadata until brewery emits `resumed`. |
| `now: <text>` | Terminate the run's process group, wait for its owner to exit, persist the note with `brewery note`, then detach `brewery resume --go --no-wait`. Acknowledge the interrupted step. Existing approval gates remain brewery-owned. |
| `stop` | Terminate the process group and set the Feature to `paused`, excluding it from polling. A missing/dead PID is already stopped. |
| `resume` | Detach `brewery resume --go --no-wait`, restore polling, and clear the previous error. |
| Other text | Run `brewery note` and acknowledge `Queued for the next check-in (current: T3 roast)`. |

For example, `now: keep the existing title` stops the active step before recording the new direction and restarting. Notes and answers preserve whitespace and shell-sensitive characters; CLI answer text beginning with `--` is also treated as text. Empty messages and empty `now:` notes do not execute commands. Completed runs require a new feature. Missing runs receive an actionable notice.

Commands use `AppConfig.brewery.command` and optional `agents`, with an explicit workspace `--repo`. Local runs use detached process groups; zerg launches use `setsid` inside `docker exec -d` and therefore require `setsid` alongside Bun in the image. Cancellation reads `run.pid` in that same PID namespace, rejects malformed/unsafe PIDs, sends TERM then KILL when necessary, and waits within the configured zerg command timeout before allowing a restart. It leaves brewery's lock files for the CLI's stale-owner recovery.

The driver shares the poller's per-feature Mongo lease so a stale poll cannot undo a stop. A busy lease returns `deferred` and posts an automatic-retry notice. GroupQueue leaves the reply unprocessed so MessageLoop retries it on a later poll after the lease clears or expires; the sender need not resend approval. Synchronous command failures post a sanitized fix and launch-log path, set `error`, and release the lease. Detached launch acceptance is acknowledged separately from execution success; the poller reports later CLI events. No agent fallback or second notification is involved.

Verification: `cd backend && bun test src/orchestrator/services/breweryDriver.test.ts src/orchestrator/services/breweryPoller.test.ts` covers real Mongo, local filesystem/CLI launch and cancellation, plus injected zerg/SSH failures. `cd tools/brewery && bun test` covers CLI argument preservation. This backend service introduces no Shade browser interaction, so frontend QA/Playwright remain with T13 and full channel harness coverage with T12.

Queue routing verification: `cd backend && bun test src/orchestrator/groupQueue.brewery.test.ts src/orchestrator/groupQueue.test.ts`. These exercise the real driver through `enqueue`, including ordered CLI notes, seeded messages, empty and missing-run replies, delivery failure, and legacy runner selection.

## Creating brewery feature channels

The main group's `create_feature` IPC command is wired to `createFeatureHandler` in `index.ts`. It creates the Slack channel and invites the requester, persists a Group with `featureDriver: "brewery"` and `requiresTrigger: false`, creates the linked Feature, registers the channel, and calls `BreweryDriver.start` with the original request and repository. The brewery marker is persisted before live registration, so messages cannot select an agent runner even when startup fails. Existing groups without that marker are unchanged.

There is no roast workflow memory, implementation greeting, or synthetic inbound request. Brewery owns workspace preparation and posts its plan for approval through the event poller before implementing. The caller must supply a non-empty `request` and a valid `repo` (for example, `owner/shade`); the optional `description` is display metadata, not a replacement request. Missing input, unavailable brewery agents, and workspace/launch failures leave the Feature in `error` and post an actionable notice in the feature channel. The exception also reaches the IPC watcher's source-channel failure notice. Failures never fall back to an agent. Feature persistence failures propagate rather than starting an untracked run.

Verification: `cd backend && bun test src/orchestrator/createFeature.test.ts src/orchestrator/ipcWatcher.test.ts` covers authorized IPC dispatch, persisted brewery routing, zerg startup, real local Git worktrees and request preservation, no seed/memory/greeting, missing inputs, and Slack/preflight errors. Transport and operating-system execution are the injected external boundaries; MongoDB and the brewery driver remain real. T12 owns the full request-to-PR harness. This backend-only change introduces no Shade browser/native screen, so QA Markdown and Playwright do not apply under the frontend-flow testing scope.

T12 verification: `cd backend && bun test src/tests/brewery.harness.e2e.test.ts` launches `bun run dev:test` and drives request → plan → approval → live progress → PR entirely over HTTP, with a fake external brewery CLI. See [the harness guide](../testing/ai-harness.md#brewery-request-to-pr-test) for setup, cleanup, and failure coverage.
