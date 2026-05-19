#!/usr/bin/env node
/**
 * enforce-mode — UserPromptSubmit hook to track enforcement level changes
 *
 * Inspects user input for /enforce commands and deactivation phrases.
 * Writes level to flag file for cross-hook communication + statusline.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultLevel, VALID_LEVELS } = require('./enforce-config');

const flagPath = path.join(os.homedir(), '.claude', '.enforce-active');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = (data.prompt || '').trim().toLowerCase();

    // Match /enforce commands
    if (prompt.startsWith('/enforce')) {
      const parts = prompt.split(/\s+/);
      const arg = parts[1] || '';

      let level = null;

      if (arg === 'off') level = 'off';
      else if (arg === 'solo') level = 'solo';
      else if (arg === 'team') level = 'team';
      else if (arg === 'prod') level = 'prod';
      else level = getDefaultLevel(); // /enforce with no arg

      if (level && level !== 'off') {
        fs.mkdirSync(path.dirname(flagPath), { recursive: true });
        fs.writeFileSync(flagPath, level);
      } else if (level === 'off') {
        try { fs.unlinkSync(flagPath); } catch (e) { /* ignore */ }
      }
    }

    // Detect deactivation phrases
    if (/\b(stop enforce|normal mode)\b/i.test(prompt)) {
      try { fs.unlinkSync(flagPath); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    // Silent fail — don't block user prompt submission
  }
});
