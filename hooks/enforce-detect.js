#!/usr/bin/env node
/**
 * enforce-mode — domain detection via weighted signal scoring
 *
 * Extends ECC's project-detect.js pattern with domain-level scoring.
 * Each domain has signals (deps, markers, files, dirs) with weights.
 * Domain activates when cumulative score >= threshold.
 *
 * Performance: single readdirSync + lazy manifest parsing. O(n) on
 * directory entries, never recursive.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Dependency parsers (adapted from ECC's project-detect.js, proven in prod)
// ---------------------------------------------------------------------------

function getPackageJsonDeps(projectDir) {
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return [];
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {})
    ];
  } catch { return []; }
}

function getPythonDeps(projectDir) {
  const deps = [];

  // requirements.txt
  try {
    const reqPath = path.join(projectDir, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      fs.readFileSync(reqPath, 'utf8').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
          const name = trimmed.split(/[>=<![;]/)[0].trim().toLowerCase();
          if (name) deps.push(name);
        }
      });
    }
  } catch { /* ignore */ }

  // pyproject.toml — simple extraction
  try {
    const tomlPath = path.join(projectDir, 'pyproject.toml');
    if (fs.existsSync(tomlPath)) {
      const content = fs.readFileSync(tomlPath, 'utf8');
      const depMatches = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depMatches) {
        depMatches[1].match(/"([^"]+)"/g)?.forEach(m => {
          const name = m.replace(/"/g, '').split(/[>=<![;]/)[0].trim().toLowerCase();
          if (name) deps.push(name);
        });
      }
    }
  } catch { /* ignore */ }

  return deps;
}

function getGoDeps(projectDir) {
  try {
    const modPath = path.join(projectDir, 'go.mod');
    if (!fs.existsSync(modPath)) return [];
    const content = fs.readFileSync(modPath, 'utf8');
    const deps = [];
    const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock) {
      requireBlock[1].split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('//')) {
          const parts = trimmed.split(/\s+/);
          if (parts[0]) deps.push(parts[0]);
        }
      });
    }
    return deps;
  } catch { return []; }
}

