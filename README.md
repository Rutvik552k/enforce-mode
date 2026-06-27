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

When you use Claude Code to write software, enforce-mode runs quietly in the background and nudges Claude toward good engineering habits — researching before coding, testing before shipping, never committing secrets, and following security best practices for your project type.

> Think of it as a safety net that reminds Claude of the right thing to do at the right moment.

---

## What Does It Do?

Without enforce-mode, Claude Code might:
- Write code without checking whether a library is up to date
- Skip tests and say "it should work"
- Accidentally commit an API key or password
- Miss security best practices

**With enforce-mode**, Claude is guided to:
- Research an API before using it
- Run tests and show the output
- Keep secrets out of commits
- Follow security patterns matched to your project type
- Earn a Ground Truth Confidence (GTC) score on every response

<p align="center">
  <img src="images/before-after.png" alt="Before and after enforce-mode" width="100%"/>
</p>

---

## Installation

enforce-mode installs as a Claude Code **plugin**. Pick one of the two options below.

### Option 1 — Plugin install (recommended)

Run these two commands inside Claude Code:

```
/plugin marketplace add Rutvik552k/enforce-mode
/plugin install enforce-mode@enforce-mode
```

The first command tells Claude Code where to find the plugin (this GitHub repo).
The second installs it. After that it activates automatically on every session —
no further setup.

> **Keep it up to date:** open `/plugin` → **Marketplaces** tab → select
> **enforce-mode** → enable **auto-update**.

### Option 2 — Manual install (no plugin system)

Use this if you prefer to wire the hooks into your `~/.claude/settings.json`
directly. You only need **Node.js** installed (the hooks are plain Node, zero
dependencies).

**Mac / Linux:**
```bash
git clone https://github.com/Rutvik552k/enforce-mode.git
cd enforce-mode
bash hooks/install.sh
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/Rutvik552k/enforce-mode.git
cd enforce-mode
powershell -ExecutionPolicy Bypass -File hooks\install.ps1
```

The installer copies the hook scripts to `~/.claude/hooks/`, the rules to
`~/.claude/rules/`, and registers everything in `~/.claude/settings.json`. It is
**idempotent** — safe to run again — and backs up your existing `settings.json`
before changing it. Re-run with `--force` to reinstall.

To remove a manual install later, run `/enforce-uninstall` (or
`node hooks/enforce-uninstall.js`), which removes only what the installer added.

---

## How to Use

Once installed, enforce-mode runs automatically. No configuration needed.

### Switch enforcement level

```
/enforce solo    # Light rules — solo prototyping
/enforce team    # Stricter — team projects
/enforce prod    # Full security stack — production code
/enforce off     # Turn it off
```

Or just say it in chat:
```
"stop enforce"   # turns it off
"normal mode"    # turns it off
```

The level you pick is **remembered across sessions** — set it once.

### What each level does

| Level | Best for | What it adds |
|-------|----------|--------------|
| **solo** | Personal projects, learning | Core rules: research before coding, test before shipping, no secrets |
| **team** | Shared codebases | + documentation, parallel tasks, dependency tracking |
| **prod** | Production systems | + full security audit, performance checks, monitoring rules |

### Set a project anchor (optional)

```
/enforce-init "<your goal>"
```

This detects your tech stack, captures your requirements, and writes a small
managed block into your project's `CLAUDE.md` (between
`<!-- enforce-anchor:start/end -->` markers — your own content is left
untouched). Claude re-reads this anchor to stay on the goal as work progresses.
When the goal, stack, or task list changes, the anchor is kept in sync.

---

## What It Catches (Examples)

| Situation | What enforce-mode does |
|-----------|------------------------|
| Claude tries to commit an AWS key | Flags the secret — "move it to env vars / a secret manager" |
| Claude writes code without checking docs | Advises: "research this library first" |
| Claude says "it should work" without testing | Reminds: "run the tests and show the output" |
| Claude uses `eval()` or SQL string concatenation | Flags the security anti-pattern |
| Claude runs a long training script in the foreground | Advises: "use background mode for long tasks" |
| Claude finishes with low research coverage | Shows a GTC score in your terminal: `GTC: 35/100 [FAIL]` |

---

## How Enforcement Works

enforce-mode is **advisory by design** — it never blocks, denies, or hard-stops
an action. Every check lets the action run and simply adds guidance:

- **In your terminal** — a short guidance line (via stderr) so you always see
  what's happening.
- **In Claude's context** — the same guidance so Claude can act on it.
- **At the end of a response** — a pre-completion summary plus the GTC score.

Because nothing is ever denied, there are no retry loops and no way to get stuck.
Claude stays in control and decides how to act on each advisory.

Under the hood this is a small set of lightweight Node hooks that run on a few
Claude Code events — session start, every prompt, before a file write, and at
the end of a response. They are fast (~100ms each), run entirely on your machine,
and add no external dependencies.

---

## Smart Project Detection

enforce-mode looks at your project and turns on the rules that fit — no
configuration needed.

**Examples:**
- `package.json` with React → frontend rules (XSS prevention, accessibility)
- `requirements.txt` with Flask → API security rules
- `.sol` files → blockchain rules (reentrancy, gas limits)
- `Dockerfile` → container security rules

**41 project types** are recognized, spanning ML/AI, web frontends, backend
APIs, mobile apps, databases, payments, DevOps, and more.

---

## Department Agents

enforce-mode ships **28 department subagents** that bring the `CLAUDE.md`
routing map to life out of the box. Install the plugin and the whole team is
available as `enforce-mode:<agent>` — no per-project setup.

