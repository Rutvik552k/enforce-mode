#!/usr/bin/env node
/**
 * enforce-test-gate.js — PreToolUse hook for Bash (git commit/push)
 *
 * ENFORCES: Rule 2 (Git discipline) + Rule 3 (Test before ship)
 *
 * Logic:
 *   When Claude runs `git commit` or `git push`, check the transcript
 *   for prior test execution (cargo test, pytest, npm test, etc.).
 *   If no tests found → HARD BLOCK (exit 2).
 *
 * Why hard block:
 *   Committing untested code is irreversible damage to git history.
 *   This is the one rule that justifies halting execution.
 */

'use strict';

const fs = require('fs');

// Git commands that require prior testing
const GIT_GATE_PATTERNS = [
  /git\s+commit/,
  /git\s+push/,
];

// Test execution indicators in transcript
const TEST_PATTERNS = [
  'cargo test',
  'cargo nextest',
  'pytest',
  'python -m pytest',
  'npm test',
  'npm run test',
  'npx jest',
  'npx vitest',
  'yarn test',
  'go test',
  'dotnet test',
  'mix test',
  'bundle exec rspec',
  'phpunit',
  'gradle test',
  'mvn test',
  './gradlew test',
];

// Build check indicators (weaker but still valid)
const BUILD_PATTERNS = [
  'cargo check',
  'cargo build',
  'cargo clippy',
  'npm run build',
  'tsc --noEmit',
  'go build',
  'go vet',
  'dotnet build',
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

function isGitGatedCommand(command) {
  if (!command) return false;
  return GIT_GATE_PATTERNS.some(pattern => pattern.test(command));
}

function transcriptHasTests(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return { tests: false, builds: false };
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const hasTests = TEST_PATTERNS.some(p => content.includes(p));
    const hasBuilds = BUILD_PATTERNS.some(p => content.includes(p));
    return { tests: hasTests, builds: hasBuilds };
  } catch {
    return { tests: false, builds: false };
  }
}

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const transcriptPath = input.transcript_path || '';

  // Only gate Bash tool
  if (toolName !== 'Bash') {
    process.exit(0);
  }

  const command = toolInput.command || '';

  // Only gate git commit/push commands
  if (!isGitGatedCommand(command)) {
    process.exit(0);
  }

  const { tests, builds } = transcriptHasTests(transcriptPath);

  if (!tests && !builds) {
    // HARD BLOCK — no tests or builds found
    process.stderr.write(
      '[ENFORCE HARD BLOCK] git commit/push blocked.\n' +
      'Rule #2 (Git discipline): Never push untested code.\n' +
      'Rule #3 (Test before ship): No test execution found in this session.\n\n' +
      'Run tests first (e.g., cargo test, pytest, npm test), then retry the commit.\n' +
      '"It should work" is NOT a valid test result.'
    );
    process.exit(2);
  }

  if (!tests && builds) {
    // Soft warning — builds passed but no tests
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          '[ENFORCE WARNING] Build check found but no test execution detected.\n' +
          'Rule #3: "It should work" is not valid — run actual tests.\n' +
          'Proceeding with commit, but test coverage is not verified.',
      },
    };
    process.stdout.write(JSON.stringify(output));
  }

  // Tests found — allow
  process.exit(0);
}

main().catch(() => process.exit(0));
