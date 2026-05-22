#!/usr/bin/env node
/**
 * Tests for PECK v3 features:
 *   - Level-aware severity filtering
 *   - Global safety valve
 *   - Time-based violation decay
 *   - Dynamic budget calculation
 *   - Per-pattern-per-file deduplication
 *   - Inline suppression comments
 *   - Modular domain loading
 */

'use strict';

const assert = require('assert');
const {
  PECK_CONFIG,
  peckEvaluateV2,
  peckTick,
  clearState,
  readState,
  writeState,
  setLevel,
  getLevel,
  isGlobalSafetyValveOpen,
  computeDynamicBudget,
  getMaxTierForLevel,
} = require('../hooks/enforce-state');

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

const SESSION = 'test-peck-v3-' + Date.now();

function cleanup() {
  clearState(SESSION);
}

console.log('PECK v3 engine tests\n');

// ── Level-Aware Severity Filtering ──
console.log('── Level-Aware Severity Filtering ──');

test('WARN severity at solo → tier 0 max (allowed)', () => {
  cleanup();
  const result = peckEvaluateV2(SESSION, 'frontend', '/app.tsx', 'test warn', {
    confidence: 'MEDIUM', severity: 'WARN', level: 'solo', domainActive: true,
  });
  assert.ok(!result.suppressed, 'should not be suppressed');
  assert.strictEqual(result.tier, 0, 'tier should be 0');
});

test('STRICT severity at solo → suppressed', () => {
  cleanup();
  const result = peckEvaluateV2(SESSION, 'frontend', '/app.tsx', 'test strict', {
    confidence: 'HIGH', severity: 'STRICT', level: 'solo', domainActive: true,
  });
  assert.ok(result.suppressed, 'STRICT at solo should be suppressed');
});

test('CRITICAL severity at solo → suppressed', () => {
  cleanup();
  const result = peckEvaluateV2(SESSION, 'frontend', '/app.tsx', 'test critical', {
    confidence: 'HIGH', severity: 'CRITICAL', level: 'solo', domainActive: true,
  });
  assert.ok(result.suppressed, 'CRITICAL at solo should be suppressed');
});

test('STRICT severity at team → allowed (max tier 2)', () => {
  cleanup();
  const result = peckEvaluateV2(SESSION, 'frontend', '/app.tsx', 'test strict team', {
    confidence: 'HIGH', severity: 'STRICT', level: 'team', domainActive: true,
  });
  assert.ok(!result.suppressed, 'STRICT at team should not be suppressed');
  assert.ok(result.tier <= 2, 'max tier should be 2');
});

test('CRITICAL severity at team → allowed (max tier 1)', () => {
  const sess = 'test-crit-team-' + Date.now();
  clearState(sess);
  setLevel(sess, 'team');
  const result = peckEvaluateV2(sess, 'test-crit-team', '/app.tsx', 'test critical team', {
    confidence: 'HIGH', severity: 'CRITICAL', level: 'team', domainActive: true,
  });
  clearState(sess);
  assert.ok(!result.suppressed, 'CRITICAL at team should not be suppressed');
  assert.ok(result.tier <= 1, 'max tier should be 1 at team level, got ' + result.tier);
});

test('CRITICAL severity at prod → allowed (max tier 3)', () => {
  cleanup();
  const result = peckEvaluateV2(SESSION, 'frontend', '/app.tsx', 'test critical prod', {
    confidence: 'HIGH', severity: 'CRITICAL', level: 'prod', domainActive: true,
  });
  assert.ok(!result.suppressed, 'CRITICAL at prod should not be suppressed');
});

test('WARN severity at prod → max tier 1', () => {
  cleanup();
  // Accumulate violations to try to exceed tier 1
  for (let i = 0; i < 5; i++) {
    peckEvaluateV2(SESSION, 'test-warn-prod', '/app.tsx', 'warn prod ' + i, {
      confidence: 'MEDIUM', severity: 'WARN', level: 'prod', domainActive: true,
    });
  }
  const state = readState(SESSION);
  const violation = state.peck.violations['test-warn-prod'];
  assert.ok(violation, 'violation should exist');
  assert.ok(violation.tier <= 1, 'WARN at prod should cap at tier 1');
});

