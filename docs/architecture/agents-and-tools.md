# Agent Runtime & Tools

## Runners (`backend/src/orchestrator/runners/`)

### DirectAgentRunner (`direct.ts`)

The primary runtime. Calls `query()` from `@anthropic-ai/claude-agent-sdk`:

- Attaches an **in-process MCP server** ("shade-orchestrator", built in `backend/src/agentRunner/mcpServer.ts`) exposing Shade's tool suite.
- **Model resolution (IP-011)**: `resolveModel()` picks `Group.modelConfig.defaultModel` (per-group override) → `AppConfig.agent.model` (global default; empty string = SDK default) → SDK default. The resolved model is passed to `query()` and is what gets logged to `AIRequest` and `TaskRunLog`. A second cheap tier, `AppConfig.agent.auxiliaryModel` (default `claude-haiku-4-5-20251001`), serves detection/summarization-style callers — currently the trivia detector.
- Timeout (~300s default), max resumes, and allowed tools come from `AppConfig` (`agent.allowedTools`, `orchestrator.*`); Shade MCP tools are auto-allowed via the `mcp__shade-orchestrator` wildcard.
- Streams results; on timeout, aborts via `AbortController` and records a `resumeSessionAt` checkpoint on the `AgentSession` so the next turn can resume (up to `AppConfig.orchestrator.maxResumes`).
- Output is secret-redacted before returning to the orchestrator.

### ZergAgentRunner (`zerg.ts`)

Runs a group's turns **inside a zerg-managed container** instead of on the Shade host. Selected by `GroupQueue.selectRunner` / `TaskWorkerService.selectRunner` when `Group.executionConfig.mode === "container"`; the planner still wins for feature channels in `planning`.

