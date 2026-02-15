---
description: Shade backend guidelines
applyTo: backend/**/*
---
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

## Known Exceptions

- `type` aliases are acceptable for Mongoose model types that use `&` intersections or generics (e.g., `DefaultModel<T>`, `UserDocument`)
- `Date` types in model interfaces are required by Mongoose schema typing

## Adding a New Model

1. Create model in `src/models/yourModel.ts`
2. Create types in `src/types/models/yourModelTypes.ts`
3. Export from `src/models/index.ts` and `src/types/models/index.ts`
4. Create route in `src/api/yourModel.ts`
5. Register route in `src/server.ts`
