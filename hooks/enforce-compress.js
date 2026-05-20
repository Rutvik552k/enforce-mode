#!/usr/bin/env node
/**
 * enforce-mode — deterministic text compression for rule context
 *
 * Reduces token count in injected rule text without losing enforcement
 * meaning. Pure regex — no LLM calls, <1ms runtime.
 *
 * Preserves: severity tags [WARN]/[STRICT]/[CRITICAL], code blocks,
 * inline backticks, URLs, file paths, all-caps labels
 * Strips: articles, filler words, redundant phrases
 *
 * Design: same approach as caveman-compress but deterministic (no LLM).
 * Applied to domain rule files at runtime. Universal rules are
 * pre-compressed in enforce-rules.js for zero overhead.
 */

'use strict';

/**
 * Verbose phrase → terse equivalent.
 * Order matters — longer phrases first to avoid partial matches.
 */
const PHRASE_MAP = [
  [/\bimmediately continue with productive parallel work\b/gi, 'continue parallel work'],
  [/\bwithout explicit user confirmation\b/gi, 'without user confirmation'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat the present time\b/gi, 'now'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bin the event that\b/gi, 'if'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\bin addition to\b/gi, '+'],
  [/\bin order to\b/gi, 'to'],
  [/\bmake sure to\b/gi, 'ensure'],
  [/\bwith respect to\b/gi, 're'],
  [/\bwith regard to\b/gi, 're'],
  [/\bwhether or not\b/gi, 'whether'],
  [/\bremember to\b/gi, ''],
  [/\byou should\b/gi, ''],
  [/\bas well as\b/gi, '+'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bon a per-/gi, 'per '],
];

/** Articles — stripped except before all-caps words (acronyms/labels). */
const ARTICLE_RE = /\b(?:a|an|the)\s+/gi;

/** Filler words — stripped unconditionally outside code. */
const FILLER_RE = /\b(?:just|really|basically|actually|simply|essentially|generally|currently|however|furthermore|additionally|moreover)\b\s*/gi;

/**
 * Compress rule text while preserving code blocks and technical terms.
 *
 * Splits text into code segments (fenced blocks, inline backticks) and
 * prose segments. Only prose is compressed. Code passes through unchanged.
 *
 * @param {string} text - Raw rule text
 * @returns {string} Compressed text (~25-35% shorter)
 */
function compressRules(text) {
  // Split into code (preserved) and prose (compressed) segments.
  // Odd indices = code (fenced blocks or inline backticks).
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);

  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 1) continue; // code — skip

    let s = segments[i];

    // Phrase replacements (longest first)
    for (const [pattern, replacement] of PHRASE_MAP) {
      s = s.replace(pattern, replacement);
    }

    // Strip articles, but preserve before all-caps (severity labels, acronyms)
    s = s.replace(ARTICLE_RE, (match, offset, str) => {
      const after = str.slice(offset + match.length);
      return /^[A-Z]{2,}/.test(after) ? match : '';
    });

    // Strip filler
    s = s.replace(FILLER_RE, '');

    // Collapse double spaces
    s = s.replace(/ {2,}/g, ' ');

    segments[i] = s;
  }

  return segments.join('');
}

module.exports = { compressRules };
