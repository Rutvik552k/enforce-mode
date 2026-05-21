#!/usr/bin/env node
/**
 * enforce-mode — SessionStart activation hook
 *
 * Runs on every session start:
 *   1. Reads session_id from stdin
 *   2. Resolves enforcement level from config
 *   3. Writes level to per-session state file (session isolation)
 *   4. Writes global flag file for statusline badge (best-effort)
 *   5. Detects project domains via weighted signal scoring
 *   6. Assembles universal + domain rules within context budget
 *   7. Emits rules as SessionStart context (stdout → <system-reminder>)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultLevel } = require('./enforce-config');
const { detectDomains } = require('./enforce-detect');
const { buildContext } = require('./enforce-rules');
const { setLevel } = require('./enforce-state');

const claudeDir = path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.enforce-active');
const settingsPath = path.join(claudeDir, 'settings.json');
const pluginRoot = path.resolve(__dirname, '..');

// Read stdin for session_id
let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdinData += chunk; });
process.stdin.on('end', () => {
  let sessionId = '';
  try {
    const input = JSON.parse(stdinData);
    sessionId = input.session_id || '';
  } catch { /* ignore */ }

  const level = getDefaultLevel();

  // 'off' mode — skip activation entirely
  if (level === 'off') {
    if (sessionId) setLevel(sessionId, 'off');
    try { fs.unlinkSync(flagPath); } catch { /* ignore */ }
    process.stdout.write('OK');
    process.exit(0);
  }

  // 1. Write per-session level (session isolation)
  if (sessionId) {
    setLevel(sessionId, level);
  }

  // 2. Write global flag (statusline badge only — not used for enforcement)
  try {
    fs.mkdirSync(path.dirname(flagPath), { recursive: true });
    fs.writeFileSync(flagPath, level);
  } catch { /* Silent — flag is best-effort for statusline */ }

  // 3. Detect project domains
  const detectedDomains = detectDomains(process.cwd());

  // 4. Build context (universal rules + domain rules, budget-managed)
  let output;
  try {
    output = buildContext(level, detectedDomains, pluginRoot);
  } catch {
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

  // 5. Detect missing statusline config
  try {
    let hasStatusline = false;
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.statusLine) hasStatusline = true;
    }

    if (!hasStatusline) {
      const isWindows = process.platform === 'win32';
      const scriptName = isWindows ? 'enforce-statusline.ps1' : 'enforce-statusline.sh';
      const scriptPath = path.join(__dirname, scriptName);
      const command = isWindows
        ? 'powershell -ExecutionPolicy Bypass -File "' + scriptPath + '"'
        : 'bash "' + scriptPath + '"';
      const snippet = '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
      output += '\n\nSTATUSLINE SETUP NEEDED: add to ~/.claude/settings.json: ' + snippet;
    }
  } catch { /* Silent */ }

  process.stdout.write(output);
});
