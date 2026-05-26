#!/usr/bin/env node
/**
 * test-session-log.js — E2E tests for enforce-session-log.js
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
  clearState, setLevel, logEvent, recordGTCScore,
  readState, writeState, recordGroundTruth,
} = require('../hooks/enforce-state');

const LOG_FILE = path.join(process.cwd(), '.claude', 'session_logs.md');
try { fs.unlinkSync(LOG_FILE); } catch {}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS: ' + msg); passed++; }
  else { console.log('  FAIL: ' + msg); failed++; }
}

function runSessionLog(sessionId) {
  return spawnSync('node', [path.join('hooks', 'enforce-session-log.js')], {
    input: JSON.stringify({ session_id: sessionId }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
  });
}

function readLog() {
  return fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
}

function logSize() {
  try { return fs.statSync(LOG_FILE).size; } catch { return 0; }
}

console.log('Session Log E2E Tests\n');

// ═══════════════════════════════════════════
// TEST 1: Log file created on first response
// ═══════════════════════════════════════════
console.log('-- Test 1: Log file creation --');
{
  const sid = 'e2e-log-1-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');
  logEvent(sid, { hook: 'activate', action: 'session-start', file: '', result: 'started', details: { level: 'prod', domains: ['frontend', 'api-security'], domainCount: 3, detectMs: 42 } });
  logEvent(sid, { hook: 'write-guard', action: 'pass', file: '/tmp/app.ts', result: 'clean' });

  const r = runSessionLog(sid);
  assert(r.status === 0, 'hook exits cleanly');
  assert(fs.existsSync(LOG_FILE), 'session_logs.md created');

  const content = readLog();
  assert(content.includes('# Session:'), 'has session header');
  assert(content.includes('frontend, api-security'), 'has detected domains');
  assert(content.includes('prod'), 'has level');
  assert(content.includes(sid.substring(0, 12)), 'has session ID marker');
  assert(content.includes('write-guard'), 'has hook events');
  assert(content.includes('pass'), 'has pass action');
  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 2: Appends without duplicate header
// ═══════════════════════════════════════════
console.log('-- Test 2: Append without duplicate header --');
{
  const sid = 'e2e-log-2-' + Date.now();
  clearState(sid);
  setLevel(sid, 'team');

  // First response
  logEvent(sid, { hook: 'activate', action: 'session-start', file: '', result: 'started', details: { level: 'team', domains: [], domainCount: 0, detectMs: 10 } });
  logEvent(sid, { hook: 'write-guard', action: 'pass', file: '/tmp/index.js', result: 'clean' });
  runSessionLog(sid);

  // Clear log (simulates stop-guard)
  const state = readState(sid);
  state.log = [];
  writeState(sid, state);

  // Second response
  logEvent(sid, { hook: 'skill-loader', action: 'escalate', file: '/tmp/page.tsx', result: 'no-skills' });
  logEvent(sid, { hook: 'domain-guard', action: 'warn', file: '/tmp/page.tsx', result: 'frontend-xss' });
  runSessionLog(sid);

  const content = readLog();
  const headerCount = (content.match(/<!-- session:/g) || []).length;
  // Could be 2 headers (different sessions) — check THIS session has exactly 1
  const thisSessionHeaders = (content.match(new RegExp('<!-- session:' + sid, 'g')) || []).length;
  assert(thisSessionHeaders === 1, 'only one header for this session');
  assert(content.includes('skill-loader'), 'second response events appended');
  assert(content.includes('domain-guard'), 'domain-guard event logged');
  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 3: GTC score logged
// ═══════════════════════════════════════════
console.log('-- Test 3: GTC score in log --');
{
  const sid = 'e2e-log-3-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');
  logEvent(sid, { hook: 'write-guard', action: 'pass', file: '/tmp/api.ts', result: 'clean' });
  recordGTCScore(sid, { score: 85, breakdown: { researchCov: 28, docAlign: 17, searchSpec: 18, skillComp: 12, testCov: 15, violationPenalty: -5, dlPenalty: 0 } });

  runSessionLog(sid);
  const content = readLog();
  assert(content.includes('85/100'), 'GTC score logged');
  assert(content.includes('research:28/30'), 'GTC breakdown logged');
  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 4: Violations and dead letters
// ═══════════════════════════════════════════
console.log('-- Test 4: Violations + dead letters --');
{
  const sid = 'e2e-log-4-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');
  logEvent(sid, { hook: 'write-guard', action: 'block', file: '/tmp/secrets.js', result: 'secrets-blocked' });

  const state = readState(sid);
  state.peck.violations['research-mandatory'] = { count: 3, tier: 2 };
  state.peck.deadLetters.push({ category: 'security-secrets', file: '/tmp/secrets.js', reason: 'AWS key detected', timestamp: Date.now() });
  writeState(sid, state);

  runSessionLog(sid);
  const content = readLog();
  assert(content.includes('research-mandatory: tier 2'), 'violation logged with tier');
  assert(content.includes('Blocked actions:** 1'), 'dead letter count logged');
  assert(content.includes('security-secrets'), 'dead letter category logged');
  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 5: Research capture logged
// ═══════════════════════════════════════════
console.log('-- Test 5: Research capture --');
{
  const sid = 'e2e-log-5-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');
  logEvent(sid, { hook: 'research-capture', action: 'capture', file: 'WebSearch', result: 'captured', details: { libs: ['prisma', 'zod'], snippetCount: 4, urlCount: 2 } });
  logEvent(sid, { hook: 'write-guard', action: 'pass', file: '/tmp/db.ts', result: 'ground-truth-ok' });
  recordGroundTruth(sid, 'prisma', { query: 'prisma docs', snippets: ['prisma.user.findMany()'], urls: ['https://prisma.io'] });

  runSessionLog(sid);
  const content = readLog();
  assert(content.includes('prisma, zod'), 'captured libraries logged');
  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 6: Empty log → no entry
// ═══════════════════════════════════════════
console.log('-- Test 6: Empty log skipped --');
{
  const sid = 'e2e-log-6-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');
  // No logEvent calls

  const sizeBefore = logSize();
  runSessionLog(sid);
  const sizeAfter = logSize();
  assert(sizeBefore === sizeAfter, 'no entry for empty log');
  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 7: Inactive session → no entry
// ═══════════════════════════════════════════
console.log('-- Test 7: Inactive session skipped --');
{
  const sid = 'e2e-log-7-' + Date.now();
  clearState(sid);
  setLevel(sid, 'off');
  logEvent(sid, { hook: 'test', action: 'test', file: 'test', result: 'test' });

  const sizeBefore = logSize();
  runSessionLog(sid);
  const sizeAfter = logSize();
  assert(sizeBefore === sizeAfter, 'inactive session no log');
  clearState(sid);
}

// ═══════════════════════════════════════════
// CLEANUP + RESULTS
// ═══════════════════════════════════════════
try { fs.unlinkSync(LOG_FILE); } catch {}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
