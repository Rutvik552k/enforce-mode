#!/usr/bin/env node
/**
 * enforce-bash-guard.js — PreToolUse hook for Bash (advisory)
 *
 * ADVISORY MODE: this guard NEVER blocks. It approves every command and injects
 * guidance as additionalContext (plus a stderr line for the user). No exit(2),
 * no permissionDecision:'deny', no PECK escalation.
 *
 * CHECKS (all advisory — emitted as a single context payload):
 *   - Foreground inference/GPU  → advisory (run in background)
 *   - Sleep-poll anti-pattern   → advisory (use background + notification)
 *   - git add of secrets/binaries → advisory (use explicit paths / .gitignore)
 *   - git commit/push without tests → advisory (run tests first)
 *   - Expensive cloud operation → advisory (track cost, warn >$5)
 *
 * Accountability still flows to the Stop hook (phase-2 checks).
 */

'use strict';

const fs = require('fs');
const { isActive, peckTick, peckRecordCompliance, logEvent } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════
// GIT GATES
// ═══════════════════════════════════════════════════════════

const GIT_COMMIT_PATTERNS = [/git\s+commit/, /git\s+push/];
const GIT_ADD_PATTERN = /git\s+add/;

const BINARY_EXTENSIONS = [
  '.safetensors', '.bin', '.pt', '.pth', '.ckpt', '.onnx', '.h5',
  '.mp4', '.avi', '.mov', '.mkv', '.webm',
  '.mp3', '.wav', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.exe', '.dll', '.so', '.dylib',
];

const SECRET_FILES = [
  '.env', '.env.local', '.env.production', '.env.secret',
  'credentials.json', 'service-account.json', 'secrets.json',
  'id_rsa', 'id_ed25519', '.pem', '.key',
];

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
// INFERENCE / GPU DETECTION (should run in background)
// ═══════════════════════════════════════════════════════════

const INFERENCE_PATTERNS = [
  /^python\s+\S*inference\S*\.py/,
  /^python\s+\S*generate\S*\.py/,
  /^python\s+\S*predict\S*\.py/,
  /^python\s+\S*train\S*\.py/,
  /^python\s+\S*benchmark\S*\.py/,
  /^python\s+\S*(?:run_pipeline|run_model|forward_pass)\S*\.py/,
  /^torchrun\s+/,
  /^accelerate\s+launch/,
  /^python\s+-m\s+torch\.distributed/,
  /^python\s+\S*(?:diffus|stable.diff|comfyui|webui)\S*/i,
  /^ffmpeg\s+.*-i\s+\S+\.(mp4|avi|mov|mkv|webm)/,
  /^python\s+\S*(?:convert|quantiz|export)\S*.*(?:weight|model|ckpt|safetensor)/i,
];

// ═══════════════════════════════════════════════════════════
// SLEEP / POLL DETECTION (anti-pattern: idle main agent)
// ═══════════════════════════════════════════════════════════

const SLEEP_POLL_PATTERNS = [
  /sleep\s+\d+\s*&&/,
  /sleep\s+\d+\s*;/,
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
  { pattern: /aws\s+ec2\s+run-instances/, msg: 'AWS EC2 instance launch — check instance type and cost/hr' },
  { pattern: /gcloud\s+compute\s+instances\s+create/, msg: 'GCP instance creation — verify pricing' },
  { pattern: /az\s+vm\s+create/, msg: 'Azure VM creation — check cost' },
  { pattern: /huggingface-cli\s+download|hf_hub_download/, msg: 'HuggingFace model download — check size and egress cost' },
  { pattern: /wget\s+.*\.safetensors|curl\s+.*\.safetensors/, msg: 'Model weight download — check size' },
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
  return input.run_in_background === true;
}

function checkGitAddForSecrets(cmd) {
  const violations = [];
  const filesStr = cmd.replace(/git\s+add\s*/, '').trim();
  const files = filesStr.split(/\s+/).filter(f => f && !f.startsWith('-'));

  for (const file of files) {
    const basename = file.split('/').pop().split('\\').pop();
    for (const sf of SECRET_FILES) {
      if (basename === sf || basename.startsWith(sf + '.')) {
        violations.push(`Secret file: ${sf} (in ${file})`);
      }
    }
    const ext = '.' + basename.split('.').pop();
    for (const be of BINARY_EXTENSIONS) {
      if (ext === be) {
        violations.push(`Binary file: *${be} (${file})`);
      }
    }
  }
  if (/git\s+add\s+(-A|--all|\.\s*$)/.test(cmd)) {
    violations.push('Catch-all staging (git add . / -A) — may include secrets or binaries');
  }
  return violations;
}

