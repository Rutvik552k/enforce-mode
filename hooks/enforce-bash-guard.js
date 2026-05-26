#!/usr/bin/env node
/**
 * enforce-bash-guard.js — Consolidated PreToolUse hook for Bash
 *
 * REPLACES: enforce-test-gate.js (now covers more rules)
 *
 * ENFORCES:
 *   Rule #2, #7-11 — Git discipline (no untested commits, no secrets, no binaries)
 *   Rule #3, #12   — Test before ship
 *   Rule #16-19    — All inference/GPU in background
 *   Rule #24-27    — Cost tracking and warnings
 *
 * GATES (v4 — Option E: Approve + Inject Context):
 *   - git add of secrets/binaries → HARD BLOCK (exit 2)
 *   - Foreground inference → HARD BLOCK (exit 2)
 *   - Long sleep-poll (>=30s) → HARD BLOCK (exit 2)
 *   - git commit/push without tests → APPROVE + inject strong context
 *   - Expensive cloud operation → APPROVE + inject warning
 *
 * NEVER uses permissionDecision:'deny' — zero deadlock risk.
 * Phase 2 (stop-guard) enforces accountability.
 */

'use strict';

const fs = require('fs');
const { isActive, peckEvaluate, peckTick, peckRecordCompliance, logEvent } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════
// GIT GATES
// ═══════════════════════════════════════════════════════════

const GIT_COMMIT_PATTERNS = [/git\s+commit/, /git\s+push/];
const GIT_ADD_PATTERN = /git\s+add/;

// Binary extensions that should never be committed
const BINARY_EXTENSIONS = [
  '.safetensors', '.bin', '.pt', '.pth', '.ckpt', '.onnx', '.h5',
  '.mp4', '.avi', '.mov', '.mkv', '.webm',
  '.mp3', '.wav', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.exe', '.dll', '.so', '.dylib',
];

// Secret file patterns
const SECRET_FILES = [
  '.env', '.env.local', '.env.production', '.env.secret',
  'credentials.json', 'service-account.json', 'secrets.json',
  'id_rsa', 'id_ed25519', '.pem', '.key',
];

// Test command patterns (substring match against transcript)
const TEST_COMMANDS = [
  'cargo test', 'cargo nextest',
  'pytest', 'python -m pytest', 'python -m unittest',
  'npm test', 'npm run test', 'npx jest', 'npx vitest',
  'yarn test', 'go test', 'dotnet test',
  'mix test', 'bundle exec rspec', 'phpunit',
  'gradle test', 'mvn test', './gradlew test',
  'deno test', 'bun test',
  'node --test',
];

// Regex patterns for test execution that substring matching can't catch
// e.g. "node tests/test-config.js", "python test_auth.py", "ruby test/unit_test.rb"
const TEST_COMMAND_REGEXES = [
  /node\s+\S*test/i,
  /python\s+\S*test/i,
  /ruby\s+\S*test/i,
  /bash\s+\S*test/i,
  /sh\s+\S*test/i,
];

const BUILD_COMMANDS = [
  'cargo check', 'cargo build', 'cargo clippy',
  'npm run build', 'tsc --noEmit', 'tsc',
  'go build', 'go vet', 'dotnet build',
  'python -m py_compile', 'python -c',
];

// ═══════════════════════════════════════════════════════════
// INFERENCE / GPU DETECTION (must run in background)
// ═══════════════════════════════════════════════════════════

const INFERENCE_PATTERNS = [
  // Python ML scripts — match filenames/flags, not arbitrary substrings
  // Anchored: python <space> <filename containing ML term>
  /^python\s+\S*inference\S*\.py/,
  /^python\s+\S*generate\S*\.py/,
  /^python\s+\S*predict\S*\.py/,
  /^python\s+\S*train\S*\.py/,
  /^python\s+\S*benchmark\S*\.py/,
  /^python\s+\S*(?:run_pipeline|run_model|forward_pass)\S*\.py/,
  // PyTorch distributed — unambiguous commands
  /^torchrun\s+/,
  /^accelerate\s+launch/,
  /^python\s+-m\s+torch\.distributed/,
  // Diffusers / ML frameworks — unambiguous
  /^python\s+\S*(?:diffus|stable.diff|comfyui|webui)\S*/i,
  // FFmpeg long video processing
  /^ffmpeg\s+.*-i\s+\S+\.(mp4|avi|mov|mkv|webm)/,
  // Weight conversion — requires both terms
  /^python\s+\S*(?:convert|quantiz|export)\S*.*(?:weight|model|ckpt|safetensor)/i,
];

// ═══════════════════════════════════════════════════════════
// SLEEP / POLL DETECTION (anti-pattern: idle main agent)
// ═══════════════════════════════════════════════════════════

const SLEEP_POLL_PATTERNS = [
  // sleep N && check something
  /sleep\s+\d+\s*&&/,
  // sleep N ; check something
  /sleep\s+\d+\s*;/,
  // sleep used as a delay before reading output
  /sleep\s+\d+.*(?:cat|tail|head|wc|ls)/,
];

