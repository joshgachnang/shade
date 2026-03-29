#!/usr/bin/env bash
# Setup script for Shade backend on Ubuntu 22.04/24.04
# Run as root or with sudo on the target server
set -euo pipefail

echo "=== Shade Server Setup ==="

# Install system dependencies
apt-get update
apt-get install -y curl unzip gnupg lsb-release

# --- Install Bun ---
if ! command -v bun &>/dev/null; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo "Bun installed: $(bun --version)"
else
  echo "Bun already installed: $(bun --version)"
fi

# --- Install MongoDB 7 ---
if ! command -v mongod &>/dev/null; then
  echo "Installing MongoDB 7..."
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
    gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
  MONGO_CODENAME=$(lsb_release -cs)
  if [ "$MONGO_CODENAME" = "noble" ]; then MONGO_CODENAME="jammy"; fi
  echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu ${MONGO_CODENAME}/mongodb-org/7.0 multiverse" | \
    tee /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update
  apt-get install -y mongodb-org
  systemctl enable mongod
  systemctl start mongod
  echo "MongoDB installed and started"
else
  echo "MongoDB already installed"
  systemctl enable mongod
  systemctl start mongod
fi

# --- Create app directories ---
DATA_DIR="/data/shade"
mkdir -p /opt/shade
mkdir -p "$DATA_DIR/groups" "$DATA_DIR/sessions" "$DATA_DIR/ipc" "$DATA_DIR/plugins"
mkdir -p /var/log/shade

# --- Create shade system user ---
if ! id -u shade &>/dev/null; then
  useradd --system --home /opt/shade --shell /usr/sbin/nologin shade
fi
chown -R shade:shade /opt/shade "$DATA_DIR" /var/log/shade

# --- Create environment file ---
if [ ! -f /opt/shade/.env ]; then
  cat > /opt/shade/.env <<'EOF'
PORT=4020
NODE_ENV=production
MONGO_URI=mongodb://localhost:27017/shade
SHADE_DATA_DIR=/data/shade
SHADE_ASSISTANT_NAME=Shade
SHADE_MAX_GLOBAL_CONCURRENCY=5
ANTHROPIC_API_KEY=
TOKEN_SECRET=
REFRESH_TOKEN_SECRET=
EOF
  chown shade:shade /opt/shade/.env
  chmod 600 /opt/shade/.env
  echo "Created /opt/shade/.env — edit to add secrets"
else
  echo "/opt/shade/.env already exists, skipping"
fi

# --- Create package.json for external dependencies ---
if [ ! -f /opt/shade/package.json ]; then
  cat > /opt/shade/package.json <<'EOF'
{
  "name": "shade-server",
  "private": true,
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.42",
    "passport-local-mongoose": "^9.0.1"
  }
}
EOF
  chown shade:shade /opt/shade/package.json
  cd /opt/shade && sudo -u shade bun install
  echo "Installed external dependencies"
else
  echo "/opt/shade/package.json already exists, skipping"
fi

# --- Install systemd service ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/shade-backend.service" /etc/systemd/system/shade-backend.service
systemctl daemon-reload
systemctl enable shade-backend
echo "Systemd service installed and enabled"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit /opt/shade/.env — add ANTHROPIC_API_KEY, TOKEN_SECRET, REFRESH_TOKEN_SECRET"
echo "  2. Deploy: ./shade remote-deploy <host>"
echo "  3. Start:  ssh <host> 'sudo systemctl start shade-backend'"
echo "  4. Logs:   ssh <host> 'sudo journalctl -u shade-backend -f'"
