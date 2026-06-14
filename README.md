<p align="center">
  <img src="images/hero-banner.png" alt="enforce-mode — Always-on engineering rules for Claude Code" width="100%"/>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"/></a>
  <a href="#how-it-works"><img src="https://img.shields.io/badge/Node.js-stdlib%20only-339933.svg" alt="Node.js"/></a>
  <a href="#installation"><img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform"/></a>
</p>

# enforce-mode

**Automatic quality rules for Claude Code.** Like a spell-checker, but for engineering best practices.

When you use Claude Code to write software, enforce-mode watches in the background and makes sure Claude follows good engineering habits — researching before coding, testing before shipping, never committing secrets, and following security best practices.

> Think of it as a safety net that catches mistakes before they happen.

---

## What Does It Do?

Without enforce-mode, Claude Code might:
- Write code without checking if libraries are up to date
- Skip tests and say "it should work"
- Accidentally commit API keys or passwords
- Ignore security best practices

**With enforce-mode**, Claude is guided to:
- Research APIs before using them (per-library ground truth verification)
- Run tests and show results
- Never commit secrets
- Follow security patterns for your project type
- Load relevant skills before writing code
- Meet a Ground Truth Confidence (GTC) score threshold every response

<p align="center">
  <img src="images/before-after.png" alt="Before and after enforce-mode" width="100%"/>
</p>

---

## Installation

### Option 1: Plugin Install (Recommended)

```bash
claude plugin install enforce-mode
```

That's it. It activates automatically on every session.

### Option 2: Manual Install

**Mac / Linux:**
```bash
git clone https://github.com/Rutvik552k/enforce-mode.git
cd enforce-mode
bash hooks/install.sh
```

**Windows:**
```powershell
git clone https://github.com/Rutvik552k/enforce-mode.git
cd enforce-mode
powershell -ExecutionPolicy Bypass -File hooks\install.ps1
```

### Auto-Updates

Enable auto-updates so you always have the latest version:
```
/plugin → Marketplaces tab → select enforce-mode → Enable auto-update
```

---

## How to Use

Once installed, enforce-mode runs automatically. No configuration needed.

### Switch Enforcement Level

```
/enforce solo    # Light rules — for solo prototyping
/enforce team    # Stricter — for team projects
/enforce prod    # Full security stack — for production code
/enforce off     # Turn off
```

Or just say in chat:
```
"stop enforce"   # turns it off
"normal mode"    # turns it off
```

### What Each Level Does

| Level | Best For | What It Checks |
|-------|----------|---------------|
| **solo** | Personal projects, learning | Basic rules: research before coding, test before shipping, no secrets |
| **team** | Shared codebases | + Documentation, parallel tasks, dependency tracking |
| **prod** | Production systems | + Full security audit, performance checks, monitoring rules |

---

## What It Catches (Examples)

| Situation | What enforce-mode does |
|-----------|----------------------|
| Claude tries to commit an AWS key | Flags the secret — "move to env vars / a secret manager" |
| Claude writes code without checking docs | Advises: "research this library first" |
| Claude says "it should work" without testing | Reminds: "run the tests and show output" |
| Claude uses `eval()` or SQL string concatenation | Flags security anti-pattern |
| Claude runs a training script in foreground | Advises: "use background mode for long tasks" |
| Claude writes code using `prisma` without searching docs | Advises: search the docs to verify the API first |
| Claude finishes response with low research coverage | GTC score shown in terminal: `GTC: 35/100 [FAIL]` |

### How Enforcement Works

enforce-mode is **advisory** — it never blocks, denies, or hard-stops an action. Every
check approves the tool call and injects guidance:

```
Every check → guidance injected (the action always runs)
  • Terminal:  a [WRITE-GUARD] / [BASH-GUARD] line you see
  • Claude:    additionalContext so it acts on the advice
  • Stop hook: a pre-completion summary + GTC score
```

Nothing is ever denied or hard-stopped — the model stays in control and decides how to
act on each advisory. No retry loops, no deadlocks by construction.

### Active Hooks (minimal pipeline)

