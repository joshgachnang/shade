---
root: true
targets: ["cursor", "windsurf", "copilot"]
description: "Shade root guidelines"
globs: ["**/*"]
---

# Shade

A full-stack application built with the Terreno framework

## Project Structure

- **frontend/** - Expo/React Native frontend using @terreno/ui and @terreno/rtk
- **backend/** - Express/Mongoose backend using @terreno/api

## Development

Uses [Bun](https://bun.sh/) as the package manager.

```bash
# Backend
cd backend && bun run dev    # Start backend on port 4020

# Frontend
cd frontend && bun run web   # Start web frontend
cd frontend && bun run sdk   # Regenerate SDK after backend changes
```

## Code Style

### TypeScript/JavaScript
- Use ES module syntax and TypeScript for all code
- Prefer interfaces over types; avoid enums, use maps
- Prefer const arrow functions over `function` keyword
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`)
- Use camelCase directories (e.g., `components/authWizard`)
- Favor named exports
- Use the RORO pattern (Receive an Object, Return an Object)

### Dates and Time
- Always use Luxon instead of Date or dayjs

### Error Handling
- Check error conditions at start of functions and return early
- Limit nested if statements
- Use multiline syntax with curly braces for all conditionals

### Testing
- Use bun test with expect for testing

### Logging
- Frontend: Use `console.info`, `console.debug`, `console.warn`, or `console.error` for permanent logs
- Backend: Use `logger.info/warn/error/debug` for permanent logs
- Use `console.log` only for debugging (to be removed)

### Development Practices
- Don't apologize for errors: fix them
- Prioritize modularity, DRY, performance, and security
- Focus on readability over performance
- Write complete, functional code without TODOs when possible
- Comments should describe purpose, not effect

## Package Reference

### @terreno/api

REST API framework providing:

- **modelRouter**: Auto-generates CRUD endpoints for Mongoose models
- **Permissions**: `IsAuthenticated`, `IsOwner`, `IsAdmin`, `IsAuthenticatedOrReadOnly`
- **Query Filters**: `OwnerQueryFilter` for filtering list queries by owner
- **setupServer**: Express server setup with auth, OpenAPI, and middleware
- **APIError**: Standardized error handling
- **logger**: Winston-based logging

Key imports:
```typescript
import {
  modelRouter,
  setupServer,
  Permissions,
  OwnerQueryFilter,
  APIError,
  logger,
  asyncHandler,
  authenticateMiddleware,
} from "@terreno/api";
```

#### modelRouter Usage

```typescript
import {modelRouter, modelRouterOptions, Permissions} from "@terreno/api";

const router = modelRouter(YourModel, {
  permissions: {
    list: [Permissions.IsAuthenticated],
    create: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
    delete: [],  // Disabled
  },
  sort: "-created",
  queryFields: ["_id", "type", "name"],
});
```

#### Custom Routes

For non-CRUD endpoints, use the OpenAPI builder:

```typescript
import {asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";

router.get("/yourRoute/:id", [
  authenticateMiddleware(),
  createOpenApiBuilder(options)
    .withTags(["yourTag"])
    .withSummary("Brief summary")
    .withPathParameter("id", {type: "string"})
    .withResponse(200, {data: {type: "object"}})
    .build(),
], asyncHandler(async (req, res) => {
  return res.json({data: result});
}));
```

#### API Conventions

- Throw `APIError` with appropriate status codes: `throw new APIError({status: 400, title: "Message"})`
- Do not use `Model.findOne` - use `Model.findExactlyOne` or `Model.findOneOrThrow`
- Define statics/methods by direct assignment: `schema.methods = {bar() {}}`
- All model types live in `src/types/models/`
- In routes: `req.user` is `UserDocument | undefined`

### @terreno/ui

React Native component library with 88+ components:

- **Layout**: Box, Page, SplitPage, Card
- **Forms**: TextField, SelectField, DateTimeField, CheckBox
- **Display**: Text, Heading, Badge, DataTable
- **Actions**: Button, IconButton, Link
- **Feedback**: Spinner, Modal, Toast
- **Theming**: TerrenoProvider, useTheme

Key imports:
```typescript
import {
  Box,
  Button,
  Card,
  Page,
  Text,
  TextField,
  TerrenoProvider,
} from "@terreno/ui";
```

#### UI Component Examples

Layout with Box:
```typescript
<Box direction="row" padding={4} gap={2} alignItems="center">
  <Text>Content</Text>
  <Button text="Action" />
</Box>
```

Buttons:
```typescript
<Button
  text="Submit"
  variant="primary"  // 'primary' | 'secondary' | 'outline' | 'ghost'
  onClick={handleSubmit}
  loading={isLoading}
  iconName="check"
/>
```

Forms:
```typescript
<TextField
  label="Email"
  value={email}
  onChangeText={setEmail}
  error={emailError}
  helperText="Enter a valid email"
/>
```

#### UI Common Pitfalls

- Don't use inline styles when theme values are available
- Don't use raw `View`/`Text` when `Box`/@terreno/ui `Text` are available
- Don't forget loading and error states
- Don't use `style` prop when equivalent props exist (`padding`, `margin`)
- Never modify `openApiSdk.ts` manually

### @terreno/rtk

Redux Toolkit Query integration:

- **generateAuthSlice**: Creates auth reducer and middleware with JWT handling
- **emptyApi**: Base RTK Query API for code generation
- **Platform utilities**: Secure token storage

Key imports:
```typescript
import {generateAuthSlice} from "@terreno/rtk";
```

Always use generated SDK hooks - never use `axios` or `request` directly:

```typescript
// Correct
import {useGetYourRouteQuery} from "@/store/openApiSdk";
const {data, isLoading, error} = useGetYourRouteQuery({id: "value"});

// Wrong - don't use axios directly
// const result = await axios.get("/api/yourRoute/value");
```

## React Best Practices

- Use functional components with `React.FC` type
- Import hooks directly: `import {useEffect, useMemo} from 'react'`
- Always provide return types for functions
- Add explanatory comment above each `useEffect`
- Wrap callbacks in `useCallback`
- Prefer const arrow functions
- Use inline styles over `StyleSheet.create`
- Use Luxon for date operations
- Place static content and interfaces at beginning of file
- Minimize `use client`, `useEffect`, and `setState`
- Always support React-Native Web
