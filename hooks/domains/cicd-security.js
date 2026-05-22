'use strict';

/**
 * cicd-security.js — Domain patterns for CI/CD pipeline security
 *
 * Detects hardcoded secrets in CI configuration files that should
 * instead use secret management (e.g., GitHub Secrets, Vault).
 */

module.exports = {
  domain: 'cicd-security',

  patterns: [
    {
      name: 'Hardcoded secret in CI config',
      regex: /(?:password|token|secret|api_key)\s*[:=]\s*['"][^$\{'"]{8,}['"]/,
      risk: 'Hardcoded secret in CI config — use secrets manager or environment variables.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: false,
      justification: ['${{', 'secrets.', 'vault', 'env.'],
    },
  ],

  extMap: {
    '.yml': 'cicd-security',
  },
};
