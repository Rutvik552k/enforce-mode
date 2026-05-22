'use strict';

/**
 * payment.js — Payment Processing domain patterns
 *
 * Tier 0 domain: covers currency precision, PCI compliance,
 * idempotency, and webhook verification for payment flows.
 */

const domain = 'payment';

const patterns = [
  {
    name: 'Float currency',
    regex: /(?:price|amount|cost|total)\s*[:=]\s*\d+\.\d+(?!\s*[*\/])/,
    risk: 'Floating-point currency causes rounding errors — use integer cents or Decimal type.',
    confidence: 'HIGH',
    severity: 'STRICT',
    multiline: false,
    justification: ['cents', 'integer', 'BigDecimal', 'Decimal', 'Math.round', 'dinero', 'currency.js'],
  },
  {
    name: 'Card number in log',
    regex: /(?:log|console|logger)\.\w+\s*\([^)]*(?:card_?number|pan|credit_card|card_num)/,
    risk: 'Card number logged — PCI DSS violation. Never log cardholder data.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['mask', 'redact', 'last4', 'truncated', '[REDACTED]', 'tokenized'],
  },
  {
    name: 'Missing idempotency key',
    regex: /(?:charge|payment|transfer)\s*\([^)]*\)(?![\s\S]{0,100}idempotency)/,
    risk: 'Payment operation without idempotency key — duplicate charges on retry.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['idempotencyKey', 'idempotency_key', 'Idempotency-Key', 'idempotent'],
  },
  {
    name: 'Missing webhook signature verification',
    regex: /(?:webhook|stripe.*event|paymentIntent)[\s\S]{0,200}(?:req\.body|request\.body)(?![\s\S]{0,100}(?:verify|constructEvent|signature))/,
    risk: 'Webhook handler uses raw body without signature verification — spoofing risk.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: true,
    justification: ['verify', 'constructEvent', 'signature', 'webhook_secret', 'signing_secret'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
