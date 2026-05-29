# enforce-mode

Claude Code plugin: always-on universal engineering rules + project-aware domain enforcement.

## Structure

- `hooks/` — Core logic (activate, detect, config, rules, tracker, skill-loader) + installers + statusline scripts
- `hooks/enforce-skill-loader.js` — PECK-integrated skill loading enforcement (PreToolUse)
- `hooks/enforce-grounding.js` — API-symbol → source attribution (anti-hallucination core; pure functions)
- `hooks/enforce-research-capture.js` — PostToolUse search result capture for GTC scoring
- `hooks/enforce-post-write-check.js` — PostToolUse compliance check after Write/Edit
- `hooks/enforce-session-log.js` — Stop hook that persists session activity to `.claude/session_logs.md`
- `hooks/enforce-session-save.js` — Stop hook that auto-saves session summary to `~/.claude/session-data/`
- `hooks/enforce-session-resume.js` — SessionStart hook that loads previous session context
- `hooks/domains/` — Modular domain pattern files (v3: 30 domains, 83 patterns)
- `rules/` — Rule markdown files: `universal.md` + `domains/*.md` (41 domains)
- `skills/enforce/SKILL.md` — Source of truth for all rule definitions
- `commands/enforce.toml` — `/enforce` slash command
- `tests/` — 304 tests across 14 suites
- `.claude-plugin/` — Plugin manifest for Claude Code marketplace

## Key Patterns

- Entry point: `hooks/enforce-activate.js` (SessionStart hook)
- Domain detection: weighted signal scoring in `hooks/enforce-detect.js` (v1+v2+v3 = 41 domains)
- Domain patterns: modular loading from `hooks/domains/*.js` (v3)
- Level filtering: severity tags `[WARN]`/`[STRICT]`/`[CRITICAL]` mapped to solo/team/prod
- Level-aware enforcement: guards respect severity × level (v3)
- Context budget: 8KB max, ~2KB universal + ~1KB per domain (max 4 domains)
- Zero npm dependencies — pure Node.js stdlib

## Testing

```bash
for t in tests/test-*.js; do node "$t" || exit 1; done
```

All 451 tests across 18 suites must pass before committing. Tests are hermetic:
config/skill discovery dirs are overridable via `ENFORCE_CONFIG_DIR`,
`ENFORCE_SETTINGS_PATH`, `ENFORCE_SKILLS_DIR`, `ENFORCE_PLUGINS_DIR` so they never
leak machine-installed config or skills.

## Adding Domains (v3)

1. Create `hooks/domains/<domain>.js` exporting `{ domain, patterns, extMap }`
   - Each pattern: `{ name, regex, risk, confidence, severity, multiline, justification }`
   - confidence: HIGH|MEDIUM|LOW (detection accuracy)
   - severity: WARN|STRICT|CRITICAL (enforcement level)
   - Must have >= 2 HIGH confidence patterns per domain
2. Add detection signals to `DOMAIN_RULES_V3` in `hooks/enforce-detect.js`
3. Create `rules/domains/<domain>.md` with `[WARN]`/`[STRICT]`/`[CRITICAL]` tagged rules
4. Add coverage matrix tests in `tests/`

## PECK v3 Algorithm

Confidence-weighted, level-aware escalation with safety mechanisms:

### Core (v2, unchanged)
- Patterns declare confidence: HIGH (1.0), MEDIUM (0.5), LOW (0.25)
- Context detection suppresses matches in comments/tests/types (multiplier 0.0)
- Domain relevance prevents cross-domain false triggers
- effectiveWeight = confidence × context × domainRelevance
- Below 0.5 threshold → advisory only, never escalates
- Above 0.75 → accelerated escalation (skips tier 0)

### v3 Additions
- **Severity × Level filtering**: WARN enforces at solo+, STRICT at team+, CRITICAL at prod (with team advisory)
- **Level-aware tier cap**: solo max T0, team max T2 (STRICT)/T1 (CRITICAL), prod max T3
- **Global safety valve**: 5+ domain circuits open → enforcement paused
- **Time-based decay**: 5min stale violations decay by 0.5 per tick
- **Per-pattern-per-file dedup**: one violation per pattern name per file
- **Cross-domain overlap prevention**: same pattern name skipped if already found
- **Inline suppression**: `// enforce-ignore` comments suppress nearby patterns
- **Dynamic budgets**: auto-calculated from patternCount × (1 - avgConfidence) × 2
- **Modular loading**: patterns from `hooks/domains/*.js`, fallback to built-in
- **Context domain cap**: max 4 domains in system prompt (budget guarantee)
- **Skill loading enforcement**: PECK-integrated PreToolUse hook (ALWAYS severity, full T0→T3 at all levels, no level cap)
- **Dual output**: All T0/T1 messages output to both stderr (user terminal) and additionalContext (Claude)
- **Ground truth capture**: PostToolUse captures WebSearch/WebFetch results into state.groundTruth
- **Research-mandatory gate**: budget=1, HIGH confidence, ALWAYS severity — immediate T2 deny for unresearched libraries
- **GTC scoring**: Ground Truth Confidence score (0-100) computed per response from 6 signals, displayed via stderr
- **Grounded-Generation Layer** (`enforce-grounding.js`, write-guard CHECK 2b): after a library is research-verified, extract the API call symbols the code uses (deep member chains like `client.chat.completions.create`) and check each against the captured doc snippets. A symbol with no source is **UNVERIFIED** (likely hallucinated signature). Citation-attribution adapted to code (VeriCite, SIGIR-AP 2025; abstention from semantic-entropy work, Nature 2024).
  - **Conditional firing** (FP control): only runs when ground truth exists to check against — never second-guesses un-researched code (that is the research gate's job). Builtins (`.map`/`.then`/`.push`…) and noise roots (`this`/`res`/`console`) are never flagged. Only HIGH-confidence (deep-chain) ungrounded symbols escalate.
  - **Deadlock-safe**: `grounding` category is STRICT severity → suppressed at solo, capped at T2 (deny, never permanent block) at team/prod. The escape hatch is always "search the flagged symbol" → captures it into ground truth → next write grounds and clears. Compliance decays the violation count.

### Level Matrix

```
           SOLO          TEAM          PROD
[WARN]     T0 max        T0 max        T0-T1
[STRICT]   suppressed    T0-T2         T0-T2
[CRITICAL] suppressed    T0-T1         T0-T3 (hard block)
```
