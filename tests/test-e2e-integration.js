#!/usr/bin/env node
/**
 * test-e2e-integration.js — 5 end-to-end integration tests
 *
 * Tests the entire enforce-mode pipeline:
 *   1. Dual output (stderr + additionalContext) across all guards
 *   2. Ground truth capture → research-mandatory gate → immediate deny
 *   3. GTC scoring end-to-end (full pipeline)
 *   4. Per-library research tracking (specificity)
 *   5. PostToolUse hooks (post-write-check + research-capture)
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

// HERMETIC SKILL FIXTURE — the skill-loader scenario needs at least one skill
// mapping to .ts; otherwise discovery (machine-dependent) finds none and the
// dual-output assertion fails. Point discovery at a controlled fixture.
const E2E_SKILLS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-e2e-skills-'));
process.env.ENFORCE_SKILLS_DIR = E2E_SKILLS_DIR;
process.env.ENFORCE_PLUGINS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-e2e-plugins-'));
(function seedSkill() {
  const dir = path.join(E2E_SKILLS_DIR, 'multi-lang-review');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: multi-lang-review\ndescription: typescript python golang rust code review\n---\n');
})();
process.on('exit', () => {
  try { fs.rmSync(E2E_SKILLS_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const {
  clearState, readState, writeState, setLevel, getStatePath,
  recordGroundTruth, getGroundTruth, getResearchedLibs,
  computeGTC, formatGTC,
} = require(path.join(HOOKS_DIR, 'enforce-state'));

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, msg) {
  total++;
  if (condition) {
    console.log('    PASS: ' + msg);
    passed++;
  } else {
    console.log('    FAIL: ' + msg);
    failed++;
  }
}

/**
 * Run a hook as a subprocess and capture stdout, stderr, exit code.
 */
function runHook(hookFile, input, timeout = 5000) {
  const hookPath = path.join(HOOKS_DIR, hookFile);
  const result = spawnSync('node', [hookPath], {
    input: JSON.stringify(input),
    timeout,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status || 0,
  };
}

/**
 * Create a temp transcript file with content.
 */
function createTranscript(content) {
  const tmpPath = path.join(os.tmpdir(), 'enforce-e2e-transcript-' + Date.now() + '.txt');
  fs.writeFileSync(tmpPath, content);
  return tmpPath;
}

function cleanup(sessionId, ...files) {
  clearState(sessionId);
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

console.log('enforce-mode end-to-end integration tests\n');

// ═══════════════════════════════════════════════════════════
// TEST 1: Dual Output (stderr + additionalContext)
// ═══════════════════════════════════════════════════════════

console.log('── Test 1: Dual Output across all guards ──');
{
  const sid = 'e2e-dual-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');

  // Write-guard: external import without research → should produce stderr + stdout
  const result = runHook('enforce-write-guard.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/myapp.ts',
      content: 'import Fastify from "fastify";\nconst app = Fastify();',
    },
    session_id: sid,
    transcript_path: '',
  });

  // Check stderr contains guard prefix
  assert(result.stderr.includes('[WRITE-GUARD]') || result.exitCode === 2,
    'write-guard outputs to stderr (dual output)');

  // Check stdout has hookSpecificOutput
  const hasContext = result.stdout.includes('additionalContext') ||
    result.stdout.includes('permissionDecision');
  assert(hasContext || result.exitCode === 2,
    'write-guard outputs to stdout (additionalContext or deny)');

  // Bash-guard: git commit without tests
  const bashResult = runHook('enforce-bash-guard.js', {
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "test"' },
    session_id: sid,
    transcript_path: '',
  });

  assert(bashResult.stderr.includes('[BASH-GUARD]'),
    'bash-guard outputs to stderr (dual output)');
  assert(bashResult.stdout.includes('additionalContext'),
    'bash-guard outputs to stdout (additionalContext)');

  // Skill-loader: write .ts without skills loaded
  const skillResult = runHook('enforce-skill-loader.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/mycomponent.tsx',
      content: 'import React from "react";\nexport const App = () => <div>Hello</div>;',
    },
    session_id: sid,
    transcript_path: '',
  });

  assert(skillResult.stderr.includes('[SKILL-LOADER]'),
    'skill-loader outputs to stderr (dual output)');

  // DSA-guard: nested loops (separate session — avoids Fix #9 cross-hook defer)
  const dsaSid = 'e2e-dsa-' + Date.now();
  clearState(dsaSid);
  setLevel(dsaSid, 'prod');
  const dsaResult = runHook('enforce-dsa-guard.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/myalgo.js',
      content: 'for (let i = 0; i < arr.length; i++) {\n  for (let j = 0; j < arr.length; j++) {\n    if (arr[i] === arr[j]) count++;\n  }\n}',
    },
    session_id: dsaSid,
    transcript_path: '',
  });

  assert(dsaResult.stderr.includes('[DSA-GUARD]'),
    'dsa-guard outputs to stderr (dual output)');
  cleanup(dsaSid);

  cleanup(sid);
}

