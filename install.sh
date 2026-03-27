#!/usr/bin/env bash
set -euo pipefail

# Symlinks the `shade` CLI to a directory on PATH so it can be run from anywhere.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/shade"

# Pick install target: ~/.local/bin (preferred) or /usr/local/bin (fallback)
if [[ -d "$HOME/.local/bin" ]]; then
  TARGET_DIR="$HOME/.local/bin"
elif [[ -w "/usr/local/bin" ]]; then
  TARGET_DIR="/usr/local/bin"
else
  TARGET_DIR="$HOME/.local/bin"
  mkdir -p "$TARGET_DIR"
fi

TARGET="$TARGET_DIR/shade"

if [[ -L "$TARGET" ]]; then
  rm "$TARGET"
fi

ln -s "$SOURCE" "$TARGET"
echo "Linked: $TARGET -> $SOURCE"

# Check if target dir is on PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$TARGET_DIR"; then
  echo ""
  echo "Warning: $TARGET_DIR is not on your PATH."
  echo "Add this to your shell profile:"
  echo "  export PATH=\"$TARGET_DIR:\$PATH\""
fi
