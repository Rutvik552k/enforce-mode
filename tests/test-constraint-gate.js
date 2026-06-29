#!/usr/bin/env node
/**
 * Tests for enforce-constraint-gate.js (Layer 1 — Constraint Intake Gate).
 *
 * The gate is ADVISORY (never blocks). We verify it FIRES (emits guidance) when
 * production constraints are missing for implementation code, and stays SILENT
 * when constraints exist or the write is docs/tests. Pure stdlib + child_process,
 * hermetic — runs the hook against throwaway temp cwds.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'enforce-constraint-gate.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS: ' + name); passed++; }
  catch (e) { console.log('  FAIL: ' + name + ' — ' + e.message); failed++; }
}

// Run the hook in a given cwd with a given stdin payload; return stdout string.
function runHook(payload, cwd) {
  try {
    return execFileSync('node', [HOOK], { input: JSON.stringify(payload), cwd, encoding: 'utf8' });
  } catch (e) {
    // Hook always exit 0; if it ever throws, surface stdout for the assertion.
    return (e.stdout || '').toString();
  }
}

// Make a throwaway project dir, optionally seeded with a constraints.json.
function tmpProject(withConstraints) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  if (withConstraints) {
    fs.writeFileSync(path.join(dir, 'constraints.json'),
      JSON.stringify({ version: 1, features: { svc: { slo: { p99_latency_ms: 200 } } } }));
  }
  return dir;
}

const IMPL = 'import express from "express";\nexport function handler(req,res){ res.send("ok"); }';

// 1. SessionStart + missing constraints → fires the missing-artifact warning.
test('SessionStart warns when constraints.json missing', () => {
  const dir = tmpProject(false);
  const out = runHook({ hook_event_name: 'SessionStart' }, dir);
  assert.ok(/Constraint Intake \(missing\)/.test(out), 'expected missing-artifact warning, got: ' + JSON.stringify(out));
});

// 2. SessionStart + constraints present → silent.
test('SessionStart silent when constraints.json present', () => {
  const dir = tmpProject(true);
  const out = runHook({ hook_event_name: 'SessionStart' }, dir);
  assert.strictEqual(out.trim(), '', 'expected no output, got: ' + JSON.stringify(out));
});

// 3. PreToolUse Write impl code + missing constraints → advisory fires.
test('PreToolUse advises on impl code when constraints missing', () => {
  const dir = tmpProject(false);
  const out = runHook({
    hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'server.js'), content: IMPL },
  }, dir);
  assert.ok(/CONSTRAINT INTAKE/.test(out), 'expected advisory, got: ' + JSON.stringify(out));
  const parsed = JSON.parse(out);
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('production constraints'),
    'advisory must mention production constraints');
});

// 4. PreToolUse on a docs/test file → never fires (no constraints needed).
test('PreToolUse silent on a markdown doc write', () => {
  const dir = tmpProject(false);
  const out = runHook({
    hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'README.md'), content: '# docs\nimport x' },
  }, dir);
  assert.strictEqual(out.trim(), '', 'docs write must not trigger the gate, got: ' + JSON.stringify(out));
});

// 5. PreToolUse on a test file → never fires.
test('PreToolUse silent on a *.test.js write', () => {
  const dir = tmpProject(false);
  const out = runHook({
    hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'server.test.js'), content: IMPL },
  }, dir);
  assert.strictEqual(out.trim(), '', 'test write must not trigger the gate, got: ' + JSON.stringify(out));
});

// 6. PreToolUse impl code + constraints present → silent (satisfied).
test('PreToolUse silent on impl code when constraints present', () => {
  const dir = tmpProject(true);
  const out = runHook({
    hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'server.js'), content: IMPL },
  }, dir);
  assert.strictEqual(out.trim(), '', 'satisfied constraints must not trigger, got: ' + JSON.stringify(out));
});

// 7. Bundled constraints.json is valid + has features (the gate's own artifact).
test('repo constraints.json is valid and non-empty', () => {
  const repoConstraints = path.join(__dirname, '..', 'constraints.json');
  const parsed = JSON.parse(fs.readFileSync(repoConstraints, 'utf8'));
  assert.ok(parsed.features && Object.keys(parsed.features).length > 0, 'must declare features');
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
