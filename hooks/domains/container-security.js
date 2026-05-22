'use strict';

/**
 * container-security.js — Domain patterns for container and Kubernetes security
 *
 * Detects containers running as root, unpinned base images, privileged mode,
 * and missing resource limits in pod/deployment specs.
 */

module.exports = {
  domain: 'container-security',

  patterns: [
    {
      name: 'Container running as root',
      regex: /^(?!.*USER\s+\w).*FROM\s+\w+/m,
      risk: 'Dockerfile without USER directive — container runs as root by default.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: true,
      justification: ['USER', 'non-root', 'nobody', '1000'],
    },
    {
      name: 'Latest tag in Docker FROM',
      regex: /FROM\s+\w+(?::latest\b|\s+AS\b)/,
      risk: 'Docker base image uses :latest or unversioned tag — non-reproducible builds.',
      confidence: 'MEDIUM',
      severity: 'WARN',
      multiline: false,
      justification: ['pinned', 'sha256', 'specific version'],
    },
    {
      name: 'Privileged container',
      regex: /privileged\s*:\s*true/,
      risk: 'Container running in privileged mode — full host kernel access.',
      confidence: 'HIGH',
      severity: 'CRITICAL',
      multiline: false,
      justification: ['required', 'security review', 'documented'],
    },
    {
      name: 'Missing resource limits',
      regex: /kind:\s*(?:Pod|Deployment|StatefulSet)[\s\S]*?containers:[\s\S]*?(?!resources:)image:/,
      risk: 'Container spec without resource limits — risk of resource exhaustion.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: true,
      justification: ['resources:', 'limits:', 'requests:'],
    },
  ],

  extMap: {
    'Dockerfile': 'container-security',
  },
};
