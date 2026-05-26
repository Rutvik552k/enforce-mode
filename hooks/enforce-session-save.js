#!/usr/bin/env node
/**
 * enforce-session-save.js — Stop hook that auto-saves session summary
 *
 * Saves rich session data to ~/.claude/session-data/YYYY-MM-DD-<project>-session.tmp
 * so the next session can resume with full context.
 *
 * Captures:
 *   - Project name, branch, worktree path
 *   - Files modified (from git diff + state log)
 *   - Tools used (from state log events)
 *   - Violations, GTC scores, research captured
 *   - Session stats (event counts, duration)
 *
 * OUTPUT: ~/.claude/session-data/<date>-<project>-session.tmp
 * NEVER BLOCKS — best-effort saving, silent on errors.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
  isActive, getLevel, readState, getLog, getGTCScores,
  getResearchedLibs, peckGetSummary, getDeadLetters,
} = require('./enforce-state');

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════

const SESSION_DIR = path.join(os.homedir(), '.claude', 'session-data');
const MAX_SESSION_SIZE = 50 * 1024; // 50KB max per session file

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function getProjectName() {
  return path.basename(process.cwd());
}

function getDate() {
  const d = new Date();
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function ensureSessionDir() {
  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    return true;
  } catch { return false; }
}

function gitCommand(cmd) {
  try {
    return execSync(cmd, { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 }).trim();
  } catch { return ''; }
}

function getGitBranch() {
  return gitCommand('git rev-parse --abbrev-ref HEAD') || 'unknown';
}

function getGitModifiedFiles() {
  // Get files changed in this session — both staged and unstaged
  const diff = gitCommand('git diff --name-only HEAD 2>/dev/null');
  const staged = gitCommand('git diff --name-only --cached 2>/dev/null');
  const untracked = gitCommand('git ls-files --others --exclude-standard 2>/dev/null');

  const files = new Set();
  for (const line of [...diff.split('\n'), ...staged.split('\n'), ...untracked.split('\n')]) {
    const f = line.trim();
    if (f) files.add(f);
  }
  return [...files];
}

function getRecentCommits(n) {
  const log = gitCommand(`git log --oneline -${n} 2>/dev/null`);
  return log ? log.split('\n').filter(l => l.trim()) : [];
}

// ═══════════════════════════════════════════════════════════
// EXTRACT SESSION DATA FROM STATE
// ═══════════════════════════════════════════════════════════

function extractToolsUsed(log) {
  const tools = new Set();
  for (const ev of log) {
    if (ev.hook) tools.add(ev.hook);
  }
  return [...tools];
}

function extractFilesFromLog(log) {
  const files = new Set();
  for (const ev of log) {
    if (ev.file) files.add(ev.file);
    if (ev.details?.file) files.add(ev.details.file);
  }
  return [...files];
}

function extractTasks(log) {
  // Extract unique actions as pseudo-tasks
  const tasks = [];
  const seen = new Set();
  for (const ev of log) {
    const key = ev.hook + ':' + ev.action;
    if (!seen.has(key)) {
      seen.add(key);
      tasks.push(ev.action);
    }
  }
  return tasks;
}

// ═══════════════════════════════════════════════════════════
// BUILD SESSION SUMMARY
// ═══════════════════════════════════════════════════════════

function buildSessionSummary(sessionId, state, log) {
  const project = getProjectName();
  const branch = getGitBranch();
  const date = getDate();
  const ts = timestamp();
  const level = getLevel(sessionId) || 'solo';
  const cwd = process.cwd();

  // Gather data
  const gitFiles = getGitModifiedFiles();
  const logFiles = extractFilesFromLog(log);
  const allFiles = [...new Set([...gitFiles, ...logFiles])];
  const tools = extractToolsUsed(log);
  const recentCommits = getRecentCommits(5);
  const researchedLibs = getResearchedLibs(sessionId);
  const gtcScores = getGTCScores(sessionId);
  const peck = peckGetSummary(sessionId);

  // Detect domains from state
  const startEvent = log.find(e => e.hook === 'activate' && e.action === 'session-start');
  const domains = startEvent?.details?.domains || [];

  let summary = '';

  // ── Header ──
  summary += '# Session: ' + date + '\n';
  summary += '**Date:** ' + date + '\n';
  summary += '**Started:** ' + ts.split(' ')[1] + '\n';
  summary += '**Last Updated:** ' + ts + '\n';
  summary += '**Project:** ' + project + '\n';
  summary += '**Branch:** ' + branch + '\n';
  summary += '**Worktree:** ' + cwd + '\n';
  summary += '**Level:** ' + level + '\n';
  if (domains.length > 0) {
    summary += '**Domains:** ' + domains.join(', ') + '\n';
  }

  summary += '\n---\n';

  // ── Summary markers (for ECC compatibility) ──
  summary += '<!-- ECC:SUMMARY:START -->\n';
  summary += '## Session Summary\n\n';

  // ── Files Modified ──
  if (allFiles.length > 0) {
    summary += '### Files Modified\n';
    for (const f of allFiles.slice(0, 30)) {
      summary += '- ' + f + '\n';
    }
    if (allFiles.length > 30) {
      summary += '- ...and ' + (allFiles.length - 30) + ' more\n';
    }
    summary += '\n';
  }

  // ── Recent Commits ──
  if (recentCommits.length > 0) {
    summary += '### Recent Commits\n';
    for (const c of recentCommits) {
      summary += '- ' + c + '\n';
    }
    summary += '\n';
  }

  // ── Research Captured ──
  if (researchedLibs.length > 0) {
    summary += '### Research Captured\n';
    summary += 'Libraries with ground truth: ' + researchedLibs.join(', ') + '\n\n';
  }

  // ── GTC Scores ──
  if (gtcScores.length > 0) {
    const latest = gtcScores[gtcScores.length - 1];
    summary += '### GTC Score (latest)\n';
    summary += '- Score: ' + latest.score + '/100\n';
    if (latest.breakdown) {
      const b = latest.breakdown;
      summary += '- Research: ' + (b.researchCov || 0) + '/30\n';
      summary += '- Docs: ' + (b.docAlign || 0) + '/20\n';
      summary += '- Skills: ' + (b.skillComp || 0) + '/15\n';
      summary += '- Tests: ' + (b.testCov || 0) + '/15\n';
    }
    summary += '\n';
  }

  // ── Violations ──
  const activeViolations = Object.entries(peck.violations).filter(([, v]) => v.count > 0);
  if (activeViolations.length > 0) {
    summary += '### Violations\n';
    for (const [cat, v] of activeViolations) {
      summary += '- ' + cat + ': tier ' + v.tier + ' (' + v.count + '/' + v.budget + ')\n';
    }
    summary += '\n';
  }

  // ── Dead Letters ──
  if (peck.deadLetterCount > 0) {
    summary += '### Blocked Actions\n';
    for (const dl of peck.deadLetters.slice(0, 5)) {
      summary += '- [' + dl.category + '] ' + (dl.file || 'unknown') + '\n';
    }
    summary += '\n';
  }

  // ── Tools Used ──
  if (tools.length > 0) {
    summary += '### Tools Used\n';
    summary += tools.join(', ') + '\n\n';
  }

  // ── Stats ──
  summary += '### Stats\n';
  summary += '- Total events: ' + log.length + '\n';
  summary += '- Total PECK calls: ' + peck.totalCalls + '\n';
  if (researchedLibs.length > 0) {
    summary += '- Libraries researched: ' + researchedLibs.length + '\n';
  }

  summary += '<!-- ECC:SUMMARY:END -->\n\n';

  // ── Notes for Next Session ──
  summary += '### Notes for Next Session\n';
  summary += '-\n\n';

  summary += '### Context to Load\n';
  summary += '```\n';
  if (allFiles.length > 0) {
    for (const f of allFiles.slice(0, 10)) {
      summary += f + '\n';
    }
  } else {
    summary += '[relevant files]\n';
  }
  summary += '```\n';

  return summary;
}

// ═══════════════════════════════════════════════════════════
// FIND EXISTING SESSION FILE (for update)
// ═══════════════════════════════════════════════════════════

function getSessionFilePath() {
  const project = getProjectName();
  const date = getDate();
  return path.join(SESSION_DIR, date + '-' + project + '-session.tmp');
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
  const sessionId = input.session_id || '';

  if (!sessionId || !isActive(sessionId)) process.exit(0);

  const state = readState(sessionId);
  const log = getLog(sessionId);

  // Build summary even with few events — capture git state
  if (!ensureSessionDir()) process.exit(0);

  const summary = buildSessionSummary(sessionId, state, log);

  // Truncate if too large
  const content = summary.length > MAX_SESSION_SIZE
    ? summary.substring(0, MAX_SESSION_SIZE) + '\n\n[TRUNCATED — exceeded 50KB limit]\n'
    : summary;

  const filePath = getSessionFilePath();

  try {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch { /* silent — best effort */ }

  process.exit(0);
}

main().catch(() => process.exit(0));
