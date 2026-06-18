#!/usr/bin/env node
/**
 * enforce-mode — rule registry, level filtering, and context budget manager
 *
 * Assembles the final output string from universal rules + domain-specific
 * rule files. Respects enforcement levels (solo/team/prod) and an 8KB
 * context budget to avoid eating Claude's context window.
 *
 * Token reduction: universal rules are pre-compressed (manual, optimal).
 * Domain rules are compressed at runtime via enforce-compress.js (~25-35%
 * smaller). Response efficiency directive cuts output tokens per response.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { compressRules } = require('./enforce-compress');

// ---------------------------------------------------------------------------
// Level hierarchy
// ---------------------------------------------------------------------------

const LEVEL_HIERARCHY = { solo: 0, team: 1, prod: 2 };

// Severity tags in domain rule files map to minimum enforcement level
const SEVERITY_MIN_LEVEL = {
  'WARN': 'solo',
  'STRICT': 'team',
  'CRITICAL': 'prod'
};

// ---------------------------------------------------------------------------
// Universal rules — always emitted (filtered by minLevel)
// ---------------------------------------------------------------------------

const UNIVERSAL_RULES = [
  {
    id: 'research-before-code',
    text: 'RESEARCH BEFORE CODE: Web-search verify APIs, signatures, lib/model versions, and patterns against current docs/source before implementing (incl. external libraries). Architecture-first. Flag "UNVERIFIED" if unconfirmed. Never recommend without verification.',
    minLevel: 'solo'
  },
  {
    id: 'git-discipline',
    text: 'GIT DISCIPLINE: NEVER commit without asking user. NEVER push broken/untested code. Check secrets before staging. Describe what + why in every commit.',
    minLevel: 'solo'
  },
  {
    id: 'test-before-ship',
    text: 'TEST BEFORE SHIP: Every code change tested before marking complete. "It should work" NOT valid — run it, show output. Log results.',
    minLevel: 'solo'
  },
  {
    id: 'pre-completion',
    text: 'PRE-COMPLETION ANALYSIS: Before marking task complete — walk every changed code path, check missing imports/wrong types/edge cases, OWASP Top 10 on code touching user input/APIs. Fix before done.',
    minLevel: 'solo'
  },
  {
    id: 'verify-before-recommend',
    text: 'VERIFY BEFORE RECOMMEND: Never change agreed technical decision without asking user. If dependency unavailable/broken, STOP + present verified alternatives.',
    minLevel: 'solo'
  },
  {
    id: 'department-routing',
    text: 'DEPARTMENT ROUTING: Triage every task to the owning department subagent (architecture, backend, frontend, data, ML, security, DB, mobile, etc.) instead of doing specialist work in the main agent. Each specialist returns its POV backed by ground truth. Cross-department work goes to team-orchestrator first for the ordered chain + gates, then run each specialist in turn.',
    minLevel: 'solo'
  },
  {
    id: 'sdlc-loop',
    text: 'SDLC LOOP: Every change moves through requirements -> research/ground-truth -> design -> architecture-critique gate (facts, not opinion) -> implementation (hold ground source before code) -> test & verify (run, show output) -> review/gates -> release. Main agent owns the loop + gates; subagents execute single tasks. Size rigor to the task; never skip a phase.',
    minLevel: 'solo'
  },
  {
    id: 'anchor-sync',
    text: 'ANCHOR SYNC: Keep the local CLAUDE.md anchor (goal/stack/reqs/tasks) via `/enforce-init` as anti-drift ref; re-read before acting; sync anchor tasks with native tasks on every change.',
    minLevel: 'solo'
  },
  {
    id: 'clean-codebase',
    text: 'CLEAN CODEBASE: When editing existing code, delete superseded/dead code in the same change — no commented-out blocks, orphaned impls, or dup paths. Keep it clean.',
    minLevel: 'solo'
  },
  {
    id: 'living-docs',
    text: 'LIVING DOCS: Keep CLAUDE.md, architecture.md, progress.md current; re-read before acting, ask before creating a missing one. progress.md = `## Open Tasks`/`## Closed Tasks` (Closed only when verified). architecture.md = stack + workflow, updated with any stack/deps/data-flow change. Docs are part of "done."',
    minLevel: 'team'
  },
  {
    id: 'brainstorm-ground',
    text: 'BRAINSTORM + GROUND TRUTH: Weigh realistic options then commit to one, every option + choice backed by verified ground truth (doc/source/benchmark/test), never opinion. Subagents may raise concerns only when ground-truth-backed; they report to the main agent, which decides escalate-to-user vs resolve-in-loop. Never drop a grounded concern.',
    minLevel: 'team'
  },
  {
    id: 'session-documentation',
    text: 'SESSION DOCUMENTATION: Update session log — decisions, models verified, issues found/fixed, test results, cost estimates.',
    minLevel: 'team'
  },
  {
    id: 'parallel-execution',
    text: 'PARALLEL EXECUTION: Long-running tasks (>2min) MUST run as background subagents. Main agent NEVER idle. ALL inference/generation → background, ZERO exceptions.',
    minLevel: 'team'
  },
  {
    id: 'requirements-sync',
    text: 'REQUIREMENTS SYNC: Keep requirements.txt/pyproject.toml/package.json in sync with imports. Update when dependency added.',
    minLevel: 'team'
  },
  {
    id: 'dsa-efficiency',
    text: 'DSA EFFICIENCY: State Big-O + wall-clock on target hardware. Memory budget per pipeline stage. Design for streaming. Track P99, not averages.',
    minLevel: 'prod'
  },
  {
    id: 'full-security',
    text: 'FULL SECURITY: Auth ALL endpoints (API key/JWT/OAuth). Rate limit per user/IP. Validate all inputs. File upload: headers not extension. Prompt injection defense. Secrets via env vars/secret managers. DDoS protection. Never expose internal errors.',
    minLevel: 'prod'
  }
];

// ---------------------------------------------------------------------------
// Domain rule loading
// ---------------------------------------------------------------------------

/**
 * Read a domain rule file and filter lines by enforcement level.
 *
 * Domain rule files use severity tags: [WARN], [STRICT], [CRITICAL]
 * - solo: emit [WARN] rules only
 * - team: emit [WARN] + [STRICT]
 * - prod: emit all
 *
 * @param {string} domain - Domain name (e.g., 'ml-inference')
 * @param {string} level - Enforcement level
 * @param {string} pluginRoot - Plugin root directory
 * @returns {string|null} Filtered rule content or null
 */
