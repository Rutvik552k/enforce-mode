# progress.md — enforce-mode task ledger

Living task ledger (universal.md rule). A task moves to `## Closed Tasks` only
when verified (tests run, output shown). Keep in sync with native task tracking.

## Open Tasks

_(none — see dependency-map.md "Known issues" for tracked architectural debt: broken installer edges, orphaned/dead hooks, plugin-vs-installer drift; not yet scheduled.)_

## Closed Tasks

- [x] Layer-1 Constraint Intake Gate: `enforce-constraint-gate.js` (advisory; SessionStart warn + PreToolUse advise on impl code with no captured constraints) + `constraints.json` + `constraints.template.json` + universal.md rule + append reminder; wired into both installers + plugin.json (no drift). Verified: test-constraint-gate 7/0; agents/rules/detect green.
- [x] Create living dependency artifact `dependency-map.json` + `dependency-map.md` (plugin component graph: nodes, depends-on, affected-by, contracts). Surfaced 4 grounded findings (1 CRITICAL installer edge).
- [x] Create `architecture.md` (tech stack + workflow + data-flow of the plugin).
- [x] Add orient-before-building reminder to `enforce-prompt-append.js` (subagents read CLAUDE.md/architecture.md/dependency-map.json at task start). Verified: hook emits valid JSON.
- [x] Trim per-turn prompt-append (`enforce-prompt-append.js`) — references universal.md instead of restating it; added orient-before-building + plan-first + fail-loud nudges. Verified: hook emits valid JSON.
- [x] Add Non-functional-requirements section to `rules/universal.md` (CRUD, reliability, maintainability, scalability, alterability, loggability, security, complexity); corrected impossible "below O(n)" to "no super-linear, lowest feasible class." Verified: test-rules 24/0.
- [x] Add shared `rules/mechanisms.md` — 21-mechanism inheritance matrix (trigger → algorithm → Big-O → inheriting agents); wired into both installers.
- [x] Enrich all 28 agents with "Domain DSA & real-world scope" + fail-loud + readable-code rules; slimmed each contract (removed 84 duplicate bullets). Verified: test-agents 172/0.
- [x] Confirm subagents load `universal.md` + project `CLAUDE.md` (verified by introspection probe); rules cached at session start → go live on new session.
- [x] Resolve merge conflict with main (plan-first/dependency-map/fail-loud rules) and merge PR #10 into main. Verified: rules/detect/config suites green.
- [x] Update README (Department Agents contract section + footer) to reflect Domain DSA + mechanisms matrix.
