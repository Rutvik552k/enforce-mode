#!/usr/bin/env node
/**
 * enforce-mode — SessionStart activation hook
 *
 * Runs on every session start:
 *   1. Reads session_id from stdin
 *   2. Resolves enforcement level from config
 *   3. Writes level to per-session state file (session isolation)
 *   4. Writes global flag file for statusline badge (best-effort)
 *   5. Detects project domains via weighted signal scoring
 *   6. Assembles universal + domain rules within context budget
 *   7. Emits rules as SessionStart context (stdout → <system-reminder>)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultLevel } = require('./enforce-config');
const { detectDomains } = require('./enforce-detect');
const { buildContext } = require('./enforce-rules');
const { setLevel, logEvent } = require('./enforce-state');

const claudeDir = path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.enforce-active');
const settingsPath = path.join(claudeDir, 'settings.json');
const pluginRoot = path.resolve(__dirname, '..');

// ═══════════════════════════════════════════════════════════════════════════
// SESSION SKILL DETECTION — scan project files, recommend skills at start
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_SKILL_MAP = {
  '.ts':    'ecc:code-review',
  '.tsx':   'ecc:code-review',
  '.js':    'ecc:code-review',
  '.jsx':   'ecc:code-review',
  '.mjs':   'ecc:code-review',
  '.py':    'ecc:python-review',
  '.go':    'ecc:go-review',
  '.rs':    'ecc:rust-review',
  '.kt':    'ecc:kotlin-review',
  '.java':  'ecc:code-review',
  '.dart':  'ecc:flutter-review',
  '.cpp':   'ecc:cpp-review',
  '.c':     'ecc:cpp-review',
  '.cs':    'ecc:code-review',
  '.rb':    'ecc:code-review',
  '.php':   'ecc:code-review',
  '.swift': 'ecc:code-review',
  '.sql':   'ecc:postgres-patterns',
  '.sol':   'ecc:security-review',
  '.tf':    'ecc:senior-devops',
};

/**
 * Scan project for source file types and map to recommended skills.
 * Quick scan: project root + common source dirs (1 level deep).
 * Returns max 4 skills, deduplicated.
 */
function detectProjectSkills(cwd) {
  const found = new Set();
  const scanDirs = [cwd];

  for (const sub of ['src', 'lib', 'app', 'pkg', 'cmd', 'hooks', 'components', 'pages', 'api', 'internal']) {
    try {
      const full = path.join(cwd, sub);
      if (fs.statSync(full).isDirectory()) scanDirs.push(full);
    } catch { /* skip */ }
  }

  for (const dir of scanDirs) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        const ext = path.extname(entry).toLowerCase();
        const skill = SESSION_SKILL_MAP[ext];
        if (skill) found.add(skill);
      }
    } catch { /* skip */ }
    if (found.size >= 6) break;
  }

  // Check for test infrastructure → recommend tdd-workflow
  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  for (const td of testDirs) {
    try {
      if (fs.statSync(path.join(cwd, td)).isDirectory()) {
        found.add('ecc:tdd-workflow');
        break;
      }
    } catch { /* skip */ }
  }

  return [...found].slice(0, 4);
}

// Read stdin for session_id
let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdinData += chunk; });
process.stdin.on('end', () => {
  let sessionId = '';
  try {
    const input = JSON.parse(stdinData);
    sessionId = input.session_id || '';
  } catch { /* ignore */ }

  const level = getDefaultLevel();

  // 'off' mode — skip activation entirely
  if (level === 'off') {
    if (sessionId) setLevel(sessionId, 'off');
    try { fs.unlinkSync(flagPath); } catch { /* ignore */ }
    process.stdout.write('OK');
    process.exit(0);
  }

  // 1. Write per-session level (session isolation)
  if (sessionId) {
    setLevel(sessionId, level);
  }

  // 2. Write global flag (statusline badge only — not used for enforcement)
  try {
    fs.mkdirSync(path.dirname(flagPath), { recursive: true });
    fs.writeFileSync(flagPath, level);
  } catch { /* Silent — flag is best-effort for statusline */ }

  // 3. Detect project domains
  const detectStart = Date.now();
  const detectedDomains = detectDomains(process.cwd());
  const detectMs = Date.now() - detectStart;

  // Log session activation
  logEvent(sessionId, {
    hook: 'activate',
    action: 'session-start',
    details: {
      level,
      domains: detectedDomains.map(d => d.domain),
      domainCount: detectedDomains.length,
      detectMs,
    },
  });

  // 4. Build context (universal rules + domain rules, budget-managed)
  let output;
  try {
    output = buildContext(level, detectedDomains, pluginRoot);
  } catch {
    output =
      'ENFORCE MODE ACTIVE — level: ' + level + '\n\n' +
      'Universal engineering rules active.\n' +
      '- Research before code (web-search to verify)\n' +
      '- Git discipline (never commit without asking)\n' +
      '- Test before ship (run and show output)\n' +
      '- Pre-completion analysis (walk code paths, security review)\n\n' +
      'Switch level: /enforce solo|team|prod\n' +
      'Stop: "stop enforce" or "normal mode"';
  }

  // 5. Auto-configure unified statusline badge (bundled — no external dependency)
  try {
    const { ensureStatusLine } = require('./enforce-statusline-setup');
    ensureStatusLine();
  } catch { /* Silent — don't block session start */ }

  // 6. Detect project skills and append recommendations to output
  const detectedSkills = detectProjectSkills(process.cwd());
  if (detectedSkills.length > 0) {
    output += '\n\n## Session Skills (auto-detected)\n';
    output += 'These skills are relevant for this project. Load via Skill tool when modifying code:\n';
    detectedSkills.forEach(s => { output += '- /' + s + '\n'; });
    output += '\nInvoke skills proactively — do not wait for hook reminders.';

    // Log detected skills
    logEvent(sessionId, {
      hook: 'activate',
      action: 'skills-detected',
      details: { skills: detectedSkills },
    });
  }

  process.stdout.write(output);
});
