#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
USER_HOME="$(eval echo ~josh)"
BUN_BIN="$USER_HOME/.bun/bin/bun"

echo "=== Shade Server Setup ==="
echo "Project: $PROJECT_DIR"
echo ""

# --- Install bun if missing ---
if ! command -v bun &>/dev/null && [ ! -f "$BUN_BIN" ]; then
  echo "Installing bun..."
  sudo -u josh bash -c 'curl -fsSL https://bun.sh/install | bash'
fi

if [ -f "$BUN_BIN" ]; then
  BUN="$BUN_BIN"
elif command -v bun &>/dev/null; then
  BUN="$(command -v bun)"
else
  echo "ERROR: bun installation failed"
  exit 1
fi
echo "Using bun: $BUN"

# --- Prompt for optional values ---
echo ""
read -rp "Anthropic API key (leave blank to skip): " ANTHROPIC_API_KEY
read -rp "MongoDB URI [mongodb://localhost:27017/shade]: " MONGO_URI
MONGO_URI="${MONGO_URI:-mongodb://localhost:27017/shade}"

read -rp "Backend port [4020]: " PORT
PORT="${PORT:-4020}"

read -rp "Frontend port [8082]: " FRONTEND_PORT
FRONTEND_PORT="${FRONTEND_PORT:-8082}"

# --- Generate secrets ---
TOKEN_SECRET="$(openssl rand -hex 32)"
REFRESH_TOKEN_SECRET="$(openssl rand -hex 32)"
echo ""
echo "Generated TOKEN_SECRET and REFRESH_TOKEN_SECRET"

# --- Write backend .env ---
cat > "$PROJECT_DIR/backend/.env" <<EOF
PORT=$PORT
MONGO_URI=$MONGO_URI
TOKEN_SECRET=$TOKEN_SECRET
REFRESH_TOKEN_SECRET=$REFRESH_TOKEN_SECRET
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
EOF
echo "Wrote backend/.env"

# --- Write frontend .env ---
cat > "$PROJECT_DIR/frontend/.env" <<EOF
EXPO_PUBLIC_API_URL=http://localhost:$PORT
EOF
echo "Wrote frontend/.env"

# --- Install dependencies ---
echo ""
echo "Installing backend dependencies..."
sudo -u josh bash -c "cd '$PROJECT_DIR/backend' && '$BUN' install"

echo "Installing frontend dependencies..."
sudo -u josh bash -c "cd '$PROJECT_DIR/frontend' && '$BUN' install"

# --- Create systemd user services ---
SYSTEMD_DIR="$USER_HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"

cat > "$SYSTEMD_DIR/shade-backend.service" <<EOF
[Unit]
Description=Shade Backend
After=mongod.service

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR/backend
Environment=PATH=$USER_HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$BUN run start
EnvironmentFile=$PROJECT_DIR/backend/.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

cat > "$SYSTEMD_DIR/shade-frontend.service" <<EOF
[Unit]
Description=Shade Frontend
After=shade-backend.service

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR/frontend
Environment=PATH=$USER_HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$BUN expo start --web --port $FRONTEND_PORT
EnvironmentFile=$PROJECT_DIR/frontend/.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

chown -R josh:josh "$SYSTEMD_DIR/shade-backend.service" "$SYSTEMD_DIR/shade-frontend.service"
echo "Created systemd user services"

# --- Enable lingering and start services ---
loginctl enable-linger josh

sudo -u josh bash -c "XDG_RUNTIME_DIR=/run/user/$(id -u josh) systemctl --user daemon-reload"
sudo -u josh bash -c "XDG_RUNTIME_DIR=/run/user/$(id -u josh) systemctl --user enable shade-backend shade-frontend"
sudo -u josh bash -c "XDG_RUNTIME_DIR=/run/user/$(id -u josh) systemctl --user start shade-backend"
sudo -u josh bash -c "XDG_RUNTIME_DIR=/run/user/$(id -u josh) systemctl --user start shade-frontend"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Services:"
echo "  systemctl --user status shade-backend"
echo "  systemctl --user status shade-frontend"
echo "  systemctl --user restart shade-backend"
echo "  systemctl --user stop shade-backend"
echo "  journalctl --user -u shade-backend -f"
echo ""
echo "Backend:  http://localhost:$PORT"
echo "Frontend: http://localhost:$FRONTEND_PORT"
