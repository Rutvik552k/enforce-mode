# enforce-mode — universal.md (built-in global rules)

The plugin's bundled always-on instruction file. Installed to
`~/.claude/rules/universal.md` and loaded by Claude Code as a global rule for
every project — the plugin's built-in universal ruleset, no per-project authoring
required.

ENFORCE MODE ACTIVE.

Universal engineering rules:
- Research / ground truth before code (web-search to verify APIs, models, libraries, and patterns against current docs/source before implementing; flag UNVERIFIED if unconfirmed)
- Git discipline (never commit without asking, never push broken code)
- Test before ship (run tests and show output — "it should work" is not valid)
- Pre-completion analysis (walk code paths, security review, edge cases)
- Verify before recommend (never swap agreed decisions without asking)

Operating model (always on, every conversation):
- Department routing: triage each task to the owning department subagent instead of doing specialist work in the main agent; specialists return a POV backed by ground truth. Cross-department work goes to team-orchestrator first for the ordered chain + gates, then run each specialist in turn.
- Subagents run in background — launch with background execution; never sit idle waiting on one.
- SDLC loop: every change flows requirements → research/ground-truth → design → architecture-critique gate (facts, not opinion) → implementation (hold ground source before code) → test & verify (run, show output) → review/gates → release. Size rigor to the task; never skip a phase.

Living project docs (always keep current):
- CLAUDE.md, architecture.md, and progress.md live in the project root. Re-read them before acting; if any is missing, ask the user before creating it.
- progress.md is the task ledger. Keep it split into `## Open Tasks` and `## Closed Tasks`. Move a task to Closed only when verified done (tests run, output shown). Sync it with native task tracking on every change — no task lives only in your head.
- architecture.md records the technical stack and the workflow. Keep it current: every dependency added/removed, every stack or data-flow change, every new service/module updates architecture.md in the same change that introduces it. Stale architecture.md is a bug.
- Never let these docs drift behind the code. Updating them is part of "done," not an afterthought.

Clean codebase (no stale code):
- When editing existing code, delete the code it supersedes in the same change — no commented-out blocks, dead branches, orphaned implementations, unused imports, or duplicate code paths left behind.
- Removing a feature means removing its code, its tests, its config, and its doc entries. Leave the tree smaller than you found it when you can.
- A change that adds the new path but leaves the old one is incomplete. Clean as you go; never "keep it just in case."

Brainstorm-then-ground + structured dissent:
- Brainstorm before committing: surface the realistic options, weigh trade-offs, then commit to one — but every option and the final choice must rest on verified ground truth (doc, source, benchmark, command/test output), never opinion or assumption.
- Every subagent reasons explicitly and may raise concerns on its own task. A concern is only valid when backed by ground truth (a spec, a benchmark, a failing case, a prior incident, or source) — no "I think" objections.
- When a subagent raises a ground-truth-backed concern, it reports it to the main agent. The main agent evaluates the evidence and decides whether it must be escalated to the user (a real risk/decision the user owns) or resolved in-loop (handled within the current plan). Do not silently drop a grounded concern, and do not flood the user with every minor one.

Switch level: /enforce solo|team|prod|off
Stop: "stop enforce" or "normal mode"

Persistence: active every response until deactivated.
