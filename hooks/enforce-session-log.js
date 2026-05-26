#!/usr/bin/env node
/**
 * enforce-session-log.js — Stop hook that persists session activity to .claude/session_logs.md
 *
 * Appends a log entry after every Claude response containing code writes.
 * Creates the file on first write. Keeps a running log per session.
 *
 * LOG STRUCTURE:
 *   - Session header (once): date, level, detected domains
 *   - Per-response entry: timestamp, events, GTC score, violations, research
 *   - Appends — never overwrites previous entries
 *
 * OUTPUT: .claude/session_logs.md in the working directory
 * NEVER BLOCKS — best-effort logging, silent on errors.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  isActive, getLevel, readState, getLog, getGTCScores,
  getResearchedLibs, peckGetSummary, getDeadLetters,
} = require('./enforce-state');

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════

const LOG_DIR = path.join(process.cwd(), '.claude');
const LOG_FILE = path.join(LOG_DIR, 'session_logs.md');
const MAX_LOG_SIZE = 500 * 1024; // 500KB max — rotate if exceeded

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    return true;
  } catch { return false; }
}

function shouldRotate() {
  try {
    if (!fs.existsSync(LOG_FILE)) return false;
    const stat = fs.statSync(LOG_FILE);
    return stat.size > MAX_LOG_SIZE;
  } catch { return false; }
}

function rotateLog() {
  try {
    const rotatedPath = LOG_FILE.replace('.md', '-' + Date.now() + '.md');
    fs.renameSync(LOG_FILE, rotatedPath);
  } catch { /* silent */ }
}

function appendLog(content) {
  try {
    fs.appendFileSync(LOG_FILE, content, 'utf8');
  } catch { /* silent */ }
}

function logExists() {
  try { return fs.existsSync(LOG_FILE); } catch { return false; }
}

/**
 * Check if session header already written for this session.
 * Looks for session ID marker in last 5KB of file.
 */
function hasSessionHeader(sessionId) {
  try {
    if (!fs.existsSync(LOG_FILE)) return false;
    const stat = fs.statSync(LOG_FILE);
    const readSize = Math.min(stat.size, 5000);
    const fd = fs.openSync(LOG_FILE, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    return buf.toString('utf8').includes('<!-- session:' + sessionId + ' -->');
  } catch { return false; }
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

  // Skip if no events this response
  if (!log || log.length === 0) process.exit(0);

  if (!ensureLogDir()) process.exit(0);

  // Rotate if file too large
  if (shouldRotate()) rotateLog();

  const level = getLevel(sessionId) || 'solo';
  const ts = timestamp();

  // ── SESSION HEADER (once per session) ──
  if (!hasSessionHeader(sessionId)) {
    const startEvent = log.find(e => e.hook === 'activate' && e.action === 'session-start');
    const domains = startEvent?.details?.domains || [];
    const domainCount = startEvent?.details?.domainCount || 0;

    let header = '\n# Session: ' + ts.split(' ')[0] + '\n';
    header += '<!-- session:' + sessionId + ' -->\n\n';
    header += '| Field | Value |\n';
    header += '|-------|-------|\n';
    header += '| Started | ' + ts + ' |\n';
    header += '| Level | ' + level + ' |\n';
    header += '| Domains | ' + (domains.length > 0 ? domains.join(', ') : 'none detected') + ' (' + domainCount + ' total) |\n';
    header += '| Session ID | `' + sessionId.substring(0, 12) + '...` |\n\n';
    header += '---\n\n';

    appendLog(header);
  }

  // ── PER-RESPONSE ENTRY ──
  let entry = '### ' + ts + '\n\n';

  // Event summary
  const counts = { pass: 0, warn: 0, escalate: 0, block: 0, capture: 0 };
  const hookEvents = {};
  for (const ev of log) {
    if (counts[ev.action] !== undefined) counts[ev.action]++;
    if (!hookEvents[ev.hook]) hookEvents[ev.hook] = [];
    hookEvents[ev.hook].push(ev);
  }

  entry += '**Events:** ' + log.length + ' total — ';
  entry += Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => v + ' ' + k)
    .join(', ') + '\n\n';

  // Per-hook detail
  if (Object.keys(hookEvents).length > 0) {
    entry += '| Hook | Action | File | Result |\n';
    entry += '|------|--------|------|--------|\n';
    for (const [hook, events] of Object.entries(hookEvents)) {
      for (const ev of events.slice(0, 10)) {
        const file = ev.file ? path.basename(ev.file) : '-';
        entry += '| ' + hook + ' | ' + ev.action + ' | ' + file + ' | ' + (ev.result || '-') + ' |\n';
      }
    }
    entry += '\n';
  }

  // Research captured
  const researchedLibs = getResearchedLibs(sessionId);
  if (researchedLibs.length > 0) {
    const newCaptures = log.filter(e => e.hook === 'research-capture' && e.action === 'capture');
    if (newCaptures.length > 0) {
      const libs = newCaptures.flatMap(e => e.details?.libs || []).slice(0, 10);
      entry += '**Research captured:** ' + libs.join(', ') + '\n\n';
    }
  }

  // GTC score (latest)
  const gtcScores = getGTCScores(sessionId);
  if (gtcScores.length > 0) {
    const latest = gtcScores[gtcScores.length - 1];
    const b = latest.breakdown || {};
    entry += '**GTC Score:** ' + latest.score + '/100';
    if (b.researchCov !== undefined) {
      entry += ' (research:' + b.researchCov + '/30';
      entry += ' docs:' + (b.docAlign || 0) + '/20';
      entry += ' skills:' + (b.skillComp || 0) + '/15';
      entry += ' tests:' + (b.testCov || 0) + '/15)';
    }
    entry += '\n\n';
  }

  // Violations
  const peck = peckGetSummary(sessionId);
  const activeViolations = Object.entries(peck.violations).filter(([, v]) => v.count > 0);
  if (activeViolations.length > 0) {
    entry += '**Violations:**\n';
    for (const [cat, v] of activeViolations) {
      entry += '- ' + cat + ': tier ' + v.tier + ' (' + v.count + '/' + v.budget + ')\n';
    }
    entry += '\n';
  }

  // Dead letters
  if (peck.deadLetterCount > 0) {
    entry += '**Blocked actions:** ' + peck.deadLetterCount + '\n';
    for (const dl of peck.deadLetters.slice(0, 5)) {
      entry += '- [' + dl.category + '] ' + (dl.file || 'unknown') + '\n';
    }
    entry += '\n';
  }

  entry += '---\n\n';

  appendLog(entry);
  process.exit(0);
}

main().catch(() => process.exit(0));
