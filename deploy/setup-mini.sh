#!/usr/bin/env bash
set -euo pipefail

# Setup script for mini deploy target
# Run this on mini: ssh mini 'bash -s' < deploy/setup-mini.sh

echo "=== Updating launchd plists ==="

# Update backend plist - change worktree path to /opt/shade
sed -i.bak \
  -e 's|/Users/joshgachnang/.claude-worktrees/shade/movie-parser/dist/shade-backend.js|/opt/shade/dist/shade-backend.js|' \
  -e 's|/Users/joshgachnang/.claude-worktrees/shade/movie-parser|/opt/shade|' \
  ~/Library/LaunchAgents/com.shade.backend.plist

# Update worker plist
sed -i.bak \
  -e 's|/Users/joshgachnang/.claude-worktrees/shade/movie-parser/dist/shade-worker.js|/opt/shade/dist/shade-worker.js|' \
  -e 's|/Users/joshgachnang/.claude-worktrees/shade/movie-parser|/opt/shade|' \
  ~/Library/LaunchAgents/com.shade.worker.plist

echo "Updated plists:"
grep -E 'shade-backend\.js|shade-worker\.js|WorkingDirectory' ~/Library/LaunchAgents/com.shade.backend.plist
grep -E 'shade-backend\.js|shade-worker\.js|WorkingDirectory' ~/Library/LaunchAgents/com.shade.worker.plist

echo ""
echo "=== Copying current JS bundles to /opt/shade/dist/ ==="
# Bootstrap with current bundles so services work after plist reload
if [ -f ~/.claude-worktrees/shade/movie-parser/dist/shade-backend.js ]; then
  cp ~/.claude-worktrees/shade/movie-parser/dist/shade-backend.js /opt/shade/dist/
  cp ~/.claude-worktrees/shade/movie-parser/dist/shade-worker.js /opt/shade/dist/
  echo "Copied existing bundles"
else
  echo "WARNING: No existing bundles found - services will fail until first deploy"
fi

echo ""
echo "=== Setting up deploy SSH key ==="
mkdir -p ~/.ssh
if [ ! -f ~/.ssh/authorized_keys ] || ! grep -q "shade-deploy" ~/.ssh/authorized_keys; then
  echo "Add the deploy public key to ~/.ssh/authorized_keys:"
  echo "  cat /path/to/shade-deploy.pub >> ~/.ssh/authorized_keys"
else
  echo "Deploy key already in authorized_keys"
fi

echo ""
echo "=== Reloading launchd services ==="
launchctl unload ~/Library/LaunchAgents/com.shade.backend.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.shade.worker.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.shade.backend.plist
launchctl load ~/Library/LaunchAgents/com.shade.worker.plist

sleep 3
echo ""
echo "=== Service status ==="
launchctl list | grep com.shade || echo "No shade services found"

echo ""
echo "Done! Check logs at ~/Library/Logs/Shade/"
