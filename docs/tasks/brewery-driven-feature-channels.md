# Tasks: Brewery-Driven Feature Channels (IP-018)

## Phase 1: brewery (tools/brewery)
- [ ] **T1** Emit `events.jsonl` (step.start/end, waiting, resumed, note, pr, ci, done, error)
- [ ] **T2** Stream claude (`stream-json`) and codex (`--json`) output into `narration` events; keep raw logs
- [ ] **T3** `brewery note` + notes in step headers and context.md
- [ ] **T4** `brewery resume` + run lock / `run.pid` (kill-safe during roast)

## Phase 2: Shade models + config
- [ ] **T5** `Group.featureDriver`, `Feature.brewery` subdoc, `awaiting_approval` status
- [ ] **T6** `AppConfig.brewery` section + admin UI fields

## Phase 3: Shade driver
- [ ] **T7** `BreweryDriver.start`: workspace (zerg / local worktree), detached `brewery distill`
- [ ] **T8** Events poller → Slack (step message + narration edits, sign-off plan post, PR/done/error, dead-run alert)
- [ ] **T9** `handleMessage`: answer when waiting, `now:` interrupt, queue note, `stop`
- [ ] **T10** GroupQueue routing: brewery groups never reach an agent runner (test)
- [ ] **T11** `create_feature` creates brewery groups; delete roast memory/greeting

## Phase 4: Verify
- [ ] **T12** Harness E2E with a fake brewery command: request → plan posted → `ok` → progress → PR posted
- [ ] **T13** Features screen shows awaiting approval / phase / PR
