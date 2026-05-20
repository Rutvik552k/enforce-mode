#!/usr/bin/env node
/**
 * enforce-pre-completion.js — Stop hook
 *
 * ENFORCES: Rule 3 (Test before ship) + Rule 4 (Pre-completion analysis)
 *
 * Logic:
 *   Before Claude's response is finalized, check:
 *   1. Were files written/edited in this session?
 *   2. If yes, were tests run AFTER the last write?
 *   3. If code was written but no tests run → inject reminder
 *
 * Why soft (not hard block on Stop):
 *   Hard-blocking Stop would prevent Claude from responding at all,
 *   including for non-code tasks. Instead, inject a system message
 *   that forces acknowledgment.
 */

'use strict';

const fs = require('fs');

const CODE_WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

const TEST_COMMANDS = [
  'cargo test', 'cargo nextest', 'pytest', 'python -m pytest',
  'npm test', 'npm run test', 'npx jest', 'npx vitest',
  'yarn test', 'go test', 'dotnet test', 'mix test',
  'bundle exec rspec', 'phpunit', 'gradle test', 'mvn test',
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

function analyzeTranscript(transcriptPath) {
  const result = {
    hasCodeWrites: false,
    hasTestsAfterWrite: false,
    lastWriteIndex: -1,
    lastTestIndex: -1,
    writeCount: 0,
    testCount: 0,
  };

  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;

    const lines = fs.readFileSync(transcriptPath, 'utf8')
      .split('\n')
      .filter(line => line.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for code write tools
      for (const tool of CODE_WRITE_TOOLS) {
        if (line.includes(`"tool_name":"${tool}"`) || line.includes(`"tool_name": "${tool}"`)) {
          result.hasCodeWrites = true;
          result.lastWriteIndex = i;
          result.writeCount++;
        }
      }

      // Check for test execution
      for (const testCmd of TEST_COMMANDS) {
        if (line.includes(testCmd)) {
          result.lastTestIndex = i;
          result.testCount++;
        }
      }
    }

    // Tests must come AFTER the last write
    result.hasTestsAfterWrite = result.lastTestIndex > result.lastWriteIndex;

  } catch {
    // Silent fail — don't break session
  }

  return result;
}

async function main() {
  const input = await readStdin();
  const transcriptPath = input.transcript_path || '';

  const analysis = analyzeTranscript(transcriptPath);

  // No code was written — nothing to enforce
  if (!analysis.hasCodeWrites) {
    process.exit(0);
  }

  // Code was written but no tests at all
  if (analysis.testCount === 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext:
          '[ENFORCE PRE-COMPLETION CHECK]\n' +
          `You wrote/edited ${analysis.writeCount} file(s) but ran 0 tests this session.\n` +
          'Rule #3 (Test before ship): Every code change must be tested.\n' +
          'Rule #4 (Pre-completion analysis): Walk code paths, check edge cases.\n\n' +
          'Before finishing, you MUST either:\n' +
          '  (a) Run the relevant test suite and show output, OR\n' +
          '  (b) Explicitly tell the user that tests were NOT run and why.',
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  // Tests exist but were run BEFORE the last write (stale tests)
  if (!analysis.hasTestsAfterWrite) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext:
          '[ENFORCE PRE-COMPLETION CHECK]\n' +
          'Tests were run earlier, but MORE code was written after the last test run.\n' +
          'The latest changes are untested.\n' +
          'Rule #3: Re-run tests to verify the final state of the code.',
      },
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
