# AI Testability Harness

Boot Shade offline with zero credentials, send commands, and observe results — deterministic, $0, sub-second feedback. Every LLM call runs through a scripted mock (`MockAgentRunner`); every sensitive integration (Slack, IMAP, GitHub, Apple Calendar/Contacts, radio/trivia) is stubbed or disabled. Everything else — message loop, group queue, scheduler, task board, worker claims, IPC delivery, channel manager, auth, CRUD — runs for real. (IP-012.)

## Start

```bash
cd backend && bun run dev:test     # gateway on :4020, needs local Mongo on 27017
bun run worker:test                # optional: a separate mock-backed worker process
```

`SHADE_TEST_MODE=1` is the single gate. It sandboxes state (`shade-test` Mongo DB, `backend/data-test/` data dir — both overridable via `MONGO_URI` / `SHADE_DATA_DIR`) and seeds on boot:

| Seeded | Value |
|---|---|
| Admin login | `admin@shade-test.com` / `TestPassword123!` |
| Regular user | `user@shade-test.com` / same password |
| Channel | `test-harness-channel` (type `test`, a no-op transport) |
| Group | `test-harness-group` — auto-triggers on every message, `modelConfig.defaultBackend: "mock"` |
| AppConfig | 250ms message/IPC/worker polls, board worker in-gateway, no real API keys |

Boot noise to expect: `checkModelsStrict` logs a non-fatal model-validation failure (no API keys — harmless).

## The loop

```bash
# 1. Login
TOKEN=$(curl -s -X POST localhost:4020/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@shade-test.com","password":"TestPassword123!"}' | jq -r .data.token)
AUTH="Authorization: Bearer $TOKEN"

# 2. Script the agent's next reply (optional — unmatched prompts echo back)
curl -s -X POST localhost:4020/test/llm-fixtures -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name":"demo","match":{"pattern":"status report"},"response":"All systems nominal.","priority":5}'

# 3. Send a command (inbound message, exactly as if it came from Slack)
GROUP=$(curl -s -X POST localhost:4020/command -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"content":"Give me a status report"}' | jq -r .data.groupId)

# 4. Force the loops instead of waiting for polls
curl -s -X POST localhost:4020/test/tick -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"target":"all"}'

# 5. Observe what the bot said
curl -s "localhost:4020/test/outbox?groupId=$GROUP" -H "$AUTH" | jq '.data[].content'
```

## Control API (admin-gated, mounted only in test mode)

| Route | Purpose |
|---|---|
| `POST /test/reset` | Wipe to freshly-seeded state. Users + AppConfig survive; refuses unless the DB name is `test`/`*-test`. |
| `GET /test/outbox?groupId=&since=` | Outbound bot messages (`Message` docs with `isFromBot: true`), incl. `richPayload`. |
| `POST /test/tick` | `{target: "messageLoop" \| "taskWorker" \| "scheduler" \| "ipc" \| "all"}` — force a loop pass. |
| `POST/GET/DELETE /test/llm-fixtures` | Program/list/retire the mock's scripted responses. |
| `GET /test/state` | Counts: pending messages, active runs, board tasks, due scheduled tasks. |

## Fixtures (`LlmFixture`)

`{name, match: {groupId?, pattern?}, response, actions[], delayMs, priority, consumeOnce}`

- `pattern` is a regex tested against the **full prompt, which includes recent conversation history** — a fixture can keep matching after its triggering message. Scope patterns tightly, set `consumeOnce: true` for one-shots, or `DELETE` fixtures between scenarios.
- Highest `priority` wins; `consumeOnce` fixtures are claimed atomically (never double-fire).
- `actions` execute through the real pipeline: `send_message` / `add_reaction` / `schedule_task` write real IPC files relayed by `IpcWatcher`; `create_feature` writes an authorized feature-creation IPC command; `create_task` inserts a real `AgentTask` for the worker.
- No match → the mock echoes the prompt (`[mock] received: …`; disable via `AppConfig.testMode.echoFallback`).

## Other observables

