#!/usr/bin/env node
/**
 * enforce-write-guard.js — PreToolUse hook for Write|Edit|NotebookEdit (v5 PECK)
 *
 * PECK: Progressive Escalation with Circuit-breaker and K-step recovery
 *
 * GATES:
 *   - Secrets detected → HARD BLOCK (exit 2) — always, no escalation
 *   - External imports without research → PECK escalation (tier 0→3)
 *   - Security anti-patterns → PECK escalation via 'security' category
 *
 * TIERS:
 *   0: APPROVE + advisory context
 *   1: APPROVE + strong warning with escalation notice
 *   2: DENY (1 retry before auto-escalate)
 *   3: HARD BLOCK (exit 2, terminates retry loop)
 *
 * DEADLOCK PREVENTION:
 *   - Tier 2 (deny) bounded — max 1 retry before tier 3 hard-block
 *   - Circuit breaker opens after 3 failures → all actions hard-blocked
 *   - Self-exemption: .claude/hooks/, enforce-mode/hooks/, test files
 *   - Stdlib whitelist: never triggers research gate
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { recordPending, isActive, getLevel, peckEvaluateV2, peckTick, peckRecordComplianceV2, logEvent, isSkippedExtension, isExemptFilePath, getGroundTruth, getResearchedLibs } = require('./enforce-state');
const { extractApiSymbols, groundSymbols } = require('./enforce-grounding');

// ═══════════════════════════════════════════════════════════
// SECRET DETECTION (high-precision, known prefixes only)
// ═══════════════════════════════════════════════════════════

const SECRET_PATTERNS = [
  { name: 'AWS Access Key', regex: /(?:^|['"=\s])(?:AKIA[0-9A-Z]{16})(?:$|['";\s])/ },
  { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/ },
  { name: 'GitHub PAT', regex: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub OAuth', regex: /gho_[A-Za-z0-9]{36}/ },
  { name: 'GitHub App Token', regex: /(?:ghu|ghs)_[A-Za-z0-9]{36}/ },
  { name: 'Google API Key', regex: /AIza[A-Za-z0-9_\\-]{35}/ },
  { name: 'Stripe Live Key', regex: /sk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Stripe Publishable', regex: /pk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Slack Token', regex: /xox[bporas]-[A-Za-z0-9-]{10,}/ },
  { name: 'Slack Webhook', regex: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Generic Secret Assignment', regex: /(?:password|passwd|secret|token|api_key|apikey|api-key|auth_token)\s*[=:]\s*['"][A-Za-z0-9+/=_\-]{16,}['"]/ },
  { name: 'Database URI', regex: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@[^\s'"]+/ },
  { name: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/ },
  { name: 'Heroku API Key', regex: /(?:HEROKU_API_KEY|heroku.*api.*key)\s*[=:]\s*['"]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]?/i },
  { name: 'SendGrid Key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  { name: 'Twilio Key', regex: /SK[0-9a-fA-F]{32}/ },
];

// ═══════════════════════════════════════════════════════════
// SECURITY ANTI-PATTERNS
// ═══════════════════════════════════════════════════════════

const SECURITY_PATTERNS = [
  // Tightened: require function def after route decorator (multiline handled by source scan)
  { name: 'SQL string concat', regex: /(?:execute|query)\s*\(\s*f?['"].*(?:SELECT|INSERT|UPDATE|DELETE).*\+/ },
  { name: 'SQL f-string', regex: /f['"](?:SELECT|INSERT|UPDATE|DELETE)\s+.*\{/ },
  { name: 'eval() usage', regex: /\beval\s*\([^)]+\)/ },
  { name: 'SSL verify disabled', regex: /verify\s*=\s*False/ },
  { name: 'CORS allow all', regex: /(?:Access-Control-Allow-Origin|allowedOrigins?)\s*[:=]\s*['"]?\*['"]?/ },
];

// ═══════════════════════════════════════════════════════════
// RESEARCH CHECK
// ═══════════════════════════════════════════════════════════

const RESEARCH_TOOLS = [
  'WebSearch', 'WebFetch',
  'mcp__plugin_ecc_context7__query-docs',
  'mcp__plugin_ecc_context7__resolve-library-id',
  'mcp__plugin_ecc_exa__web_search_exa',
  'mcp__plugin_ecc_exa__web_fetch_exa',
];

const IMPORT_PATTERNS = [
  /^\s*(import|from)\s+\w+/m,
  /require\s*\(\s*['"]/m,
  /^\s*import\s+.*from\s+['"]/m,
  /^\s*use\s+\w+::/m,
  /^\s*extern\s+crate/m,
  /^\s*import\s+\(/m,
];

// SKIP_EXTENSIONS: now centralized in enforce-state.js (isSkippedExtension)

// ═══════════════════════════════════════════════════════════
// STDLIB WHITELIST
// ═══════════════════════════════════════════════════════════

const NODE_STDLIB = [
  'fs', 'path', 'os', 'http', 'https', 'url', 'util', 'crypto',
  'stream', 'events', 'child_process', 'assert', 'buffer', 'net',
  'tls', 'dns', 'cluster', 'zlib', 'readline', 'querystring',
  'string_decoder', 'timers', 'vm', 'worker_threads', 'perf_hooks',
  'node:fs', 'node:path', 'node:os', 'node:http', 'node:https',
  'node:url', 'node:util', 'node:crypto', 'node:stream',
];

const PYTHON_STDLIB = [
  'os', 'sys', 'json', 're', 'math', 'time', 'datetime',
  'pathlib', 'collections', 'functools', 'itertools', 'typing',
  'hashlib', 'io', 'logging', 'subprocess', 'shutil', 'tempfile',
  'unittest', 'argparse', 'copy', 'abc', 'enum', 'dataclasses',
  'contextlib', 'textwrap', 'struct', 'socket', 'http', 'urllib',
];

function isStdlibOnly(source) {
  const importNames = [];
  for (const m of source.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gm)) {
    importNames.push(m[1].split('.')[0].toLowerCase());
  }
  for (const m of source.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    importNames.push(m[1].split('/')[0].toLowerCase());
  }
  for (const m of source.matchAll(/import\s+.*from\s+['"]([^'"]+)['"]/g)) {
    importNames.push(m[1].split('/')[0].toLowerCase());
  }
  if (importNames.length === 0) return true;
  const allStdlib = [...NODE_STDLIB, ...PYTHON_STDLIB].map(s => s.toLowerCase());
  return importNames.every(name => allStdlib.includes(name));
}

// ═══════════════════════════════════════════════════════════
// PER-LIBRARY RESEARCH TRACKING
// ═══════════════════════════════════════════════════════════

// Common well-known libraries that don't need research verification
const COMMON_LIBS = new Set([
  // JS ecosystem
  'express', 'react', 'react-dom', 'next', 'vue', 'angular',
  'lodash', 'underscore', 'axios', 'node-fetch', 'chalk',
  'dotenv', 'cors', 'helmet', 'morgan', 'body-parser',
  'jest', 'mocha', 'chai', 'vitest', 'prettier', 'eslint',
  'typescript', 'webpack', 'vite', 'rollup', 'esbuild',
  // Python ecosystem
  'pytest', 'flask', 'django', 'fastapi', 'requests',
  'numpy', 'pandas', 'matplotlib', 'click', 'pydantic',
  'black', 'flake8', 'mypy', 'pylint', 'setuptools', 'pip',
]);

/**
 * Extract external (non-stdlib, non-common) library names from source.
 * @param {string} source
 * @returns {string[]} unique external library names
 */
