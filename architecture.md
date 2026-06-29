# architecture.md — enforce-mode

Tech stack + workflow + data-flow of the enforce-mode Claude Code plugin. Keep current:
every dependency added/removed, stack change, or data-flow change updates this file in the
same change. Component-level dependencies live in [`dependency-map.json`](dependency-map.json)
/ [`dependency-map.md`](dependency-map.md).

## What this is

enforce-mode is an **advisory** Claude Code plugin: a set of lightweight Node hooks that run on
Claude Code lifecycle events, plus markdown rule files and 28 department subagent definitions.
It never blocks — it injects guidance into Claude's context and the terminal, and scores each
response (GTC). Goal in `CLAUDE.md` (web-scrape MCP) is aspirational; the repo itself is the plugin.

## Tech stack

| Layer | Tech | Notes |
|---|---|---|
| Hooks | **Node.js, stdlib only** (`fs`, `path`) | zero npm deps; no `package.json`; ~100ms/hook |
| Statusline | Bash (`.sh`) + PowerShell (`.ps1`) | renders level badge from flag-file |
| Rules | Markdown | `rules/universal.md`, `rules/mechanisms.md`, `rules/domains/*.md` (41) |
| Agents | Markdown w/ YAML frontmatter | `agents/*.md` (28); validated by `tests/test-agents.js` |
| Skills | Markdown | `skills/enforce/SKILL.md` |
| Packaging | Claude Code plugin (`.claude-plugin/plugin.json`) + standalone installers (`hooks/install.{ps1,sh}`) | two delivery paths |
| Tests | Node built-in `node:test` style runners | `tests/test-*.js`, run per-file (no test script) |

## Delivery paths (two, and they differ)

1. **Plugin** — `.claude-plugin/plugin.json` registers hooks; agents/rules/skills shipped via marketplace.
2. **Manual installer** — `hooks/install.{ps1,sh}` copy hooks + rules + SKILL.md to `~/.claude/` and wire `settings.json`.

> ⚠️ The two registration surfaces **drift**: plugin.json wires 7 hooks; installers wire 9. See dependency-map findings.

## Runtime workflow (lifecycle events → hooks)

```
SessionStart      → activation (resolve level → build+inject rules → write flag → ensure statusline)
                  → project-docs (warn if CLAUDE.md/architecture.md/progress.md missing)
                  → dependency-map (warn if dependency-map.json/.md missing)
UserPromptSubmit  → prompt-append (inject static enforce reminder)
                  → level-switch (parse /enforce cmd)
                  → mode-tracker (sync level → state + flag)   [installer-only]
PreToolUse W|E    → write-guard (PECK checks + grounding gate)
PreToolUse Bash   → bash-guard                                  [installer-only]
Stop              → stop-guard (unresolved/test gate + compute & record GTC)
```

## Data flow & shared contracts

Hooks are stateless processes; they coordinate through three files under `~/.claude`:

- **flag-file** `~/.claude/.enforce-active` — plain level string. Written by activation / level-switch / mode-tracker / config; read by statusline.
- **state-json** — per-session JSON at `getStatePath(sessionId)`. PECK ticks, compliance, ground-truth, GTC. Read/written by `enforce-state.js`; the hub every guard/completion hook depends on.
- **rules-manifest** `~/.claude/.enforce-rules-manifest` — list of copied domain rules; written by installer, read by uninstall for clean removal.

`enforce-state.js` is the **central hub** (highest fan-in): activation, guards, stop-completion,
mode-tracker, level-switch, skills, session-snapshot all depend on it. Change it carefully —
broad blast radius (see dependency-map affected-by).

## Agent model (3 layers)

1. **Universal** (`rules/universal.md`) — NFRs + operating model every agent inherits (loaded as global rule into main + subagents; verified).
2. **Inherited mechanisms** (`rules/mechanisms.md`) — cross-cutting capabilities pulled in per trigger (rate-limit, JWT, caching, ...).
3. **Domain** (`agents/*.md`) — per-agent role, method, Domain DSA (named algorithms + Big-O), enforce contract.

## Known architectural debt

See `dependency-map.md` → Known issues: broken installer edges (grounding/anchor not copied →
installed activation throws), orphaned hooks (advisory-guards, skills .js, session-snapshot),
copied-but-dead gate hooks, plugin/installer drift. Tracked, not yet fixed.
