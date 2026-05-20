#!/usr/bin/env node
/**
 * Tests for enforce-detect.js — domain detection via weighted signal scoring
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectDomains, DOMAIN_RULES, getPythonDeps, getPackageJsonDeps } = require('../hooks/enforce-detect');

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

/**
 * Create a temporary project directory with given structure
 */
function createTempProject(files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-test-'));

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content || '');
  }

  return tmpDir;
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

console.log('enforce-detect tests\n');

// Test DOMAIN_RULES structure
test('DOMAIN_RULES has 5 domains', () => {
  assert.strictEqual(DOMAIN_RULES.length, 5);
  const names = DOMAIN_RULES.map(r => r.domain);
  assert.ok(names.includes('ml-inference'));
  assert.ok(names.includes('gpu-hardware'));
  assert.ok(names.includes('video-pipeline'));
  assert.ok(names.includes('api-security'));
  assert.ok(names.includes('cost-tracking'));
});

test('each domain rule has threshold and signals', () => {
  for (const rule of DOMAIN_RULES) {
    assert.ok(typeof rule.threshold === 'number', rule.domain + ' missing threshold');
    assert.ok(rule.signals, rule.domain + ' missing signals');
    assert.ok(Array.isArray(rule.signals.deps), rule.domain + ' missing deps');
  }
});

// Test empty project
test('empty project returns no domains', () => {
  const tmpDir = createTempProject({ 'README.md': '# Empty' });
  try {
    const result = detectDomains(tmpDir);
    assert.strictEqual(result.length, 0);
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test ML inference detection
test('detects ml-inference from requirements.txt with torch + transformers', () => {
  const tmpDir = createTempProject({
    'requirements.txt': 'torch>=2.0\ntransformers>=4.30\n'
  });
  try {
    const result = detectDomains(tmpDir);
    const mlDomain = result.find(d => d.domain === 'ml-inference');
    assert.ok(mlDomain, 'ml-inference should be detected');
    assert.ok(mlDomain.score >= 4, 'score should meet threshold');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test API security detection
test('detects api-security from package.json with express + Dockerfile', () => {
  const tmpDir = createTempProject({
    'package.json': JSON.stringify({
      dependencies: { express: '^4.18.0', cors: '^2.8.0' }
    }),
    'Dockerfile': 'FROM node:18\nCOPY . .\nCMD ["node", "server.js"]'
  });
  try {
    const result = detectDomains(tmpDir);
    const apiDomain = result.find(d => d.domain === 'api-security');
    assert.ok(apiDomain, 'api-security should be detected');
    assert.ok(apiDomain.score >= 3, 'score should meet threshold');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test video pipeline detection
test('detects video-pipeline from requirements.txt with ffmpeg-python + moviepy', () => {
  const tmpDir = createTempProject({
    'requirements.txt': 'ffmpeg-python>=0.2\nmoviepy>=1.0\n'
  });
  try {
    const result = detectDomains(tmpDir);
    const videoDomain = result.find(d => d.domain === 'video-pipeline');
    assert.ok(videoDomain, 'video-pipeline should be detected');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test cost-tracking detection
test('detects cost-tracking from terraform directory + boto3', () => {
  const tmpDir = createTempProject({
    'requirements.txt': 'boto3>=1.28\n',
    'terraform/main.tf': 'resource "aws_instance" "ml" {}'
  });
  try {
    const result = detectDomains(tmpDir);
    const costDomain = result.find(d => d.domain === 'cost-tracking');
    assert.ok(costDomain, 'cost-tracking should be detected');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test multiple domains simultaneously
test('detects multiple domains for ML video pipeline project', () => {
  const tmpDir = createTempProject({
    'requirements.txt': 'torch>=2.0\ntransformers>=4.30\nffmpeg-python>=0.2\nmoviepy>=1.0\nopencv-python>=4.8\ndiffusers>=0.20\n',
    'Dockerfile': 'FROM nvidia/cuda:12.0\n',
    'models/.gitkeep': ''
  });
  try {
    const result = detectDomains(tmpDir);
    assert.ok(result.length >= 2, 'should detect at least 2 domains, got ' + result.length);
    const domains = result.map(d => d.domain);
    assert.ok(domains.includes('ml-inference'), 'should detect ml-inference');
    assert.ok(domains.includes('video-pipeline'), 'should detect video-pipeline');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test sorting by score
test('results sorted by score descending', () => {
  const tmpDir = createTempProject({
    'requirements.txt': 'torch>=2.0\ntransformers>=4.30\ndiffusers>=0.20\nffmpeg-python>=0.2\nmoviepy>=1.0\n'
  });
  try {
    const result = detectDomains(tmpDir);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1].score >= result[i].score, 'should be sorted desc');
    }
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test below-threshold project (single weak signal)
test('single weak signal does not trigger domain', () => {
  const tmpDir = createTempProject({
    'requirements.txt': 'pillow>=10.0\n'
  });
  try {
    const result = detectDomains(tmpDir);
    const videoDomain = result.find(d => d.domain === 'video-pipeline');
    assert.ok(!videoDomain, 'video-pipeline should NOT be detected from pillow alone');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test Python dep parser
test('getPythonDeps parses requirements.txt correctly', () => {
  const tmpDir = createTempProject({
    'requirements.txt': '# ML deps\ntorch>=2.0.0\ntransformers==4.30\n-r extra.txt\n\n# comment\nnumpy'
  });
  try {
    const deps = getPythonDeps(tmpDir);
    assert.ok(deps.includes('torch'), 'should find torch');
    assert.ok(deps.includes('transformers'), 'should find transformers');
    assert.ok(deps.includes('numpy'), 'should find numpy');
    assert.ok(!deps.some(d => d.startsWith('#')), 'should skip comments');
    assert.ok(!deps.some(d => d.startsWith('-')), 'should skip flags');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test npm dep parser
test('getPackageJsonDeps parses package.json correctly', () => {
  const tmpDir = createTempProject({
    'package.json': JSON.stringify({
      dependencies: { express: '^4.18.0' },
      devDependencies: { jest: '^29.0.0' }
    })
  });
  try {
    const deps = getPackageJsonDeps(tmpDir);
    assert.ok(deps.includes('express'), 'should find express');
    assert.ok(deps.includes('jest'), 'should find jest');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Test nonexistent directory
test('nonexistent directory returns empty', () => {
  const result = detectDomains('/nonexistent/path/that/does/not/exist');
  assert.strictEqual(result.length, 0);
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
