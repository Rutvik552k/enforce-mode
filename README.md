<p align="center">
  <img src="images/hero-banner.png" alt="enforce-mode — Always-on engineering rules for Claude Code" width="100%"/>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"/></a>
  <a href="#testing"><img src="https://img.shields.io/badge/Tests-221%20passing-brightgreen.svg" alt="Tests: 221 passing"/></a>
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
- Research APIs before using them
- Run tests and show results
- Never commit secrets
- Follow security patterns for your project type

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
| Claude tries to commit an AWS key | Blocks immediately — secrets never committed |
| Claude writes code without checking docs | Warns: "research this library first" |
| Claude says "it should work" without testing | Escalates: "run the tests and show output" |
| Claude uses `eval()` or SQL string concatenation | Flags security anti-pattern |
| Claude runs a training script in foreground | Blocks: "use background mode for long tasks" |

### How Enforcement Works

Violations are handled progressively — not immediately blocked:

```
1st time → Gentle reminder (code still runs)
2nd time → Stronger warning
3rd time → Blocks the action
4th time → Hard stop (prevents retry loops)
```

This means you won't get stuck in a loop. If Claude truly can't comply, enforcement stops gracefully.

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

## Auto-Skill Loading (v3.2.0)

enforce-mode automatically loads relevant skills based on what code you're writing:

- Writing authentication code? → Security review skill loaded
- Writing React components? → Frontend best practices loaded
- Researching Kubernetes? → DevOps skill loaded

**55 skills auto-discoverable** from your installed skill library. New skills you install are picked up automatically within 5 minutes.

No manual `/ecc:skill-name` invocation needed — rules inject directly into context.

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

---

## Testing

```bash
# Run all 221 tests
node tests/test-config.js && node tests/test-detect.js && node tests/test-detect-v2.js && \
node tests/test-rules.js && node tests/test-compress.js && node tests/test-peck.js && \
node tests/test-peck-v2.js && node tests/test-deadlocks.js && node tests/test-domain-guard.js && \
node tests/test-peck-v3.js && node tests/test-skill-loader.js
```

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
A: The PECK system prevents infinite loops. After 3 retries, enforcement stops gracefully for that violation.

**Q: Does it use the internet?**
A: No. Everything runs locally. Zero API calls, zero network requests.

**Q: Can I use it with other plugins?**
A: Yes. It coexists with caveman-mode and other Claude Code plugins.

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
  <b>v3.2.0</b> — 41 domains, 221 tests, 55 auto-discoverable skills, zero dependencies
</p>
