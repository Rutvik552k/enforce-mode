'use strict';

/**
 * iac-security.js — Infrastructure as Code Security domain patterns
 *
 * Tier 2 domain: covers IAM privilege escalation, open network ingress,
 * public storage buckets, and missing encryption in IaC configurations.
 */

const domain = 'iac-security';

const patterns = [
  {
    name: 'Wildcard IAM',
    regex: /(?:actions?|Action)\s*[:=]\s*['"\[]*\s*['"]?\*['"]?/,
    risk: 'Wildcard IAM action grants unrestricted permissions — violates least-privilege principle. Scope to specific actions.',
    confidence: 'HIGH',
    severity: 'STRICT',
    multiline: false,
    justification: ['least privilege', 'scoped', 'specific actions'],
  },
  {
    name: 'Open ingress',
    regex: /(?:ingress|cidr_blocks?|source_ranges?)\s*[:=]\s*.*0\.0\.0\.0\/0/,
    risk: 'Ingress rule open to 0.0.0.0/0 — the entire internet can reach this resource. Restrict to VPN, bastion, or CDN ranges.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['VPN', 'bastion', 'load balancer', 'CDN', 'WAF'],
  },
  {
    name: 'Public storage',
    regex: /(?:acl|public_access|block_public)\s*[:=]\s*['"]?(?:public|false)/,
    risk: 'Storage bucket or blob configured as public — data exposure risk. Ensure this is intentional (e.g., static website hosting).',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['static website', 'CDN', 'intentional', 'public assets'],
  },
  {
    name: 'Missing encryption',
    regex: /(?:encrypted|kms_key|server_side_encryption)\s*[:=]\s*['"]?false/,
    risk: 'Encryption explicitly disabled — data at rest is unprotected. Enable encryption unless this is a non-sensitive test resource.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['test', 'development'],
  },
];

const extMap = { '.tf': 'iac-security' };

module.exports = { domain, patterns, extMap };
