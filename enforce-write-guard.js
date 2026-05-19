#!/usr/bin/env node
/**
 * enforce-write-guard.js — Consolidated PreToolUse hook for Write|Edit|NotebookEdit
 *
 * REPLACES: enforce-research-gate.js (now covers more rules)
 *
 * ENFORCES:
 *   Rule #1, #6  — Research before code / Web-research mandate
 *   Rule #9, #37, #38 — Never hardcode secrets/tokens/credentials
 *   Rule #28-36 — Security: auth, rate limiting, input validation, etc.
 *
 * ARCHITECTURE:
 *   Single stdin read → parallel checks → aggregated output
 *   Aho-Corasick-inspired multi-pattern matching (simple trie for <100 patterns)
 *   O(n) scan over source content, O(m) scan over transcript
 *
 * GATES:
 *   - Secrets detected → HARD BLOCK (exit 2) — secrets must never be written
 *   - No research → Soft warn (additionalContext)
 *   - Security anti-patterns → Soft warn (additionalContext)
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
  /^\s*(import|from)\s+\w+/m,
  /^\s*(import|require)\s*\(/m,
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

  // Skip non-code files for remaining checks
  if (!isCodeFile(filePath)) process.exit(0);

  const warnings = [];

  // ── CHECK 2: RESEARCH GATE (SOFT WARN) ──
  if (hasImports(source) && !checkResearch(transcriptPath)) {
    warnings.push(
      '[RULE VIOLATION #1, #6] Writing code with external imports but NO web research in session.',
      'You MUST either web-search to verify APIs or tell the user you are using unverified training knowledge.'
    );
  }

  // ── CHECK 3: SECURITY SCAN (SOFT WARN) ──
  const secIssues = scanSecurity(source);
  if (secIssues.length > 0) {
    warnings.push(
      '[SECURITY WARNING #28-36] Potential security anti-patterns detected:',
      ...secIssues.map(s => `  - ${s}`),
      'Review: auth on endpoints, input validation, no SQL injection, no eval().'
    );
  }

  if (warnings.length > 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: '[ENFORCE WRITE GUARD]\n' + warnings.join('\n'),
      },
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
