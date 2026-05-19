# enforce-mode

**Always-on universal engineering rules + project-aware domain rules for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).**

enforce-mode is a Claude Code plugin that injects engineering best practices into every session. Universal rules (research-first, git discipline, test-before-ship) are always active. Domain-specific rules (ML inference, GPU hardware, video pipelines, API security, cost tracking) activate automatically based on what your project actually contains — detected via weighted signal scoring of your working directory.

> Think of it as ESLint for AI-assisted engineering — always on, context-aware, graduated enforcement.

---

## How It Works

```
Claude Code session starts
  │
  ▼
SessionStart hook fires (enforce-activate.js)
  │
  ├─ 1. Resolve level: env var → config file → default ('solo')
  ├─ 2. Scan cwd: single O(n) readdirSync + lazy manifest parsing
  ├─ 3. Score domains: weighted signals (deps × 3, markers × 2, extensions × 1)
  ├─ 4. Assemble rules: universal + domain (level-filtered, budget-capped)
  └─ 5. Emit to stdout → becomes <system-reminder> → Claude follows rules
```

**Zero npm dependencies. Pure Node.js stdlib. < 10ms on typical projects.**

---

## Enforcement Levels

Three graduated levels control rule strictness:

| Level | What's Enforced | Use Case |
|-------|----------------|----------|
| **solo** | Universal rules + domain WARN rules | Solo dev, prototyping |
| **team** | + session docs, parallel execution, cost tracking, requirements sync | Shared infra, team projects |
| **prod** | + full security stack, DSA efficiency, P99 monitoring, DDoS protection | Production systems serving real users |

### Universal Rules (all levels)

These fire in **every session**, regardless of project type:

- **Research before code** — web-search to verify APIs, function signatures, and library versions before implementing
- **Git discipline** — never commit without asking, never push broken code, check for secrets
- **Test before ship** — run tests and show output; "it should work" is not valid
- **Pre-completion analysis** — walk changed code paths, check edge cases, security review
- **Web-research mandate** — verify current docs before implementing external APIs
- **Verify before recommend** — never swap agreed decisions without asking user first

### Team additions

- Session documentation with decisions and rationale
- Parallel execution mandate (background subagents for long tasks)
- Requirements file sync with all imports

### Prod additions

- Full security: auth, rate limiting, input validation, file upload protection, prompt injection defense
- DSA efficiency: Big-O analysis, memory budgets, streaming, P99 tracking
- Secrets management and DDoS protection

---

## Domain Detection

Domains activate via **weighted signal scoring**. Each signal type has a weight; when cumulative score meets the threshold, the domain turns on.

| Domain | Key Signals (weight) | Threshold | What It Enforces |
|--------|---------------------|-----------|------------------|
| **ml-inference** | torch (3), transformers (3), diffusers (2), .safetensors (2), models/ dir (1) | 4 | Background inference, architecture-first, verify weights, pipeline documentation |
| **gpu-hardware** | cupy (3), triton (3), flash-attn (3), .cu files (3), cuda/ dir (2) | 4 | VRAM math, multi-GPU verification, OOM prevention, cost per operation |
| **video-pipeline** | ffmpeg-python (3), moviepy (3), opencv-python (2), decord (3), renders/ dir (2) | 4 | Parallel execution, streaming-first, codec awareness, resource limits |
| **api-security** | fastapi (2), express (2), django (2), Dockerfile (2), k8s/ dir (2) | 3 | Auth on endpoints, rate limiting, input validation, prompt injection defense |
| **cost-tracking** | boto3 (2), google-cloud (2), terraform/ dir (3), .tf files (2) | 3 | Cost reporting, budget guards, instance awareness, egress costs |

**Multiple domains activate simultaneously.** A video ML project with a FastAPI backend gets: `ml-inference` + `video-pipeline` + `api-security`.

### Signal Weights

| Signal Type | Weight Range | Why |
|-------------|-------------|-----|
| Dependencies | 2-3 | Strongest signal — `torch` in requirements.txt definitively indicates ML |
| Marker files | 1-2 | Strong — `Dockerfile` means containerized |
| File extensions | 1-2 | Moderate — `.cu` files mean CUDA kernels |
| Directories | 1-2 | Moderate — `models/` directory suggests ML |

### Domain Rules by Severity

Each domain's rules use severity tags filtered by enforcement level:

| Tag | Minimum Level | Example |
|-----|--------------|---------|
| `[WARN]` | solo | "Background all inference tasks" |
| `[STRICT]` | team | "Dispatch GPU tasks to subagents" |
| `[CRITICAL]` | prod | "Verify model weight checksums" |

---

## Installation

### Via Claude Code plugin marketplace (recommended)

```bash
claude plugin install enforce-mode
```

