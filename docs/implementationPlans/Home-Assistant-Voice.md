# Implementation Plan: Voice via Home Assistant Voice PE

**Status:** Open
**Priority:** Medium
**Effort:** Big batch (1-2 weeks)
**IP:** IP-015

Talk to Shade out loud through a local device in the house — **decided: the Home Assistant Voice Preview Edition** (~$60 ESP32-S3 box: mic array, speaker, on-device wake word, ESPHome firmware). No telephony/Twilio. The Voice PE cannot run our edge-agent daemon (it's an ESP32, not a Pi), so the architecture is the Home Assistant Assist pipeline with Shade plugged in as the **conversation agent**: the device and HA own audio (wake word, STT, TTS); Shade owns the brain.

The hard product constraint stands: Shade agent turns run seconds-to-minutes, which no voice UX can hide. The design splits **fast path** (instant answers for trivia-grade queries, instant ack otherwise) from **slow path** (real agent work, spoken when done via an announce callback to the satellite).

## Decision record (2026-07-12)

Original options considered: (A) thin-client Pi + cloud STT/TTS riding the edge-agent protocol; (B) all-local Pi audio; (C) realtime speech-to-speech front-end; (D) off-the-shelf HA Voice PE. **Chosen: D.** Rationale: zero hardware assembly, solved wake-word/mic/speaker/enclosure, and the backend brain work is the same either way. Option C (realtime voice front-end) remains the natural phase-2 upgrade for conversational fluidity and would slot in front of the same Shade endpoint. **Assumption:** a Home Assistant instance exists (or will be stood up — one container on the shade host or Mac mini); standing it up is Task 0.1 if needed.

## Architecture

```
Voice PE ──wake word──▶ HA Assist pipeline ──STT──▶ text
   ▲                                                 │
   │                                    custom "Shade" conversation agent
 TTS ◀── reply text ◀───────────────────── POST /api/voice/converse
   ▲                                                 │
   └── assist_satellite.announce ◀── Shade slow-path callback (HA REST API)
```

- **STT/TTS live in HA** (local Whisper/Piper via Wyoming, or HA Cloud — operator's choice in HA, invisible to Shade). Shade does no audio processing at all — a large scope cut versus the Pi options.
- **Custom HA integration** (`custom_components/shade_conversation`): implements HA's conversation-agent interface; forwards each utterance to Shade with a shared token; returns Shade's reply text for TTS. Configured with Shade's base URL + API token.
- **Fast/slow path lives in Shade's converse endpoint**: classify with `agent.auxiliaryModel` — instantly answerable (answer directly, no full agent run) vs needs-agent (return an ack like "On it", dispatch the real turn, then speak the result via `assist_satellite.announce` through the HA REST API when it completes). HA conversation agents must respond in seconds, so the ack path is mandatory, not a nicety.

## Models

- **`AppConfig.voice`**: `enabled` (default false), `haBaseUrl`, `haToken` (long-lived HA access token), `satelliteEntityId` (announce target), `converseToken` (bearer HA uses to call Shade), `fastPathEnabled` (default true), `fastPathModel` (empty → `agent.auxiliaryModel`), `quietHours` ({start, end} local time, announce suppressed → falls back to Slack), `groupId` (the Voice group).
- **Group/Channel**: one `voice` channel + one "Voice" group; every utterance and reply is a normal `Message` (searchable, memory-visible, session-reviewable). Multiple satellites can come later; v1 is one group, one announce target.
- No edge-agent protocol changes, no new packages — this is deliberately *not* an edge agent.

## APIs

- **`POST /api/voice/converse`** (bearer `converseToken`): `{text, conversationId?, deviceId?}` → `{reply, final: boolean}`. `final: false` means "ack; result will be announced". Persists inbound/outbound as Messages in the Voice group.
- **Slow-path announce**: on agent-turn completion for a voice-originated message, Shade calls `POST {haBaseUrl}/api/services/assist_satellite/announce` with the result text (respecting `quietHours`; outside hours → deliver to Slack instead).
- **HA custom component** (lives in this repo under `integrations/home-assistant/shade_conversation/`, installed into HA manually or via HACS): conversation-agent platform, config-flow for URL+token, error text when Shade is unreachable.

## Notifications

The satellite becomes a notification surface: scheduled tasks (e.g. daily-triage output) targeted at the Voice group get announced, gated by `quietHours`.

## UI

None (the device + HA are the UI). Admin: `AppConfig.voice` editable via generic admin UI.

## Phases

0. **Prereq (skip if HA already running)**: HA container + Voice PE onboarded to the Assist pipeline with local STT/TTS.
1. **Shade converse endpoint**: voice channel/group, `/api/voice/converse` with fast/slow classification, Message persistence. Fully testable with curl/fixtures — no hardware needed (`SHADE_TEST_MODE` fixtures for the classifier).
2. **HA integration**: `shade_conversation` custom component; milestone — "what's on my calendar" spoken round-trip on the Voice PE.
3. **Slow path + polish**: announce callback, quiet hours, scheduled-task announcements, latency instrumentation (log STT→reply and reply→announce timings).

## Feature Flags & Migrations

`voice.enabled` gates the endpoint and announce path; no migrations. Security: `converseToken` is a dedicated secret (not the JWT), HA→Shade over Tailscale; utterances are treated as the owner (single-user assumption; guest/passphrase handling explicitly out of scope).

## Activity Log & User Updates

Utterances/replies are Messages like any channel. Announce calls logged at info. Session-review loop covers anomalies.

## Not Included / Future Work

- Telephony/Twilio (rejected).
- Realtime speech-to-speech front-end (Option C) — phase-2 candidate, separate IP.
- Multi-satellite/multi-room, speaker identification, guest passphrase, barge-in beyond what ESPHome provides natively, music/media.

---

## Task List

### Phase 0: Prereq

- [ ] **Task 0.1**: HA instance + Voice PE onboarded (Assist pipeline, local STT/TTS chosen) — manual/ops, documented in `docs/voice-device-setup.md`

### Phase 1: Shade converse endpoint

- [ ] **Task 1.1**: `AppConfig.voice` + types; `voice` channel type + Voice group bootstrap
  - Files: `backend/src/models/appConfig.ts`, types, channel/group setup
- [ ] **Task 1.2**: `/api/voice/converse` route with bearer auth + Message persistence
  - Files: `backend/src/api/voice.ts` (+ tests)
- [ ] **Task 1.3**: Fast/slow classifier (auxiliary model) + ack response path
  - Acceptance: instantly-answerable fixture answers inline (`final: true`); agent-work fixture returns ack (`final: false`) and dispatches a turn

### Phase 2: HA integration

- [ ] **Task 2.1**: `shade_conversation` HA custom component (conversation platform, config flow)
  - Files: `integrations/home-assistant/shade_conversation/`
- [ ] **Task 2.2**: End-to-end milestone: spoken calendar query round-trip on the Voice PE
  - Files: `docs/voice-device-setup.md` (setup + pairing walkthrough)

### Phase 3: Slow path + polish

- [ ] **Task 3.1**: Announce callback on voice-originated turn completion + quiet hours (Slack fallback)
- [ ] **Task 3.2**: Scheduled-task announcements to the Voice group + latency logging
