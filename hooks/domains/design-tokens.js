'use strict';

/**
 * design-tokens.js — Design Tokens domain patterns
 *
 * Tier 2 domain: covers hardcoded colors and magic spacing numbers
 * that should use design tokens or theme variables.
 */

const domain = 'design-tokens';

const patterns = [
  {
    name: 'Hardcoded hex color',
    regex: /(?:color|background|border)\s*[:=]\s*['"]?#[0-9a-fA-F]{3,8}\b/,
    risk: 'Hardcoded hex color value — use a design token or theme variable for consistency and dark-mode support.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: false,
    justification: ['token', 'theme', 'var(--', 'colors.', 'tw-'],
  },
  {
    name: 'Magic spacing number',
    regex: /(?:margin|padding|gap)\s*[:=]\s*['"]?\d{2,}px/,
    risk: 'Magic pixel value for spacing — use a spacing token or theme scale for consistent rhythm across the UI.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: false,
    justification: ['token', 'spacing.', 'var(--', 'theme'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