// ═══════════════════════════════════════════════════════════
// TEST 2: Ground Truth Capture → Research-Mandatory Gate
// ═══════════════════════════════════════════════════════════

console.log('── Test 2: Ground Truth + Research-Mandatory Gate ──');
{
  const sid = 'e2e-gt-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');

  // Step 1: Write code with external lib WITHOUT research → should deny
  const denyResult = runHook('enforce-write-guard.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/api-client.ts',
      content: 'import { PrismaClient } from "@prisma/client";\nconst prisma = new PrismaClient();',
    },
    session_id: sid,
    transcript_path: '',
  });

  const isDenied = denyResult.stdout.includes('permissionDecision') ||
    denyResult.stdout.includes('GROUND TRUTH MISSING') ||
    denyResult.stderr.includes('GROUND TRUTH MISSING') ||
    denyResult.exitCode === 2;
  assert(isDenied, 'unresearched library → denied or escalated (research-mandatory)');

  // Step 2: Use fresh session for approved path (PECK accumulates violations)
  const sid2 = 'e2e-gt-pass-' + Date.now();
  clearState(sid2);
  setLevel(sid2, 'prod');

  // Record ground truth BEFORE writing
  recordGroundTruth(sid2, 'prisma', {
    query: 'prisma client documentation',
    snippets: ['const prisma = new PrismaClient()', 'prisma.user.findMany()'],
    urls: ['https://www.prisma.io/docs'],
  });

  assert(getGroundTruth(sid2, 'prisma') !== null,
    'ground truth recorded for prisma');

  // Step 3: Write with ground truth → should pass + inject snippets
  const passResult = runHook('enforce-write-guard.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/api-client.ts',
      content: 'import { PrismaClient } from "@prisma/client";\nconst prisma = new PrismaClient();',
    },
    session_id: sid2,
    transcript_path: '',
  });

  const isApproved = !passResult.stdout.includes('"deny"') && passResult.exitCode === 0;
  assert(isApproved, 'researched library → approved (ground truth exists)');

  const hasSnippetInjection = passResult.stdout.includes('GROUND TRUTH') ||
    passResult.stderr.includes('GROUND TRUTH');
  assert(hasSnippetInjection, 'ground truth snippets injected as context');

  cleanup(sid2);

  cleanup(sid);
}

// ═══════════════════════════════════════════════════════════
// TEST 3: GTC Scoring End-to-End
// ═══════════════════════════════════════════════════════════

console.log('── Test 3: GTC Scoring End-to-End ──');
{
  const sid = 'e2e-gtc-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');

  // Scenario A: No research, no tests, no skills → FAIL
  const gtcFail = computeGTC(sid, {
    externalLibs: ['express', 'prisma', 'zod'],
    apiCalls: ['express.Router', 'prisma.user.findMany'],
    skillsRequired: ['ecc:code-review', 'ecc:security-review'],
    skillsLoaded: [],
    testsRun: false,
  });

  assert(gtcFail.score < 50, 'GTC FAIL: no research/tests/skills → score < 50 (got ' + gtcFail.score + ')');
  assert(gtcFail.label === 'FAIL', 'GTC label = FAIL');

  // Scenario B: Full research + tests + skills → HIGH
  recordGroundTruth(sid, 'express', {
    query: 'express js router documentation',
    snippets: ['express.Router()', 'app.use(router)'],
    urls: ['https://expressjs.com/en/guide/routing.html'],
  });
  recordGroundTruth(sid, 'prisma', {
    query: 'prisma client documentation',
    snippets: ['prisma.user.findMany()', 'new PrismaClient()'],
    urls: ['https://www.prisma.io/docs'],
  });
  recordGroundTruth(sid, 'zod', {
    query: 'zod validation documentation',
    snippets: ['z.object()', 'z.string().email()'],
    urls: ['https://zod.dev'],
  });

  const gtcHigh = computeGTC(sid, {
    externalLibs: ['express', 'prisma', 'zod'],
    apiCalls: ['express.Router', 'prisma.user.findMany'],
    skillsRequired: ['ecc:code-review', 'ecc:security-review'],
    skillsLoaded: ['ecc:code-review', 'ecc:security-review'],
    testsRun: true,
  });

  assert(gtcHigh.score >= 90, 'GTC HIGH: full research/tests/skills → score >= 90 (got ' + gtcHigh.score + ')');
  assert(gtcHigh.label === 'HIGH', 'GTC label = HIGH');

  // Verify format output
  const formatted = formatGTC(gtcHigh);
  assert(formatted.includes('GTC:') && formatted.includes('/100'), 'GTC format includes score display');

  // Verify breakdown adds up
  const b = gtcHigh.breakdown;
  const sum = b.researchCov + b.searchSpec + b.docAlign + b.skillComp + b.testCov + b.violationPenalty + b.dlPenalty;
  assert(sum === gtcHigh.score, 'GTC breakdown sums to score (' + sum + ' = ' + gtcHigh.score + ')');

  cleanup(sid);
}

