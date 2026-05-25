#!/usr/bin/env node
/**
 * enforce-stop-guard.js — Phase 2 Stop hook (accountability check)
 *
 * TWO-PHASE ARCHITECTURE (Solution C):
 *   Phase 1 (write-guard, dsa-guard): Soft guidance + record to state file
 *   Phase 2 (this file): Read state → check compliance → strong warnings
 *
 * ENFORCES:
 *   Rule #3, #4, #12-15 — Test before ship, pre-completion analysis
 *   Rule #1, #6          — Research verification (Phase 2 accountability)
 *   DSA efficiency       — Complexity analysis (Phase 2 accountability)
 *   Rule #53             — Session log update (team+ only)
 *   Rule #55             — Requirements.txt sync reminder
 *
 * GATES:
 *   All soft (Stop hooks should not hard-block or Claude can't respond)
 *   Injects warnings that Claude must acknowledge
 *
 * PHASE 2 LOGIC:
 *   Reads enforce-state.js pending recommendations.
 *   If research was recommended but never performed → strong warning.
 *   If DSA analysis needed but no justification → strong warning.
 *   Transcript scan still runs for test/build checks (unchanged).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getUnresolved, getSummary, recordResearch, isActive, peckGetSummary, getLog, clearLog } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════
// DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════

const CODE_WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

const TEST_COMMANDS = [
  'cargo test', 'cargo nextest',
  'pytest', 'python -m pytest', 'python -m unittest',
  'npm test', 'npm run test', 'npx jest', 'npx vitest',
  'yarn test', 'go test', 'dotnet test',
  'mix test', 'bundle exec rspec', 'phpunit',
  'gradle test', 'mvn test', './gradlew test',
];

const RESEARCH_TOOLS = [
  'WebSearch', 'WebFetch',
  'mcp__plugin_ecc_context7__query-docs',
  'mcp__plugin_ecc_context7__resolve-library-id',
  'mcp__plugin_ecc_exa__web_search_exa',
  'mcp__plugin_ecc_exa__web_fetch_exa',
];

const IMPORT_WRITE_PATTERNS = [
  /import\s+\w+/,
  /from\s+\w+\s+import/,
  /require\s*\(/,
  /use\s+\w+::/,
];

const REQUIREMENTS_WRITES = [
  'requirements.txt', 'pyproject.toml', 'package.json',
  'Cargo.toml', 'go.mod', 'Gemfile', 'composer.json',
];

// DSA complexity comments — same patterns as dsa-guard
const COMPLEXITY_COMMENTS = [
  /[#/]\s*O\(\s*[n1kNmlog\s^*+]+\s*\)/,
  /\/\/\s*O\(\s*[n1kNmlog\s^*+]+\s*\)/,
  /\/\*.*O\(\s*[n1kNmlog\s^*+]+\s*\).*\*\//,
  /[#/].*(?:complexity|time complexity|space complexity|amortized)/i,
  /[#/].*(?:intentionally O\(n|acceptable for small|bounded by|max size|at most)/i,
  /[#/].*(?:benchmarked|profiled|measured|tested with)/i,
  /[#/].*(?:small dataset|fixed size|constant bound|max \d+ items|< \d+ elements)/i,
];

const DSA_RESEARCH_TERMS = [
  'time complexity', 'space complexity', 'big o',
  'algorithm', 'data structure',
  'hash map', 'hash table', 'binary search',
  'sorting algorithm', 'memoization', 'dynamic programming',
  'O(n)', 'O(n log n)', 'O(1)', 'O(n^2)',
  'benchmark', 'performance', 'optimization',
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

/**
 * Analyze transcript for session activity.
 * Single O(n) pass — tracks positions of writes, tests, research, imports.
 */
