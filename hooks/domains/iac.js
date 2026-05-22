'use strict';

/**
 * iac.js — Infrastructure as Code domain patterns
 *
 * Tier 2 domain: covers hardcoded AMI IDs, committed state files,
 * and missing resource tags in Terraform configurations.
 */

const domain = 'iac';

const patterns = [
  {
    name: 'Hardcoded AMI',
    regex: /ami-[0-9a-f]{8,17}/,
    risk: 'Hardcoded AMI ID — AMIs are region-specific and become outdated. Use a variable or data source lookup.',
    confidence: 'MEDIUM',
    severity: 'STRICT',
    multiline: false,
    justification: ['variable', 'data source', 'var.', 'local.'],
  },
  {
    name: 'State file committed',
    regex: /\.tfstate/,
    risk: 'Terraform state file reference detected — state files contain secrets and must never be committed. Use a remote backend.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['remote backend', 'gitignore', '.gitignore'],
  },
  {
    name: 'Missing tags',
    regex: /resource\s+['"]aws_\w+['"][\s\S]{0,500}(?!tags\s*[={])/,
    risk: 'AWS resource without tags — tags are required for cost allocation, ownership tracking, and compliance.',
    confidence: 'LOW',
    severity: 'WARN',
    multiline: true,
    justification: ['tags', 'default_tags', 'provider'],
  },
];

const extMap = { '.tf': 'iac', '.tfvars': 'iac' };

module.exports = { domain, patterns, extMap };
