#!/usr/bin/env node
/**
 * Tests for PECK v2: Confidence-weighted progressive escalation.
 *
 * Tests:
 *   - Confidence-weighted violation accumulation
 *   - Context detection (comments, tests, types, security files)
 *   - Domain relevance filtering
 *   - Suppression below accumulation threshold
 *   - Accelerated escalation for HIGH confidence
 *   - Semantic retry detection
 *   - LOW confidence circuit breaker bypass
 *   - Weighted compliance decay
 */

'use strict';

const path = require('path');

const {
  clearState, readState, peckEvaluateV2, peckRecordComplianceV2,
  detectContext, isTestFilePath, isSecurityFile, isCommentLine,
  isTypeDefinition, isInsideTryCatch, PECK_CONFIG,
} = require('../hooks/enforce-state');

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

console.log('PECK v2 engine tests\n');

// ── Context Detection ──
console.log('── Context Detection ──');

assert('isTestFilePath: /tests/ path',
  isTestFilePath('/project/tests/test-auth.js') === true);
assert('isTestFilePath: .test. file',
  isTestFilePath('/project/src/auth.test.ts') === true);
assert('isTestFilePath: .spec. file',
  isTestFilePath('/project/src/auth.spec.ts') === true);
assert('isTestFilePath: __tests__ dir',
  isTestFilePath('/project/__tests__/auth.js') === true);
assert('isTestFilePath: normal file',
  isTestFilePath('/project/src/auth.js') === false);

assert('isSecurityFile: auth.js',
  isSecurityFile('/project/src/auth.js') === true);
assert('isSecurityFile: middleware.ts',
  isSecurityFile('/project/src/middleware.ts') === true);
assert('isSecurityFile: guard.py',
  isSecurityFile('/project/guard.py') === true);
assert('isSecurityFile: normal file',
  isSecurityFile('/project/src/utils.js') === false);

assert('isCommentLine: // comment',
  isCommentLine('  // this is a comment') === true);
assert('isCommentLine: # comment',
  isCommentLine('  # python comment') === true);
assert('isCommentLine: /* comment',
  isCommentLine('  /* block comment */') === true);
assert('isCommentLine: normal code',
  isCommentLine('  const x = 1;') === false);

assert('isTypeDefinition: interface',
  isTypeDefinition('interface UserProps {') === true);
assert('isTypeDefinition: type alias',
  isTypeDefinition('type Config = {') === true);
assert('isTypeDefinition: normal code',
  isTypeDefinition('const config = {};') === false);

assert('isInsideTryCatch: code after try {',
  isInsideTryCatch('function x() {\n  try {\n    dangerousOp();\n  }', 30) === true);
assert('isInsideTryCatch: code not in try',
  isInsideTryCatch('function x() {\n  dangerousOp();\n}', 20) === false);

// Context multiplier integration
assert('detectContext: test file → 0.0',
  detectContext('const x = eval(y);', '/project/tests/test.js', 10) === 0.0);
assert('detectContext: security file → 1.5',
  detectContext('const x = eval(y);', '/project/src/auth.js', 10) === 1.5);
assert('detectContext: normal file → 1.0',
  detectContext('const x = eval(y);', '/project/src/utils.js', 10) === 1.0);

// ── Confidence Weighted Evaluation ──
console.log('\n── Confidence Weighted Evaluation ──');

const SID_V2 = 'peckv2-test-' + Date.now();
clearState(SID_V2);

// LOW confidence in test file → suppressed (effectiveWeight = 0.25 * 0.0 = 0.0)
let r = peckEvaluateV2(SID_V2, 'frontend', '/tests/test.tsx', 'missing key prop', {
  confidence: 'LOW',
  source: '<Component />',
  matchIndex: 0,
  domainActive: true,
  patternName: 'List render without key prop',
});
assert('LOW confidence in test file → suppressed', r.suppressed === true);

clearState(SID_V2);

// LOW confidence in normal file → below threshold (0.25 * 1.0 * 1.0 = 0.25 < 0.5)
r = peckEvaluateV2(SID_V2, 'frontend', '/src/app.tsx', 'missing key prop', {
  confidence: 'LOW',
  source: 'items.map(i => <Item />)',
  matchIndex: 0,
  domainActive: true,
  patternName: 'List render without key prop',
});
assert('LOW confidence normal file → advisory only (never escalates)',
  r.tier === 0 && r.effectiveWeight < PECK_CONFIG.accumulationThreshold);

