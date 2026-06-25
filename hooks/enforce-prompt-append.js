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
  'Plan mode first (every query): before writing ANY implementation code, produce a plan/design and present it to the user for approval — never jump straight to code. The plan must name the components/services touched and map the dependencies between them (what calls what, data-flow direction, sync vs async, failure coupling). Implement only after the plan is approved and the critique gate passes.',
  'Service dependency mapping & management: when code spans services/modules, state which service depends on which, the call direction, the data contract crossing each boundary, and sync vs async; record it in architecture.md. Resolve dependencies via config/injection/service-discovery — never hardcoded hosts/ports/import-time wiring. Dependency direction must be acyclic; if a change introduces a cycle or reaches into another service’s internals, STOP and redesign.',
  'Dependency map (living artifact at project root): maintain dependency-map.json (source of truth: nodes = features/services, each with its operations, depends-on edges, affected-by reverse edges, and data-contract + coupling type) plus its generated dependency-map.md view (Mermaid graph + per-feature tables). 4th living doc — ask before creating if missing. Update BOTH files in the same change the instant any feature/operation/edge/contract changes, including mid-task — never defer to task end. Before changing a node, read its affected-by edges and state the blast radius in the plan. No secrets in the map. Drift from code = bug.',
  'Error handling — fail loud, no fallback (overrides graceful degradation): wrap fallible operations in try/catch with a typed/specific catch; every error message must identify WHERE the logic failed (operation, triggering inputs, failing component). Do NOT write fallback/graceful-degradation paths (no silent defaults, no swallow-and-continue, no serving stale/cached results in place of the failure). Re-raise or propagate after logging full context; never swallow. Surface the failure so the broken path is visible.',
  'Task ledger: the moment a task in progress.md `## Open Tasks` is verified done (tests run, output shown), MOVE its line into `## Closed Tasks` in the same change. Never leave a completed task under Open and never just tick it in place. Writing a task to Open and never moving it to Closed is a bug.',
  'If you encounter any ambiguous query and need more data, STOP and ask the user before processing — use the AskUserQuestion tool with concrete options (structured option cards), not a free-text question.',
  'Route each task to its owning department subagent (see the universal.md routing map); do not do specialist work in the main agent.',
  'After assigning a task to a subagent, the main agent must not block on it — dispatch in background, continue productive work, and act on its result when the completion notification fires.',
  'Task loop (outer, wraps the SDLC loop — team/prod levels): once architecture.md is finalized, auto-generate the task list from it — build a task DAG, reject dependency cycles, topo-sort into parallel batches — into progress.md `## Open Tasks`, then PAUSE for user approval before working. On approval, drive each Open task through the inner SDLC loop — cross-department tasks go to team-orchestrator first for the ordered chain + parallel/sequential marks + gates, then dispatch independent steps to department subagents in background without idling, capping concurrent in-flight dispatch and queueing the rest. Inner-loop gate failures retry a bounded number of times (max 3); on exhaustion, STOP and escalate to the user via the AskUserQuestion tool — structured option cards plus the failing evidence, not a free-text prompt (prevents gate-cycle livelock). Move a task to `## Closed Tasks` only when verified (tests run, output shown), then pick up the next. Whenever a task needs a decision the user owns (scope, trade-off, ambiguity, grounded concern), STOP and ask the user via the AskUserQuestion tool with concrete options (option cards), never a free-text question. Repeat until no Open tasks remain.',
  'Critique gate (mandatory, every implementation): after any design/solution a subagent returns — and BEFORE writing implementation code — the main agent MUST run a 3-lens critique, each finding severity-tagged and ground-truth-cited (no praise padding): (1) Engineering / industry methods — SOLID, design patterns, language idioms, error handling, testability, dead-code (cite style guide / lang docs); (2) DSA / algorithms — Big-O time + space, data-structure fit, O(n^2)->O(n log n), streaming vs in-memory, P99 not avg (cite benchmark / source); (3) Security — OWASP Top 10 on the touched surface, authz/authn, input validation, injection, secrets, dependency CVEs. Emit the verdict as a `CRITIQUE GATE: PASS|FAIL` block. On any CRITICAL/STRICT finding, send the design back to the owning subagent to fix (bounded retry, max 3), then proceed; if still failing, STOP and escalate to the user via the AskUserQuestion tool (option cards) with the failing evidence. Never write implementation code on an unresolved CRITICAL finding.',
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
