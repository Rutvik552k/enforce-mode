#!/usr/bin/env node
/**
 * enforce-write-guard.js — PreToolUse hook for Write|Edit|NotebookEdit (v3)
 *
 * GATES:
 *   - Secrets detected → HARD BLOCK (exit 2)
 *   - External imports, no research, transcript available → deny + retry guidance
 *   - External imports, no transcript → soft warn (prevents infinite deny)
 *   - Security anti-patterns → soft warn
 *
 * DEADLOCK PREVENTION:
 *   - Self-exemption: .claude/hooks/, enforce-mode/hooks/, test files
 *   - Stdlib whitelist: fs/os/path/json etc. never trigger research gate
 *   - Empty transcript fallback: soft warn instead of deny
 *   - Heroku regex narrowed: requires HEROKU_API_KEY context, not bare UUIDs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { recordPending, isActive } = require('./enforce-state');

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
  // FIX #4: require HEROKU_API_KEY context — bare UUIDs no longer match
  { name: 'Heroku API Key', regex: /(?:HEROKU_API_KEY|heroku.*api.*key)\s*[=:]\s*['"]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]?/i },
  { name: 'SendGrid Key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  { name: 'Twilio Key', regex: /SK[0-9a-fA-F]{32}/ },
];

// ═══════════════════════════════════════════════════════════
// SECURITY ANTI-PATTERNS (soft warn only)
// ═══════════════════════════════════════════════════════════

const SECURITY_PATTERNS = [
  { name: 'Flask route without auth', regex: /@app\.route\(.*\)\s*\ndef\s+\w+\(/ },
  { name: 'Express open endpoint', regex: /app\.(get|post|put|delete|patch)\s*\(\s*['"]\// },
  { name: 'FastAPI no auth', regex: /@app\.(get|post|put|delete)\s*\(/ },
  { name: 'SQL string concat', regex: /(?:execute|query)\s*\(\s*f?['"].*(?:SELECT|INSERT|UPDATE|DELETE).*\+|\.format\(/ },
  { name: 'SQL f-string', regex: /f['"](?:SELECT|INSERT|UPDATE|DELETE)\s+.*\{/ },
  { name: 'eval() usage', regex: /\beval\s*\(/ },
  { name: 'exec() usage', regex: /\bexec\s*\(/ },
  { name: 'SSL verify disabled', regex: /verify\s*=\s*False/ },
  { name: 'CORS allow all', regex: /(?:Access-Control-Allow-Origin|cors)\s*[:=]\s*['"]?\*['"]?/ },
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

const SKIP_EXTENSIONS = [
  '.json', '.toml', '.yaml', '.yml', '.md', '.txt', '.csv',
  '.lock', '.gitignore', '.env', '.cfg', '.ini', '.conf',
  '.png', '.jpg', '.gif', '.svg', '.ico',
];

// ═══════════════════════════════════════════════════════════
// STDLIB WHITELIST — never trigger research gate
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
// SELF-EXEMPTION — prevent self-referential deadlock
// ═══════════════════════════════════════════════════════════

const EXEMPT_PATHS = [
  '.claude/hooks', '.claude\\hooks',
  'enforce-mode/hooks', 'enforce-mode\\hooks',
  '/tests/', '\\tests\\', 'test-', '.test.', '.spec.',
];

function isExemptPath(fp) {
  return fp && EXEMPT_PATHS.some(p => fp.includes(p));
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
  return fp && !SKIP_EXTENSIONS.includes(path.extname(fp).toLowerCase());
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

  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) process.exit(0);

  // Per-session isolation: skip if enforce is off for THIS session
  const sessionId = input.session_id || '';
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';

  if (!source) process.exit(0);

  // ── CHECK 1: SECRETS (always, even on exempt paths) ──
  const secrets = scanSecrets(source);
  if (secrets.length > 0) {
    process.stderr.write(
      '[ENFORCE HARD BLOCK] Secrets detected!\n' +
      'Detected:\n' + secrets.map(s => `  - ${s}`).join('\n') + '\n\n' +
      'Use environment variables or a secret manager. Remove and retry.'
    );
    process.exit(2);
  }

  // Skip non-code and exempt paths for remaining checks
  if (!isCodeFile(filePath) || isExemptPath(filePath)) process.exit(0);

  // ── CHECK 2: RESEARCH GATE ──
  if (hasImports(source) && !isStdlibOnly(source) && !checkResearch(transcriptPath)) {
    recordPending(sessionId, 'research', filePath, ['external imports detected']);

    // FIX #5: no transcript → soft warn (prevents infinite deny loop)
    if (!transcriptPath) {
      const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
        additionalContext: '[ENFORCE WARNING] External imports detected but transcript unavailable.\nVerify APIs via WebSearch before relying on training knowledge.\nFile: ' + filePath }};
      process.stdout.write(JSON.stringify(out));
      process.exit(0);
    }

    // Transcript available but no research → hard deny with retry path
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'External library imports without web research',
      additionalContext:
        '[ENFORCE] Write denied — external imports need verification.\n\n' +
        'File: ' + filePath + '\n\n' +
        'To unblock, do ONE first:\n' +
        '  1. WebSearch for the library docs\n' +
        '  2. context7 docs lookup\n' +
        '  3. WebFetch official docs\n\n' +
        'Then retry. Stdlib (fs/os/path/json) never triggers this.' }};
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

  // ── CHECK 3: SECURITY SCAN (soft warn) ──
  const secIssues = scanSecurity(source);
  if (secIssues.length > 0) {
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
      additionalContext: '[ENFORCE SECURITY WARNING]\n' + secIssues.map(s => `  - ${s}`).join('\n') }};
    process.stdout.write(JSON.stringify(out));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
