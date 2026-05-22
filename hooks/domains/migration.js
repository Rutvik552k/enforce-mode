'use strict';

/**
 * migration.js — Database Migration domain patterns
 *
 * Tier 2 domain: covers migration rollback safety
 * and destructive DDL operations without backup plans.
 */

const domain = 'migration';

const patterns = [
  {
    name: 'Migration without rollback',
    regex: /(?:exports\.up|migrate|createTable|addColumn)[\s\S]*(?!(?:exports\.down|rollback|dropTable|removeColumn))/,
    risk: 'Migration defines an up/forward step without a corresponding rollback — failed deploys cannot be reversed safely.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['down', 'rollback', 'revert', 'reversible'],
  },
  {
    name: 'Drop without backup',
    regex: /(?:DROP\s+TABLE|DROP\s+COLUMN|DROP\s+INDEX)\s/i,
    risk: 'Destructive DROP statement — data loss is irreversible without a backup or migration plan. Ensure backup exists before deploying.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['backup', 'migration plan', 'IF EXISTS', 'reversible'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