This build runs a **lean 3-hook pipeline** — the core enforcement loop, nothing else:

| Event | Hook | Role |
|-------|------|------|
| `SessionStart` | `enforce-activate.js` | Injects universal + detected-domain rules; project & skill detection |
| `PreToolUse` (Write/Edit/NotebookEdit) | `enforce-write-guard.js` | Advisory write-time checks: secrets, research/grounding, security anti-patterns (never blocks) |
| `Stop` | `enforce-stop-guard.js` | Pre-completion checks + GTC score |

The remaining hook scripts ship in `hooks/` but are **not registered** in this
build. The features they powered (listed below as *extended hooks*) are dormant
unless you wire them back into `.claude-plugin/plugin.json`.

### Dual Output

Enforcement messages from the active hooks appear in **two places**:
- **Your terminal** (via stderr) — you always see what's happening
- **Claude's context** (via additionalContext) — Claude acts on the guidance

---

## Smart Project Detection

enforce-mode automatically detects what type of project you're working on and activates relevant rules. No configuration needed.

**Examples:**
- Has `package.json` with React? → Activates frontend rules (XSS prevention, accessibility)
- Has `requirements.txt` with Flask? → Activates API security rules
- Has `.sol` files? → Activates blockchain rules (reentrancy, gas limits)
- Has `Dockerfile`? → Activates container security rules

**41 project types detected** including: ML/AI, web frontend, backend APIs, mobile apps, databases, payments, DevOps, and more.

---

## Auto-Skill Loading (extended hook — dormant in minimal build)

> Powered by `enforce-skill-loader.js` / `enforce-skill-auto-loader.js`, which are
> **not registered** in the minimal pipeline. Re-add their `PreToolUse` entries to
> `plugin.json` to enable. `enforce-activate.js` still *detects and lists* relevant
> skills at session start; it just no longer auto-injects them per tool call.

enforce-mode automatically loads relevant skills based on what code you're writing:

- Writing authentication code? → Security review skill loaded
- Writing React components? → Frontend best practices loaded
- Researching Kubernetes? → DevOps skill loaded

**Dynamic discovery** scans all installed skills from `~/.claude/skills/` — not just ECC skills. Marketplace skills, user skills, and plugin skills are all discoverable. Excluded: enforce-mode and caveman (infrastructure, not code review).

**68+ skills auto-discoverable** from your installed skill library. New skills you install are picked up automatically within 5 minutes.

No manual `/ecc:skill-name` invocation needed — rules inject directly into context.

---

## Ground Truth Enforcement

enforce-mode tracks **what Claude actually researched** vs **what libraries Claude uses in code**.

### How It Works

1. **Capture** *(extended hook — dormant in minimal build)*: When Claude searches (WebSearch, context7, Exa), a PostToolUse hook (`enforce-research-capture.js`) captures the results — query text, snippets, URLs — into session state per library. Re-register it to feed the gate and grounding checks.
2. **Check**: When Claude writes code with external imports, the `PreToolUse` write-guard checks if each library has captured ground truth. **No ground truth → advisory** — guidance is injected to research the API first, and the write still proceeds (never denied). In the minimal build, with capture dormant, this check stays quiet by design.
3. **Inject**: When ground truth exists, relevant doc snippets are injected as context — Claude sees the docs right when writing.
4. **Score**: A GTC (Ground Truth Confidence) score is computed every response by the `Stop` hook and displayed in your terminal.

### GTC Score

Computed from 6 signals — all hook-measured, zero Claude self-assessment:

| Signal | Points | What it measures |
|--------|--------|-----------------|
| Research coverage | 0-30 | % of external libs with captured ground truth |
| Search specificity | 0-20 | Did search queries contain the library name? |
| Doc alignment | 0-20 | Do code API calls appear in captured snippets? |
| Skill compliance | 0-15 | Were relevant review skills loaded? |
| Test coverage | 0-15 | Were tests run for changed code? |
| Violations | -5 each | PECK violations reduce score |