function analyzeTranscript(transcriptPath) {
  const result = {
    hasCodeWrites: false,
    writeCount: 0,
    lastWriteIndex: -1,
    hasTests: false,
    testCount: 0,
    lastTestIndex: -1,
    hasResearch: false,
    researchTools: [],
    hasImportWrites: false,
    hasRequirementsUpdate: false,
    newImportsAdded: false,
    hasDSAResearch: false,
    hasComplexityComments: false,
  };

  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;

    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code writes
      for (const tool of CODE_WRITE_TOOLS) {
        if (line.includes(`"${tool}"`) || line.includes(`"tool_name":"${tool}"`)) {
          result.hasCodeWrites = true;
          result.writeCount++;
          result.lastWriteIndex = i;

          if (IMPORT_WRITE_PATTERNS.some(p => p.test(line))) {
            result.hasImportWrites = true;
            result.newImportsAdded = true;
          }

          // Check for complexity comments in written code
          if (COMPLEXITY_COMMENTS.some(p => p.test(line))) {
            result.hasComplexityComments = true;
          }
        }
      }

      // Tests
      for (const cmd of TEST_COMMANDS) {
        if (line.includes(cmd)) {
          result.hasTests = true;
          result.testCount++;
          result.lastTestIndex = i;
        }
      }

      // Research tools
      for (const tool of RESEARCH_TOOLS) {
        if (line.includes(tool)) {
          result.hasResearch = true;
          if (!result.researchTools.includes(tool)) {
            result.researchTools.push(tool);
          }
        }
      }

      // DSA-specific research
      const lineLower = line.toLowerCase();
      if (result.hasResearch && DSA_RESEARCH_TERMS.some(t => lineLower.includes(t))) {
        result.hasDSAResearch = true;
      }

      // Requirements updates
      for (const indicator of REQUIREMENTS_WRITES) {
        if (line.includes(indicator)) {
          result.hasRequirementsUpdate = true;
        }
      }
    }
  } catch {
    // Silent fail
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || '';

  // Per-session isolation: skip if enforce is off for THIS session
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const analysis = analyzeTranscript(transcriptPath);

  // Update state with research findings from transcript
  // so Phase 2 unresolved check is accurate
  if (sessionId && analysis.researchTools.length > 0) {
    for (const tool of analysis.researchTools) {
      recordResearch(sessionId, tool);
    }
  }

  const warnings = [];

  // No code written — skip enforcement checks but still emit activity log
  const skipEnforcement = !analysis.hasCodeWrites;

  // ── CHECK 1: CODE WRITTEN BUT NO TESTS ──
  if (skipEnforcement) {
    // No code written — skip enforcement checks 1-5, jump to activity log
  } else if (analysis.testCount === 0) {
    warnings.push(
      `[RULE #3, #12] You wrote/edited ${analysis.writeCount} file(s) but ran 0 tests.`,
      'Every code change must be tested. Run the test suite or tell the user tests were NOT run.'
    );
  } else if (analysis.lastTestIndex < analysis.lastWriteIndex) {
    warnings.push(
      '[RULE #3, #12] Tests ran BEFORE your last code change — results are stale.',
      'Re-run tests to verify the final state.'
    );
  }

  if (!skipEnforcement) {
  // ── CHECK 2: PHASE 2 — UNRESOLVED RESEARCH RECOMMENDATIONS ──
  if (sessionId) {
    const unresolved = getUnresolved(sessionId);
    const unresolvedResearch = unresolved.filter(p => p.type === 'research');
    const unresolvedDSA = unresolved.filter(p => p.type === 'dsa');

    if (unresolvedResearch.length > 0 && !analysis.hasResearch) {
      warnings.push(
        '[PHASE 2 — RESEARCH] ' + unresolvedResearch.length + ' file(s) were written with external imports but NO web research was performed this session.',
        'Files: ' + unresolvedResearch.map(p => p.file).join(', '),
        'Action: Verify API signatures via WebSearch/context7, or tell the user you used unverified training knowledge.'
      );
    }

    if (unresolvedDSA.length > 0 && !analysis.hasDSAResearch && !analysis.hasComplexityComments) {
      warnings.push(
        '[PHASE 2 — DSA] ' + unresolvedDSA.length + ' file(s) contain algorithmic patterns without complexity justification.',
        'Files: ' + unresolvedDSA.map(p => p.file).join(', '),
        'Patterns: ' + unresolvedDSA.flatMap(p => p.patterns).join(', '),
        'Action: Add complexity comments (# O(n) — reason) or research optimal data structures.'
      );
    }

    // Summary line if any phase-2 items resolved
    const summary = getSummary(sessionId);
    if (summary.resolvedCount > 0 && (unresolvedResearch.length > 0 || unresolvedDSA.length > 0)) {
      warnings.push(
        `[PHASE 2 SUMMARY] ${summary.resolvedCount}/${summary.totalPending} recommendations resolved. ${unresolvedResearch.length} research + ${unresolvedDSA.length} DSA still pending.`
      );
    }
  }

  // ── CHECK 3: CODE WITH IMPORTS BUT NO RESEARCH (legacy transcript check) ──
  // Only fires if Phase 2 state is unavailable (no session_id)
  if (!sessionId && analysis.hasImportWrites && !analysis.hasResearch) {
    warnings.push(
      '[RULE #1, #6] Code with external imports was written but no web research detected.',
      'Verify API signatures are current or explicitly state you used unverified training knowledge.'
    );
  }

  // ── CHECK 4: NEW IMPORTS BUT NO REQUIREMENTS UPDATE ──
  if (analysis.newImportsAdded && !analysis.hasRequirementsUpdate) {
    warnings.push(
      '[RULE #55] New imports added but requirements file not updated.',
      'Sync requirements.txt / pyproject.toml / Cargo.toml with new dependencies.'
    );
  }

  // ── CHECK 5: PRE-COMPLETION ANALYSIS REMINDER ──
  if (analysis.writeCount >= 3) {
    warnings.push(
      '[RULE #4, #56-58] Multiple files changed — pre-completion analysis required.',
      'Walk changed code paths. Check for: missing imports, wrong types, edge cases, security (OWASP Top 10).'
    );
  }

  } // end !skipEnforcement

  // ── PECK ENFORCEMENT SUMMARY (always — useful even without code writes) ──
  if (sessionId) {
    const peck = peckGetSummary(sessionId);

    // Dead letters — actions that hit tier 3 and were permanently blocked
    if (peck.deadLetterCount > 0) {
      warnings.push(
        '[PECK — DEAD LETTERS] ' + peck.deadLetterCount + ' action(s) were permanently blocked:',
        ...peck.deadLetters.map(d =>
          '  - [' + d.category + '] ' + (d.file || 'unknown') + ': ' + d.reason.split('\n')[0]
        ),
        'These represent unresolved compliance failures.'
      );
    }

    // Active violations summary
    const violationEntries = Object.entries(peck.violations);
    if (violationEntries.length > 0) {
      const lines = violationEntries.map(([cat, v]) =>
        '  - ' + cat + ': tier ' + v.tier + ' (' + v.tierName + '), ' +
        v.count + '/' + v.budget + ' violations, ' + v.remaining + ' remaining'
      );
      warnings.push(
        '[PECK — ESCALATION STATUS]',
        ...lines
      );
    }

    // Circuit breaker status
    const openCircuits = Object.entries(peck.circuits)
      .filter(([, state]) => state !== 'CLOSED');
    if (openCircuits.length > 0) {
      warnings.push(
        '[PECK — CIRCUIT BREAKERS]',
        ...openCircuits.map(([cat, state]) => '  - ' + cat + ': ' + state)
      );
    }
  }

  // ── ACTIVITY LOG SUMMARY ──
  const logLines = [];
  if (sessionId) {
    const log = getLog(sessionId);
    if (log.length > 0) {
      // Group events by hook
      const byHook = {};
      const counts = { pass: 0, warn: 0, escalate: 0, block: 0, suppress: 0 };
      for (const ev of log) {
        if (!byHook[ev.hook]) byHook[ev.hook] = [];
        byHook[ev.hook].push(ev);
        if (counts[ev.action] !== undefined) counts[ev.action]++;
      }

      logLines.push('[ENFORCE ACTIVITY LOG] ' + log.length + ' events this response');
      logLines.push('  Pass: ' + counts.pass + ' | Warn: ' + counts.warn +
        ' | Escalate: ' + counts.escalate + ' | Block: ' + counts.block +
        ' | Suppress: ' + counts.suppress);

      // Per-hook summary (compact)
      for (const [hook, events] of Object.entries(byHook)) {
        const actions = events.map(e => {
          const file = e.file ? path.basename(e.file) : '';
          return e.action + (file ? '(' + file + ')' : '') +
            (e.result ? ':' + e.result : '');
        });
        logLines.push('  ' + hook + ': ' + actions.join(', '));
      }

      // Session start details (if present)
      const startEvent = log.find(e => e.hook === 'activate' && e.action === 'session-start');
      if (startEvent && startEvent.details) {
        const d = startEvent.details;
        logLines.push('  Session: level=' + d.level +
          ', domains=[' + (d.domains || []).join(', ') + ']' +
          ' (' + d.domainCount + ' detected, ' + d.detectMs + 'ms)');
      }

      // Clear log after reading
      clearLog(sessionId);
    }
  }

  // Activity log → stderr (shown directly in terminal, not filtered by Claude)
  if (logLines.length > 0) {
    process.stderr.write(logLines.join('\n') + '\n');
  }

  // Enforcement warnings → stopReason (Claude must acknowledge)
  if (warnings.length > 0) {
    const output = {
      stopReason:
        '[ENFORCE STOP GUARD — Phase 2] Pre-completion checks:\n\n' +
        warnings.join('\n') +
        '\n\nAddress these before marking work as complete.',
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
