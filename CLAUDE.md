# enforce-mode

Claude Code plugin: always-on universal engineering rules + project-aware domain enforcement.

## Structure

- `hooks/` — Core logic (activate, detect, config, rules, tracker, skill-loader) + installers + statusline scripts
- `hooks/enforce-skill-loader.js` — PECK-integrated skill loading enforcement (PreToolUse)
- `hooks/enforce-research-capture.js` — PostToolUse search result capture for GTC scoring
- `hooks/enforce-post-write-check.js` — PostToolUse compliance check after Write/Edit
- `hooks/domains/` — Modular domain pattern files (v3: 30 domains, 83 patterns)
- `rules/` — Rule markdown files: `universal.md` + `domains/*.md` (41 domains)
- `skills/enforce/SKILL.md` — Source of truth for all rule definitions
- `commands/enforce.toml` — `/enforce` slash command
- `tests/` — 270 tests across 13 suites
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
node tests/test-config.js && node tests/test-detect.js && node tests/test-detect-v2.js && node tests/test-rules.js && node tests/test-compress.js && node tests/test-peck.js && node tests/test-peck-v2.js && node tests/test-deadlocks.js && node tests/test-domain-guard.js && node tests/test-peck-v3.js && node tests/test-skill-loader.js && node tests/test-log.js && node tests/test-gtc.js
```

All 270 tests across 13 suites must pass before committing.

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

### Level Matrix

```
           SOLO          TEAM          PROD
[WARN]     T0 max        T0 max        T0-T1
[STRICT]   suppressed    T0-T2         T0-T2
[CRITICAL] suppressed    T0-T1         T0-T3 (hard block)
```
