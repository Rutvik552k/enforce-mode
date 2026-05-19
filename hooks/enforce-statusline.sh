#!/bin/bash
# enforce-mode — statusline badge for Unix/macOS
# Reads flag file and outputs ANSI-colored badge

FLAG="$HOME/.claude/.enforce-active"
[ ! -f "$FLAG" ] && exit 0

MODE=$(cat "$FLAG" 2>/dev/null)
[ -z "$MODE" ] && exit 0

SUFFIX=$(echo "$MODE" | tr '[:lower:]' '[:upper:]')
# ANSI color 196 = bright red (distinct from caveman's 172 orange)
printf '\033[38;5;196m[ENFORCE:%s]\033[0m' "$SUFFIX"