### Standalone — Unix/macOS

```bash
git clone https://github.com/Rutvik552k/enforce-mode.git
cd enforce-mode
bash hooks/install.sh
```

### Standalone — Windows

```powershell
git clone https://github.com/Rutvik552k/enforce-mode.git
cd enforce-mode
powershell -ExecutionPolicy Bypass -File hooks\install.ps1
```

Both installers:
- Copy hooks to `~/.claude/hooks/`
- Wire SessionStart + UserPromptSubmit + PreToolUse + Stop into `~/.claude/settings.json`
- Configure statusline badge
- Are idempotent (safe to re-run)
- Create backup of settings.json before modification

---

## Usage

### Switch levels

```
/enforce          # activate with default level (solo)
/enforce solo     # base enforcement
/enforce team     # + parallel execution, cost tracking
/enforce prod     # + full security stack
/enforce off      # disable
```

### Deactivate

```
"stop enforce"    # deactivate
"normal mode"     # deactivate
```

### What you see

The statusline shows the active level:

```
[ENFORCE:SOLO]     # bright red badge
[ENFORCE:TEAM]
[ENFORCE:PROD]
```

### What Claude sees

A `<system-reminder>` block injected at session start:

```
ENFORCE MODE ACTIVE — level: team | domains: ml-inference, api-security

## Universal Rules
- RESEARCH BEFORE CODE: Web-search to verify APIs...
- GIT DISCIPLINE: NEVER commit without asking...
...

## ML Inference Domain Rules
- [WARN] BACKGROUND INFERENCE: ALL model inference...
- [STRICT] SUBAGENT GPU: Every model forward pass...

## Persistence
ALWAYS ACTIVE. Every response...
```

---

## Enforcement Hooks (Hard Gates)

Beyond text rules injected at session start, enforce-mode includes **3 runtime hooks** that actively gate Claude's behavior by intercepting tool calls:

| Hook | Event | Rule Enforced | Behavior |
|------|-------|---------------|----------|
| `enforce-research-gate.js` | PreToolUse (Write/Edit/NotebookEdit) | #1 Research before code, #6 Web-research mandate | **Soft gate** — injects warning when writing code with external library imports but no WebSearch/WebFetch/context7 detected in session transcript |
| `enforce-test-gate.js` | PreToolUse (Bash) | #2 Git discipline, #3 Test before ship | **Hard block (exit 2)** — prevents `git commit`/`git push` if no test execution found in session transcript |
| `enforce-pre-completion.js` | Stop | #3 Test before ship, #4 Pre-completion analysis | **Soft gate** — warns when code was written but no tests were run before response completion |

### How they work

- Each hook reads the session **transcript** (JSONL file) to check what tools were used
- `enforce-research-gate.js` scans for WebSearch, WebFetch, or Context7 MCP tool usage before allowing code writes with external imports
- `enforce-test-gate.js` scans for test commands (`cargo test`, `pytest`, `npm test`, etc.) and **blocks git operations** with exit code 2 if none found
- `enforce-pre-completion.js` checks if tests were run **after** the last code write, catching stale test results

### Why both text rules AND hooks?

Text rules alone are advisory — Claude can ignore them under task pressure. Hooks are **mechanical enforcement**: the test-gate physically blocks `git commit` regardless of what Claude "decides" to do. Think of text rules as guidelines and hooks as guardrails.

---

## Configuration

### Environment variable (highest priority)

```bash
export ENFORCE_DEFAULT_LEVEL=prod
```

### Config file

```jsonc
// Unix: ~/.config/enforce-mode/config.json
// Windows: %APPDATA%\enforce-mode\config.json
// Any: $XDG_CONFIG_HOME/enforce-mode/config.json
{
  "defaultLevel": "team"
}
```

### Resolution order

1. `ENFORCE_DEFAULT_LEVEL` environment variable
2. Config file `defaultLevel` field
3. Default: `solo`

---

## Adding Custom Domains

1. **Add detection rules** to `hooks/enforce-detect.js` → `DOMAIN_RULES` array:

```javascript
{
  domain: 'my-domain',
  threshold: 3,
  signals: {
    deps: [
      { name: 'my-library', weight: 3 }
    ],
    files: [
      { ext: '.xyz', weight: 2 }
    ],
    dirs: [
      { name: 'my-dir', weight: 1 }
    ],
    markers: [
      { name: 'my-config.json', weight: 2 }
    ]
  }
}
```

2. **Create rule file** at `rules/domains/my-domain.md`:

```markdown
## My Domain Rules

- [WARN] Rule that applies at solo level and above
- [STRICT] Rule that applies at team level and above
- [CRITICAL] Rule that applies at prod level only
```

3. Done. The rule engine picks it up automatically.

