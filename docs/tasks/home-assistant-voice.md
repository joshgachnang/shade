# Voice via Home Assistant Voice PE (IP-015) — Task List

Source: [Home-Assistant-Voice.md](../implementationPlans/Home-Assistant-Voice.md)

Decision: Option D — HA Voice PE hardware; HA Assist pipeline owns audio (wake word/STT/TTS); Shade is the conversation agent with fast/slow path + announce callback.

## Phase 0: Prereq (manual/ops)

- [ ] **0.1** HA instance running + Voice PE onboarded to Assist pipeline with STT/TTS; documented in `docs/voice-device-setup.md`

## Phase 1: Shade converse endpoint

- [ ] **1.1** `AppConfig.voice` block (enabled, haBaseUrl, haToken, satelliteEntityId, converseToken, fastPathEnabled, fastPathModel, quietHours, groupId) + `voice` channel type + Voice group bootstrap
- [ ] **1.2** `POST /api/voice/converse` (bearer converseToken) with Message persistence (`backend/src/api/voice.ts` + tests)
- [ ] **1.3** Fast/slow classifier via auxiliary model: inline answer (`final: true`) vs ack + dispatched agent turn (`final: false`)

## Phase 2: HA integration

- [ ] **2.1** `shade_conversation` HA custom component (conversation platform + config flow) under `integrations/home-assistant/`
- [ ] **2.2** Milestone: spoken calendar query round-trip on the Voice PE; setup walkthrough in `docs/voice-device-setup.md`

## Phase 3: Slow path + polish

- [ ] **3.1** `assist_satellite.announce` callback on voice-originated turn completion + quiet hours (Slack fallback)
- [ ] **3.2** Scheduled-task announcements to the Voice group + STT→reply / reply→announce latency logging