Every agent carries an explicit **tech stack**, **engineering-method and
efficiency** guidance, and a **Domain DSA** section — the industry algorithms and
data structures native to its work, each with its Big-O and why it is chosen
(e.g. `backend-engineer` → Token Bucket O(1) rate limiting, Consistent Hashing
O(log n) sharding; `ml-engineer` → ring all-reduce O(N), FlashAttention O(n)
memory). Cross-cutting capabilities an agent pulls in *only when its solution
needs them* — rate limiting, JWT, idempotency, caching, retries, circuit
breakers — live in one shared inheritance matrix,
[`rules/mechanisms.md`](rules/mechanisms.md) (mechanism → trigger → algorithm →
Big-O → inheriting agents).

Each agent is built on the same contract:

- **Ground before acting** — verify APIs, versions, and behavior against primary
  sources before recommending or coding. No "it should work."
- **Obey universal.md** — the universal engineering rules, the non-functional
  requirements (CRUD correctness, reliability, scalability, alterability,
  loggability, security, complexity targets), and the critique gate apply to
  every agent; they are not restated per-agent.
- **Fail loud, no fallbacks** — on an unexpected condition, raise a typed error
  naming the root cause (operation, inputs, failing component); never silently
  fall back, swallow, or serve a stale result.
- **Stay in your lane** — cross-department work goes through `team-orchestrator`
  first.

| Department | Agent |
|---|---|
| Architecture / contracts | `solution-architect` |
| Algorithms / performance | `research-solution-architect` |
| Server-side services / APIs | `backend-engineer` |
| Web UI (React/TS) / accessibility | `frontend-engineer` |
| End-to-end vertical slices (API→UI) | `fullstack-engineer` |
| Shared UI components / design tokens | `design-system-engineer` |
| User flows / IA / prototypes | `ux-flow-designer` |
| Data tier — schema / indexing / migrations | `database-engineer` |
| Mobile apps (iOS/Android/RN/Flutter) | `mobile-engineer` |
| LLM app layer — RAG / agents / safety | `ai-application-engineer` |
| Smart contracts (Solidity) | `blockchain-engineer` |
| Vision / steganalysis modeling | `computer-vision-engineer` |
| ML training & serving | `ml-engineer` |
| Data pipelines / datasets | `data-engineer` |
| Statistics / experiments | `data-scientist` |
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

## Ground Truth & the GTC Score

enforce-mode tracks **what Claude actually researched** versus **what its code
relies on**, and turns that into a single score you can read at a glance.

The **GTC (Ground Truth Confidence)** score is computed from measurable signals
on every response — not Claude grading itself, but hooks measuring what really
happened:

| Signal | Points | What it measures |
|--------|--------|------------------|
| Research coverage | 0–30 | % of external libs with captured ground truth |
| Search specificity | 0–20 | Did searches include the library name? |
| Doc alignment | 0–20 | Do the code's API calls appear in researched docs? |
| Skill compliance | 0–15 | Were relevant review skills loaded? |
| Test coverage | 0–15 | Were tests run for changed code? |
| Violations | −5 each | Each rule violation lowers the score |

```
┌─────────────────────────────────────┐
│ GTC: 92/100 [██████████░] HIGH       │
│ Research: 30/30 | Docs: 18/20        │
│ Specificity: 20/20 | Skills: 15/15   │
│ Tests: 15/15 | Violations: -6        │
└─────────────────────────────────────┘
```

- **90–100 HIGH** — full compliance
- **70–89 GOOD** — minor gaps
- **50–69 LOW** — review recommended
- **0–49 FAIL** — the gaps are flagged (advisory) for Claude to address

**Grounded generation** goes one level deeper: knowing Claude researched the
library `stripe` is not the same as knowing the *method* it wrote
(`stripe.subscriptions.fabricatePlan()`) actually exists. enforce-mode checks
each external API symbol against the docs that were actually captured. A symbol
found in a researched source is **grounded**; one found nowhere is flagged
**UNVERIFIED** so Claude searches it or labels it as coming from memory. This is
advisory too — it points to one clear next step and never blocks.

---

## Configuration (Optional)

enforce-mode works out of the box. To change the default level:

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

---

## FAQ

**Q: Will this slow down Claude Code?**
A: No. Each check takes about 100ms — you won't notice it.

**Q: Can I turn it off for one session?**
A: Yes. Say "stop enforce" or type `/enforce off`.

**Q: Does it work on Windows?**
A: Yes — fully supported on macOS, Linux, and Windows.

**Q: Can a rule ever get Claude stuck?**
A: No. enforce-mode is advisory — every check approves the action and only adds
guidance. Nothing is blocked, so there are no retries or deadlocks.

**Q: Does it use the internet?**
A: No. Everything runs locally — zero API calls, zero network requests.

**Q: Can I use it alongside other plugins?**
A: Yes. It coexists with caveman-mode and other Claude Code plugins.

**Q: What is the GTC score?**
A: Ground Truth Confidence — a 0–100 score built from measurable signals
(research coverage, doc alignment, skill compliance, tests). Hooks measure what
actually happened; Claude does not grade itself.

---

## Contributing

1. Fork the repo
2. Create a feature branch
3. Add your domain (pattern file + detection rules + rule text)
4. Write tests
5. Run all tests (they must pass)
6. Open a PR

**Adding your own rules — quick version:**
1. Create a pattern file: `hooks/domains/my-domain.js`
2. Add detection signals: `hooks/enforce-detect.js`
3. Add rule text: `rules/domains/my-domain.md`

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<p align="center">
  <b>v3.12.0</b> — advisory-only model (never blocks or denies), live
  <code>/enforce</code> level switching, 28 tech-stack-aware department agents
  with per-domain DSA + a shared inherited-mechanisms matrix, non-functional
  requirements baked into every agent, 41 project domains, grounded-generation
  (API-symbol attribution), GTC scoring, dual output (terminal + context),
  zero dependencies
</p>