function checkCostAlerts(cmd) {
  const alerts = [];
  for (const cp of COST_PATTERNS) {
    if (cp.pattern.test(cmd)) alerts.push(cp.msg);
  }
  return alerts;
}

// ═══════════════════════════════════════════════════════════
// MAIN — advisory only (accumulate guidance, emit once, never block)
// ═══════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const transcriptPath = input.transcript_path || '';

  if (toolName !== 'Bash') process.exit(0);

  const sessionId = input.session_id || '';
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const cmd = toolInput.command || '';
  if (!cmd) process.exit(0);

  peckTick(sessionId);

  const outParts = [];

  // ── CHECK 1: INFERENCE IN FOREGROUND ──
  if (isInferenceCommand(cmd) && !isBgCommand(toolInput)) {
    logEvent(sessionId, { hook: 'bash-guard', action: 'warn', file: cmd.substring(0, 80), result: 'inference-foreground' });
    outParts.push(
      'INFERENCE/GPU task in foreground: ' + cmd.substring(0, 160) + '\n' +
      'Recommended: run with run_in_background=true (or a background Agent) so the main agent does not idle.'
    );
  }

  // ── CHECK 1b: SLEEP-POLL ANTI-PATTERN ──
  if (isSleepPoll(cmd)) {
    const duration = getSleepDuration(cmd);
    logEvent(sessionId, { hook: 'bash-guard', action: 'warn', file: cmd.substring(0, 80), result: 'sleep-poll-' + duration + 's' });
    outParts.push(
      'Sleep-poll anti-pattern (sleep ' + duration + 's): prefer run_in_background=true and wait for the\n' +
      'task notification over sleep-and-check. Continue productive work while waiting.'
    );
  }

  // ── CHECK 2: GIT ADD WITH SECRETS/BINARIES ──
  if (isGitAdd(cmd)) {
    const violations = checkGitAddForSecrets(cmd);
    if (violations.length > 0) {
      logEvent(sessionId, { hook: 'bash-guard', action: 'warn', file: cmd.substring(0, 80), result: 'secrets-binaries', details: { violations: violations.length } });
      outParts.push(
        'Risky git add — may stage secrets or large binaries:\n' +
        violations.map(v => `  - ${v}`).join('\n') + '\n' +
        'Use explicit file paths instead of git add . / -A, and ensure .gitignore covers secrets and binaries.'
      );
    }
  }

  // ── CHECK 3: GIT COMMIT/PUSH WITHOUT TESTS ──
  if (isGitCommitPush(cmd)) {
    if (!transcriptPath) {
      outParts.push('No transcript available to verify tests ran — ensure tests were run before committing.');
    } else {
      const hasTests = transcriptHas(transcriptPath, TEST_COMMANDS) ||
                       transcriptMatchesRegex(transcriptPath, TEST_COMMAND_REGEXES);
      const hasBuilds = transcriptHas(transcriptPath, BUILD_COMMANDS);

      if (!hasTests && !hasBuilds) {
        logEvent(sessionId, { hook: 'bash-guard', action: 'warn', file: cmd.substring(0, 80), result: 'no-tests' });
        outParts.push(
          'git commit/push without tests or builds this session.\n' +
          'Recommended: run tests first (cargo test, pytest, npm test, …) before committing.'
        );
      } else if (hasTests) {
        peckRecordCompliance(sessionId, 'test', cmd);
      } else if (!hasTests && hasBuilds) {
        outParts.push('Build found but no test execution — run actual tests, not just builds.');
      }
    }
  }

  // ── CHECK 4: COST ALERTS ──
  const costAlerts = checkCostAlerts(cmd);
  if (costAlerts.length > 0) {
    logEvent(sessionId, { hook: 'bash-guard', action: 'warn', file: cmd.substring(0, 80), result: 'cost-alert', details: { alerts: costAlerts.length } });
    outParts.push(
      'COST ALERT:\n' + costAlerts.map(a => `  - ${a}`).join('\n') + '\n' +
      'Track cost ($/hr × estimated time). Warn the user before anything over $5.'
    );
  }

  if (outParts.length > 0) {
    const msg = outParts.join('\n\n');
    process.stderr.write('[BASH-GUARD] ' + msg + '\n');
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } }));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
