# Edge Agents — Task List

Source: [Edge-Agents.md](../implementationPlans/Edge-Agents.md)

## Phase 1: Shared Types & Core Framework

- [ ] **1.1** Create edge-agent-types package (Zod schemas for all API contracts)
- [ ] **1.2** Create edge-agent-core — bootstrap module (registration, state persistence)
- [ ] **1.3** Create edge-agent-core — heartbeat module (polling, command dispatch, backoff)
- [ ] **1.4** Create edge-agent-core — config module (polling, 403 handling, persistence)
- [ ] **1.5** Create edge-agent-core — agent base class (lifecycle orchestration)
- [ ] **1.6** Unit tests for edge-agent-core

## Phase 2: Backend Endpoints

- [ ] **2.1** Create EdgeAgent model and types
- [ ] **2.2** Create EdgeAgentEvent model and types
- [ ] **2.3** Create modelRouter CRUD routes, remove RemoteAgent
- [ ] **2.4** Registration endpoint (bootstrap secret, SHA-256 token)
- [ ] **2.5** Heartbeat endpoint (SHA-256 validation, atomic command delivery)
- [ ] **2.6** Config endpoint (approval check, AES-256-GCM secrets decryption)
- [ ] **2.7** Data push endpoint (via ChannelManager, Zod validation, channel+group creation)
- [ ] **2.8** Admin endpoints (approve, revoke, command with payload validation)
- [ ] **2.9** EdgeAgentChannelConnector (orchestrator bridge for outbound messages)
- [ ] **2.10** Agent health monitor (offline detection, atomic transitions)
- [ ] **2.11** Remove old IMessageChannelConnector from ChannelManager
- [ ] **2.12** Register edge plugin in server
- [ ] **2.13** Unit tests for backend edge endpoints

## Phase 3: iMessage Agent

- [ ] **3.1** Create iMessage agent package (skeleton extending EdgeAgent base)
- [ ] **3.2** iMessage reader module (chat.db polling, is_from_me filtering)
- [ ] **3.3** iMessage sender module (AppleScript, extracted from existing connector)
- [ ] **3.4** Wire iMessage agent together (full lifecycle)
- [ ] **3.5** Unit tests for iMessage agent

## Phase 4: Build & Deploy

- [ ] **4.1** Bun compile build script
- [ ] **4.2** launchd plist (macOS)
- [ ] **4.3** systemd unit file (Linux)
- [ ] **4.4** Install script

## Phase 5: Frontend

- [ ] **5.1** Regenerate SDK + custom edge hooks
- [ ] **5.2** Edge Agents list screen
- [ ] **5.3** Edge Agent detail screen

## Phase 6: Integration Testing

- [ ] **6.1** End-to-end integration test (full message round-trip)