```
┌─────────────────────────────────────┐
│ GTC: 92/100 [██████████░] HIGH      │
│ Research: 30/30 | Docs: 18/20       │
│ Specificity: 20/20 | Skills: 15/15  │
│ Tests: 15/15 | Violations: -6       │
└─────────────────────────────────────┘
```

- **90-100 HIGH**: Full compliance
- **70-89 GOOD**: Minor gaps
- **50-69 LOW**: Review recommended
- **0-49 FAIL**: Stop hook flags the gaps (advisory) for Claude to address before completing

---

## Grounded Generation — API-symbol attribution (v3.4)

Knowing Claude researched the *library* `stripe` is not the same as knowing the
*method* it just wrote — `stripe.subscriptions.fabricatePlan()` — actually exists.
Library-level checks miss invented method signatures, the most common form of code
hallucination.

The **Grounded-Generation Layer** closes that gap. After a library is
research-verified, it extracts every external API call symbol in the code and
checks each one against the documentation snippets that were actually captured:

- **Grounded** — the symbol appears in a researched doc → trusted, docs injected as context.
- **UNVERIFIED** — the symbol appears in *no* researched source → flagged. Claude must
  search the exact symbol to confirm it exists, or tag it `// UNVERIFIED: <symbol>` and
  tell you it came from training memory, not verified docs.

