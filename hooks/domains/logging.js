'use strict';

/**
 * logging.js — Logging domain patterns
 *
 * Tier 2 domain: covers structured logging hygiene
 * and secret leakage through log statements.
 */

const domain = 'logging';

const patterns = [
  {
    name: 'Unstructured log',
    regex: /console\.log\s*\(\s*['"`][^'"`]*['"`]\s*\)/,
    risk: 'Unstructured console.log with plain string — use a structured logger (winston, pino, bunyan) for queryable, leveled output.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: false,
    justification: ['logger', 'winston', 'pino', 'bunyan', 'structured'],
  },
  {
    name: 'Secret in log',
    regex: /(?:log|logger|console)\.\w+\s*\([^)]*(?:password|secret|token|apiKey|api_key|authorization)/,
    risk: 'Sensitive credential referenced in log output — secrets leak to log aggregators and stdout. Redact or mask before logging.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['redact', 'mask', 'sanitize', '[REDACTED]'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
