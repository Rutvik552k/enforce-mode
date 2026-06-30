#!/usr/bin/env node
/**
 * Tests for enforce-prior-art-gate.js (Layer 5/6 — Prior-Art Grounding Gate).
 *
 * ADVISORY (never blocks). Verifies it FIRES when there is no CITED design
 * dossier for implementation code, stays SILENT for docs/tests or a cited
 * dossier, and — the hallucination guard — STILL FIRES when a dossier exists
 * but carries no citation. Pure stdlib + child_process, hermetic.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'enforce-prior-art-gate.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS: ' + name); passed++; }
  catch (e) { console.log('  FAIL: ' + name + ' — ' + e.message); failed++; }
}

function runHook(payload, cwd) {
  try {
    return execFileSync('node', [HOOK], { input: JSON.stringify(payload), cwd, encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '').toString();
  }
}

// dossier: 'none' | 'uncited' | 'cited'
function tmpProject(dossier) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'));
  if (dossier === 'uncited') {
    fs.writeFileSync(path.join(dir, 'design-dossier.md'), '# Dossier\nWe will use a token bucket. Netflix uses it too.');
  } else if (dossier === 'cited') {
    fs.writeFileSync(path.join(dir, 'design-dossier.md'), '# Dossier\nToken bucket — Stripe: https://stripe.com/blog/rate-limiters');
  }
  return dir;
}

const IMPL = 'import express from "express";\nexport function handler(req,res){ res.send("ok"); }';

test('SessionStart warns when dossier missing', () => {
  const out = runHook({ hook_event_name: 'SessionStart' }, tmpProject('none'));
  assert.ok(/Prior-Art Grounding \(missing\)/.test(out), 'expected missing warning, got: ' + JSON.stringify(out));
});

test('SessionStart silent when cited dossier present', () => {
  const out = runHook({ hook_event_name: 'SessionStart' }, tmpProject('cited'));
  assert.strictEqual(out.trim(), '', 'expected silence, got: ' + JSON.stringify(out));
});

test('PreToolUse advises on impl code when dossier missing', () => {
  const dir = tmpProject('none');
  const out = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'server.js'), content: IMPL } }, dir);
  assert.ok(/PRIOR-ART GROUNDING/.test(out), 'expected advisory, got: ' + JSON.stringify(out));
});

test('HALLUCINATION GUARD: fires when dossier has NO citation', () => {
  const dir = tmpProject('uncited');
  const out = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'server.js'), content: IMPL } }, dir);
  assert.ok(/PRIOR-ART GROUNDING/.test(out), 'uncited dossier must still fire, got: ' + JSON.stringify(out));
});

test('PreToolUse silent on impl code with a cited dossier', () => {
  const dir = tmpProject('cited');
  const out = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'server.js'), content: IMPL } }, dir);
  assert.strictEqual(out.trim(), '', 'cited dossier must satisfy, got: ' + JSON.stringify(out));
});

test('PreToolUse silent on a markdown doc write', () => {
  const dir = tmpProject('none');
  const out = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'README.md'), content: '# docs' } }, dir);
  assert.strictEqual(out.trim(), '', 'docs must not trigger, got: ' + JSON.stringify(out));
});

test('repo design-dossier.md exists and carries a citation', () => {
  const txt = fs.readFileSync(path.join(__dirname, '..', 'design-dossier.md'), 'utf8');
  assert.ok(/https?:\/\//.test(txt), 'repo dossier must contain a real citation URL');
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
