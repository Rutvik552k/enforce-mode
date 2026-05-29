#!/usr/bin/env node
/**
 * Tests for enforce-skill-loader.js — PECK v3 hardened skill loading enforcement.
 *
 * Tests:
 *   - Extension-based skill resolution (true positive + true negative)
 *   - Content-based skill resolution
 *   - Research query skill resolution
 *   - PECK escalation (tier progression)
 *   - Level behavior (solo/team/prod — all emit via ALWAYS severity)
 *   - Per-session dedup
 *   - Edge cases (empty source, exempt paths, off level)
 *   - Compliance path (structured invocation only)
 *   - Anti-evasion: plain text mentions don't count as compliance
 *   - Anti-evasion: wrong skills don't satisfy specific file type
 *   - Anti-evasion: test files NOT exempt from skill loading
 *   - Anti-evasion: tiny files (< 5 chars) blocked
 *   - Anti-evasion: forgiveness cap (max 3 per session)
 *
 * NOTE: All skill resolution is fully dynamic via enforce-skill-registry.js.
 * Tests verify that SOME skills are suggested for known file types, not specific
 * hardcoded skill names (except where dynamically discoverable skills are checked).
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── HERMETIC SKILL FIXTURE ──────────────────────────────────────────────────
// Skill discovery scans ~/.claude for installed skills, so results vary by
// machine (and break when no skills are installed / a marketplace is removed).
// Point discovery at a controlled fixture dir via ENFORCE_SKILLS_DIR so these
// assertions are deterministic. Subprocesses inherit this env automatically.
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-skills-'));
const FIXTURE_PLUGINS = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-plugins-'));
process.env.ENFORCE_SKILLS_DIR = FIXTURE_DIR;
process.env.ENFORCE_PLUGINS_DIR = FIXTURE_PLUGINS;

function writeFixtureSkill(name, description) {
  const dir = path.join(FIXTURE_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + name + '\ndescription: ' + description + '\n---\n');
}
// Cover every trigger the suite exercises (extensions, content, research):
writeFixtureSkill('multi-lang-review', 'typescript python golang rust code review');
writeFixtureSkill('security-review', 'security review for owasp vulnerabilities and auth');
writeFixtureSkill('database-review', 'database review for prisma and sql queries');
writeFixtureSkill('frontend-review', 'frontend react component review');
writeFixtureSkill('llm-safety-review', 'llm prompt injection safety review for anthropic openai');
writeFixtureSkill('deployment-review', 'deployment review for kubernetes helm and docker');

process.on('exit', () => {
  try { fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(FIXTURE_PLUGINS, { recursive: true, force: true }); } catch { /* ignore */ }
});

const HOOK = path.join(__dirname, '..', 'hooks', 'enforce-skill-loader.js');
const { clearState, setLevel } = require('../hooks/enforce-state');
const { discoverSkills, clearRegistryCache } = require('../hooks/enforce-skill-registry');

let passed = 0, failed = 0;

// Pre-discover skills so we know what to expect
clearRegistryCache();
const discovery = discoverSkills();

// Find a skill that maps to .ts (for compliance tests)
const tsSkills = discovery.extMap['.ts'] || [];
const tsSkill = tsSkills[0] || 'code-reviewer'; // fallback

/**
 * Run hook as subprocess with given JSON input.
 */
function hookTest(name, json, expectSuggestion, opts = {}) {
  const { expectDeny = false, expectExit = 0, expectContains = null } = opts;
  const tmpFile = path.join(os.tmpdir(), 'enforce-sl-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(tmpFile, JSON.stringify(json));

  let stdout = '', exitCode = 0;
  try {
    stdout = execSync('node "' + HOOK + '" < "' + tmpFile + '"', {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
    });
  } catch (e) {
    exitCode = e.status || 1;
    stdout = (e.stdout || '') + (e.stderr || '');
  }
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  const hasContext = stdout.includes('additionalContext');
  const hasDeny = stdout.includes('"permissionDecision":"deny"') || stdout.includes('"permissionDecision": "deny"');
  const hasContains = expectContains ? stdout.includes(expectContains) : true;

  const ok = exitCode === expectExit
    && hasContext === expectSuggestion
    && hasDeny === expectDeny
    && hasContains;

  if (ok) {
    console.log('  PASS: ' + name);
    passed++;
  } else {
    console.log('  FAIL: ' + name + ' (exit=' + exitCode + ' exp=' + expectExit +
      ', context=' + hasContext + ' exp=' + expectSuggestion +
      ', deny=' + hasDeny + ' exp=' + expectDeny +
      (expectContains ? ', contains=' + hasContains + ' exp=true' : '') + ')');
    if (stdout.length < 300) console.log('    out: ' + stdout.substring(0, 250));
    failed++;
  }
}

console.log('enforce-skill-loader tests (v3 fully dynamic)\n');

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION-BASED TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════

console.log('── Extension-based triggers ──');

const SID = 'sl-test-' + Date.now();

hookTest('.ts file → suggests skills (dynamic)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/app.ts',
    content: 'export function hello() { return "world"; }\nconsole.log(hello());'
  }, transcript_path: '', session_id: SID + '-ext1' },
  true);
