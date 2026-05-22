'use strict';

/**
 * supply-chain.js — Domain patterns for software supply chain security
 *
 * Detects unpinned GitHub Actions, unpinned Docker base images, and
 * other supply chain attack vectors in CI/CD configuration files.
 */

module.exports = {
  domain: 'supply-chain',

  patterns: [
    {
      name: 'Unpinned GitHub Action',
      regex: /uses:\s*[\w-]+\/[\w-]+@(?:main|master|latest)/,
      risk: 'GitHub Action pinned to mutable ref — supply chain attack vector.',
      confidence: 'HIGH',
      severity: 'STRICT',
      multiline: false,
      justification: ['pinned', 'sha', '@v'],
    },
    {
      name: 'Unpinned Docker base image',
      regex: /FROM\s+\w+(?::latest|\s+AS)/,
      risk: 'Docker base image not pinned to specific version — builds are non-reproducible.',
      confidence: 'MEDIUM',
      severity: 'WARN',
      multiline: false,
      justification: ['pinned', 'sha256', 'specific version'],
    },
  ],

  extMap: {
    '.yml': 'supply-chain',
    '.yaml': 'supply-chain',
  },
};
