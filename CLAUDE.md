# Shade

A full-stack application built with the Terreno framework.

## Project Structure

- **frontend/** - Expo/React Native frontend
- **backend/** - Express/Mongoose backend

## Development

```bash
# Install dependencies
cd backend && bun install
cd frontend && bun install

# Start backend (port 4020)
cd backend && bun run dev

# Start frontend (port 8082)
cd frontend && bun run web

# Regenerate SDK after backend changes
cd frontend && bun run sdk
```

## Adding Features

1. Create model in `backend/src/models/`
2. Create route in `backend/src/api/`
3. Register route in `backend/src/server.ts`
4. Regenerate SDK: `cd frontend && bun run sdk`
5. Create screens in `frontend/app/`

## Code Style

- Use TypeScript with ES modules
- Use Luxon for dates
- Prefer const arrow functions
- Named exports preferred
- Use interfaces over types
