# Implementation Plan: Brewery-Driven Feature Channels

**Status:** Open
**Priority:** High
**Effort:** Medium batch (3-5 days)
**IP:** IP-018

Feature channels stop running a Claude agent that plans and codes on its own. Shade drives every
feature through brewery (`tools/brewery`): distill writes the plan, Shade posts it to the channel
for approval, your reply goes to `brewery answer`, and barrel/finish take it to a green PR. While
it runs, Shade posts live progress to the channel: each stage's start and result plus the step
agent's own narration, like Claude Code's thinking summaries.

> "report back progress at it goes, like the thinking summaries i'd see in a claude code … using
> brewery to create a plan first, message me back with the plan for approval, then complete.
> ensure it always uses brewery, not claude code directly"

## Decisions (from clarification, 2026-09-28)

| # | Question | Answer |
|---|----------|--------|
| 1 | Who runs brewery | **Shade backend runs it.** No Claude agent turn ever runs in a brewery feature channel. |
| 2 | Where | **zerg container when `AppConfig.zerg.enabled`, otherwise mini** against a per-feature worktree of `featureChannels.localReposDir/<repo>`. This is the same rule `planFeatureWorkspace` already uses. |
| 3 | Progress detail | **Stages + narration.** brewery emits an events stream; Shade posts one Slack message per step and edits it as narration arrives. |
| 4 | Messages mid-run | **`now: …` interrupts** (kill the current step, record the note, resume). Anything else is **queued** as a note that later steps see, applied at the next sign-off or gate. `stop` cancels the run. |

## How "always brewery" is enforced

- `GroupQueue.selectRunner` never returns an agent runner for a group with `featureDriver: "brewery"`. Those
  messages go to `BreweryDriver.handleMessage` instead. A test asserts that the runner is never invoked
  for such a group, including for the seeded request.
- `create_feature` always creates brewery-driven groups. The old roast `FEATURE_CHANNEL_MEMORY` and
  greeting are removed, not kept as a fallback.
- If brewery can't start (missing binary in the container, or `brewery agents` shows no agent for a stage),
  the channel gets an error with the fix, and the Feature goes to `error`. **It never falls back to a
  Claude agent.**
- Existing feature groups (`featurePhase: implementing` without `featureDriver`) keep their current
  behavior until they're closed. No migration rewrites in-flight channels.

## brewery changes (`tools/brewery`)

1. **Events stream.** Append JSON lines to `.terreno/brewery/<slug>/events.jsonl`:
   `{t, kind, …}` where `kind` is one of:
   - `step.start` `{seq, stage, task?, agent}` / `step.end` `{seq, status, action, seconds}`
   - `narration` `{seq, text}`: assistant text blocks and one-line tool summaries
     (`Read groupQueue.ts`, `Bash: bun test …`), each truncated to 300 chars
   - `waiting` `{kind: signoff|gate, message, ip?}` / `resumed` / `note` `{text}`
   - `pr` `{number, url}` / `ci` `{state}` / `done` / `error` `{message}`
2. **Streamed agent output.** claude profiles run `--output-format stream-json --verbose`, and codex runs
   `exec --json`. `runAgent` still writes the raw log file and parses each line into `narration`
   events. `command` profiles only get step start and end. Result-file handling doesn't change.
3. **`brewery note <slug> "<text>"`** appends the text verbatim to `context.md` (so cut sees it) and
   adds it to `state.notes`. `header()` then shows notes to every later step as "the human added,
   mid-run".
4. **`brewery resume <slug> [--go]`** continues from `state.phase`. `distill` re-runs distill with
   the saved request and notes, `approved/build/review/brew` goes to barrel (passed tasks are
   skipped, as they are today), and `finish` goes to finish. It refuses to run while another process holds
   the run lock.
5. **Run lock + pid.** Write `.terreno/brewery/<slug>/run.pid` while a command runs, so Shade can
   kill the process group for `now:` and `stop`.

## Models

`Group` (+ `groupTypes.ts`): `featureDriver?: "brewery"`.

`Feature` (+ types): add status `awaiting_approval`, plus a `brewery` subdocument:

```ts
brewery?: {
  slug: string;
  repo: string;
  workspace: {kind: "zerg"; session: string} | {kind: "local"; repoPath: string};
  phase?: string;            // mirrors brewery state.phase
  waiting?: {kind: "signoff" | "gate"; since: Date};
  eventsOffset: number;      // bytes of events.jsonl already posted
  stepMessages: {seq: number; ts: string}[];   // Slack message per step, for edits
  pr?: number;
  lastEventAt?: Date;
}
```

`AppConfig.brewery` (+ types, admin UI): `command` (default `brewery`), `pollIntervalMs` (5000),
`narrationFlushMs` (4000), `maxNarrationLines` (8 per step message), `agents` (optional
`--agents` override string), `stepSilenceAlertMin` (30).

## Backend

New `backend/src/orchestrator/services/breweryDriver.ts`:

- **`start({feature, group, request})`** is called from the `create_feature` IPC handler in place of the
  seed message and roast memory. It resolves the workspace (zerg session via `zerg run`, the same as
  `ZergAgentRunner.ensureSession`; or local: `ensureLocalRepo` + `git worktree add`), writes the
  request to a file in the workspace, and launches `brewery distill --file … --slug … --no-wait`
  detached (`docker exec -d` over `zerg.sshHost`, or `spawn(…, {detached: true})` locally).
