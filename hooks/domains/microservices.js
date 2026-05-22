'use strict';

/**
 * microservices.js — Microservices domain patterns
 *
 * Tier 2 domain: covers distributed transaction safety
 * and synchronous service chain anti-patterns.
 */

const domain = 'microservices';

const patterns = [
  {
    name: 'Distributed transaction without saga',
    regex: /(?:begin|startTransaction|BEGIN)\s*[\s\S]{0,300}(?:fetch|axios|http|request)\.\w+\s*\(/,
    risk: 'Database transaction spans a remote HTTP call — distributed transactions without saga/outbox pattern risk partial failures and data inconsistency.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['saga', 'choreography', 'outbox', 'event-driven'],
  },
  {
    name: 'Sync chain call',
    regex: /await\s+\w+\.(?:get|post|fetch)\s*\([^)]*\)[\s\S]{0,100}await\s+\w+\.(?:get|post|fetch)\s*\(/,
    risk: 'Sequential awaited HTTP calls create a synchronous chain — latency compounds and failures cascade. Use Promise.all or event-driven patterns.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: true,
    justification: ['Promise.all', 'parallel', 'concurrent', 'event-driven'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
