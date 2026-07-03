# Gateway/Worker Process Split (IP-010) — Task List

Source: [Gateway-Worker-Split.md](../implementationPlans/Gateway-Worker-Split.md)

**Blocked until IP-009 is complete.**

## Phase 1: Worker Entrypoint

- [ ] **1.1** `workerMain.ts` + extracted shared `boot.ts` + `bun run worker` script + `/health` mini-app
- [ ] **1.2** Graceful SIGTERM drain + `taskWorker.runInGateway` flag

## Phase 2: Scheduler → Board

- [ ] **2.1** `scheduler.useTaskBoard` flag: due ScheduledTask → AgentTask (deliverResult, scheduledTaskId lineage)

## Phase 3: Deploy

- [ ] **3.1** `deploy/shade-worker.service` + setup-server.sh install
- [ ] **3.2** Watchdog scope check (gateway-only) + worker env example

## Phase 4: Cutover & Observability

- [ ] **4.1** `systemStatus` admin script: workers section (active workerIds, task counts)
- [ ] **4.2** Update `docs/architecture/` docs incl. 4-step rollout
