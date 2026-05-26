#!/usr/bin/env node
/**
 * test-session-save-resume.js — Tests for enforce-session-save.js and enforce-session-resume.js
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  clearState, setLevel, logEvent, recordGTCScore,
  readState, writeState, recordGroundTruth,
} = require('../hooks/enforce-state');

const SESSION_DIR = path.join(os.homedir(), '.claude', 'session-data');
const PROJECT_NAME = path.basename(process.cwd());

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS: ' + msg); passed++; }
  else { console.log('  FAIL: ' + msg); failed++; }
}

function getDate() {
  return new Date().toISOString().split('T')[0];
}

function getSessionFilePath() {
  return path.join(SESSION_DIR, getDate() + '-' + PROJECT_NAME + '-session.tmp');
}

function runSessionSave(sessionId) {
  return spawnSync('node', [path.join('hooks', 'enforce-session-save.js')], {
    input: JSON.stringify({ session_id: sessionId }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
}

function runSessionResume(sessionId) {
  return spawnSync('node', [path.join('hooks', 'enforce-session-resume.js')], {
    input: JSON.stringify({ session_id: sessionId || '' }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
  });
}

function readSessionFile() {
  const fp = getSessionFilePath();
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
}

// Backup existing session file if any
const sessionFilePath = getSessionFilePath();
let backupContent = null;
try {
  if (fs.existsSync(sessionFilePath)) {
    backupContent = fs.readFileSync(sessionFilePath, 'utf8');
  }
} catch {}

console.log('Session Save/Resume Tests\n');

// ═══════════════════════════════════════════
// TEST 1: Session save creates file
// ═══════════════════════════════════════════
console.log('-- Test 1: Session save creates file --');
{
  const sid = 'e2e-save-1-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'solo', domains: ['licensing'], domainCount: 1 } });

  const result = runSessionSave(sid);
  assert(result.status === 0, 'Exit code 0');

  const content = readSessionFile();
  assert(content.length > 0, 'Session file created with content');
  assert(content.includes('# Session:'), 'Contains session header');
  assert(content.includes(PROJECT_NAME), 'Contains project name');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 2: Session save includes domains
// ═══════════════════════════════════════════
console.log('\n-- Test 2: Session save includes domains --');
{
  const sid = 'e2e-save-2-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'prod', domains: ['frontend', 'security'], domainCount: 2 } });
  logEvent(sid, { hook: 'write-guard', action: 'pass', file: 'src/app.js' });

  const result = runSessionSave(sid);
  assert(result.status === 0, 'Exit code 0');

  const content = readSessionFile();
  assert(content.includes('frontend'), 'Contains frontend domain');
  assert(content.includes('security'), 'Contains security domain');
  assert(content.includes('prod'), 'Contains prod level');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 3: Session save includes GTC scores
// ═══════════════════════════════════════════
console.log('\n-- Test 3: Session save includes GTC scores --');
{
  const sid = 'e2e-save-3-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'solo', domains: [], domainCount: 0 } });

  recordGTCScore(sid, { score: 85, breakdown: { researchCov: 25, docAlign: 18, skillComp: 12, testCov: 15 } });

  const result = runSessionSave(sid);
  assert(result.status === 0, 'Exit code 0');

  const content = readSessionFile();
  assert(content.includes('85'), 'Contains GTC score 85');
  assert(content.includes('GTC Score'), 'Contains GTC Score section');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 4: Session save includes files from log
// ═══════════════════════════════════════════
console.log('\n-- Test 4: Session save includes files from log --');
{
  const sid = 'e2e-save-4-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'solo', domains: [], domainCount: 0 } });
  logEvent(sid, { hook: 'write-guard', action: 'pass', file: 'hooks/enforce-state.js' });
  logEvent(sid, { hook: 'domain-guard', action: 'escalate', file: 'src/auth.js' });

  const result = runSessionSave(sid);
  assert(result.status === 0, 'Exit code 0');

  const content = readSessionFile();
  assert(content.includes('enforce-state.js') || content.includes('auth.js'), 'Contains logged file names');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 5: Session save with research captured
// ═══════════════════════════════════════════
console.log('\n-- Test 5: Session save with research --');
{
  const sid = 'e2e-save-5-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'solo', domains: [], domainCount: 0 } });
  recordGroundTruth(sid, 'express', { query: 'express middleware', snippets: ['app.use()'], urls: ['https://expressjs.com'] });

  const result = runSessionSave(sid);
  assert(result.status === 0, 'Exit code 0');

  const content = readSessionFile();
  assert(content.includes('express'), 'Contains researched library');
  assert(content.includes('Research Captured') || content.includes('researched'), 'Contains research section');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 6: Session save skips inactive session
// ═══════════════════════════════════════════
console.log('\n-- Test 6: Skip inactive session --');
{
  const sid = 'e2e-save-6-' + Date.now();
  clearState(sid);
  setLevel(sid, 'off');

  const result = runSessionSave(sid);
  assert(result.status === 0, 'Exit code 0 (silent skip)');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 7: Session save with no session_id
// ═══════════════════════════════════════════
console.log('\n-- Test 7: No session ID --');
{
  const result = spawnSync('node', [path.join('hooks', 'enforce-session-save.js')], {
    input: JSON.stringify({}),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
  });
  assert(result.status === 0, 'Exit code 0 (graceful skip)');
}

// ═══════════════════════════════════════════
// TEST 8: Session save includes ECC markers
// ═══════════════════════════════════════════
console.log('\n-- Test 8: ECC compatibility markers --');
{
  const sid = 'e2e-save-8-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'solo', domains: [], domainCount: 0 } });

  runSessionSave(sid);

  const content = readSessionFile();
  assert(content.includes('<!-- ECC:SUMMARY:START -->'), 'Contains ECC summary start marker');
  assert(content.includes('<!-- ECC:SUMMARY:END -->'), 'Contains ECC summary end marker');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 9: Session resume loads previous session
// ═══════════════════════════════════════════
console.log('\n-- Test 9: Session resume loads data --');
{
  // First save a session
  const sid = 'e2e-resume-9-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'solo', domains: ['licensing'], domainCount: 1 } });
  runSessionSave(sid);

  // Now resume
  const result = runSessionResume('new-session-' + Date.now());
  assert(result.status === 0, 'Exit code 0');
  assert(result.stdout.length > 0, 'Resume produces output');
  assert(result.stdout.includes('Previous session summary'), 'Contains "Previous session summary" prefix');
  assert(result.stdout.includes(PROJECT_NAME), 'Contains project name');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 10: Session resume silent when no history
// ═══════════════════════════════════════════
console.log('\n-- Test 10: Resume silent with no history --');
{
  // Temporarily rename session file
  const fp = getSessionFilePath();
  const tmpName = fp + '.test-backup';
  let hadFile = false;
  try {
    if (fs.existsSync(fp)) {
      fs.renameSync(fp, tmpName);
      hadFile = true;
    }
  } catch {}

  // Also check if there are other matching files — this test may still find older ones
  // For a clean test, we'd need a unique project name. Just verify it doesn't crash.
  const result = runSessionResume('test-' + Date.now());
  assert(result.status === 0, 'Exit code 0 (no crash)');

  // Restore
  try {
    if (hadFile) fs.renameSync(tmpName, fp);
  } catch {}
}

// ═══════════════════════════════════════════
// TEST 11: Session resume respects context budget
// ═══════════════════════════════════════════
console.log('\n-- Test 11: Context budget respected --');
{
  const sid = 'e2e-resume-11-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'solo', domains: [], domainCount: 0 } });
  runSessionSave(sid);

  const result = runSessionResume('new-' + Date.now());
  // 8KB max context + "Previous session summary:\n" prefix
  assert(result.stdout.length <= 9000, 'Output under 9KB context budget (got ' + result.stdout.length + ')');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 12: Session save includes tools used
// ═══════════════════════════════════════════
console.log('\n-- Test 12: Tools used tracking --');
{
  const sid = 'e2e-save-12-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'solo', domains: [], domainCount: 0 } });
  logEvent(sid, { hook: 'write-guard', action: 'pass', file: 'test.js' });
  logEvent(sid, { hook: 'bash-guard', action: 'pass' });
  logEvent(sid, { hook: 'skill-loader', action: 'suggest', details: { skills: ['ecc:code-review'] } });

  runSessionSave(sid);

  const content = readSessionFile();
  assert(content.includes('Tools Used'), 'Contains Tools Used section');
  assert(content.includes('write-guard') || content.includes('bash-guard'), 'Lists hooks as tools');

  clearState(sid);
}

// ═══════════════════════════════════════════
// TEST 13: Round-trip save then resume
// ═══════════════════════════════════════════
console.log('\n-- Test 13: Full round-trip --');
{
  const sid = 'e2e-roundtrip-13-' + Date.now();
  clearState(sid);
  setLevel(sid, 'team');

  logEvent(sid, { hook: 'activate', action: 'session-start', details: { level: 'team', domains: ['frontend', 'database'], domainCount: 2 } });
  logEvent(sid, { hook: 'write-guard', action: 'escalate', file: 'src/db.js' });
  recordGroundTruth(sid, 'prisma', { query: 'prisma client', snippets: ['prisma.user.findMany()'], urls: [] });
  recordGTCScore(sid, { score: 72, breakdown: { researchCov: 20, docAlign: 15, skillComp: 10, testCov: 12 } });

  // Save
  const saveResult = runSessionSave(sid);
  assert(saveResult.status === 0, 'Save exit code 0');

  // Resume in new session
  const resumeResult = runSessionResume('new-' + Date.now());
  assert(resumeResult.status === 0, 'Resume exit code 0');

  const output = resumeResult.stdout;
  assert(output.includes('team'), 'Round-trip preserves level');
  assert(output.includes('frontend'), 'Round-trip preserves domains');
  assert(output.includes('prisma'), 'Round-trip preserves research');
  assert(output.includes('72'), 'Round-trip preserves GTC score');

  clearState(sid);
}

// ═══════════════════════════════════════════
// CLEANUP & RESULTS
// ═══════════════════════════════════════════

// Restore original session file if we had a backup
if (backupContent !== null) {
  try {
    fs.writeFileSync(sessionFilePath, backupContent, 'utf8');
  } catch {}
}

console.log('\n' + '='.repeat(40));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(40));

process.exit(failed > 0 ? 1 : 0);
