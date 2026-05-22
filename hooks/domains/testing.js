'use strict';

/**
 * testing.js — Testing domain patterns
 *
 * Tier 2 domain: covers mock misuse in integration tests
 * and tests without assertions.
 */

const domain = 'testing';

const patterns = [
  {
    name: 'Mock external service in integration test',
    regex: /(?:jest\.mock|sinon\.stub|vi\.mock)\s*\(\s*['"](?:axios|fetch|http|node-fetch)/,
    risk: 'Mocking HTTP library in integration test — integration tests should use real (or intercepted) network calls. Use msw, nock, or interceptors instead.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: false,
    justification: ['unit test', 'integration uses real', 'msw', 'nock', 'interceptor'],
  },
  {
    name: 'Test without assertion',
    regex: /(?:it|test)\s*\(\s*['"][^'"]+['"]\s*,\s*(?:async\s*)?\(\)\s*=>\s*\{[^}]*\}\s*\)/,
    risk: 'Test block contains no assertions — test will always pass regardless of behavior. Add expect() or assert() calls.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: false,
    justification: ['expect', 'assert', 'should', 'toBe'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
