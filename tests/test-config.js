#!/usr/bin/env node
/**
 * Tests for enforce-config.js — config resolution
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// We need to test getDefaultLevel with different env states
// Save original env
const originalEnv = process.env.ENFORCE_DEFAULT_LEVEL;
const originalConfigDir = process.env.ENFORCE_CONFIG_DIR;
const originalSettingsPath = process.env.ENFORCE_SETTINGS_PATH;

// HERMETIC ISOLATION: point config + settings at empty temp locations so the
// machine's real persisted level (config.json / settings.json) cannot leak into
// these assertions. Without this, a previously-persisted level (e.g. "prod")
// makes the "returns solo" / "ignores invalid" cases fail on developer machines.
// Prefix includes "enforce-mode" so getConfigDir/getConfigPath substring
// assertions still hold under the override.
const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-mode-cfg-'));
process.env.ENFORCE_CONFIG_DIR = tmpConfigDir;
process.env.ENFORCE_SETTINGS_PATH = path.join(tmpConfigDir, 'no-settings.json');

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

// Clear module cache between tests to reset state
function freshRequire() {
  delete require.cache[require.resolve('../hooks/enforce-config')];
  return require('../hooks/enforce-config');
}

console.log('enforce-config tests\n');

// Test VALID_LEVELS
test('VALID_LEVELS contains expected values', () => {
  const { VALID_LEVELS } = freshRequire();
  assert.deepStrictEqual(VALID_LEVELS, ['off', 'solo', 'team', 'prod']);
});

// Test env var resolution
test('getDefaultLevel reads ENFORCE_DEFAULT_LEVEL env var', () => {
  process.env.ENFORCE_DEFAULT_LEVEL = 'prod';
  const { getDefaultLevel } = freshRequire();
  assert.strictEqual(getDefaultLevel(), 'prod');
});

test('getDefaultLevel handles uppercase env var', () => {
  process.env.ENFORCE_DEFAULT_LEVEL = 'TEAM';
  const { getDefaultLevel } = freshRequire();
  assert.strictEqual(getDefaultLevel(), 'team');
});

test('getDefaultLevel ignores invalid env var', () => {
  process.env.ENFORCE_DEFAULT_LEVEL = 'invalid';
  const { getDefaultLevel } = freshRequire();
  // Should fall through to default
  assert.strictEqual(getDefaultLevel(), 'solo');
});

test('getDefaultLevel returns solo when no env var set', () => {
  delete process.env.ENFORCE_DEFAULT_LEVEL;
  const { getDefaultLevel } = freshRequire();
  assert.strictEqual(getDefaultLevel(), 'solo');
});

test('getDefaultLevel handles off level', () => {
  process.env.ENFORCE_DEFAULT_LEVEL = 'off';
  const { getDefaultLevel } = freshRequire();
  assert.strictEqual(getDefaultLevel(), 'off');
});

// Test config path resolution
test('getConfigPath returns a string path', () => {
  delete process.env.ENFORCE_DEFAULT_LEVEL;
  const { getConfigPath } = freshRequire();
  const configPath = getConfigPath();
  assert.strictEqual(typeof configPath, 'string');
  assert.ok(configPath.includes('enforce-mode'));
});

test('getConfigDir returns platform-appropriate directory', () => {
  delete process.env.ENFORCE_DEFAULT_LEVEL;
  const { getConfigDir } = freshRequire();
  const dir = getConfigDir();
  assert.strictEqual(typeof dir, 'string');
  assert.ok(dir.includes('enforce-mode'));
});

// Restore env
if (originalEnv !== undefined) {
  process.env.ENFORCE_DEFAULT_LEVEL = originalEnv;
} else {
  delete process.env.ENFORCE_DEFAULT_LEVEL;
}
if (originalConfigDir !== undefined) process.env.ENFORCE_CONFIG_DIR = originalConfigDir;
else delete process.env.ENFORCE_CONFIG_DIR;
if (originalSettingsPath !== undefined) process.env.ENFORCE_SETTINGS_PATH = originalSettingsPath;
else delete process.env.ENFORCE_SETTINGS_PATH;
try { fs.rmSync(tmpConfigDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
