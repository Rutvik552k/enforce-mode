'use strict';

/**
 * database.js — Database/Data Engineering domain patterns
 *
 * Tier 0 domain: covers SQL injection, query safety,
 * parameterization, and N+1 query detection.
 */

const domain = 'database';

const patterns = [
  {
    name: 'SQL string concatenation',
    regex: /(?:query|execute)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE)[^'"]*['"]\s*\+/,
    risk: 'SQL injection via string concatenation — use parameterized queries.',
    confidence: 'HIGH',
    severity: 'STRICT',
    multiline: false,
    justification: ['$1', '?', ':param', 'parameterized', 'prepared', 'bind', 'placeholder'],
  },
  {
    name: 'SQL template literal injection',
    regex: /(?:query|execute)\s*\(\s*`(?:SELECT|INSERT|UPDATE|DELETE)[^`]*\$\{/,
    risk: 'SQL injection via template literal interpolation — use parameterized queries.',
    confidence: 'HIGH',
    severity: 'STRICT',
    multiline: false,
    justification: ['$1', '?', ':param', 'parameterized', 'prepared', 'sql.raw', 'tagged template'],
  },
  {
    name: 'SELECT star in production',
    regex: /(?:query|execute|sql)\s*\(\s*['"`]SELECT\s+\*\s+FROM/i,
    risk: 'SELECT * fetches unnecessary columns — specify needed columns for performance.',
    confidence: 'MEDIUM',
    severity: 'WARN',
    multiline: false,
    justification: ['migration', 'schema', 'introspect', 'dump', 'backup', 'COUNT(*)'],
  },
  {
    name: 'Missing parameterized query',
    regex: /(?:query|execute)\s*\(\s*['"](?:SELECT|INSERT|UPDATE|DELETE).*(?:'\s*\+\s*\w|"\s*\+\s*\w|`.*\$\{)/,
    risk: 'Dynamic SQL without parameterization — SQL injection risk.',
    confidence: 'HIGH',
    severity: 'STRICT',
    multiline: false,
    justification: ['$1', '?', ':param', 'parameterized', 'prepared'],
  },
  {
    name: 'N+1 query in loop',
    regex: /for\s*[\s\S]{0,50}(?:await\s+)?(?:db|prisma|knex|sequelize|query)\.\w+\s*\(/,
    risk: 'Database query inside loop — N+1 problem causes O(n) round trips. Use batch/join.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['batch', 'bulk', 'join', 'include', 'eager', 'findMany', 'IN (', 'preload'],
  },
];

const extMap = {
  '.sql': 'database',
};

module.exports = { domain, patterns, extMap };