This is citation-attribution adapted to code — grounding each generated API call in a
real source, the same principle behind reliable-citation RAG research
([VeriCite, SIGIR-AP 2025](https://arxiv.org/abs/2510.11394)) and the
abstain-when-ungrounded finding from semantic-entropy hallucination detection
([Farquhar et al., *Nature* 2024](https://www.nature.com/articles/s41586-024-07421-0)).

**Low false positives by design** ([ZeroFalse, 2025](https://arxiv.org/abs/2510.02534)):
it only fires when research exists to check against, never flags language builtins
(`.map`/`.then`/`.push`) or self-references (`this`/`res`), and only escalates
high-confidence deep call chains.

**Advisory by design**: the `grounding` check is suppressed at `solo`, and surfaces as
guidance (never a deny or block) at `team`/`prod`. There is always one clear next step —
search the flagged symbol; once captured, it grounds and the advisory clears.

---

## Department Agents (v3.6)

enforce-mode ships **28 department subagents** that realize the `CLAUDE.md` Rule 2
routing map out of the box. Install the plugin and the whole team is available as
`enforce-mode:<agent>` — no per-project authoring required.

Every agent carries an explicit **tech stack** and **engineering-method + efficiency**
section so it knows the concrete tools of its trade and how to use them well — not just
the principles.

Every agent is built with the same enforce-mode contract baked into its system
prompt:

- **Ground before acting** — verify APIs/versions/behavior against primary sources
  before recommending or coding. No "it should work."
- **POV backed by ground truth** — every claim cites evidence (doc link, paper +
  table/page, source file, command output). Opinion without evidence is invalid.
- **Report failures as-is** — a failed run/test/result is reported with its output,
  never reframed as success.
- **Stay in your department** — defer cross-department work to the main agent;
  cross-cutting work goes through `team-orchestrator` first.

| Department | Agent |
|---|---|
| Architecture / contracts | `solution-architect` |
| Algorithms / performance (complexity targets) | `research-solution-architect` |
| Server-side services / APIs / business logic | `backend-engineer` |
| Web UI (React/TS) / accessibility / perf | `frontend-engineer` |
| End-to-end vertical slices (API→UI) | `fullstack-engineer` |
| Shared UI components / design tokens | `design-system-engineer` |
| User flows / IA / prototypes (unhappy paths) | `ux-flow-designer` |
| Data tier — schema / indexing / migrations | `database-engineer` |
| Mobile apps (iOS/Android/RN/Flutter) | `mobile-engineer` |
| LLM app layer — RAG / agents / eval / safety | `ai-application-engineer` |
| Smart contracts / on-chain (Solidity) | `blockchain-engineer` |
| Vision / steganalysis modeling | `computer-vision-engineer` |
| ML training & serving | `ml-engineer` |
| Data pipelines / datasets / leakage | `data-engineer` |
| Statistics / experiments / figures | `data-scientist` |
| Research / citations / SOTA | `research-agent` |
| CI/CD / IaC / GPU ops | `devops-engineer` |
| Cloud / cost / scaling | `cloud-engineer` |
| Reliability / incident response | `site-reliability-engineer` |
| Security audit (read-only) | `security-auditor` |
| Security hardening / fixes | `security-engineer` |
| QA / integrity review | `qa-engineer` |
| Automated tests (SDET) | `testing-engineer` |
| Legacy / reverse engineering | `reverse-engineering-agent` |
| Planning / risk | `project-manager` |
| Release / go-no-go | `release-manager` |
| Compliance (read-only) | `compliance-officer` |
| Cross-department orchestration | `team-orchestrator` |

Agent files live in [`agents/`](agents/) and are validated by `tests/test-agents.js`.

---

## Configuration (Optional)

enforce-mode works out of the box with sensible defaults. For customization:

### Set Default Level

**Environment variable:**
```bash
export ENFORCE_DEFAULT_LEVEL=team
```

**Config file** (`~/.config/enforce-mode/config.json`):
```json
{
  "defaultLevel": "team"
}
```

### Level Persistence

When you type `/enforce prod`, it saves across sessions — no need to type it every time.

---

## How It Works (Technical)

```
You start a Claude Code session
  ↓
enforce-mode scans your project directory
  ↓
Detects project type (React? Python? Terraform?)
  ↓
Loads universal rules + project-specific rules
  ↓
Watches every tool call Claude makes
  ↓
Warns → Blocks → Hard-stops on repeated violations
```

**Key technical details:**
- Zero external dependencies (pure Node.js)
- < 150ms per check (usually ~100ms)
- Per-session isolation (one session's state doesn't affect others)
- 8KB max context budget (doesn't bloat your conversations)
- Dual output: stderr (user terminal) + additionalContext (Claude context)
- GTC score computed per response by the `Stop` hook, displayed via stderr (zero context cost)
- Minimal pipeline: 3 registered hooks (activate · write-guard · stop-guard); extended hooks ship in `hooks/` but are unregistered (see *Active Hooks*)

---


## Adding Your Own Rules

Want to add rules for your specific project type? See the [Contributing Guide](#contributing).

**Quick version:**
1. Create a pattern file: `hooks/domains/my-domain.js`
2. Add detection signals: `hooks/enforce-detect.js`
3. Add rule text: `rules/domains/my-domain.md`

---

## FAQ

**Q: Will this slow down Claude Code?**
A: No. Each check takes ~100ms. You won't notice any delay.

**Q: Can I turn it off for one session?**
A: Yes. Say "stop enforce" or type `/enforce off`.

**Q: Does it work on Windows?**
A: Yes. Fully supported on macOS, Linux, and Windows.

**Q: What if Claude gets stuck because of a rule?**
A: It can't. enforce-mode is advisory — every check approves the action and only injects guidance. Nothing is ever blocked or denied, so there are no retries or deadlocks.

**Q: Does it use the internet?**
A: No. Everything runs locally. Zero API calls, zero network requests.

**Q: Can I use it with other plugins?**
A: Yes. It coexists with caveman-mode and other Claude Code plugins.

**Q: What is the GTC score?**
A: Ground Truth Confidence — a 0-100 score computed from measurable signals (research coverage, doc alignment, skill compliance, tests). It's not Claude self-assessing; it's hooks measuring what actually happened. Displayed in your terminal every response.

---

## Contributing

1. Fork the repo
2. Create a feature branch
3. Add your domain (pattern file + detection rules + rule text)
4. Write tests
5. Run all tests (must pass)
6. Submit a PR

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<p align="center">
  <b>v3.7.1</b> — advisory-only model (never blocks/denies), 28 tech-stack-aware department agents, 41 domains, 68+ auto-discoverable skills, grounded-generation (API-symbol attribution), GTC scoring, ground truth guidance, dual output, zero dependencies
</p>
