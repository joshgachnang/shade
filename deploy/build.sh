#!/usr/bin/env bash
# Build the Shade backend as a single Bun executable
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
OUTPUT="$BACKEND_DIR/shade-server"

echo "=== Building Shade Server Binary ==="

cd "$BACKEND_DIR"

# Install dependencies
echo "Installing dependencies..."
bun install

# Compile the single executable
echo "Compiling binary..."
# claude-agent-sdk has native/node dependencies that can't be bundled.
# Keep it external so it's loaded from node_modules on the server.
bun build src/index.ts --compile \
  --external @anthropic-ai/claude-agent-sdk \
  --external @slack/bolt \
  --external @slack/web-api \
  --external @terreno/api \
  --external mongoose \
  --external pino \
  --external pino-pretty \
  --outfile "$OUTPUT"

ls -lh "$OUTPUT"
echo ""
echo "Binary built: $OUTPUT"
echo "Deploy with: bash deploy/deploy.sh"