function isSleepPoll(cmd) {
  return SLEEP_POLL_PATTERNS.some(p => p.test(cmd));
}

function getSleepDuration(cmd) {
  const match = cmd.match(/sleep\s+(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// ═══════════════════════════════════════════════════════════
// COST ALERT PATTERNS
// ═══════════════════════════════════════════════════════════

const COST_PATTERNS = [
  // Cloud instance launch
  { pattern: /aws\s+ec2\s+run-instances/, msg: 'AWS EC2 instance launch — check instance type and cost/hr' },
  { pattern: /gcloud\s+compute\s+instances\s+create/, msg: 'GCP instance creation — verify pricing' },
  { pattern: /az\s+vm\s+create/, msg: 'Azure VM creation — check cost' },
  // Large downloads
  { pattern: /huggingface-cli\s+download|hf_hub_download/, msg: 'HuggingFace model download — check size and egress cost' },
  { pattern: /wget\s+.*\.safetensors|curl\s+.*\.safetensors/, msg: 'Model weight download — check size' },
  // Docker GPU
  { pattern: /docker\s+run.*--gpus/, msg: 'Docker GPU container — track GPU time cost' },
  { pattern: /nvidia-docker/, msg: 'GPU Docker container — track cost' },
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

function transcriptHas(transcriptPath, patterns) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
    const content = fs.readFileSync(transcriptPath, 'utf8');
    return patterns.some(p => content.includes(p));
  } catch {
    return false;
  }
}

function transcriptMatchesRegex(transcriptPath, regexes) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
    const content = fs.readFileSync(transcriptPath, 'utf8');
    return regexes.some(r => r.test(content));
  } catch {
    return false;
  }
}

function isGitCommitPush(cmd) {
  return GIT_COMMIT_PATTERNS.some(p => p.test(cmd));
}

function isGitAdd(cmd) {
  return GIT_ADD_PATTERN.test(cmd);
}

function isInferenceCommand(cmd) {
  return INFERENCE_PATTERNS.some(p => p.test(cmd));
}

function isBgCommand(input) {
  // Check if the bash command is set to run in background
  return input.run_in_background === true;
}

function checkGitAddForSecrets(cmd) {
  const violations = [];
  // Extract file paths from git add command (everything after "git add")
  const filesStr = cmd.replace(/git\s+add\s*/, '').trim();
  const files = filesStr.split(/\s+/).filter(f => f && !f.startsWith('-'));

  for (const file of files) {
    const basename = file.split('/').pop().split('\\').pop();
    // Exact basename match for secret files (not substring)
    for (const sf of SECRET_FILES) {
      if (basename === sf || basename.startsWith(sf + '.')) {
        violations.push(`Secret file: ${sf} (in ${file})`);
      }
    }
    // Extension match for binaries (check actual extension)
    const ext = '.' + basename.split('.').pop();
    for (const be of BINARY_EXTENSIONS) {
      if (ext === be) {
        violations.push(`Binary file: *${be} (${file})`);
      }
    }
  }
  // git add . or git add -A (catch-all staging)
  if (/git\s+add\s+(-A|--all|\.\s*$)/.test(cmd)) {
    violations.push('Catch-all staging (git add . / -A) — may include secrets or binaries');
  }
  return violations;
}

