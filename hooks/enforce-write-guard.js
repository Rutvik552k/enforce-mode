#!/usr/bin/env node
/**
 * enforce-write-guard.js — Phase 1 PreToolUse hook for Write|Edit|NotebookEdit
 *
 * TWO-PHASE ARCHITECTURE (Solution C):
 *   Phase 1 (this file): Detect issues → soft guidance + record to state file
 *   Phase 2 (enforce-stop-guard.js): Check compliance at response end
 *
 * ENFORCES:
 *   Rule #1, #6  — Research before code / Web-research mandate
 *   Rule #9, #37, #38 — Never hardcode secrets/tokens/credentials
 *   Rule #28-36 — Security: auth, rate limiting, input validation, etc.
 *
 * GATES:
 *   - Secrets detected → HARD BLOCK (exit 2) — secrets must never be written
 *   - No research → HARD DENY (permissionDecision:"deny") + retry guidance
 *   - Security anti-patterns → SOFT GUIDANCE (additionalContext)
 *
 * Zero deadlocks: deny+additionalContext gives Claude clear retry path.
 * Stdlib imports (fs, os, path, etc.) are whitelisted — no false positives.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
// SECRET DETECTION PATTERNS (inspired by gitleaks/secrets-patterns-db)
// High-precision regexes with known prefixes — minimize false positives
// ═══════════════════════════════════════════════════════════

const SECRET_PATTERNS = [
  // AWS
  { name: 'AWS Access Key', regex: /(?:^|['"=\s])(?:AKIA[0-9A-Z]{16})(?:$|['";\s])/ },
  { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/ },
  // GitHub
  { name: 'GitHub PAT', regex: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub OAuth', regex: /gho_[A-Za-z0-9]{36}/ },
  { name: 'GitHub App Token', regex: /(?:ghu|ghs)_[A-Za-z0-9]{36}/ },
  // Google
  { name: 'Google API Key', regex: /AIza[A-Za-z0-9_\\-]{35}/ },
  // Stripe
  { name: 'Stripe Live Key', regex: /sk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Stripe Publishable', regex: /pk_live_[A-Za-z0-9]{24,}/ },
  // Slack
  { name: 'Slack Token', regex: /xox[bporas]-[A-Za-z0-9-]{10,}/ },
  { name: 'Slack Webhook', regex: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  // Generic high-entropy secrets
  { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Generic Secret Assignment', regex: /(?:password|passwd|secret|token|api_key|apikey|api-key|auth_token)\s*[=:]\s*['"][A-Za-z0-9+/=_\-]{16,}['"]/ },
  // Database URIs
  { name: 'Database URI', regex: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@[^\s'"]+/ },
  // JWT
  { name: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/ },
  // Heroku
  { name: 'Heroku API Key', regex: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ },
  // SendGrid
  { name: 'SendGrid Key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  // Twilio
  { name: 'Twilio Key', regex: /SK[0-9a-fA-F]{32}/ },
];

// ═══════════════════════════════════════════════════════════
// SECURITY ANTI-PATTERN DETECTION
// ═══════════════════════════════════════════════════════════

const SECURITY_PATTERNS = [
  // Open endpoints without auth
  { name: 'Flask route without auth', regex: /@app\.route\(.*\)\s*\ndef\s+\w+\(/ },
  { name: 'Express open endpoint', regex: /app\.(get|post|put|delete|patch)\s*\(\s*['"]\//, severity: 'info' },
  { name: 'FastAPI no auth', regex: /@app\.(get|post|put|delete)\s*\(/, severity: 'info' },
  // SQL injection risk
  { name: 'SQL string concat', regex: /(?:execute|query)\s*\(\s*f?['"].*(?:SELECT|INSERT|UPDATE|DELETE).*\+|\.format\(/ },
  { name: 'SQL f-string', regex: /f['"](?:SELECT|INSERT|UPDATE|DELETE)\s+.*\{/ },
  // eval/exec risks
  { name: 'eval() usage', regex: /\beval\s*\(/ },
  { name: 'exec() usage', regex: /\bexec\s*\(/ },
  // Disabled security
  { name: 'SSL verify disabled', regex: /verify\s*=\s*False/ },
  { name: 'CORS allow all', regex: /(?:Access-Control-Allow-Origin|cors)\s*[:=]\s*['"]?\*['"]?/ },
];

// ═══════════════════════════════════════════════════════════
// RESEARCH CHECK (same as enforce-research-gate.js)
// ═══════════════════════════════════════════════════════════

const RESEARCH_TOOLS = [
  'WebSearch', 'WebFetch',
  'mcp__plugin_ecc_context7__query-docs',
  'mcp__plugin_ecc_context7__resolve-library-id',
  'mcp__plugin_ecc_exa__web_search_exa',
  'mcp__plugin_ecc_exa__web_fetch_exa',
];

const IMPORT_PATTERNS = [
  /^\s*(import|from)\s+\w+/m,       // Python: import X / from X
  /require\s*\(\s*['"]/m,            // JS: require('X') anywhere in line
  /^\s*import\s+.*from\s+['"]/m,    // JS/TS: import X from 'Y'
  /^\s*use\s+\w+::/m,               // Rust: use X::
  /^\s*extern\s+crate/m,            // Rust: extern crate
  /^\s*import\s+\(/m,               // Go: import (
];

const SKIP_EXTENSIONS = [
  '.json', '.toml', '.yaml', '.yml', '.md', '.txt', '.csv',
  '.lock', '.gitignore', '.env', '.cfg', '.ini', '.conf',
  '.png', '.jpg', '.gif', '.svg', '.ico',
];

// ═══════════════════════════════════════════════════════════
// STDLIB IMPORTS — these don't need web research verification
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
  // Extract import names from source
  const importNames = [];

  // Python: import X / from X import Y
  const pyImports = source.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gm);
  for (const m of pyImports) {
    importNames.push(m[1].split('.')[0].toLowerCase());
  }

  // JS/TS: require('X') / import ... from 'X'
  const jsRequires = source.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const m of jsRequires) {
    importNames.push(m[1].split('/')[0].toLowerCase());
  }
  const jsImports = source.matchAll(/import\s+.*from\s+['"]([^'"]+)['"]/g);
  for (const m of jsImports) {
    importNames.push(m[1].split('/')[0].toLowerCase());
  }

  if (importNames.length === 0) return true; // no imports found

  const allStdlib = [...NODE_STDLIB, ...PYTHON_STDLIB].map(s => s.toLowerCase());
  return importNames.every(name => allStdlib.includes(name));
}

// ═══════════════════════════════════════════════════════════
// CROSS-HOOK STATE (Phase 1 → state file → Phase 2)
// ═══════════════════════════════════════════════════════════

const { recordPending } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════
// CORE FUNCTIONS
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
  const found = [];
  for (const pat of SECRET_PATTERNS) {
    if (pat.regex.test(source)) {
      found.push(pat.name);
    }
  }
  return found;
}

function scanSecurity(source) {
  const found = [];
  for (const pat of SECURITY_PATTERNS) {
    if (pat.regex.test(source)) {
      found.push(pat.name);
    }
  }
  return found;
}

function checkResearch(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
    const content = fs.readFileSync(transcriptPath, 'utf8');
    return RESEARCH_TOOLS.some(tool => content.includes(tool));
  } catch {
    return false;
  }
}

// Paths exempt from research/DSA checks (avoids self-referential deadlock)
const EXEMPT_PATHS = [
  '.claude/hooks',
  '.claude\\hooks',
  'enforce-mode/hooks',
  'enforce-mode\\hooks',
  '/tests/',
  '\\tests\\',
  'test-',
  '.test.',
  '.spec.',
];

function isExemptPath(filePath) {
  if (!filePath) return false;
  return EXEMPT_PATHS.some(p => filePath.includes(p));
}

function isCodeFile(filePath) {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  return !SKIP_EXTENSIONS.includes(ext);
}

function hasImports(source) {
  return IMPORT_PATTERNS.some(p => p.test(source));
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const transcriptPath = input.transcript_path || '';

  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) {
    process.exit(0);
  }

  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';

  if (!source) process.exit(0);

  // ── CHECK 1: SECRET DETECTION (HARD BLOCK) ──
  const secrets = scanSecrets(source);
  if (secrets.length > 0) {
    process.stderr.write(
      '[ENFORCE HARD BLOCK] Secrets detected in code!\n' +
      'Rule #9, #37, #38: Never hardcode secrets, tokens, or credentials.\n\n' +
      'Detected:\n' +
      secrets.map(s => `  - ${s}`).join('\n') + '\n\n' +
      'Use environment variables or a secret manager instead.\n' +
      'Remove the secret and retry.'
    );
    process.exit(2);
  }

  // Skip non-code files and exempt paths (hooks, tests)
  if (!isCodeFile(filePath)) process.exit(0);
  if (isExemptPath(filePath)) process.exit(0);

  const sessionId = input.session_id || '';

  // ── CHECK 2: RESEARCH GATE (HARD DENY + RETRY GUIDANCE) ──
  // External imports without research → deny. Claude retries after WebSearch.
  // <10ms, unevadable. Stdlib (fs/os/path) whitelisted.
  if (hasImports(source) && !isStdlibOnly(source) && !checkResearch(transcriptPath)) {
    recordPending(sessionId, 'research', filePath, ['external imports detected']);

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'External library imports without web research',
        additionalContext:
          '[ENFORCE] Write denied — external imports need verification first.\n\n' +
          'File: ' + filePath + '\n\n' +
          'To unblock, do ONE of these BEFORE retrying the write:\n' +
          '  1. WebSearch for the library docs to verify current API signatures\n' +
          '  2. Use context7 docs lookup (mcp__plugin_ecc_context7__query-docs)\n' +
          '  3. WebFetch the official documentation URL\n\n' +
          'Then retry this exact write. It will pass once research is in the transcript.\n' +
          'Note: stdlib imports (fs, os, path, json, etc.) never trigger this gate.',
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  // ── CHECK 3: SECURITY SCAN (SOFT WARN) ──
  const secIssues = scanSecurity(source);
  if (secIssues.length > 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          '[ENFORCE SECURITY WARNING]\n' +
          secIssues.map(s => `  - ${s}`).join('\n') + '\n' +
          'Review: auth on endpoints, input validation, no SQL injection, no eval().',
      },
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
