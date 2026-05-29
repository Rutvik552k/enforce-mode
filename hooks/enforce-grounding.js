#!/usr/bin/env node
/**
 * enforce-grounding.js — API-symbol → source attribution (anti-hallucination core)
 *
 * THE PROBLEM:
 *   The research gate verifies a *library* was researched (ground truth captured),
 *   but not that the *specific API symbols* the code calls actually appear in the
 *   captured documentation. An LLM can research `stripe`, then hallucinate
 *   `stripe.payments.chargeCard()` — a method that does not exist. Substring-level
 *   library checks miss this entirely.
 *
 * THE MECHANISM (citation-attribution, adapted to code):
 *   Extract every external-looking API call symbol from written source, then check
 *   each against the text of captured ground-truth snippets. A symbol that does NOT
 *   appear in any researched doc is UNVERIFIED — the model is asserting an API
 *   surface it has no source for. This is the code analogue of citation
 *   faithfulness (VeriCite, SIGIR-AP 2025) and the abstention principle from
 *   semantic-entropy hallucination work (Farquhar et al., Nature 2024): when a
 *   claim has no grounding, flag it rather than emit it as fact.
 *
 * FALSE-POSITIVE CALIBRATION (ZeroFalse / path-feasibility, arXiv 2510.02534):
 *   High FP rates destroy developer trust, so this module is deliberately
 *   conservative:
 *     - Language/runtime builtins (.map, .then, .log, .push …) are never flagged.
 *     - Only fires when research ground truth EXISTS to check against — never
 *       second-guesses code for which no research was even attempted (that is the
 *       research gate's job, not grounding's).
 *     - confidence HIGH only for deep call chains (a.b.c(...)) that look like real
 *       SDK surface; shallow a.b(...) calls are MEDIUM and stay advisory-leaning.
 *
 * DEADLOCK SAFETY:
 *   There is always an escape: searching the flagged symbol captures it into ground
 *   truth, after which it grounds and the gate clears. The gate never blocks a
 *   symbol it cannot tell you how to clear.
 *
 * Pure functions, zero side effects, zero npm dependencies.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// BUILTIN / NOISE METHODS — never treated as external library surface
// ═══════════════════════════════════════════════════════════════════════════

// Language + runtime builtins and ubiquitous collection/promise/string methods.
// Calling these proves nothing about an external library's API, so flagging them
// would be pure false-positive noise.
const BUILTIN_METHODS = new Set([
  // console / logging
  'log', 'error', 'warn', 'info', 'debug', 'trace', 'assert',
  // Array / iterable
  'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat',
  'map', 'filter', 'reduce', 'reduceright', 'foreach', 'find', 'findindex',
  'some', 'every', 'includes', 'indexof', 'lastindexof', 'flat', 'flatmap',
  'sort', 'reverse', 'fill', 'copywithin', 'entries', 'keys', 'values',
  // Promise / async
  'then', 'catch', 'finally', 'all', 'allsettled', 'race', 'any',
  'resolve', 'reject',
  // String
  'split', 'join', 'replace', 'replaceall', 'trim', 'trimstart', 'trimend',
  'tolowercase', 'touppercase', 'startswith', 'endswith', 'substring',
  'substr', 'charat', 'charcodeat', 'padstart', 'padend', 'repeat', 'match',
  'matchall', 'normalize',
  // JSON / Object / Math (when used as member calls)
  'stringify', 'parse', 'assign', 'freeze', 'fromentries', 'getownpropertynames',
  'floor', 'ceil', 'round', 'random', 'abs', 'max', 'min', 'pow', 'sqrt',
  // RegExp / function
  'test', 'exec', 'bind', 'call', 'apply', 'tostring', 'valueof',
  // Map / Set (ambiguous, common as builtins)
  'has', 'add', 'clear', 'size',
  // Python-ish builtins (member-call form)
  'append', 'extend', 'items', 'format', 'strip', 'lstrip', 'rstrip',
  'lower', 'upper', 'encode', 'decode', 'startswith', 'endswith',
]);

// Roots that are never external libraries (self-reference / language constructs).
const NOISE_ROOTS = new Set([
  'this', 'self', 'super', 'console', 'process', 'window', 'document',
  'global', 'globalthis', 'module', 'exports', 'require', 'json', 'math',
  'object', 'array', 'string', 'number', 'boolean', 'date', 'promise',
  'error', 'map', 'set', 'symbol', 'reflect', 'proxy', 'res', 'req',
  'response', 'request', 'ctx', 'context', 'e', 'err', 'event',
]);

// ═══════════════════════════════════════════════════════════════════════════
// SYMBOL EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract external-looking API call symbols from source code.
 *
 * Matches member-access call chains like `client.chat.completions.create(` and
 * `stripe.charges.create(`. Filters out language builtins and self-references.
 *
 * @param {string} source
 * @returns {Array<{ full: string, root: string, method: string, depth: number, confidence: 'HIGH'|'MEDIUM' }>}
 */