- **Target**: `executionConfig.zergRepo` (a repo in zerg's `repos.json`, required) + `executionConfig.zergFeature` (defaults to a slug of the group name). Container name is `<repo>-<feature>`, tmux window `<repo>|<feature>` — the same names hive uses.
- **Per run**: `zerg run <repo> <feature>` (idempotent: reuses a live container, rebuilds a dead one), then the Agent SDK's `query()` with a custom `spawnClaudeCodeProcess` that `docker exec -i -w /workspace`s `claude` into the container. The SDK's stdio control channel rides the exec, so the in-process Shade MCP server and every tool keep working unchanged; the agent gets the image's toolchain and the repo checkout.
- **Env**: only host vars matching `AppConfig.zerg.envPrefixes` (`SHADE_`, `CLAUDE_`, `ANTHROPIC_`) cross into the container, plus a per-run `SHADE_ZERG_RUN_ID` stamp. `stop()`/abort kill the local `docker exec` client *and* the stamped process inside the container (docker exec does not forward signals).
- **Taking over**: every result carries `attach` (`{session, tmux, attachCommand, claudeSessionId, resumeCommand}`); GroupQueue posts it to the channel once per session — `zerg attach <repo> <feature>`, then `claude --resume <id>` inside the window picks up the exact conversation Shade was driving. Resume checkpoints live in the container's home; a checkpoint the CLI no longer knows is retried once without resume.
- **Config** (`AppConfig.zerg`): `enabled`, `sshHost` (default `zerg`, the Linux host running docker/zerg; every command is wrapped in `ssh -T -o BatchMode=yes <host>`; empty = run locally), `command` (`zerg`, the operator interface; `hive` + `up` still work as a fallback), `upVerb` (`run`), `attachVerb` (`attach`), `workdir`, `claudeCommand`, `upTimeoutMs`, `envPrefixes`. Edit via the AppConfig CRUD/admin API — no deploy needed.
- **Fail-closed**: a container-mode group with no repo, an unsafe name, `zerg.enabled=false`, or a failed `up` produces a failed run with the reason; `DirectAgentRunner` refuses a container target outright rather than running it on the host.

### Zerg sessions dashboard (IP-017, `orchestrator/services/zergSessions.ts`)

Shade's read-only orchestrator view over every zerg session, not just the ones it started. `ZergSessionsService` runs `zerg dash --json` (and `zerg inbox --json` when the CLI has it) over the `AppConfig.zerg` ssh hop, normalizes rows (activity working/blocked/idle/dead, drone stage, PR, blocked-on, last line, attach command), sorts needs-you first, and caches for `zerg.cacheMs` (5 s, single-flight) because `dash` docker-execs into every container. zerg being unreachable is data, not an exception: the dashboard carries `error` and the last known rows.

Three surfaces share that one service: the `list_zerg_sessions` MCP tool (with a `zergSystemPromptBlock` telling the agent when to use it), `GET /zerg/sessions` (`?refresh=1`, `?repo=`), and the **Sessions** console screen (`frontend/app/(tabs)/sessions.tsx`, polling every 15 s). No write path exists: answering, approving and killing stay in zerg.

### OpenAIAgentRunner (`openai.ts`)

Used only for **feature channels** in their planning phase. Calls OpenAI Chat Completions (configurable model), replaying the transcript for conversation recovery. When the user types `/implement`, the group's `featurePhase` flips from `planning` to `implementing` and subsequent turns run on the Claude Agent SDK.

## Sessions & memory

- **`AgentSession`**: groupId, SDK session UUID, JSONL transcript path (under `SHADE_DATA_DIR/sessions/`), message count, resume checkpoint. `getOrCreateSession()` resumes the last active session or creates one. For container-mode groups the Claude Code transcript itself lives in the container's account home, which is what `claude --resume` reads there.
- **Memory files** (`orchestrator/memory.ts`): the system prompt is assembled from `SOUL.md` (persona), `USER.md` (agent-curated user profile, single global file), the global `CLAUDE.md`, and the group's `CLAUDE.md`. Agents edit these at runtime via `update_memory` — scope `group` is writable by any group for its own file; scopes `global` and `user` are main-group-only. Writes are capped at `AppConfig.memory.maxFileChars`; oversized writes are rejected with a condense instruction.
- **Searchable history**: `search_history` runs a MongoDB text-index search over stored `Message` docs for the current group (default 90 days back, results capped at `AppConfig.memory.historySearchLimit`), letting agents recall conversations far beyond the recent context window.
- **Skills library** (`orchestrator/skills.ts`): agent-authored reusable procedures stored as frontmattered markdown in `SHADE_DATA_DIR/skills/` (global, kebab-case names, capped at `AppConfig.memory.maxSkillChars`). `save_skill` / `list_skills` / `load_skill` manage them; the system prompt includes a name + description index only — bodies are loaded on demand via `load_skill` (progressive disclosure).
- **Memory flag**: `AppConfig.memory.enabled` (default true) gates all five memory/skills tools and the memory/skills prompt blocks; when false the tools report "Memory features are disabled".
- **Conversation context**: rebuilt per turn from the last ~2 hours of `Message` docs, rendered as XML (`<message>`, `<user_action>` for Slack button clicks).
- **Persistent data tools**: `save_data` / `load_data` / `list_data` / `delete_data` give agents durable per-group JSON storage.

## Shade MCP tool suite (`backend/src/agentRunner/mcpServer.ts`)

Tool inputs are Zod-validated. Tools act by writing IPC files to `data/ipc/` (picked up asynchronously by `IpcWatcher`) or by calling services directly.

| Category | Tools |
|---|---|
| Messaging | `send_message`, `respond_with_card` (RichResponse cards), `add_reaction`, `get_channel_history` |
| Memory & skills | `search_history`, `update_memory`, `save_skill`, `list_skills`, `load_skill` |
| Scheduling | `schedule_task`, `list_tasks`, `pause_task`, `resume_task`, `cancel_task` |
| Task board (background delegation) | `delegate_task`, `get_task_result`, `list_agent_tasks`, `cancel_agent_task` |
| Storage | `save_data`, `load_data`, `list_data`, `delete_data` |
| Apple (macOS host) | `list_reminders`, `create_reminder`, `complete_reminder`, `delete_reminder`, `search_contacts`, `get_contact`, `match_contact`, `create_contact`, `update_contact`, `add_contact_context` |
| Radio / trivia | `start_radio_stream`, `stop_radio_stream`, `list_radio_streams`, `toggle_transcription`, `toggle_trivia_monitor`, `trivia_monitor_status` |
| Misc | `get_weather` (wttr.in), `set_allowed_users`, `create_feature` (spins up a Slack feature channel + Group) |

External MCP servers (subprocess, command-based) can be added via `AgentRunConfig.mcpServers` — e.g. the [media server](./backend.md#mcp-media-server-backendsrcmcpmediaserver) for Sonarr/Radarr/Plex/NZBGet.

## Multi-agent work: task board & SDK subagents

Two complementary mechanisms (IP-009):

- **Task board (durable background work)**: `delegate_task` creates an `AgentTask` for the current group; the in-process `TaskWorkerService` claims and runs it as a separate agent session, concurrent with (and independent of) the conversation. Results come back via `get_task_result` polling or `deliverResult: true` (posted to the group channel). Tasks survive restarts (claim/heartbeat/reclaim — see [Orchestrator](./orchestrator.md#agent-task-board-servicestaskboardts-servicestaskworkerts)). Board tasks run with `isBoardTask` set in the MCP context and cannot delegate further (one-level depth rule). Gated by `AppConfig.taskWorker.enabled`, which also controls the delegation prompt block appended in `buildSystemPrompt`.
- **SDK subagents (intra-turn parallelism)**: `AppConfig.agent.enableSubagents` (default true) adds the Claude Agent SDK's native `Task` tool to `allowedTools`, letting a single turn fan out short-lived parallel subagents (e.g. "check these 3 URLs in parallel"). These are ephemeral — they die with the turn — whereas board tasks are durable, retried, and auditable (`TaskRunLog`).

## Feature channels (software-building workflow)

`create_feature` creates a dedicated Slack channel + `Group` with `featurePhase: "planning"` and `requiresTrigger: false` (every message triggers the agent). The planning phase runs the OpenAI planner with `/ip` workflow instructions pinned into the prompt; `/implement` hands off to the Claude SDK for implementation; `Feature` docs track step status (pending → in_progress → complete) surfaced in the frontend Features screen.

## Current limitations (as observed in code)

- **Multi-agent coordination is one level deep**: the task board (IP-009) provides durable background delegation and SDK subagents provide intra-turn parallelism, but delegated tasks cannot delegate further — no delegation trees, task dependencies/DAGs, or cross-group tasks. Execution is still in-process (out-of-process workers → IP-010).
- **Model routing is per-group, not per-task**: `Group.modelConfig.defaultModel` and the `agent.model`/`agent.auxiliaryModel` global tiers (IP-011) cover group-level routing, but there are no per-task model overrides or automatic fallback chains (Hermes-style).
- **Email threading is single-thread**: replies target the most recent inbound email in the group (IP-011); multiple interleaved conversations per group, HTML bodies, and inbound attachments are not handled.
- **iMessage**: text-only (AppleScript can't send tapbacks/attachments reliably).
- **Scheduler precision**: second-level, not sub-second — the adaptive tick (IP-011) clamps sleeps to ≥5 s, and admin-CRUD-created tasks can still wait up to one max interval.
- **Timeout/resume**: bounded by `maxResumes`; long tasks eventually fail rather than checkpoint indefinitely.