clearState(SID_V2);

// MEDIUM confidence, domain active → standard escalation (0.5 * 1.0 * 1.0 = 0.5 = threshold)
r = peckEvaluateV2(SID_V2, 'frontend', '/src/app.tsx', 'XSS risk', {
  confidence: 'MEDIUM',
  source: 'dangerouslySetInnerHTML={{__html: data}}',
  matchIndex: 0,
  domainActive: true,
  patternName: 'dangerouslySetInnerHTML without sanitization',
});
assert('MEDIUM confidence domain active → tier 0 (accumulates)',
  r.tier === 0 && r.effectiveWeight >= PECK_CONFIG.accumulationThreshold);

clearState(SID_V2);

// HIGH confidence → accelerated escalation (1.0 * 1.0 * 1.0 = 1.0 > 0.75)
r = peckEvaluateV2(SID_V2, 'blockchain', '/contracts/Vault.sol', 'reentrancy', {
  confidence: 'HIGH',
  source: 'addr.call{value: amt}("");\nbalances[msg.sender] = 0;',
  matchIndex: 0,
  domainActive: true,
  patternName: 'Reentrancy: external call before state update',
});
assert('HIGH confidence first violation → tier 1 (accelerated, skips tier 0)',
  r.tier >= 1 && r.effectiveWeight >= PECK_CONFIG.acceleratedThreshold);

clearState(SID_V2);

// ── Domain Relevance ──
console.log('\n── Domain Relevance ──');

const SID_DR = 'peckv2-domain-' + Date.now();
clearState(SID_DR);

// Domain NOT active, extension doesn't match → suppressed (0.5 * 1.0 * 0.0 = 0.0)
r = peckEvaluateV2(SID_DR, 'blockchain', '/src/utils.js', 'gas issue', {
  confidence: 'MEDIUM',
  source: 'for (uint i = 0; i < arr.length; i++)',
  matchIndex: 0,
  domainActive: false,
  patternName: 'Unbounded loop over dynamic array',
});
assert('domain not active + no ext match → suppressed', r.suppressed === true || r.effectiveWeight === 0);

clearState(SID_DR);

// Domain NOT active (even with matching ext) → suppressed (caller responsible for relevance)
r = peckEvaluateV2(SID_DR, 'blockchain', '/contracts/Vault.sol', 'gas issue', {
  confidence: 'MEDIUM',
  source: 'for (uint i = 0; i < arr.length; i++)',
  matchIndex: 0,
  domainActive: false,
  patternName: 'Unbounded loop over dynamic array',
});
assert('domain not active → suppressed (domainActive=false always suppresses)',
  r.suppressed === true);

clearState(SID_DR);

// ── Weighted Compliance Decay ──
console.log('\n── Weighted Compliance Decay ──');

const SID_WC = 'peckv2-compliance-' + Date.now();
clearState(SID_WC);

// Build up violations
peckEvaluateV2(SID_WC, 'frontend', '/src/app.tsx', 'test', {
  confidence: 'MEDIUM', source: 'test', matchIndex: 0, domainActive: true,
});
peckEvaluateV2(SID_WC, 'frontend', '/src/app.tsx', 'test', {
  confidence: 'MEDIUM', source: 'test', matchIndex: 0, domainActive: true,
});
let stateWC = readState(SID_WC);
const countBefore = stateWC.peck.violations.frontend.count;

// HIGH confidence compliance → stronger decay (1 * (1 + 1.0) = 2.0)
peckRecordComplianceV2(SID_WC, 'frontend', '/src/app.tsx', 'HIGH');
stateWC = readState(SID_WC);
const decayAmount = countBefore - stateWC.peck.violations.frontend.count;
assert('HIGH compliance decay > 1.0', decayAmount >= 1.5);

clearState(SID_WC);

// LOW confidence compliance → weaker decay (1 * (1 + 0.25) = 1.25)
peckEvaluateV2(SID_WC, 'frontend', '/src/app.tsx', 'test', {
  confidence: 'MEDIUM', source: 'test', matchIndex: 0, domainActive: true,
});
peckEvaluateV2(SID_WC, 'frontend', '/src/app.tsx', 'test', {
  confidence: 'MEDIUM', source: 'test', matchIndex: 0, domainActive: true,
});
stateWC = readState(SID_WC);
const countBefore2 = stateWC.peck.violations.frontend.count;

