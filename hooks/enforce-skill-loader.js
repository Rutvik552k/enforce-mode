#!/usr/bin/env node
/**
 * enforce-skill-loader.js — PreToolUse hook for skill loading enforcement
 *
 * PECK-integrated: uses peckEvaluateV2() with ALWAYS severity (v3 — full T0→T3 at all levels).
 *
 * SKILL RESOLUTION: Fully dynamic via enforce-skill-registry.js (zero hardcoded maps).
 *
 * TRIGGERS:
 *   - Write|Edit|NotebookEdit → file type + content → suggest skills
 *   - WebSearch|WebFetch|Agent → research context → suggest skills
 *
 * COMPLIANCE (hardened v2):
 *   - Requires STRUCTURED tool invocation evidence (tool_name:"Skill" in JSON)
 *   - Plain text mentions of skill names do NOT count as compliance
 *   - Compliance must match at least ONE required skill for the file type
 *   - Forgiveness capped at MAX_COMPLIANCE_PER_SESSION
 *
 * ANTI-EVASION (v2 hardening):
 *   - Structured transcript check: requires "tool_name":"Skill" JSON pattern
 *   - Specific skill matching: loaded skills must overlap with required skills
 *   - Exempt paths narrowed: only enforce-mode hook files exempt, NOT test files
 *   - Size threshold lowered: 5 chars (prevents tiny-file bypass)
 *   - Forgiveness cap: max 3 compliance decays per session
 *   - enforce-ignore comments do NOT suppress skill-loading (not domain patterns)
 *
 * LEVEL BEHAVIOR (PECK v3, ALWAYS severity — no level cap):
 *   solo: T0-T3 (full escalation, confidence-weighted)
 *   team: T0-T3 (full escalation, confidence-weighted)
 *   prod: T0-T3 (full escalation, confidence-weighted)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  isActive, getLevel, peckEvaluateV2, peckTick,
  peckRecordComplianceV2, getSuggestedSkills,
  recordSuggestedSkills, readState, writeState, logEvent,
  isSkippedExtension, isExemptFilePath,
} = require('./enforce-state');

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC SKILL RESOLUTION — fully dynamic, zero hardcoded skill maps
// ═══════════════════════════════════════════════════════════════════════════

const { resolveWriteSkills, resolveResearchSkills } = require('./enforce-skill-registry');

// ═══════════════════════════════════════════════════════════════════════════
// TOOL GROUPS
// ═══════════════════════════════════════════════════════════════════════════

const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];
const RESEARCH_TOOLS = ['WebSearch', 'WebFetch', 'Agent'];
const ALL_TRIGGER_TOOLS = [...WRITE_TOOLS, ...RESEARCH_TOOLS];

// ═══════════════════════════════════════════════════════════════════════════
// ANTI-EVASION CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MIN_SOURCE_LENGTH = 5;           // v2: lowered from 20 (prevents tiny-file bypass)
const MAX_COMPLIANCE_PER_SESSION = 3;  // v2: cap forgiveness decays per session

// ═══════════════════════════════════════════════════════════════════════════
// SELF-EXEMPTION (v2: narrowed — only hook files, NOT test files)
// ═══════════════════════════════════════════════════════════════════════════

// SKIP_EXTENSIONS + EXEMPT_PATHS: now centralized in enforce-state.js

function isCodeFile(fp) {
  return fp && !isSkippedExtension(fp);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSCRIPT COMPLIANCE CHECK (v2: hardened — structured invocation only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HARDENED: Check transcript for STRUCTURED Skill tool invocations.
 *
 * Anti-evasion:
 *   - Requires "tool_name" + "Skill" in proximity (JSON tool call structure)
 *   - Plain text mentions of skill names do NOT count
 *   - Returns which specific skills were invoked (for specificity check)
 *
 * @param {string} transcriptPath
 * @param {string[]} requiredSkills - skills needed for this file type
 * @returns {{ found: boolean, loaded: string[], specificMatch: boolean }}
 */
