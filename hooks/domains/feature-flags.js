'use strict';

/**
 * feature-flags.js — Feature Flags domain patterns
 *
 * Tier 2 domain: covers flag lifecycle hygiene
 * and security-critical gating behind feature flags.
 */

const domain = 'feature-flags';

const patterns = [
  {
    name: 'Flag without cleanup',
    regex: /(?:featureFlag|feature_flag|isEnabled)\s*\(\s*['"][^'"]+['"]/,
    risk: 'Feature flag checked without documented cleanup plan — stale flags accumulate technical debt. Add expiry or cleanup ticket.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: false,
    justification: ['cleanup', 'expiry', 'deadline', 'temporary'],
  },
  {
    name: 'Flag gating security',
    regex: /(?:featureFlag|isEnabled)\s*\([^)]*(?:auth|security|permission|admin)/,
    risk: 'Security-critical logic gated behind a feature flag — flag misconfiguration could bypass auth or permissions. Ensure intentional rollout.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['intentional', 'rollout', 'gradual', 'canary'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
