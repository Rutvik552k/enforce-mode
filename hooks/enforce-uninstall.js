#!/usr/bin/env node
/**
 * enforce-mode — full uninstall cleanup
 *
 * Removes ALL artifacts left behind by enforce-mode:
 *   - ~/.claude/.enforce-active flag file
 *   - Per-session state files (enforce-sessions/)
 *   - Config file from platform config dir
 *   - pluginSettings.enforce-mode from settings.json
 *   - enabledPlugins["enforce-mode@enforce-mode"] from settings.json
 *   - extraKnownMarketplaces.enforce-mode from settings.json
 *   - All enforce-* hook files from ~/.claude/hooks/
 *   - enforce-statusline-setup.js from ~/.claude/hooks/
 *   - Enforce rules from ~/.claude/rules/
 *   - Enforce skills from ~/.claude/skills/enforce/
 *   - Enforce badge from unified statusline scripts
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

// 4. Remove enforce-* hook files from ~/.claude/hooks/
try {
  if (fs.existsSync(hooksDir)) {
    const hookFiles = fs.readdirSync(hooksDir).filter(f =>
      f.startsWith('enforce-') && (f.endsWith('.js') || f.endsWith('.sh') || f.endsWith('.ps1'))
    );
    for (const f of hookFiles) {
      fs.unlinkSync(path.join(hooksDir, f));
    }
    if (hookFiles.length > 0) {
      removed.push(`${hookFiles.length} hook files from ~/.claude/hooks/`);
    }
  }
} catch (e) { errors.push(`hook files: ${e.message}`); }

// 5. Remove enforce rules from ~/.claude/rules/
try {
  const rulesDir = path.join(claudeDir, 'rules');
  const domainsDir = path.join(rulesDir, 'domains');
  // Remove domain rule files that enforce-mode installed
  const enforceDomains = ['api-security.md', 'cost-tracking.md', 'gpu-hardware.md', 'ml-inference.md', 'video-pipeline.md'];
  let domainCount = 0;
  for (const d of enforceDomains) {
    const p = path.join(domainsDir, d);
    if (fs.existsSync(p)) { fs.unlinkSync(p); domainCount++; }
  }
  // Remove universal.md if it contains enforce marker
  const universalPath = path.join(rulesDir, 'universal.md');
  if (fs.existsSync(universalPath)) {
    const content = fs.readFileSync(universalPath, 'utf8');
    if (content.includes('ENFORCE MODE') || content.includes('enforce')) {
      fs.unlinkSync(universalPath);
      domainCount++;
    }
  }
  if (domainCount > 0) removed.push(`${domainCount} rule files from ~/.claude/rules/`);
} catch (e) { errors.push(`rules: ${e.message}`); }

// 6. Remove enforce skills from ~/.claude/skills/enforce/
try {
  const skillDir = path.join(claudeDir, 'skills', 'enforce');
  if (fs.existsSync(skillDir)) {
    const files = fs.readdirSync(skillDir);
    for (const f of files) { fs.unlinkSync(path.join(skillDir, f)); }
    fs.rmdirSync(skillDir);
    removed.push('skills/enforce/ directory');
  }
} catch (e) { errors.push(`skills: ${e.message}`); }

// 7. Clean settings.json — plugin entries, marketplace, statusline
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

    // Remove from enabledPlugins
    if (settings.enabledPlugins) {
      const key = Object.keys(settings.enabledPlugins).find(k => k.includes('enforce-mode'));
      if (key) {
        delete settings.enabledPlugins[key];
        removed.push(`enabledPlugins["${key}"]`);
        changed = true;
      }
    }

    // Remove from extraKnownMarketplaces
    if (settings.extraKnownMarketplaces && settings.extraKnownMarketplaces['enforce-mode']) {
      delete settings.extraKnownMarketplaces['enforce-mode'];
      removed.push('extraKnownMarketplaces.enforce-mode');
      changed = true;
    }

    // Remove enforce hook entries from settings.hooks
    if (settings.hooks) {
      let hooksRemoved = 0;
      for (const event of Object.keys(settings.hooks)) {
        const entries = settings.hooks[event];
        if (!Array.isArray(entries)) continue;
        const before = entries.length;
        settings.hooks[event] = entries.filter(entry => {
          const hooks = entry.hooks || [];
          return !hooks.some(h => h.command && h.command.includes('enforce-'));
        });
        hooksRemoved += before - settings.hooks[event].length;
        // Remove empty event arrays
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }
      // Remove empty hooks object
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
      if (hooksRemoved > 0) {
        removed.push(`${hooksRemoved} hook entries from settings.json`);
        changed = true;
      }
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
