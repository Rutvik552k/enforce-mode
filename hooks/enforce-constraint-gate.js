#!/usr/bin/env node
/**
 * enforce-constraint-gate.js — Constraint Intake Gate (Layer 1, ADVISORY)
 *
 * Real-world engineering is constraint-driven. Without an SLO, load profile,
 * tenancy model, data-sensitivity, budget, and failure-tolerance, a model
 * designs to its training prior (tutorial / hobby code). This gate makes those
 * constraints a first-class, captured input BEFORE implementation.
 *
 * ADVISORY by design (matches the rest of enforce-mode — never blocks):
 *   - SessionStart: if constraints.json is missing, inject a context line telling
 *     the agent to ASK the user before creating it.
 *   - PreToolUse Write|Edit: when implementation code is being written and
 *     constraints.json is missing or has no features, inject a strong advisory
 *     (and record it for the Stop-hook accountability summary). Never denies.
 *
 * Always exits 0. The artifact: constraints.json at the project root, keyed by
 * the same node ids as dependency-map.json so constraints and dependencies align.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// enforce-state helpers are reused for level/exemption/accountability. Loaded
// defensively so the gate degrades to a no-op rather than crashing a write if
// the state module is ever unavailable.
let state = {};
try { state = require('./enforce-state'); } catch { state = {}; }
const isActive = state.isActive || (() => true);
const isSkippedExtension = state.isSkippedExtension || (() => false);
const isExemptFilePath = state.isExemptFilePath || (() => false);
const recordPending = state.recordPending || (() => {});
const logEvent = state.logEvent || (() => {});

const ARTIFACT = 'constraints.json';

// The production constraints every service/feature must declare before design.
const REQUIRED = 'SLO (p99 latency + availability), load (QPS, read/write ratio, data volume + growth), tenancy, data sensitivity, budget, and failure tolerance';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    setTimeout(() => resolve({}), 200); // SessionStart may send no stdin
  });
}

// constraints.json present AND carrying at least one feature entry.
function constraintsSatisfied(cwd) {
  try {
    const p = path.join(cwd, ARTIFACT);
    if (!fs.existsSync(p)) return false;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return !!(parsed && parsed.features && Object.keys(parsed.features).length > 0);
  } catch {
    return false; // unparseable/empty → treat as not satisfied (advisory will nudge)
  }
}

// Heuristic: is this write an implementation-code change that needs constraints?
// Code file, not an exempt/skip path, and the source looks like real logic.
function isImplementationCode(filePath, source) {
  if (!filePath) return false;
  if (isSkippedExtension(filePath) || isExemptFilePath(filePath)) return false;
  const base = path.basename(filePath).toLowerCase();
  // Exempt docs / tests / config — they don't carry runtime constraints.
  if (/\.(md|markdown|txt|json|ya?ml|toml|ini|lock|csv)$/.test(base)) return false;
  if (/(^|[._-])(test|spec|mock|fixture)([._-]|$)/.test(base)) return false;
  if (/(^|\/)(tests?|__tests__|specs?)\//.test(filePath.replace(/\\/g, '/'))) return false;
  // Looks like implementation: imports or a function/class/route definition.
  return /\b(import|require|from|func |fn |def |class |function|public |private |app\.(get|post|put|delete|patch)|router\.)/.test(source);
}

function emitSessionStart() {
  const msg =
    '\n\n## Constraint Intake (missing)\n' +
    `enforce-mode keeps a production-constraints artifact at the project root: ${ARTIFACT}. ` +
    `It is missing. Real-world (sustained, production) design is constraint-driven — without it, designs default to hobby-grade. ` +
    `ASK the user (AskUserQuestion, structured options) before creating ${ARTIFACT}; do not create it silently. ` +
    `On approval: capture, per feature/service (keyed by the same ids as dependency-map.json), ${REQUIRED}. ` +
    `A design with no SLO is not production-grade. Keep it current as features change. Never put secrets in it.`;
  process.stdout.write(msg);
  process.exit(0);
}

function emitPreToolAdvisory(filePath) {
  const msg =
    'CONSTRAINT INTAKE — no production constraints captured for this implementation.\n' +
    `File: ${filePath}\n` +
    `Missing artifact: ${ARTIFACT} (or it has no feature entries).\n\n` +
    `Before/with this code, capture: ${REQUIRED}.\n` +
    'Without these, this is a hobby-grade design, not a sustained production one. ' +
    'See constraints.template.json for the shape; ask the user for the values.';
  process.stderr.write('[CONSTRAINT-GATE] ' + msg + '\n');
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

async function main() {
  const input = await readStdin();
  const cwd = process.cwd();
  const event = input.hook_event_name || (input.tool_name ? 'PreToolUse' : 'SessionStart');

  // ── SessionStart: warn once if the artifact is missing ──
  if (event === 'SessionStart') {
    if (!constraintsSatisfied(cwd)) emitSessionStart();
    process.exit(0);
  }

  // ── PreToolUse Write|Edit: advise when impl code lacks constraints ──
  const toolName = input.tool_name || '';
  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const sessionId = input.session_id || '';
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';
  if (!source || !isImplementationCode(filePath, source)) process.exit(0);

  if (!constraintsSatisfied(cwd)) {
    recordPending(sessionId, 'constraints', filePath, ['production constraints not captured']);
    logEvent(sessionId, { hook: 'constraint-gate', action: 'warn', file: filePath, result: 'constraints-missing' });
    emitPreToolAdvisory(filePath);
    return;
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
