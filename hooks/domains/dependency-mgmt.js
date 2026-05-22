'use strict';

/**
 * dependency-mgmt.js — Dependency Management domain patterns
 *
 * Tier 2 domain: covers unpinned dependency versions
 * that can cause non-reproducible builds.
 */

const domain = 'dependency-mgmt';

const patterns = [
  {
    name: 'Unpinned dependency',
    regex: /['"][^'"]+['"]\s*:\s*['"][\^~>]/,
    risk: 'Dependency version uses range specifier (^, ~, >) — builds are non-reproducible. Pin exact versions and rely on lockfile.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: false,
    justification: ['pinned', 'exact', 'lockfile'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
