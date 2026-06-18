#!/usr/bin/env node
/**
 * Tests for enforce-rules.js — rule assembly, level filtering, budget management
 */

'use strict';

const assert = require('assert');
const path = require('path');
const {
  buildContext,
  loadDomainRules,
  UNIVERSAL_RULES,
  LEVEL_HIERARCHY,
  MAX_BUDGET,
  DOMAIN_BUDGET_EACH
} = require('../hooks/enforce-rules');

const pluginRoot = path.resolve(__dirname, '..');

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

console.log('enforce-rules tests\n');

// Test LEVEL_HIERARCHY
test('LEVEL_HIERARCHY has correct ordering', () => {
  assert.strictEqual(LEVEL_HIERARCHY.solo, 0);
  assert.strictEqual(LEVEL_HIERARCHY.team, 1);
  assert.strictEqual(LEVEL_HIERARCHY.prod, 2);
});

// Test UNIVERSAL_RULES structure
test('UNIVERSAL_RULES is non-empty', () => {
  assert.ok(UNIVERSAL_RULES.length > 0);
});

test('each universal rule has id, text, and minLevel', () => {
  for (const rule of UNIVERSAL_RULES) {
    assert.ok(rule.id, 'missing id');
    assert.ok(rule.text, 'missing text');
    assert.ok(rule.minLevel, 'missing minLevel');
    assert.ok(LEVEL_HIERARCHY[rule.minLevel] !== undefined, 'invalid minLevel: ' + rule.minLevel);
  }
});

// Test buildContext with no domains
test('buildContext emits header with level', () => {
  const output = buildContext('solo', [], pluginRoot);
  assert.ok(output.includes('ENFORCE MODE ACTIVE'));
  assert.ok(output.includes('level: solo'));
});

test('buildContext at solo level includes universal rules', () => {
  const output = buildContext('solo', [], pluginRoot);
  assert.ok(output.includes('RESEARCH BEFORE CODE'));
  assert.ok(output.includes('GIT DISCIPLINE'));
  assert.ok(output.includes('TEST BEFORE SHIP'));
});

test('buildContext at solo level excludes team-only rules', () => {
  const output = buildContext('solo', [], pluginRoot);
  assert.ok(!output.includes('SESSION DOCUMENTATION'), 'session docs should not appear at solo');
  assert.ok(!output.includes('PARALLEL EXECUTION'), 'parallel exec should not appear at solo');
});

test('buildContext at team level includes team rules', () => {
  const output = buildContext('team', [], pluginRoot);
  assert.ok(output.includes('SESSION DOCUMENTATION'));
  assert.ok(output.includes('PARALLEL EXECUTION'));
});

test('buildContext at team level excludes prod-only rules', () => {
  const output = buildContext('team', [], pluginRoot);
  assert.ok(!output.includes('FULL SECURITY'), 'full security should not appear at team');
  assert.ok(!output.includes('DSA EFFICIENCY'), 'dsa efficiency should not appear at team');
});

test('buildContext at prod level includes all rules', () => {
  const output = buildContext('prod', [], pluginRoot);
  assert.ok(output.includes('RESEARCH BEFORE CODE'));
  assert.ok(output.includes('SESSION DOCUMENTATION'));
  assert.ok(output.includes('FULL SECURITY'));
  assert.ok(output.includes('DSA EFFICIENCY'));
});

// Test buildContext with domains
test('buildContext includes detected domains in header', () => {
  const domains = [{ domain: 'ml-inference', score: 6 }];
  const output = buildContext('solo', domains, pluginRoot);
  assert.ok(output.includes('domains: ml-inference'));
});

test('buildContext includes domain rule content', () => {
  const domains = [{ domain: 'ml-inference', score: 6 }];
  const output = buildContext('solo', domains, pluginRoot);
  assert.ok(output.includes('ML Inference'), 'should include ml-inference rule content');
});

// Test domain rule level filtering
test('loadDomainRules at solo filters out STRICT and CRITICAL', () => {
  const content = loadDomainRules('ml-inference', 'solo', pluginRoot);
  assert.ok(content, 'should load ml-inference rules');
  assert.ok(content.includes('[WARN]'), 'should include WARN rules');
  assert.ok(!content.includes('[STRICT]'), 'should exclude STRICT at solo');
  assert.ok(!content.includes('[CRITICAL]'), 'should exclude CRITICAL at solo');
});

test('loadDomainRules at team includes STRICT but not CRITICAL', () => {
  const content = loadDomainRules('ml-inference', 'team', pluginRoot);
  assert.ok(content.includes('[WARN]'), 'should include WARN');
  assert.ok(content.includes('[STRICT]'), 'should include STRICT at team');
  assert.ok(!content.includes('[CRITICAL]'), 'should exclude CRITICAL at team');
});

