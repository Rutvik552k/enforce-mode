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
  'If you encounter any ambiguous query and need more data, STOP and ask the user before processing — use the AskUserQuestion tool with concrete options (structured option cards), not a free-text question.',
  'Route each task to its owning department subagent (see the universal.md routing map); do not do specialist work in the main agent.',
  'After assigning a task to a subagent, the main agent must not block on it — dispatch in background, continue productive work, and act on its result when the completion notification fires.',
  'Task loop (outer, wraps the SDLC loop — team/prod levels): once architecture.md is finalized, auto-generate the task list from it — build a task DAG, reject dependency cycles, topo-sort into parallel batches — into progress.md `## Open Tasks`, then PAUSE for user approval before working. On approval, drive each Open task through the inner SDLC loop — cross-department tasks go to team-orchestrator first for the ordered chain + parallel/sequential marks + gates, then dispatch independent steps to department subagents in background without idling, capping concurrent in-flight dispatch and queueing the rest. Inner-loop gate failures retry a bounded number of times (max 3); on exhaustion, STOP and escalate to the user via the AskUserQuestion tool — structured option cards plus the failing evidence, not a free-text prompt (prevents gate-cycle livelock). Move a task to `## Closed Tasks` only when verified (tests run, output shown), then pick up the next. Whenever a task needs a decision the user owns (scope, trade-off, ambiguity, grounded concern), STOP and ask the user via the AskUserQuestion tool with concrete options (option cards), never a free-text question. Repeat until no Open tasks remain.',
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
