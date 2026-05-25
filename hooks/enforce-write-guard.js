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
const { recordPending, isActive, peckEvaluate, peckTick, peckRecordCompliance, logEvent, isSkippedExtension, isExemptFilePath } = require('./enforce-state');

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

  // Tier 0 or 1: approve + context
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

  // ── CHECK 2: RESEARCH GATE (PECK escalation) ──
  if (hasImports(source) && !isStdlibOnly(source) && !checkResearch(transcriptPath)) {
    recordPending(sessionId, 'research', filePath, ['external imports detected']);

    const reason =
      'External library imports detected without prior web research.\n' +
      'File: ' + filePath + '\n\n' +
      'REQUIRED: WebSearch/context7/WebFetch for library docs before relying on training knowledge.';

    const result = peckEvaluate(sessionId, 'research', filePath, reason);
    logEvent(sessionId, { hook: 'write-guard', action: 'escalate', file: filePath, result: 'research-gate-tier' + result.tier });
    emitPeckResult(result);
    return; // emitPeckResult calls process.exit
  }

  // Research done — record compliance to decay violations
  if (hasImports(source) && !isStdlibOnly(source) && checkResearch(transcriptPath)) {
    peckRecordCompliance(sessionId, 'research', filePath);
  }

  // ── CHECK 3: SECURITY SCAN (PECK escalation) ──
  const secIssues = scanSecurity(source);
  if (secIssues.length > 0) {
    const reason =
      'Security anti-patterns detected:\n' +
      secIssues.map(s => `  - ${s}`).join('\n') + '\n' +
      'File: ' + filePath;

    const result = peckEvaluate(sessionId, 'security', filePath, reason);
    logEvent(sessionId, { hook: 'write-guard', action: 'escalate', file: filePath, result: 'security-tier' + result.tier, details: { issues: secIssues } });
    emitPeckResult(result);
    return;
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