- `TaskRunLog` / `AIRequest` rows per run (`modelBackend: "mock"`, cost 0) — `GET /taskRunLogs?groupId=`.
- Session JSONL transcripts under `$SHADE_DATA_DIR/sessions/<groupId>/`.
- Scheduled/board tasks via `GET /scheduledTasks`, `GET /agentTasks`.
- Direct test-channel deliveries, including mid-run IPC messages and brewery reply notices, persist bot `Message` records and appear in `/test/outbox`. Group sends persist their enriched plain/rich records once through ChannelManager.

## In bun tests

`backend/src/tests/testHelper.ts` wraps the whole loop: `setupTestServer`, `sendCommand`, `getOutbox`, `tickHarness`, `resetHarness`, `waitFor`. See `backend/src/tests/harness.e2e.test.ts` for the canonical end-to-end example. CI's Playwright job runs the backend with `SHADE_TEST_MODE=1`.

The Bun preload provisions MongoDB before test modules are imported and directs the
import-time trivia connection to that same test server. Both connections close before
the in-memory server stops. Tests that create audit records must remove their own records
afterward: session-review reports intentionally aggregate activity across all groups.

## Brewery request-to-PR test

Run `cd backend && bun test src/tests/brewery.harness.e2e.test.ts` with port 4020 free.
The test launches the actual `bun run dev:test` gateway against the test runner's MongoDB,
configures `AppConfig.brewery.command` to a disposable fake executable, and creates a local
Git repository with `origin/HEAD`. No brewery agents, Slack credentials, GitHub calls, or
real PRs are needed. Temporary worktrees, executable, process groups, and database rows
are cleaned up afterward. Run against a disposable test database (the default in-memory
MongoDB is sufficient).
The child receives the preload's connected MongoDB URI explicitly, so other tests
changing `process.env.MONGO_URI` cannot redirect it. Its working directory is a
temporary sandbox linking the backend's unchanged package script and sources;
server log files are removed with that sandbox rather than left in `backend/`.
Check package-suite compatibility with `cd backend && bun test`.

The HTTP scenario programs a one-shot `create_feature` fixture in the main group, sends
`POST /command`, observes the plan in `/test/outbox`, replies `ok` in the new feature
group exactly once (lease contention is retried by MessageLoop), observes the reply acknowledgement, narration and the final edit under the same message ID, and checks the
PR and completion posts. A second scenario checks an emitted CLI error and absence of
feature-channel agent runs. The fake CLI's completion waits for a test-controlled file,
so live progress is observed before the PR event without timing-dependent sleeps.

For a manual harness session, set `zerg.enabled=false`, `featureChannels.localReposDir`
and `brewery.command` in AppConfig, then script the main group's fixture:

```json
{"name":"reading-room","match":{"pattern":"reading room"},"response":"Feature requested","consumeOnce":true,"actions":[{"tool":"create_feature","args":{"name":"feat-reading-room","repo":"reading-room","request":"Add a quiet reading room"}}]}
```

The repository must exist locally with `origin/HEAD` set. The bundled fake CLI at
`backend/src/tests/fixtures/fake-brewery.ts` supports `agents`, `distill`, and `answer`;
use an executable Bun wrapper as the configured command. To finish its live step,
create `.terreno/brewery/<slug>/finish` inside the feature worktree. The fixture exits
with an error if completion is not released within 20 seconds.

In test mode the brewery poller replaces only Slack post/update delivery with persisted
outbox messages, restricted to channels of type `test`. Edits retain the original message
ID. The real driver, IPC authorization, queue, detached CLI, file reader, and model state
transitions still run. Production continues to use Slack. HTTP-only helpers live in
`backend/src/tests/harnessClient.ts`, re-exported by `testHelper.ts` for existing tests.
This is a backend/channel harness flow; it introduces no browser or native UI, so frontend
QA Markdown and Playwright do not apply.

## Safety rails

- `TestHarnessPlugin` never mounts when `NODE_ENV === "production"`, even with the flag set.
- `/test/reset` independently verifies the connected DB name before deleting anything.
- In test mode, `ChannelManager` refuses to connect non-`test` channel docs, and TriviaMonitor / PrWatcher / RadioTranscriber / edge health monitor never start.