- **Poller** (one loop per process, runs where the task worker runs): for each Feature with an active
  brewery run, it reads `events.jsonl` from `eventsOffset` (`tail -c +N` through the same exec
  path) and turns events into Slack posts:
  - `step.start`: new message `▸ distill (claude)`, `▸ T2 roast (claude)`, and so on
  - `narration`: edits that step's message, keeping the last `maxNarrationLines`, flushed at
    most every `narrationFlushMs`
  - `step.end`: final edit `✓ T2 roast PASS in 312s: <action>` or `✗ … FAIL`
  - `waiting/signoff`: posts the brewery message, the plan's summary and task list (read from the IP), and
    "Reply `ok`, `ok, 2b`, or `no: <why>`". Feature goes to `awaiting_approval`.
  - `waiting/gate`: posts the gate message and options
  - `pr` / `done` / `error`: posts the PR link, a completion summary, or the failure with the log path. Feature goes to `complete` or `error`.
  - If a run shows no events for `stepSilenceAlertMin` and its pid is gone, the poller posts a "brewery died"
    notice with `resume` as the fix.
- **`handleMessage(group, message)`**:
  - `stop`: kill the pid's process group and post the confirmation
  - `now: <text>`: kill the step, `brewery note`, `brewery resume --go`, then post "Interrupted
    <stage>; restarting with your note"
  - while waiting: `brewery answer <slug> "<reply>" --go --no-wait`, detached
  - otherwise: `brewery note` and ack "Queued for the next check-in (current: T3 roast)"

`GroupQueue`: route `featureDriver === "brewery"` groups to `BreweryDriver.handleMessage` before
runner selection. `featureRoutingPromptBlock` is unchanged (main still calls `create_feature`).

## Notifications / user updates

Everything goes to the feature channel. brewery's ntfy ping stays as configured in brewery's own
config. Shade doesn't add a second ping.

## UI

Features screen: show the `awaiting_approval` status badge and the `brewery.phase` and PR link. No new
screen. Admin config screen: the `brewery` section.

## Tasks

Each title is the task's commit subject. Details for each task are in the sections above, and
`docs/tasks/brewery-driven-feature-channels.md` mirrors this list.

### Phase 1: brewery (`tools/brewery`)

- [x] **T1** — Emit a per-run events.jsonl from brewery
  Step start/end, waiting, resumed, note, pr, ci, done, error (see "brewery changes" 1). Unit +
  flow tests with the scripted fake agent.
- [x] **T2** — Stream claude and codex output into narration events
  claude `--output-format stream-json --verbose`, codex `exec --json`; raw log still written;
  text blocks and one-line tool summaries become `narration` events (≤300 chars).
- [x] **T3** — Add brewery note for mid-run human notes
  Appends verbatim to context.md and `state.notes`; `header()` shows notes to later steps.
- [x] **T4** — Add brewery resume with a run lock and pid file
  Resume from `state.phase`; `run.pid` + lock; flow test that kills a roast step and resumes.

### Phase 2: Shade models + config

- [x] **T5** — Add featureDriver to Group and brewery state to Feature
  `Group.featureDriver`, `Feature.brewery` subdocument, `awaiting_approval` status, types.
- [x] **T6** — Add AppConfig.brewery with admin UI fields

### Phase 3: Shade driver

- [x] **T7** — Start brewery distill for new feature channels
  `BreweryDriver.start`: zerg session or local worktree, request file, detached `brewery distill`.
- [x] **T8** — Post brewery events to the feature channel
  Poller from `eventsOffset`; one Slack message per step edited with narration; sign-off post
  with plan summary and tasks; PR/done/error; dead-run alert.
- [x] **T9** — Route feature channel replies to brewery
  Answer when waiting, `now:` interrupt (kill, note, resume), otherwise queue a note, `stop`.
- [ ] **T10** — Keep agent runners out of brewery feature channels
  GroupQueue routes `featureDriver: "brewery"` to the driver; test that no runner is invoked,
  including for the seeded request.
- [ ] **T11** — Create brewery-driven groups from create_feature
  Remove the roast `FEATURE_CHANNEL_MEMORY`, greeting, and seed-message path.

### Phase 4: Verify

- [ ] **T12** — Add a harness end-to-end test with a fake brewery command
  Request → plan posted → `ok` → progress → PR posted, in test mode via `bun run dev:test`.
- [ ] **T13** — Show brewery phase and PR on the Features screen
  `awaiting_approval` badge, phase, PR link; QA test case per `.claude/qa-test-case-format.md`.

## Prerequisites / risks

- **The zerg image must ship brewery** (and `claude`, `codex`, and `bun`). That change lives in the zerg repo, not here.
  Until it lands, `start` fails loudly in zerg mode, as intended. Setting `zerg.enabled=false` uses mini, which already has
  `~/bin/brewery` from the deploy.
- **Mini has no `~/.config/brewery/config.json` yet.** brewery runs on its defaults (claude + codex).
- Narration is only as good as what the step agent says. `claude -p` in stream-json mode emits text
  blocks between tool calls, which read like Claude Code's summaries.
- Killing a step mid-roast can leave a dirty tree. `resume` relies on brewery's existing
  "amend the task commit" retry path. The tests cover interrupting during roast.

## Not included

- Answering zerg's own inbox from Slack (IP-017 stays read-only).
- Migrating existing roast-driven feature channels.
- Editing the plan in Slack beyond brewery's reply grammar.

## Sign-off

Status: approved 2026-09-28 (Josh, in chat)