function checkCostAlerts(cmd) {
  const alerts = [];
  for (const cp of COST_PATTERNS) {
    if (cp.pattern.test(cmd)) {
      alerts.push(cp.msg);
    }
  }
  return alerts;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const transcriptPath = input.transcript_path || '';

  if (toolName !== 'Bash') process.exit(0);

  // Per-session isolation: skip if enforce is off for THIS session
  const sessionId = input.session_id || '';
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const cmd = toolInput.command || '';
  if (!cmd) process.exit(0);

  // Tick PECK recovery windows on every tool call
  peckTick(sessionId);

  // ── CHECK 1: INFERENCE IN FOREGROUND (HARD BLOCK) ──
  if (isInferenceCommand(cmd) && !isBgCommand(toolInput)) {
    logEvent(sessionId, { hook: 'bash-guard', action: 'block', file: cmd.substring(0, 80), result: 'inference-foreground' });
    process.stderr.write(
      '[ENFORCE HARD BLOCK] Inference/GPU task detected in foreground!\n' +
      'Rules #16-19: ALL inference, generation, and GPU tasks MUST run in background.\n\n' +
      'Detected command:\n  ' + cmd.substring(0, 200) + '\n\n' +
      'Fix: Use run_in_background=true for Bash, or spawn a background Agent.\n' +
      'NEVER let the main agent sit idle during inference.'
    );
    process.exit(2);
  }

  // ── CHECK 1b: SLEEP-POLL ANTI-PATTERN (WARN or BLOCK) ──
  if (isSleepPoll(cmd)) {
    const duration = getSleepDuration(cmd);
    if (duration >= 30) {
      // Block long sleeps — agent should not idle
      logEvent(sessionId, { hook: 'bash-guard', action: 'block', file: cmd.substring(0, 80), result: 'sleep-poll-' + duration + 's' });
      process.stderr.write(
        '[ENFORCE BLOCK] Sleep-poll anti-pattern detected!\n' +
        'Sleeping ' + duration + 's to poll output is wasteful.\n\n' +
        'Detected command:\n  ' + cmd.substring(0, 200) + '\n\n' +
        'Fix: Use run_in_background=true for the ORIGINAL command,\n' +
        'then wait for the task notification. Do NOT sleep-and-check.\n' +
        'Continue productive work while waiting.'
      );
      process.exit(2);
    } else {
      // Short sleeps get a warning — dual output
      const sleepMsg = '[ENFORCE WARNING] Sleep-poll detected (sleep ' + duration + 's).\n' +
        'Prefer waiting for background task notifications over polling.';
      process.stderr.write('[BASH-GUARD] ' + sleepMsg + '\n');
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: sleepMsg,
        },
      };
      process.stdout.write(JSON.stringify(output));
    }
  }

  // ── CHECK 2: GIT ADD WITH SECRETS/BINARIES (HARD BLOCK) ──
  if (isGitAdd(cmd)) {
    const violations = checkGitAddForSecrets(cmd);
    if (violations.length > 0) {
      logEvent(sessionId, { hook: 'bash-guard', action: 'block', file: cmd.substring(0, 80), result: 'secrets-binaries', details: { violations: violations.length } });
      process.stderr.write(
        '[ENFORCE HARD BLOCK] Dangerous git add detected!\n' +
        'Rules #9-11: Never commit secrets, tokens, or large binaries.\n\n' +
        'Violations:\n' +
        violations.map(v => `  - ${v}`).join('\n') + '\n\n' +
        'Use specific file paths instead of git add . and ensure .gitignore covers secrets and binaries.'
      );
      process.exit(2);
    }
  }

  // ── CHECK 3: GIT COMMIT/PUSH WITHOUT TESTS ──
  if (isGitCommitPush(cmd)) {
    // If transcript is unavailable, fall back to soft warn (not hard block)
    // This prevents deadlock in doc-only projects or early-session commits
    if (!transcriptPath) {
      const noTranscriptMsg = '[ENFORCE WARNING] No transcript available to verify test execution.\n' +
        'Rule #3: Ensure tests were run before committing.';
      process.stderr.write('[BASH-GUARD] ' + noTranscriptMsg + '\n');
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: noTranscriptMsg,
        },
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }

    const hasTests = transcriptHas(transcriptPath, TEST_COMMANDS) ||
                     transcriptMatchesRegex(transcriptPath, TEST_COMMAND_REGEXES);
    const hasBuilds = transcriptHas(transcriptPath, BUILD_COMMANDS);

    if (!hasTests && !hasBuilds) {
      const reason =
        'git commit/push without tests or builds in this session.\n' +
        'Rules #2, #3: Never push untested code.\n' +
        'Run tests first (cargo test, pytest, npm test, etc.).';

      const result = peckEvaluate(sessionId, 'test', cmd, reason);
      logEvent(sessionId, { hook: 'bash-guard', action: 'escalate', file: cmd.substring(0, 80), result: 'no-tests-tier' + result.tier });

      if (result.tier >= 3) {
        process.stderr.write(result.message);
        process.exit(2);
      }
      if (result.tier === 2) {
        const output = { hookSpecificOutput: { hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.message }};
        process.stdout.write(JSON.stringify(output));
        process.exit(0);
      }
      // Tier 0-1: approve + dual output (stderr for user, context for Claude)
      process.stderr.write('[BASH-GUARD] ' + result.message + '\n');
      const output = { hookSpecificOutput: { hookEventName: 'PreToolUse',
        additionalContext: result.message }};
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }

    if (hasTests) {
      // Compliance — decay PECK violations for test category
      peckRecordCompliance(sessionId, 'test', cmd);
    }

    if (!hasTests && hasBuilds) {
      const buildNoTestMsg = '[ENFORCE WARNING] Build found but no test execution.\n' +
        'Rule #3, #12: Run actual tests, not just builds.';
      process.stderr.write('[BASH-GUARD] ' + buildNoTestMsg + '\n');
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: buildNoTestMsg,
        },
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }
  }

  // ── CHECK 4: COST ALERTS (SOFT WARN) ──
  const costAlerts = checkCostAlerts(cmd);
  if (costAlerts.length > 0) {
    logEvent(sessionId, { hook: 'bash-guard', action: 'warn', file: cmd.substring(0, 80), result: 'cost-alert', details: { alerts: costAlerts.length } });
    const costMsg = '[ENFORCE COST ALERT] Rules #24-27:\n' +
      costAlerts.map(a => `  - ${a}`).join('\n') + '\n' +
      'Track cost ($/hr x estimated time). Warn user if >$5.';
    process.stderr.write('[BASH-GUARD] ' + costMsg + '\n');
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: costMsg,
      },
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
