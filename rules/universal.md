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
- Main agent frees after assigning: once a task is dispatched to a subagent, the main agent MUST NOT block on it. Hand off the task, immediately continue productive work (triage/dispatch other tasks, status, monitoring), and act on each subagent's result only when its completion notification fires. Dispatching a subagent and then waiting for it is a violation.
- SDLC loop (inner, per task): every change flows requirements → research/ground-truth → design → architecture-critique gate (facts, not opinion) → implementation (hold ground source before code) → test & verify (run, show output) → review/gates → release. Size rigor to the task; never skip a phase.
- Critique gate (mandatory, every implementation): after any design/solution a subagent returns — and BEFORE writing implementation code — the main agent MUST run a 3-lens critique, each finding severity-tagged and ground-truth-cited (no praise padding): (1) Engineering / industry methods — SOLID, design patterns, language idioms, error handling, testability, dead-code (cite style guide / lang docs); (2) DSA / algorithms — Big-O time + space, data-structure fit, O(n²)→O(n log n), streaming vs in-memory, P99 not avg (cite benchmark / source); (3) Security — OWASP Top 10 on the touched surface, authz/authn, input validation, injection, secrets, dependency CVEs. Emit the verdict as a `CRITIQUE GATE: PASS|FAIL` block. On any CRITICAL/STRICT finding → send the design back to the owning subagent to fix (bounded retry, max 3), then proceed; if still failing, STOP and escalate to the user via the AskUserQuestion tool (option cards) with the failing evidence. Never write implementation code on an unresolved CRITICAL finding.

Department → subagent routing map:

| Department / concern | Subagent |
|---|---|
| Orchestration of multi-department work | `team-orchestrator` |
| Architecture, service boundaries, ADRs, build-vs-buy | `solution-architect` |
| Hard algorithm/data-structure design, perf/scale-critical, research-to-production | `research-solution-architect` |
| Server-side services, APIs, business logic, queues | `backend-engineer` |
| Web UI (React/TS), accessibility, state, perf | `frontend-engineer` |
| End-to-end vertical slices (API→UI), MVPs, prototypes | `fullstack-engineer` |
| Shared UI components, design tokens, primitives | `design-system-engineer` |
| User flows, IA, prototypes, unhappy-path UX | `ux-flow-designer` |
| Cloud architecture, k8s, multi-region, cost | `cloud-engineer` |
| CI/CD, IaC, container build/deploy, env parity | `devops-engineer` |
| Reliability, SLOs, observability, incident response | `site-reliability-engineer` |
| Adversarial security review (read-only) | `security-auditor` |
| Security hardening, threat modeling, fixes | `security-engineer` |
| Regulatory/compliance gap review (read-only) | `compliance-officer` |
| Functional/exploratory/release QA testing | `qa-engineer` |
| Automated test suites (unit/integration/e2e/load) | `testing-engineer` |
| Computer-vision systems and pipelines | `computer-vision-engineer` |
| Productionizing models, training pipelines, eval gates, serving | `ml-engineer` |
| Data pipelines, ETL, schema/quality validation, leakage checks | `data-engineer` |
| Experiment design, metrics, statistical analysis, A/B readouts | `data-scientist` |
| Sourced research, prior-art, feasibility, dossiers | `research-agent` |
| Understanding legacy/undocumented code, reverse-eng | `reverse-engineering-agent` |
| Delivery planning, milestones, dependencies, risk | `project-manager` |
| Release gates, changelog, versioning, go/no-go | `release-manager` |
| Data tier — schema, indexing, query tuning, migrations, replication, backups | `database-engineer` |
| Mobile apps (iOS/Android/RN/Flutter), on-device perf/storage | `mobile-engineer` |
| LLM application layer — RAG, agents/tool-use, prompt/eval, LLM safety | `ai-application-engineer` |
| Smart contracts / on-chain systems (Solidity), contract security, audits | `blockchain-engineer` |

When a query does not clearly map to a department, the main agent picks the closest-fit department and states why, or asks the user to disambiguate.

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
- When a subagent raises a ground-truth-backed concern, it reports it to the main agent. The main agent evaluates the evidence and decides whether it must be escalated to the user (a real risk/decision the user owns) or resolved in-loop (handled within the current plan). Escalations to the user use the AskUserQuestion tool with concrete options (option cards), not a free-text prompt. Do not silently drop a grounded concern, and do not flood the user with every minor one.

Switch level: /enforce solo|team|prod|off
Stop: "stop enforce" or "normal mode"

Persistence: active every response until deactivated.
