# Tasks: Shade Claude Fleet (IP-002)

## Phase 0: Monorepo Bootstrap

- [ ] **0.1** Set up Bun workspaces
- [ ] **0.2** Configure TypeScript project references

## Phase 1: Models, Types, and Shared Infrastructure

- [ ] **1.1** Create FleetNode model and types
- [ ] **1.2** Create FleetSession model and types (9 states + subStatus + statusVersion)
- [ ] **1.3** Create SessionEvent, HookRun, CleanupJob models and types
- [ ] **1.4** Create modelRouter CRUD endpoints for all fleet models
- [ ] **1.5** Create fleet-types package with shared Zod schemas (including input validation)
- [ ] **1.6** Session state machine utility (transition table + optimistic concurrency)
- [ ] **1.7** Unit tests for state machine and Zod schemas

## Phase 2: Worker Daemon Core

- [ ] **2.1** Initialize shade-worker package (Express, auth, config)
- [ ] **2.2** tmux control module (including discoverSessions)
- [ ] **2.3** Git worktree module (including listWorktrees)
- [ ] **2.4** Hook runner module
- [ ] **2.5** Heartbeat loop
- [ ] **2.6** Repo config parser
- [ ] **2.7** Worker startup reconciliation (discover existing tmux/worktrees)
- [ ] **2.8** systemd unit file
- [ ] **2.9** Unit tests for worker modules

## Phase 3: Session Lifecycle

- [ ] **3.1** Control plane fleet plugin (custom routes + worker client)
- [ ] **3.2** Heartbeat receiver endpoint (+ reconciliation data)
- [ ] **3.3** Node health monitor
- [ ] **3.4** Create session flow (control plane, with optimistic concurrency)
- [ ] **3.5** Create session flow (worker)
- [ ] **3.6** Stop/interrupt session (both sides)
- [ ] **3.7** Integration tests for session lifecycle

## Phase 4: Interactive Control

- [ ] **4.1** Worker interactive control endpoints (Zod validated)
- [ ] **4.2** Control plane interactive proxy endpoints (validated + audit logged)
- [ ] **4.3** Pane output capture
- [ ] **4.4** Attach info endpoint
- [ ] **4.5** Basic state inference (updates subStatus)
- [ ] **4.6** Tests for interactive control and audit logging

## Phase 5: Merge Detection and Cleanup

- [ ] **5.1** GitHub webhook receiver
- [ ] **5.2** PR/branch to session mapping
- [ ] **5.3** Cleanup job creation and runner
- [ ] **5.4** Worker cleanup flow (idempotent)
- [ ] **5.5** Human lock endpoints
- [ ] **5.6** Stale session cleanup
- [ ] **5.7** Tests for merge detection, cleanup, and human lock

## Phase 6: Frontend Dashboard

- [ ] **6.1** Regenerate SDK + manual RTK Query hooks for custom fleet endpoints
- [ ] **6.2** Fleet tab and navigation
- [ ] **6.3** Fleet Dashboard screen
- [ ] **6.4** Fleet Sessions list screen
- [ ] **6.5** Session Detail screen (with sub-status display)
- [ ] **6.6** Fleet Nodes list and detail screens
