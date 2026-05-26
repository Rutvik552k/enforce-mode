#!/usr/bin/env node
/**
 * test-gtc.js — Tests for Ground Truth Confidence scoring + research capture
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

// Direct require of enforce-state
const {
  readState, writeState, clearState, getStatePath,
  recordGroundTruth, getGroundTruth, getResearchedLibs,
  recordGTCScore, getGTCScores, computeGTC, formatGTC,
  PECK_CONFIG,
} = require('../hooks/enforce-state');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log('  PASS: ' + msg);
    passed++;
  } else {
    console.log('  FAIL: ' + msg);
    failed++;
  }
}

function setup(sessionId) {
  clearState(sessionId);
}

console.log('Ground Truth Confidence (GTC) tests\n');

// ═══════════════════════════════════════════════════════════
// Ground Truth Storage
// ═══════════════════════════════════════════════════════════

console.log('── Ground Truth Storage ──');

const sid = 'test-gtc-' + Date.now();
setup(sid);

recordGroundTruth(sid, 'axios', {
  query: 'axios npm documentation',
  snippets: ['axios.get(url, config)', 'axios.post(url, data)'],
  urls: ['https://axios-http.com/docs/intro'],
});

const gt = getGroundTruth(sid, 'axios');
assert(gt !== null, 'recordGroundTruth stores entry');
assert(gt.query === 'axios npm documentation', 'query preserved');
assert(gt.snippets.length === 2, 'snippets preserved');
assert(gt.urls.length === 1, 'urls preserved');
assert(typeof gt.ts === 'number', 'timestamp recorded');

assert(getGroundTruth(sid, 'nonexistent') === null, 'missing lib returns null');

const libs = getResearchedLibs(sid);
assert(libs.includes('axios'), 'getResearchedLibs includes recorded lib');

// Test snippet truncation
const longSnippet = 'x'.repeat(1000);
recordGroundTruth(sid, 'biglib', {
  query: 'biglib docs',
  snippets: [longSnippet],
  urls: [],
});
const bigGt = getGroundTruth(sid, 'biglib');
assert(bigGt.snippets[0].length <= 500, 'snippets truncated to 500 chars');

// Test max entries cap
for (let i = 0; i < 35; i++) {
  recordGroundTruth(sid, 'lib-' + i, { query: 'lib-' + i, snippets: [], urls: [] });
}
const allLibs = getResearchedLibs(sid);
assert(allLibs.length <= 30, 'max 30 ground truth entries (cap enforced)');

// ═══════════════════════════════════════════════════════════
// GTC Score Computation
// ═══════════════════════════════════════════════════════════

console.log('── GTC Score Computation ──');

const sid2 = 'test-gtc-compute-' + Date.now();
setup(sid2);

// No code, no libs → perfect score
const gtc1 = computeGTC(sid2, {
  externalLibs: [],
  apiCalls: [],
  skillsRequired: [],
  skillsLoaded: [],
  testsRun: true,
});
assert(gtc1.score === 100, 'no external libs + tests → 100');
assert(gtc1.label === 'HIGH', 'label = HIGH');

// External libs with no research → low score
const gtc2 = computeGTC(sid2, {
  externalLibs: ['axios', 'lodash'],
  apiCalls: ['axios.get', 'lodash.map'],
  skillsRequired: ['ecc:code-review'],
  skillsLoaded: [],
  testsRun: false,
});
assert(gtc2.score < 50, 'no research + no tests + no skills → FAIL (<50)');
assert(gtc2.label === 'FAIL', 'label = FAIL');
assert(gtc2.breakdown.researchCov === 0, 'research coverage = 0');
assert(gtc2.breakdown.testCov === 0, 'test coverage = 0');
assert(gtc2.breakdown.skillComp === 0, 'skill compliance = 0');

// Record ground truth for one lib
recordGroundTruth(sid2, 'axios', {
  query: 'axios documentation api',
  snippets: ['axios.get(url)', 'axios.post(url, data)'],
  urls: ['https://axios-http.com'],
});

const gtc3 = computeGTC(sid2, {
  externalLibs: ['axios', 'lodash'],
  apiCalls: ['axios.get'],
  skillsRequired: ['ecc:code-review'],
  skillsLoaded: ['ecc:code-review'],
  testsRun: true,
});
assert(gtc3.breakdown.researchCov === 15, 'half libs researched → 15/30');
assert(gtc3.breakdown.skillComp === 15, 'skill loaded → 15/15');
assert(gtc3.breakdown.testCov === 15, 'tests run → 15/15');
assert(gtc3.breakdown.docAlign === 20, 'API found in snippets → 20/20');
assert(gtc3.score >= 50, 'partial research + tests + skills → score >= 50');

// Full research → high score
recordGroundTruth(sid2, 'lodash', {
  query: 'lodash documentation map',
  snippets: ['lodash.map(collection, iteratee)'],
  urls: [],
});

const gtc4 = computeGTC(sid2, {
  externalLibs: ['axios', 'lodash'],
  apiCalls: ['axios.get', 'lodash.map'],
  skillsRequired: ['ecc:code-review'],
  skillsLoaded: ['ecc:code-review'],
  testsRun: true,
});
assert(gtc4.score >= 90, 'full research + tests + skills → HIGH (>= 90)');
assert(gtc4.label === 'HIGH', 'label = HIGH');

// ═══════════════════════════════════════════════════════════
// Violation Penalties
// ═══════════════════════════════════════════════════════════

console.log('── Violation Penalties ──');

const sid3 = 'test-gtc-penalties-' + Date.now();
setup(sid3);

// Add violations to state
const state3 = readState(sid3);
state3.peck.violations['research'] = { count: 2, tier: 1 };
state3.peck.deadLetters.push({ category: 'test', file: 'foo.js', reason: 'test', timestamp: Date.now() });
writeState(sid3, state3);

const gtc5 = computeGTC(sid3, {
  externalLibs: [],
  apiCalls: [],
  skillsRequired: [],
  skillsLoaded: [],
  testsRun: true,
});
assert(gtc5.breakdown.violationPenalty < 0, 'violations reduce score');
assert(gtc5.breakdown.dlPenalty === -15, 'dead letter penalty = -15');
assert(gtc5.score < 100, 'penalties reduce total score');

// ═══════════════════════════════════════════════════════════
// GTC Score History
// ═══════════════════════════════════════════════════════════

console.log('── GTC Score History ──');

const sid4 = 'test-gtc-history-' + Date.now();
setup(sid4);

recordGTCScore(sid4, { score: 85, breakdown: { researchCov: 30 } });
recordGTCScore(sid4, { score: 72, breakdown: { researchCov: 20 } });
const scores = getGTCScores(sid4);
assert(scores.length === 2, 'two scores recorded');
assert(scores[0].score === 85, 'first score preserved');
assert(scores[1].score === 72, 'second score preserved');
assert(typeof scores[0].ts === 'number', 'timestamp recorded');

// Cap test
for (let i = 0; i < 25; i++) {
  recordGTCScore(sid4, { score: 50 + i, breakdown: {} });
}
assert(getGTCScores(sid4).length <= 20, 'max 20 GTC scores (cap enforced)');

// ═══════════════════════════════════════════════════════════
// Format GTC
// ═══════════════════════════════════════════════════════════

console.log('── GTC Formatting ──');

const formatted = formatGTC({
  score: 78,
  label: 'GOOD',
  breakdown: {
    researchCov: 25, searchSpec: 15, docAlign: 10,
    skillComp: 15, testCov: 15, violationPenalty: -2, dlPenalty: 0,
  },
});
assert(formatted.includes('GTC: 78/100'), 'format includes score');
assert(formatted.includes('GOOD'), 'format includes label');
assert(formatted.includes('Research: 25/30'), 'format includes research');
assert(formatted.includes('Tests: 15/15'), 'format includes tests');

// ═══════════════════════════════════════════════════════════
// Research-Mandatory Budget
// ═══════════════════════════════════════════════════════════

console.log('── Research-Mandatory Budget ──');

assert(PECK_CONFIG.categoryBudgets['research-mandatory'] === 1, 'research-mandatory budget = 1');

// ═══════════════════════════════════════════════════════════
// State Backward Compatibility
// ═══════════════════════════════════════════════════════════

console.log('── State Backward Compatibility ──');

const sid5 = 'test-gtc-compat-' + Date.now();
const statePath = getStatePath(sid5);
// Write old-format state without groundTruth
fs.writeFileSync(statePath, JSON.stringify({ level: 'solo', pending: [], researched: [], peck: {} }));
const oldState = readState(sid5);
assert(typeof oldState.groundTruth === 'object', 'legacy state gets empty groundTruth');
assert(Array.isArray(oldState.gtcScores), 'legacy state gets empty gtcScores');
assert(Object.keys(oldState.groundTruth).length === 0, 'groundTruth starts empty');

// Cleanup
clearState(sid);
clearState(sid2);
clearState(sid3);
clearState(sid4);
clearState(sid5);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
