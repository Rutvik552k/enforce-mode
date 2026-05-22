'use strict';

/**
 * background-jobs.js — Background Jobs/Queues domain patterns
 *
 * Tier 0 domain: covers job idempotency, retry strategies,
 * and timeout enforcement for async job processing.
 */

const domain = 'background-jobs';

const patterns = [
  {
    name: 'Non-idempotent job handler',
    regex: /(?:process|handle|worker)\s*\([^)]*(?:job|task|message)\s*\)[\s\S]{0,300}(?:INSERT|create|\.save\()(?![\s\S]{0,100}(?:upsert|ON CONFLICT|idempotent))/,
    risk: 'Job handler performs non-idempotent writes — retries cause duplicates. Use upsert or dedup key.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['upsert', 'ON CONFLICT', 'idempotent', 'dedup', 'findOrCreate', 'IF NOT EXISTS'],
  },
  {
    name: 'Missing retry backoff',
    regex: /(?:retry|attempts|maxRetries)\s*[:=]\s*\d+(?![\s\S]{0,100}(?:backoff|exponential|delay))/,
    risk: 'Retry without backoff — thundering herd on transient failures. Add exponential backoff.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['backoff', 'exponential', 'delay', 'jitter', 'backoffDelay', 'retryDelay'],
  },
  {
    name: 'Job without timeout',
    regex: /(?:queue|worker|bull|agenda)\.\w+\s*\([^)]*\)(?![\s\S]{0,100}(?:timeout|ttl|jobTimeout))/,
    risk: 'Job without timeout — stuck jobs block workers indefinitely. Set a timeout or TTL.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: true,
    justification: ['timeout', 'ttl', 'jobTimeout', 'lockDuration', 'stalledInterval', 'deadline'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
