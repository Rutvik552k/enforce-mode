#!/usr/bin/env node
/**
 * enforce-mode — UserPromptSubmit hook to track enforcement level changes
 *
 * Inspects user input for /enforce commands and deactivation phrases.
 * Writes level to PER-SESSION state file (session isolation).
 * Also updates global flag file for statusline badge (best-effort).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultLevel } = require('./enforce-config');
const { setLevel } = require('./enforce-state');

const flagPath = path.join(os.homedir(), '.claude', '.enforce-active');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = (data.prompt || '').trim().toLowerCase();
    const sessionId = data.session_id || '';

    let newLevel = null;

    // Match /enforce commands
    if (prompt.startsWith('/enforce')) {
      const arg = prompt.split(/\s+/)[1] || '';
      if (arg === 'off') newLevel = 'off';
      else if (arg === 'solo') newLevel = 'solo';
      else if (arg === 'team') newLevel = 'team';
      else if (arg === 'prod') newLevel = 'prod';
      else newLevel = getDefaultLevel();
    }

    // Detect deactivation phrases
    if (/\b(stop enforce|normal mode)\b/i.test(prompt)) {
      newLevel = 'off';
    }

    // Apply level change
    if (newLevel !== null) {
      // Per-session state (session isolation — other sessions unaffected)
      if (sessionId) {
        setLevel(sessionId, newLevel);
      }

      // Global flag (statusline badge only)
      if (newLevel !== 'off') {
        try {
          fs.mkdirSync(path.dirname(flagPath), { recursive: true });
          fs.writeFileSync(flagPath, newLevel);
        } catch { /* ignore */ }
      } else {
        try { fs.unlinkSync(flagPath); } catch { /* ignore */ }
      }
    }
  } catch {
    // Silent fail — don't block user prompt submission
  }
});
