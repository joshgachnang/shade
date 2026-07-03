---
name: shade-harness
description: Run Shade in offline test mode and drive the send-command → observe-result loop. Use when asked to run the app, test agent behavior end to end, verify orchestration changes (message loop, scheduler, task board, IPC), or reproduce a bug without real credentials or LLM spend.
---

# Shade AI Testability Harness

Full reference: `docs/testing/ai-harness.md`. Summary of the loop:

1. **Start** (needs local Mongo on 27017): `cd backend && bun run dev:test` — boots on :4020 with a mock LLM, a seeded `test-harness-group` that triggers on every message, and all external services (Slack/IMAP/GitHub/Apple/radio) stubbed or disabled. 250ms poll loops.

2. **Login**: `POST /auth/login` with `admin@shade-test.com` / `TestPassword123!` → bearer token for everything below.

3. **Script the agent** (optional): `POST /test/llm-fixtures` with `{name, match: {pattern}, response, actions?, priority?, consumeOnce?}`. Unmatched prompts echo back (`[mock] received: …`), so scripting is only needed when the test cares about the reply content or side effects. Actions (`send_message`, `schedule_task`, `create_task`, `add_reaction`) execute through the real IPC/board pipeline.

4. **Send**: `POST /command` with `{content, groupId?}` — injects an inbound message exactly like Slack would.

5. **Force the loops** (instead of sleeping): `POST /test/tick` with `{target: "all"}` (or `messageLoop` / `taskWorker` / `scheduler` / `ipc` individually).

6. **Observe**: `GET /test/outbox?groupId=` for bot replies; `GET /test/state` for pending/active counts; `GET /taskRunLogs?groupId=` for run audits (`modelBackend: "mock"`).

7. **Reset between scenarios**: `POST /test/reset` — wipes everything except users and AppConfig, re-seeds, returns fresh IDs. Old group IDs are invalid after a reset.

Gotchas:
- Fixture patterns match the FULL prompt including recent conversation history — a fixture can keep firing after its message scrolls by. Scope tightly, use `consumeOnce`, or `DELETE /test/llm-fixtures/:id` between scenarios.
- Poll loops run at 250ms anyway; ticks just make assertions immediate.
- In bun tests, use the helpers in `backend/src/tests/testHelper.ts` (`sendCommand`, `getOutbox`, `tickHarness`, `resetHarness`, `waitFor`) — see `backend/src/tests/harness.e2e.test.ts` for the canonical example.
- Mid-run IPC `send_message` deliveries are not persisted as Message docs (only the final reply and board-task results are), so assert on those.
