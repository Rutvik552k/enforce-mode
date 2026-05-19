#!/bin/bash
# enforce-mode — standalone installer for Unix/macOS/Windows (Git Bash/MSYS2)
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

# Detect Windows (Git Bash / MSYS2 / Cygwin)
IS_WINDOWS=false
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  IS_WINDOWS=true
fi

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
cp "$SCRIPT_DIR/enforce-statusline.ps1" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-research-gate.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-test-gate.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-pre-completion.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-write-guard.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-bash-guard.js" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/enforce-stop-guard.js" "$HOOKS_DIR/"
chmod +x "$HOOKS_DIR/enforce-statusline.sh" 2>/dev/null || true
chmod +x "$HOOKS_DIR/enforce-write-guard.js" 2>/dev/null || true
chmod +x "$HOOKS_DIR/enforce-bash-guard.js" 2>/dev/null || true
chmod +x "$HOOKS_DIR/enforce-stop-guard.js" 2>/dev/null || true

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

# Convert paths to Windows-native for Node.js on MSYS2/Git Bash/Cygwin
# Node.js on Windows cannot read MSYS paths like /c/Users/...
NODE_HOOKS_DIR="$HOOKS_DIR"
NODE_SETTINGS_FILE="$SETTINGS_FILE"
STATUSLINE_CMD="bash $HOOKS_DIR/enforce-statusline.sh"

if [ "$IS_WINDOWS" = true ]; then
  if command -v cygpath &>/dev/null; then
    NODE_HOOKS_DIR="$(cygpath -m "$HOOKS_DIR")"
    NODE_SETTINGS_FILE="$(cygpath -m "$SETTINGS_FILE")"
  else
    # Fallback: manually convert /c/Users/... to C:/Users/...
    NODE_HOOKS_DIR="$(echo "$HOOKS_DIR" | sed -E 's|^/([a-zA-Z])/|\U\1:/|')"
    NODE_SETTINGS_FILE="$(echo "$SETTINGS_FILE" | sed -E 's|^/([a-zA-Z])/|\U\1:/|')"
  fi
  STATUSLINE_CMD="powershell -ExecutionPolicy Bypass -File \\\"${NODE_HOOKS_DIR}/enforce-statusline.ps1\\\""
fi

# Use Node.js to merge hook entries into settings.json
node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$NODE_SETTINGS_FILE', 'utf8'));

if (!settings.hooks) settings.hooks = {};

// SessionStart hook
if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
const ssHooks = settings.hooks.SessionStart;
const ssExists = ssHooks.some(h =>
  h.command && h.command.includes('enforce-activate')
);
if (!ssExists) {
  ssHooks.push({
    command: 'node $NODE_HOOKS_DIR/enforce-activate.js',
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
    command: 'node $NODE_HOOKS_DIR/enforce-mode-tracker.js',
    timeout: 5000
  });
}

// PreToolUse hooks — consolidated enforcement guards
if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
const ptuHooks = settings.hooks.PreToolUse;

// Write guard: secrets + research + security (replaces research-gate)
const wgExists = ptuHooks.some(h =>
  h.command && h.command.includes('enforce-write-guard')
);
if (!wgExists) {
  ptuHooks.push({
    matcher: 'Write|Edit|NotebookEdit',
    command: 'node $NODE_HOOKS_DIR/enforce-write-guard.js',
    timeout: 5000
  });
}

// Bash guard: git + tests + inference-bg + cost (replaces test-gate)
const bgExists = ptuHooks.some(h =>
  h.command && h.command.includes('enforce-bash-guard')
);
if (!bgExists) {
  ptuHooks.push({
    matcher: 'Bash',
    command: 'node $NODE_HOOKS_DIR/enforce-bash-guard.js',
    timeout: 5000
  });
}

// Stop guard: completion checks + session log + requirements (replaces pre-completion)
if (!settings.hooks.Stop) settings.hooks.Stop = [];
const stopHooks = settings.hooks.Stop;
const sgExists = stopHooks.some(h =>
  h.command && h.command.includes('enforce-stop-guard')
);
if (!sgExists) {
  stopHooks.push({
    command: 'node $NODE_HOOKS_DIR/enforce-stop-guard.js',
    timeout: 5000
  });
}

// Statusline
if (!settings.statusLine) {
  settings.statusLine = {
    type: 'command',
    command: '$STATUSLINE_CMD'
  };
}

fs.writeFileSync('$NODE_SETTINGS_FILE', JSON.stringify(settings, null, 2));
"

echo "enforce-mode installed successfully!"
echo "Default level: solo"
echo "Switch: /enforce solo|team|prod"
echo "Disable: /enforce off"
