#!/usr/bin/env node
/**
 * enforce-level-switch.js — UserPromptSubmit hook
 *
 * Makes the `/enforce <level>` command (a skill = prompt) actually drive the
 * enforcement level. The skill alone cannot write state, so the statusline
 * badge and the injected rules would never reflect a mid-session switch.
 *
 * This hook detects a level command at the START of the user's prompt and:
 *   - solo|team|prod → persist (config + plugin settings) + per-session level
 *                      + write ~/.claude/.enforce-active (statusline badge)
 *   - off / "stop enforce" / "normal mode" → mark session off + remove the flag
 *
 * Anchored at ^ so it only fires on an explicit switch, never on a sentence
 * that merely mentions "enforce". Always exits 0 (advisory — never blocks).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const flagPath = path.join(os.homedir(), '.claude', '.enforce-active');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

// Parse an explicit level switch from the start of the prompt.
// Returns { level: 'solo'|'team'|'prod' } | { off: true } | null
function parseCommand(prompt) {
  const p = (prompt || '').trim();
  // Slash form: /enforce X  or  /enforce-mode:enforce X
  let m = p.match(/^\/?(?:enforce-mode:)?enforce\s+(solo|team|prod|off)\b/i);
  // Bare short form: the whole prompt is just "enforce X"
  if (!m) m = p.match(/^enforce\s+(solo|team|prod|off)$/i);
  if (m) {
    const lv = m[1].toLowerCase();
    return lv === 'off' ? { off: true } : { level: lv };
  }
  if (/^(stop\s+enforce|normal\s+mode)\b/i.test(p)) return { off: true };
  return null;
}

function emit(message) {
  process.stderr.write('[ENFORCE] ' + message + '\n');
  const out = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '[ENFORCE] ' + message } };
  process.stdout.write(JSON.stringify(out));
}

async function main() {
  const input = await readStdin();
  const cmd = parseCommand(input.prompt || '');
  if (!cmd) process.exit(0);

  const sessionId = input.session_id || '';

  // Best-effort: load sibling modules from the same hooks dir.
  let setDefaultLevel, setLevel;
  try { ({ setDefaultLevel } = require('./enforce-config')); } catch { /* optional */ }
  try { ({ setLevel } = require('./enforce-state')); } catch { /* optional */ }

  if (cmd.off) {
    try { if (setLevel && sessionId) setLevel(sessionId, 'off'); } catch { /* ignore */ }
    try { if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath); } catch { /* ignore */ }
    emit('OFF — enforcement disabled for this session. Re-enable with /enforce solo|team|prod.');
    process.exit(0);
  }

  const level = cmd.level;
  try { if (setDefaultLevel) setDefaultLevel(level); } catch { /* ignore */ }   // persist across sessions
  try { if (setLevel && sessionId) setLevel(sessionId, level); } catch { /* ignore */ }
  try {
    fs.mkdirSync(path.dirname(flagPath), { recursive: true });
    fs.writeFileSync(flagPath, level);   // statusline badge reads this
  } catch { /* best-effort */ }

  emit('level → ' + level.toUpperCase() + ' (persisted; statusline badge updated).');
  process.exit(0);
}

main().catch(() => process.exit(0));