test('loadDomainRules at prod includes all severities', () => {
  const content = loadDomainRules('ml-inference', 'prod', pluginRoot);
  assert.ok(content.includes('[WARN]'));
  assert.ok(content.includes('[STRICT]'));
  assert.ok(content.includes('[CRITICAL]'));
});

// Test all domain files load
test('all 5 domain rule files load successfully', () => {
  const domains = ['ml-inference', 'gpu-hardware', 'video-pipeline', 'api-security', 'cost-tracking'];
  for (const domain of domains) {
    const content = loadDomainRules(domain, 'prod', pluginRoot);
    assert.ok(content, domain + ' should load');
    assert.ok(content.length > 50, domain + ' should have content');
  }
});

// Test nonexistent domain returns null
test('loadDomainRules returns null for nonexistent domain', () => {
  const content = loadDomainRules('nonexistent-domain', 'solo', pluginRoot);
  assert.strictEqual(content, null);
});

// Test context budget
test('buildContext stays within MAX_BUDGET', () => {
  const allDomains = [
    { domain: 'ml-inference', score: 8 },
    { domain: 'gpu-hardware', score: 7 },
    { domain: 'video-pipeline', score: 6 },
    { domain: 'api-security', score: 5 },
    { domain: 'cost-tracking', score: 4 }
  ];
  const output = buildContext('prod', allDomains, pluginRoot);
  assert.ok(output.length <= MAX_BUDGET, 'output (' + output.length + ') exceeds budget (' + MAX_BUDGET + ')');
});

// Test persistence section
test('buildContext includes persistence and anti-patterns', () => {
  const output = buildContext('solo', [], pluginRoot);
  assert.ok(output.includes('Persistence'));
  assert.ok(output.includes('ALWAYS ACTIVE'));
  assert.ok(output.includes('Anti-Patterns'));
});

// Test new governance rules are present at solo and active always-on
test('solo context includes routing, SDLC, anchor-sync, clean-codebase rules', () => {
  const output = buildContext('solo', [], pluginRoot);
  assert.ok(output.includes('DEPARTMENT ROUTING'), 'missing routing rule');
  assert.ok(output.includes('SDLC LOOP'), 'missing SDLC loop rule');
  assert.ok(output.includes('ANCHOR SYNC'), 'missing anchor-sync rule');
  assert.ok(output.includes('CLEAN CODEBASE'), 'missing clean-codebase rule');
});

// Outer task loop moved to the always-on prompt-append channel; no longer a SessionStart rule.
test('TASK LOOP is absent from SessionStart rules at every level', () => {
  assert.ok(!UNIVERSAL_RULES.find(r => r.id === 'task-loop'), 'task-loop rule should be removed from registry');
  for (const level of ['solo', 'team', 'prod']) {
    assert.ok(!buildContext(level, [], pluginRoot).includes('TASK LOOP'), `task-loop should not load at ${level}`);
  }
});

test('anchor-sync and clean-codebase are solo-level (always on)', () => {
  for (const id of ['anchor-sync', 'clean-codebase']) {
    const rule = UNIVERSAL_RULES.find(r => r.id === id);
    assert.ok(rule, id + ' rule missing from registry');
    assert.strictEqual(rule.minLevel, 'solo', id + ' should be solo-level');
  }
});

test('byte budget honored at prod with 5 domains', () => {
  const allDomains = [
    { domain: 'ml-inference', score: 10 },
    { domain: 'gpu-hardware', score: 8 },
    { domain: 'video-pipeline', score: 6 },
    { domain: 'api-security', score: 5 },
    { domain: 'cost-tracking', score: 4 },
  ];
  const bytes = Buffer.byteLength(buildContext('prod', allDomains, pluginRoot), 'utf8');
  assert.ok(bytes <= MAX_BUDGET, 'prod byte size ' + bytes + ' exceeds ' + MAX_BUDGET);
});

// Anchor module
const anchor = require('../hooks/enforce-anchor');
test('enforce-anchor exposes markers and detection API', () => {
  assert.ok(anchor.ANCHOR_START.includes('enforce-anchor:start'));
  assert.ok(anchor.ANCHOR_END.includes('enforce-anchor:end'));
  assert.strictEqual(typeof anchor.hasAnchor, 'function');
  assert.strictEqual(typeof anchor.readAnchor, 'function');
});

test('hasAnchor false on a directory without a marked CLAUDE.md', () => {
  assert.strictEqual(anchor.hasAnchor(__dirname), false);
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
