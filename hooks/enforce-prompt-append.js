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
  'ENFORCE active. Obey universal.md (already in context — full detail lives there). Per-turn reminders:',
  '- Plan first: before any implementation code, present a plan (components/services touched + dependency map — what calls what, data-flow, sync vs async) and get approval; write code only after approval + the critique gate passes.',
  '- Ambiguous query, or any decision the user owns (scope/trade-off/grounded concern) → STOP, ask via AskUserQuestion with option cards, never free-text.',
  '- Route each task to its owning department subagent (universal.md routing map); no specialist work in the main agent. Dispatch in background; never block or idle on one.',
  '- Every implementation: run the 3-lens critique gate (Engineering / DSA / Security), ground-truth-cited, and emit a CRITIQUE GATE: PASS|FAIL block before writing code. CRITICAL/STRICT → back to the owning subagent (max 3 retries), then escalate via AskUserQuestion.',
  '- Fail loud, no fallback: typed/specific catch, error names where it failed (operation + inputs + component); no silent defaults, swallow-and-continue, or stale-result substitution.',
  '- Keep living docs current in the SAME change: architecture.md, progress.md (move done tasks Open→Closed), and dependency-map.json/.md (read a node’s affected-by edges and state the blast radius before changing it).',
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
