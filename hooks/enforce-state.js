#!/usr/bin/env node
/**
 * enforce-state.js — Cross-hook state persistence + PECK enforcement engine
 *
 * PECK = Progressive Escalation with Circuit-breaker and K-step recovery
 *
 * Phase 1 hooks (PreToolUse) call peckEvaluate() to get enforcement tier.
 * Phase 2 hook (Stop) reads dead letters and compliance summary.
 *
 * State file: OS temp dir / enforce-{session_id}.json
 *
 * PER-SESSION ISOLATION: each session has its own state.
 * All operations are fail-safe — state loss = tier 0 (not deadlock).
 *
 * PECK TIERS:
 *   Tier 0: APPROVE + advisory context
 *   Tier 1: APPROVE + strong warning with escalation notice
 *   Tier 2: DENY (bounded — 1 retry before auto-escalate to tier 3)
 *   Tier 3: HARD BLOCK (exit 2, terminates retry loop)
 *
 * CIRCUIT BREAKER (per category):
 *   CLOSED → normal evaluation
 *   OPEN → all actions in category jump to tier 3
 *   HALF_OPEN → one probe allowed after intervening calls
 *
 * K-STEP RECOVERY:
 *   On violation, Claude has K tool calls to comply.
 *   Each non-violating tool call decrements K.
 *   When K=0 without compliance → auto-escalate tier.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════════════════════
// PECK CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PECK_CONFIG = {
  // Escalation tiers
  tiers: [
    { name: 'advisory',   action: 'approve_context' },
    { name: 'warning',    action: 'approve_strong_warn' },
    { name: 'soft_block', action: 'deny' },
    { name: 'hard_block', action: 'hard_block' },
  ],

  // K-step recovery: tool calls to comply before auto-escalation
  recoverySteps: 5,

  // Circuit breaker
  circuitFailureThreshold: 3,  // failures before circuit opens
  circuitHalfOpenAfter: 2,     // intervening non-violating calls before probe

  // Exact retry detection
  exactRetryMultiplier: 2,     // double-count violations for exact retries
  semanticRetryMultiplier: 1.5, // same category+file+pattern but different content

  // Forgiveness: compliance reduces violation count by this amount
  forgivenessDecay: 1,

  // ─── PECK v2: Confidence-Weighted Escalation ───

  // Confidence levels — patterns declare their precision
  confidence: {
    HIGH: 1.0,    // Near-certain violation (e.g., hardcoded AWS key)
    MEDIUM: 0.5,  // Likely violation, some FP possible (e.g., eval())
    LOW: 0.25,    // Possible violation, high FP risk (e.g., missing auth decorator)
  },

  // Accumulation threshold — below this, advisory only (never escalates)
  accumulationThreshold: 0.5,

  // Accelerated escalation threshold — above this, skip tier 0
  acceleratedThreshold: 0.75,

  // Context multipliers — where code appears affects weight
  contextMultipliers: {
    comment: 0.0,           // Inside code comment
    stringLiteral: 0.1,    // Inside non-assignment string
    testFile: 0.0,         // Inside test file
    typeDefinition: 0.0,   // Inside interface/type declaration
    tryCatch: 0.5,         // Inside try/catch with handler
    normal: 1.0,           // Normal code context
    securityFile: 1.5,     // auth.js, middleware.js, security files
  },

  // Domain relevance multipliers
  domainRelevance: {
    active: 1.0,           // Domain detected by enforce-detect.js
    extensionMatch: 0.3,   // File extension matches but domain not detected
    none: 0.0,             // Neither — suppress entirely
  },

  // Circuit breaker thresholds by confidence level
  circuitThresholds: {
    HIGH: 2,     // 2 HIGH-confidence failures → open
    MEDIUM: 4,   // 4 MEDIUM-confidence failures → open
    LOW: Infinity, // LOW confidence NEVER opens circuit (advisory only)
  },

  // Per-category budgets (max violations before tier 3 hard-block)
  // v2: split security into secrets (HIGH confidence) vs patterns (MEDIUM)
  categoryBudgets: {
    // Original categories (backward compatible)
    research: 4,            // generous — LOW-MEDIUM confidence patterns
    dsa: 3,                 // unchanged
    test: 2,                // unchanged
    // v2: security split
    'security-secrets': 1,  // HIGH confidence only → budget=1 safe
    'security-patterns': 3, // MEDIUM confidence → needs room for FPs
    security: 1,            // legacy fallback (deprecated, use split categories)
    // New domain categories
    blockchain: 3,          // MEDIUM-HIGH for Solidity patterns
    frontend: 4,            // MEDIUM patterns, many legitimate exceptions
    mobile: 3,              // MEDIUM patterns
    'research-paper': 5,    // LOW confidence, high FP risk → very generous
    training: 3,            // MEDIUM confidence
    book: 5,                // LOW confidence → advisory-heavy
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE FILE PATH
// ═══════════════════════════════════════════════════════════════════════════

function getStatePath(sessionId) {
  if (!sessionId) return null;
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `enforce-${safe}.json`);
}

// ═══════════════════════════════════════════════════════════════════════════
// READ / WRITE STATE
// ═══════════════════════════════════════════════════════════════════════════

const EMPTY_PECK = {
  violations: {},     // { category: { count, tier } }
  fingerprints: {},   // { fp: { category, count, lastSeen } }
  circuits: {},       // { category: { state, failures, interveningCalls } }
  recovery: {},       // { key: { stepsRemaining, category, file } }
  deadLetters: [],    // [{ category, file, deniedCount, reason, timestamp }]
  totalCalls: 0,
};

function readState(sessionId) {
  const empty = {
    level: null,
    pending: [],
    researched: [],
    dsaJustified: [],
    peck: { ...EMPTY_PECK },
  };
  const statePath = getStatePath(sessionId);
  if (!statePath) return empty;

  try {
    if (!fs.existsSync(statePath)) return empty;
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      level: data.level || null,
      pending: Array.isArray(data.pending) ? data.pending : [],
      researched: Array.isArray(data.researched) ? data.researched : [],
      dsaJustified: Array.isArray(data.dsaJustified) ? data.dsaJustified : [],
      peck: {
        violations: data.peck?.violations || {},
        fingerprints: data.peck?.fingerprints || {},
        circuits: data.peck?.circuits || {},
        recovery: data.peck?.recovery || {},
        deadLetters: Array.isArray(data.peck?.deadLetters) ? data.peck.deadLetters : [],
        totalCalls: data.peck?.totalCalls || 0,
      },
    };
  } catch {
    return empty;
  }
}

function writeState(sessionId, state) {
  const statePath = getStatePath(sessionId);
  if (!statePath) return;
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch {
    // Silent — state loss = tier 0, not deadlock
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY API (backward compatible — used by existing hooks)
// ═══════════════════════════════════════════════════════════════════════════

function recordPending(sessionId, type, filePath, patterns) {
  const state = readState(sessionId);
  const exists = state.pending.some(p => p.type === type && p.file === filePath);
  if (exists) return;
  state.pending.push({ type, file: filePath, patterns, timestamp: Date.now() });
  writeState(sessionId, state);
}

function recordResearch(sessionId, tool) {
  const state = readState(sessionId);
  if (!state.researched.includes(tool)) {
    state.researched.push(tool);
    writeState(sessionId, state);
  }
}

function recordDSAJustified(sessionId, filePath) {
  const state = readState(sessionId);
  if (!state.dsaJustified.includes(filePath)) {
    state.dsaJustified.push(filePath);
    writeState(sessionId, state);
  }
}

function getUnresolved(sessionId) {
  const state = readState(sessionId);
  const hasResearch = state.researched.length > 0;
  return state.pending.filter(p => {
    if (p.type === 'research') return !hasResearch;
    if (p.type === 'dsa') return !state.dsaJustified.includes(p.file);
    return true;
  });
}

function getSummary(sessionId) {
  const state = readState(sessionId);
  const unresolved = getUnresolved(sessionId);
  return {
    totalPending: state.pending.length,
    unresolvedResearch: unresolved.filter(p => p.type === 'research').length,
    unresolvedDSA: unresolved.filter(p => p.type === 'dsa').length,
    resolvedCount: state.pending.length - unresolved.length,
  };
}

function setLevel(sessionId, level) {
  const state = readState(sessionId);
  state.level = level;
  writeState(sessionId, state);
}

function getLevel(sessionId) {
  return readState(sessionId).level;
}

function isActive(sessionId) {
  const level = getLevel(sessionId);
  if (level === 'off') return false;
  return true;
}

function clearState(sessionId) {
  const statePath = getStatePath(sessionId);
  if (!statePath) return;
  try { fs.unlinkSync(statePath); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK: SEMANTIC FINGERPRINTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate semantic fingerprint for an action.
 * Fingerprints by category + file, NOT exact content.
 * This catches retry variants (same file, same violation, different code).
 *
 * @param {string} category - 'research'|'dsa'|'test'|'security'
 * @param {string} filePath - target file
 * @returns {string} fingerprint key
 */