---

## Architecture

### File structure

```
enforce-mode/
├── .claude-plugin/
│   ├── plugin.json              # Hook declarations
│   └── marketplace.json         # Marketplace metadata
├── hooks/
│   ├── enforce-activate.js      # SessionStart — detect + emit rules
│   ├── enforce-mode-tracker.js  # UserPromptSubmit — track /enforce commands
│   ├── enforce-config.js        # Config resolver (env > file > default)
│   ├── enforce-detect.js        # Weighted signal scoring for domain detection
│   ├── enforce-rules.js         # Rule registry + context budget manager
│   ├── enforce-research-gate.js  # PreToolUse — warn on unresearched code writes
│   ├── enforce-test-gate.js     # PreToolUse — block git commit/push without tests
│   ├── enforce-pre-completion.js # Stop — warn if code written but untested
│   ├── enforce-statusline.sh    # Unix statusline badge
│   ├── enforce-statusline.ps1   # Windows statusline badge
│   ├── install.sh               # Standalone Unix installer
│   └── install.ps1              # Standalone Windows installer
├── skills/
│   └── enforce/
│       └── SKILL.md             # Source of truth for all rules
├── rules/
│   ├── universal.md             # Lightweight fallback rule
│   └── domains/
│       ├── ml-inference.md
│       ├── gpu-hardware.md
│       ├── video-pipeline.md
│       ├── api-security.md
│       └── cost-tracking.md
├── commands/
│   └── enforce.toml             # /enforce slash command
├── tests/
│   ├── test-config.js           # 8 tests
│   ├── test-detect.js           # 13 tests
│   └── test-rules.js            # 18 tests
├── README.md
└── LICENSE
```

### Dependency graph

```
enforce-activate.js (entry point)
  ├── enforce-config.js    → getDefaultLevel()
  ├── enforce-detect.js    → detectDomains(cwd)
  │   └── internal parsers: getPythonDeps, getPackageJsonDeps, getGoDeps, getRustDeps, getComposerDeps
  └── enforce-rules.js     → buildContext(level, domains, pluginRoot)
      └── reads rules/domains/*.md at runtime

enforce-mode-tracker.js (UserPromptSubmit)
  └── enforce-config.js    → getDefaultLevel()

enforce-research-gate.js (PreToolUse: Write|Edit|NotebookEdit)
  └── reads transcript_path → checks for WebSearch/WebFetch/context7 usage

enforce-test-gate.js (PreToolUse: Bash)
  └── reads transcript_path → checks for test/build command execution

enforce-pre-completion.js (Stop)
  └── reads transcript_path → checks write-then-test ordering
```

### Context budget

| Component | Budget |
|-----------|--------|
| Universal rules | ~2KB |
| Each domain | ~1KB |
| Max total | 8KB hard cap |

Most confident domains emitted first. If over budget, remaining domains truncated. Tested: all 5 domains at prod level = 8188 bytes (within 8192 cap).

### Detection performance

- Single `fs.readdirSync(cwd)` — one syscall, result cached across all domain rules
- Manifest files parsed lazily — only if they exist
- Never recursive — top-level directory only
- O(n) on directory entries × O(m) domain rules (m=5, effectively constant)

---

## Testing

```bash
node tests/test-config.js    # 8 tests — config resolution
node tests/test-detect.js    # 13 tests — domain detection + dep parsing
node tests/test-rules.js     # 18 tests — rule assembly + level filtering + budget

# Run all
node tests/test-config.js && node tests/test-detect.js && node tests/test-rules.js
```

All 39 tests pass. Tests create temporary project directories with mock dependencies to verify detection accuracy.

---

## Comparison with Caveman Mode

| Feature | caveman | enforce-mode |
|---------|---------|-------------|
| Purpose | Compress communication style | Enforce engineering practices |
| Always-on | Yes (same rules everywhere) | Yes (universal) + conditional (domain) |
| Project-aware | No | Yes (weighted signal scoring) |
| Levels | lite / full / ultra | solo / team / prod |
| Context cost | ~1KB | 2-8KB (scales with domains) |
| Coexists | - | Yes (different flag files) |

Both can run simultaneously. Caveman compresses how Claude talks; enforce-mode controls what Claude checks.

---

## Inspired By

- **[caveman](https://github.com/JuliusBrussee/caveman)** — Claude Code communication mode plugin (activation pattern, hook architecture)
- **[ECC project-detect.js](https://github.com/affaan-m/everything-claude-code)** — production project type detection algorithm (marker files, dep parsing)
- **GitHub Linguist** — weighted signal classification for repository languages
- **ESLint flat config** — explicit ordered rule resolution
- **SonarQube quality gates** — graduated severity enforcement

---

## License

MIT
