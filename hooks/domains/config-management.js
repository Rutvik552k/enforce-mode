'use strict';

/**
 * config-management.js — Configuration Management domain patterns
 *
 * Tier 2 domain: covers hardcoded configuration values
 * that should be externalized to environment variables or config files.
 */

const domain = 'config-management';

const patterns = [
  {
    name: 'Hardcoded config value',
    regex: /(?:host|port|url|endpoint)\s*[:=]\s*['"](?:localhost|127\.0\.0\.1|0\.0\.0\.0)/,
    risk: 'Hardcoded host/port/URL pointing to localhost or loopback — externalize to environment variables or config files for portability.',
    confidence: 'MEDIUM',
    severity: 'WARN',
    multiline: false,
    justification: ['process.env', 'config.', 'env.', 'development'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
