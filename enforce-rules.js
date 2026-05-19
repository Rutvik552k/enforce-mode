#!/usr/bin/env node
/**
 * enforce-mode — rule registry, level filtering, and context budget manager
 *
 * Assembles the final output string from universal rules + domain-specific
 * rule files. Respects enforcement levels (solo/team/prod) and an 8KB
 * context budget to avoid eating Claude's context window.
 */

'use strict';

const fs = require('fs');
const path = require('path');

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
    text: 'RESEARCH BEFORE CODE: Web-search to verify APIs, function signatures, and library versions before implementing. Architecture-first — understand before coding. Never recommend a model/tool without web-search verification.',
    minLevel: 'solo'
  },
  {
    id: 'git-discipline',
    text: 'GIT DISCIPLINE: NEVER commit without asking the user first. NEVER push broken or untested code. Check for secrets before staging. Describe what changed and why in every commit.',
    minLevel: 'solo'
  },
  {
    id: 'test-before-ship',
    text: 'TEST BEFORE SHIP: Every code change must be tested on actual hardware before marking complete. "It should work" is NOT a valid test result — run it and show the output. Log test results.',
    minLevel: 'solo'
  },
  {
    id: 'pre-completion',
    text: 'PRE-COMPLETION ANALYSIS: Before marking ANY task complete — walk every changed code path, check for missing imports/wrong types/edge cases, run OWASP Top 10 checklist on code touching user input or APIs. Fix issues before declaring done.',
    minLevel: 'solo'
  },
  {
    id: 'web-research',
    text: 'WEB-RESEARCH MANDATE: Before writing implementation code for any external library or model, search the web for current docs, verify function signatures against actual source, flag "UNVERIFIED" if API pattern cannot be confirmed.',
    minLevel: 'solo'
  },
  {
    id: 'verify-before-recommend',
    text: 'VERIFY BEFORE RECOMMEND: Never change an agreed-upon technical decision without asking the user first. If a dependency is unavailable or broken, STOP and present verified alternatives.',
    minLevel: 'solo'
  },
  {
    id: 'session-documentation',
    text: 'SESSION DOCUMENTATION: Update session log with decisions made, models verified, issues found/fixed, test results, and cost estimates. Keep docs current.',
    minLevel: 'team'
  },
  {
    id: 'parallel-execution',
    text: 'PARALLEL EXECUTION: Long-running tasks (>2min) MUST run as background subagents or background bash. Main agent NEVER sits idle — always do productive parallel work. ALL inference/generation tasks → background subagent, ZERO exceptions.',
    minLevel: 'team'
  },
  {
    id: 'requirements-sync',
    text: 'REQUIREMENTS SYNC: Keep requirements.txt / pyproject.toml / package.json in sync with all imports. Update whenever a new dependency is added.',
    minLevel: 'team'
  },
  {
    id: 'dsa-efficiency',
    text: 'DSA EFFICIENCY: State Big-O for core operations + wall-clock estimate on target hardware. Calculate memory budget per pipeline stage. Design for streaming where possible. Track P99 latency, not just averages.',
    minLevel: 'prod'
  },
  {
    id: 'full-security',
    text: 'FULL SECURITY: Auth on ALL endpoints (API key/JWT/OAuth). Rate limiting per user/IP. Input validation on all user inputs. File upload: validate headers not just extension. Prompt injection defense. Secrets via env vars or secret managers. DDoS protection. Never expose internal errors to users.',
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

  return filtered.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

const MAX_BUDGET = 8192;          // 8KB total
const DOMAIN_BUDGET_EACH = 1024;  // 1KB per domain

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
  if (detectedDomains.length > 0) {
    for (const { domain, score } of detectedDomains) {
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

  // Hard budget cap
  if (output.length > MAX_BUDGET) {
    output = output.substring(0, MAX_BUDGET - 30) + '\n\n[context budget reached]';
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