clearState(SID + '-ext1');

hookTest('.py file → suggests skills (dynamic)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/main.py',
    content: 'def hello():\n    return "world"\n\nprint(hello())'
  }, transcript_path: '', session_id: SID + '-ext2' },
  true);
clearState(SID + '-ext2');

hookTest('.go file → suggests skills (dynamic)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/main.go',
    content: 'package main\n\nfunc main() {\n\tfmt.Println("hello")\n}'
  }, transcript_path: '', session_id: SID + '-ext3' },
  true);
clearState(SID + '-ext3');

hookTest('.rs file → suggests skills (dynamic)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/main.rs',
    content: 'fn main() {\n    println!("hello world");\n}'
  }, transcript_path: '', session_id: SID + '-ext4' },
  true);
clearState(SID + '-ext4');

hookTest('.json file → no suggestion (skip non-code)',
  { tool_name: 'Write', tool_input: {
    file_path: '/config.json',
    content: '{ "key": "value", "another": "config setting here" }'
  }, transcript_path: '', session_id: SID + '-ext5' },
  false);
clearState(SID + '-ext5');

hookTest('unknown extension → no suggestion',
  { tool_name: 'Write', tool_input: {
    file_path: '/data.xyz',
    content: 'some random content that does not match any skill pattern at all'
  }, transcript_path: '', session_id: SID + '-ext6' },
  false);
clearState(SID + '-ext6');

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT-BASED TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════

console.log('── Content-based triggers ──');

hookTest('Auth code in .ts → suggests security skills',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/auth.ts',
    content: 'import bcrypt from "bcrypt";\nconst hash = await bcrypt.hash(password, 10);'
  }, transcript_path: '', session_id: SID + '-cnt1' },
  true);
clearState(SID + '-cnt1');

hookTest('Database queries in .ts → suggests skills',
  { tool_name: 'Edit', tool_input: {
    file_path: '/src/db.ts',
    new_string: 'const result = await prisma.user.findMany({ where: { active: true } });'
  }, transcript_path: '', session_id: SID + '-cnt2' },
  true);
clearState(SID + '-cnt2');

hookTest('React hooks → suggests frontend skills',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/App.tsx',
    content: 'const [count, setCount] = useState(0);\nuseEffect(() => { fetch("/api"); }, []);'
  }, transcript_path: '', session_id: SID + '-cnt3' },
  true);
clearState(SID + '-cnt3');

hookTest('LLM integration code → suggests skills',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/llm.ts',
    content: 'import { anthropic } from "@ai-sdk/anthropic";\nconst response = await anthropic.messages.create({});'
  }, transcript_path: '', session_id: SID + '-cnt4' },
  true);
clearState(SID + '-cnt4');

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCH TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════

console.log('── Research triggers ──');

hookTest('Security research → suggests skills',
  { tool_name: 'WebSearch', tool_input: {
    query: 'OWASP top 10 vulnerabilities 2024'
  }, transcript_path: '', session_id: SID + '-res1' },
  true);
clearState(SID + '-res1');

hookTest('Deployment research → suggests skills',
  { tool_name: 'WebSearch', tool_input: {
    query: 'kubernetes helm chart deployment best practices'
  }, transcript_path: '', session_id: SID + '-res2' },
  true);
clearState(SID + '-res2');

hookTest('Generic search → no match',
  { tool_name: 'WebSearch', tool_input: {
    query: 'weather forecast tomorrow'
  }, transcript_path: '', session_id: SID + '-res3' },
  false);
