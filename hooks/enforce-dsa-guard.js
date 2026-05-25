#!/usr/bin/env node
/**
 * enforce-dsa-guard.js — PreToolUse hook for Write|Edit|NotebookEdit
 *
 * ENFORCES:
 *   - Algorithm efficiency research before writing non-trivial algorithmic code
 *   - Data structure selection justification
 *   - Complexity awareness (no O(n^2) when O(n log n) exists)
 *
 * TRIGGERS when code contains:
 *   - Nested loops over collections (O(n^2) risk)
 *   - Sorting operations (verify optimal approach)
 *   - Search/lookup patterns (linear scan vs hash/binary search)
 *   - Recursive functions (stack overflow, memoization needed?)
 *   - Large collection processing (streaming vs in-memory)
 *   - Graph/tree traversals
 *   - String matching patterns
 *   - Caching/memoization decisions
 *
 * REQUIRES in transcript:
 *   - WebSearch/WebFetch with DSA-related terms, OR
 *   - Explicit complexity comment in the code (e.g., "# O(n log n)")
 *
 * GATES (v5 — PECK: Progressive Escalation with Circuit-breaker and K-step recovery):
 *   - DSA code without justification → PECK escalation (tier 0→3)
 *   - Tier 0: advisory, Tier 1: warning, Tier 2: deny (bounded), Tier 3: hard block
 *   - Circuit breaker opens after 3 failures → category hard-blocked
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
// DSA CODE PATTERNS — triggers the check
// ═══════════════════════════════════════════════════════════

const DSA_PATTERNS = [
  // --- Nested loops (O(n^2) risk) ---
  {
    name: 'Nested for loops (Python)',
    regex: /for\s+\w+\s+in\s+.*:\s*\n(?:[ \t]+.*\n)*?[ \t]+for\s+\w+\s+in\s+/,
    risk: 'O(n^2) — consider hash map, sorting + two pointers, or set lookup',
    multiline: true,
  },
  {
    name: 'Nested for loops (JS/TS)',
    regex: /for\s*\(.*\)\s*\{[^}]*for\s*\(/,
    risk: 'O(n^2) — consider Map, sorting, or Set for inner lookup',
    multiline: true,
  },
  {
    name: 'Nested list comprehension (Python)',
    regex: /\[.*for\s+\w+\s+in\s+.*for\s+\w+\s+in\s+/,
    risk: 'O(n^2) nested comprehension — flatten or use dict/set',
  },

  // --- Linear search when O(1) lookup exists ---
  // FIX #8: only match lists with 10+ elements (small constant lists are O(1) effectively)
  {
    name: 'Linear search in large list (Python)',
    regex: /if\s+\w+\s+in\s+\[(?:[^\]]*,){9,}/,
    risk: 'O(n) list membership on 10+ items — use set() for O(1) lookup',
  },
  {
    name: 'Array.find/filter in loop (JS)',
    regex: /\.(?:find|filter|some|every|includes)\s*\(.*\).*\.(?:find|filter|some|every|includes)\s*\(/,
    risk: 'Chained array scans — consider Map or pre-indexed lookup',
    multiline: true,
  },
  {
    name: 'Repeated list.index() or list.count()',
    regex: /\.(?:index|count)\s*\(.*\).*\.(?:index|count)\s*\(/,
    risk: 'Multiple O(n) scans — build a dict/Counter once',
    multiline: true,
  },

  // --- Sorting decisions ---
  {
    name: 'Custom sort implementation',
    regex: /(?:bubble.sort|insertion.sort|selection.sort|def\s+sort)/i,
    risk: 'Custom sort — use built-in sort (Timsort O(n log n)) unless specific reason',
  },
  {
    name: 'Sort inside loop',
    regex: /(?:for|while).*\n(?:[ \t]+.*\n)*?[ \t]+.*\.sort\s*\(/,
    risk: 'Sorting inside loop — O(n^2 log n). Sort once before loop.',
    multiline: true,
  },

  // --- Recursion without memoization ---
  {
    name: 'Recursive function (Python)',
    regex: /def\s+(\w+)\s*\([^)]*\):[^]*?\1\s*\(/,
    risk: 'Recursion detected — consider memoization (@lru_cache) or iterative approach',
    multiline: true,
  },

  // --- String operations at scale ---
  {
    name: 'String concatenation in loop (Python)',
    regex: /for\s+.*:\s*\n(?:[ \t]+.*\n)*?[ \t]+\w+\s*\+=\s*['"]/,
    risk: 'String concat in loop is O(n^2) in Python — use list + join()',
    multiline: true,
  },
  {
    name: 'String concat in loop (JS)',
    regex: /(?:for|while)\s*[\({].*\+=\s*['"` ]/,
    risk: 'String concat in loop — consider array.push + join() or template literal',
    multiline: true,
  },

  // --- Large data in memory ---
  // FIX #6: readFileSync only flagged inside loops (standalone config reads are fine)
  {
    name: 'readFileSync inside loop',
    regex: /(?:for|while)\s*[\({].*readFileSync\s*\(/,
    risk: 'Reading files inside loop — consider reading once before loop or streaming',
    multiline: true,
  },
  // FIX #7: .all() narrowed — exclude Promise.all(), only match ORM patterns
  {
    name: 'Load all rows from DB',
    regex: /\.fetchall\(\)|(?:objects|query|queryset|model|Model)\s*\.\s*all\s*\(\)|SELECT\s+\*\s+FROM/i,
    risk: 'Loading all rows — consider pagination, LIMIT, or cursor-based iteration',
  },

  // --- Duplicate computation ---
  {
    name: 'Same function call in loop (Python)',
    regex: /for\s+.*:\s*\n(?:[ \t]+.*\n)*?[ \t]+.*len\s*\(\s*\w+\s*\)/,
    risk: 'len() in loop body — cache length outside loop if collection unchanged',
    multiline: true,
  },
];

// ═══════════════════════════════════════════════════════════
// COMPLEXITY JUSTIFICATION — in-code comments that satisfy the check
// ═══════════════════════════════════════════════════════════

const COMPLEXITY_COMMENTS = [
  // Explicit Big-O notation in comments
  /[#/]\s*O\(\s*[n1kNmlog\s^*+]+\s*\)/,
  /\/\/\s*O\(\s*[n1kNmlog\s^*+]+\s*\)/,
  /\/\*.*O\(\s*[n1kNmlog\s^*+]+\s*\).*\*\//,

  // Justification keywords in comments
  /[#/].*(?:complexity|time complexity|space complexity|amortized)/i,
  /[#/].*(?:intentionally O\(n|acceptable for small|bounded by|max size|at most)/i,
  /[#/].*(?:benchmarked|profiled|measured|tested with)/i,

  // Explicit "this is fine because" patterns
  /[#/].*(?:small dataset|fixed size|constant bound|max \d+ items|< \d+ elements)/i,
];

// ═══════════════════════════════════════════════════════════
// RESEARCH TERMS — what to look for in transcript
// ═══════════════════════════════════════════════════════════

const RESEARCH_TOOLS = [
  'WebSearch', 'WebFetch',
  'mcp__plugin_ecc_context7__query-docs',
  'mcp__plugin_ecc_exa__web_search_exa',
  'mcp__plugin_ecc_exa__web_fetch_exa',
];

const DSA_RESEARCH_TERMS = [
  'time complexity', 'space complexity', 'big o',
  'algorithm', 'data structure',
  'hash map', 'hash table', 'dict lookup',
  'binary search', 'two pointers', 'sliding window',
  'sorting algorithm', 'timsort', 'merge sort', 'quick sort',
  'memoization', 'dynamic programming', 'cache',
  'breadth first', 'depth first', 'bfs', 'dfs',
  'trie', 'heap', 'priority queue',
  'benchmark', 'performance', 'optimization',
  'streaming', 'pagination', 'cursor',
  'O(n)', 'O(n log n)', 'O(1)', 'O(n^2)',
];

// ═══════════════════════════════════════════════════════════
// FILE EXTENSIONS TO CHECK
// ═══════════════════════════════════════════════════════════

const CODE_EXTENSIONS = [
  '.py', '.js', '.ts', '.tsx', '.jsx', '.mjs',
  '.go', '.rs', '.java', '.kt', '.kts', '.c', '.cpp', '.cs',
  '.rb', '.php', '.swift', '.scala',
  '.ex', '.exs', '.pl', '.lua', '.r', '.R', '.jl', '.groovy',
  '.dart', '.sol',
];

// SKIP_EXTENSIONS + EXEMPT_PATHS: now centralized in enforce-state.js

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

function isCodeFile(filePath) {
  if (!filePath) return false;
  if (isSkippedExtension(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  return CODE_EXTENSIONS.includes(ext);
}

function detectDSAPatterns(source) {
  const found = [];
  for (const pat of DSA_PATTERNS) {
    let regex = pat.regex;
    if (pat.multiline) {
      // Rebuild regex with multiline + dotAll flags
      regex = new RegExp(regex.source, regex.flags + (regex.flags.includes('s') ? '' : 's'));
    }
    if (regex.test(source)) {
      found.push({ name: pat.name, risk: pat.risk });
    }
  }
  return found;
}

function hasComplexityJustification(source) {
  return COMPLEXITY_COMMENTS.some(p => p.test(source));
}

function hasDSAResearch(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
    const content = fs.readFileSync(transcriptPath, 'utf8').toLowerCase();

    // Must have used a research tool
    const hasResearchTool = RESEARCH_TOOLS.some(tool =>
      content.includes(tool.toLowerCase())
    );
    if (!hasResearchTool) return false;

    // AND must have searched for DSA-related terms
    const hasDSATerm = DSA_RESEARCH_TERMS.some(term =>
      content.includes(term.toLowerCase())
    );
    return hasDSATerm;
  } catch {
    return false;
  }
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

  if (!source || !isCodeFile(filePath)) process.exit(0);
  if (isExemptFilePath(filePath)) process.exit(0);

  // Tick PECK recovery windows
  peckTick(sessionId);

  // FIX #9: if write-guard already flagged this file for research, defer DSA to Phase 2.
  if (sessionId) {
    const state = readState(sessionId);
    const hasResearchPending = state.pending.some(
      p => p.type === 'research' && p.file === filePath
    );
    if (hasResearchPending) process.exit(0);
  }

  // Detect algorithmic patterns in code
  const dsaIssues = detectDSAPatterns(source);
  if (dsaIssues.length === 0) process.exit(0);

  // Code has DSA patterns — check if justified
  const hasJustification = hasComplexityJustification(source);
  const hasResearch = hasDSAResearch(transcriptPath);

  if (hasJustification || hasResearch) {
    // Compliance — decay PECK violations
    logEvent(sessionId, { hook: 'dsa-guard', action: 'pass', file: filePath, result: hasJustification ? 'justified' : 'researched' });
    peckRecordCompliance(sessionId, 'dsa', filePath);
    process.exit(0);
  }

  // NOT justified — PECK escalation
  const patternNames = dsaIssues.map(d => d.name);
  recordPending(sessionId, 'dsa', filePath, patternNames);

  const reason =
    'Algorithmic patterns detected without complexity justification.\n' +
    'File: ' + filePath + '\n\n' +
    'Detected:\n' + dsaIssues.map(d => `  - ${d.name}: ${d.risk}`).join('\n') + '\n\n' +
    'REQUIRED: Add complexity comment (// O(n log n)), justify bounds, or WebSearch for optimal approach.';

  const result = peckEvaluate(sessionId, 'dsa', filePath, reason);
  logEvent(sessionId, { hook: 'dsa-guard', action: 'escalate', file: filePath, result: 'dsa-tier' + result.tier, details: { patterns: patternNames } });

  // Emit tier-appropriate response
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

main().catch(() => process.exit(0));
