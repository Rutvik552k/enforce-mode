#!/usr/bin/env node
/**
 * enforce-research-gate.js — PreToolUse hook for Write/Edit/NotebookEdit
 *
 * ENFORCES: Rule 1 (Research before code) + Rule 6 (Web-research mandate)
 *
 * Logic:
 *   When Claude writes/edits a file that imports external libraries,
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

// Research tool indicators in transcript
const RESEARCH_TOOLS = [
  'WebSearch', 'WebFetch',
  'mcp__plugin_ecc_context7__query-docs',
  'mcp__plugin_ecc_context7__resolve-library-id',
  'mcp__plugin_ecc_exa__web_search_exa',
  'mcp__plugin_ecc_exa__web_fetch_exa',
];

// External library import patterns (language-agnostic)
const IMPORT_PATTERNS = [
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

function containsExternalImports(source) {
  if (!source) return false;
  return IMPORT_PATTERNS.some(pattern => pattern.test(source));
}

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const transcriptPath = input.transcript_path || '';

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

  // Skip if no external imports detected
  if (!containsExternalImports(source)) {
    process.exit(0);
  }

  // Check if research was done in this session
  const hasResearch = checkTranscriptForResearch(transcriptPath);

  if (!hasResearch) {
    // Soft gate: allow but inject warning
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: [
          '[ENFORCE RULE VIOLATION] Writing code with external library imports but NO web research detected in this session.',
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