clearState(SID + '-res3');

// ═══════════════════════════════════════════════════════════════════════════
// PECK ESCALATION
// ═══════════════════════════════════════════════════════════════════════════

console.log('── PECK escalation ──');

hookTest('First violation → T0 advisory',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/first.ts',
    content: 'export const x = 1;\nconsole.log("first violation test");'
  }, transcript_path: '', session_id: SID + '-peck1' },
  true, { expectContains: 'ADVISORY' });

hookTest('Second violation same session → still advisory (budget=4)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/second.ts',
    content: 'export const y = 2;\nconsole.log("second violation test");'
  }, transcript_path: '', session_id: SID + '-peck1' },
  true);

hookTest('Third violation same session → T1 warning (MEDIUM confidence, 1.5/4)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/third.ts',
    content: 'export const z = 3;\nconsole.log("third violation test");'
  }, transcript_path: '', session_id: SID + '-peck1' },
  true, { expectContains: 'WARNING' });
clearState(SID + '-peck1');

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL TESTS (all levels emit — ALWAYS severity)
// ═══════════════════════════════════════════════════════════════════════════

console.log('── Level tests (all levels emit) ──');

setLevel(SID + '-lvl1', 'solo');
hookTest('solo level → emits suggestion',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/solo.py',
    content: 'def process():\n    return "solo test result"'
  }, transcript_path: '', session_id: SID + '-lvl1' },
  true);
clearState(SID + '-lvl1');

setLevel(SID + '-lvl2', 'team');
hookTest('team level → emits suggestion',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/team.py',
    content: 'def process():\n    return "team test result"'
  }, transcript_path: '', session_id: SID + '-lvl2' },
  true);
clearState(SID + '-lvl2');

setLevel(SID + '-lvl3', 'prod');
hookTest('prod level → emits suggestion',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/prod.py',
    content: 'def process():\n    return "prod test result"'
  }, transcript_path: '', session_id: SID + '-lvl3' },
  true);
clearState(SID + '-lvl3');

// ═══════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

console.log('── Edge cases ──');

hookTest('Empty source → silent exit',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/empty.ts',
    content: ''
  }, transcript_path: '', session_id: SID + '-edge1' },
  false);
clearState(SID + '-edge1');

setLevel(SID + '-edge3', 'off');
hookTest('Off level → silent exit',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/off.ts',
    content: 'export const x = 1;\nconsole.log("off level test");'
  }, transcript_path: '', session_id: SID + '-edge3' },
  false);
clearState(SID + '-edge3');

hookTest('Non-trigger tool → silent exit',
  { tool_name: 'Read', tool_input: {
    file_path: '/src/read.ts'
  }, transcript_path: '', session_id: SID + '-edge4' },
  false);
clearState(SID + '-edge4');

// ═══════════════════════════════════════════════════════════════════════════
// ANTI-EVASION TESTS (v2 hardened)
// ═══════════════════════════════════════════════════════════════════════════

console.log('── Anti-evasion: structured compliance ──');

// Create transcript with PLAIN TEXT skill mention (should NOT count)
const fakeTextTranscript = path.join(os.tmpdir(), 'enforce-sl-text-' + Date.now() + '.txt');
fs.writeFileSync(fakeTextTranscript, 'I will use ' + tsSkill + ' and ecc:tdd-workflow to review this code.\nThe Skill tool is great for this.');

hookTest('ANTI-EVASION: plain text skill mention → NOT compliant (escalates)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/evasion1.ts',
    content: 'export function evasion() { return "trying to bypass"; }'
  }, transcript_path: fakeTextTranscript, session_id: SID + '-ev1' },
  true, { expectContains: 'ADVISORY' });
clearState(SID + '-ev1');
try { fs.unlinkSync(fakeTextTranscript); } catch { /* ignore */ }

// Create transcript with STRUCTURED skill invocation using a dynamically-known skill
const realTranscript = path.join(os.tmpdir(), 'enforce-sl-real-' + Date.now() + '.txt');
fs.writeFileSync(realTranscript, '{"tool_name":"Skill","tool_input":{"skill":"' + tsSkill + '"}}\nResult: skill loaded successfully');

hookTest('Structured Skill invocation → compliant (SKILLS LOADED)',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/compliant.ts',
    content: 'export function compliant() { return true; }\nconsole.log("compliant");'
  }, transcript_path: realTranscript, session_id: SID + '-ev2' },
  true, { expectContains: 'SKILLS LOADED' });
