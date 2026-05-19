#!/usr/bin/env node
/**
 * enforce-mode — SessionStart activation hook
 *
 * Runs on every session start:
 *   1. Resolves enforcement level from config
 *   2. Writes flag file at ~/.claude/.enforce-active (statusline reads this)
 *   3. Detects project domains via weighted signal scoring
 *   4. Assembles universal + domain rules within context budget
 *   5. Emits rules as hidden SessionStart context (stdout → <system-reminder>)
 *   6. Detects missing statusline config and nudges setup
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultLevel } = require('./enforce-config');
const { detectDomains } = require('./enforce-detect');
const { buildContext } = require('./enforce-rules');

const claudeDir = path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.enforce-active');
const settingsPath = path.join(claudeDir, 'settings.json');
const pluginRoot = path.resolve(__dirname, '..');

const level = getDefaultLevel();

// 'off' mode — skip activation entirely
if (level === 'off') {
  try { fs.unlinkSync(flagPath); } catch (e) { /* ignore */ }
  process.stdout.write('OK');
  process.exit(0);
}

// 1. Write flag file
try {
  fs.mkdirSync(path.dirname(flagPath), { recursive: true });
  fs.writeFileSync(flagPath, level);
} catch (e) {
  // Silent fail — flag is best-effort
}

// 2. Detect project domains
const detectedDomains = detectDomains(process.cwd());

// 3. Build context (universal rules + domain rules, budget-managed)
let output;
try {
  output = buildContext(level, detectedDomains, pluginRoot);
} catch (e) {
  // Fallback: minimal hardcoded rules if something breaks
  output =
    'ENFORCE MODE ACTIVE — level: ' + level + '\n\n' +
    'Universal engineering rules active.\n' +
    '- Research before code (web-search to verify)\n' +
    '- Git discipline (never commit without asking)\n' +
    '- Test before ship (run and show output)\n' +
    '- Pre-completion analysis (walk code paths, security review)\n\n' +
    'Switch level: /enforce solo|team|prod\n' +
    'Stop: "stop enforce" or "normal mode"';
}

// 4. Detect missing statusline config — nudge Claude to help set it up
try {
  let hasStatusline = false;
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings.statusLine) {
      hasStatusline = true;
    }
  }

  if (!hasStatusline) {
    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'enforce-statusline.ps1' : 'enforce-statusline.sh';
    const scriptPath = path.join(__dirname, scriptName);
    const command = isWindows
      ? 'powershell -ExecutionPolicy Bypass -File "' + scriptPath + '"'
      : 'bash "' + scriptPath + '"';
    const snippet = '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
    output += '\n\nSTATUSLINE SETUP NEEDED: enforce-mode includes a statusline badge ' +
      'showing active level (e.g. [ENFORCE:SOLO], [ENFORCE:PROD]). ' +
      'To enable, add this to ~/.claude/settings.json: ' + snippet;
  }
} catch (e) {
  // Silent fail — don't block session start
}

process.stdout.write(output);
