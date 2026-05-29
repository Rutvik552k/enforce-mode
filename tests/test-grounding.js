#!/usr/bin/env node
/**
 * Tests for enforce-grounding.js + write-guard grounding integration.
 *
 * Covers:
 *   - extractApiSymbols: chain depth → confidence, builtin/noise filtering
 *   - groundSymbols: grounded vs ungrounded partition, ratio
 *   - write-guard CHECK 2b: UNVERIFIED escalation only when research exists
 *   - False-positive control: grounded symbols & shallow calls don't escalate
 *   - DEADLOCK SAFETY: solo suppresses, team bounded (no instant T3),
 *                      compliance (researching the symbol) clears violations
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const {
  extractApiSymbols, groundSymbols,
} = require('../hooks/enforce-grounding');
const {
  clearState, setLevel, recordGroundTruth,
  peckEvaluateV2, peckRecordComplianceV2, readState,
} = require('../hooks/enforce-state');

const HOOK = path.join(__dirname, '..', 'hooks', 'enforce-write-guard.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS: ' + name); passed++; }
  catch (e) { console.log('  FAIL: ' + name + ' — ' + e.message); failed++; }
}

function runHook(json) {
  const tmp = path.join(os.tmpdir(), 'enforce-gr-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(tmp, JSON.stringify(json));
  let stdout = '', stderr = '', exitCode = 0;
  try {
    stdout = execSync('node "' + HOOK + '" < "' + tmp + '"', {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], cwd: __dirname,
    });
  } catch (e) {
    exitCode = e.status || 1;
    stdout = e.stdout || '';
    stderr = e.stderr || '';
  }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  return { stdout, stderr, exitCode, all: stdout + stderr };
}

console.log('enforce-grounding tests\n');

// ═══════════════════════════════════════════════════════════════════════════
console.log('── extractApiSymbols ──');

test('deep chain → HIGH confidence', () => {
  const syms = extractApiSymbols('client.chat.completions.create({});');
  const s = syms.find(x => x.full === 'client.chat.completions.create');
  assert.ok(s, 'symbol extracted');
  assert.strictEqual(s.confidence, 'HIGH');
});

test('shallow a.b() → MEDIUM confidence', () => {
  const syms = extractApiSymbols('myclient.connect();');
  const s = syms.find(x => x.full === 'myclient.connect');
  assert.ok(s, 'symbol extracted');
  assert.strictEqual(s.confidence, 'MEDIUM');
});

test('builtin methods filtered (map/then/log/push)', () => {
  const syms = extractApiSymbols('arr.map(x=>x); p.then(f); console.log(1); list.push(2);');
  assert.strictEqual(syms.length, 0, 'no builtin symbols: ' + JSON.stringify(syms.map(s => s.full)));
});

test('noise roots filtered (this/res/console)', () => {
  const syms = extractApiSymbols('this.helper(); res.status(200); console.error(e);');
  assert.strictEqual(syms.length, 0);
});

test('single-char root filtered (loop/lambda vars)', () => {
  const syms = extractApiSymbols('s.charges.create({});');
  assert.strictEqual(syms.length, 0, 'single-char root dropped');
});

test('plain call (no member access) ignored', () => {
  const syms = extractApiSymbols('doThing(); render();');
  assert.strictEqual(syms.length, 0);
});

test('dedupes repeated symbols', () => {
  const syms = extractApiSymbols('stripe.charges.create(); stripe.charges.create();');
  assert.strictEqual(syms.filter(s => s.full === 'stripe.charges.create').length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('── groundSymbols ──');

test('symbol grounded when method appears in docs', () => {
  const syms = extractApiSymbols('stripe.charges.create({});');
  const g = groundSymbols(syms, 'The stripe.charges.create call makes a charge.');
  assert.strictEqual(g.grounded.length, 1);
  assert.strictEqual(g.ungrounded.length, 0);
});

test('hallucinated symbol flagged ungrounded', () => {
  const syms = extractApiSymbols('openai.embeddings.fabricate({});');
  const g = groundSymbols(syms, 'openai embeddings.create returns vectors');
  assert.strictEqual(g.ungrounded.length, 1);
  assert.strictEqual(g.ungrounded[0].full, 'openai.embeddings.fabricate');
});

test('empty symbols → ratio 1 (nothing to ground)', () => {
  const g = groundSymbols([], 'anything');
  assert.strictEqual(g.ratio, 1);
});

test('empty docs → all ungrounded', () => {
  const syms = extractApiSymbols('foo.bar.baz();');
  const g = groundSymbols(syms, '');
  assert.strictEqual(g.grounded.length, 0);
  assert.strictEqual(g.ungrounded.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('── write-guard integration (conditional firing) ──');

test('researched lib + hallucinated symbol → UNVERIFIED advisory', () => {
  const sid = 'gr-int1-' + Date.now();
  clearState(sid);
  setLevel(sid, 'team');
  recordGroundTruth(sid, 'stripe', {
    query: 'stripe charges api docs',
    snippets: ['stripe.charges.create creates a charge object'],
    urls: ['https://stripe.com/docs'],
  });
  const r = runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/src/pay.ts', content:
      'import stripe from "stripe";\nstripe.subscriptions.fabricatePlan({});' },
    transcript_path: '', session_id: sid,
  });
  assert.ok(r.all.includes('UNVERIFIED API symbols'), 'UNVERIFIED flag present: ' + r.all.slice(0, 200));
  assert.ok(r.all.includes('fabricatePlan'), 'names the hallucinated symbol');
  clearState(sid);
});

test('researched lib + grounded symbol → NO UNVERIFIED flag', () => {
  const sid = 'gr-int2-' + Date.now();
  clearState(sid);
  setLevel(sid, 'team');
  recordGroundTruth(sid, 'stripe', {
    query: 'stripe charges api docs',
    snippets: ['stripe.charges.create creates a charge object'],
    urls: ['https://stripe.com/docs'],
  });
  const r = runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/src/pay.ts', content:
      'import stripe from "stripe";\nstripe.charges.create({});' },
    transcript_path: '', session_id: sid,
  });
  assert.ok(!r.all.includes('UNVERIFIED API symbols'), 'no UNVERIFIED for grounded call');
  clearState(sid);
});

test('DEADLOCK SAFETY: solo level suppresses grounding (STRICT)', () => {
  const sid = 'gr-solo-' + Date.now();
  clearState(sid);
  setLevel(sid, 'solo');
  recordGroundTruth(sid, 'stripe', {
    query: 'stripe charges api docs',
    snippets: ['stripe.charges.create creates a charge object'],
    urls: [],
  });
  const r = runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/src/pay.ts', content:
      'import stripe from "stripe";\nstripe.subscriptions.fabricatePlan({});' },
    transcript_path: '', session_id: sid,
  });
  // STRICT severity is suppressed at solo → no grounding escalation, no deny.
  assert.ok(!r.all.includes('UNVERIFIED API symbols'), 'grounding suppressed at solo');
  assert.ok(!r.stdout.includes('"permissionDecision":"deny"'), 'never denies at solo');
  clearState(sid);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('── deadlock safety (PECK contract) ──');

test('solo: grounding STRICT → suppressed (tier path never escalates)', () => {
  const sid = 'gr-peck-solo-' + Date.now();
  clearState(sid);
  const res = peckEvaluateV2(sid, 'grounding', '/a.ts', 'reason', {
    confidence: 'MEDIUM', severity: 'STRICT', level: 'solo',
    source: 'x.y.z()', matchIndex: -1, domainActive: true, patternName: 'g1',
  });
  assert.strictEqual(res.suppressed, true);
  clearState(sid);
});

test('team: first grounding violation is bounded (tier <= 2, not instant T3)', () => {
  const sid = 'gr-peck-team-' + Date.now();
  clearState(sid);
  const res = peckEvaluateV2(sid, 'grounding', '/a.ts', 'reason', {
    confidence: 'MEDIUM', severity: 'STRICT', level: 'team',
    source: 'x.y.z()', matchIndex: -1, domainActive: true, patternName: 'g1',
  });
  assert.ok(res.tier <= 2, 'tier capped at 2 (STRICT@team), got ' + res.tier);
  clearState(sid);
});

test('escape hatch: compliance reduces grounding violation count', () => {
  const sid = 'gr-escape-' + Date.now();
  clearState(sid);
  // Accumulate a couple of violations
  peckEvaluateV2(sid, 'grounding', '/a.ts', 'r', { confidence: 'MEDIUM', severity: 'STRICT', level: 'prod', source: 'x.y.z()', patternName: 'g1' });
  peckEvaluateV2(sid, 'grounding', '/b.ts', 'r', { confidence: 'MEDIUM', severity: 'STRICT', level: 'prod', source: 'a.b.c()', patternName: 'g2' });
  const before = readState(sid).peck.violations['grounding'].count;
  // Researching the symbol = compliance → decays the violation (the escape).
  peckRecordComplianceV2(sid, 'grounding', '/a.ts', 'MEDIUM');
  const after = readState(sid).peck.violations['grounding'].count;
  assert.ok(after < before, 'compliance decays violations: ' + before + ' → ' + after);
  clearState(sid);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
