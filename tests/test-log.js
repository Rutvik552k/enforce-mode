#!/usr/bin/env node
/**
 * Tests for enforce-state.js — event logging API
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS: ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL: ' + name + ' — ' + e.message);
    failed++;
  }
}

// Use a unique session ID for each test run
const testSession = 'test-log-' + Date.now();

function cleanup() {
  const { clearState } = require('../hooks/enforce-state');
  clearState(testSession);
}

console.log('enforce-state logging tests\n');

// Fresh require to avoid cache issues
function freshState() {
  delete require.cache[require.resolve('../hooks/enforce-state')];
  return require('../hooks/enforce-state');
}

const state = freshState();

// ── logEvent basics ──

test('logEvent writes event to session state', () => {
  cleanup();
  state.setLevel(testSession, 'solo');
  state.logEvent(testSession, { hook: 'test-hook', action: 'pass', file: 'foo.js' });
  const log = state.getLog(testSession);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].hook, 'test-hook');
  assert.strictEqual(log[0].action, 'pass');
  assert.strictEqual(log[0].file, 'foo.js');
  assert.ok(log[0].ts > 0, 'should have timestamp');
});

test('logEvent appends multiple events', () => {
  cleanup();
  state.setLevel(testSession, 'solo');
  state.logEvent(testSession, { hook: 'a', action: 'pass' });
  state.logEvent(testSession, { hook: 'b', action: 'warn' });
  state.logEvent(testSession, { hook: 'c', action: 'block' });
  const log = state.getLog(testSession);
  assert.strictEqual(log.length, 3);
  assert.strictEqual(log[0].hook, 'a');
  assert.strictEqual(log[1].hook, 'b');
  assert.strictEqual(log[2].hook, 'c');
});

test('logEvent preserves details and result fields', () => {
  cleanup();
  state.setLevel(testSession, 'solo');
  state.logEvent(testSession, {
    hook: 'domain-guard',
    action: 'escalate',
    file: 'auth.js',
    result: 'auth/reentrancy/tier1',
    details: { violations: 2, severity: 'STRICT' },
  });
  const log = state.getLog(testSession);
  assert.strictEqual(log[0].result, 'auth/reentrancy/tier1');
  assert.strictEqual(log[0].details.violations, 2);
  assert.strictEqual(log[0].details.severity, 'STRICT');
});

// ── clearLog ──

test('clearLog empties the log', () => {
  cleanup();
  state.setLevel(testSession, 'solo');
  state.logEvent(testSession, { hook: 'a', action: 'pass' });
  state.logEvent(testSession, { hook: 'b', action: 'warn' });
  assert.strictEqual(state.getLog(testSession).length, 2);
  state.clearLog(testSession);
  assert.strictEqual(state.getLog(testSession).length, 0);
});

test('clearLog does not affect other state fields', () => {
  cleanup();
  state.setLevel(testSession, 'team');
  state.logEvent(testSession, { hook: 'x', action: 'pass' });
  state.clearLog(testSession);
  assert.strictEqual(state.getLevel(testSession), 'team');
});

// ── getLog edge cases ──

test('getLog returns empty array for no session', () => {
  const log = state.getLog('');
  assert.deepStrictEqual(log, []);
});

test('getLog returns empty array for unknown session', () => {
  const log = state.getLog('nonexistent-session-' + Date.now());
  assert.deepStrictEqual(log, []);
});

// ── logEvent edge cases ──

test('logEvent is no-op for empty sessionId', () => {
  // Should not throw
  state.logEvent('', { hook: 'test', action: 'pass' });
});

test('logEvent caps at MAX_LOG_ENTRIES', () => {
  cleanup();
  state.setLevel(testSession, 'solo');
  // Write 60 events (cap is 50)
  for (let i = 0; i < 60; i++) {
    state.logEvent(testSession, { hook: 'bulk', action: 'pass', result: 'event-' + i });
  }
  const log = state.getLog(testSession);
  assert.ok(log.length <= 50, 'log should be capped at 50, got ' + log.length);
  // Should keep the latest entries
  assert.strictEqual(log[log.length - 1].result, 'event-59');
});

// ── readState backward compat ──

test('readState initializes log as empty array for legacy state files', () => {
  // Simulate a legacy state file without log field
  const statePath = state.getStatePath(testSession);
  fs.writeFileSync(statePath, JSON.stringify({ level: 'solo', pending: [] }));
  const s = state.readState(testSession);
  assert.ok(Array.isArray(s.log), 'log should be initialized as array');
  assert.strictEqual(s.log.length, 0);
  cleanup();
});

// ── Cleanup ──
cleanup();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