peckRecordComplianceV2(SID_WC, 'frontend', '/src/app.tsx', 'LOW');
stateWC = readState(SID_WC);
const decayAmount2 = countBefore2 - stateWC.peck.violations.frontend.count;
assert('LOW compliance decay < HIGH compliance decay', decayAmount2 < decayAmount);

clearState(SID_WC);

// ── LOW Confidence Circuit Breaker Bypass ──
console.log('\n── LOW Confidence Circuit Breaker Bypass ──');

const SID_CB = 'peckv2-circuit-' + Date.now();
clearState(SID_CB);

// Force circuit open for a category with HIGH confidence violations
for (let i = 0; i < 5; i++) {
  peckEvaluateV2(SID_CB, 'blockchain', '/contracts/Vault.sol', 'test', {
    confidence: 'HIGH', source: 'test', matchIndex: 0, domainActive: true,
  });
}
const stateCB = readState(SID_CB);
assert('circuit opens after HIGH confidence failures',
  stateCB.peck.circuits.blockchain && stateCB.peck.circuits.blockchain.state === 'OPEN');

// LOW confidence on same category → bypasses circuit (advisory, not hard block)
r = peckEvaluateV2(SID_CB, 'blockchain', '/contracts/Other.sol', 'low conf test', {
  confidence: 'LOW', source: 'test', matchIndex: 0, domainActive: true,
});
assert('LOW confidence bypasses open circuit', r.tier < 3);

clearState(SID_CB);

// ── Split Security Categories ──
console.log('\n── Split Security Categories ──');

const SID_SEC = 'peckv2-security-' + Date.now();
clearState(SID_SEC);

// security-secrets has budget=1
r = peckEvaluateV2(SID_SEC, 'security-secrets', '/config.js', 'hardcoded key', {
  confidence: 'HIGH', source: 'const k = "AKIA..."', matchIndex: 0, domainActive: true,
});
assert('security-secrets budget=1 → high tier immediately', r.tier >= 2);

clearState(SID_SEC);

// security-patterns has budget=3 → more room
r = peckEvaluateV2(SID_SEC, 'security-patterns', '/src/api.js', 'eval usage', {
  confidence: 'MEDIUM', source: 'eval(userInput)', matchIndex: 0, domainActive: true,
});
assert('security-patterns first violation → tier 0 (budget=3)', r.tier === 0);

clearState(SID_SEC);

// ── Semantic Retry Detection ──
console.log('\n── Semantic Retry v2 ──');

const SID_SR = 'peckv2-retry-' + Date.now();
clearState(SID_SR);

// First violation
peckEvaluateV2(SID_SR, 'frontend', '/src/app.tsx', 'XSS', {
  confidence: 'MEDIUM', source: 'dangerous', matchIndex: 0, domainActive: true,
  patternName: 'dangerouslySetInnerHTML without sanitization',
});

// Same pattern name, same file, within 60s → semantic retry (1.5x)
r = peckEvaluateV2(SID_SR, 'frontend', '/src/app.tsx', 'XSS again', {
  confidence: 'MEDIUM', source: 'dangerous again', matchIndex: 0, domainActive: true,
  patternName: 'dangerouslySetInnerHTML without sanitization',
});
const stateSR = readState(SID_SR);
// Count should be > 1.0 (first) + 0.5 (MEDIUM weight for semantic retry)
assert('semantic retry increments more than base', stateSR.peck.violations.frontend.count > 1.0);

clearState(SID_SR);

// ── Comment Context Suppression ──
console.log('\n── Comment Context Suppression ──');

const SID_COM = 'peckv2-comment-' + Date.now();
clearState(SID_COM);

// Code in comment → context multiplier = 0.0 → suppressed
const commentSource = '// dangerouslySetInnerHTML={{__html: data}}\nconst x = 1;';
r = peckEvaluateV2(SID_COM, 'frontend', '/src/app.tsx', 'XSS in comment', {
  confidence: 'MEDIUM',
  source: commentSource,
  matchIndex: 3, // inside the comment line
  domainActive: true,
  patternName: 'dangerouslySetInnerHTML without sanitization',
});
assert('pattern in comment line → suppressed or zero weight',
  r.suppressed === true || r.effectiveWeight === 0);

clearState(SID_COM);

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
