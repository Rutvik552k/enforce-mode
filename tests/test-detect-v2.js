#!/usr/bin/env node
/**
 * Tests for enforce-detect.js — v2 domain detection (6 new domains).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectDomains, DOMAIN_RULES_V2, ALL_DOMAIN_RULES } = require('../hooks/enforce-detect');

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

function createTempProject(files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-v2-'));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content || '');
  }
  return tmpDir;
}

function cleanupTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
}

console.log('enforce-detect v2 tests\n');

// Test structure
test('DOMAIN_RULES_V2 has 6 new domains', () => {
  assert.strictEqual(DOMAIN_RULES_V2.length, 6);
  const names = DOMAIN_RULES_V2.map(r => r.domain);
  assert.ok(names.includes('blockchain'));
  assert.ok(names.includes('frontend'));
  assert.ok(names.includes('mobile'));
  assert.ok(names.includes('research-paper'));
  assert.ok(names.includes('model-training'));
  assert.ok(names.includes('book-generation'));
});

test('ALL_DOMAIN_RULES has 41 total domains (5 v1 + 6 v2 + 30 v3)', () => {
  assert.strictEqual(ALL_DOMAIN_RULES.length, 41);
});

// ── Blockchain detection ──
test('detects blockchain from hardhat.config.js + .sol files', () => {
  const tmpDir = createTempProject({
    'hardhat.config.js': 'module.exports = {}',
    'contracts/Vault.sol': 'pragma solidity ^0.8.0;',
    'package.json': JSON.stringify({ dependencies: { hardhat: '^2.0', '@openzeppelin/contracts': '^5.0' } }),
  });
  try {
    const result = detectDomains(tmpDir);
    const bc = result.find(d => d.domain === 'blockchain');
    assert.ok(bc, 'blockchain should be detected');
    assert.ok(bc.score >= 3, 'score should meet threshold, got ' + bc.score);
  } finally { cleanupTempDir(tmpDir); }
});

// ── Frontend detection ──
test('detects frontend from next.config.js + react deps', () => {
  const tmpDir = createTempProject({
    'next.config.js': 'module.exports = {}',
    'package.json': JSON.stringify({ dependencies: { react: '^18', next: '^14' } }),
    'src/app.tsx': '',
    'components/.gitkeep': '',
  });
  try {
    const result = detectDomains(tmpDir);
    const fe = result.find(d => d.domain === 'frontend');
    assert.ok(fe, 'frontend should be detected');
    assert.ok(fe.score >= 2, 'score should meet threshold');
  } finally { cleanupTempDir(tmpDir); }
});

// ── Mobile detection ──
test('detects mobile from react-native + android/ios dirs', () => {
  const tmpDir = createTempProject({
    'package.json': JSON.stringify({ dependencies: { 'react-native': '^0.72', expo: '^49' } }),
    'android/.gitkeep': '',
    'ios/.gitkeep': '',
  });
  try {
    const result = detectDomains(tmpDir);
    const mob = result.find(d => d.domain === 'mobile');
    assert.ok(mob, 'mobile should be detected');
    assert.ok(mob.score >= 3, 'score should meet threshold');
  } finally { cleanupTempDir(tmpDir); }
});

// ── Research paper detection ──
test('detects research-paper from .tex + .bib files', () => {
  const tmpDir = createTempProject({
    'main.tex': '\\documentclass{article}',
    'references.bib': '@article{Smith2024,}',
    'figures/.gitkeep': '',
  });
  try {
    const result = detectDomains(tmpDir);
    const rp = result.find(d => d.domain === 'research-paper');
    assert.ok(rp, 'research-paper should be detected');
    assert.ok(rp.score >= 2, 'score should meet threshold');
  } finally { cleanupTempDir(tmpDir); }
});

// ── Model training detection ──
test('detects model-training from wandb + training deps + checkpoints dir', () => {
  const tmpDir = createTempProject({
    'requirements.txt': 'torch>=2.0\ntransformers>=4.30\nwandb>=0.15\npeft>=0.5\n',
    'checkpoints/.gitkeep': '',
    'train.py': 'from transformers import Trainer',
  });
  try {
    const result = detectDomains(tmpDir);
    const mt = result.find(d => d.domain === 'model-training');
    assert.ok(mt, 'model-training should be detected');
    assert.ok(mt.score >= 4, 'score should meet threshold, got ' + mt.score);
  } finally { cleanupTempDir(tmpDir); }
});

// ── Book generation detection ──
test('detects book-generation from SUMMARY.md + chapters dir', () => {
  const tmpDir = createTempProject({
    'SUMMARY.md': '# Summary\n- [Intro](chapters/ch1.md)',
    'chapters/ch1.md': '# Introduction',
    'book.toml': '[book]\ntitle = "My Book"',
  });
  try {
    const result = detectDomains(tmpDir);
    const bk = result.find(d => d.domain === 'book-generation');
    assert.ok(bk, 'book-generation should be detected');
    assert.ok(bk.score >= 2, 'score should meet threshold');
  } finally { cleanupTempDir(tmpDir); }
});

// ── Cross-domain detection ──
test('detects multiple v2 domains simultaneously', () => {
  const tmpDir = createTempProject({
    'package.json': JSON.stringify({
      dependencies: { react: '^18', next: '^14', hardhat: '^2.0', ethers: '^6.0' }
    }),
    'next.config.js': 'module.exports = {}',
    'hardhat.config.js': 'module.exports = {}',
    'contracts/Token.sol': '',
    'components/.gitkeep': '',
  });
  try {
    const result = detectDomains(tmpDir);
    const domains = result.map(d => d.domain);
    assert.ok(domains.includes('frontend'), 'should detect frontend');
    assert.ok(domains.includes('blockchain'), 'should detect blockchain');
  } finally { cleanupTempDir(tmpDir); }
});

// ── No false triggers ──
test('plain Node.js project triggers no v2 domains', () => {
  const tmpDir = createTempProject({
    'package.json': JSON.stringify({ dependencies: { express: '^4.18' } }),
    'src/index.js': 'const app = require("express")();',
  });
  try {
    const result = detectDomains(tmpDir);
    const v2Domains = ['blockchain', 'frontend', 'mobile', 'research-paper', 'model-training', 'book-generation'];
    const falsePositives = result.filter(d => v2Domains.includes(d.domain));
    assert.strictEqual(falsePositives.length, 0, 'should not trigger any v2 domain, got: ' + falsePositives.map(d => d.domain).join(', '));
  } finally { cleanupTempDir(tmpDir); }
});

// ── Legacy compatibility ──
test('original 5 domains still detected', () => {
  const tmpDir = createTempProject({
    'requirements.txt': 'torch>=2.0\ntransformers>=4.30\n'
  });
  try {
    const result = detectDomains(tmpDir);
    const ml = result.find(d => d.domain === 'ml-inference');
    assert.ok(ml, 'ml-inference should still be detected');
  } finally { cleanupTempDir(tmpDir); }
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
