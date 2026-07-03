# Agent Runtime & Tools

## Runners (`backend/src/orchestrator/runners/`)

### DirectAgentRunner (`direct.ts`)

The primary runtime. Calls `query()` from `@anthropic-ai/claude-agent-sdk`:

- Attaches an **in-process MCP server** ("shade-orchestrator", built in `backend/src/agentRunner/mcpServer.ts`) exposing Shade's tool suite.
- Model, timeout (~300s default), max resumes, and allowed tools come from `AppConfig` (`agent.allowedTools`, `orchestrator.*`); Shade MCP tools are auto-allowed via the `mcp__shade-orchestrator` wildcard.
- Streams results; on timeout, aborts via `AbortController` and records a `resumeSessionAt` checkpoint on the `AgentSession` so the next turn can resume (up to `AppConfig.orchestrator.maxResumes`).
- Output is secret-redacted before returning to the orchestrator.

### OpenAIAgentRunner (`openai.ts`)

Used only for **feature channels** in their planning phase. Calls OpenAI Chat Completions (configurable model), replaying the transcript for conversation recovery. When the user types `/implement`, the group's `featurePhase` flips from `planning` to `implementing` and subsequent turns run on the Claude Agent SDK.

## Sessions & memory

- **`AgentSession`**: groupId, SDK session UUID, JSONL transcript path (under `SHADE_DATA_DIR/sessions/`), message count, resume checkpoint. `getOrCreateSession()` resumes the last active session or creates one.
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
- **Model routing is coarse**: global/per-backend model selection; no per-group or per-task model routing beyond the feature-channel planner/implementor split.
- **Email threading**: replies don't yet reconstruct reply-to from the inbound message.
- **iMessage**: text-only (AppleScript can't send tapbacks/attachments reliably).
- **Scheduler precision**: up to ~5 min late (tick interval).
- **Timeout/resume**: bounded by `maxResumes`; long tasks eventually fail rather than checkpoint indefinitely.
