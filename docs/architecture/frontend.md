# Frontend

Expo (React Native + web) app in `frontend/`, built on `@terreno/ui`, Expo Router, and RTK Query.

## Navigation & screens

Tab-based sidebar navigation (`app/(tabs)/_layout.tsx`, `SidebarNavigation` from `@terreno/ui`):

| Screen | Route | Purpose |
|---|---|---|
| Home | `(tabs)/index.tsx` | Dashboard/feed |
| Search | `(tabs)/search.tsx` | Global search across content |
| Movies | `(tabs)/movies/` | Movie CRUD, processing progress, frame drill-down |
| Features | `(tabs)/features/` | Feature tracker with status badges (planned → in_progress → complete) |
| Admin | `(tabs)/admin/[model]*.tsx` | Generic CRUD for all backend models via `@terreno/admin-frontend`; plus card-preview tool and EdgeAgent detail views |
| Profile | `(tabs)/profile.tsx` | User profile; admin entry point |
| Console | `app/console.tsx` | Full-screen **Shade Console** — Claude-agent interaction UI (chat, typing indicators, plan visualization, multiple shell layouts). Components in `frontend/components/console/` |
| Login | `app/login.tsx` | Auth entry; unauthenticated users are redirected here after rehydration |

## State & SDK generation

- Store (`frontend/store/`): Redux Toolkit + `@terreno/rtk` auth slice, redux-persist (persists auth + app state, not the RTK Query cache), global RTK error middleware.
- **SDK flow**: backend serves OpenAPI at `/openapi.json` → `bun run sdk` (`scripts/generate-sdk.ts` + `openapi-config.ts`) regenerates `store/openApiSdk.ts` with typed hooks (`useListMoviesQuery`, `useCreateFeatureMutation`, …). Never hand-edit `openApiSdk.ts`.

## Conventions

- Use generated SDK hooks and `@terreno/ui` components exclusively; Luxon for dates.
- Route files need `export default` (Expo Router requirement).
- Rules live in `.claude/rules/frontend/`.

## Testing

- Playwright E2E in `e2e/` (auth, navigation, accessibility, 404) with `loginAs()` helper; QA test cases as Markdown in `qa/test-cases/`.
