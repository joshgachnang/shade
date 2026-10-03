# Shade Web UI — Design Brief

**Status:** Draft for review · **Date:** 2026-10-02 · **Branch:** `dashboard-design`
**Supersedes:** IP-013 *Console-Real-Data* (absorbed), the mock Console in `frontend/components/console/*`
**Related:** IP-017 *Zerg-Sessions-Dashboard*, IP-018 *Brewery-Driven-Feature-Channels*, IP-005 *Rich-Response-Ui*, IP-006 *Edge-Agents*, Terreno PR #1402 (asks), Terreno IP *agent-ui-blocks*

---

## Contents

1. What this UI is for
2. Design principles
3. The operator and their moments
4. Information architecture
5. The global shell
6. Page specs
   - 6.1 Chat (home)
   - 6.2 Inbox
   - 6.3 Running
   - 6.4 Item detail, by kind
   - 6.5 Portfolio (repos, backlog, drones)
   - 6.6 Features
   - 6.7 Automations
   - 6.8 Conversations (groups)
   - 6.9 Traces & cost
   - 6.10 Memory & skills
   - 6.11 Integrations
   - 6.12 Settings
   - 6.13 Domain apps
7. Chat in depth: asks, blocks, commands, agent tools
8. Settings exposure matrix (every AppConfig section)
9. Backend surface this needs
10. Real-time, notifications, and states
11. Dependencies & risks
12. Phasing
13. Open questions

---

## 1. What this UI is for

Shade already does a lot. It answers in Slack, iMessage, and email; runs cron jobs; delegates to a background worker; drives brewery feature channels; opens infra PRs; watches PRs; manages edge agents; transcribes radio; and it now runs turns inside zerg containers. zerg, for its part, runs a fleet of sandboxed sessions and autonomous drones across ~10 repos and collects their questions into an inbox.

Today all of that is spread across Slack threads, `zerg dash` in a terminal, `bin/tmux-sessions` on the laptop, `hive serve` at `zerg.nang.io`, ntfy pings, the generic `/admin` CRUD screens, and a mock Console with no real data. Answering a single question can take visits to four places.

The UI has **three jobs**, in priority order:

1. **Tell me what needs me, and let me answer it in place.** Every blocked drone, brewery sign-off, merge approval, failed task, and pending edge agent shows up as one card that I can resolve without switching tools.
2. **Show me everything running and whether it's healthy.** One list covering Shade and zerg, sorted so trouble floats to the top, where any row opens its full story: status, timeline, logs, PR, cost.
3. **Let me direct Shade in conversation.** Starting work, steering it, and asking questions about the system should be a chat message ("start a drone on shade to add SSE", "why did dailyTriage fail last night?", "pause the trivia monitor"). Shade answers with structured content (tables, status cards, buttons), not walls of text.

A fourth job is secondary but real: **tuning**. That means changing a group's model, a cron schedule, an infra-bot allowlist, or an API key without a deploy and without hunting through a 300-line AppConfig form.

