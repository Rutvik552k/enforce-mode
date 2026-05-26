#!/usr/bin/env node
/**
 * enforce-research-capture.js — PostToolUse hook for WebSearch|WebFetch|context7
 *
 * Captures search results into state.groundTruth for:
 *   1. Per-library research verification (PreToolUse gate)
 *   2. GTC score computation (doc alignment signal)
 *
 * FIRES AFTER: WebSearch, WebFetch, context7 query-docs, context7 resolve-library-id,
 *              exa web_search, exa web_fetch
 *
 * CAPTURES:
 *   - Query text (what was searched)
 *   - Result snippets (up to 500 chars each, max 5)
 *   - URLs (max 5)
 *   - Library name extraction from query
 *
 * NEVER BLOCKS — post-execution capture only.
 * Dual output: stderr (user sees) + additionalContext (Claude sees).
 */

'use strict';

const { isActive, recordGroundTruth, logEvent } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════
// TOOL MATCHING
// ═══════════════════════════════════════════════════════════

const RESEARCH_TOOLS = new Set([
  'WebSearch', 'WebFetch',
  'mcp__plugin_ecc_context7__query-docs',
  'mcp__plugin_ecc_context7__resolve-library-id',
  'mcp__plugin_ecc_exa__web_search_exa',
  'mcp__plugin_ecc_exa__web_fetch_exa',
]);

// ═══════════════════════════════════════════════════════════
// LIBRARY NAME EXTRACTION
// ═══════════════════════════════════════════════════════════

/**
 * Extract likely library names from a search query.
 * Uses heuristics: quoted terms, known patterns, lowercase words
 * that look like package names.
 *
 * @param {string} query
 * @returns {string[]}
 */
function extractLibsFromQuery(query) {
  if (!query) return [];
  const libs = new Set();
  const q = query.toLowerCase();

  // Pattern: "library-name docs/documentation/api/tutorial"
  const docPatterns = [
    /(\w[\w.-]+)\s+(?:docs?|documentation|api|tutorial|guide|reference|npm|pypi|crate)/gi,
    /(?:docs?|documentation|api|tutorial|guide|reference|npm|pypi|crate)\s+(?:for\s+)?(\w[\w.-]+)/gi,
  ];
  for (const pattern of docPatterns) {
    let match;
    while ((match = pattern.exec(q)) !== null) {
      const candidate = match[1].replace(/[.-]+$/, '');
      if (candidate.length >= 2 && candidate.length <= 50) {
        libs.add(candidate);
      }
    }
  }

  // Pattern: package-style names (hyphenated, scoped)
  const packagePatterns = [
    /@[\w-]+\/[\w-]+/g,          // @scope/package
    /\b[\w][\w-]{1,30}(?:\.js|\.py)?\b/g, // word-with-hyphens
  ];
  for (const pattern of packagePatterns) {
    let match;
    while ((match = pattern.exec(q)) !== null) {
      const candidate = match[0].replace(/\.(js|py)$/i, '').toLowerCase();
      // Filter out common non-library words
      if (candidate.length >= 3 && !NOISE_WORDS.has(candidate)) {
        libs.add(candidate);
      }
    }
  }

  return [...libs].slice(0, 5);
}

const NOISE_WORDS = new Set([
  'how', 'the', 'for', 'use', 'can', 'with', 'what', 'from', 'this',
  'that', 'and', 'not', 'are', 'was', 'get', 'set', 'has', 'had',
  'will', 'new', 'old', 'best', 'way', 'using', 'latest', 'version',
  'install', 'error', 'issue', 'bug', 'fix', 'help', 'docs',
  'documentation', 'api', 'tutorial', 'guide', 'reference',
  'npm', 'pypi', 'crate', 'package', 'library', 'module',
]);

// ═══════════════════════════════════════════════════════════
// RESULT EXTRACTION
// ═══════════════════════════════════════════════════════════

/**
 * Extract snippets and URLs from tool result.
 * Handles various result formats (WebSearch JSON, WebFetch text, context7).
 *
 * @param {*} toolResult — raw tool result (string or object)
 * @returns {{ snippets: string[], urls: string[] }}
 */
function extractResultData(toolResult) {
  const snippets = [];
  const urls = [];

  if (!toolResult) return { snippets, urls };

  let text = '';
  if (typeof toolResult === 'string') {
    text = toolResult;
  } else if (typeof toolResult === 'object') {
    // Handle structured results
    text = JSON.stringify(toolResult);

    // Extract URLs from structured data
    const urlPattern = /https?:\/\/[^\s"'<>]+/g;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
      if (urls.length < 5) urls.push(match[0].substring(0, 200));
    }

    // Extract snippets from common result structures
    if (toolResult.results && Array.isArray(toolResult.results)) {
      for (const r of toolResult.results.slice(0, 5)) {
        if (r.snippet) snippets.push(r.snippet);
        else if (r.description) snippets.push(r.description);
        else if (r.text) snippets.push(r.text);
        if (r.url && urls.length < 5) urls.push(r.url);
      }
    }
    if (toolResult.content && typeof toolResult.content === 'string') {
      snippets.push(toolResult.content.substring(0, 500));
    }
  }

  // Fallback: extract sentences from raw text
  if (snippets.length === 0 && text.length > 0) {
    // Take first 5 meaningful lines (>20 chars)
    const lines = text.split(/\n/).filter(l => l.trim().length > 20);
    for (const line of lines.slice(0, 5)) {
      snippets.push(line.trim().substring(0, 500));
    }
  }

  // Extract URLs from text if none found yet
  if (urls.length === 0 && text.length > 0) {
    const urlPattern = /https?:\/\/[^\s"'<>]+/g;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
      if (urls.length < 5) urls.push(match[0].substring(0, 200));
    }
  }

  return { snippets: snippets.slice(0, 5), urls: urls.slice(0, 5) };
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
  const toolResult = input.tool_result || '';
  const sessionId = input.session_id || '';

  // Gate: only research tools
  if (!RESEARCH_TOOLS.has(toolName)) process.exit(0);

  // Gate: active sessions only
  if (sessionId && !isActive(sessionId)) process.exit(0);

  // Extract query from tool input
  const query = toolInput.query || toolInput.url || toolInput.prompt
    || toolInput.libraryId || toolInput.topic || '';

  if (!query) process.exit(0);

  // Extract library names from query
  const libs = extractLibsFromQuery(query);

  // Extract result data
  const { snippets, urls } = extractResultData(toolResult);

  if (libs.length === 0 && snippets.length === 0) process.exit(0);

  // Record ground truth for each detected library
  const recorded = [];
  for (const lib of libs) {
    recordGroundTruth(sessionId, lib, { query, snippets, urls });
    recorded.push(lib);
  }

  // Also record under the raw query (fallback matching)
  if (libs.length === 0 && snippets.length > 0) {
    const fallbackKey = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
    recordGroundTruth(sessionId, fallbackKey, { query, snippets, urls });
    recorded.push(fallbackKey);
  }

  logEvent(sessionId, {
    hook: 'research-capture',
    action: 'capture',
    file: toolName,
    result: 'captured',
    details: { libs: recorded, snippetCount: snippets.length, urlCount: urls.length },
  });

  // Dual output
  const libList = recorded.join(', ');
  const msg = '[RESEARCH CAPTURED] ' + libList + ' (' + snippets.length + ' snippets, ' + urls.length + ' URLs)';
  process.stderr.write('[RESEARCH-CAPTURE] ' + msg + '\n');

  const out = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: msg,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main().catch(() => process.exit(0));
