#!/bin/bash
set -euo pipefail

BINARY_NAME="shade-imessage"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

# Normalize arch
if [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
elif [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
fi

BINARY="dist/${BINARY_NAME}-${PLATFORM}-${ARCH}"
INSTALL_DIR="${HOME}/.local/bin"

echo "=== Shade iMessage Agent Installer ==="
echo ""

# Check for binary
if [ ! -f "$BINARY" ]; then
  echo "Binary not found at $BINARY"
  echo "Run 'bun run build.ts' first, or specify the binary path:"
  echo "  BINARY=path/to/binary $0"
  exit 1
fi

# Prompt for config
read -rp "Shade URL (e.g. https://shade.example.com): " SHADE_URL
read -rp "Bootstrap Secret: " SHADE_BOOTSTRAP_SECRET
read -rp "Agent Name (default: imessage-$(hostname)): " AGENT_NAME
AGENT_NAME="${AGENT_NAME:-imessage-$(hostname)}"

# Install binary
echo ""
echo "Installing binary to ${INSTALL_DIR}/${BINARY_NAME}..."
mkdir -p "$INSTALL_DIR"
cp "$BINARY" "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

if [ "$PLATFORM" = "darwin" ]; then
  # macOS: install launchd plist
  PLIST_DIR="${HOME}/Library/LaunchAgents"
  PLIST_FILE="${PLIST_DIR}/com.shade.imessage.plist"
  LOG_FILE="${HOME}/Library/Logs/shade-imessage.log"

  mkdir -p "$PLIST_DIR"

  # Generate plist from template
  sed -e "s|__SHADE_URL__|${SHADE_URL}|g" \
      -e "s|__SHADE_BOOTSTRAP_SECRET__|${SHADE_BOOTSTRAP_SECRET}|g" \
      -e "s|__HOME__|${HOME}|g" \
      -e "s|/usr/local/bin/shade-imessage|${INSTALL_DIR}/${BINARY_NAME}|g" \
      com.shade.imessage.plist > "$PLIST_FILE"

  echo "Installed launchd plist to ${PLIST_FILE}"

  # Unload if already loaded
  launchctl bootout "gui/$(id -u)/com.shade.imessage" 2>/dev/null || true

  # Load and start
  launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"
  echo "Agent started via launchd"
  echo ""
  echo "View logs: tail -f ${LOG_FILE}"
  echo "Stop:      launchctl bootout gui/$(id -u)/com.shade.imessage"
  echo "Start:     launchctl bootstrap gui/$(id -u) ${PLIST_FILE}"

elif [ "$PLATFORM" = "linux" ]; then
  # Linux: install systemd user unit
  UNIT_DIR="${HOME}/.config/systemd/user"
  ENV_DIR="${HOME}/.config/shade"
  ENV_FILE="${ENV_DIR}/imessage.env"

  mkdir -p "$UNIT_DIR" "$ENV_DIR"

  # Write environment file
  cat > "$ENV_FILE" <<EOF
SHADE_URL=${SHADE_URL}
SHADE_BOOTSTRAP_SECRET=${SHADE_BOOTSTRAP_SECRET}
SHADE_AGENT_NAME=${AGENT_NAME}
EOF
  chmod 600 "$ENV_FILE"

  # Copy service file
  sed -e "s|/usr/local/bin/shade-imessage|${INSTALL_DIR}/${BINARY_NAME}|g" \
      shade-imessage.service > "${UNIT_DIR}/shade-imessage.service"

  systemctl --user daemon-reload
  systemctl --user enable shade-imessage
  systemctl --user start shade-imessage

  echo "Agent started via systemd"
  echo ""
  echo "View logs: journalctl --user -u shade-imessage -f"
  echo "Stop:      systemctl --user stop shade-imessage"
  echo "Start:     systemctl --user start shade-imessage"
fi

echo ""
echo "Done! The agent will register with Shade and wait for admin approval."