function extractExternalLibs(source) {
  const importNames = [];
  for (const m of source.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gm)) {
    importNames.push(m[1].split('.')[0].toLowerCase());
  }
  for (const m of source.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    importNames.push(m[1].split('/')[0].toLowerCase());
  }
  for (const m of source.matchAll(/import\s+.*from\s+['"]([^'"]+)['"]/g)) {
    importNames.push(m[1].split('/')[0].toLowerCase());
  }
  const allStdlib = new Set([...NODE_STDLIB, ...PYTHON_STDLIB].map(s => s.toLowerCase()));
  // Normalize scoped packages: @prisma/client → prisma
  const normalized = importNames.map(name =>
    name.startsWith('@') ? name.slice(1) : name
  );
  const external = [...new Set(normalized)].filter(
    name => !allStdlib.has(name) && !COMMON_LIBS.has(name) && !name.startsWith('.')
  );
  return external;
}

/**
 * Check transcript for per-library research evidence.
 * Returns { researched: string[], unresearched: string[] }
 * @param {string} transcriptPath
 * @param {string[]} libs — external library names to check
 * @returns {{ researched: string[], unresearched: string[] }}
 */
function checkResearchForLibs(transcriptPath, libs) {
  if (!libs.length) return { researched: [], unresearched: [] };
  let content = '';
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      return { researched: [], unresearched: libs };
    }
    content = fs.readFileSync(transcriptPath, 'utf8').toLowerCase();
  } catch {
    return { researched: [], unresearched: libs };
  }

  // Must have at least one research tool used
  const hasAnyResearch = RESEARCH_TOOLS.some(tool => content.includes(tool.toLowerCase()));
  if (!hasAnyResearch) {
    return { researched: [], unresearched: libs };
  }

  const researched = [];
  const unresearched = [];
  for (const lib of libs) {
    // Check if library name appears in transcript (in search queries, URLs, etc.)
    if (content.includes(lib)) {
      researched.push(lib);
    } else {
      unresearched.push(lib);
    }
  }
  return { researched, unresearched };
}

