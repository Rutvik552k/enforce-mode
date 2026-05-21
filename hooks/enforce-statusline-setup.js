#!/usr/bin/env node
/**
 * enforce-statusline-setup — bundled statusline auto-configuration
 *
 * On SessionStart, ensures the Claude Code statusline shows [ENFORCE:LEVEL].
 * Creates unified statusline scripts in ~/.claude/hooks/ and updates settings.json.
 *
 * Design:
 *   - Detects existing statusline (caveman, custom, none)
 *   - Creates/updates unified scripts that show ALL active mode badges
 *   - Idempotent — safe to call every session
 *   - Never overwrites user's custom statusline without including it
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = path.join(os.homedir(), '.claude');
const hooksDir = path.join(claudeDir, 'hooks');
const settingsPath = path.join(claudeDir, 'settings.json');

// Marker comment so we can identify our managed scripts
const MANAGED_MARKER = '# managed-by: enforce-mode + caveman unified statusline';

const UNIFIED_SH = `#!/usr/bin/env bash
${MANAGED_MARKER}
# Shows badges for all active Claude Code modes

CLAUDE_DIR="$HOME/.claude"
BADGES=""

# Caveman mode
if [ -f "$CLAUDE_DIR/.caveman-active" ]; then
    MODE=$(head -1 "$CLAUDE_DIR/.caveman-active" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$MODE" ]; then
        if [ "$MODE" = "full" ]; then
            BADGES="\\033[38;5;172m[CAVEMAN]\\033[0m"
        else
            SUFFIX=$(echo "$MODE" | tr '[:lower:]' '[:upper:]')
            BADGES="\\033[38;5;172m[CAVEMAN:$SUFFIX]\\033[0m"
        fi
    fi
fi

# Enforce mode
if [ -f "$CLAUDE_DIR/.enforce-active" ]; then
    MODE=$(head -1 "$CLAUDE_DIR/.enforce-active" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$MODE" ]; then
        SUFFIX=$(echo "$MODE" | tr '[:lower:]' '[:upper:]')
        [ -n "$BADGES" ] && BADGES="$BADGES "
        BADGES="\${BADGES}\\033[38;5;196m[ENFORCE:$SUFFIX]\\033[0m"
    fi
fi

[ -n "$BADGES" ] && printf "%b" "$BADGES"
`;

const UNIFIED_PS1 = `${MANAGED_MARKER}
# Shows badges for all active Claude Code modes

$ClaudeDir = Join-Path $HOME ".claude"
$Badges = @()

# Caveman mode
$CavemanFlag = Join-Path $ClaudeDir ".caveman-active"
if (Test-Path $CavemanFlag) {
    $Mode = (Get-Content $CavemanFlag -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not [string]::IsNullOrWhiteSpace($Mode)) {
        $Mode = $Mode.Trim()
        $Esc = [char]27
        if ($Mode -eq "full") {
            $Badges += "\${Esc}[38;5;172m[CAVEMAN]\${Esc}[0m"
        } else {
            $Suffix = $Mode.ToUpperInvariant()
            $Badges += "\${Esc}[38;5;172m[CAVEMAN:$Suffix]\${Esc}[0m"
        }
    }
}

# Enforce mode
$EnforceFlag = Join-Path $ClaudeDir ".enforce-active"
if (Test-Path $EnforceFlag) {
    $Mode = (Get-Content $EnforceFlag -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not [string]::IsNullOrWhiteSpace($Mode)) {
        $Suffix = $Mode.Trim().ToUpperInvariant()
        $Esc = [char]27
        $Badges += "\${Esc}[38;5;196m[ENFORCE:$Suffix]\${Esc}[0m"
    }
}

if ($Badges.Count -gt 0) {
    [Console]::Write($Badges -join " ")
}
`;

/**
 * Check if current statusline already shows enforce badge
 */
function statuslineIncludesEnforce(settings) {
  if (!settings.statusLine || !settings.statusLine.command) return false;
  const cmd = settings.statusLine.command;
  return cmd.includes('enforce') || cmd.includes('unified-statusline');
}

/**
 * Check if a script file is one we manage (safe to overwrite)
 */
function isManagedScript(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes('managed-by:') || content.includes('enforce') || content.includes('unified-statusline');
  } catch {
    return false;
  }
}

function getUnifiedCommand() {
  const isWindows = process.platform === 'win32';
  const scriptName = isWindows ? 'unified-statusline.ps1' : 'unified-statusline.sh';
  const scriptPath = path.join(hooksDir, scriptName);
  return isWindows
    ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
    : `bash "${scriptPath}"`;
}

/**
 * Ensure statusline shows enforce badge. Returns status string.
 *   - 'already_configured' — no changes needed
 *   - 'configured' — updated settings + scripts
 *   - 'skipped' — user has custom statusline, didn't touch it
 */
function ensureStatusLine() {
  try {
    fs.mkdirSync(hooksDir, { recursive: true });

    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }

    // Already configured — check if scripts need updating
    if (statuslineIncludesEnforce(settings)) {
      // Update scripts in place if they're ours (idempotent refresh)
      const shPath = path.join(hooksDir, 'unified-statusline.sh');
      const ps1Path = path.join(hooksDir, 'unified-statusline.ps1');
      if (fs.existsSync(shPath) && isManagedScript(shPath)) {
        fs.writeFileSync(shPath, UNIFIED_SH);
      }
      if (fs.existsSync(ps1Path) && isManagedScript(ps1Path)) {
        fs.writeFileSync(ps1Path, UNIFIED_PS1);
      }
      return 'already_configured';
    }

    // No statusline set — easy case, just set it
    if (!settings.statusLine || !settings.statusLine.command) {
      fs.writeFileSync(path.join(hooksDir, 'unified-statusline.sh'), UNIFIED_SH);
      fs.writeFileSync(path.join(hooksDir, 'unified-statusline.ps1'), UNIFIED_PS1);
      settings.statusLine = { type: 'command', command: getUnifiedCommand() };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      return 'configured';
    }

    // Existing statusline — check if it's caveman-only or another managed script
    const existingCmd = settings.statusLine.command;
    const isCavemanOnly = existingCmd.includes('caveman') && !existingCmd.includes('enforce');
    const isManaged = existingCmd.includes('statusline');

    if (isCavemanOnly || isManaged) {
      // Safe to upgrade to unified
      fs.writeFileSync(path.join(hooksDir, 'unified-statusline.sh'), UNIFIED_SH);
      fs.writeFileSync(path.join(hooksDir, 'unified-statusline.ps1'), UNIFIED_PS1);
      settings.statusLine = { type: 'command', command: getUnifiedCommand() };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      return 'configured';
    }

    // User has custom statusline we don't recognize — don't touch it
    return 'skipped';
  } catch {
    return 'error';
  }
}

module.exports = { ensureStatusLine };
