'use strict';

/**
 * resilience.js — Domain patterns for service resilience
 *
 * Detects external calls without timeouts, immediate retries without
 * backoff, and missing circuit breaker patterns for external services.
 */

module.exports = {
  domain: 'resilience',

  patterns: [
    {
      name: 'External call without timeout',
      regex: /(?:fetch|axios|got|request)\s*\([^)]*\)(?![\s\S]{0,100}(?:timeout|signal|AbortController|deadline))/,
      risk: 'External HTTP call without timeout — can hang indefinitely under failure.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: true,
      justification: ['timeout', 'signal', 'AbortController', 'deadline', 'ms'],
    },
    {
      name: 'Immediate retry without backoff',
      regex: /(?:retry|retries)\s*[:=][\s\S]{0,50}(?:setTimeout\s*\(\s*\w+\s*,\s*0|while\s*\(true)/,
      risk: 'Retry without backoff — amplifies failures and causes thundering herd.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: true,
      justification: ['backoff', 'exponential', 'jitter', 'delay'],
    },
    {
      name: 'Missing circuit breaker',
      regex: /(?:fetch|axios|http|request)\.\w+\s*\([^)]*(?:external|api|service)/,
      risk: 'External service call without circuit breaker — cascading failure risk.',
      confidence: 'LOW',
      severity: 'WARN',
      multiline: false,
      justification: ['circuitBreaker', 'circuit', 'breaker', 'hystrix', 'opossum'],
    },
  ],

  extMap: {},
};
