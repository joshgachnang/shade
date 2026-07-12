# Email & Document Ingestion via Apple Mail (IP-016) — Task List

Source: [Apple-Mail-Ingestion.md](../implementationPlans/Apple-Mail-Ingestion.md)

Decisions: read `~/Library/Mail` (emlx + Envelope Index) directly with a version check; full-history backfill (lookbackDays 0 = unlimited), throttled; files-first archive under `SHADE_DATA_DIR/archive/email/`; transport via edge data-push. Assumed defaults: all accounts, INBOX+Sent, all attachment types ≤15 MB.

## Phase 1: Backend receiving side

- [ ] **1.1** `MailMessage` model + types (unique messageId, threadKey/date indexes, text index on subject/snippet) + `mailIngestion` AppConfig block
- [ ] **1.2** `mail_sync` data-push schema + handler + archive writer (`thread.md` rendering, idempotent by messageId/contentHash; fixture tests)
- [ ] **1.3** `POST /api/edge/attachment` binary upload route

## Phase 2: Edge reader (Mac mini)

- [ ] **2.1** emlx + Envelope Index reader with watermarks + Mail store version check (`packages/edge-agent-imessage/src/mail.ts`; fixture emlx tests)
- [ ] **2.2** Config-pull wiring + throttled full-history backfill loop; steady-state delta sync

## Phase 3: Agent surface + backfill

- [ ] **3.1** `search_mail` / `get_mail_thread` MCP tools + prompt-block mention (read-only)
- [ ] **3.2** Real full backfill + recall spot-checks + Slack completion/failure notifications; register archive with IP-013 indexer once both land
