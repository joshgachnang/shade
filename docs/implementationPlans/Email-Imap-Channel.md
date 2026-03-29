# Implementation Plan: Email IMAP Channel Connector

**Status:** In Progress
**Priority:** High
**Effort:** Small batch (1-2 days)
**IP:** IP-003

## Models

No new models. Modify Channel model to add `"email"` to the type enum.

Email channel config shape:
```typescript
{
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
  tls: boolean;           // default true
  pollIntervalMs?: number; // default 30000
  mailbox?: string;       // default "INBOX"
}
```

## APIs

No new routes. Email channels created via existing `/channels` CRUD with `type: "email"`.

## Notifications

N/A — this IS the notification channel.

## UI

None in this phase. Frontend email management is future work.

## Phases

### Phase 1: Email Channel Connector (this IP)
- Install imapflow, mailparser, nodemailer
- Create EmailChannelConnector implementing ChannelConnector
- IMAP polling for inbound (unseen messages in INBOX)
- SMTP for outbound via nodemailer
- Thread grouping via In-Reply-To/References headers
- Register in ChannelManager

## Feature Flags & Migrations

None needed. Adding a new channel type is additive.

## Not Included / Future Work

- OAuth2 authentication (Gmail, Microsoft)
- IMAP IDLE (push) for real-time delivery
- Multiple mailbox support
- Attachment handling
- HTML email composition
- Frontend email management screens

---

## Task List

### Phase 1: Email Channel Connector

- [ ] **Task 1.1**: Install dependencies
  - Description: Add imapflow, mailparser, nodemailer to backend
  - Files: backend/package.json
  - Depends on: none
  - Acceptance: Packages install successfully

- [ ] **Task 1.2**: Create EmailChannelConnector
  - Description: Implement ChannelConnector interface with IMAP polling + SMTP sending
  - Files: backend/src/orchestrator/channels/email.ts
  - Depends on: 1.1
  - Acceptance: Connector connects to IMAP, polls unseen messages, sends via SMTP

- [ ] **Task 1.3**: Register in ChannelManager
  - Description: Add email factory to defaultConnectorFactories, update Channel model enum
  - Files: backend/src/orchestrator/channels/manager.ts, backend/src/models/channel.ts
  - Depends on: 1.2
  - Acceptance: Email channels auto-connect on server start

- [ ] **Task 1.4**: Thread support
  - Description: Group replies using In-Reply-To/References headers as groupExternalId
  - Files: backend/src/orchestrator/channels/email.ts
  - Depends on: 1.2
  - Acceptance: Reply chains map to the same group conversation
