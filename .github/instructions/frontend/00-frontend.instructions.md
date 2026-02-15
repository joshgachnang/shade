---
description: Shade frontend guidelines
applyTo: frontend/**/*
---
# Shade Frontend

Expo/React Native frontend using @terreno/ui and @terreno/rtk.

## Development

```bash
bun run web      # Start web frontend on port 8082
bun run sdk      # Regenerate SDK from backend OpenAPI spec
bun run lint     # Lint code
```

## Frontend Conventions

- Use generated SDK hooks from `@/store/openApiSdk`
- Use @terreno/ui components (Box, Page, Button, TextField, etc.)
- Never modify `openApiSdk.ts` manually - regenerate with `bun run sdk`
- Use Luxon for date operations
- Use Redux Toolkit for state management

## Adding a New Screen

1. Regenerate SDK if backend changed: `bun run sdk`
2. Create screen in `app/` directory
3. Use @terreno/ui components for layout
4. Use SDK hooks for data fetching
