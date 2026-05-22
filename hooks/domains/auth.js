'use strict';

/**
 * auth.js — Authentication/Authorization domain patterns
 *
 * Tier 0 domain: covers credential storage, session security,
 * JWT lifecycle, CSRF protection, OAuth flows, and permission models.
 */

const domain = 'auth';

const patterns = [
  {
    name: 'Plaintext password storage',
    regex: /(?:password|passwd)\s*=\s*['"][^'"]{4,}['"]/,
    risk: 'Hardcoded plaintext password — credential leak via source control. Use env vars or vault.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['process.env', 'vault', 'secret', 'hashed', 'bcrypt', 'argon2', 'placeholder', 'example'],
  },
  {
    name: 'JWT without expiry',
    regex: /jwt\.sign\s*\([^)]*\)(?![\s\S]{0,100}expiresIn)/,
    risk: 'JWT issued without expiration — tokens valid indefinitely if leaked.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['expiresIn', 'exp', 'maxAge', 'ttl', 'expires_in'],
  },
  {
    name: 'Missing CSRF on state mutation',
    regex: /app\.(?:post|put|patch|delete)\s*\([^)]*(?:req|request)/,
    risk: 'State-mutating endpoint without CSRF protection — cross-site request forgery risk.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: false,
    justification: ['csrf', 'csurf', 'csrfToken', 'xsrf', '_csrf', 'SameSite', 'double submit'],
  },
  {
    name: 'Wildcard permissions',
    regex: /permissions?\s*[:=]\s*['"\[]*\*['"\]]/,
    risk: 'Wildcard permission grants unrestricted access — violates principle of least privilege.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['admin', 'superuser', 'root', 'development', 'test', 'scoped', 'restricted'],
  },
  {
    name: 'Session without httpOnly',
    regex: /cookie\s*[:=]\s*\{[^}]*(?!httpOnly)[^}]*\}/,
    risk: 'Session cookie without httpOnly flag — accessible to XSS attacks via document.cookie.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['httpOnly', 'http_only', 'HttpOnly', 'secure', 'cookieOptions'],
  },
  {
    name: 'OAuth without PKCE',
    regex: /authorize\s*\([^)]*\)(?![\s\S]{0,100}code_challenge)/,
    risk: 'OAuth authorization without PKCE — vulnerable to authorization code interception.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: true,
    justification: ['code_challenge', 'code_verifier', 'PKCE', 'S256', 'pkce'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
