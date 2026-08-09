# Implementation Plan: Email & Document Ingestion via Apple Mail

**Status:** Open
**Priority:** Medium
**Effort:** Big batch (1-2 weeks)
**IP:** IP-016

Archive the user's email — threads and attachments — into Shade's data directory so the agent can actually *use* mail history: answer "what did the contractor quote?", pull attachments, and (once IP-013 lands) recall threads semantically. Source is **Apple Mail on the Mac mini** — the same host already running the iMessage edge agent with full-disk access and an established sync pipeline (messages, reminders, calendar). This is deliberately *not* the IMAP channel (IP-003): that's for conversing with Shade over email; this is bulk read-only ingestion of the user's own mailboxes.

## Decisions & Options

### D1: How the edge agent reads mail

- **A (recommended): Parse `~/Library/Mail` `.emlx` files directly + the `Envelope Index` SQLite DB for mailbox/thread metadata.** Same pattern as the iMessage `chat.db` reader (`packages/edge-agent-imessage/src/reader.ts`): fast, incremental (rowid/date watermarks), no Mail.app scripting-permission prompts beyond full-disk access the host already has, works even when Mail.app is closed. `.emlx` is RFC-822 plus a plist wrapper — parse with `mailparser`.
- **B: JXA against Mail.app** (like `appleReminders.ts`/`appleCalendar.ts` do for their apps). Cleaner API, but Apple events on large mailboxes are painfully slow, require Mail.app running, and add another TCC permission (the csreq/cdhash fragility we've already been burned by on this host).
- **C: Skip Apple Mail; IMAP directly against the accounts.** Simplest cross-platform story, but it's not what was asked for, needs credentials for every account, and re-downloads what the Mac already has locally.

### D2: What gets archived and where

- **A (recommended): Files-first, model-second.** Each thread becomes a folder under `SHADE_DATA_DIR/archive/email/{account}/{yyyy}/{threadKey}/`: `thread.md` (readable rendering: headers + each message as text) plus original attachments. A `MailMessage` Mongo model stores metadata only (subject, participants, date, mailbox, path, messageId, threadKey) for querying/dedupe — bodies live on disk where agent tools (Read/Grep) and the IP-013 indexer can reach them. This is the Joshu "everything is a file the agent can grep AND semantically search" pattern.
- **B: Bodies in Mongo.** Easier transactional dedupe, but bloats the DB, duplicates what disk does better, and cuts against the file-based memory/skills conventions.

### D3: Transport to the shade host

- **A (recommended): Extend the existing edge data-push protocol** with a `mail_sync` push (batched, metadata + body text) and an attachment upload path (same binary-upload route IP-015 needs — build once, share). Backend writes the archive; edge agent stays stateless beyond watermarks.
- **B: Edge agent writes files, syncs via rsync/Syncthing out-of-band.** Less protocol work but a second transport to operate and no single point of validation.

## Models

- **`MailMessage`** (new): `{account, mailbox, messageId (unique), threadKey, subject, from, to[], cc[], date, snippet (first ~300 chars), archivePath, attachments: [{filename, path, mimeType, bytes}], edgeAgentId}` + default plugins. Indexes: unique `{messageId: 1}`, `{threadKey: 1, date: 1}`, `{date: -1}`, text index on `{subject, snippet}`.
- **`AppConfig.mailIngestion`**: `enabled` (default false), `accounts: string[]` (empty = all), `mailboxes: string[]` (default `["INBOX", "Sent"]`), `lookbackDays` initial backfill (default 0 = **unlimited, full history**), `maxAttachmentMb` (default 15), `excludeSenders: string[]` (newsletters/noise), `syncIntervalMs`.
- Edge-agent config pull (`packages/edge-agent-types/src/config.ts`) gains the matching mail section so the Mac daemon knows what to sync — consistent with how iMessage/reminders sync is configured today.

## APIs

- **Edge protocol**: new `mail_sync` data push (batch of message metadata + plain-text bodies, watermarked) and `POST /api/edge/attachment` (binary, authenticated with the existing bearer scheme).
- **MCP tools**: `search_mail` `{query, from?, mailbox?, days?}` → metadata hits (text index) with `archivePath`s the agent then Reads; `get_mail_thread` `{threadKey}` → the rendered `thread.md`. Deliberately no send/delete/move — read-only ingestion.
- REST: generic admin CRUD over `MailMessage` only.

## Notifications

One-line Slack note (existing notifications bridge) when initial backfill completes per account, and on sync failures persisting > 1 hour. Silent otherwise.

## UI

None for v1. The archive is agent- and Finder-facing. (Global search screen could federate `MailMessage` later — future work.)

## Phases

1. **Backend receiving side**: `MailMessage` model, AppConfig section, `mail_sync` push handler, attachment route, archive writer (thread.md rendering, dedupe by messageId/contentHash). Fully testable with fixture pushes — no Mac needed.
2. **Edge reader**: emlx/Envelope Index reader in `packages/edge-agent-imessage` (new `mail.ts` module beside `reader.ts`), watermark state, backfill throttling (N messages/batch so a 100k-message mailbox doesn't melt the Mac), config-pull wiring.
3. **Agent surface + backfill**: `search_mail`/`get_mail_thread` MCP tools, prompt-block mention, run the real backfill, spot-check recall. Register the archive dir with IP-013's indexer when both have landed (`sourceType: "document"`).

## Feature Flags & Migrations

`mailIngestion.enabled` gates the push handler; edge agent only syncs when its pulled config says so. No migrations. Sensitive-data posture: the archive directory inherits the same rules as session transcripts (local disk, never leaves the host, excluded from any cloud backup path); `excludeSenders` lets you keep specific senders out entirely.

## Activity Log & User Updates

Sync batches logged at info with counts; per-message at debug. `search_mail` calls visible in transcripts. Session-review loop covers anomalies (e.g., unexpected mass re-sync).

## Not Included / Future Work

- Sending, moving, or deleting mail (read-only by design).
- Non-mail documents (PDF drop-folder ingestion is a natural sibling — separate small IP once the archive layout exists).
- Gmail API / Outlook connectors; other machines' mail stores.
- Semantic indexing itself (IP-013 owns that; this IP produces the corpus).
- Real-time "new email" triggers into conversations (the IMAP channel IP-003 remains the interactive path).

## Decisions (2026-07-12)

1. **D1 = A**: read `~/Library/Mail` (emlx + Envelope Index) directly, with a macOS Mail store version check that fails loudly rather than mis-parsing.
2. **Backfill: full history** (`lookbackDays` default 0 = unlimited), throttled in batches so the Mac stays usable.
3. **Assumptions** (not explicitly answered; adjust in config anytime): all accounts, `INBOX` + `Sent` mailboxes, all attachment types under the 15 MB cap.
4. **D2 = A, D3 = A** per recommendation: files-first archive; transport over the edge data-push protocol.

---

## Task List

### Phase 1: Backend receiving side

- [ ] **Task 1.1**: `MailMessage` model + types + AppConfig `mailIngestion`
  - Files: `backend/src/models/mailMessage.ts`, types, `appConfig.ts`
- [ ] **Task 1.2**: `mail_sync` push schema + handler + archive writer
  - Files: `packages/edge-agent-types/src/data.ts`, `backend/src/api/edgePlugin.ts`, `backend/src/services/mailArchive.ts` (+ fixture tests)
  - Acceptance: fixture push produces thread.md + MailMessage docs, idempotent on re-push
- [ ] **Task 1.3**: Binary attachment upload route (shared with IP-015)
  - Files: `backend/src/api/edgePlugin.ts`

### Phase 2: Edge reader

- [ ] **Task 2.1**: emlx + Envelope Index reader with watermarks
  - Files: `packages/edge-agent-imessage/src/mail.ts` (+ tests on fixture emlx)
- [ ] **Task 2.2**: Config-pull wiring + throttled backfill loop
  - Acceptance: fresh run backfills `lookbackDays` in batches; steady-state syncs deltas

### Phase 3: Agent surface + backfill

- [ ] **Task 3.1**: `search_mail` / `get_mail_thread` MCP tools + prompt mention
  - Files: `backend/src/agentRunner/mcpServer.ts`
- [ ] **Task 3.2**: Real backfill + recall spot-checks + notification wiring
