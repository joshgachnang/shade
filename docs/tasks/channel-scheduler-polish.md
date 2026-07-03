# Channel & Scheduler Polish (IP-011) — Task List

Source: [Channel-Scheduler-Polish.md](../implementationPlans/Channel-Scheduler-Polish.md)

Three independent mini-phases; any order, separate PRs.

## Phase 1: Email Reply Threading

- [ ] **1.1** Store inbound email metadata (emailMessageId, from, subject, references)
- [ ] **1.2** Thread-aware replies (To=original sender, In-Reply-To/References, `Re:` subject, fallback to current behavior)

## Phase 2: Adaptive Scheduler Tick

- [ ] **2.1** setTimeout-chain scheduler aimed at earliest `nextRunAt`, clamped [5s, pollIntervals.scheduler]; add `wake()`
- [ ] **2.2** Call `wake()` from task create/resume IPC handlers

## Phase 3: Model Routing

- [ ] **3.1** Honor `Group.modelConfig` in DirectAgentRunner (and log the actual model to AIRequest)
- [ ] **3.2** `agent.auxiliaryModel` AppConfig field; trivia detector resolves override ?? auxiliary