function extractApiSymbols(source) {
  if (!source || typeof source !== 'string') return [];

  // root.seg(.seg)*(  — capture the chained call, requiring at least one dot.
  const chainRe = /\b([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*)+)\s*\(/g;
  const seen = new Set();
  const out = [];
  let m;

  while ((m = chainRe.exec(source)) !== null) {
    const root = m[1];
    const segs = m[2].split('.').map(s => s.trim()).filter(Boolean);
    if (segs.length === 0) continue;

    const method = segs[segs.length - 1];
    const rootLc = root.toLowerCase();
    const methodLc = method.toLowerCase();

    // FP filters
    if (NOISE_ROOTS.has(rootLc)) continue;
    if (BUILTIN_METHODS.has(methodLc)) continue;
    // Single-char roots are almost always loop/lambda vars, not libraries.
    if (root.length === 1) continue;

    const depth = segs.length; // number of dotted segments after root
    const full = root + '.' + segs.join('.');
    if (seen.has(full)) continue;
    seen.add(full);

    out.push({
      full,
      root,
      method,
      depth,
      // Deep chains (a.b.c(...)) look like real SDK surface → HIGH.
      // Shallow a.b(...) is more likely an internal helper → MEDIUM.
      confidence: depth >= 2 ? 'HIGH' : 'MEDIUM',
    });
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUNDING CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Partition symbols into grounded / ungrounded against captured doc text.
 *
 * A symbol is GROUNDED if either its full dotted path or its terminal method name
 * appears (case-insensitively) anywhere in the researched snippet text. Matching
 * the method name alone is intentionally lenient — it errs toward NOT flagging,
 * keeping false positives low.
 *
 * @param {Array<{full,root,method,depth,confidence}>} symbols
 * @param {string} snippetsText — concatenated ground-truth snippet text
 * @returns {{ grounded: Array, ungrounded: Array, ratio: number }}
 */
function groundSymbols(symbols, snippetsText) {
  const grounded = [];
  const ungrounded = [];

  if (!symbols || symbols.length === 0) {
    return { grounded, ungrounded, ratio: 1 };
  }

  const hay = (snippetsText || '').toLowerCase();
  // No source text at all → nothing can be grounded. Caller decides whether that
  // is meaningful (it only is when research was expected).
  for (const sym of symbols) {
    const full = sym.full.toLowerCase();
    const method = sym.method.toLowerCase();
    if (hay.length > 0 && (hay.includes(full) || hay.includes(method))) {
      grounded.push(sym);
    } else {
      ungrounded.push(sym);
    }
  }

  const ratio = symbols.length > 0 ? grounded.length / symbols.length : 1;
  return { grounded, ungrounded, ratio };
}

module.exports = {
  extractApiSymbols,
  groundSymbols,
  BUILTIN_METHODS,
  NOISE_ROOTS,
};
