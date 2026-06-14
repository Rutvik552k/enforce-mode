#!/usr/bin/env node
/**
 * enforce-write-guard.js — PreToolUse hook for Write|Edit|NotebookEdit (advisory)
 *
 * ADVISORY MODE: this guard NEVER blocks. It approves every write and injects
 * guidance as additionalContext (plus a stderr line for the user). No exit(2),
 * no permissionDecision:'deny', no PECK escalation ladder.
 *
 * CHECKS (all advisory — emitted as a single context payload):
 *   - Secrets detected           → strong advisory (do not commit; use a manager)
 *   - External imports w/o research → advisory (verify API signatures first)
 *   - Ungrounded API symbols     → advisory (UNVERIFIED — may be hallucinated)
 *   - Security anti-patterns     → advisory (review before saving)
 *
 * Level gating (advisory severity): STRICT advisories show at team+; ALWAYS at all.
 * Exemptions: enforce-mode/.claude hook files, skipped extensions, stdlib-only.
 * Accountability still flows to the Stop hook via recordPending().
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { recordPending, isActive, getLevel, peckTick, logEvent, isSkippedExtension, isExemptFilePath, getGroundTruth, getResearchedLibs } = require('./enforce-state');
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

const COMMON_LIBS = new Set([
  'express', 'react', 'react-dom', 'next', 'vue', 'angular',
  'lodash', 'underscore', 'axios', 'node-fetch', 'chalk',
  'dotenv', 'cors', 'helmet', 'morgan', 'body-parser',
  'jest', 'mocha', 'chai', 'vitest', 'prettier', 'eslint',
  'typescript', 'webpack', 'vite', 'rollup', 'esbuild',
  'pytest', 'flask', 'django', 'fastapi', 'requests',
  'numpy', 'pandas', 'matplotlib', 'click', 'pydantic',
  'black', 'flake8', 'mypy', 'pylint', 'setuptools', 'pip',
]);

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
  const normalized = importNames.map(name => name.startsWith('@') ? name.slice(1) : name);
  const external = [...new Set(normalized)].filter(
    name => !allStdlib.has(name) && !COMMON_LIBS.has(name) && !name.startsWith('.')
  );
  return external;
}

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

  const hasAnyResearch = RESEARCH_TOOLS.some(tool => content.includes(tool.toLowerCase()));
  if (!hasAnyResearch) {
    return { researched: [], unresearched: libs };
  }

  const researched = [];
  const unresearched = [];
  for (const lib of libs) {
    if (content.includes(lib)) researched.push(lib);
    else unresearched.push(lib);
  }
  return { researched, unresearched };
}

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

// ═══════════════════════════════════════════════════════════
// ADVISORY EMISSION (approve + inject context — never blocks)
// ═══════════════════════════════════════════════════════════

// Advisory severity → minimum level (mirrors enforce-rules SEVERITY_MIN_LEVEL).
const LVL = { solo: 0, team: 1, prod: 2 };
const SEV_MIN = { ALWAYS: 0, WARN: 0, STRICT: 1, CRITICAL: 2 };
function severityActive(severity, level) {
  return (LVL[level] ?? 0) >= (SEV_MIN[severity] ?? 0);
}

// Emit one approve + additionalContext payload (dual output), then exit 0.
function emitAdvisory(message) {
  process.stderr.write('[WRITE-GUARD] ' + message + '\n');
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message } };
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

  peckTick(sessionId);

  // ── CHECK 1: SECRETS (advisory, always — even on exempt paths) ──
  const secrets = scanSecrets(source);
  if (secrets.length > 0) {
    logEvent(sessionId, { hook: 'write-guard', action: 'warn', file: filePath, result: 'secrets', details: { types: secrets } });
    emitAdvisory(
      'SECRETS DETECTED — do NOT write or commit these literal values:\n' +
      secrets.map(s => `  - ${s}`).join('\n') + '\n\n' +
      'Use environment variables or a secret manager. Replace the value before saving.'
    );
    return;
  }

  // Skip non-code and exempt paths for remaining checks
  if (!isCodeFile(filePath) || isExemptFilePath(filePath)) process.exit(0);

  const level = (sessionId && getLevel(sessionId)) || 'solo';
  const outParts = [];

  // ── CHECK 2: RESEARCH / GROUNDING ──
  if (hasImports(source) && !isStdlibOnly(source)) {
    const externalLibs = extractExternalLibs(source);

    if (externalLibs.length > 0) {
      const GT_TTL_MS = 30 * 60 * 1000;
      const withTruth = [];
      const withoutTruth = [];
      for (const lib of externalLibs) {
        const gt = getGroundTruth(sessionId, lib);
        if (gt && (Date.now() - gt.ts) < GT_TTL_MS) withTruth.push(lib);
        else withoutTruth.push(lib);
      }

      const stillMissing = [];
      if (withoutTruth.length > 0) {
        const { researched } = checkResearchForLibs(transcriptPath, withoutTruth);
        for (const lib of withoutTruth) {
          if (researched.includes(lib)) withTruth.push(lib);
          else stillMissing.push(lib);
        }
      }

      // Unresearched libraries → advisory (recorded for the Stop-hook reminder).
      if (stillMissing.length > 0) {
        recordPending(sessionId, 'research', filePath, stillMissing);
        const libList = stillMissing.slice(0, 5).join(', ');
        const more = stillMissing.length > 5 ? ' (+' + (stillMissing.length - 5) + ' more)' : '';
        logEvent(sessionId, { hook: 'write-guard', action: 'warn', file: filePath, result: 'research-missing', details: { missing: stillMissing, researched: withTruth } });
        emitAdvisory(
          'GROUND TRUTH MISSING — libraries used without research: ' + libList + more + '\n' +
          'File: ' + filePath + '\n\n' +
          'Recommended: WebSearch/context7 each library and verify API signatures before relying on this code.' +
          (withTruth.length > 0 ? '\nAlready researched: ' + withTruth.join(', ') : '')
        );
        return;
      }

      // ── CHECK 2b: SYMBOL GROUNDING (advisory; STRICT → team+) ──
      const allSnippets = withTruth
        .map(lib => getGroundTruth(sessionId, lib))
        .filter(Boolean)
        .flatMap(gt => gt.snippets || [])
        .join(' ');

      const symbols = extractApiSymbols(source);
      const { ungrounded } = groundSymbols(symbols, allSnippets);
      const highUngrounded = ungrounded.filter(s => s.confidence === 'HIGH');

      if (allSnippets.length > 0 && highUngrounded.length > 0 && severityActive('STRICT', level)) {
        const symList = highUngrounded.slice(0, 5).map(s => s.full + '()').join(', ');
        const more = highUngrounded.length > 5 ? ' (+' + (highUngrounded.length - 5) + ' more)' : '';
        logEvent(sessionId, { hook: 'write-guard', action: 'warn', file: filePath, result: 'grounding', details: { ungrounded: highUngrounded.map(s => s.full) } });
        outParts.push(
          'UNVERIFIED API symbols — called but NOT found in any researched docs: ' + symList + more + '\n' +
          'File: ' + filePath + '\n\n' +
          'These specific methods have no source — they may be hallucinated.\n' +
          'Recommended: WebSearch/context7 the exact symbol(s) to confirm they exist, OR tag each\n' +
          '`// UNVERIFIED: <symbol>` and tell the user it is from training memory, not verified docs.'
        );
      }

      // Inject researched-doc snippets as helpful context.
      const snippetContext = [];
      for (const lib of withTruth.slice(0, 3)) {
        const gt = getGroundTruth(sessionId, lib);
        if (gt && gt.snippets && gt.snippets.length > 0) {
          snippetContext.push('[' + lib + '] ' + gt.snippets[0].substring(0, 200));
        }
      }
      if (snippetContext.length > 0) {
        outParts.push('[GROUND TRUTH] Relevant docs for your code:\n' + snippetContext.join('\n'));
      }
    }
  }

  // ── CHECK 3: SECURITY SCAN (advisory; STRICT → team+) ──
  const secIssues = scanSecurity(source);
  if (secIssues.length > 0 && severityActive('STRICT', level)) {
    logEvent(sessionId, { hook: 'write-guard', action: 'warn', file: filePath, result: 'security', details: { issues: secIssues } });
    outParts.push(
      'Security anti-patterns detected:\n' +
      secIssues.map(s => `  - ${s}`).join('\n') + '\n' +
      'File: ' + filePath + '\nReview and fix before saving.'
    );
  }

  if (outParts.length > 0) emitAdvisory(outParts.join('\n\n'));
  process.exit(0);
}

main().catch(() => process.exit(0));
