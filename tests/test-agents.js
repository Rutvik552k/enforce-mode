#!/usr/bin/env node
/**
 * Tests for bundled department agents (agents/*.md)
 *
 * Validates that every agent file the plugin ships:
 *  - has parseable YAML frontmatter delimited by --- / ---
 *  - declares the required fields (name, description)
 *  - uses a kebab-case name that matches its filename (stable invocation name)
 *  - has a non-empty system-prompt body
 *  - carries the enforce-mode contract (ground-truth discipline)
 *  - matches the CLAUDE.md Rule 2 routing map (no agent missing, none extra)
 *
 * Pure stdlib, hermetic — reads only the repo's own agents/ directory.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');

// The department subagents named in CLAUDE.md Rule 2 routing map.
const EXPECTED_AGENTS = [
  'cloud-engineer',
  'compliance-officer',
  'computer-vision-engineer',
  'data-engineer',
  'data-scientist',
  'devops-engineer',
  'ml-engineer',
  'project-manager',
  'qa-engineer',
  'release-manager',
  'research-agent',
  'research-solution-architect',
  'reverse-engineering-agent',
  'security-auditor',
  'security-engineer',
  'site-reliability-engineer',
  'solution-architect',
  'team-orchestrator',
  'testing-engineer',
];

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

// Minimal frontmatter parser: extracts the --- ... --- block and the body.
// Only needs flat `key: value` pairs (the agent schema is flat).
function parseAgent(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const front = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  return { front, body: m[2] };
}

console.log('agents tests\n');

test('agents/ directory exists', () => {
  assert.ok(fs.existsSync(AGENTS_DIR), 'agents/ directory missing');
  assert.ok(fs.statSync(AGENTS_DIR).isDirectory(), 'agents/ is not a directory');
});

const files = fs.existsSync(AGENTS_DIR)
  ? fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))
  : [];
const slugs = files.map((f) => f.replace(/\.md$/, '')).sort();

test('every expected department agent is present', () => {
  for (const want of EXPECTED_AGENTS) {
    assert.ok(slugs.includes(want), 'missing agent: ' + want);
  }
});

test('no unexpected agent files', () => {
  for (const got of slugs) {
    assert.ok(EXPECTED_AGENTS.includes(got), 'unexpected agent file: ' + got);
  }
});

test('agent count matches routing map (' + EXPECTED_AGENTS.length + ')', () => {
  assert.strictEqual(slugs.length, EXPECTED_AGENTS.length);
});

const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'fable', 'inherit'];

for (const file of files) {
  const slug = file.replace(/\.md$/, '');
  const raw = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');

  test(slug + ': has parseable frontmatter', () => {
    const parsed = parseAgent(raw);
    assert.ok(parsed, 'frontmatter block not found / not delimited by ---');
  });

  test(slug + ': required fields present (name, description)', () => {
    const { front } = parseAgent(raw);
    assert.ok(front.name, 'name missing');
    assert.ok(front.description, 'description missing');
    assert.ok(front.description.length >= 30, 'description too short to route on');
  });

  test(slug + ': name is kebab-case and matches filename', () => {
    const { front } = parseAgent(raw);
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(front.name), 'name not kebab-case: ' + front.name);
    assert.strictEqual(front.name, slug, 'name must match filename');
  });

  test(slug + ': model (if set) is a valid value', () => {
    const { front } = parseAgent(raw);
    if (front.model !== undefined) {
      assert.ok(VALID_MODELS.includes(front.model) || /^claude-/.test(front.model),
        'invalid model: ' + front.model);
    }
  });

  test(slug + ': has a non-empty system-prompt body', () => {
    const { body } = parseAgent(raw);
    assert.ok(body.trim().length >= 100, 'body too short to be a real prompt');
  });

  test(slug + ': carries the enforce-mode ground-truth contract', () => {
    assert.ok(/ground.?truth/i.test(raw), 'no ground-truth language');
    assert.ok(/enforce-mode contract/i.test(raw), 'no enforce-mode contract section');
  });
}

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
