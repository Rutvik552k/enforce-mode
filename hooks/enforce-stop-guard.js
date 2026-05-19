#!/usr/bin/env node
/**
 * enforce-stop-guard.js — Consolidated Stop hook
 *
 * REPLACES: enforce-pre-completion.js (now covers more rules)
 *
 * ENFORCES:
 *   Rule #3, #4, #12-15 — Test before ship, pre-completion analysis
 *   Rule #1, #6          — Research verification
 *   Rule #53             — Session log update reminder
 *   Rule #55             — Requirements.txt sync reminder
 *   Rule #50-52          — Decision management reminders
 *
 * GATES:
 *   All soft (Stop hooks should not hard-block or Claude can't respond)
 *   Injects additionalContext warnings that Claude must acknowledge
 *
 * TRANSCRIPT SCANNING:
 *   Reads transcript JSONL in reverse (tail) for efficiency —
 *   recent events matter most, no need to scan from beginning.
 *   O(n) single pass, early exit when all checks satisfied.
 */

'use strict';

const fs = require('fs');

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

// Session log indicators
const SESSION_LOG_WRITES = [
  'session_log', 'session-log', 'SESSION_LOG',
  'research_workspace', 'ARCHITECTURE.md',
];

// Requirements file indicators
const REQUIREMENTS_WRITES = [
  'requirements.txt', 'pyproject.toml', 'package.json',
  'Cargo.toml', 'go.mod', 'Gemfile', 'composer.json',
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
    hasImportWrites: false,
    hasSessionLogUpdate: false,
    hasRequirementsUpdate: false,
    newImportsAdded: false,
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

          // Check if write contains imports
          if (IMPORT_WRITE_PATTERNS.some(p => p.test(line))) {
            result.hasImportWrites = true;
            result.newImportsAdded = true;
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

      // Research
      for (const tool of RESEARCH_TOOLS) {
        if (line.includes(tool)) {
          result.hasResearch = true;
        }
      }

      // Session log updates
      for (const indicator of SESSION_LOG_WRITES) {
        if (line.includes(indicator)) {
          result.hasSessionLogUpdate = true;
        }
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

  const analysis = analyzeTranscript(transcriptPath);

  // No code written — nothing to enforce
  if (!analysis.hasCodeWrites) {
    process.exit(0);
  }

  const warnings = [];

  // ── CHECK 1: CODE WRITTEN BUT NO TESTS ──
  if (analysis.testCount === 0) {
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

  // ── CHECK 2: CODE WITH IMPORTS BUT NO RESEARCH ──
  if (analysis.hasImportWrites && !analysis.hasResearch) {
    warnings.push(
      '[RULE #1, #6] Code with external imports was written but no web research detected.',
      'Verify API signatures are current or explicitly state you used unverified training knowledge.'
    );
  }

  // ── CHECK 3: SESSION LOG NOT UPDATED ──
  if (!analysis.hasSessionLogUpdate) {
    warnings.push(
      '[RULE #53] Session log was not updated this session.',
      'Update session_log.md with: decisions made, models verified, test results, issues found.'
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

  if (warnings.length > 0) {
    const output = {
      stopReason:
        '[ENFORCE STOP GUARD] Pre-completion checks:\n\n' +
        warnings.join('\n') +
        '\n\nAddress these before marking work as complete.',
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