// ── Global Safety Valve ──
console.log('\n── Global Safety Valve ──');

test('safety valve closed when < 5 circuits open', () => {
  cleanup();
  const state = readState(SESSION);
  state.peck.circuits = {
    a: { state: 'OPEN', failures: 5, interveningCalls: 0 },
    b: { state: 'OPEN', failures: 5, interveningCalls: 0 },
    c: { state: 'CLOSED', failures: 0, interveningCalls: 0 },
  };
  writeState(SESSION, state);
  assert.ok(!isGlobalSafetyValveOpen(state), 'should be closed with 2 open');
});

test('safety valve opens at 5+ open circuits', () => {
  cleanup();
  const state = readState(SESSION);
  state.peck.circuits = {};
  for (let i = 0; i < 5; i++) {
    state.peck.circuits['cat' + i] = { state: 'OPEN', failures: 5, interveningCalls: 0 };
  }
  writeState(SESSION, state);
  assert.ok(isGlobalSafetyValveOpen(state), 'should be open with 5 open circuits');
});

test('safety valve returns advisory when tripped', () => {
  cleanup();
  const state = readState(SESSION);
  state.peck.circuits = {};
  for (let i = 0; i < 5; i++) {
    state.peck.circuits['domain' + i] = { state: 'OPEN', failures: 5, interveningCalls: 0 };
  }
  writeState(SESSION, state);
  const result = peckEvaluateV2(SESSION, 'frontend', '/app.tsx', 'test safety', {
    confidence: 'HIGH', severity: 'STRICT', level: 'prod', domainActive: true,
  });
  assert.strictEqual(result.tier, 0, 'safety valve should return tier 0');
  assert.ok(result.message.includes('SAFETY VALVE'), 'message should mention safety valve');
});

// ── Dynamic Budget Calculation ──
console.log('\n── Dynamic Budget Calculation ──');

test('explicit budget overrides dynamic', () => {
  const budget = computeDynamicBudget('blockchain');
  assert.strictEqual(budget, 3, 'blockchain should use explicit budget 3');
});

test('dynamic budget for unknown domain with HIGH patterns', () => {
  const patterns = [
    { confidence: 'HIGH' }, { confidence: 'HIGH' }, { confidence: 'HIGH' },
  ];
  const budget = computeDynamicBudget('unknown-domain', patterns);
  // avg confidence = 1.0, budget = max(2, ceil(3 * 0.0 * 2)) = 2
  assert.strictEqual(budget, 2, 'HIGH-only domain should get budget 2');
});

test('dynamic budget for unknown domain with LOW patterns', () => {
  const patterns = [
    { confidence: 'LOW' }, { confidence: 'LOW' }, { confidence: 'LOW' },
    { confidence: 'LOW' }, { confidence: 'LOW' },
  ];
  const budget = computeDynamicBudget('unknown-domain-low', patterns);
  // avg confidence = 0.25, budget = max(2, ceil(5 * 0.75 * 2)) = 8
  assert.ok(budget >= 5, 'LOW-only domain should get generous budget');
});

test('dynamic budget fallback for no patterns', () => {
  const budget = computeDynamicBudget('no-patterns-domain');
  assert.strictEqual(budget, 3, 'no patterns and no explicit → default 3');
});

// ── getMaxTierForLevel ──
console.log('\n── Level Max Tier Mapping ──');

test('solo WARN → max tier 0', () => {
  assert.strictEqual(getMaxTierForLevel('solo', 'WARN'), 0);
});

test('solo STRICT → suppressed (-1)', () => {
  assert.strictEqual(getMaxTierForLevel('solo', 'STRICT'), -1);
});

test('team CRITICAL → max tier 1', () => {
  assert.strictEqual(getMaxTierForLevel('team', 'CRITICAL'), 1);
});

