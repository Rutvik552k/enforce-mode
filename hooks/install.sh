#!/bin/bash
# enforce-mode — standalone installer for Unix/macOS
#
# Copies hook files to ~/.claude/hooks/ and wires them into settings.json.
# Idempotent — safe to run multiple times. Use --force to reinstall.
#
# Usage: bash install.sh [--force]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

FORCE=false
[ "$1" = "--force" ] && FORCE=true

# Check Node.js (required for JSON manipulation)
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required. Install it first."
  exit 1
fi

# Check if already installed
if [ -f "$HOOKS_DIR/enforce-activate.js" ] && [ "$FORCE" != "true" ]; then
  echo "enforce-mode is already installed. Use --force to reinstall."
  exit 0
fi

echo "Installing enforce-mode..."

# Create hooks directory
mkdir -p "$HOOKS_DIR"

# Copy hook files
cp "$SCRIPT_DIR/enforce-config.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-detect.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-rules.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-activate.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-mode-tracker.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-statusline.sh" "$HOOKS_DIR/"
chmod +x "$HOOKS_DIR/enforce-statusline.sh"

# Copy rules directory
mkdir -p "$CLAUDE_DIR/rules/domains"
cp "$SCRIPT_DIR/../rules/universal.md" "$CLAUDE_DIR/rules/"
cp "$SCRIPT_DIR/../rules/domains/"*.md "$CLAUDE_DIR/rules/domains/"

# Copy skills directory
mkdir -p "$CLAUDE_DIR/skills/enforce"
cp "$SCRIPT_DIR/../skills/enforce/SKILL.md" "$CLAUDE_DIR/skills/enforce/"

# Wire hooks into settings.json
if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

# Backup settings.json
cp "$SETTINGS_FILE" "$SETTINGS_FILE.bak"

# Use Node.js to merge hook entries into settings.json
node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));

if (!settings.hooks) settings.hooks = {};

// SessionStart hook
if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
const ssHooks = settings.hooks.SessionStart;
const ssExists = ssHooks.some(h =>
  h.command && h.command.includes('enforce-activate')
);
if (!ssExists) {
  ssHooks.push({
    command: 'node $HOOKS_DIR/enforce-activate.js',
    timeout: 10000
  });
}

// UserPromptSubmit hook
if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
const upsHooks = settings.hooks.UserPromptSubmit;
const upsExists = upsHooks.some(h =>
  h.command && h.command.includes('enforce-mode-tracker')
);
if (!upsExists) {
  upsHooks.push({
    command: 'node $HOOKS_DIR/enforce-mode-tracker.js',
    timeout: 5000
  });
}

// Statusline
if (!settings.statusLine) {
  settings.statusLine = {
    type: 'command',
    command: 'bash $HOOKS_DIR/enforce-statusline.sh'
  };
}

fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
"

echo "enforce-mode installed successfully!"
echo "Default level: solo"
echo "Switch: /enforce solo|team|prod"
echo "Disable: /enforce off"
