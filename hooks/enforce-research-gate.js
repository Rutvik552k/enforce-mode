#!/usr/bin/env node
/**
 * enforce-research-gate.js — PreToolUse hook for Write/Edit/NotebookEdit
 *
 * ENFORCES: Rule 1 (Research before code) + Rule 6 (Web-research mandate)
 *
 * Logic:
 *   When Claude writes/edits a file containing content that needs verification
 *   (imports, API calls, SDK usage, external URLs, version refs, cloud services),
 *   check the transcript for prior web research (WebSearch, WebFetch, context7).
 *   If no research found → emit warning as additionalContext (soft gate).
 *   Allows writes to proceed but injects mandatory reminder.
 *
 * Why soft gate (not hard block):
 *   Hard-blocking every write would break normal workflow. Instead, we inject
 *   a system message that Claude MUST acknowledge, creating accountability
 *   without halting productivity.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { logEvent } = require('./enforce-state');

// Research tool indicators in transcript
const RESEARCH_TOOLS = [
  'WebSearch', 'WebFetch',
  'mcp__plugin_ecc_context7__query-docs',
  'mcp__plugin_ecc_context7__resolve-library-id',
  'mcp__plugin_ecc_exa__web_search_exa',
  'mcp__plugin_ecc_exa__web_fetch_exa',
];

// Patterns that indicate content needing web-research verification.
// Broader than just imports — catches API calls, SDK usage, external
// service configs, version-specific code, and endpoint references.
const RESEARCH_NEEDED_PATTERNS = [
  // ── Library imports (original) ──
  // Python
  /^\s*(import|from)\s+\w+/m,
  // JavaScript/TypeScript
  /^\s*(import|require)\s*\(/m,
  /^\s*import\s+.*from\s+['"]/m,
  // Rust
  /^\s*use\s+\w+::/m,
  /^\s*extern\s+crate/m,
  // Go
  /^\s*import\s+\(/m,

  // ── External API / SDK method calls ──
  // REST client calls (fetch, axios, http, requests)
  /\b(fetch|axios|requests|httpx|http\.client)\s*\.\s*(get|post|put|patch|delete)\s*\(/m,
  /\bfetch\s*\(\s*['"`]/m,
  // SDK-style chained calls (e.g. client.chat.completions.create)
  /\b\w+\.\w+\.\w+\.(create|list|get|update|delete|send|execute)\s*\(/m,

  // ── HTTP endpoint URLs in code ──
  /['"`]https?:\/\/[^'"`\s]{10,}['"`]/m,

  // ── Version-specific references ──
  // Semver in strings (e.g. "3.12", "v2.1.0", "@^4.0.0")
  /['"`][@^~]?\d+\.\d+(\.\d+)?['"`]/m,
  // Package version pinning (e.g. "react": "^18.2.0", version = "0.4")
  /['"`]\w+['"`]\s*:\s*['"`][\^~>=<]?\d+\.\d+/m,

  // ── External service / cloud provider patterns ──
  // AWS SDK / config
  /\b(aws|AWS|s3|S3|dynamodb|DynamoDB|lambda|Lambda|sqs|SQS|sns|SNS)\b.*\.(send|put|get|invoke|publish|create)\s*\(/m,
  /\bnew\s+(S3Client|DynamoDBClient|LambdaClient|SQSClient|SNSClient)\s*\(/m,
  // GCP
  /\b(google\.cloud|storage\.Client|bigquery\.Client|pubsub)\b/m,
  // Azure
  /\b(azure\.\w+|BlobServiceClient|CosmosClient)\b/m,
  // Stripe
  /\bstripe\.\w+\.(create|retrieve|update|list)\s*\(/m,
  // Firebase / Supabase
  /\b(firebase|supabase)\.\w+\.\w+\s*\(/m,

  // ── Database query patterns with specific syntax ──
  // Raw SQL with table operations
  /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|VIEW|FUNCTION)\b/im,

  // ── CLI / shell commands embedded in code ──
  /\b(exec|spawn|execSync|spawnSync)\s*\(\s*['"`]\w+/m,
  /\bsubprocess\.(run|call|Popen)\s*\(/m,
];

// Files that are likely config, not code (skip checking these)
const SKIP_EXTENSIONS = [
  '.json', '.toml', '.yaml', '.yml', '.md', '.txt', '.csv',
  '.lock', '.gitignore', '.env', '.cfg', '.ini', '.conf',
];

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

function checkTranscriptForResearch(transcriptPath) {
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

function needsResearch(source) {
  if (!source) return false;
  return RESEARCH_NEEDED_PATTERNS.some(pattern => pattern.test(source));
}

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || '';

  // Only gate Write/Edit/NotebookEdit
  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) {
    process.exit(0);
  }

  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';

  // Skip non-code files
  if (!isCodeFile(filePath)) {
    process.exit(0);
  }

  // Skip if content doesn't need research verification
  if (!needsResearch(source)) {
    process.exit(0);
  }

  // Check if research was done in this session
  const hasResearch = checkTranscriptForResearch(transcriptPath);

  if (!hasResearch) {
    logEvent(sessionId, { hook: 'research-gate', action: 'warn', file: filePath, result: 'no-research' });
    // Soft gate: allow but inject warning
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: [
          '[ENFORCE RULE VIOLATION] Writing code with external APIs/libraries/services but NO web research detected in this session.',
          'Rules violated: #1 (Research before code), #6 (Web-research mandate).',
          'You MUST acknowledge this gap. Either:',
          '  (a) Pause and web-search to verify API signatures/versions are current, OR',
          '  (b) Explicitly state to the user that you are using training knowledge without verification.',
          'Do NOT silently proceed as if APIs were verified.',
        ].join('\n'),
      },
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
