# Shade
Mr. Gachnang, I am here to be your butler and serve all of your always *excellent* ideas and will certainly not mention how many trees and how much water I'm destroying in the process.

# Overview
Shade is a self-hosted personal AI butler: a multi-channel agent orchestrator that receives messages from Slack, iMessage, email, and webhooks, runs Claude agents against them, executes scheduled (cron) tasks, and takes real-world actions through MCP tools (calendar, contacts, reminders, media servers, task scheduling).

- **Backend** (`backend/`) — Express + Mongoose on `@terreno/api`; hosts the orchestrator, channel connectors, scheduler, agent runners (Claude Agent SDK), and admin UI.
- **Frontend** (`frontend/`) — Expo (React Native + web) app with the Shade Console, feature tracker, movie analysis UI, and generic admin CRUD.
- **Edge agents** (`packages/`) — remote daemons (e.g. an iMessage relay on a Mac) that register, heartbeat, and push messages back to the server.

Full internal documentation lives in [`docs/architecture/`](./docs/architecture/README.md).

# iMessage setup

iMessage support has two independent halves: an **edge agent** that ingests incoming messages, and a **reply allowlist** that controls who Shade is actually allowed to answer. Both must be configured — a connected agent with an empty allowlist will catalogue every message but reply to no one.

## 1. Allow incoming iMessage (edge agent)

Inbound iMessage is relayed by the `@shade/edge-agent-imessage` daemon running on an always-on Mac that's signed into iMessage. It reads `~/Library/Messages/chat.db` directly, so the process needs macOS **Full Disk Access** (System Settings → Privacy & Security → Full Disk Access → add `bun`).

1. Build and install the agent on the Mac: `shade install imessage` (or build the package with `bun run build.ts` and run `packages/edge-agent-imessage/install.sh`). The installer prompts for the Shade URL, bootstrap secret, and an agent name, and installs a launchd service (`com.shade.imessage.plist`).
2. Configure it from `config/shade-imessage.env.example` (copy to `~/.config/shade/shade-imessage.env`):
   - `SHADE_URL` — the Shade gateway the agent registers with and pushes messages to.
   - `SHADE_BOOTSTRAP_SECRET` — must match the backend's `SHADE_BOOTSTRAP_SECRET`. `shade install imessage` copies it from `shade-backend.env` automatically if left empty.
   - `SHADE_AGENT_NAME` — optional display name in the fleet UI (defaults to `imessage-<hostname>`).
3. Approve the agent. On first start it registers and lands in `pending`. Approve it from the admin UI's EdgeAgent screen (or `POST /api/edge/agents/:id/approve`). Once approved and heartbeating it shows as `online`, and incoming messages start flowing in.

At this point inbound messages are **ingested and stored** (searchable as context in later conversations) but Shade will not reply until the sender is on the reply allowlist.

## 2. Enable responses (reply allowlist)

Whether Shade replies to an iMessage is gated by `AppConfig.imessage.replyAllowlist`. It defaults to **empty, meaning Shade replies to no one** — every inbound message is catalogued only. Add a sender's handle to let Shade respond to them.

Manage the allowlist with the MCP tools (e.g. from any Shade chat):

- `list_sms_reply_numbers` — show the current allowlist.
- `add_sms_reply_number` — add a handle so Shade replies to that sender.
- `remove_sms_reply_number` — remove a handle.

A handle is a **phone number or an iMessage email address**. Phone numbers are matched on digits and tolerate country-code differences (`+19105551234` matches `9105551234`); emails are matched case-insensitively.

## 3. Verify the setup

1. Confirm the edge agent shows **online** in the admin/fleet UI.
2. Add your own handle with `add_sms_reply_number`, then confirm it appears via `list_sms_reply_numbers`.
3. Send a test iMessage from that sender to the Mac's iMessage account.
4. Confirm the message is ingested (it appears in the corresponding group/console).
5. Confirm Shade sends a reply.

If the message is ingested but no reply comes back, the sender is almost certainly not on the allowlist — check `list_sms_reply_numbers` and make sure the handle format matches (correct digits, or the exact email). Note that the `set_allowed_users` tool is Slack-only and does **not** affect iMessage replies.
