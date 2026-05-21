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
 * GATES:
 *   - git commit/push without tests → HARD BLOCK (exit 2)
 *   - git add of secrets/binaries → HARD BLOCK (exit 2)
 *   - Foreground inference detected → HARD BLOCK (exit 2)
 *   - Expensive cloud operation → Soft warn
 */

'use strict';

const fs = require('fs');

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

// Test command patterns
const TEST_COMMANDS = [
  'cargo test', 'cargo nextest',
  'pytest', 'python -m pytest', 'python -m unittest',
  'npm test', 'npm run test', 'npx jest', 'npx vitest',
  'yarn test', 'go test', 'dotnet test',
  'mix test', 'bundle exec rspec', 'phpunit',
  'gradle test', 'mvn test', './gradlew test',
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
  // Python inference scripts
  /python\s+.*(?:inference|generate|predict|train|eval|test_a2v|test_s2v|test_t2v|benchmark)/,
  /python\s+.*(?:run_pipeline|run_model|forward_pass)/,
  // PyTorch / TF
  /torchrun\s+/,
  /accelerate\s+launch/,
  /python\s+-m\s+torch\.distributed/,
  // Diffusers / ML frameworks
  /python\s+.*(?:diffus|stable.diff|comfyui|webui)/i,
  // FFmpeg (long video processing)
  /ffmpeg\s+.*-i\s+.*\.(mp4|avi|mov|mkv|webm)/,
  // Weight conversion
  /python\s+.*(?:convert|quantiz|export).*(?:weight|model|ckpt|safetensor)/i,
  // Generic GPU-heavy
  /python\s+.*(?:vae|clip|unet|dit|transformer).*(?:encode|decode|forward)/i,
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
  for (const sf of SECRET_FILES) {
    if (cmd.includes(sf)) {
      violations.push(`Secret file: ${sf}`);
    }
  }
  for (const ext of BINARY_EXTENSIONS) {
    if (cmd.includes(ext)) {
      violations.push(`Binary file: *${ext}`);
    }
  }
  // git add . or git add -A (catch-all staging)
  if (/git\s+add\s+(-A|--all|\.)/.test(cmd)) {
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

  const cmd = toolInput.command || '';
  if (!cmd) process.exit(0);

  // ── CHECK 1: INFERENCE IN FOREGROUND (HARD BLOCK) ──
  if (isInferenceCommand(cmd) && !isBgCommand(toolInput)) {
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
      // Short sleeps get a warning
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            '[ENFORCE WARNING] Sleep-poll detected (sleep ' + duration + 's).\n' +
            'Prefer waiting for background task notifications over polling.',
        },
      };
      process.stdout.write(JSON.stringify(output));
    }
  }

  // ── CHECK 2: GIT ADD WITH SECRETS/BINARIES (HARD BLOCK) ──
  if (isGitAdd(cmd)) {
    const violations = checkGitAddForSecrets(cmd);
    if (violations.length > 0) {
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

  // ── CHECK 3: GIT COMMIT/PUSH WITHOUT TESTS (HARD BLOCK) ──
  if (isGitCommitPush(cmd)) {
    const hasTests = transcriptHas(transcriptPath, TEST_COMMANDS);
    const hasBuilds = transcriptHas(transcriptPath, BUILD_COMMANDS);

    if (!hasTests && !hasBuilds) {
      process.stderr.write(
        '[ENFORCE HARD BLOCK] git commit/push blocked — no tests found.\n' +
        'Rules #2, #3, #7, #12: Never push untested code.\n\n' +
        'Run tests first (cargo test, pytest, npm test, etc.), then retry.\n' +
        '"It should work" is NOT a valid test result.'
      );
      process.exit(2);
    }

    if (!hasTests && hasBuilds) {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            '[ENFORCE WARNING] Build found but no test execution.\n' +
            'Rule #3, #12: Run actual tests, not just builds.',
        },
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }
  }

  // ── CHECK 4: COST ALERTS (SOFT WARN) ──
  const costAlerts = checkCostAlerts(cmd);
  if (costAlerts.length > 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          '[ENFORCE COST ALERT] Rules #24-27:\n' +
          costAlerts.map(a => `  - ${a}`).join('\n') + '\n' +
          'Track cost ($/hr x estimated time). Warn user if >$5.',
      },
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
