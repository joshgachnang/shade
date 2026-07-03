# Agent Task Board & Worker Pool (IP-009) — Task List

Source: [Agent-Task-Board.md](../implementationPlans/Agent-Task-Board.md)

## Phase 1: Model & CRUD

- [ ] **1.1** `AgentTask` model + types (status machine, claim/reclaim indexes)
- [ ] **1.2** `taskWorker` AppConfig block (enabled, concurrency, pollMs, heartbeatMs, staleMs, taskTimeoutMs)
- [ ] **1.3** `/agentTasks` CRUD route + adminConfig registration + `"delegated"` TaskRunLog trigger

## Phase 2: Worker Service

- [ ] **2.1** Claim/reclaim primitives (`taskBoard.ts`: atomic claim, heartbeat, complete/fail-with-retry, stale reclaim)
- [ ] **2.2** `TaskWorkerService` (concurrency loop, DirectAgentRunner execution, timeout abort, deliverResult via ChannelManager, TaskRunLog)
- [ ] **2.3** Wire into orchestrator startup behind `taskWorker.enabled`

## Phase 3: MCP Tools

- [ ] **3.1** `delegate_task` / `get_task_result` / `list_agent_tasks` / `cancel_agent_task` (one-level depth rule)
- [ ] **3.2** Delegation prompt block

## Phase 4: SDK Subagents

- [ ] **4.1** Enable Claude Agent SDK subagents in DirectAgentRunner (`agent.enableSubagents` flag)

## Phase 5: Docs

- [ ] **5.1** Update `docs/architecture/` docs (note IP-010 seam)
