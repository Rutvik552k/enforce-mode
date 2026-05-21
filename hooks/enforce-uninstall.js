#!/usr/bin/env node
/**
 * enforce-mode — uninstall cleanup
 *
 * Removes all artifacts left behind by enforce-mode:
 *   - ~/.claude/.enforce-active flag file
 *   - pluginSettings.enforce-mode from settings.json
 *   - Enforce badge from unified statusline scripts
 *   - Config file from platform config dir
 *   - Per-session state files
 *
 * Safe to run multiple times (idempotent).
 * If caveman mode is also using the unified statusline, downgrades
 * scripts to caveman-only instead of deleting them.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = path.join(os.homedir(), '.claude');
const hooksDir = path.join(claudeDir, 'hooks');
const settingsPath = path.join(claudeDir, 'settings.json');
const flagPath = path.join(claudeDir, '.enforce-active');
const sessionsDir = path.join(claudeDir, 'enforce-sessions');

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'enforce-mode');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'enforce-mode'
    );
  }
  return path.join(os.homedir(), '.config', 'enforce-mode');
}

const removed = [];
const errors = [];

// 1. Remove flag file
try {
  if (fs.existsSync(flagPath)) {
    fs.unlinkSync(flagPath);
    removed.push('.enforce-active flag');
  }
} catch (e) { errors.push(`flag file: ${e.message}`); }

// 2. Remove per-session state files
try {
  if (fs.existsSync(sessionsDir)) {
    const files = fs.readdirSync(sessionsDir);
    for (const f of files) {
      fs.unlinkSync(path.join(sessionsDir, f));
    }
    fs.rmdirSync(sessionsDir);
    removed.push(`enforce-sessions/ (${files.length} files)`);
  }
} catch (e) { errors.push(`sessions: ${e.message}`); }

// 3. Remove config file
try {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, 'config.json');
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    // Try to remove dir if empty
    try { fs.rmdirSync(configDir); } catch { /* not empty, fine */ }
    removed.push('config.json');
  }
} catch (e) { errors.push(`config: ${e.message}`); }

// 4. Clean settings.json — remove pluginSettings.enforce-mode + fix statusline
try {
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    let changed = false;

    // Remove plugin settings
    if (settings.pluginSettings && settings.pluginSettings['enforce-mode']) {
      delete settings.pluginSettings['enforce-mode'];
      if (Object.keys(settings.pluginSettings).length === 0) {
        delete settings.pluginSettings;
      }
      removed.push('pluginSettings.enforce-mode');
      changed = true;
    }

    // Handle statusline
    if (settings.statusLine && settings.statusLine.command) {
      const cmd = settings.statusLine.command;
      const isUnified = cmd.includes('unified-statusline');
      const isEnforceOnly = cmd.includes('enforce') && !isUnified;

      if (isUnified || isEnforceOnly) {
        // Check if caveman is still active
        const cavemanActive = fs.existsSync(path.join(claudeDir, '.caveman-active'));

        if (cavemanActive) {
          // Downgrade unified scripts to caveman-only (remove enforce section)
          downgradeStatuslineToCavemanOnly();
          removed.push('enforce badge from statusline (caveman kept)');
        } else {
          // No other mode using statusline — remove it entirely
          delete settings.statusLine;
          removeUnifiedScripts();
          removed.push('statusline config + scripts');
        }
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    }
  }
} catch (e) { errors.push(`settings.json: ${e.message}`); }

function downgradeStatuslineToCavemanOnly() {
  const CAVEMAN_SH = `#!/usr/bin/env bash
# managed-by: caveman statusline
CLAUDE_DIR="$HOME/.claude"
if [ -f "$CLAUDE_DIR/.caveman-active" ]; then
    MODE=$(head -1 "$CLAUDE_DIR/.caveman-active" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$MODE" ]; then
        if [ "$MODE" = "full" ]; then
            printf "\\033[38;5;172m[CAVEMAN]\\033[0m"
        else
            SUFFIX=$(echo "$MODE" | tr '[:lower:]' '[:upper:]')
            printf "\\033[38;5;172m[CAVEMAN:%s]\\033[0m" "$SUFFIX"
        fi
    fi
fi
`;

  const CAVEMAN_PS1 = `# managed-by: caveman statusline
$ClaudeDir = Join-Path $HOME ".claude"
$CavemanFlag = Join-Path $ClaudeDir ".caveman-active"
if (Test-Path $CavemanFlag) {
    $Mode = (Get-Content $CavemanFlag -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not [string]::IsNullOrWhiteSpace($Mode)) {
        $Mode = $Mode.Trim()
        $Esc = [char]27
        if ($Mode -eq "full") {
            [Console]::Write("$Esc[38;5;172m[CAVEMAN]$Esc[0m")
        } else {
            $Suffix = $Mode.ToUpperInvariant()
            [Console]::Write("$Esc[38;5;172m[CAVEMAN:$Suffix]$Esc[0m")
        }
    }
}
`;

  try {
    const shPath = path.join(hooksDir, 'unified-statusline.sh');
    const ps1Path = path.join(hooksDir, 'unified-statusline.ps1');
    if (fs.existsSync(shPath)) fs.writeFileSync(shPath, CAVEMAN_SH);
    if (fs.existsSync(ps1Path)) fs.writeFileSync(ps1Path, CAVEMAN_PS1);
  } catch { /* best effort */ }
}

function removeUnifiedScripts() {
  try {
    const shPath = path.join(hooksDir, 'unified-statusline.sh');
    const ps1Path = path.join(hooksDir, 'unified-statusline.ps1');
    if (fs.existsSync(shPath)) fs.unlinkSync(shPath);
    if (fs.existsSync(ps1Path)) fs.unlinkSync(ps1Path);
  } catch { /* best effort */ }
}

// Output result
const result = { removed, errors };
if (removed.length > 0) {
  console.log('enforce-mode cleanup complete:');
  removed.forEach(r => console.log(`  ✓ removed ${r}`));
} else {
  console.log('Nothing to clean up — enforce-mode artifacts not found.');
}
if (errors.length > 0) {
  console.log('Errors:');
  errors.forEach(e => console.log(`  ✗ ${e}`));
}
