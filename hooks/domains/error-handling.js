'use strict';

/**
 * error-handling.js — Domain patterns for proper error handling
 *
 * Detects empty catch blocks, unhandled promise rejections, stack traces
 * leaked to users, and overly generic error throws.
 */

module.exports = {
  domain: 'error-handling',

  patterns: [
    {
      name: 'Empty catch block',
      regex: /catch\s*\([^)]*\)\s*\{\s*\}/,
      risk: 'Empty catch block silently swallows errors — failures go undetected.',
      confidence: 'HIGH',
      severity: 'STRICT',
      multiline: false,
      justification: ['intentionally empty', 'swallow', 'ignore'],
    },
    {
      name: 'Unhandled promise rejection',
      regex: /\.then\s*\([^)]*\)(?!\s*\.catch|\s*\)\s*\.catch)/,
      risk: 'Promise chain without .catch() — unhandled rejection crashes process.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: false,
      justification: ['.catch', 'try', 'await', 'handleError'],
    },
    {
      name: 'Stack trace exposed to user',
      regex: /res\.(?:send|json|status)\s*\([^)]*(?:err\.stack|error\.stack|\.stack)/,
      risk: 'Stack trace sent in response — leaks internals to attackers.',
      confidence: 'HIGH',
      severity: 'CRITICAL',
      multiline: false,
      justification: ['development', 'debug', 'NODE_ENV'],
    },
    {
      name: 'Generic error throw',
      regex: /throw\s+new\s+Error\s*\(\s*['"][^'"]{0,20}['"]\s*\)/,
      risk: 'Generic Error with short message — use typed errors for proper handling.',
      confidence: 'LOW',
      severity: 'WARN',
      multiline: false,
      justification: ['CustomError', 'AppError', 'HttpError'],
    },
  ],

  extMap: {},
};
