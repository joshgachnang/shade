# Refactor Plan

## Phase 1: Backend - Extract logError utility
- [x] Create `backend/src/orchestrator/errors.ts` with `logError` helper
- [x] Replace duplicated error logging in all orchestrator files
- [x] Run typecheck

## Phase 2: Backend - Collapse IPC handlers
- [x] Merge `handlePauseTask`, `handleResumeTask`, `handleCancelTask` into `handleTaskStatusChange`
- [x] Run typecheck

## Phase 3: Backend - Break up GroupQueue
- [x] Extract system prompt building into `buildSystemPrompt` in memory.ts
- [x] Extract task run log management into `updateTaskRunLogStatus` helper
- [x] Extract `handleAgentSuccess` and `safeAppendTranscript` from `executeAgentRun`
- [x] Run typecheck

## Phase 4: Backend - Connector registry for ChannelManager
- [x] Create connector factory registry pattern with `ConnectorFactory` type
- [x] Replace hardcoded switch with factory lookup in `connectChannel`
- [x] Add `createSlackConnector` and `createWebhookConnector` factory functions
- [x] Run typecheck

## Phase 5: Frontend - Error types and cleanup
- [x] Add `ApiErrorResponse` type definition in sdk.ts
- [x] Fix unsafe error casting in login.tsx to use `ApiErrorResponse`
- [x] Remove unused `getSdkHook` and lodash/startCase import from sdk.ts
- [x] Remove Sentry stubs from utils/index.ts
- [x] Remove unused `useSentryAndToast` from errors.ts and its re-export
- [x] Rename `ignoredErrors` to `IGNORED_ERRORS` constant
- [x] Run typecheck
