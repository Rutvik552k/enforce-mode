#!/usr/bin/env node
/**
 * enforce-prompt-append.js — UserPromptSubmit hook
 *
 * Appends a fixed reminder to every user prompt as injected context, so the
 * universal ruleset is reinforced on each turn (no filler drift over a long
 * session). Advisory only — always exits 0, never blocks the prompt.
 */

'use strict';

// The exact text appended to every user query.
const APPEND_TEXT = [
  'Always follow the rules mentioned in universal.md from enforce plugin',
  'If you encounter any ambiguous query and need more data, ask the user before processing.',
].join('\n');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    setTimeout(() => resolve({}), 200);
  });
}

async function main() {
  await readStdin(); // drain stdin; the appended text is constant

  const out = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: APPEND_TEXT,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main().catch(() => process.exit(0));
