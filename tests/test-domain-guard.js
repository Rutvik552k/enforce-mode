#!/usr/bin/env node
/**
 * Tests for enforce-domain-guard.js — domain-specific pattern detection.
 *
 * Tests all 6 new domains with:
 *   - True positive cases (should detect violation)
 *   - True negative cases (should NOT detect — justified or exempt)
 *   - Confidence-appropriate responses
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOK = path.join(__dirname, '..', 'hooks', 'enforce-domain-guard.js');
const { clearState } = require('../hooks/enforce-state');

let passed = 0, failed = 0;

function hookTest(name, json, expectExit, expectDeny) {
  const tmpFile = path.join(os.tmpdir(), 'enforce-dg-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(tmpFile, JSON.stringify(json));

  let stdout = '', exitCode = 0;
  try {
    stdout = execSync('node "' + HOOK + '" < "' + tmpFile + '"', {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname, // Use test dir as cwd (no domain detection)
    });
  } catch (e) {
    exitCode = e.status || 1;
    stdout = (e.stdout || '') + (e.stderr || '');
  }
  fs.unlinkSync(tmpFile);

  const hasDeny = stdout.includes('"permissionDecision":"deny"') || stdout.includes('"permissionDecision": "deny"');
  const ok = exitCode === expectExit && hasDeny === expectDeny;

  if (ok) {
    console.log('  PASS: ' + name);
    passed++;
  } else {
    console.log('  FAIL: ' + name + ' (exit=' + exitCode + ' expected=' + expectExit + ', deny=' + hasDeny + ' expected=' + expectDeny + ')');
    if (stdout.length < 300) console.log('    out: ' + stdout.substring(0, 200));
    failed++;
  }
}

console.log('enforce-domain-guard tests\n');

// ── BLOCKCHAIN ──
console.log('── Blockchain ──');

const SID = 'dg-test-' + Date.now();

hookTest('Solidity reentrancy → advisory (first violation)',
  { tool_name: 'Write', tool_input: {
    file_path: '/contracts/Vault.sol',
    content: '(bool success, ) = addr.call{value: amount}("");\nbalances[msg.sender] = 0;'
  }, transcript_path: '', session_id: SID + '-b1' },
  0, false);
clearState(SID + '-b1');

hookTest('Solidity with ReentrancyGuard → pass (justified)',
  { tool_name: 'Write', tool_input: {
    file_path: '/contracts/Vault.sol',
    content: '// nonReentrant modifier applied\n(bool success, ) = addr.call{value: amount}("");\nbalances[msg.sender] = 0;'
  }, transcript_path: '', session_id: SID + '-b2' },
  0, false);
clearState(SID + '-b2');

hookTest('tx.origin usage → advisory',
  { tool_name: 'Write', tool_input: {
    file_path: '/contracts/Auth.sol',
    content: 'require(tx.origin == owner, "not owner");'
  }, transcript_path: '', session_id: SID + '-b3' },
  0, false);
clearState(SID + '-b3');

// ── FRONTEND ──
console.log('\n── Frontend ──');

hookTest('dangerouslySetInnerHTML without sanitization → advisory',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/component.tsx',
    content: '<div dangerouslySetInnerHTML={{__html: userContent}} />'
  }, transcript_path: '', session_id: SID + '-f1' },
  0, false);
clearState(SID + '-f1');

hookTest('dangerouslySetInnerHTML with DOMPurify → pass (justified)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/component.tsx',
    content: '// sanitize with DOMPurify\n<div dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(content)}} />'
  }, transcript_path: '', session_id: SID + '-f2' },
  0, false);
clearState(SID + '-f2');

hookTest('localStorage auth token → advisory',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/auth.ts',
    content: "localStorage.setItem('token', response.jwt);"
  }, transcript_path: '', session_id: SID + '-f3' },
  0, false);
clearState(SID + '-f3');

hookTest('img without alt → advisory',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/page.tsx',
    content: '<img src="/hero.png" className="w-full" />'
  }, transcript_path: '', session_id: SID + '-f4' },
  0, false);
clearState(SID + '-f4');

hookTest('img with alt → pass',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/page.tsx',
    content: '<img src="/hero.png" alt="Hero banner" className="w-full" />'
  }, transcript_path: '', session_id: SID + '-f5' },
  0, false);
clearState(SID + '-f5');

// ── MOBILE ──
console.log('\n── Mobile ──');

hookTest('addEventListener without cleanup → advisory',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/screen.tsx',
    content: "window.addEventListener('resize', handleResize);"
  }, transcript_path: '', session_id: SID + '-m1' },
  0, false);
clearState(SID + '-m1');

hookTest('addEventListener with removeEventListener nearby → pass',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/screen.tsx',
    content: "window.addEventListener('resize', handleResize);\nreturn () => window.removeEventListener('resize', handleResize);"
  }, transcript_path: '', session_id: SID + '-m2' },
  0, false);
clearState(SID + '-m2');

// ── RESEARCH PAPER ──
console.log('\n── Research Paper ──');

hookTest('SOTA claim without citation → advisory',
  { tool_name: 'Write', tool_input: {
    file_path: '/paper/results.tex',
    content: 'Our method outperforms all existing baselines on CIFAR-10.'
  }, transcript_path: '', session_id: SID + '-r1' },
  0, false);
clearState(SID + '-r1');

hookTest('SOTA claim with citation → pass',
  { tool_name: 'Write', tool_input: {
    file_path: '/paper/results.tex',
    content: 'Our method outperforms all existing baselines \\cite{Smith2024} on CIFAR-10.'
  }, transcript_path: '', session_id: SID + '-r2' },
  0, false);
clearState(SID + '-r2');

// ── MODEL TRAINING ──
console.log('\n── Model Training ──');

hookTest('Adam without scheduler → advisory',
  { tool_name: 'Write', tool_input: {
    file_path: '/train.py',
    content: 'optimizer = Adam(model.parameters(), lr=0.001)\nfor epoch in range(100):'
  }, transcript_path: '', session_id: SID + '-t1' },
  0, false);
clearState(SID + '-t1');

hookTest('Adam with warmup scheduler → pass',
  { tool_name: 'Write', tool_input: {
    file_path: '/train.py',
    content: 'optimizer = Adam(model.parameters(), lr=0.001)\nscheduler = CosineAnnealingLR(optimizer)\n'
  }, transcript_path: '', session_id: SID + '-t2' },
  0, false);
clearState(SID + '-t2');

// ── BOOK GENERATION ──
console.log('\n── Book Generation ──');

hookTest('TODO in content → advisory (HIGH confidence)',
  { tool_name: 'Write', tool_input: {
    file_path: '/chapters/ch3.md',
    content: '## Results\n\nTODO: add benchmark results here\n'
  }, transcript_path: '', session_id: SID + '-bk1' },
  0, false);
clearState(SID + '-bk1');

hookTest('Chapter reference → advisory (LOW confidence)',
  { tool_name: 'Write', tool_input: {
    file_path: '/chapters/ch5.md',
    content: 'As described in Chapter 3, the algorithm works by...\n'
  }, transcript_path: '', session_id: SID + '-bk2' },
  0, false);
clearState(SID + '-bk2');

// ── SELF-EXEMPTION ──
console.log('\n── Self-Exemption ──');

hookTest('test file exempt from domain checks',
  { tool_name: 'Write', tool_input: {
    file_path: '/tests/test-vault.sol',
    content: '(bool success, ) = addr.call{value: amount}("");\nbalances[msg.sender] = 0;'
  }, transcript_path: '', session_id: SID + '-ex1' },
  0, false);
clearState(SID + '-ex1');

hookTest('hook file exempt from domain checks',
  { tool_name: 'Write', tool_input: {
    file_path: '/enforce-mode/hooks/new-guard.js',
    content: "localStorage.setItem('token', jwt);"
  }, transcript_path: '', session_id: SID + '-ex2' },
  0, false);
clearState(SID + '-ex2');

// ── NON-MATCHING (True Negatives) ──
console.log('\n── True Negatives ──');

hookTest('normal JS code → no violation',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/utils.js',
    content: 'function add(a, b) { return a + b; }\nmodule.exports = { add };'
  }, transcript_path: '', session_id: SID + '-tn1' },
  0, false);
clearState(SID + '-tn1');

hookTest('Python with proper training setup → no violation',
  { tool_name: 'Write', tool_input: {
    file_path: '/train.py',
    content: 'optimizer = Adam(model.parameters(), lr=0.001)\nscheduler = OneCycleLR(optimizer)\nloss.backward()\ntorch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)\noptimizer.step()'
  }, transcript_path: '', session_id: SID + '-tn2' },
  0, false);
clearState(SID + '-tn2');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