function checkSkillCompliance(transcriptPath, requiredSkills) {
  if (!transcriptPath) return { found: false, loaded: [], specificMatch: false };
  try {
    if (!fs.existsSync(transcriptPath)) return { found: false, loaded: [], specificMatch: false };
    const content = fs.readFileSync(transcriptPath, 'utf8');

    // v2 HARDENED: Look for structured tool invocation patterns
    // Claude Code transcripts record tool calls as JSON with "tool_name":"Skill"
    const STRUCTURED_PATTERNS = [
      /["']?tool_name["']?\s*:\s*["']Skill["']/g,       // JSON: "tool_name":"Skill"
      /tool_name.*?Skill/g,                               // loose structured match
      /"skill"\s*:\s*["'][a-z0-9]/g,                        // Skill tool args: "skill":"<any-skill>"
    ];

    const hasStructuredInvocation = STRUCTURED_PATTERNS.some(p => p.test(content));

    if (!hasStructuredInvocation) {
      return { found: false, loaded: [], specificMatch: false };
    }

    // Extract which specific skills were invoked from structured args
    const skillArgPattern = /["']skill["']\s*:\s*["']([a-z0-9][a-z0-9:_-]*)["']/g;
    const loaded = [];
    let match;
    while ((match = skillArgPattern.exec(content)) !== null) {
      loaded.push(match[1]);
    }
    const unique = [...new Set(loaded)];

    // v2: Check specificity — at least one loaded skill must match required
    const requiredSet = new Set(requiredSkills);
    const specificMatch = unique.some(s => requiredSet.has(s));

    return {
      found: true,
      loaded: unique,
      specificMatch,
    };
  } catch { return { found: false, loaded: [], specificMatch: false }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLIANCE RATE LIMITING (v2: cap forgiveness per session)
// ═══════════════════════════════════════════════════════════════════════════

function getComplianceCount(sessionId) {
  const state = readState(sessionId);
  return state.skillComplianceCount || 0;
}

function incrementComplianceCount(sessionId) {
  const state = readState(sessionId);
  state.skillComplianceCount = (state.skillComplianceCount || 0) + 1;
  writeState(sessionId, state);
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK RESULT EMISSION
// ═══════════════════════════════════════════════════════════════════════════

function emitPeckResult(result) {
  if (result.tier >= 3) {
    process.stderr.write(result.message);
    process.exit(2);
  }

  if (result.tier === 2) {
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: result.message }};
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

  // Tier 0 or 1: approve + dual output (stderr for user, context for Claude)
  process.stderr.write('[SKILL-LOADER] ' + result.message + '\n');
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: result.message }};
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// STDIN
// ═══════════════════════════════════════════════════════════════════════════

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const sessionId = input.session_id || '';
  const transcriptPath = input.transcript_path || '';

  // Gate: only trigger tools
  if (!ALL_TRIGGER_TOOLS.includes(toolName)) process.exit(0);

  // Gate: active sessions only (but ALL levels — no level filtering)
  if (sessionId && !isActive(sessionId)) process.exit(0);

  // Tick PECK recovery windows on every call
  peckTick(sessionId);

  let candidateSkills = [];
  let filePath = '';
  let source = '';

  if (WRITE_TOOLS.includes(toolName)) {
    // ── WRITE GROUP ──
    filePath = toolInput.file_path || toolInput.notebook_path || '';
    source = toolInput.content || toolInput.new_source || toolInput.new_string || '';

    if (!source || !filePath) process.exit(0);
    if (isExemptFilePath(filePath, true)) process.exit(0); // skillLoaderMode=true (no test exemption)
    if (!isCodeFile(filePath)) process.exit(0);
    // v2: lowered threshold from 20 to 5 (anti tiny-file bypass)
    if (source.length < MIN_SOURCE_LENGTH) process.exit(0);

    candidateSkills = resolveWriteSkills(filePath, source);
  } else {
    // ── RESEARCH GROUP ──
    const query = toolInput.query || toolInput.url || toolInput.prompt
      || toolInput.description || toolInput.command || '';

    if (!query) process.exit(0);

    candidateSkills = resolveResearchSkills(query);
  }

  if (candidateSkills.length === 0) process.exit(0);

  // ── TRANSCRIPT COMPLIANCE CHECK (v2: hardened) ──
  const compliance = checkSkillCompliance(transcriptPath, candidateSkills);

  if (compliance.found && compliance.specificMatch) {
    // v2: Only grant compliance if specific skills match AND under cap
    const complianceCount = getComplianceCount(sessionId);
    if (complianceCount < MAX_COMPLIANCE_PER_SESSION) {
      incrementComplianceCount(sessionId);
      peckRecordComplianceV2(sessionId, 'skill-loading', filePath, 'MEDIUM');
    }
    logEvent(sessionId, { hook: 'skill-loader', action: 'pass', file: filePath || 'research', result: 'compliant', details: { loaded: compliance.loaded.slice(0, 5) } });
    // Always show which skills are active — dual output (stderr for user, context for Claude)
    const loadedList = compliance.loaded.slice(0, 5).map(s => '/' + s).join(', ');
    const complianceMsg = '[SKILLS LOADED] Active: ' + loadedList +
      (compliance.loaded.length > 5 ? ' (+' + (compliance.loaded.length - 5) + ' more)' : '') +
      ' \u2014 enforcement compliant.';
    process.stderr.write('[SKILL-LOADER] ' + complianceMsg + '\n');
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: '[SKILLS LOADED] Active: ' + loadedList +
          (compliance.loaded.length > 5
            ? ' (+' + (compliance.loaded.length - 5) + ' more)'
            : '') +
          ' \u2014 enforcement compliant.',
      }
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

  // v2: Structured invocation found but wrong skills → partial credit, still escalate
  if (compliance.found && !compliance.specificMatch) {
    // Skills loaded but not the RIGHT ones — warn but still escalate
    const loadedList = compliance.loaded.slice(0, 3).map(s => '/' + s).join(', ');
    const neededList = candidateSkills.slice(0, 3).map(s => '/' + s).join(', ');
    const level = (sessionId && getLevel(sessionId)) || 'solo';
    const reason =
      'Wrong skills loaded. Have: ' + loadedList + '. Need: ' + neededList + '.\n' +
      'File: ' + (filePath || 'research query');

    // ANTI-EVASION: pass empty source + empty filePath to peckEvaluateV2
    // so detectContext returns 1.0 (normal) — prevents test-file suppression
    const result = peckEvaluateV2(sessionId, 'skill-loading', 'skill-check', reason, {
      confidence: 'MEDIUM',
      severity: 'ALWAYS',
      level,
      source: '',
      matchIndex: -1,
      domainActive: true,
      patternName: 'skill-loading-wrong-' + candidateSkills[0],
    });

    if (result.suppressed || !result.message) process.exit(0);
    emitPeckResult(result);
    return;
  }

  // ── NO SKILLS LOADED — PECK ESCALATION ──
  logEvent(sessionId, { hook: 'skill-loader', action: 'escalate', file: filePath || 'research', result: 'no-skills', details: { needed: candidateSkills.slice(0, 3) } });

  // UX dedup — track which skills were already suggested (for display only)
  const alreadySuggested = new Set(getSuggestedSkills(sessionId));
  const newSkills = candidateSkills.filter(s => !alreadySuggested.has(s));
  // Record new skills for future dedup (display only)
  if (newSkills.length > 0) {
    recordSuggestedSkills(sessionId, newSkills);
  }
  // Use new skills for display if available, otherwise show all candidates
  const displaySkills = newSkills.length > 0 ? newSkills : candidateSkills;

  // Build reason with skill suggestions
  const level = (sessionId && getLevel(sessionId)) || 'solo';
  const skillList = displaySkills.slice(0, 3).map(s => '/' + s).join(', ');
  const more = displaySkills.length > 3
    ? ' (+' + (displaySkills.length - 3) + ' more)'
    : '';
  const reason =
    'Relevant skills not loaded before ' +
    (WRITE_TOOLS.includes(toolName) ? 'writing' : 'researching') + '.\n' +
    'Suggested: ' + skillList + more + '\n' +
    'File: ' + (filePath || 'research query');

  // PECK v3 with ALWAYS severity — full T0→T3 at all levels, plus
  // confidence weighting, circuit breakers, time decay.
  // ANTI-EVASION: pass 'skill-check' as filePath and empty source to
  // bypass detectContext test-file suppression. Skill-loading enforces
  // on ALL files including tests — context detection is not relevant here.
  const result = peckEvaluateV2(sessionId, 'skill-loading', 'skill-check', reason, {
    confidence: 'MEDIUM',
    severity: 'ALWAYS',
    level,
    source: '',
    matchIndex: -1,
    domainActive: true,
    patternName: 'skill-loading-' + displaySkills[0],
  });

  if (result.suppressed || !result.message) process.exit(0);

  emitPeckResult(result);
}

main().catch((e) => { process.stderr.write('SKILL-LOADER ERROR: ' + e.message); process.exit(0); });
