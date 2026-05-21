#!/usr/bin/env node
/**
 * enforce-state.js — Cross-hook state persistence for two-phase enforcement
 *
 * Phase 1 hooks (PreToolUse) record pending recommendations.
 * Phase 2 hook (Stop) reads them to check compliance.
 *
 * State file: OS temp dir / enforce-{session_id}.json
 * Fields: { level, pending, researched, dsaJustified }
 *
 * PER-SESSION ISOLATION: each session has its own level.
 * Turning enforce off in session A does not affect session B.
 * Global flag (~/.claude/.enforce-active) only used for statusline badge.
 *
 * All operations are fail-safe — state loss = no enforcement (not deadlock).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// State file path
// ---------------------------------------------------------------------------

function getStatePath(sessionId) {
  if (!sessionId) return null;
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `enforce-${safe}.json`);
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

/**
 * @param {string} sessionId
 * @returns {{ pending: Array<{type: string, file: string, patterns: string[], timestamp: number}>, researched: string[], dsaJustified: string[] }}
 */
function readState(sessionId) {
  const empty = { level: null, pending: [], researched: [], dsaJustified: [] };
  const statePath = getStatePath(sessionId);
  if (!statePath) return empty;

  try {
    if (!fs.existsSync(statePath)) return empty;
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      level: data.level || null,
      pending: Array.isArray(data.pending) ? data.pending : [],
      researched: Array.isArray(data.researched) ? data.researched : [],
      dsaJustified: Array.isArray(data.dsaJustified) ? data.dsaJustified : [],
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Write state
// ---------------------------------------------------------------------------

function writeState(sessionId, state) {
  const statePath = getStatePath(sessionId);
  if (!statePath) return;
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch {
    // Silent — state loss is acceptable, deadlock is not
  }
}

// ---------------------------------------------------------------------------
// Record pending recommendation (Phase 1 → state)
// ---------------------------------------------------------------------------

/**
 * @param {string} sessionId
 * @param {'research'|'dsa'} type
 * @param {string} filePath
 * @param {string[]} patterns
 */
function recordPending(sessionId, type, filePath, patterns) {
  const state = readState(sessionId);

  // Deduplicate — same file + type
  const exists = state.pending.some(
    p => p.type === type && p.file === filePath
  );
  if (exists) return;

  state.pending.push({
    type,
    file: filePath,
    patterns,
    timestamp: Date.now(),
  });
  writeState(sessionId, state);
}

// ---------------------------------------------------------------------------
// Record compliance (transcript scan → state)
// ---------------------------------------------------------------------------

function recordResearch(sessionId, tool) {
  const state = readState(sessionId);
  if (!state.researched.includes(tool)) {
    state.researched.push(tool);
    writeState(sessionId, state);
  }
}

function recordDSAJustified(sessionId, filePath) {
  const state = readState(sessionId);
  if (!state.dsaJustified.includes(filePath)) {
    state.dsaJustified.push(filePath);
    writeState(sessionId, state);
  }
}

// ---------------------------------------------------------------------------
// Query unresolved (Phase 2 reads)
// ---------------------------------------------------------------------------

/**
 * @param {string} sessionId
 * @returns {Array<{type: string, file: string, patterns: string[]}>}
 */
function getUnresolved(sessionId) {
  const state = readState(sessionId);
  const hasResearch = state.researched.length > 0;

  return state.pending.filter(p => {
    if (p.type === 'research') return !hasResearch;
    if (p.type === 'dsa') return !state.dsaJustified.includes(p.file);
    return true;
  });
}

/**
 * @param {string} sessionId
 * @returns {{ totalPending: number, unresolvedResearch: number, unresolvedDSA: number, resolvedCount: number }}
 */
function getSummary(sessionId) {
  const state = readState(sessionId);
  const unresolved = getUnresolved(sessionId);

  return {
    totalPending: state.pending.length,
    unresolvedResearch: unresolved.filter(p => p.type === 'research').length,
    unresolvedDSA: unresolved.filter(p => p.type === 'dsa').length,
    resolvedCount: state.pending.length - unresolved.length,
  };
}

// ---------------------------------------------------------------------------
// Per-session level management
// ---------------------------------------------------------------------------

/**
 * Set enforcement level for this session.
 * @param {string} sessionId
 * @param {string} level - 'off'|'solo'|'team'|'prod'
 */
function setLevel(sessionId, level) {
  const state = readState(sessionId);
  state.level = level;
  writeState(sessionId, state);
}

/**
 * Get enforcement level for this session.
 * Returns null if not set (caller should fall back to config default).
 * @param {string} sessionId
 * @returns {string|null}
 */
function getLevel(sessionId) {
  return readState(sessionId).level;
}

/**
 * Check if session is actively enforcing.
 * Returns true if: level not set (default = active) OR level is solo/team/prod.
 * Returns false ONLY if level is explicitly 'off'.
 * This ensures hooks run by default — you must opt OUT, not opt IN.
 * @param {string} sessionId
 * @returns {boolean}
 */
function isActive(sessionId) {
  const level = getLevel(sessionId);
  if (level === 'off') return false;
  return true; // null (not set) or any active level = enforce is on
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function clearState(sessionId) {
  const statePath = getStatePath(sessionId);
  if (!statePath) return;
  try { fs.unlinkSync(statePath); } catch { /* ignore */ }
}

module.exports = {
  getStatePath,
  readState,
  writeState,
  recordPending,
  recordResearch,
  recordDSAJustified,
  getUnresolved,
  getSummary,
  setLevel,
  getLevel,
  isActive,
  clearState,
};
