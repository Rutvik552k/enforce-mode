'use strict';

/**
 * privacy.js — Privacy/PII domain patterns
 *
 * Tier 0 domain: covers PII leakage in logs, consent requirements
 * for data collection, and encryption markers for sensitive fields.
 */

const domain = 'privacy';

const patterns = [
  {
    name: 'PII in log',
    regex: /(?:log|console|logger)\.\w+\s*\([^)]*(?:email|phone|ssn|social_security|date_of_birth|address|passport)/,
    risk: 'PII logged without redaction — GDPR/CCPA violation. Mask or omit sensitive fields.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['redact', 'mask', 'sanitize', 'scrub', '[REDACTED]', '***', 'anonymize'],
  },
  {
    name: 'Data collection without consent',
    regex: /(?:collect|track|store)\s*\([^)]*(?:email|name|phone|location)(?![\s\S]{0,100}consent)/,
    risk: 'Collecting personal data without consent check — privacy regulation violation.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['consent', 'gdpr', 'opt-in', 'permission', 'agreed', 'terms', 'privacy policy'],
  },
  {
    name: 'Missing data encryption marker',
    regex: /(?:column|field|attribute)\s*\([^)]*(?:ssn|social|tax_id|credit_card)(?![\s\S]{0,100}encrypt)/,
    risk: 'Sensitive field stored without encryption marker — data-at-rest exposure risk.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['encrypt', 'encrypted', 'cipher', 'kms', 'vault', 'aes', 'pgp'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
