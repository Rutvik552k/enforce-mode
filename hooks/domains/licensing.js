'use strict';

/**
 * licensing.js — Domain patterns for software license compliance
 *
 * Detects copyleft (GPL/AGPL/LGPL) dependencies that may impose
 * licensing obligations on the consuming project.
 */

module.exports = {
  domain: 'licensing',

  patterns: [
    {
      name: 'GPL dependency detected',
      regex: /['"](?:license|License)['"]:\s*['"](?:GPL|AGPL|LGPL)/,
      risk: 'Copyleft dependency — may require source disclosure of consuming project.',
      confidence: 'HIGH',
      severity: 'STRICT',
      multiline: false,
      justification: ['compatible', 'reviewed', 'approved', 'exception'],
    },
  ],

  extMap: {},
};
