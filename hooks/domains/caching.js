'use strict';

/**
 * caching.js — Caching domain patterns
 *
 * Tier 2 domain: covers PII leakage into cache stores
 * and missing TTL on cache entries.
 */

const domain = 'caching';

const patterns = [
  {
    name: 'PII in cache',
    regex: /(?:cache|redis|memcached)\.\w+\s*\([^)]*(?:password|ssn|email|phone|token)/,
    risk: 'PII or sensitive data stored in cache — cache stores often lack encryption and access controls. Encrypt, hash, or tokenize before caching.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['encrypted', 'hashed', 'tokenized'],
  },
  {
    name: 'Missing TTL',
    regex: /(?:cache|redis)\.set\s*\([^)]*\)(?![\s\S]{0,50}(?:ttl|expire|EX|PX|maxAge))/,
    risk: 'Cache entry set without TTL — stale data persists indefinitely and memory grows unbounded. Always set an expiration.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: false,
    justification: ['ttl', 'expire', 'EX', 'maxAge', 'TTL'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