function loadDomainRules(domain, level, pluginRoot) {
  const filePath = path.join(pluginRoot, 'rules', 'domains', domain + '.md');
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const levelNum = LEVEL_HIERARCHY[level] ?? 0;
  const lines = content.split('\n');
  const filtered = [];

  for (const line of lines) {
    // Check for severity tag
    const severityMatch = line.match(/\[(\w+)\]/);
    if (severityMatch) {
      const severity = severityMatch[1];
      const minLevel = SEVERITY_MIN_LEVEL[severity];
      if (minLevel && LEVEL_HIERARCHY[minLevel] > levelNum) {
        continue; // Skip rule — level too low
      }
    }
    filtered.push(line);
  }

  const raw = filtered.join('\n').trim();
  return compressRules(raw);
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

const MAX_BUDGET = 8192;          // 8KB total
const DOMAIN_BUDGET_EACH = 1024;  // 1KB per domain
const MAX_DOMAINS_IN_CONTEXT = 4; // v3: Hard cap to stay within budget (Change 10)

/**
 * Build the full context string emitted to stdout (becomes <system-reminder>).
 *
 * @param {string} level - Enforcement level ('solo', 'team', 'prod')
 * @param {Array<{domain: string, score: number}>} detectedDomains
 * @param {string} pluginRoot - Plugin root directory
 * @returns {string}
 */
function buildContext(level, detectedDomains, pluginRoot) {
  const parts = [];
  let usedBytes = 0;

  // Header
  let header = 'ENFORCE MODE ACTIVE — level: ' + level;
  if (detectedDomains.length > 0) {
    header += ' | domains: ' + detectedDomains.map(d => d.domain).join(', ');
  }
  parts.push(header);
  usedBytes += header.length;

  // Universal rules (filtered by level)
  const levelNum = LEVEL_HIERARCHY[level] ?? 0;
  let universalBlock = '## Universal Rules\n\n';
  for (const rule of UNIVERSAL_RULES) {
    const ruleMinNum = LEVEL_HIERARCHY[rule.minLevel] ?? 0;
    if (levelNum >= ruleMinNum) {
      const line = '- ' + rule.text + '\n';
      universalBlock += line;
    }
  }
  parts.push(universalBlock.trim());
  usedBytes += universalBlock.length;

  // Domain-specific rules (most confident first, budget-capped)
  // v3: Hard cap at MAX_DOMAINS_IN_CONTEXT to guarantee budget (Change 10)
  const cappedDomains = detectedDomains.slice(0, MAX_DOMAINS_IN_CONTEXT);
  if (cappedDomains.length > 0) {
    for (const { domain, score } of cappedDomains) {
      if (usedBytes >= MAX_BUDGET) break;

      const domainContent = loadDomainRules(domain, level, pluginRoot);
      if (!domainContent) continue;

      // Truncate to per-domain budget
      let truncated = domainContent;
      if (truncated.length > DOMAIN_BUDGET_EACH) {
        truncated = truncated.substring(0, DOMAIN_BUDGET_EACH) + '\n[truncated]';
      }

      parts.push(truncated);
      usedBytes += truncated.length;
    }
  }

  // Response efficiency directive — reduces output tokens per response.
  // Same approach as caveman but lighter: doesn't drop articles or use
  // fragments, just eliminates filler and unnecessary prose.
  const efficiency =
    '## Response Efficiency\n\n' +
    'Concise responses. Lead with answer/action, not reasoning. ' +
    'Drop filler (just/really/basically/actually). ' +
    'Skip restating user\'s question. Technical terms exact. Code unchanged. ' +
    'One sentence over three when possible.';
  parts.push(efficiency);

  // Persistence + controls
  const footer =
    '## Persistence\n\n' +
    'ALWAYS ACTIVE. Every response. No revert after many turns. No filler drift.\n' +
    'Off only: "stop enforce" / "normal mode" / `/enforce off`.\n' +
    'Switch level: `/enforce solo|team|prod`.\n\n' +
    '## Anti-Patterns (flag immediately)\n\n' +
    '- Citing "recent work shows..." without web search\n' +
    '- Saying "open-source" without confirming downloadable weights\n' +
    '- Swapping model/tool without asking user\n' +
    '- Writing code before understanding architecture\n' +
    '- O(n\u00B2) when O(n log n) exists\n' +
    '- Holding entire video in memory when streaming possible\n' +
    '- Open API endpoints in production\n' +
    '- Hardcoded secrets anywhere\n' +
    '- "It should work" without running tests';
  parts.push(footer);

  let output = parts.join('\n\n');

  // Hard budget cap — byte-accurate (multibyte chars like → and ² mean
  // char length underestimates UTF-8 byte size, so cap on bytes).
  const suffix = '\n\n[context budget reached]';
  if (Buffer.byteLength(output, 'utf8') > MAX_BUDGET) {
    let end = Math.min(output.length, MAX_BUDGET - suffix.length);
    while (end > 0 && Buffer.byteLength(output.slice(0, end) + suffix, 'utf8') > MAX_BUDGET) {
      end--;
    }
    output = output.slice(0, end) + suffix;
  }

  return output;
}

module.exports = {
  buildContext,
  loadDomainRules,
  UNIVERSAL_RULES,
  LEVEL_HIERARCHY,
  SEVERITY_MIN_LEVEL,
  MAX_BUDGET,
  DOMAIN_BUDGET_EACH
};