function peckFingerprint(category, filePath) {
  return category + ':' + (filePath || 'unknown');
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK: CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════

function getCircuit(state, category) {
  if (!state.peck.circuits[category]) {
    state.peck.circuits[category] = {
      state: 'CLOSED',
      failures: 0,
      interveningCalls: 0,
    };
  }
  return state.peck.circuits[category];
}

/**
 * Check circuit breaker for a category.
 * @returns {'CLOSED'|'OPEN'|'HALF_OPEN'|'PROBE'} effective state
 */
function checkCircuit(state, category) {
  const circuit = getCircuit(state, category);

  if (circuit.state === 'CLOSED') return 'CLOSED';

  if (circuit.state === 'OPEN') {
    if (circuit.interveningCalls >= PECK_CONFIG.circuitHalfOpenAfter) {
      circuit.state = 'HALF_OPEN';
      return 'PROBE'; // allow one probe
    }
    return 'OPEN'; // still blocked
  }

  if (circuit.state === 'HALF_OPEN') {
    return 'PROBE';
  }

  return 'CLOSED';
}

function circuitRecordFailure(state, category) {
  const circuit = getCircuit(state, category);
  circuit.failures++;
  if (circuit.failures >= PECK_CONFIG.circuitFailureThreshold) {
    circuit.state = 'OPEN';
    circuit.interveningCalls = 0;
  }
}

function circuitRecordSuccess(state, category) {
  const circuit = getCircuit(state, category);
  circuit.state = 'CLOSED';
  circuit.failures = 0;
  circuit.interveningCalls = 0;
}

/**
 * Increment intervening calls for ALL open circuits.
 * Called on every non-violating tool call.
 */
function circuitTickIntervening(state) {
  for (const cat of Object.keys(state.peck.circuits)) {
    const circuit = state.peck.circuits[cat];
    if (circuit.state === 'OPEN' || circuit.state === 'HALF_OPEN') {
      circuit.interveningCalls++;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK: ESCALATION TIERS
// ═══════════════════════════════════════════════════════════════════════════

function getViolation(state, category) {
  if (!state.peck.violations[category]) {
    state.peck.violations[category] = { count: 0, tier: 0 };
  }
  return state.peck.violations[category];
}

/**
 * Compute current tier based on violation count and category budget.
 */
function computeTier(violationCount, category) {
  const budget = PECK_CONFIG.categoryBudgets[category] || 3;
  const maxTier = PECK_CONFIG.tiers.length - 1;

  if (violationCount <= 0) return 0;
  if (violationCount >= budget) return maxTier; // hard block

  // Map violations to tiers based on budget.
  // budget=3: 1→T0, 2→T1, 3→T3 | budget=2: 1→T1, 2→T3 | budget=1: 1→T3
  const ratio = violationCount / budget;
  if (ratio < 0.34) return 0;       // advisory
  if (ratio < 0.67) return 1;       // strong warning
  if (ratio < 1.0) return 2;        // deny
  return maxTier;                    // hard block
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK: K-STEP RECOVERY
// ═══════════════════════════════════════════════════════════════════════════

function startRecovery(state, category, filePath) {
  const key = peckFingerprint(category, filePath);
  state.peck.recovery[key] = {
    stepsRemaining: PECK_CONFIG.recoverySteps,
    category,
    file: filePath,
    startedAt: Date.now(),
  };
}

/**
 * Tick all recovery windows. Called on every tool call.
 * Returns array of expired recovery keys (for auto-escalation).
 */
function tickRecovery(state) {
  const expired = [];
  for (const [key, rec] of Object.entries(state.peck.recovery)) {
    rec.stepsRemaining--;
    if (rec.stepsRemaining <= 0) {
      expired.push({ key, category: rec.category, file: rec.file });
      delete state.peck.recovery[key];
    }
  }
  return expired;
}

function resolveRecovery(state, category, filePath) {
  const key = peckFingerprint(category, filePath);
  delete state.peck.recovery[key];
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK: DEAD LETTER QUEUE
// ═══════════════════════════════════════════════════════════════════════════

function addDeadLetter(state, category, filePath, reason) {
  state.peck.deadLetters.push({
    category,
    file: filePath,
    reason,
    timestamp: Date.now(),
  });
}

function getDeadLetters(sessionId) {
  return readState(sessionId).peck.deadLetters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK: MAIN EVALUATE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Core PECK evaluation. Called by PreToolUse hooks when a violation is detected.
 *
 * @param {string} sessionId
 * @param {string} category - 'research'|'dsa'|'test'|'security'
 * @param {string} filePath - target file
 * @param {string} reason   - human-readable violation reason
 * @returns {{ tier: number, action: string, tierName: string, message: string, violationCount: number }}
 */
function peckEvaluate(sessionId, category, filePath, reason) {
  if (!sessionId) {
    // No session → fallback to tier 0 (no state tracking possible)
    return {
      tier: 0,
      action: 'approve_context',
      tierName: 'advisory',
      message: reason,
      violationCount: 0,
    };
  }

  const state = readState(sessionId);
  const fp = peckFingerprint(category, filePath);

  // ── 1. Circuit breaker check ──
  const circuitStatus = checkCircuit(state, category);
  if (circuitStatus === 'OPEN') {
    addDeadLetter(state, category, filePath, reason);
    writeState(sessionId, state);
    return {
      tier: 3,
      action: 'hard_block',
      tierName: 'hard_block',
      message: '[ENFORCE CIRCUIT OPEN] Category "' + category + '" has too many failures. ' +
        'All actions in this category are blocked. Change approach or ask user for guidance.',
      violationCount: getViolation(state, category).count,
    };
  }

  // ── 2. Exact retry detection ──
  const fpEntry = state.peck.fingerprints[fp];
  const isExactRetry = fpEntry && (Date.now() - fpEntry.lastSeen) < 30000; // 30s window
  const increment = isExactRetry ? PECK_CONFIG.exactRetryMultiplier : 1;

  // ── 3. Record violation ──
  const violation = getViolation(state, category);
  violation.count += increment;

  // ── 4. Update fingerprint ──
  state.peck.fingerprints[fp] = {
    category,
    count: (fpEntry?.count || 0) + 1,
    lastSeen: Date.now(),
  };

  // ── 5. Compute tier ──
  const tier = computeTier(violation.count, category);
  violation.tier = tier;
  const tierInfo = PECK_CONFIG.tiers[tier];

  // ── 6. Circuit breaker failure tracking ──
  circuitRecordFailure(state, category);

  // ── 7. Start recovery window (if not already active) ──
  if (!state.peck.recovery[fp]) {
    startRecovery(state, category, filePath);
  }

  // ── 8. Dead letter if tier 3 ──
  if (tier >= 3) {
    addDeadLetter(state, category, filePath, reason);
  }

  // ── 9. Build tier-specific message ──
  const budget = PECK_CONFIG.categoryBudgets[category] || 3;
  const remaining = Math.max(0, budget - violation.count);
  let message;

  switch (tier) {
    case 0:
      message = '[ENFORCE L1 — ADVISORY] ' + reason + '\n' +
        'Violations: ' + violation.count + '/' + budget + '. ' +
        'Next violation escalates to WARNING.';
      break;
    case 1:
      message = '[ENFORCE L2 — WARNING] ' + reason + '\n' +
        'Violations: ' + violation.count + '/' + budget + '. ' +
        (isExactRetry ? 'EXACT RETRY DETECTED — double-counted. ' : '') +
        'Next violation will BLOCK this action. Comply now.';
      break;
    case 2:
      message = '[ENFORCE L3 — BLOCKED] ' + reason + '\n' +
        'Violations: ' + violation.count + '/' + budget + '. ' +
        (isExactRetry ? 'EXACT RETRY DETECTED. ' : '') +
        'This action is DENIED. You have 1 more attempt before PERMANENT BLOCK. ' +
        'Take the required corrective action BEFORE retrying.';
      break;
    case 3:
      message = '[ENFORCE L4 — HARD BLOCK] ' + reason + '\n' +
        'Violations: ' + violation.count + '/' + budget + '. Budget exhausted. ' +
        'This action is PERMANENTLY BLOCKED for this category. ' +
        'Change approach or ask the user for guidance.';
      break;
  }

  // ── 10. Persist state ──
  writeState(sessionId, state);

  return {
    tier,
    action: tierInfo.action,
    tierName: tierInfo.name,
    message,
    violationCount: violation.count,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK: COMPLIANCE RECORDING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record that Claude complied with a rule category.
 * Decays violation count and resets circuit breaker.
 * Called when hooks detect compliance (e.g., WebSearch performed, tests run).
 *
 * @param {string} sessionId
 * @param {string} category
 * @param {string} [filePath] - optional, to resolve specific recovery
 */
function peckRecordCompliance(sessionId, category, filePath) {
  if (!sessionId) return;
  const state = readState(sessionId);

  // Forgiveness decay
  const violation = getViolation(state, category);
  violation.count = Math.max(0, violation.count - PECK_CONFIG.forgivenessDecay);
  violation.tier = computeTier(violation.count, category);

  // Reset circuit breaker
  circuitRecordSuccess(state, category);

  // Resolve recovery window
  if (filePath) {
    resolveRecovery(state, category, filePath);
  }

  writeState(sessionId, state);
}

/**
 * Called on every tool call (violation or not) to:
 *   1. Tick recovery windows
 *   2. Tick circuit breaker intervening calls
 *   3. Auto-escalate expired recovery windows
 *
 * @param {string} sessionId
 * @returns {Array<{category: string, file: string}>} expired recoveries (for escalation)
 */
function peckTick(sessionId) {
  if (!sessionId) return [];
  const state = readState(sessionId);

  state.peck.totalCalls++;

  // Tick intervening calls for circuit breakers
  circuitTickIntervening(state);

  // Tick recovery windows
  const expired = tickRecovery(state);

  // Auto-escalate expired recoveries
  for (const exp of expired) {
    const violation = getViolation(state, exp.category);
    violation.count++;
    violation.tier = computeTier(violation.count, exp.category);
    circuitRecordFailure(state, exp.category);
  }

  writeState(sessionId, state);
  return expired;
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK: SUMMARY FOR PHASE 2
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get PECK enforcement summary for stop-guard.
 */
function peckGetSummary(sessionId) {
  const state = readState(sessionId);
  const peck = state.peck;

  const categories = Object.keys(peck.violations);
  const activeRecoveries = Object.keys(peck.recovery).length;
  const deadLetterCount = peck.deadLetters.length;

  const violationSummary = {};
  for (const cat of categories) {
    const v = peck.violations[cat];
    const budget = PECK_CONFIG.categoryBudgets[cat] || 3;
    violationSummary[cat] = {
      count: v.count,
      tier: v.tier,
      tierName: PECK_CONFIG.tiers[v.tier]?.name || 'unknown',
      budget,
      remaining: Math.max(0, budget - v.count),
    };
  }

  const circuitSummary = {};
  for (const cat of Object.keys(peck.circuits)) {
    circuitSummary[cat] = peck.circuits[cat].state;
  }

  return {
    totalCalls: peck.totalCalls,
    violations: violationSummary,
    circuits: circuitSummary,
    activeRecoveries,
    deadLetters: peck.deadLetters,
    deadLetterCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK v2: CONTEXT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect code context for a matched line/region.
 * Returns a context multiplier that modifies effective violation weight.
 *
 * @param {string} source - Full source code being written
 * @param {string} filePath - Target file path
 * @param {number} [matchIndex] - Character index of the match in source
 * @returns {number} Context multiplier (0.0 to 1.5)
 */
function detectContext(source, filePath, matchIndex) {
  // Test file — never escalate
  if (filePath && isTestFilePath(filePath)) {
    return PECK_CONFIG.contextMultipliers.testFile;
  }

  // Security-sensitive file — extra scrutiny
  if (filePath && isSecurityFile(filePath)) {
    return PECK_CONFIG.contextMultipliers.securityFile;
  }

  // If we have a match index, check local context
  if (matchIndex !== undefined && matchIndex >= 0 && source) {
    const lineStart = source.lastIndexOf('\n', matchIndex) + 1;
    const line = source.substring(lineStart, source.indexOf('\n', matchIndex));

    // Check if inside a comment
    if (isCommentLine(line)) {
      return PECK_CONFIG.contextMultipliers.comment;
    }

    // Check if inside type definition
    if (isTypeDefinition(line)) {
      return PECK_CONFIG.contextMultipliers.typeDefinition;
    }

    // Check if inside try/catch
    if (isInsideTryCatch(source, matchIndex)) {
      return PECK_CONFIG.contextMultipliers.tryCatch;
    }
  }

  return PECK_CONFIG.contextMultipliers.normal;
}

function isTestFilePath(fp) {
  if (!fp) return false;
  const patterns = ['/test/', '\\test\\', '/tests/', '\\tests\\',
    '/__tests__/', '.test.', '.spec.', '/fixtures/', '\\fixtures\\',
    'test-', '_test.'];
  return patterns.some(p => fp.includes(p));
}

function isSecurityFile(fp) {
  if (!fp) return false;
  const patterns = ['auth', 'middleware', 'security', 'permission',
    'guard', 'interceptor', 'policy', 'rbac', 'acl'];
  const basename = fp.split(/[/\\]/).pop().toLowerCase();
  return patterns.some(p => basename.includes(p));
}

function isCommentLine(line) {
  const trimmed = (line || '').trim();
  return trimmed.startsWith('//') || trimmed.startsWith('#') ||
    trimmed.startsWith('*') || trimmed.startsWith('/*') ||
    trimmed.startsWith('"""') || trimmed.startsWith("'''");
}

function isTypeDefinition(line) {
  const trimmed = (line || '').trim();
  return /^(interface|type|@typing|class\s+\w+.*\(Protocol\)|abstract\s+class)/.test(trimmed) ||
    /:\s*(str|int|float|bool|None|List|Dict|Optional|Union)\s*[,)\]]/.test(trimmed);
}

function isInsideTryCatch(source, index) {
  // Look backward for try/catch block start within 500 chars
  const lookback = source.substring(Math.max(0, index - 500), index);
  const hasTry = /(?:try\s*[{:]|try\s*\{)\s*$/m.test(lookback) ||
    lookback.includes('try {') || lookback.includes('try:');
  return hasTry;
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK v2: CONFIDENCE-WEIGHTED EVALUATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PECK v2 evaluation with confidence weighting.
 * Extends peckEvaluate with confidence, context, and domain relevance.
 *
 * @param {string} sessionId
 * @param {string} category
 * @param {string} filePath
 * @param {string} reason
 * @param {object} opts - v2 options
 * @param {string} opts.confidence - 'HIGH'|'MEDIUM'|'LOW' (default: 'MEDIUM')
 * @param {string} opts.source - source code (for context detection)
 * @param {number} opts.matchIndex - where pattern matched in source
 * @param {boolean} opts.domainActive - is this domain detected for project?
 * @param {string} opts.patternName - name of the specific pattern that matched
 * @returns {{ tier, action, tierName, message, violationCount, effectiveWeight, suppressed }}
 */
function peckEvaluateV2(sessionId, category, filePath, reason, opts = {}) {
  const {
    confidence = 'MEDIUM',
    source = '',
    matchIndex = -1,
    domainActive = true,
    patternName = '',
  } = opts;

  // ── 1. Compute effective weight ──
  const confidenceValue = PECK_CONFIG.confidence[confidence] || PECK_CONFIG.confidence.MEDIUM;
  const contextMult = detectContext(source, filePath, matchIndex);
  const domainMult = domainActive
    ? PECK_CONFIG.domainRelevance.active
    : PECK_CONFIG.domainRelevance.none;

  const effectiveWeight = confidenceValue * contextMult * domainMult;

  // ── 2. Zero effective weight → fully suppressed (no output) ──
  if (effectiveWeight <= 0) {
    return {
      tier: 0,
      action: 'approve_context',
      tierName: 'suppressed',
      message: '',
      violationCount: 0,
      effectiveWeight: 0,
      suppressed: true,
    };
  }

  // ── 3. Below threshold → advisory only, never escalates ──
  if (effectiveWeight < PECK_CONFIG.accumulationThreshold) {
    return {
      tier: 0,
      action: 'approve_context',
      tierName: 'advisory',
      message: '[ENFORCE ADVISORY — low confidence] ' + reason + '\n' +
        '(Confidence: ' + confidence + ', context: ' + contextMult.toFixed(1) +
        ', weight: ' + effectiveWeight.toFixed(2) + ' < threshold ' +
        PECK_CONFIG.accumulationThreshold + ')',
      violationCount: 0,
      effectiveWeight,
      suppressed: false,
    };
  }

  // ── 4. Standard PECK evaluation with weighted increment ──
  if (!sessionId) {
    return {
      tier: 0,
      action: 'approve_context',
      tierName: 'advisory',
      message: reason,
      violationCount: 0,
      effectiveWeight,
      suppressed: false,
    };
  }

  const state = readState(sessionId);
  const fp = peckFingerprint(category, filePath);

  // Circuit breaker (v2: confidence-aware threshold)
  const circuitStatus = checkCircuit(state, category);
  if (circuitStatus === 'OPEN') {
    // LOW confidence patterns bypass open circuits
    if (confidence === 'LOW') {
      return {
        tier: 0,
        action: 'approve_context',
        tierName: 'advisory',
        message: '[ENFORCE ADVISORY] ' + reason + '\n' +
          '(Circuit open but LOW confidence — advisory only)',
        violationCount: getViolation(state, category).count,
        effectiveWeight,
        suppressed: false,
      };
    }
    addDeadLetter(state, category, filePath, reason);
    writeState(sessionId, state);
    return {
      tier: 3,
      action: 'hard_block',
      tierName: 'hard_block',
      message: '[ENFORCE CIRCUIT OPEN] Category "' + category + '" has too many failures. ' +
        'All actions in this category are blocked. Change approach or ask user for guidance.',
      violationCount: getViolation(state, category).count,
      effectiveWeight,
      suppressed: false,
    };
  }

  // Exact/semantic retry detection
  const fpEntry = state.peck.fingerprints[fp];
  const isExactRetry = fpEntry && (Date.now() - fpEntry.lastSeen) < 30000;
  const isSamePattern = fpEntry && fpEntry.patternName === patternName && patternName !== '';
  let multiplier = 1;
  if (isExactRetry) {
    multiplier = PECK_CONFIG.exactRetryMultiplier;
  } else if (isSamePattern && fpEntry && (Date.now() - fpEntry.lastSeen) < 60000) {
    multiplier = PECK_CONFIG.semanticRetryMultiplier;
  }

  // Weighted increment (effectiveWeight scales the violation, not always +1)
  const increment = effectiveWeight * multiplier;

  // Record violation
  const violation = getViolation(state, category);
  violation.count += increment;

  // Update fingerprint (v2: includes patternName)
  state.peck.fingerprints[fp] = {
    category,
    count: (fpEntry?.count || 0) + 1,
    lastSeen: Date.now(),
    patternName,
  };

  // Compute tier (accelerated for HIGH confidence above threshold)
  let tier;
  if (effectiveWeight >= PECK_CONFIG.acceleratedThreshold && violation.count >= 1) {
    // Skip tier 0, start at tier 1 minimum
    tier = Math.max(1, computeTier(violation.count, category));
  } else {
    tier = computeTier(violation.count, category);
  }
  violation.tier = tier;
  const tierInfo = PECK_CONFIG.tiers[tier];

  // Circuit breaker failure tracking (v2: uses confidence-aware threshold)
  const circuitThreshold = PECK_CONFIG.circuitThresholds[confidence] ||
    PECK_CONFIG.circuitFailureThreshold;
  const circuit = getCircuit(state, category);
  circuit.failures++;
  if (circuit.failures >= circuitThreshold) {
    circuit.state = 'OPEN';
    circuit.interveningCalls = 0;
  }

  // Recovery window (v2: scaled by effectiveWeight)
  if (!state.peck.recovery[fp]) {
    const recoverySteps = Math.round(PECK_CONFIG.recoverySteps / Math.max(effectiveWeight, 0.25));
    state.peck.recovery[fp] = {
      stepsRemaining: recoverySteps,
      category,
      file: filePath,
      startedAt: Date.now(),
    };
  }

  // Dead letter if tier 3
  if (tier >= 3) {
    addDeadLetter(state, category, filePath, reason);
  }

  // Build tier-specific message
  const budget = PECK_CONFIG.categoryBudgets[category] || 3;
  const remaining = Math.max(0, budget - violation.count);
  const weightInfo = ' [confidence=' + confidence + ' weight=' + effectiveWeight.toFixed(2) + ']';
  let message;

  switch (tier) {
    case 0:
      message = '[ENFORCE L1 — ADVISORY] ' + reason + '\n' +
        'Violations: ' + violation.count.toFixed(1) + '/' + budget + '.' + weightInfo + '\n' +
        'Next violation escalates to WARNING.';
      break;
    case 1:
      message = '[ENFORCE L2 — WARNING] ' + reason + '\n' +
        'Violations: ' + violation.count.toFixed(1) + '/' + budget + '.' + weightInfo + '\n' +
        (isExactRetry ? 'EXACT RETRY DETECTED — double-counted. ' : '') +
        'Next violation will BLOCK this action. Comply now.';
      break;
    case 2:
      message = '[ENFORCE L3 — BLOCKED] ' + reason + '\n' +
        'Violations: ' + violation.count.toFixed(1) + '/' + budget + '.' + weightInfo + '\n' +
        (isExactRetry ? 'EXACT RETRY DETECTED. ' : '') +
        'This action is DENIED. You have 1 more attempt before PERMANENT BLOCK. ' +
        'Take the required corrective action BEFORE retrying.';
      break;
    case 3:
      message = '[ENFORCE L4 — HARD BLOCK] ' + reason + '\n' +
        'Violations: ' + violation.count.toFixed(1) + '/' + budget + '. Budget exhausted.' + weightInfo + '\n' +
        'This action is PERMANENTLY BLOCKED for this category. ' +
        'Change approach or ask the user for guidance.';
      break;
  }

  // Persist state
  writeState(sessionId, state);

  return {
    tier,
    action: tierInfo.action,
    tierName: tierInfo.name,
    message,
    violationCount: violation.count,
    effectiveWeight,
    suppressed: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PECK v2: WEIGHTED COMPLIANCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record compliance with confidence-weighted forgiveness.
 * Higher confidence compliance = stronger forgiveness decay.
 *
 * @param {string} sessionId
 * @param {string} category
 * @param {string} [filePath]
 * @param {string} [confidence] - 'HIGH'|'MEDIUM'|'LOW' (default: 'MEDIUM')
 */
function peckRecordComplianceV2(sessionId, category, filePath, confidence = 'MEDIUM') {
  if (!sessionId) return;
  const state = readState(sessionId);

  const confidenceValue = PECK_CONFIG.confidence[confidence] || PECK_CONFIG.confidence.MEDIUM;
  const decay = PECK_CONFIG.forgivenessDecay * (1 + confidenceValue);

  const violation = getViolation(state, category);
  violation.count = Math.max(0, violation.count - decay);
  violation.tier = computeTier(violation.count, category);

  // Reset circuit breaker
  circuitRecordSuccess(state, category);

  // Resolve recovery window
  if (filePath) {
    resolveRecovery(state, category, filePath);
  }

  writeState(sessionId, state);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // State file
  getStatePath,
  readState,
  writeState,

  // Legacy API (backward compat)
  recordPending,
  recordResearch,
  recordDSAJustified,
  getUnresolved,
  getSummary,
  setLevel,
  getLevel,
  isActive,
  clearState,

  // PECK engine (v1 — backward compat)
  PECK_CONFIG,
  peckFingerprint,
  peckEvaluate,
  peckRecordCompliance,
  peckTick,
  peckGetSummary,
  getDeadLetters,

  // PECK v2 — confidence-weighted
  peckEvaluateV2,
  peckRecordComplianceV2,
  detectContext,
  isTestFilePath,
  isSecurityFile,
  isCommentLine,
  isTypeDefinition,
  isInsideTryCatch,
};
