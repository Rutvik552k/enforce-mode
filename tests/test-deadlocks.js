#!/usr/bin/env node
/**
 * Test all 10 deadlock scenarios identified in enforce-mode hooks.
 * Each test pipes JSON to a hook and checks exit code + output.
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'hooks');
const WG = path.join(HOOKS, 'enforce-write-guard.js');
const DG = path.join(HOOKS, 'enforce-dsa-guard.js');
const BG = path.join(HOOKS, 'enforce-bash-guard.js');

let passed = 0, failed = 0;

function test(name, hook, json, expectExit, expectDeny) {
  const tmpFile = path.join(require('os').tmpdir(), 'enforce-dl-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  require('fs').writeFileSync(tmpFile, JSON.stringify(json));

  let stdout = '', exitCode = 0;
  try {
    stdout = execSync(`node "${hook}" < "${tmpFile}"`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    exitCode = e.status || 1;
    stdout = (e.stdout || '') + (e.stderr || '');
  }
  require('fs').unlinkSync(tmpFile);

  const hasDeny = stdout.includes('"permissionDecision":"deny"') || stdout.includes('"permissionDecision": "deny"');
  const ok = exitCode === expectExit && hasDeny === expectDeny;

  if (ok) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name} (exit=${exitCode} expected=${expectExit}, deny=${hasDeny} expected=${expectDeny})`);
    failed++;
  }
}

console.log('enforce-mode deadlock tests\n');

// ── FIX #1: Inference regex no longer matches arbitrary strings ──
console.log('── Fix #1: Inference regex precision ──');
test('python setup.py generate_proto → pass',
  BG, { tool_name: 'Bash', tool_input: { command: 'python setup.py generate_proto' }, transcript_path: '', session_id: 'dl1' },
  0, false);
test('python -c "x = eval(1+1)" → pass',
  BG, { tool_name: 'Bash', tool_input: { command: 'python -c "x = eval(1+1)"' }, transcript_path: '', session_id: 'dl2' },
  0, false);
test('node -e "contains inference word" → pass',
  BG, { tool_name: 'Bash', tool_input: { command: 'node -e "the word inference is here"' }, transcript_path: '', session_id: 'dl3' },
  0, false);
test('python train.py foreground → still blocked',
  BG, { tool_name: 'Bash', tool_input: { command: 'python train.py' }, transcript_path: '', session_id: 'dl4' },
  2, false);
test('torchrun → still blocked',
  BG, { tool_name: 'Bash', tool_input: { command: 'torchrun --nproc 4 train.py' }, transcript_path: '', session_id: 'dl5' },
  2, false);

// ── FIX #2: Git commit with no transcript → soft warn ──
console.log('\n── Fix #2: Git commit empty transcript ──');
test('git commit no transcript → soft warn (not exit 2)',
  BG, { tool_name: 'Bash', tool_input: { command: 'git commit -m "fix"' }, transcript_path: '', session_id: 'dl6' },
  0, false);

// ── FIX #3: Secret file substring → boundary match ──
console.log('\n── Fix #3: Secret file boundary matching ──');
test('git add .env-display.tsx → pass',
  BG, { tool_name: 'Bash', tool_input: { command: 'git add src/.env-display.tsx' }, transcript_path: '', session_id: 'dl7' },
  0, false);
test('git add .environment/config.js → pass',
  BG, { tool_name: 'Bash', tool_input: { command: 'git add .environment/config.js' }, transcript_path: '', session_id: 'dl8' },
  0, false);
test('git add .env → still blocked',
  BG, { tool_name: 'Bash', tool_input: { command: 'git add .env' }, transcript_path: '', session_id: 'dl9' },
  2, false);
test('git add . → still blocked',
  BG, { tool_name: 'Bash', tool_input: { command: 'git add .' }, transcript_path: '', session_id: 'dl10' },
  2, false);

// ── FIX #4: UUID no longer matches Heroku regex ──
console.log('\n── Fix #4: UUID not flagged as Heroku key ──');
test('code with UUID → pass (not secret)',
  WG, { tool_name: 'Write', tool_input: { file_path: 'config.js', content: 'const id = "550e8400-e29b-41d4-a716-446655440000";' }, transcript_path: '', session_id: 'dl11' },
  0, false);
test('HEROKU_API_KEY with UUID → still blocked',
  WG, { tool_name: 'Write', tool_input: { file_path: 'config.js', content: 'HEROKU_API_KEY = "550e8400-e29b-41d4-a716-446655440000"' }, transcript_path: '', session_id: 'dl12' },
  2, false);

// ── FIX #5: Empty transcript → soft warn (not deny) ──
console.log('\n── Fix #5: Empty transcript fallback ──');
test('external import + no transcript → soft warn (not deny)',
  WG, { tool_name: 'Write', tool_input: { file_path: 'app.js', content: 'const express = require("express");' }, transcript_path: '', session_id: 'dl13' },
  0, false);

// ── FIX #6: readFileSync standalone → pass ──
console.log('\n── Fix #6: readFileSync not in loop → pass ──');
test('standalone readFileSync → pass',
  DG, { tool_name: 'Write', tool_input: { file_path: 'loader.js', content: 'const data = fs.readFileSync(path, "utf8");' }, transcript_path: '', session_id: 'dl14' },
  0, false);

// ── FIX #7: Promise.all() → pass ──
console.log('\n── Fix #7: Promise.all() not flagged ──');
test('Promise.all() → pass',
  DG, { tool_name: 'Write', tool_input: { file_path: 'async.js', content: 'const results = await Promise.all(promises);' }, transcript_path: '', session_id: 'dl15' },
  0, false);
test('Model.all() no transcript → soft warn (detected but no deny)',
  DG, { tool_name: 'Write', tool_input: { file_path: 'db.py', content: 'users = User.objects.all()' }, transcript_path: '', session_id: 'dl16' },
  0, false);

// ── FIX #8: Small list → pass ──
console.log('\n── Fix #8: Small constant list → pass ──');
test('if x in [1,2,3] → pass (3 items)',
  DG, { tool_name: 'Write', tool_input: { file_path: 'check.py', content: 'if status in ["active", "pending", "done"]:' }, transcript_path: '', session_id: 'dl17' },
  0, false);

// ── FIX #9: Cross-hook ping-pong ──
console.log('\n── Fix #9: Cross-hook coordination ──');
// Simulate: write-guard already recorded research pending for this file
const stateModule = require(path.join(HOOKS, 'enforce-state.js'));
stateModule.clearState('dl18');
stateModule.recordPending('dl18', 'research', 'algo.js', ['express']);
test('DSA guard defers when write-guard already denied same file',
  DG, { tool_name: 'Write', tool_input: { file_path: 'algo.js', content: 'for(let i=0;i<n;i++){for(let j=0;j<n;j++){}}' }, transcript_path: '', session_id: 'dl18' },
  0, false);
stateModule.clearState('dl18');

// ── Self-exemption (regression check) ──
console.log('\n── Self-exemption regression ──');
test('edit hook file with imports → exempt',
  WG, { tool_name: 'Edit', tool_input: { file_path: 'C:/Users/rutvi/.claude/hooks/test.js', new_string: 'const express = require("express");' }, transcript_path: '', session_id: 'dl19' },
  0, false);
test('edit hook file with nested loop → exempt',
  DG, { tool_name: 'Write', tool_input: { file_path: '/project/enforce-mode/hooks/scan.js', content: 'for(let i=0;i<n;i++){for(let j=0;j<n;j++){}}' }, transcript_path: '', session_id: 'dl20' },
  0, false);

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
