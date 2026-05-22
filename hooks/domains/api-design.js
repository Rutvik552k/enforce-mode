'use strict';

/**
 * api-design.js — API Design domain patterns
 *
 * Tier 2 domain: covers missing pagination on list endpoints
 * that return unbounded result sets.
 */

const domain = 'api-design';

const patterns = [
  {
    name: 'Missing pagination',
    regex: /\.(?:get|list|find|findAll|getAll)\s*\([^)]*\)[\s\S]{0,200}(?:res\.json|return)[\s\S]{0,100}(?!.*(?:page|limit|cursor|offset|pagination))/,
    risk: 'List endpoint returns results without pagination — unbounded queries degrade performance and can OOM. Add cursor or offset-based pagination.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: true,
    justification: ['paginate', 'cursor', 'limit', 'offset', 'page'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