// ═══════════════════════════════════════════════════════════
// SELF-EXEMPTION
// ═══════════════════════════════════════════════════════════

// EXEMPT_PATHS: now centralized in enforce-state.js (isExemptFilePath)

// ═══════════════════════════════════════════════════════════
// CORE
// ═══════════════════════════════════════════════════════════

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

function scanSecrets(source) {
  return SECRET_PATTERNS.filter(p => p.regex.test(source)).map(p => p.name);
}

function scanSecurity(source) {
  return SECURITY_PATTERNS.filter(p => p.regex.test(source)).map(p => p.name);
}

function checkResearch(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
    const content = fs.readFileSync(transcriptPath, 'utf8');
    return RESEARCH_TOOLS.some(tool => content.includes(tool));
  } catch { return false; }
}

function isCodeFile(fp) {
  return fp && !isSkippedExtension(fp);
}

function hasImports(source) {
  return IMPORT_PATTERNS.some(p => p.test(source));
}

/**
 * Build PECK-tier-aware hook output.
 * Tier 0-1: approve + additionalContext
 * Tier 2:   deny + permissionDecisionReason
 * Tier 3:   stderr + exit 2
 */
function emitPeckResult(result) {
  if (result.tier >= 3) {
    process.stderr.write(result.message);
    process.exit(2);
  }

  if (result.tier === 2) {
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: result.message }};
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

  // Tier 0 or 1: approve + dual output (stderr for user, context for Claude)
  process.stderr.write('[WRITE-GUARD] ' + result.message + '\n');
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: result.message }};
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const transcriptPath = input.transcript_path || '';

  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const sessionId = input.session_id || '';
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';

  if (!source) process.exit(0);

  // Tick PECK recovery windows on every tool call
  peckTick(sessionId);

  // ── CHECK 1: SECRETS (always, even on exempt paths) ──
  const secrets = scanSecrets(source);
  if (secrets.length > 0) {
    logEvent(sessionId, { hook: 'write-guard', action: 'block', file: filePath, result: 'secrets', details: { types: secrets } });
    process.stderr.write(
      '[ENFORCE HARD BLOCK] Secrets detected!\n' +
      'Detected:\n' + secrets.map(s => `  - ${s}`).join('\n') + '\n\n' +
      'Use environment variables or a secret manager. Remove and retry.'
    );
    process.exit(2);
  }

  // Skip non-code and exempt paths for remaining checks
  if (!isCodeFile(filePath) || isExemptFilePath(filePath)) process.exit(0);

  const level = (sessionId && getLevel(sessionId)) || 'solo';

  // ── CHECK 2: RESEARCH GATE (ground truth + immediate deny) ──
  if (hasImports(source) && !isStdlibOnly(source)) {
    const externalLibs = extractExternalLibs(source);

    if (externalLibs.length > 0) {
      // Check ground truth (captured search results) per library
      // TTL: ground truth expires after 30 minutes — forces re-search
      const GT_TTL_MS = 30 * 60 * 1000;
      const withTruth = [];
      const withoutTruth = [];
      for (const lib of externalLibs) {
        const gt = getGroundTruth(sessionId, lib);
        if (gt && (Date.now() - gt.ts) < GT_TTL_MS) {
          withTruth.push(lib);
        } else {
          withoutTruth.push(lib);
        }
      }

      // Fallback: also check transcript for library mentions (backward compat)
      const stillMissing = [];
      if (withoutTruth.length > 0) {
        const { researched } = checkResearchForLibs(transcriptPath, withoutTruth);
        for (const lib of withoutTruth) {
          if (researched.includes(lib)) {
            withTruth.push(lib);
          } else {
            stillMissing.push(lib);
          }
        }
      }

      if (stillMissing.length > 0) {
        recordPending(sessionId, 'research', filePath, stillMissing);

        const libList = stillMissing.slice(0, 5).join(', ');
        const more = stillMissing.length > 5 ? ' (+' + (stillMissing.length - 5) + ' more)' : '';
        const reason =
          'GROUND TRUTH MISSING — libraries used without research: ' + libList + more + '\n' +
          'File: ' + filePath + '\n\n' +
          'REQUIRED: WebSearch/context7 for each library BEFORE writing code.\n' +
          'Search for docs, verify API signatures, then write.' +
          (withTruth.length > 0 ? '\nAlready researched: ' + withTruth.join(', ') : '');

        // research-mandatory: budget=1 → first violation = immediate T2 deny
        const result = peckEvaluateV2(sessionId, 'research-mandatory', filePath, reason, {
          confidence: 'HIGH',
          severity: 'ALWAYS',
          level,
          source: '',       // skip context detection — always enforce
          matchIndex: -1,
          domainActive: true,
          patternName: 'research-mandatory-' + stillMissing[0],
        });
        if (result.suppressed || !result.message) { process.exit(0); }
        logEvent(sessionId, { hook: 'write-guard', action: 'escalate', file: filePath, result: 'research-mandatory-tier' + result.tier, details: { missing: stillMissing, researched: withTruth } });
        emitPeckResult(result);
        return;
      }

      // ── CHECK 2b: SYMBOL GROUNDING (citation-attribution layer) ──
      // Research happened at the library level — now verify the specific API
      // symbols the code calls actually appear in the researched docs. A symbol
      // with no source is UNVERIFIED (likely hallucinated signature).
      // Conditional firing: only runs when ground truth exists to check against,
      // so it never second-guesses code for un-researched libs (FP control).
      const allSnippets = withTruth
        .map(lib => getGroundTruth(sessionId, lib))
        .filter(Boolean)
        .flatMap(gt => gt.snippets || [])
        .join(' ');

      const symbols = extractApiSymbols(source);
      const { ungrounded } = groundSymbols(symbols, allSnippets);
      // Only escalate HIGH-confidence ungrounded symbols (deep SDK-style chains).
      const highUngrounded = ungrounded.filter(s => s.confidence === 'HIGH');

      let groundingAdvisory = '';   // tier 0-1 message, injected alongside snippets
      if (allSnippets.length > 0 && highUngrounded.length > 0) {
        const symList = highUngrounded.slice(0, 5).map(s => s.full + '()').join(', ');
        const more = highUngrounded.length > 5 ? ' (+' + (highUngrounded.length - 5) + ' more)' : '';
        const gReason =
          'UNVERIFIED API symbols — called but NOT found in any researched docs: ' + symList + more + '\n' +
          'File: ' + filePath + '\n\n' +
          'You researched the library but these specific methods have no source. They may be hallucinated.\n' +
          'REQUIRED: WebSearch/context7 the exact symbol(s) to confirm they exist, OR tag each as\n' +
          '`// UNVERIFIED: <symbol>` and tell the user it is from training memory, not verified docs.';

        // STRICT severity → suppressed at solo, max T2 at team/prod (never permanent block).
        const gResult = peckEvaluateV2(sessionId, 'grounding', filePath, gReason, {
          confidence: 'MEDIUM',
          severity: 'STRICT',
          level,
          source,
          matchIndex: -1,
          domainActive: true,
          patternName: 'grounding-' + highUngrounded[0].full,
        });
        if (!gResult.suppressed && gResult.message) {
          logEvent(sessionId, { hook: 'write-guard', action: 'escalate', file: filePath, result: 'grounding-tier' + gResult.tier, details: { ungrounded: highUngrounded.map(s => s.full) } });
          // Deny/block (tier >= 2) terminates the write here.
          if (gResult.tier >= 2) { emitPeckResult(gResult); return; }
          // Advisory (tier 0-1): carry the message into the context injected below.
          groundingAdvisory = gResult.message;
        }
      } else {
        // All called symbols are grounded → grounding compliance (decays prior violations).
        peckRecordComplianceV2(sessionId, 'grounding', filePath, 'MEDIUM');
      }

      // All libs have ground truth — inject snippets (+ any grounding advisory) as context.
      const snippetContext = [];
      for (const lib of withTruth.slice(0, 3)) {
        const gt = getGroundTruth(sessionId, lib);
        if (gt && gt.snippets && gt.snippets.length > 0) {
          snippetContext.push('[' + lib + '] ' + gt.snippets[0].substring(0, 200));
        }
      }
      if (snippetContext.length > 0 || groundingAdvisory) {
        const parts = [];
        if (groundingAdvisory) parts.push(groundingAdvisory);
        if (snippetContext.length > 0) {
          parts.push('[GROUND TRUTH] Relevant docs for your code:\n' + snippetContext.join('\n'));
        }
        const ctxMsg = parts.join('\n\n');
        process.stderr.write('[WRITE-GUARD] ' + ctxMsg + '\n');
        // Inject as additional context so Claude sees docs (and any UNVERIFIED flag).
        const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
          additionalContext: ctxMsg }};
        process.stdout.write(JSON.stringify(out));
        // Don't exit — continue to security checks
      }

      peckRecordComplianceV2(sessionId, 'research-mandatory', filePath, 'HIGH');
      peckRecordComplianceV2(sessionId, 'research', filePath, 'MEDIUM');
    } else if (checkResearch(transcriptPath)) {
      peckRecordComplianceV2(sessionId, 'research', filePath, 'MEDIUM');
    }
  }

  // ── CHECK 3: SECURITY SCAN (PECK v2 escalation) ──
  const secIssues = scanSecurity(source);
  if (secIssues.length > 0) {
    const reason =
      'Security anti-patterns detected:\n' +
      secIssues.map(s => `  - ${s}`).join('\n') + '\n' +
      'File: ' + filePath;

    const result = peckEvaluateV2(sessionId, 'security-patterns', filePath, reason, {
      confidence: 'MEDIUM',
      severity: 'STRICT',
      level,
      source,
      matchIndex: -1,
      domainActive: true,
      patternName: 'security-' + secIssues[0].replace(/\s+/g, '-').toLowerCase(),
    });
    if (result.suppressed || !result.message) { process.exit(0); }
    logEvent(sessionId, { hook: 'write-guard', action: 'escalate', file: filePath, result: 'security-tier' + result.tier, details: { issues: secIssues } });
    emitPeckResult(result);
    return;
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