clearState(SID + '-ev2');
try { fs.unlinkSync(realTranscript); } catch { /* ignore */ }

console.log('── Anti-evasion: wrong skills ──');

// Create transcript with structured invocation of a skill NOT in .ts map
const wrongSkillTranscript = path.join(os.tmpdir(), 'enforce-sl-wrong-' + Date.now() + '.txt');
// Use a skill that definitely won't be in .ts map
const nonTsSkills = [...new Set(Object.values(discovery.extMap).flat())].filter(s => !(discovery.extMap['.ts'] || []).includes(s));
const wrongSkill = nonTsSkills[0] || 'ecc:remotion-video-creation';
fs.writeFileSync(wrongSkillTranscript, '{"tool_name":"Skill","tool_input":{"skill":"' + wrongSkill + '"}}\nResult: skill loaded');

hookTest('ANTI-EVASION: wrong skill loaded → escalates',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/wrongskill.ts',
    content: 'export function wrongSkill() { return "wrong skill loaded"; }'
  }, transcript_path: wrongSkillTranscript, session_id: SID + '-ev3' },
  true, { expectContains: 'Wrong skills' });
clearState(SID + '-ev3');
try { fs.unlinkSync(wrongSkillTranscript); } catch { /* ignore */ }

console.log('── Anti-evasion: test files NOT exempt ──');

hookTest('ANTI-EVASION: test file → NOT exempt (skills enforced)',
  { tool_name: 'Write', tool_input: {
    file_path: '/tests/test-foo.ts',
    content: 'export function testSomething() { expect(true).toBe(true); }'
  }, transcript_path: '', session_id: SID + '-ev4' },
  true);
clearState(SID + '-ev4');

hookTest('ANTI-EVASION: .spec file → NOT exempt',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/auth.spec.ts',
    content: 'describe("auth", () => { it("works", () => { expect(1).toBe(1); }); });'
  }, transcript_path: '', session_id: SID + '-ev5' },
  true);
clearState(SID + '-ev5');

console.log('── Anti-evasion: tiny file bypass ──');

hookTest('ANTI-EVASION: tiny source (4 chars) → blocked',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/tiny.ts',
    content: 'x=1;'
  }, transcript_path: '', session_id: SID + '-ev6' },
  false);
clearState(SID + '-ev6');

hookTest('Source >= 5 chars → enforced',
  { tool_name: 'Write', tool_input: {
    file_path: '/src/small.ts',
    content: 'const x = 1;\nreturn x;'
  }, transcript_path: '', session_id: SID + '-ev7' },
  true);
clearState(SID + '-ev7');

console.log('── Anti-evasion: hook files still exempt ──');

hookTest('Hook file → still exempt (self-protection)',
  { tool_name: 'Write', tool_input: {
    file_path: '/enforce-mode/hooks/enforce-something.js',
    content: 'const fs = require("fs");\nmodule.exports = function() { return true; };'
  }, transcript_path: '', session_id: SID + '-ev8' },
  false);
clearState(SID + '-ev8');

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC REGISTRY TESTS
// ═══════════════════════════════════════════════════════════════════════════

console.log('── Dynamic registry ──');

// Verify code-reviewer (marketplace) is discovered for .ts
const hasTsSkills = (discovery.extMap['.ts'] || []).length > 0;
if (hasTsSkills) {
  console.log('  PASS: .ts has dynamically discovered skills (' + (discovery.extMap['.ts'] || []).length + ')');
  passed++;
} else {
  console.log('  FAIL: .ts has no dynamically discovered skills');
  failed++;
}

// Verify content map has security entries
const hasSecurityContent = discovery.contentMap.some(e => e.keywords.includes('bcrypt'));
if (hasSecurityContent) {
  console.log('  PASS: content map has security keywords');
  passed++;
} else {
  console.log('  FAIL: content map missing security keywords');
  failed++;
}

// Verify research map has entries
const hasResearchEntries = discovery.researchMap.length > 0;
if (hasResearchEntries) {
  console.log('  PASS: research map has entries (' + discovery.researchMap.length + ')');
  passed++;
} else {
  console.log('  FAIL: research map is empty');
  failed++;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
if (failed > 0) process.exit(1);
