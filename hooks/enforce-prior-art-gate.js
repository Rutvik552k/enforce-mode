#!/usr/bin/env node
/**
 * enforce-prior-art-gate.js — Prior-Art Grounding Gate (Layer 5/6, ADVISORY)
 *
 * The model's default design prior is tutorial/hobby code. This gate forces the
 * stronger prior: how production systems (tech giants) actually solved the same
 * algorithmic class — named algorithm/architecture, with a CITED source — then
 * reverse-engineer + adapt. Grounding (Rule 1) applied to architecture, not just
 * API signatures.
 *
 * HALLUCINATION GUARD: a "company X uses algorithm Y" claim with no citation is
 * worse than nothing (confident-wrong). So the dossier must carry at least one
 * real source (URL / doi / arXiv / [cite:...]); claims without one are UNVERIFIED
 * and must not be load-bearing in the design.
 *
 * ADVISORY (never blocks — matches the rest of enforce-mode):
 *   - SessionStart: warn if design-dossier.md is missing.
 *   - PreToolUse Write|Edit: when implementation code is written and no cited
 *     design dossier exists, inject a strong advisory + record pending.
 * Always exits 0.
 *
 * Artifact: design-dossier.md at the project root — per-feature prior-art study
 * (problem → algorithmic class → how ≥2 production systems solved it w/ named
 * algorithm + cited source → chosen approach + Big-O → adaptation).
 */

'use strict';

const fs = require('fs');
const path = require('path');

let state = {};
try { state = require('./enforce-state'); } catch { state = {}; }
const isActive = state.isActive || (() => true);
const isSkippedExtension = state.isSkippedExtension || (() => false);
const isExemptFilePath = state.isExemptFilePath || (() => false);
const recordPending = state.recordPending || (() => {});
const logEvent = state.logEvent || (() => {});

const ARTIFACT = 'design-dossier.md';
// At least one real citation: URL, doi, arXiv, or an explicit [cite:...] marker.
const CITATION_RE = /(https?:\/\/|doi:|arxiv|\[cite[:\]])/i;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    setTimeout(() => resolve({}), 200);
  });
}

// Dossier present AND carrying at least one real citation (hallucination guard).
function dossierSatisfied(cwd) {
  try {
    const p = path.join(cwd, ARTIFACT);
    if (!fs.existsSync(p)) return false;
    const txt = fs.readFileSync(p, 'utf8');
    return txt.trim().length > 0 && CITATION_RE.test(txt);
  } catch {
    return false;
  }
}

function isImplementationCode(filePath, source) {
  if (!filePath) return false;
  if (isSkippedExtension(filePath) || isExemptFilePath(filePath)) return false;
  const base = path.basename(filePath).toLowerCase();
  if (/\.(md|markdown|txt|json|ya?ml|toml|ini|lock|csv)$/.test(base)) return false;
  if (/(^|[._-])(test|spec|mock|fixture)([._-]|$)/.test(base)) return false;
  if (/(^|\/)(tests?|__tests__|specs?)\//.test(filePath.replace(/\\/g, '/'))) return false;
  return /\b(import|require|from|func |fn |def |class |function|public |private |app\.(get|post|put|delete|patch)|router\.)/.test(source);
}

function emitSessionStart() {
  const msg =
    '\n\n## Prior-Art Grounding (missing)\n' +
    `enforce-mode keeps a design-dossier at the project root: ${ARTIFACT}. It is missing. ` +
    `Before designing a non-trivial feature, ground it in how production systems actually solved the same algorithmic class — not the tutorial default. ` +
    `ASK the user (AskUserQuestion) before creating ${ARTIFACT}; do not create it silently. ` +
    `On approval, per feature capture: the problem, its algorithmic class, how >=2 production systems (named companies) solved it with the named algorithm/architecture AND a real cited source (eng blog / paper / talk), the chosen approach + Big-O, and the adaptation. ` +
    `A "company X uses algorithm Y" claim with NO citation is UNVERIFIED and must not be load-bearing. Never put secrets in it.`;
  process.stdout.write(msg);
  process.exit(0);
}

function emitPreToolAdvisory(filePath) {
  const msg =
    'PRIOR-ART GROUNDING — no cited design dossier for this implementation.\n' +
    `File: ${filePath}\n` +
    `Missing/uncited artifact: ${ARTIFACT}.\n\n` +
    'Before this code, study how production systems solved this problem class:\n' +
    '  1. Name the algorithmic class of the problem.\n' +
    '  2. Find how >=2 tech giants solved it — the named algorithm/architecture + a REAL cited source (eng blog / paper / talk).\n' +
    '  3. Reverse-engineer + adapt; state Big-O.\n' +
    'A "company X uses Y" claim with no citation is UNVERIFIED — do not rely on it. ' +
    'See design-dossier.template.md for the shape.';
  process.stderr.write('[PRIOR-ART-GATE] ' + msg + '\n');
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

async function main() {
  const input = await readStdin();
  const cwd = process.cwd();
  const event = input.hook_event_name || (input.tool_name ? 'PreToolUse' : 'SessionStart');

  if (event === 'SessionStart') {
    if (!dossierSatisfied(cwd)) emitSessionStart();
    process.exit(0);
  }

  const toolName = input.tool_name || '';
  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const sessionId = input.session_id || '';
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';
  if (!source || !isImplementationCode(filePath, source)) process.exit(0);

  if (!dossierSatisfied(cwd)) {
    recordPending(sessionId, 'prior-art', filePath, ['no cited design dossier']);
    logEvent(sessionId, { hook: 'prior-art-gate', action: 'warn', file: filePath, result: 'dossier-missing' });
    emitPreToolAdvisory(filePath);
    return;
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
