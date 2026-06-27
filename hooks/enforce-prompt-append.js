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
// Short anti-drift reminder only — the full ruleset lives in universal.md
// (loaded as a global rule, in context all session) and the SessionStart
// enforce hook. This per-turn nudge points back to that text; it does not
// re-state it, to avoid re-injecting ~290 words every turn.
const APPEND_TEXT = [
  'ENFORCE active. Obey universal.md (already in context). Per-turn reminders:',
  '- Ambiguous query, or any decision the user owns (scope/trade-off/grounded concern) → STOP, ask via AskUserQuestion with option cards, never free-text.',
  '- Route each task to its owning department subagent (universal.md routing map); no specialist work in the main agent.',
  '- Dispatch subagents in background; never block or idle waiting on one — act on each result when its notification fires.',
  '- Every implementation: before writing code, run the 3-lens critique gate (Engineering / DSA / Security), ground-truth-cited, and emit a CRITIQUE GATE: PASS|FAIL block. CRITICAL/STRICT → back to the owning subagent (max 3 retries), then escalate via AskUserQuestion.',
  '- Outer task loop (team/prod): finalized architecture.md → task DAG → progress.md `## Open Tasks` → PAUSE for approval; move to `## Closed Tasks` only when verified (tests run, output shown).',
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
