'use strict';

/**
 * accessibility.js — Domain patterns for web accessibility (WCAG)
 *
 * Detects common accessibility violations: missing labels, color-only
 * information, focus indicator removal, and non-semantic interactive elements.
 */

module.exports = {
  domain: 'accessibility',

  patterns: [
    {
      name: 'Missing form label',
      regex: /<input\s+(?:(?!aria-label|id=)[^>])*\/?>/,
      risk: 'Form input without label or aria-label — screen readers cannot identify the field.',
      confidence: 'MEDIUM',
      severity: 'WARN',
      multiline: false,
      justification: ['aria-label', 'id=', 'label', 'htmlFor'],
    },
    {
      name: 'Color-only information',
      regex: /(?:color|red|green|blue)\s*[:=]\s*['"](?:#|rgb|hsl)/,
      risk: 'Information conveyed by color alone — inaccessible to color-blind users.',
      confidence: 'LOW',
      severity: 'WARN',
      multiline: false,
      justification: ['icon', 'text', 'pattern', 'aria-'],
    },
    {
      name: 'Missing focus indicator',
      regex: /:focus\s*\{\s*outline\s*:\s*(?:none|0)/,
      risk: 'Focus outline removed — keyboard users cannot see focused element.',
      confidence: 'HIGH',
      severity: 'STRICT',
      multiline: false,
      justification: ['focus-visible', 'custom focus', 'ring-'],
    },
    {
      name: 'Button without accessible name',
      regex: /<button\s+(?:(?!aria-label|>[\w])[^>])*>\s*<(?:img|svg|icon)/,
      risk: 'Button has no accessible name — screen readers announce empty button.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: false,
      justification: ['aria-label', 'sr-only', 'visually-hidden', 'title='],
    },
    {
      name: 'Div used as button without role',
      regex: /onClick\s*=\s*\{[^}]+\}[^>]*>(?!.*role=)/,
      risk: 'Non-semantic element used as button without ARIA role — invisible to assistive tech.',
      confidence: 'LOW',
      severity: 'WARN',
      multiline: false,
      justification: ['role="button"', '<button', 'role='],
    },
  ],

  extMap: {},
};
