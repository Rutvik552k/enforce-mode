'use strict';

/**
 * multi-tenancy.js — Domain patterns for multi-tenant data isolation
 *
 * Detects queries missing tenant filters and tenant IDs sourced from
 * untrusted user input instead of authenticated session context.
 */

module.exports = {
  domain: 'multi-tenancy',

  patterns: [
    {
      name: 'Query without tenant filter',
      regex: /\.(?:find|findMany|select|where)\s*\([^)]*\)(?![\s\S]{0,100}(?:tenant|org_id|organization|company_id))/,
      risk: 'Database query without tenant scoping — data leak across tenants.',
      confidence: 'HIGH',
      severity: 'CRITICAL',
      multiline: true,
      justification: ['tenantId', 'tenant_id', 'orgId', 'org_id', 'scope', 'RLS'],
    },
    {
      name: 'Tenant ID from user input',
      regex: /(?:req\.(?:body|query|params)|request\.(?:body|query))\.(?:tenant|org)/,
      risk: 'Tenant ID taken from user input — allows tenant impersonation.',
      confidence: 'HIGH',
      severity: 'CRITICAL',
      multiline: false,
      justification: ['auth', 'token', 'session', 'middleware'],
    },
  ],

  extMap: {},
};
