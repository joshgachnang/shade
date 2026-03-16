#!/usr/bin/env bash
# Deploy the compiled binary to the server
set -euo pipefail

SERVER="${SERVER:-shade}"
FROM_RELEASE=false

for arg in "$@"; do
  case "$arg" in
    --from-release) FROM_RELEASE=true ;;
    *) SERVER="$arg" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BINARY="$PROJECT_ROOT/backend/shade-server"
RELEASE_URL="https://github.com/joshgachnang/shade/releases/latest/download/shade-server"
REMOTE_PATH="/opt/shade/shade-server"

echo "=== Deploying to $SERVER ==="

if [ "$FROM_RELEASE" = true ]; then
  echo "Downloading latest binary from GitHub releases..."
  ssh "$SERVER" "curl -fSL -o $REMOTE_PATH $RELEASE_URL && chmod +x $REMOTE_PATH"
else
  if [ ! -f "$BINARY" ]; then
    echo "Error: Binary not found at $BINARY"
    echo "Run 'bash deploy/build.sh' first, or use --from-release to download from GitHub"
    exit 1
  fi

  echo "Uploading binary..."
  rsync -avz --progress "$BINARY" "$SERVER:$REMOTE_PATH"
fi

# Install node_modules on the server (for external dependencies)
echo "Installing dependencies on server..."
ssh "$SERVER" "cd /opt/shade && bun install"

# Restart the service
echo "Restarting service..."
ssh "$SERVER" "sudo systemctl restart shade"

echo ""
echo "=== Deployed ==="
echo "Check status: ssh $SERVER 'sudo systemctl status shade'"
echo "View logs:    ssh $SERVER 'sudo journalctl -u shade -f'"
