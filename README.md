# Shade
Mr. Gachnang, I am here to be your butler and serve all of your always *excellent* ideas and will certainly not mention how many trees and how much water I'm destroying in the process.

# Overview
Shade is a self-hosted personal AI butler: a multi-channel agent orchestrator that receives messages from Slack, iMessage, email, and webhooks, runs Claude agents against them, executes scheduled (cron) tasks, and takes real-world actions through MCP tools (calendar, contacts, reminders, media servers, task scheduling).

- **Backend** (`backend/`) — Express + Mongoose on `@terreno/api`; hosts the orchestrator, channel connectors, scheduler, agent runners (Claude Agent SDK), and admin UI.
- **Frontend** (`frontend/`) — Expo (React Native + web) app with the Shade Console, feature tracker, movie analysis UI, and generic admin CRUD.
- **Edge agents** (`packages/`) — remote daemons (e.g. an iMessage relay on a Mac) that register, heartbeat, and push messages back to the server.

Full internal documentation lives in [`docs/architecture/`](./docs/architecture/README.md).