What it is **not**: a terminal (attach to tmux with `zerg run`), a general data browser (that's `/admin`), or a multi-tenant product (Shade has one operator).

## 2. Design principles

1. **Needs-you first, everywhere.** Every list sorts items that need a human above working, working above idle. The count of needs-you items is always visible.
2. **Chat and panels are two views of one state.** Every button in a panel has a chat equivalent, and every chat answer about a running thing links to its panel. Neither is a second-class citizen.
3. **One decision primitive.** Anything that needs a human renders as a Terreno ask (`choice`, `confirm`, `markdown`, `form`, `files`). There are no bespoke approval widgets per subsystem.
4. **Answer where you are, resolve everywhere.** An ask answered in the UI disappears from Slack and the CLI view, and the reverse. The UI never assumes it is the only client.
5. **Safety rails stay where they are.** `zerg approve` remains the only merge path, the infra bot still never merges, and secrets are write-only. The UI adds convenience, not new authority.
6. **Show provenance.** Every item shows where it came from (Slack thread, cron, drone, webhook) and every action shows who and what did it (UI, Slack, CLI, agent).
7. **Calm by default.** No auto-scrolling log firehoses or flashing badges. Change is shown with a subtle highlight and a "since" timestamp. Notifications fire only on transitions into needs-you.
8. **Curated settings, not a schema dump.** Settings are grouped by what the operator is trying to do, with plain-English labels, units, and validation. The raw AppConfig admin stays as an escape hatch.

## 3. The operator and their moments

One operator (Josh), mostly on a laptop browser, sometimes on a phone. These are the usage moments, which drive layout priority:

| Moment | Frequency | What they need | Where |
|---|---|---|---|
| **Glance** | many times a day | "Is anything stuck? How many drones are running?" | top bar counts, Running rail |
| **Triage** | a few times a day | work through every pending decision quickly | Inbox |
| **Delegate** | daily | start a drone, schedule a task, create a feature, ask Shade to do something | Chat, Portfolio "Start" |
| **Steer** | daily | redirect a running feature or drone, answer its question with nuance | item detail + its conversation |
| **Investigate** | when something fails | why did it fail, what did it cost, what did it say | item detail timeline, Traces |
| **Tune** | weekly | change models, schedules, allowlists, thresholds | Conversations settings, Automations, Settings |
| **Phone check** | evenings and weekends | approve or answer from a notification | Inbox (mobile layout) |

## 4. Information architecture

```
Shade
├── Chat                 (home; one conversation per Group, + Inbox conversation)
├── Inbox                (all pending asks; badge = count)
├── Running              (full-page unified list; rail is a compact version)
│   └── /running/:id     (item detail — layout varies by kind, §6.4)
├── Portfolio            (zerg repos, backlog, drone capacity, start drone)
├── Features             (brewery feature channels)
├── Automations          (cron/interval/once tasks, built-ins, webhook sources)
├── Conversations        (Groups and Channels: who Shade talks to, how)
├── Traces               (turns, AI requests, sessions, cost)
├── Memory               (SOUL, USER, CLAUDE.md files, skills)
├── Integrations         (channels, edge agents, PR watch, infra bot, media, Apple)
├── Settings             (curated AppConfig)
├── Apps ▾               (Movies, Search, Reminders, Calendars, Radio & Trivia)
└── Admin ↗              (existing generic CRUD; escape hatch)
```

The primary nav is a narrow icon sidebar on the far left (Chat, Inbox, Running, Portfolio, Features, Automations, Traces, plus a "More" menu for the rest). This replaces the current tab layout in `frontend/app/(tabs)/_layout.tsx`.

## 5. The global shell

Every page renders inside the same shell:

```
┌──┬─────────────────────────────────────────────────────────────────────────┐
│  │ TOP BAR: ● Shade ok  ● Slack ok  ● Worker ok  ● zerg ok │ drones 5/12 │  │
│  │          needs you 3 │ $4.12 today │ ⌘K │ ⏸ Pause all                  │
│N ├───────────────┬───────────────────────────────────────┬────────────────┤
│A │ RUNNING RAIL  │  PAGE CONTENT                         │ CONTEXT PANEL  │
│V │ (collapsible) │                                       │ (collapsible)  │
└──┴───────────────┴───────────────────────────────────────┴────────────────┘
```

### 5.1 Top bar

| Element | Shows | Click | Source |
|---|---|---|---|
| Health dots | Shade API, each Channel (rolled up), task worker, zerg host. Green/amber/red, with tooltip text such as "Slack: disconnected 4m" | opens Integrations → Channels, or the System health popover | `/health`, `/health/slack`, worker `:4021/health`, zerg dash `notes[]` |
| Drone capacity | `running / maxDrones` (e.g. 5/12), amber at ≥80% | Portfolio | `zerg dash` `drones` |
| Needs you | count of pending asks, red when > 0 | Inbox | `/console/asks?status=pending` |
| Cost today | sum of AIRequest `costUsd` since local midnight; tooltip shows the 7-day sparkline | Traces → Cost | AIRequest aggregate |
| ⌘K | command palette (§5.4) | | |
| **Pause all** | kill switch. When paused, the bar turns amber and reads "Shade paused since 14:02 — Resume" | confirm ask → `POST /console/pause` | `AppConfig.orchestrator.paused` (new) |

**Pause all** semantics: the message loop stops dispatching new turns, the scheduler stops firing, and the task worker stops claiming. In-flight turns finish unless "Also stop running turns" is checked. It does **not** touch zerg, which has its own lifecycle. The confirm dialog says so.

### 5.2 Running rail (left)

A compact, always-visible version of the Running page (§6.3). Sections, each collapsible with a count:

- **Needs you**: items with an open ask, or zerg `needsYou` (blocked / dead / inbox)
- **Working**: active group turns, running AgentTasks, working zerg sessions, brewery phases in progress
- **Scheduled**: the next 5 scheduled task runs, with relative time ("in 12m")
- **Idle / recent**: idle zerg sessions, items finished in the last 2h

Each row is two lines: line 1 is a source glyph (Shade ◆ / zerg ⬡), title, and a state dot; line 2 is muted "doing now" text and "since" time. There is a filter chip row at the top (All · Shade · zerg · repo ▾). Clicking a row opens it in the context panel; double-click or ↗ opens the full detail page. Hovering shows a quick-action strip (answer / kill / pause, according to kind).

### 5.3 Context panel (right)

A slide-in detail for the selected item. It is the same component as the detail page (§6.4), in a narrow layout: header, status, the top 3 actions, a short timeline, and "Open full ↗". It closes with Esc. It stays open while you chat, so you can ask about the item with it visible.

### 5.4 Command palette (⌘K)

A fuzzy search across Running items, Groups, Features, Scheduled tasks, repos, settings sections, and actions:
- "start drone…" → repo picker → request text → `zerg start`
- "pause trivia", "run dailyTriage now", "open shade PR 112"
- "go to settings: infra bot"

Every action in the palette goes through the same endpoint as its button.

### 5.5 Responsive behavior

- **≥1280px:** all three panes.
- **900–1280px:** rail collapses to icons + counts; the context panel overlays.
- **<900px (phone):** single column with a bottom tab bar (Chat · Inbox · Running · More). Inbox is the default landing page when there are pending asks. The context panel becomes a full-height sheet. Ask cards use Terreno's `SimpleAskCard` when they qualify (≤3 buttons).

---

## 6. Page specs

Each page lists: **purpose** · **questions it answers** · **layout & content** · **actions** · **settings surfaced** · **empty/error states** · **data**.

### 6.1 Chat (home)

**Purpose.** Talk to Shade. This is the same agent, memory, tools, and model routing as in Slack; the web is just another channel.

**Questions it answers.** Anything you'd ask Shade in Slack, plus system questions ("what's running on shade?", "what did the infra bot change this week?").

**Layout.**
- **Conversation picker** (inside GPTChat's history sidebar, restyled). It lists Groups the operator can talk to, grouped as:
  - *Pinned*: the main group (`isMain`), Inbox
  - *Feature channels*: groups with `featureDriver: "brewery"`, with a phase badge
  - *Conversations*: other groups, sorted by last message
  - Each entry shows the group name, channel glyph (Slack, iMessage, email, web), an unread dot, and a needs-you dot if it has an open ask.
- **Conversation header**: group name, channel type and external link ("open in Slack ↗"), model chip (e.g. `claude · opus`), execution chip (`direct` or `zerg: shade|dash-ui`), a "running" spinner while a turn is in flight, and ⚙ (opens group settings, §6.8).
- **Message stream** (GPTChat). It renders:
  - User and Shade messages, in Markdown or **blocks** (§7.2)
  - Messages from other participants in the same Slack channel, with sender name (Slack users ≠ operator)
  - **Tool call cards**, collapsed by default and showing tool name plus a one-line summary ("search_history · 'trivia' · 12 results"). Expanding them shows args and result JSON. They can be hidden entirely with a "Show tool calls" toggle in the header.
  - **Ask cards** inline at the point the agent asked (§7.1). Answered asks collapse to a one-line summary with who answered and where.
  - **Progress messages** (from `orchestrator.progressMessageIntervalMs`) as a single updating "Working… 2m · last: running tests" line, not a stack of messages.
  - **System events** in the thread as muted dividers: "turn resumed (2/3) after timeout", "scheduled task dailyTriage ran", "brewery entered barrel".
- **Composer**: multiline text, attach files (images, PDFs → `onAttachFiles`), `/` to open the slash-command menu (§7.3), `@` to mention a group (routes the message there instead) or a running item (inserts a reference chip the agent can resolve). Enter sends; Shift+Enter adds a newline.
  - If the group requires a trigger (`requiresTrigger`) the composer **does not** need it. Web messages are always addressed to Shade.
  - While a turn runs, the send button becomes **Stop** (cancel the turn). Typing a new message while an ask is pending cancels the ask (Terreno's `user_sent_message` behavior), with a warning under the composer: "Sending will cancel Shade's pending question."
- **Suggested prompts** (empty conversation only): "What needs me?", "What's running on zerg?", "Summarize today", "Start a drone…".

**The Inbox conversation.** This is a synthetic conversation for asks that don't belong to a group (most zerg drones, lurker verdicts, edge-agent registrations). It shows only ask cards and their resolutions, newest at the bottom, and is what the Chat page opens to when there are pending asks and no group is selected.

**Actions.** Send, stop turn, retry last turn, rate a reply (👍/👎 → `onRateFeedback`, stored for session review), copy, open the trace for a reply (each Shade message links to its TaskRunLog and AIRequests).

**Settings surfaced.** Group model, execution mode, and trigger via ⚙ (§6.8).

**Empty/error.** "Shade is paused" banner, with a Resume button, when the kill switch is on. If the channel is disconnected, show "Slack is disconnected — messages from web still work; replies won't reach Slack." If the turn failed, show an error block with the TaskRunLog error and Retry.

**Data.** `Group`, `Message` (+ `richPayload`), `AgentSession`, `TaskRunLog`, SSE turn events (§10).

### 6.2 Inbox

**Purpose.** Work through every pending decision as fast as possible. This page is the triage view.

**Questions it answers.** What needs me? What does the agent recommend? What happens if I say yes?

**Layout.** A two-column list and detail view.
- **List** (left), grouped by urgency:
  1. *Approvals*: merge approvals, destructive tool approvals, edge-agent registration
  2. *Questions*: drone asks, brewery sign-offs and gates, Shade mid-turn asks
  3. *Problems*: zerg `fail`/`stall`/`attention`, failed AgentTasks past max attempts, failed scheduled runs, channels in error
  - Row: kind icon · source (repo|feature, group, or task name) · the question, truncated · age · "rec: …" when there's a recommendation.
- **Detail** (right):
  - **Context header**: the full source, links to the item detail, PR, and Slack thread.
  - **Why it's asking**: zerg `lastLines` (the last 20 lines from the session) collapsed in a code block; brewery `stepMessages` for the current step; for Shade asks, the turn's preceding messages.
  - **Evidence** (approvals only): the lurker verdict (`verified` at `sha`, with `evidence[]` as a list), PR checks summary, review decision, and diff stats (files, +/−).
  - **The ask card** (Terreno `AskCard`), with the agent's recommendation pre-selected and marked "recommended".
  - **After answering**: a toast saying "Answered — sent to drone", and the item moves to a *Resolved today* section at the bottom of the list. Undo is not offered: answers are delivered immediately.

**Bulk.** Multi-select is allowed for *Problems* only (e.g. "dismiss 4 stalls"). There are no bulk approvals or answers.

**Keyboard.** j/k to move, 1–9 to pick an option, Enter to submit, e to expand context, o to open the item.

**Filters.** Kind, repo, source (Shade/zerg), and age (> 1h, > 1d).

**Empty.** "Nothing needs you." Below it, show the count of things running and the next scheduled run, so the page is still informative.

**Data.** `GET /console/asks` (unified, §9), which merges the zerg inbox (`zerg inbox --all --json`), Feature `brewery.waiting`, Shade pending asks, and derived problems.

### 6.3 Running

**Purpose.** The full-page version of the rail: everything alive across Shade and zerg in one sortable, filterable table.

**Questions it answers.** What's running right now? What's stuck and for how long? What's using capacity? What finished recently?

**Layout.** A table with section headers (Needs you · Working · Scheduled · Idle · Recent).

| Column | Content |
|---|---|
| State | dot + word (needs-you, working, blocked, scheduled, idle, error, done) |
| Source | Shade ◆ / zerg ⬡ |
| Kind | group turn, agent task, scheduled task, feature, zerg session, drone, lurker, PR watch, infra change, edge agent, radio stream, movie job |
| Title | e.g. `shade|dashboard-design`, `dailyTriage`, `#feat-sse` |
| Doing now | last line / step / phase / current tool |
| Repo / Group | repo for zerg & features; group for Shade items |
| PR | `#112` + checks glyph (✓ ✗ ●) |
| Since | time in current state |
| Started | uptime / start time |
| Cost | Shade items: cost so far (sum of AIRequests for the run); zerg: — |
| Actions | kind-specific quick actions |

The **summary strip** above the table shows counts by state, drone capacity, worker concurrency (`running / taskWorker.concurrency`), and the global queue (`active turns / concurrency.maxGlobal`).

**Filters.** Source, kind, repo, group, state, "only mine started from UI". A saved filter can be pinned to the rail.

**Recent.** Done and failed items from the last 24h stay in a collapsed *Recent* section, so "it finished while I wasn't looking" is visible.

**Data.** `GET /console/running` (§9), with SSE `running.updated` patches.

### 6.4 Item detail, by kind

All detail views share a frame:

```
[glyph] Title                         state · since       [primary actions]
source · repo/group · started · links (PR ↗ Slack ↗ trace ↗ terminal ↗)
──────────────────────────────────────────────────────────────────────────
TABS:  Overview │ Timeline │ Output │ Asks │ Cost │ Raw
```

- **Overview**: kind-specific summary (below).
- **Timeline**: state transitions and events with timestamps and actor (UI / Slack / CLI / agent / timer).
- **Output**: logs, last lines, or step narration. Monospace, with a follow toggle, and paused by default.
- **Asks**: every ask this item raised, pending and answered, with answers.
- **Cost**: tokens and USD (Shade items only).
- **Raw**: the JSON record, for debugging.

The kind-specific parts:

#### Zerg session (plain `zerg run` session, no drone)
- **Overview**: repo, feature, agent (claude/codex/opencode), account, hive state (`running`, `orphan-tmux`, `orphan-container`), activity (`working`, `blocked`, `idle`, `error`, `exited`, `unknown`) with `since` and last hook `event`, uptime, TTL remaining, memory use, services ready (mongo), host ssh enabled.
- **Output**: last 30 lines from `tmux capture-pane`, refreshed on poll.
- **Actions**: *Send prompt* (text box → `hive serve` send), *Kill* (confirm ask, destructive), *Open in terminal* (copies `zerg run <repo> <feature>`), *Restart* if dead.
- **Not shown**: interactive terminal.

#### Drone (portfolio session)
Everything from a zerg session, plus:
- **Overview**: request prompt (the original `zerg start` text), terreno stage as a stepper (Grow → Pick → Roast → Brew → Taste with the current `stage/status`, e.g. `pick/PASS`), portfolio status (`queued`, `running`, `pending`, `blocked`, `stalled`, `attention`, `done`, `verified`, `failed`, `killed`), branch, PR with `state`/`mergeable`/`checks`, last reinvoked time, and the verdict once a lurker has run (`verified`/`refuted`/`inconclusive` at `sha`, evidence list).
- **Actions**: *Answer* (if an ask is open), *Verify* (`zerg verify` → spawns a lurker; disabled while one runs), *Approve merge* (only when the verdict is `verified` at the current PR head SHA; confirm ask that shows the evidence), *Kill*.
- **Linked lurker**: shown as a nested row with its own status.

#### Lurker
- **Overview**: which drone it verifies, the SHA, the verdict, and the evidence. It is read-only apart from Kill.

#### Feature (brewery feature channel)
- **Overview**: name, description, status (`planned`, `in_progress`, `awaiting_approval`, `paused`, `complete`, `error`); brewery `phase` as a stepper (distill → cut → sign-off → barrel → finish); `waiting` (sign-off or gate, and since when); workspace (`zerg: feat-<slug>` with a link to that zerg session, or local path); repo; PR + checks; the Slack channel; `lastEventAt` with a "silent for 23m" warning past `brewery.stepSilenceAlertMin`.
- **Output**: brewery step narration (`stepMessages`), grouped by step label, with the latest step expanded.
- **IP**: the distilled IP document rendered as Markdown, read from the workspace.
- **Actions**: *Sign off* / *Approve gate* (ask), *Steer* (`now:` with a free-text box), *Pause*, *Resume*, *Stop*, *Open PR*, *Open channel*.

#### Group turn (Shade agent turn in flight)
- **Overview**: group, trigger (message, scheduled, webhook, manual, delegated), backend and model, execution mode (direct or the zerg session), started, current tool, resume count (`n / orchestrator.maxResumes`), queue position if waiting.
- **Output**: streamed text and tool calls (the same stream the chat shows).
- **Actions**: *Stop turn*, *Open conversation*.

#### Agent task (task board)
- **Overview**: title, prompt, status (`pending` → `claimed` → `running` → `completed`/`failed`/`cancelled`), priority, worker id, heartbeat age (red past `taskWorker.staleMs`), attempts `n / maxAttempts`, deliver-result flag, parent task / spawning scheduled task / source message (all linked), result or error.
- **Actions**: *Cancel* (sets `cancelRequested`), *Retry* (new task, same prompt), *Bump priority*.

#### Scheduled task
- **Overview**: name, group, prompt, schedule type and expression with a human rendering ("every weekday at 7:00"), next 3 run times, status, classification, context mode (`group` or `isolated`), run count / max runs, last run result.
- **Runs tab**: TaskRunLog history (status, trigger, duration, model, cards, error), each run linked to its trace.
- **Actions**: *Run now*, *Pause*, *Resume*, *Edit*, *Cancel*.

#### PR watch
- **Overview**: repo, PR number and title, branch → base, draft, conflicts, mergeable, check runs (name, status, conclusion, link), CI passing, reviews (reviewer, state, bot or human, responded?), review decision, unreplied human comments, auto-fix status, type, and last attempt.
- **Actions**: *Stop watching*, *Open PR*, *Retry auto-fix*.

#### Infra change
- **Overview**: repo handle (from `infraBot.repos`), PR, branch, title, status, CI, review decision, `lastSummary`, and the group notified.
- **Actions**: *Open PR*. There is **no merge button**: the infra bot never merges, and neither does this UI.

#### Edge agent
- **Overview**: name, type, status (`pending`, `approved`, `online`, `offline`, `error`), platform and arch, version, hostname, heartbeat age, capabilities, channel, pending commands, last command results.
- **Actions**: *Approve* / *Revoke*, *Send command* (type + JSON payload form), *Edit config*.

#### Radio stream / trivia monitor
- **Overview**: stream name, URL, status, transcription on/off, reconnect count, error, recent transcripts (last 5 batches); trivia monitor on/off with recent detected questions.
- **Actions**: *Start*, *Stop*, *Toggle transcription*, *Toggle trivia monitor*, *Toggle auto-search*.

#### Movie job
- **Overview**: progress (frames processed / total), extraction config, status, error.
- **Actions**: *Cancel*, *Retry*, *Open in Movies*.

### 6.5 Portfolio (repos, backlog, drones)

**Purpose.** The zerg-wide view, organized by repo, and the place to start new work.

**Questions it answers.** What is each repo doing? How much drone capacity is left? What's in the backlog I could dispatch?

**Layout.**
- **Capacity header**: drones `running / maxDrones`, queued drones, the next timer passes (reinvoke every 5m, watchdog every 15m, nightly sweep at 04:00) with time until the next run.
- **Repo cards** (one per `repos.json` entry: flourish, terreno, gitsight, skybound, shade, …):
  - name, account (flourish, skybound, personal), default agent, resources (cpus, memory), services
  - counts: sessions, drones by status, open asks
  - a mini list of active sessions/drones (click → detail)
  - **Start drone** button
- **Backlog tab**: `zerg backlog --json` (issues and IPs per repo), each with *Dispatch* (pre-fills Start drone).

**Start drone dialog** (a `form` ask rendered locally, so chat and UI share it):
- Repo (select)
- Request (markdown; the prompt the drone gets)
- Feature slug (optional; auto-derived)
- Agent override (optional)
- Submitting calls `zerg start <repo> "<request>" [--feature]` and creates a Running row in `queued` state.

**Settings surfaced** (read-only here, edited in Settings → zerg): ssh host, `maxDrones` (read from zerg's `repos.json`, not editable from Shade).

### 6.6 Features

**Purpose.** Brewery feature channels as a pipeline board. This replaces the current `features/` screens.

**Layout.** A kanban by status (Planned · Distilling · Awaiting sign-off · Barreling · Finishing · Complete · Error/Paused), or a table toggle. Each card shows the name, repo, phase, waiting badge, PR + checks, last event age, and the Slack channel.

**Actions.** *New feature* (form: name, description, repo, auto-approve sign-off? → `create_feature`), plus the per-card actions from §6.4.

**Settings surfaced.** Feature channels and brewery sections (link to Settings → Features & brewery).

### 6.7 Automations

**Purpose.** Everything that makes Shade act without being messaged: schedules, built-in tasks, webhook sources, and classification rules. The mock Console's "Automations — visual, not YAML" pane is the starting point.

**Layout.** Tabs:

1. **Schedules**: a table of ScheduledTasks: name, group, human schedule, next run, last run status, run count, status toggle. Row → detail (§6.4).
   - *New schedule* form: name, group (select), prompt (markdown), type (cron, interval, once), schedule input with a live human preview and the next 3 run times, context mode (group or isolated), classification, max runs.
2. **Built-ins**: `dailyTriage` and `sessionReview`, each with an enabled toggle, cron (with preview), last run, and *Run now*. Session review thresholds live here too (§8).
3. **Webhooks**: WebhookSources (name, type, target group, endpoint URL with a copy button, classification, enabled, last received). *New source* form. The notifications relay (`/webhooks/notifications` → Slack) shows here with its URL.
4. **Routing rules**: CommandClassifications (pattern → classification → route, priority), with a "test a message" box that shows which rule matches.

**Settings surfaced.** `scheduler.useTaskBoard` (run schedules on the task board vs inline), `pollIntervals.scheduler`.

### 6.8 Conversations (groups)

**Purpose.** Manage who Shade talks to and how it behaves in each place.

**Layout.**
- A table of Groups: name, channel, main?, trigger, model, execution mode, last message, open sessions, cost (7d).
- **Group settings** (also opened from the chat ⚙):

| Setting | Field | Control | Notes |
|---|---|---|---|
| Name | `name` | text | |
| Trigger word | `trigger`, `requiresTrigger` | text + toggle | "Only respond when addressed"; web ignores this |
| Main group | `isMain` | toggle | only one; receives system notifications |
| Model backend | `modelConfig.defaultBackend` | select: claude, codex, gemini, ollama, mock | |
| Model | `modelConfig.defaultModel` | select (filtered by backend) / text | empty = `agent.model` |
| Fallback backend | `modelConfig.fallbackBackend` | select | |
| Endpoint | `modelConfig.endpoint` | text | ollama only |
| Execution | `executionConfig.mode` | segmented: direct / container | |
| zerg repo | `executionConfig.zergRepo` | select from repos.json | container only |
| zerg feature | `executionConfig.zergFeature` | text, placeholder = slug | container only |
| Turn timeout | `executionConfig.timeout` | duration | |
| Idle timeout | `executionConfig.idleTimeout` | duration | |
| Max concurrent | `executionConfig.maxConcurrent` | number | |
| Group memory | per-group `CLAUDE.md` | link → Memory | |
| Sessions | AgentSessions | list: id, status, messages, last activity; *Archive* / *Start fresh* | |
| Danger | | *Clear session*, *Delete group* | confirm asks |

- **Channels tab**: the Channels list (type, status, privileged, last connected) with *Reconnect* (runs the `reconnectChannels` script for that channel) and a link to Integrations for credentials.

### 6.9 Traces & cost

**Purpose.** Understand what Shade did, how long it took, and what it cost. This page is for investigation.

**Layout.** Tabs:
1. **Runs**: TaskRunLog table: started, group, trigger, model, status (`running`, `completed`, `failed`, `timeout`, `resumed`), duration, cards, resume count, cost (joined AIRequests). Filters: group, trigger, status, model, date. Row → run trace:
   - The prompt, the result or error, then a waterfall of AIRequests (model, tokens, cost, response time) and tool calls in order, linked to the AgentSession transcript.
2. **Sessions**: AgentSessions with message count, last activity, total cost, and a flagged column from `review_sessions` (long run, long session, expensive) with the threshold that triggered it.
3. **Cost**: charts of cost per day (stacked by model), cost by group, and cost by request type. A table of the top 10 most expensive runs this week. The data is the same as the `aiCostSummary` admin script.
4. **Requests**: the raw AIRequest list (model, type, status, tokens, cost, response time) for debugging.

**Settings surfaced.** Session review thresholds (link), logging level (link).

### 6.10 Memory & skills

**Purpose.** See and edit what Shade remembers and knows how to do.

**Layout.**
- **Left tree**: *Identity* (`SOUL.md`, `USER.md`), *Global* (`CLAUDE.md`), *Groups* (one `CLAUDE.md` per group), *Skills* (one entry per skill in `SHADE_DATA_DIR/skills/`).
- **Right**: a Markdown editor with preview, a character count against `memory.maxFileChars` / `memory.maxSkillChars` (amber at 90%, blocked over), last modified time, and who modified it (agent via `update_memory`/`save_skill`, or the operator).
- **History**: the last N versions as diffs, if we start keeping them (proposed: store versions on save; today these are plain files).
- **Search history** box: runs `search_history` over messages, limited to `memory.historySearchLimit`.

**Settings surfaced.** `memory.enabled`, `maxFileChars`, `maxSkillChars`, `historySearchLimit`.

**Data.** New endpoints `GET|PUT /memory/{global,user,soul,groups/:id,skills/:name}` (from IP-013).

### 6.11 Integrations

**Purpose.** Connections to the outside world, with their health and credentials, one card each. Every card shows status, a *Test* button where possible (uses `testApiKeys`), and its settings form.

| Card | Shows | Settings |
|---|---|---|
| **Slack** | channels connected, last connected, error | channel config (tokens write-only) |
| **iMessage / SMS** | status, poll interval | reply allowlist (list editor), SMS reply numbers |
| **Email** | IMAP accounts, status | per-channel config |
| **Edge agents** | list (status, heartbeat, platform); pending registrations flagged | approve/revoke, commands (§6.4) |
| **zerg** | reachable?, last dash time, `notes[]` errors | see §8 zerg section |
| **GitHub / PR watch** | watched PRs count, last poll, auto-fix stats | PR watch section (§8) |
| **Infra bot** | allowlisted repos, open infra PRs | infra bot section incl. repo allowlist editor |
| **Media (MCP)** | Sonarr, Radarr, NZBGet, Plex reachability | base URLs, keys (write-only), port, auth token |
| **Apple** | calendars, reminder lists, last sync (via edge agent) | CalendarConfig; *Sync now* |
| **Search providers** | Brave, Exa, Tavily key status | keys (write-only) |
| **LLM providers** | Anthropic, OpenAI, OpenRouter key status, today's spend per provider | keys (write-only); restart-required badge |
| **Speech / audio** | Deepgram, ACRCloud | keys (write-only) |
| **Maps** | Mapbox token set? | token (write-only) |
| **Notifications** | enabled, Slack channel | §8 |

### 6.12 Settings

**Purpose.** Curated AppConfig editing, grouped by what you're trying to do rather than by schema. The full exposure decisions are in §8.

**Layout.** A left list of sections and a right form. Each field has a label, help text, units, a default value hint, and validation. Save is per section, with a diff preview ("3 changes"), and fields marked *restart required* (the `RESTART_REQUIRED_FIELDS` in `utils/configEnv.ts`) show a badge. After saving, a banner reads "Restart Shade for these to take effect" when any are touched.

**Sections.** General · Agent & models · Concurrency & reliability · Memory · Task worker & scheduler · zerg · Features & brewery · PR watch · Infra bot · Radio & trivia · Messaging (iMessage, notifications, rich responses) · Secrets & keys · Advanced (poll intervals, logging, test mode) · Maintenance (admin scripts).

**Maintenance** runs the admin scripts as buttons, with output in a log drawer: System status, AI cost summary, Test API keys, Reconnect channels, Reload config cache, Rotate JWT secrets (confirm ask; logs everyone out), Cleanup old data (form: older than N days, dry run first), Retry failed movies.

### 6.13 Domain apps

These keep their existing screens and move under an **Apps** menu. Their long-running jobs appear in Running. No redesign is planned in this brief.
- **Movies** (`movies/`): list, process, frames, characters.
- **Search** (`search.tsx`): frame analysis search.
- **Reminders & calendars**: Apple data with sync, create, complete.
- **Radio & trivia** (new small screen): streams list with start/stop, the transcripts feed, trivia monitor toggle and status, recent questions and scores. This replaces doing it only through Slack commands and tools.

---

## 7. Chat in depth

### 7.1 Asks catalog

Each row is an ask Shade's UI must render. "Card content" is what appears above the controls.

| # | Ask | Kind | Card content | Options / fields | Default | On answer |
|---|---|---|---|---|---|---|
| A1 | Drone question (`ask`/`blocked` with `opts`) | `choice` (one), `allowOther` | repo|feature, stage, the question, last lines (collapsed) | drone `opts` | drone `rec` | `zerg answer <id> "<text>"` |
| A2 | Drone question (free-form) | `markdown` | same | text | `rec` as initial draft | `zerg answer` |
| A3 | Merge approval (`approve`) | `confirm`, `destructive` | PR title, checks, verdict + evidence blocks, diff stats, SHA | "Merge" / "Not yet" | none | `zerg approve <id>` (single merge path) |
| A4 | Drone failed / stalled / attention | `choice` | status, last lines, time stalled | Reinvoke · Verify · Kill · Ignore | Reinvoke | the matching `zerg` verb |
| A5 | Brewery sign-off | `choice` + optional note | IP summary (blocks), open questions from the IP | Approve · Approve with note · Request changes · Stop | none | brewery `answer` (`ok`, `now: …`, `stop`) |
| A6 | Brewery gate | `choice` | gate name, what passed and failed | Continue · Steer (text) · Pause | Continue | brewery driver |
| A7 | Shade mid-turn question | any kind | agent-authored | agent-authored | agent-authored | resumes the turn |
| A8 | Tool approval | `confirm` (`origin: approval`) | tool name, human summary of args, classification | Allow · Deny | none | runner gate continues or fails the tool |
| A9 | Edge agent registration | `confirm` | name, hostname, platform, capabilities | Approve · Reject | none | `/api/edge/agents/:id/approve` or revoke |
| A10 | Kill / delete / rotate confirmations | `confirm`, `destructive` | what will happen | Confirm · Cancel | Cancel | the action |
| A11 | Start drone / new schedule / new feature | `form` | | fields per §6.5–6.7 | | the create call |

**Which tools need approval (A8).** Proposed initial list, configurable in Settings → Agent: `delete_data`, `send_message` to a channel other than the current one, `submit_infra_change`, `create_feature`, `cancel_agent_task`, `set_allowed_users`, `add_sms_reply_number`. This makes the existing `classification` field (`public`/`internal`/`sensitive`/`critical`) meaningful: `critical` tools always ask.

### 7.2 Blocks catalog (Shade compositions)

These are built from Terreno's closed block set (`heading`, `text`, `metric`, `badge`, `divider`, `context`, `chart`, `table`, `actions`, `columns`, `card`).

| Composition | Blocks | When Shade uses it |
|---|---|---|
| **Status summary** | `columns` of `metric` (Needs you, Working, Drones n/12, Cost today) + `actions` (Open Inbox) | "what's going on?" |
| **Running table** | `table` over a dataset `ref` to `/console/running` (filtered) + `actions` per row | "what's running on shade?" |
| **Session card** | `card`: `heading` repo\|feature, `badge` state, `context` stage · since, `text` last 3 lines, `actions` (Open, Answer, Kill) | answering about one session |
| **PR card** | `card`: title, `badge` checks, `badge` review decision, `context` branch, `actions` (Open PR, Approve if eligible) | infra changes, drone PRs, PR watch |
| **Run report** | `metric` duration/cost/tokens + `table` of tool calls + `text` result | "why did X fail?" |
| **Schedule preview** | `table` of next runs + `actions` (Create, Edit) | before creating a schedule |
| **Cost chart** | `chart` (bar, cost per day by model) + `table` top runs | "what did I spend this week?" |
| **Existing rich cards** | `RichResponse` → blocks via `responses/renderers/terreno.ts`: `text`→`text`, `table`→`table`, `list`→`table`/`text`, `code`→`text` (fenced), `error`→`card`+`badge`, `image`→`image`, `weather`/`map`→`card`+`metric`, `yes_no`→ask A7 | everything Shade already sends to Slack |

`actions` use `kind: "callback"` → `POST /gpt/actions` host actions, mapped to the same handlers as panel buttons. A callback that is a decision (approve, kill) always goes through its confirm ask; a button click is never final for destructive actions.

### 7.3 Slash commands

| Command | Does |
|---|---|
| `/status` | status summary block |
| `/running [repo]` | running table |
| `/inbox` | jump to the Inbox conversation |
| `/start <repo> <request>` | start drone (form ask pre-filled) |
| `/feature <name>` | new feature (form ask) |
| `/schedule` | new schedule (form ask) |
| `/run <task>` | run a scheduled task now |
| `/pause [all\|<task>\|trivia]`, `/resume …` | pause/resume |
| `/kill <session>` | kill (confirm ask) |
| `/implement` | existing feature-channel command |
| `/trivia`, `/moviesearch` | existing `!` commands, aliased |
| `/model <name>` | change this group's model (confirm) |
| `/new` | start a fresh session in this group |

### 7.4 Agent tools the UI relies on

Existing tools Shade can already use to answer UI questions: `list_zerg_sessions`, `list_agent_tasks`, `get_task_result`, `cancel_agent_task`, `list_tasks`, `schedule_task`, `pause_task`, `resume_task`, `cancel_task`, `create_feature`, `complete_feature`, `review_sessions`, `get_infra_change_status`, `list_infra_repos`, `prepare_infra_change`, `submit_infra_change`, `list_radio_streams`, `start_radio_stream`, `stop_radio_stream`, `toggle_trivia_monitor`, `trivia_monitor_status`, `search_history`, `update_memory`, `list_skills`, `load_skill`, `save_skill`, `respond_with_card`/`rich_response`.

New tools needed:
- `ask_choice`, `ask_confirm`, `ask_markdown`, `ask_form`, `ask_files`: the Terreno ask kinds, as Shade MCP tools that pause the turn (§7.5)
- `zerg_answer`, `zerg_start`, `zerg_verify`, `zerg_kill`: write verbs (answering and starting only; **no** `zerg_approve` tool, so the agent can never merge; approval only happens via a human answering A3)
- `list_running`: the unified feed, so chat answers match the panels exactly
- `list_inbox`: pending asks across sources

### 7.5 How a Shade ask pauses and resumes

1. The agent calls `ask_choice({...})`. The MCP tool validates the input with `@terreno/blocks`, writes a `pendingAsk` on the AgentSession (`toolCallId`, kind, input, groupId, created), emits SSE `ask.created`, and returns a "waiting for user" sentinel. The runner ends the turn cleanly and checkpoints the session (the same mechanism used for timeouts and resumes).
2. If the group's channel is Slack, the ask is also rendered there as Block Kit buttons (via the existing Slack renderer). Whichever channel answers first wins.
3. The answer arrives (`POST /console/asks/:id/answer`), is validated (`validateResponse`) and atomically claimed, and a synthetic message is enqueued for the group: "ask answer" carrying the `toolCallId` and response. The runner resumes the SDK session and injects the answer as the tool result.
4. If the operator sends a normal message instead, the ask is cancelled (`user_sent_message`) and the agent sees that.
5. If the turn times out while waiting, nothing is lost. The ask stays pending until answered or until it expires after a configurable TTL (proposed 7 days), which then cancels it.

---

## 8. Settings exposure matrix

Legend: **E** = editable in the curated Settings UI · **R** = read-only display · **S** = secret (write-only: shows "set ✓", replace, test) · **A** = admin-only (leave in raw `/admin`) · **↻** = restart required.

| AppConfig section | Field(s) | Expose | Where | Notes |
|---|---|---|---|---|
| General | `assistantName` | E | Settings → General | shown in chat header |
| | `triggerPattern` | E | General | global default trigger |
| | `dataDir` | R ↻ | General | path; editing is risky |
| | `publicUrl` | E ↻ | General | used for webhook URLs shown in UI |
| Agent | `agent.model` | E | Agent & models | select from known models |
| | `agent.auxiliaryModel` | E | Agent & models | |
| | `agent.maxTurns` | E | Agent & models | |
| | `agent.progressIntervalMs` | E | Agent & models | seconds in UI |
| | `agent.allowedTools` | E | Agent & models | multi-select of tool names + **approval column** (new, §7.1 A8) |
| | `agent.enableSubagents` | E | Agent & models | |
| Models | `models.answerer/detector/planner` | E ↻ | Agent & models | trivia / feature planner models |
| Concurrency | `concurrency.maxGlobal` | E | Concurrency & reliability | shows live usage beside it |
| Orchestrator | `orchestrator.maxRetries`, `baseRetryDelayMs`, `maxResumes`, `progressMessageIntervalMs`, `conversationWindowMs` | E | Concurrency & reliability | durations in human units |
| | `orchestrator.paused` (new) | E | top bar Pause all | not in the form |
| Memory | `memory.*` | E | Memory | also shown on the Memory page |
| Task worker | `taskWorker.enabled`, `concurrency`, `taskTimeoutMs`, `runInGateway` | E | Task worker & scheduler | |
| | `taskWorker.pollMs`, `heartbeatMs`, `staleMs` | E | Advanced | |
| Scheduler | `scheduler.useTaskBoard` | E | Task worker & scheduler | |
| Built-in tasks | `builtinTasks.dailyTriage/sessionReview` | E | Automations → Built-ins | toggle + cron |
| Session review | `sessionReview.*` | E | Automations → Built-ins | thresholds with units |
| zerg | `zerg.enabled`, `sshHost`, `cacheMs` | E | zerg | *Test connection* runs `zerg dash --json` |
| | `zerg.command`, `upVerb`, `attachVerb`, `dashVerb`, `inboxVerb`, `workdir`, `claudeCommand`, `upTimeoutMs`, `envPrefixes` | E | zerg → Advanced (collapsed) | plumbing; rarely touched |
| Feature channels | `featureChannels.*` | E | Features & brewery | |
| Brewery | `brewery.command`, `agents` | E | Features & brewery → Advanced | |
| | `brewery.pollIntervalMs`, `narrationFlushMs`, `maxNarrationLines`, `stepSilenceAlertMin` | E | Features & brewery | |
| PR watch | `prWatch.enabled`, `groupId`, `githubUsername`, `pollIntervalMs`, `autoRespondToBots`, `autoFixConflicts`, `botResponseModel`, `reposBaseDir` | E | PR watch | group = select |
| | `prWatch.prompts.*` | E | PR watch → Prompts | large markdown editors |
| Infra bot | `infraBot.enabled`, `groupId`, `gitUserName`, `gitUserEmail`, `watchPollIntervalMs`, `branchPrefix`, `reposBaseDir` | E | Infra bot | |
| | `infraBot.repos[]` | E | Infra bot → Allowlist | list editor (name, git URL, owner, repo, deploy branch, description); adding a repo is a confirm ask ("this widens what the bot may change") |
| iMessage | `imessage.replyAllowlist` | E | Messaging | list editor |
| Notifications | `notifications.*` | E | Messaging | |
| Rich responses | `richResponses.*` | E | Messaging | |
| Radio | `radioTranscriber.*` | E | Radio & trivia | |
| Trivia | `triviaMonitor.enabled`, `groupId`, `allowedUserIds` | E | Radio & trivia | |
| | `triviaMonitor.questionsWebhook`, `answersWebhook` | S | Radio & trivia | |
| | `triviaResearchSystemPrompt` | E | Radio & trivia → Prompts | |
| | `triviaStats.slackWebhook`, `blueskyPassword` | S | Radio & trivia | |
| | `triviaStats.blueskyIdentifier` | E | Radio & trivia | |
| API keys | `apiKeys.*` (all) | S ↻ | Secrets & keys (+ each Integration card) | *Test* via `testApiKeys` |
| MCP media | `mcpMedia.*.baseUrl`, `port`, `nzbget.username` | E | Integrations → Media | |
| | `mcpMedia.authToken`, `*.apiKey`, `nzbget.password`, `plex.token` | S | Integrations → Media | |
| Maps | `maps.mapboxAccessToken` | S | Integrations → Maps | |
| Auth | `auth.tokenSecret`, `refreshTokenSecret` | A ↻ | Maintenance → Rotate JWT secrets only | never shown or typed |
| Poll intervals | `pollIntervals.*` | E | Advanced | |
| Logging | `logging.level` | E ↻ | Advanced | |
| Test mode | `testMode.*` | A | /admin | dev-only |

**Model-level settings outside AppConfig** that the UI edits: Group config (§6.8), ScheduledTask (§6.7), WebhookSource and CommandClassification (§6.7), Channel config (§6.11), EdgeAgent config (§6.4), CalendarConfig (§6.11). Plugins and LlmFixtures stay in `/admin`.

**Settings that live in zerg, not Shade** (shown read-only, with a note "edit in zerg `repos.json`"): registered repos, `maxDrones`, per-repo resources, notify targets.

---

## 9. Backend surface this needs

**New aggregate endpoints (Shade)**

| Endpoint | Purpose |
|---|---|
| `GET /console/running` | unified `RunningItem[]` (§9.1) with filters |
| `GET /console/asks?status=` | unified asks across zerg inbox, brewery, Shade, edge agents, derived problems |
| `POST /console/asks/:id/answer` | validate → route to `zerg answer` / `zerg approve` / brewery / Shade resume / edge approve |
| `GET /console/status` | top bar: health, capacity, needs-you count, cost today, paused |
| `POST /console/pause`, `/console/resume` | kill switch |
| `GET /console/stream` | SSE (§10) |
| `POST /zerg/start`, `/zerg/:session/{send,kill,verify}` | zerg write verbs via the existing ssh/CLI path (no approve endpoint; approval only via an answered A3 ask) |
| `GET /zerg/backlog`, `GET /zerg/repos` | Portfolio |
| `GET|PUT /memory/...` | Memory page (from IP-013) |
| `POST /scheduledTasks/:id/{run,pause,resume}` | Automations (from IP-013) |
| `POST /agentTasks/:id/{cancel,retry}` | task board |
| `GET /console/runs/:id/trace` | run waterfall (TaskRunLog + AIRequests + tool calls) |
| `GET /console/cost?range=` | cost aggregates |
| `POST /admin-scripts/:name` | Maintenance buttons (wrap existing scripts) |
| `/prWatches`, `/infraChanges` CRUD (read for auth users) | today they're admin-only |
| `POST /gpt/actions` | block callback actions |

### 9.1 RunningItem

```ts
interface RunningItem {
  id: string;                 // "<source>:<kind>:<nativeId>"
  source: "shade" | "zerg";
  kind: "group-turn" | "agent-task" | "scheduled-task" | "feature" |
        "zerg-session" | "drone" | "lurker" | "pr-watch" | "infra-change" |
        "edge-agent" | "radio-stream" | "movie-job";
  title: string;
  state: "needs-you" | "working" | "blocked" | "scheduled" | "idle" | "error" | "done";
  doingNow?: string;
  since: string;              // ISO
  startedAt?: string;
  repo?: string;
  groupId?: string;
  pr?: {number: number; url: string; checks: "pass" | "fail" | "pending"; mergeable?: boolean};
  costUsd?: number;
  askIds: string[];
  links: {label: string; url: string}[];
  actions: {id: string; label: string; destructive?: boolean; askKind?: string}[];
}
```

### 9.2 Chat transport

A new `web` channel type in `orchestrator/channels/web.ts`. Outbound messages and turn events go to the SSE stream instead of an external service. An adapter maps `Message[]` ⇄ `GPTChatMessage[]` (role from `isFromBot`/sender, `richPayload` → blocks, tool calls from the turn event log). GPTChat's `onSubmit` → `POST /command` (exists) with `{groupId, content}`.

**Why not adopt `@terreno/ai`'s server:** it would make web Shade a different agent from Slack Shade (a different loop, no Claude SDK sessions, skills, or zerg container execution, and separate history). Shade uses `@terreno/blocks` for schemas and validation and `@terreno/ui` for rendering, and keeps its own runner.

## 10. Real-time, notifications, and states

**Transport.** One SSE stream, `GET /console/stream`, authenticated with the Shade JWT:
- `running.updated` (patch of changed items), `running.removed`
- `ask.created`, `ask.resolved` (with `answeredVia: "web"|"slack"|"cli"|"agent"`)
- `turn.started`, `turn.delta` (text), `turn.tool`, `turn.blocks`, `turn.done`, `turn.error`
- `status.updated` (top bar)

Shade polls zerg server-side on one shared timer (`zerg.cacheMs`), diffs the results, and emits patches. Optionally it subscribes to zerg's ntfy topic for instant blocked/idle transitions. The browser never talks to zerg or `hive serve`. On reconnect the client refetches `/console/running` and `/console/asks` and resumes.

**Browser notifications** (opt-in, per kind): new needs-you item, drone verified (ready to approve), feature awaiting sign-off, run failed. They are never sent for routine progress. Clicking one opens the Inbox item.

**Staleness.** Every panel shows "updated 12s ago". If zerg data is older than 3× `cacheMs` or the dash returned `notes[]` errors, the zerg health dot turns amber and zerg rows get a "stale" tag. The data is not hidden.

**Optimistic UI.** Allowed for pause/resume toggles only. Answers, kills, and approvals wait for confirmation and show a pending spinner on the card.

**Shared component states.** Loading skeleton → content → empty (with a helpful next step) → error (with the source named, e.g. "zerg unreachable: ssh timeout", and Retry). Never a blank pane.

## 11. Dependencies & risks

| Item | Status | Impact | Mitigation |
|---|---|---|---|
| Terreno asks (`@terreno/blocks`, `AskCard`) | open PR #1402 | §7.1 | land it first, or pin the branch build |
| Terreno blocks (`BlocksView`, `uiBlocks`) | IP approved, unbuilt | §7.2 | ship chat with Markdown + existing rich cards; add blocks when they land |
| Terreno version gap | Shade `^0.25.0`; master 57.x; backend lock resolves `@terreno/api@0.3.1` | everything | upgrade as phase 0; investigate the lock mismatch |
| Shade ask pause/resume | new | §7.5 | build on the existing timeout/resume checkpointing |
| zerg write path | answer/approve are CLI-only by design | §6.2, §6.4 | call the CLI over the existing ssh path; no approve tool for the agent; keep zerg's single-merge-path tests green |
| Cross-channel ask races | new | A1–A9 | atomic claim (zerg inbox rename; Mongo findOneAndUpdate on Shade side); show "answered via X" |
| Secrets in the browser | API keys | §8 | write-only fields; never returned by GET |
| PHI | Shade is personal, not Flourish | n/a | flourish drones show repo names and last lines only; note that terminal output from flourish sessions could contain sensitive data. Consider redacting `lastLines` for repos marked sensitive in Shade config |

## 12. Phasing

0. **Upgrade.** Move to current Terreno, fix the backend lock, and add `@terreno/blocks`.
1. **See everything.** `/console/running`, `/console/status`, shell (top bar, rail, context panel), Running page, item details for zerg sessions/drones/features/agent tasks/scheduled tasks. Replace the mock Console. Polling first.
2. **Decide everything.** Unified asks: zerg inbox (answer + approve via CLI), brewery gates, edge registrations. Inbox page, notifications.
3. **Talk.** `web` channel, GPTChat adapter, SSE stream, `terreno.ts` renderer for rich cards, slash commands.
4. **Shade asks and approvals.** `ask_*` tools, pause/resume, tool approval gate.
5. **Operate.** Automations, Conversations/group settings, Portfolio + start drone, Features board.
6. **Understand and tune.** Traces & cost, Memory & skills, Integrations, curated Settings, Maintenance.
7. **Blocks.** Status, PR, and session compositions with dataset refs and callback actions (once Terreno blocks lands).

## 13. Open questions

1. **Inbox shape.** One shared Inbox conversation for groupless asks (proposed), or one conversation per drone so you can chat with each drone about its question?
2. **Slack ↔ web parity.** Should every Slack group be a chat conversation in the web (proposed: yes, same Group, replies go to Slack too), or should the web have its own main group only?
3. **Merge from the browser.** Is a one-click "Merge" on a verified drone acceptable, or should A3 require typing the PR number to confirm?
4. **Blocks timing.** Wait for Terreno blocks, or ship chat with Markdown + existing rich cards and add blocks later (proposed)?
5. **`hive serve`.** Retire its web page once this exists, or keep it as a zerg-only fallback for when Shade is down (proposed: keep)?
6. **Tool approvals.** Is the initial A8 list right, and should approval be required per call or "allow for this session"?
7. **Memory history.** Start versioning memory and skill files on save so the Memory page can show diffs and revert?
8. **Sensitive repos.** Redact `lastLines` for flourish sessions in the UI, or is the operator-only access enough?
