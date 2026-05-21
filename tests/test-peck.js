#!/usr/bin/env node
/**
 * Test PECK engine: Progressive Escalation with Circuit-breaker and K-step recovery.
 *
 * Tests:
 *   - Escalation tiers (0→3)
 *   - Semantic fingerprinting and exact retry detection
 *   - Circuit breaker state transitions
 *   - K-step recovery windows
 *   - Forgiveness decay on compliance
 *   - Dead letter queue
 *   - Integration with hooks (write-guard, dsa-guard, bash-guard)
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');

const STATE = path.join(__dirname, '..', 'hooks', 'enforce-state.js');
const {
  clearState, readState, peckEvaluate, peckRecordCompliance, peckTick,
  peckGetSummary, peckFingerprint, getDeadLetters, PECK_CONFIG,
} = require(STATE);

const HOOKS = path.join(__dirname, '..', 'hooks');
const WG = path.join(HOOKS, 'enforce-write-guard.js');
const DG = path.join(HOOKS, 'enforce-dsa-guard.js');
const BG = path.join(HOOKS, 'enforce-bash-guard.js');

let passed = 0, failed = 0;

function assert(name, condition) {
  if (condition) {
    console.log('  PASS: ' + name);
    passed++;
  } else {
    console.log('  FAIL: ' + name);
    failed++;
  }
}

function hookTest(name, hook, json, expectExit, expectDeny) {
  const tmpFile = path.join(require('os').tmpdir(), 'enforce-peck-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  require('fs').writeFileSync(tmpFile, JSON.stringify(json));

  let stdout = '', exitCode = 0;
  try {
    stdout = execSync('node "' + hook + '" < "' + tmpFile + '"', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    exitCode = e.status || 1;
    stdout = (e.stdout || '') + (e.stderr || '');
  }
  require('fs').unlinkSync(tmpFile);

  const hasDeny = stdout.includes('"permissionDecision":"deny"') || stdout.includes('"permissionDecision": "deny"');
  const ok = exitCode === expectExit && hasDeny === expectDeny;

  if (ok) {
    console.log('  PASS: ' + name);
    passed++;
  } else {
    console.log('  FAIL: ' + name + ' (exit=' + exitCode + ' expected=' + expectExit + ', deny=' + hasDeny + ' expected=' + expectDeny + ')');
    failed++;
  }
}

console.log('PECK engine tests\n');

// ── UNIT TESTS: Core engine ──
console.log('── Escalation Tiers ──');

const SID = 'peck-test-' + Date.now();
clearState(SID);

// First violation → tier 0 (advisory)
let r = peckEvaluate(SID, 'research', 'app.js', 'test violation');
assert('first violation → tier 0', r.tier === 0 && r.action === 'approve_context');

// Second violation → still tier 0 or 1 (budget=3, count=2)
r = peckEvaluate(SID, 'research', 'app.js', 'test violation');
assert('second violation → tier 1 or higher', r.tier >= 1);

// Third+ → tier 2 or 3 (approaching budget)
r = peckEvaluate(SID, 'research', 'app.js', 'test violation');
assert('third violation → tier 2+', r.tier >= 2);

clearState(SID);

console.log('\n── Exact Retry Detection ──');

const SID2 = 'peck-retry-' + Date.now();
clearState(SID2);

// First violation
peckEvaluate(SID2, 'research', 'same.js', 'test');
// Exact retry within 30s → double-counted
r = peckEvaluate(SID2, 'research', 'same.js', 'test');
const state2 = readState(SID2);
assert('exact retry double-counted (count >= 3)', state2.peck.violations.research.count >= 3);

clearState(SID2);

console.log('\n── Semantic Fingerprinting ──');

const fp1 = peckFingerprint('research', 'app.js');
const fp2 = peckFingerprint('research', 'app.js');
const fp3 = peckFingerprint('dsa', 'app.js');
const fp4 = peckFingerprint('research', 'other.js');
assert('same category+file → same fingerprint', fp1 === fp2);
assert('different category → different fingerprint', fp1 !== fp3);
assert('different file → different fingerprint', fp1 !== fp4);

console.log('\n── Circuit Breaker ──');

const SID3 = 'peck-circuit-' + Date.now();
clearState(SID3);

// Burn through budget to open circuit
for (let i = 0; i < 5; i++) {
  peckEvaluate(SID3, 'security', 'vuln.js', 'security issue');
}
const state3 = readState(SID3);
assert('circuit opens after repeated failures', state3.peck.circuits.security.state === 'OPEN');

// Next evaluation on same category → tier 3 (circuit open)
r = peckEvaluate(SID3, 'security', 'other.js', 'different file');
assert('open circuit → tier 3 hard block', r.tier === 3);

clearState(SID3);

console.log('\n── K-Step Recovery ──');

const SID4 = 'peck-recovery-' + Date.now();
clearState(SID4);

// Create violation → starts recovery window
peckEvaluate(SID4, 'research', 'recover.js', 'needs research');
let state4 = readState(SID4);
const recoveryKey = peckFingerprint('research', 'recover.js');
assert('recovery window started', state4.peck.recovery[recoveryKey] !== undefined);
assert('recovery steps = ' + PECK_CONFIG.recoverySteps,
  state4.peck.recovery[recoveryKey].stepsRemaining === PECK_CONFIG.recoverySteps);

// Tick recovery 3 times
peckTick(SID4);
peckTick(SID4);
peckTick(SID4);
state4 = readState(SID4);
assert('recovery steps decremented', state4.peck.recovery[recoveryKey].stepsRemaining === PECK_CONFIG.recoverySteps - 3);

clearState(SID4);

console.log('\n── Recovery Expiry Auto-Escalation ──');

const SID5 = 'peck-expiry-' + Date.now();
clearState(SID5);

// Create violation
peckEvaluate(SID5, 'research', 'expire.js', 'needs research');
let state5 = readState(SID5);
const countBefore = state5.peck.violations.research.count;

// Tick past recovery window
for (let i = 0; i < PECK_CONFIG.recoverySteps + 1; i++) {
  peckTick(SID5);
}
state5 = readState(SID5);
assert('expired recovery auto-escalates violation count', state5.peck.violations.research.count > countBefore);
assert('recovery window removed after expiry', state5.peck.recovery[peckFingerprint('research', 'expire.js')] === undefined);

clearState(SID5);

console.log('\n── Forgiveness Decay ──');

const SID6 = 'peck-decay-' + Date.now();
clearState(SID6);

// Build up violations
peckEvaluate(SID6, 'research', 'decay.js', 'test');
peckEvaluate(SID6, 'research', 'decay.js', 'test');
let state6 = readState(SID6);
const countBeforeCompliance = state6.peck.violations.research.count;

// Record compliance → should decay
peckRecordCompliance(SID6, 'research', 'decay.js');
state6 = readState(SID6);
assert('compliance decays violation count', state6.peck.violations.research.count < countBeforeCompliance);

clearState(SID6);

console.log('\n── Dead Letter Queue ──');

const SID7 = 'peck-dlq-' + Date.now();
clearState(SID7);

// Force to tier 3 (security has budget=1)
peckEvaluate(SID7, 'security', 'dead.js', 'critical security issue');
peckEvaluate(SID7, 'security', 'dead.js', 'still bad');
const deadLetters = getDeadLetters(SID7);
assert('dead letters recorded on tier 3', deadLetters.length > 0);
assert('dead letter has category', deadLetters[0].category === 'security');

clearState(SID7);

console.log('\n── PECK Summary ──');

const SID8 = 'peck-summary-' + Date.now();
clearState(SID8);

peckEvaluate(SID8, 'research', 'sum.js', 'test');
peckEvaluate(SID8, 'dsa', 'algo.js', 'test');
const summary = peckGetSummary(SID8);
assert('summary has violations', Object.keys(summary.violations).length >= 2);
assert('summary has totalCalls', summary.totalCalls === 0); // no ticks called
assert('summary has deadLetterCount', typeof summary.deadLetterCount === 'number');

clearState(SID8);

console.log('\n── Category Budgets ──');

const SID9 = 'peck-budget-' + Date.now();
clearState(SID9);

// Security has budget=1 → should hit tier 3 fast
r = peckEvaluate(SID9, 'security', 'sec.js', 'vuln');
assert('security first violation → already high tier (budget=1)', r.tier >= 2);

clearState(SID9);

// Test budget=2 → should escalate faster than budget=3
const SID10 = 'peck-budget2-' + Date.now();
clearState(SID10);

peckEvaluate(SID10, 'test', 'git commit', 'no tests');
r = peckEvaluate(SID10, 'test', 'git commit', 'no tests');
assert('test category (budget=2) escalates faster', r.tier >= 2);

clearState(SID10);

// ── INTEGRATION TESTS: Hooks use PECK ──
console.log('\n── Integration: write-guard PECK ──');

const SID_WG = 'peck-wg-' + Date.now();
clearState(SID_WG);

// First write with external import → should pass (tier 0, advisory)
hookTest('write-guard: first external import → approve (tier 0)',
  WG, { tool_name: 'Write', tool_input: { file_path: 'app.js', content: 'const express = require("express");' }, transcript_path: '', session_id: SID_WG },
  0, false);

// Second write to DIFFERENT file → should still approve (tier 0-1, not exact retry)
hookTest('write-guard: second import different file → approve (tier 0-1)',
  WG, { tool_name: 'Write', tool_input: { file_path: 'utils.js', content: 'const lodash = require("lodash");' }, transcript_path: '', session_id: SID_WG },
  0, false);

clearState(SID_WG);

console.log('\n── Integration: dsa-guard PECK ──');

const SID_DG = 'peck-dg-' + Date.now();
clearState(SID_DG);

// First DSA violation → tier 0
hookTest('dsa-guard: first violation → approve (tier 0)',
  DG, { tool_name: 'Write', tool_input: { file_path: 'algo.py', content: 'users = User.objects.all()' }, transcript_path: '', session_id: SID_DG },
  0, false);

clearState(SID_DG);

console.log('\n── Integration: bash-guard PECK ──');

const SID_BG = 'peck-bg-' + Date.now();
clearState(SID_BG);

// First git commit without tests → tier 0 (advisory)
hookTest('bash-guard: first git commit no tests → approve (tier 0)',
  BG, { tool_name: 'Bash', tool_input: { command: 'git commit -m "fix"' }, transcript_path: '', session_id: SID_BG },
  0, false);

clearState(SID_BG);

// ── Secrets still hard-block regardless of PECK ──
console.log('\n── Secrets bypass PECK (always exit 2) ──');

hookTest('secrets still hard-block (no PECK)',
  WG, { tool_name: 'Write', tool_input: { file_path: 'config.js', content: 'const key = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";' }, transcript_path: '', session_id: 'peck-secret' },
  2, false);

// ── Exempt paths bypass PECK ──
console.log('\n── Exempt paths bypass PECK ──');

hookTest('hook files exempt from PECK',
  WG, { tool_name: 'Write', tool_input: { file_path: '.claude/hooks/my-hook.js', content: 'const express = require("express");' }, transcript_path: '', session_id: 'peck-exempt' },
  0, false);

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
