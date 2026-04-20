# Shade Backend

Express/Mongoose backend using @terreno/api.

## Development

```bash
bun run dev      # Start on port 4020
bun run test     # Run tests
bun run lint     # Lint code
```

## Backend Conventions

- Use `modelRouter` for CRUD endpoints
- Use `APIError` for error responses: `throw new APIError({status: 400, title: "Message"})`
- Use `logger.info/warn/error/debug` for logging
- Use `Model.findExactlyOne` or `Model.findOneOrNone` (not `Model.findOne`)
- All model types live in `src/types/models/`
- In routes: `req.user` is `UserDocument | undefined`

## Configuration — always use `AppConfig`

- **Always** read runtime config (API keys, model names, webhooks, feature flags, URLs, thresholds) from the `AppConfig` model via `loadAppConfig()`. Do not read directly from `process.env` in application code.
- Environment variables are reserved for bootstrap-only values (`MONGO_URI`, `PORT`). Everything else belongs in `AppConfig`.
- When adding a new config value:
  1. Add it to `src/models/appConfig.ts` and `src/types/models/appConfigTypes.ts`.
  2. If a third-party SDK reads it from `process.env` synchronously (e.g. `@anthropic-ai/sdk`, `openai`), extend `hydrateEnvFromConfig` + `RESTART_REQUIRED_FIELDS` in `src/utils/configEnv.ts`.
- Never hardcode API keys, model names, or service URLs.

## Known Exceptions

- `type` aliases are acceptable for Mongoose model types that use `&` intersections or generics (e.g., `DefaultModel<T>`, `UserDocument`)
- `Date` types in model interfaces are required by Mongoose schema typing

## Adding a New Model

1. Create model in `src/models/yourModel.ts`
2. Create types in `src/types/models/yourModelTypes.ts`
3. Export from `src/models/index.ts` and `src/types/models/index.ts`
4. Create route in `src/api/yourModel.ts`
5. Register route in `src/server.ts`
