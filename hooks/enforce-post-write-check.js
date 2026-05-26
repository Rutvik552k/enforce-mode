#!/usr/bin/env node
/**
 * enforce-post-write-check.js — PostToolUse hook for Write|Edit|NotebookEdit
 *
 * Fires AFTER a write tool completes. Checks:
 *   1. Skill compliance — were relevant skills loaded before writing?
 *   2. Research coverage — were external libraries researched?
 *
 * Output: additionalContext appended to tool result (Claude sees it
 * right next to the code it just wrote) + stderr for user visibility.
 *
 * This hook NEVER blocks — it's post-execution feedback only.
 * Blocking is handled by PreToolUse guards.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isActive, getLevel, logEvent, isSkippedExtension, isExemptFilePath } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════
// SKILL MAP (subset — most impactful skills only)
// ═══════════════════════════════════════════════════════════

const EXT_SKILL_MAP = {
  '.ts':   ['ecc:code-review'],
  '.tsx':  ['ecc:code-review', 'ecc:senior-frontend'],
  '.js':   ['ecc:code-review'],
  '.jsx':  ['ecc:code-review', 'ecc:senior-frontend'],
  '.py':   ['ecc:python-review'],
  '.go':   ['ecc:go-review'],
  '.rs':   ['ecc:rust-review'],
  '.kt':   ['ecc:kotlin-review'],
  '.dart': ['ecc:flutter-review'],
  '.cpp':  ['ecc:cpp-review'],
  '.c':    ['ecc:cpp-review'],
  '.java': ['ecc:code-review'],
  '.cs':   ['ecc:code-review'],
  '.sol':  ['ecc:security-review'],
};

// ═══════════════════════════════════════════════════════════
// TRANSCRIPT SKILL CHECK
// ═══════════════════════════════════════════════════════════

function checkSkillsInTranscript(transcriptPath, requiredSkills) {
  if (!transcriptPath) return { loaded: false, skills: [] };
  try {
    if (!fs.existsSync(transcriptPath)) return { loaded: false, skills: [] };
    const content = fs.readFileSync(transcriptPath, 'utf8');

    // Structured check — require tool_name:"Skill" pattern
    const hasStructured = /["']?tool_name["']?\s*:\s*["']Skill["']/.test(content);
    if (!hasStructured) return { loaded: false, skills: [] };

    // Extract loaded skills
    const skillPattern = /["']skill["']\s*:\s*["'](ecc:[a-z0-9-]+)["']/g;
    const skills = [];
    let match;
    while ((match = skillPattern.exec(content)) !== null) {
      skills.push(match[1]);
    }

    const unique = [...new Set(skills)];
    const requiredSet = new Set(requiredSkills);
    const matched = unique.some(s => requiredSet.has(s));

    return { loaded: matched, skills: unique };
  } catch { return { loaded: false, skills: [] }; }
}

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

function checkResearchDone(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
    const content = fs.readFileSync(transcriptPath, 'utf8');
    return RESEARCH_TOOLS.some(tool => content.includes(tool));
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════
// IMPORT DETECTION
// ═══════════════════════════════════════════════════════════

const NODE_STDLIB = new Set([
  'fs', 'path', 'os', 'http', 'https', 'url', 'util', 'crypto',
  'stream', 'events', 'child_process', 'assert', 'buffer', 'net',
  'node:fs', 'node:path', 'node:os', 'node:http', 'node:https',
  'node:url', 'node:util', 'node:crypto', 'node:stream',
]);

const PYTHON_STDLIB = new Set([
  'os', 'sys', 'json', 're', 'math', 'time', 'datetime',
  'pathlib', 'collections', 'functools', 'itertools', 'typing',
  'hashlib', 'io', 'logging', 'subprocess', 'shutil', 'tempfile',
  'unittest', 'argparse', 'copy', 'abc', 'enum', 'dataclasses',
]);

function hasExternalImports(source) {
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
  return importNames.some(n => !NODE_STDLIB.has(n) && !PYTHON_STDLIB.has(n) && !n.startsWith('.'));
}

// ═══════════════════════════════════════════════════════════
// STDIN
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

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const toolResult = input.tool_result || {};
  const sessionId = input.session_id || '';
  const transcriptPath = input.transcript_path || '';

  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) process.exit(0);
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';

  if (!filePath || !source || source.length < 5) process.exit(0);
  if (isSkippedExtension(filePath)) process.exit(0);
  if (isExemptFilePath(filePath)) process.exit(0);

  const warnings = [];

  // ── CHECK 1: Skill compliance ──
  const ext = path.extname(filePath).toLowerCase();
  const requiredSkills = EXT_SKILL_MAP[ext] || [];
  if (requiredSkills.length > 0) {
    const { loaded, skills } = checkSkillsInTranscript(transcriptPath, requiredSkills);
    if (!loaded) {
      const needed = requiredSkills.slice(0, 2).map(s => '/' + s).join(', ');
      warnings.push('[POST-WRITE] Skills not loaded for ' + ext + ' file. Recommended: ' + needed);
    }
  }

  // ── CHECK 2: Research coverage ──
  if (hasExternalImports(source) && !checkResearchDone(transcriptPath)) {
    warnings.push('[POST-WRITE] External imports written without web research in this session.');
  }

  if (warnings.length === 0) process.exit(0);

  const message = warnings.join('\n');
  logEvent(sessionId, { hook: 'post-write-check', action: 'warn', file: filePath, result: 'post-write-warnings', details: { count: warnings.length } });

  // Dual output: stderr for user, additionalContext for Claude
  process.stderr.write('[POST-WRITE-CHECK] ' + message + '\n');
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main().catch(() => process.exit(0));