test('prod CRITICAL → max tier 3', () => {
  assert.strictEqual(getMaxTierForLevel('prod', 'CRITICAL'), 3);
});

test('unknown level → no cap (3)', () => {
  assert.strictEqual(getMaxTierForLevel('unknown', 'STRICT'), 3);
});

// ── Modular Domain Loading ──
console.log('\n── Modular Domain Loading ──');

test('domain modules load from hooks/domains/', () => {
  const fs = require('fs');
  const path = require('path');
  const domainsDir = path.join(__dirname, '..', 'hooks', 'domains');
  const files = fs.readdirSync(domainsDir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 25, 'should have 25+ domain module files, got ' + files.length);
});

test('each domain module has required fields', () => {
  const fs = require('fs');
  const path = require('path');
  const domainsDir = path.join(__dirname, '..', 'hooks', 'domains');
  const files = fs.readdirSync(domainsDir).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const mod = require(path.join(domainsDir, f));
    assert.ok(mod.domain, f + ' missing domain');
    assert.ok(Array.isArray(mod.patterns), f + ' missing patterns array');
    for (const pat of mod.patterns) {
      assert.ok(pat.name, f + ' pattern missing name');
      assert.ok(pat.regex instanceof RegExp, f + ':' + pat.name + ' regex not RegExp');
      assert.ok(pat.confidence, f + ':' + pat.name + ' missing confidence');
      assert.ok(pat.severity, f + ':' + pat.name + ' missing severity');
      assert.ok(Array.isArray(pat.justification), f + ':' + pat.name + ' missing justification');
    }
  }
});

test('all patterns have valid severity values', () => {
  const fs = require('fs');
  const path = require('path');
  const domainsDir = path.join(__dirname, '..', 'hooks', 'domains');
  const valid = ['WARN', 'STRICT', 'CRITICAL'];
  const files = fs.readdirSync(domainsDir).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const mod = require(path.join(domainsDir, f));
    for (const pat of mod.patterns) {
      assert.ok(valid.includes(pat.severity),
        f + ':' + pat.name + ' invalid severity: ' + pat.severity);
    }
  }
});

test('all patterns have valid confidence values', () => {
  const fs = require('fs');
  const path = require('path');
  const domainsDir = path.join(__dirname, '..', 'hooks', 'domains');
  const valid = ['HIGH', 'MEDIUM', 'LOW'];
  const files = fs.readdirSync(domainsDir).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const mod = require(path.join(domainsDir, f));
    for (const pat of mod.patterns) {
      assert.ok(valid.includes(pat.confidence),
        f + ':' + pat.name + ' invalid confidence: ' + pat.confidence);
    }
  }
});

// ── Domain Rule .md File Coverage ──
console.log('\n── Domain Rule File Coverage ──');

test('all 41 domain rule .md files exist', () => {
  const fs = require('fs');
  const path = require('path');
  const rulesDir = path.join(__dirname, '..', 'rules', 'domains');
  const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));
  assert.ok(files.length >= 41, 'expected 41+ .md files, got ' + files.length);
});

test('all domain .md files have severity tags', () => {
  const fs = require('fs');
  const path = require('path');
  const rulesDir = path.join(__dirname, '..', 'rules', 'domains');
  const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const content = fs.readFileSync(path.join(rulesDir, f), 'utf8');
    const hasTag = /\[WARN\]|\[STRICT\]|\[CRITICAL\]/.test(content);
    assert.ok(hasTag, f + ' missing severity tags');
  }
});

// ── Detection V3 ──
console.log('\n── Detection V3 ──');

test('DOMAIN_RULES_V3 has 30 new domains', () => {
  const { DOMAIN_RULES_V3 } = require('../hooks/enforce-detect');
  assert.strictEqual(DOMAIN_RULES_V3.length, 30);
});

test('ALL_DOMAIN_RULES has 41 total', () => {
  const { ALL_DOMAIN_RULES } = require('../hooks/enforce-detect');
  assert.strictEqual(ALL_DOMAIN_RULES.length, 41);
});

// Cleanup
cleanup();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
