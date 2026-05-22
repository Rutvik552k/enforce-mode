'use strict';

/**
 * observability.js — Observability/Monitoring domain patterns
 *
 * Tier 0 domain: covers logging hygiene, correlation tracing,
 * and PII leakage through log statements.
 */

const domain = 'observability';

const patterns = [
  {
    name: 'console.log in production',
    regex: /console\.(log|info|warn|error)\s*\(/,
    risk: 'Console output in production code — use a structured logger (winston, pino, bunyan).',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: false,
    justification: ['debug', 'development', 'logger', 'winston', 'pino', 'bunyan', 'log4js', 'NODE_ENV'],
  },
  {
    name: 'Missing correlation ID in log',
    regex: /(?:logger|log)\.\w+\s*\([^)]*\)(?![\s\S]{0,100}(?:correlationId|traceId|requestId|trace_id))/,
    risk: 'Log statement without correlation ID — cannot trace requests across services.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: true,
    justification: ['correlationId', 'traceId', 'requestId', 'trace_id', 'request_id', 'span', 'opentelemetry'],
  },
  {
    name: 'PII in log statement',
    regex: /(?:logger|log|console)\.\w+\s*\([^)]*(?:password|ssn|creditCard|email.*@)/,
    risk: 'PII data in log output — violates data protection regulations (GDPR, CCPA, HIPAA).',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['redact', 'mask', 'sanitize', 'scrub', '[REDACTED]', '***'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
