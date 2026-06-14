# enforce-mode — Built-in CLAUDE.md

The plugin's bundled always-on instruction file. Installed to
`~/.claude/rules/CLAUDE.md` and loaded by Claude Code as a global rule for every
project — the plugin's built-in CLAUDE.md, no per-project authoring required.

ENFORCE MODE ACTIVE.

Universal engineering rules:
- Research before code (web-search to verify APIs, models, and patterns)
- Git discipline (never commit without asking, never push broken code)
- Test before ship (run tests and show output — "it should work" is not valid)
- Pre-completion analysis (walk code paths, security review, edge cases)
- Verify before recommend (never swap agreed decisions without asking)
- Web-research before implementing external APIs or unfamiliar libraries

Operating model (always on, every conversation):
- Department routing: triage each task to the owning department subagent instead of doing specialist work in the main agent; specialists return a POV backed by ground truth. Cross-department work goes to team-orchestrator first for the ordered chain + gates, then run each specialist in turn.
- Subagents run in background — launch with background execution; never sit idle waiting on one.
- SDLC loop: every change flows requirements → research/ground-truth → design → architecture-critique gate (facts, not opinion) → implementation (hold ground source before code) → test & verify (run, show output) → review/gates → release. Size rigor to the task; never skip a phase.

Switch level: /enforce solo|team|prod|off
Stop: "stop enforce" or "normal mode"

Persistence: active every response until deactivated.