function getRustDeps(projectDir) {
  try {
    const cargoPath = path.join(projectDir, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) return [];
    const content = fs.readFileSync(cargoPath, 'utf8');
    const deps = [];
    const sections = content.match(/\[(dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g);
    if (sections) {
      sections.forEach(section => {
        section.split('\n').forEach(line => {
          const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
          if (match && !line.startsWith('[')) deps.push(match[1]);
        });
      });
    }
    return deps;
  } catch { return []; }
}

function getComposerDeps(projectDir) {
  try {
    const composerPath = path.join(projectDir, 'composer.json');
    if (!fs.existsSync(composerPath)) return [];
    const composer = JSON.parse(fs.readFileSync(composerPath, 'utf8'));
    return [
      ...Object.keys(composer.require || {}),
      ...Object.keys(composer['require-dev'] || {})
    ];
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Domain detection rules — weighted signal scoring
// ---------------------------------------------------------------------------

const DOMAIN_RULES = [
  {
    domain: 'ml-inference',
    threshold: 4,
    signals: {
      deps: [
        { name: 'torch', weight: 3 },
        { name: 'pytorch', weight: 3 },
        { name: 'tensorflow', weight: 3 },
        { name: 'transformers', weight: 3 },
        { name: 'diffusers', weight: 2 },
        { name: 'accelerate', weight: 2 },
        { name: 'onnxruntime', weight: 2 },
        { name: 'safetensors', weight: 2 },
        { name: 'huggingface-hub', weight: 1 }
      ],
      files: [
        { ext: '.pt', weight: 2 },
        { ext: '.pth', weight: 2 },
        { ext: '.safetensors', weight: 2 },
        { ext: '.onnx', weight: 2 },
        { ext: '.ckpt', weight: 1 }
      ],
      dirs: [
        { name: 'model', weight: 1 },
        { name: 'models', weight: 1 },
        { name: 'weights', weight: 2 },
        { name: 'checkpoints', weight: 2 }
      ],
      markers: []
    }
  },
  {
    domain: 'gpu-hardware',
    threshold: 4,
    signals: {
      deps: [
        { name: 'torch', weight: 2 },
        { name: 'cupy', weight: 3 },
        { name: 'triton', weight: 3 },
        { name: 'flash-attn', weight: 3 },
        { name: 'pynvml', weight: 2 },
        { name: 'numba', weight: 2 }
      ],
      files: [
        { ext: '.cu', weight: 3 },
        { ext: '.cuh', weight: 2 }
      ],
      dirs: [
        { name: 'cuda', weight: 2 },
        { name: 'kernels', weight: 1 }
      ],
      markers: []
    }
  },
  {
    domain: 'video-pipeline',
    threshold: 4,
    signals: {
      deps: [
        { name: 'ffmpeg-python', weight: 3 },
        { name: 'moviepy', weight: 3 },
        { name: 'opencv-python', weight: 2 },
        { name: 'cv2', weight: 2 },
        { name: 'decord', weight: 3 },
        { name: 'av', weight: 2 },
        { name: 'imageio', weight: 1 },
        { name: 'pillow', weight: 1 }
      ],
      files: [
        { ext: '.mp4', weight: 1 },
        { ext: '.avi', weight: 1 },
        { ext: '.mov', weight: 1 },
        { ext: '.mkv', weight: 1 }
      ],
      dirs: [
        { name: 'video', weight: 1 },
        { name: 'videos', weight: 1 },
        { name: 'renders', weight: 2 },
        { name: 'output', weight: 1 }
      ],
      markers: []
    }
  },
  {
    domain: 'api-security',
    threshold: 3,
    signals: {
      deps: [
        { name: 'fastapi', weight: 2 },
        { name: 'flask', weight: 2 },
        { name: 'express', weight: 2 },
        { name: 'django', weight: 2 },
        { name: '@nestjs/core', weight: 2 },
        { name: 'gin', weight: 2 },
        { name: 'actix-web', weight: 2 },
        { name: 'axum', weight: 2 },
        { name: 'koa', weight: 2 },
        { name: 'hono', weight: 2 }
      ],
      files: [],
      dirs: [
        { name: 'k8s', weight: 2 },
        { name: 'kubernetes', weight: 2 }
      ],
      markers: [
        { name: 'Dockerfile', weight: 2 },
        { name: 'docker-compose.yml', weight: 2 },
        { name: 'docker-compose.yaml', weight: 2 },
        { name: '.env.example', weight: 1 },
        { name: 'nginx.conf', weight: 1 }
      ]
    }
  },
  {
    domain: 'cost-tracking',
    threshold: 3,
    signals: {
      deps: [
        { name: 'boto3', weight: 2 },
        { name: 'google-cloud', weight: 2 },
        { name: '@aws-sdk', weight: 2 },
        { name: 'azure', weight: 2 }
      ],
      files: [
        { ext: '.tf', weight: 2 },
        { ext: '.tfvars', weight: 1 }
      ],
      dirs: [
        { name: 'terraform', weight: 3 },
        { name: '.terraform', weight: 2 },
        { name: 'pulumi', weight: 2 },
        { name: 'infra', weight: 1 },
        { name: 'infrastructure', weight: 1 }
      ],
      markers: [
        { name: 'serverless.yml', weight: 2 },
        { name: 'serverless.yaml', weight: 2 },
        { name: 'cloudbuild.yaml', weight: 2 }
      ]
    }
  }
];

// ---------------------------------------------------------------------------
// Detection engine
// ---------------------------------------------------------------------------

/**
 * Detect active domains in the given project directory.
 *
 * @param {string} [projectDir] - Defaults to process.cwd()
 * @returns {Array<{domain: string, score: number}>} Sorted by score desc
 */
function detectDomains(projectDir) {
  projectDir = projectDir || process.cwd();

  // Single readdirSync — O(n) on directory entries, cached across all rules
  let topLevelEntries;
  try {
    topLevelEntries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const topLevelFiles = new Set();
  const topLevelExts = new Set();
  const topLevelDirs = new Set();

  for (const entry of topLevelEntries) {
    if (entry.isFile()) {
      topLevelFiles.add(entry.name);
      const ext = path.extname(entry.name);
      if (ext) topLevelExts.add(ext);
    } else if (entry.isDirectory()) {
      topLevelDirs.add(entry.name);
    }
  }

  // Lazy-load deps: parse only manifest files that actually exist
  let allDeps = null;
  function getAllDeps() {
    if (allDeps !== null) return allDeps;
    allDeps = [
      ...getPythonDeps(projectDir),
      ...getPackageJsonDeps(projectDir),
      ...getGoDeps(projectDir),
      ...getRustDeps(projectDir),
      ...getComposerDeps(projectDir)
    ].map(d => d.toLowerCase());
    return allDeps;
  }

  const results = [];

  for (const rule of DOMAIN_RULES) {
    let score = 0;

    // Score deps (strongest signal: 2-3 points)
    if (rule.signals.deps.length > 0) {
      const deps = getAllDeps();
      for (const depSignal of rule.signals.deps) {
        if (deps.some(d => d.includes(depSignal.name.toLowerCase()))) {
          score += depSignal.weight;
        }
      }
    }

    // Score marker files (1-2 points)
    for (const marker of rule.signals.markers || []) {
      if (topLevelFiles.has(marker.name) || topLevelDirs.has(marker.name)) {
        score += marker.weight;
      }
    }

    // Score file extensions (1-2 points)
    for (const fileSignal of rule.signals.files || []) {
      if (topLevelExts.has(fileSignal.ext)) {
        score += fileSignal.weight;
      }
    }

    // Score directories (1-2 points)
    for (const dirSignal of rule.signals.dirs || []) {
      if (topLevelDirs.has(dirSignal.name)) {
        score += dirSignal.weight;
      }
    }

    if (score >= rule.threshold) {
      results.push({ domain: rule.domain, score });
    }
  }

  // Most confident first
  results.sort((a, b) => b.score - a.score);
  return results;
}

module.exports = {
  detectDomains,
  DOMAIN_RULES,
  // Exported for testing
  getPackageJsonDeps,
  getPythonDeps,
  getGoDeps,
  getRustDeps,
  getComposerDeps
};
