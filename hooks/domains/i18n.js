'use strict';

/**
 * i18n.js — Internationalization domain patterns
 *
 * Tier 2 domain: covers string concatenation anti-patterns
 * in translated text and hardcoded date/locale formats.
 */

const domain = 'i18n';

const patterns = [
  {
    name: 'String concatenation for i18n',
    regex: /(?:t|translate|i18n)\s*\([^)]*\)\s*\+\s*(?:t|translate|i18n)/,
    risk: 'Concatenating translated strings — word order varies across languages. Use ICU message format or template interpolation instead.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: false,
    justification: ['template', 'ICU', 'interpolation', 'placeholder'],
  },
  {
    name: 'Hardcoded date format',
    regex: /(?:toLocaleDateString|format)\s*\(\s*['"](?:en-US|MM\/DD|DD\/MM)/,
    risk: 'Hardcoded locale-specific date format — use Intl.DateTimeFormat or locale-aware formatting for international users.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: false,
    justification: ['locale', 'Intl', 'i18n', 'moment'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
