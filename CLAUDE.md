# enforce-mode

Claude Code plugin: always-on universal engineering rules + project-aware domain enforcement.

## Structure

- `hooks/` — Core logic (activate, detect, config, rules, tracker) + installers + statusline scripts
- `rules/` — Rule markdown files: `universal.md` + `domains/*.md`
- `skills/enforce/SKILL.md` — Source of truth for all rule definitions
- `commands/enforce.toml` — `/enforce` slash command
- `tests/` — 39 tests across 3 suites (config, detect, rules)
- `.claude-plugin/` — Plugin manifest for Claude Code marketplace

## Key Patterns

- Entry point: `hooks/enforce-activate.js` (SessionStart hook)
- Domain detection: weighted signal scoring in `hooks/enforce-detect.js`
- Level filtering: severity tags `[WARN]`/`[STRICT]`/`[CRITICAL]` mapped to solo/team/prod
- Context budget: 8KB max, ~2KB universal + ~1KB per domain
- Zero npm dependencies — pure Node.js stdlib

## Testing

```bash
node tests/test-config.js && node tests/test-detect.js && node tests/test-rules.js
```

All 39 tests must pass before committing.

## Adding Domains

1. Add signals to `DOMAIN_RULES` in `hooks/enforce-detect.js`
2. Create `rules/domains/<domain>.md` with severity-tagged rules
3. Add tests in `tests/`
