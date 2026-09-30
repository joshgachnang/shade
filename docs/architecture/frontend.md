# Frontend

Expo (React Native + web) app in `frontend/`, built on `@terreno/ui`, Expo Router, and RTK Query.

## Navigation & screens

Tab-based sidebar navigation (`app/(tabs)/_layout.tsx`, `SidebarNavigation` from `@terreno/ui`):

| Screen | Route | Purpose |
|---|---|---|
| Home | `(tabs)/index.tsx` | Dashboard/feed |
| Search | `(tabs)/search.tsx` | Global search across content |
| Movies | `(tabs)/movies/` | Movie CRUD, processing progress, frame drill-down |
| Features | `(tabs)/features/` | Feature tracker with status badges, brewery phase, and PR links |
| Admin | `(tabs)/admin/[model]*.tsx` | Generic CRUD for all backend models via `@terreno/admin-frontend`; plus card-preview tool and EdgeAgent detail views |
| Profile | `(tabs)/profile.tsx` | User profile; admin entry point |
| Console | `app/console.tsx` | Full-screen **Shade Console** — Claude-agent interaction UI (chat, typing indicators, plan visualization, multiple shell layouts). Components in `frontend/components/console/` |
| Login | `app/login.tsx` | Auth entry; unauthenticated users are redirected here after rehydration |

The Admin App Config form is schema-driven. Its `brewery` object exposes the command, event and narration timing, message-line limit, optional agent override, and silence alert threshold; see [Brewery configuration](./backend.md#brewery-configuration) for defaults.

## Brewery progress on Features

The Features list reads records from the `data` array in the `GET /features` response (`{data: [...], limit: 100, more: false, total: N}`). The separate resumable-features action retains its `{results, count}` response.

Open **Features** to see each run’s status, including the warning badge `awaiting approval`. Brewery cards show their reported phase (for example, `Brewery: review`) and an **Open PR #42** link when a PR number and HTTP(S) URL are available. The URL comes from the brewery PR event and is persisted on `Feature.brewery.prUrl`; no host is inferred from the repository name. On web the PR opens in a new tab without opening the feature detail screen. Native uses the platform link handler.

Legacy features and runs without a phase omit the phase line. A PR number without a usable URL remains plain text. Features without a PR omit it entirely. Opening the rest of the card still navigates to feature details. Existing loading, empty, step progress, and error displays remain available.

Browser verification: `bunx playwright test e2e/features-brewery.spec.ts --no-deps` uses synthetic responses at the HTTP boundary and runs on desktop and mobile web. Native external-link handling requires device QA.

## State & SDK generation

- Store (`frontend/store/`): Redux Toolkit + `@terreno/rtk` auth slice, redux-persist (persists auth + app state, not the RTK Query cache), global RTK error middleware.
- **SDK flow**: backend serves OpenAPI at `/openapi.json` → `bun run sdk` (`scripts/generate-sdk.ts` + `openapi-config.ts`) regenerates `store/openApiSdk.ts` with typed hooks (`useListMoviesQuery`, `useCreateFeatureMutation`, …). Never hand-edit `openApiSdk.ts`.

## Conventions

- Use generated SDK hooks and `@terreno/ui` components exclusively; Luxon for dates.
- Route files need `export default` (Expo Router requirement).
- Rules live in `.claude/rules/frontend/`.

## Testing

- Playwright E2E in `e2e/` (auth, navigation, accessibility, 404) with `loginAs()` helper; QA test cases as Markdown in `qa/test-cases/`.
