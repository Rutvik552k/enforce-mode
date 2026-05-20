#!/usr/bin/env node
/**
 * Tests for enforce-compress.js — deterministic text compression
 */

'use strict';

const assert = require('assert');
const { compressRules } = require('../hooks/enforce-compress');

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

console.log('enforce-compress tests\n');

// Article stripping
test('strips articles (a, an, the)', () => {
  const input = 'Validate the request and check a token for an endpoint.';
  const output = compressRules(input);
  assert.ok(!output.includes(' the '), 'should strip "the"');
  assert.ok(!output.includes(' a '), 'should strip "a"');
  assert.ok(!output.includes(' an '), 'should strip "an"');
});

test('preserves articles before all-caps words', () => {
  const input = 'Check the API and the OWASP checklist.';
  const output = compressRules(input);
  // "the OWASP" should be preserved, "the API" should be preserved
  assert.ok(output.includes('the API'), 'should keep "the API"');
  assert.ok(output.includes('the OWASP'), 'should keep "the OWASP"');
});

// Filler word stripping
test('strips filler words', () => {
  const input = 'You should just basically always actually check.';
  const output = compressRules(input);
  assert.ok(!output.includes('just'), 'should strip "just"');
  assert.ok(!output.includes('basically'), 'should strip "basically"');
  assert.ok(!output.includes('actually'), 'should strip "actually"');
});

// Phrase replacements
test('replaces verbose phrases with terse equivalents', () => {
  const input = 'In order to validate, make sure to check prior to deployment.';
  const output = compressRules(input);
  assert.ok(!output.includes('In order to'), 'should replace "in order to"');
  assert.ok(!output.includes('make sure to'), 'should replace "make sure to"');
  assert.ok(!output.includes('prior to'), 'should replace "prior to"');
  assert.ok(output.includes('ensure'), '"make sure to" → "ensure"');
  assert.ok(output.includes('before'), '"prior to" → "before"');
});

// Code block preservation
test('preserves fenced code blocks exactly', () => {
  const code = '```python\nthe_variable = just_a_function()\n```';
  const input = 'Run the following:\n' + code + '\nThen check the output.';
  const output = compressRules(input);
  assert.ok(output.includes(code), 'code block must be preserved exactly');
});

test('preserves inline backtick content exactly', () => {
  const input = 'Use `the_function()` to validate the input.';
  const output = compressRules(input);
  assert.ok(output.includes('`the_function()`'), 'inline code must be preserved');
});

// Severity tag preservation
test('preserves severity tags [WARN], [STRICT], [CRITICAL]', () => {
  const input = '- [WARN] AUTH REQUIRED: Every API endpoint must have authentication.';
  const output = compressRules(input);
  assert.ok(output.includes('[WARN]'), 'severity tag must be preserved');
  assert.ok(output.includes('AUTH REQUIRED'), 'rule label must be preserved');
});

// Compression ratio
test('achieves measurable compression on verbose text', () => {
  const input =
    'In order to validate the request, you should make sure to check ' +
    'whether or not the token is valid. Additionally, you should basically ' +
    'just verify the user has the appropriate permissions prior to ' +
    'granting access to the resource.';
  const output = compressRules(input);
  const ratio = output.length / input.length;
  assert.ok(ratio < 0.8, 'compression ratio should be < 80%, got ' + Math.round(ratio * 100) + '%');
});

// Empty and edge cases
test('handles empty string', () => {
  assert.strictEqual(compressRules(''), '');
});

test('handles text with no compressible content', () => {
  const input = 'NEVER push broken code.';
  const output = compressRules(input);
  assert.ok(output.includes('NEVER'), 'should preserve content');
  assert.ok(output.includes('push'), 'should preserve content');
});

// Double space collapse
test('collapses multiple spaces after stripping', () => {
  const input = 'Check the  input and  validate.';
  const output = compressRules(input);
  assert.ok(!output.includes('  '), 'should not have double spaces');
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