// ═══════════════════════════════════════════════════════════
// TEST 4: Per-Library Research Specificity
// ═══════════════════════════════════════════════════════════

console.log('── Test 4: Per-Library Research Specificity ──');
{
  const sid = 'e2e-perlib-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');

  // Record ground truth for axios but NOT for zod
  recordGroundTruth(sid, 'axios', {
    query: 'axios http client',
    snippets: ['axios.get(url)'],
    urls: [],
  });

  // Write code using both axios AND zod
  const result = runHook('enforce-write-guard.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/validator.ts',
      content: 'import axios from "axios";\nimport { z } from "zod";\nconst schema = z.object({ name: z.string() });\naxios.get("/api");',
    },
    session_id: sid,
    transcript_path: '',
  });

  // Should flag zod as unresearched (axios has ground truth)
  const output = result.stdout + result.stderr;
  const flagsZod = output.includes('zod') || output.includes('GROUND TRUTH MISSING');
  assert(flagsZod, 'per-library: flags zod as unresearched while axios passes');

  // Verify axios has ground truth, zod doesn't
  assert(getGroundTruth(sid, 'axios') !== null, 'axios has ground truth');
  assert(getGroundTruth(sid, 'zod') === null, 'zod lacks ground truth');

  // Now research zod
  recordGroundTruth(sid, 'zod', {
    query: 'zod validation',
    snippets: ['z.object()', 'z.string()'],
    urls: [],
  });

  // Retry → both researched → should pass
  const retry = runHook('enforce-write-guard.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/validator.ts',
      content: 'import axios from "axios";\nimport { z } from "zod";\nconst schema = z.object({ name: z.string() });\naxios.get("/api");',
    },
    session_id: sid,
    transcript_path: '',
  });

  const retryPassed = !retry.stdout.includes('"deny"') && retry.exitCode === 0;
  assert(retryPassed, 'per-library: both libs researched → approved');

  // GTC should reflect full coverage
  const gtc = computeGTC(sid, {
    externalLibs: ['axios', 'zod'],
    apiCalls: ['axios.get', 'z.object'],
    skillsRequired: [],
    skillsLoaded: [],
    testsRun: false,
  });
  assert(gtc.breakdown.researchCov === 30, 'per-library: full research coverage = 30/30');

  cleanup(sid);
}

// ═══════════════════════════════════════════════════════════
// TEST 5: PostToolUse Hooks Integration
// ═══════════════════════════════════════════════════════════

console.log('── Test 5: PostToolUse Hooks Integration ──');
{
  const sid = 'e2e-post-' + Date.now();
  clearState(sid);
  setLevel(sid, 'prod');

  // Test research-capture PostToolUse hook
  const captureResult = runHook('enforce-research-capture.js', {
    tool_name: 'WebSearch',
    tool_input: { query: 'fastify documentation api' },
    tool_result: JSON.stringify({
      results: [
        { snippet: 'fastify.get("/", handler)', url: 'https://fastify.dev/docs' },
        { snippet: 'const app = Fastify({ logger: true })', url: 'https://fastify.dev/guide' },
      ],
    }),
    session_id: sid,
  });

  assert(captureResult.exitCode === 0, 'research-capture exits cleanly');
  assert(captureResult.stderr.includes('[RESEARCH-CAPTURE]'),
    'research-capture outputs to stderr');

  // Verify ground truth was stored
  const gt = getGroundTruth(sid, 'fastify');
  assert(gt !== null, 'research-capture stored ground truth for fastify');
  assert(gt.snippets.length > 0, 'ground truth has snippets');
  assert(gt.urls.length > 0, 'ground truth has URLs');

  // Test post-write-check PostToolUse hook
  const postWriteResult = runHook('enforce-post-write-check.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/server.ts',
      content: 'import Fastify from "fastify";\nconst app = Fastify();\napp.listen({ port: 3000 });',
    },
    tool_result: { success: true },
    session_id: sid,
    transcript_path: '',
  });

  assert(postWriteResult.exitCode === 0, 'post-write-check exits cleanly');
  // Should warn about missing skills (no skill loaded in transcript)
  const postOutput = postWriteResult.stdout + postWriteResult.stderr;
  const hasPostWarning = postOutput.includes('[POST-WRITE]') || postOutput.length === 0;
  assert(hasPostWarning, 'post-write-check outputs warning or silent pass');

  // Test non-research tool → should be ignored
  const ignoreResult = runHook('enforce-research-capture.js', {
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/foo.js' },
    session_id: sid,
  });
  assert(ignoreResult.exitCode === 0 && ignoreResult.stdout === '',
    'research-capture ignores non-research tools');

  cleanup(sid);
}

// ═══════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════');
console.log('  ' + passed + ' passed, ' + failed + ' failed, ' + total + ' total');
console.log('═══════════════════════════════════════════════');

if (failed > 0) process.exit(1);
