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
function detectDomains(projectDir, useAllRules = true) {
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

  // Use all rules (v1 + v2 + v3) by default, legacy mode uses v1 only
  const ruleset = useAllRules ? ALL_DOMAIN_RULES : DOMAIN_RULES;

  for (const rule of ruleset) {
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

// ---------------------------------------------------------------------------
// PECK v2: New domain detection rules (blockchain, frontend, mobile,
// research-paper, model-training, book-generation)
// ---------------------------------------------------------------------------

const DOMAIN_RULES_V2 = [
  {
    domain: 'blockchain',
    threshold: 3,
    signals: {
      deps: [
        { name: 'hardhat', weight: 3 },
        { name: 'truffle', weight: 3 },
        { name: 'ethers', weight: 2 },
        { name: 'web3', weight: 2 },
        { name: 'web3.py', weight: 2 },
        { name: '@openzeppelin', weight: 3 },
        { name: 'brownie', weight: 2 },
        { name: 'foundry', weight: 3 },
        { name: 'viem', weight: 2 },
        { name: 'wagmi', weight: 2 },
        { name: 'solmate', weight: 2 },
        { name: 'anchor', weight: 2 },
        { name: '@solana/web3.js', weight: 2 },
      ],
      files: [
        { ext: '.sol', weight: 3 },
        { ext: '.vy', weight: 2 },
      ],
      dirs: [
        { name: 'contracts', weight: 2 },
        { name: 'hardhat', weight: 2 },
        { name: 'foundry', weight: 2 },
        { name: 'scripts', weight: 1 },
      ],
      markers: [
        { name: 'hardhat.config.js', weight: 2 },
        { name: 'hardhat.config.ts', weight: 2 },
        { name: 'truffle-config.js', weight: 2 },
        { name: 'foundry.toml', weight: 3 },
        { name: 'remappings.txt', weight: 2 },
        { name: 'Anchor.toml', weight: 2 },
      ]
    }
  },
  {
    domain: 'frontend',
    threshold: 2,
    signals: {
      deps: [
        { name: 'react', weight: 2 },
        { name: 'react-dom', weight: 2 },
        { name: 'next', weight: 3 },
        { name: '@next/', weight: 2 },
        { name: 'vue', weight: 2 },
        { name: 'nuxt', weight: 2 },
        { name: 'svelte', weight: 2 },
        { name: '@angular/core', weight: 2 },
        { name: 'solid-js', weight: 2 },
        { name: 'tailwindcss', weight: 1 },
        { name: '@radix-ui', weight: 1 },
        { name: '@shadcn', weight: 1 },
      ],
      files: [
        { ext: '.tsx', weight: 2 },
        { ext: '.jsx', weight: 2 },
        { ext: '.vue', weight: 2 },
        { ext: '.svelte', weight: 2 },
      ],
      dirs: [
        { name: 'pages', weight: 1 },
        { name: 'app', weight: 1 },
        { name: 'components', weight: 2 },
        { name: 'src', weight: 1 },
      ],
      markers: [
        { name: 'next.config.js', weight: 2 },
        { name: 'next.config.ts', weight: 2 },
        { name: 'next.config.mjs', weight: 2 },
        { name: 'vite.config.ts', weight: 2 },
        { name: 'tailwind.config.js', weight: 1 },
        { name: 'tailwind.config.ts', weight: 1 },
        { name: 'postcss.config.js', weight: 1 },
      ]
    }
  },
  {
    domain: 'mobile',
    threshold: 3,
    signals: {
      deps: [
        { name: 'react-native', weight: 3 },
        { name: 'expo', weight: 3 },
        { name: '@react-navigation', weight: 2 },
        { name: 'flutter', weight: 3 },
        { name: 'kotlin', weight: 2 },
        { name: 'swift', weight: 2 },
        { name: '@capacitor', weight: 2 },
        { name: 'ionic', weight: 2 },
      ],
      files: [
        { ext: '.swift', weight: 2 },
        { ext: '.kt', weight: 2 },
        { ext: '.dart', weight: 2 },
        { ext: '.xcodeproj', weight: 3 },
      ],
      dirs: [
        { name: 'android', weight: 2 },
        { name: 'ios', weight: 2 },
        { name: 'native', weight: 1 },
        { name: 'platforms', weight: 1 },
      ],
      markers: [
        { name: 'app.json', weight: 1 },
        { name: 'expo.json', weight: 2 },
        { name: 'pubspec.yaml', weight: 3 },
        { name: 'Podfile', weight: 2 },
        { name: 'build.gradle', weight: 2 },
        { name: 'AndroidManifest.xml', weight: 2 },
        { name: 'Info.plist', weight: 2 },
      ]
    }
  },
  {
    domain: 'research-paper',
    threshold: 2,
    signals: {
      deps: [
        { name: 'scipy', weight: 1 },
        { name: 'statsmodels', weight: 2 },
        { name: 'matplotlib', weight: 1 },
        { name: 'seaborn', weight: 1 },
        { name: 'pandas', weight: 1 },
        { name: 'sklearn', weight: 1 },
        { name: 'scikit-learn', weight: 1 },
      ],
      files: [
        { ext: '.tex', weight: 3 },
        { ext: '.bib', weight: 3 },
        { ext: '.sty', weight: 2 },
        { ext: '.cls', weight: 2 },
        { ext: '.ipynb', weight: 1 },
      ],
      dirs: [
        { name: 'figures', weight: 1 },
        { name: 'tables', weight: 1 },
        { name: 'experiments', weight: 2 },
        { name: 'results', weight: 1 },
        { name: 'paper', weight: 2 },
      ],
      markers: [
        { name: 'references.bib', weight: 3 },
        { name: 'bibliography.bib', weight: 3 },
        { name: 'main.tex', weight: 3 },
        { name: 'paper.tex', weight: 3 },
        { name: 'Makefile', weight: 1 },
      ]
    }
  },
  {
    domain: 'model-training',
    threshold: 4,
    signals: {
      deps: [
        { name: 'torch', weight: 2 },
        { name: 'transformers', weight: 2 },
        { name: 'datasets', weight: 2 },
        { name: 'wandb', weight: 3 },
        { name: 'mlflow', weight: 3 },
        { name: 'optuna', weight: 2 },
        { name: 'ray', weight: 2 },
        { name: 'lightning', weight: 3 },
        { name: 'pytorch-lightning', weight: 3 },
        { name: 'trl', weight: 3 },
        { name: 'peft', weight: 3 },
        { name: 'bitsandbytes', weight: 2 },
        { name: 'deepspeed', weight: 3 },
        { name: 'fairscale', weight: 2 },
      ],
      files: [
        { ext: '.yaml', weight: 1 },
        { ext: '.ipynb', weight: 1 },
      ],
      dirs: [
        { name: 'experiments', weight: 2 },
        { name: 'configs', weight: 1 },
        { name: 'data', weight: 1 },
        { name: 'outputs', weight: 1 },
        { name: 'logs', weight: 1 },
        { name: 'checkpoints', weight: 2 },
        { name: 'runs', weight: 2 },
      ],
      markers: [
        { name: 'train.py', weight: 2 },
        { name: 'trainer.py', weight: 2 },
        { name: 'config.yaml', weight: 1 },
        { name: 'sweep.yaml', weight: 2 },
        { name: 'ds_config.json', weight: 3 },
      ]
    }
  },
  {
    domain: 'book-generation',
    threshold: 2,
    signals: {
      deps: [
        { name: 'mdbook', weight: 3 },
        { name: 'sphinx', weight: 2 },
        { name: 'jupyter-book', weight: 3 },
        { name: 'honkit', weight: 2 },
        { name: 'gitbook', weight: 2 },
        { name: 'docusaurus', weight: 2 },
      ],
      files: [
        { ext: '.tex', weight: 1 },
        { ext: '.rst', weight: 2 },
        { ext: '.adoc', weight: 2 },
      ],
      dirs: [
        { name: 'chapters', weight: 3 },
        { name: 'content', weight: 1 },
        { name: 'docs', weight: 1 },
        { name: 'manuscript', weight: 3 },
        { name: 'book', weight: 3 },
      ],
      markers: [
        { name: 'SUMMARY.md', weight: 3 },
        { name: 'book.toml', weight: 3 },
        { name: 'book.json', weight: 3 },
        { name: '_toc.yml', weight: 3 },
        { name: 'conf.py', weight: 2 },
        { name: 'mkdocs.yml', weight: 2 },
      ]
    }
  },
];

// ---------------------------------------------------------------------------
// PECK v3: 30 new domain detection rules (auth, observability, database,
// payment, background-jobs, privacy, llm-safety, accessibility, seo,
// multi-tenancy, supply-chain, error-handling, resilience, cicd-security,
// container-security, graphql, licensing, logging, config-management,
// feature-flags, i18n, iac, iac-security, microservices, design-tokens,
// api-design, migration, caching, dependency-mgmt, testing)
// ---------------------------------------------------------------------------

const DOMAIN_RULES_V3 = [
  {
    domain: 'auth',
    threshold: 2,
    signals: {
      deps: [
        { name: 'passport', weight: 3 },
        { name: 'next-auth', weight: 3 },
        { name: '@auth/', weight: 3 },
        { name: 'jsonwebtoken', weight: 2 },
        { name: 'bcrypt', weight: 2 },
        { name: 'express-session', weight: 2 },
        { name: 'oauth', weight: 2 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'auth.js', weight: 2 },
        { name: 'auth.ts', weight: 2 },
        { name: 'middleware.js', weight: 1 },
      ]
    }
  },
  {
    domain: 'observability',
    threshold: 3,
    signals: {
      deps: [
        { name: 'winston', weight: 2 },
        { name: 'pino', weight: 2 },
        { name: '@opentelemetry/', weight: 3 },
        { name: 'datadog', weight: 3 },
        { name: 'newrelic', weight: 3 },
        { name: 'prometheus', weight: 2 },
        { name: 'grafana', weight: 2 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'logger.js', weight: 2 },
        { name: 'tracing.js', weight: 2 },
      ]
    }
  },
  {
    domain: 'database',
    threshold: 2,
    signals: {
      deps: [
        { name: 'prisma', weight: 3 },
        { name: 'sequelize', weight: 3 },
        { name: 'typeorm', weight: 3 },
        { name: 'knex', weight: 2 },
        { name: 'mongoose', weight: 3 },
        { name: 'pg', weight: 2 },
        { name: 'mysql2', weight: 2 },
        { name: 'drizzle', weight: 3 },
      ],
      files: [
        { ext: '.sql', weight: 2 },
      ],
      dirs: [
        { name: 'migrations', weight: 2 },
        { name: 'seeds', weight: 1 },
      ],
      markers: [
        { name: 'schema.prisma', weight: 3 },
      ]
    }
  },
  {
    domain: 'payment',
    threshold: 3,
    signals: {
      deps: [
        { name: 'stripe', weight: 3 },
        { name: '@stripe/', weight: 3 },
        { name: 'braintree', weight: 3 },
        { name: 'paypal', weight: 3 },
        { name: 'square', weight: 2 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'checkout.js', weight: 2 },
        { name: 'payment.js', weight: 2 },
      ]
    }
  },
  {
    domain: 'background-jobs',
    threshold: 3,
    signals: {
      deps: [
        { name: 'bull', weight: 3 },
        { name: 'bullmq', weight: 3 },
        { name: 'agenda', weight: 3 },
        { name: 'celery', weight: 3 },
        { name: 'sidekiq', weight: 3 },
        { name: 'bee-queue', weight: 2 },
        { name: 'temporal', weight: 3 },
      ],
      files: [],
      dirs: [
        { name: 'jobs', weight: 2 },
        { name: 'workers', weight: 2 },
        { name: 'queues', weight: 2 },
      ],
      markers: []
    }
  },
  {
    domain: 'privacy',
    threshold: 3,
    signals: {
      deps: [
        { name: 'cookie-consent', weight: 2 },
        { name: 'gdpr', weight: 2 },
      ],
      files: [],
      dirs: [
        { name: 'compliance', weight: 2 },
      ],
      markers: [
        { name: 'privacy-policy', weight: 1 },
      ]
    }
  },
  {
    domain: 'llm-safety',
    threshold: 2,
    signals: {
      deps: [
        { name: 'openai', weight: 3 },
        { name: '@anthropic', weight: 3 },
        { name: 'langchain', weight: 3 },
        { name: 'llamaindex', weight: 3 },
        { name: 'ai', weight: 2 },
        { name: '@ai-sdk', weight: 3 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'prompts/', weight: 2 },
      ]
    }
  },
  {
    domain: 'accessibility',
    threshold: 2,
    signals: {
      deps: [
        { name: '@axe-core/', weight: 3 },
        { name: 'jest-axe', weight: 3 },
        { name: 'pa11y', weight: 3 },
        { name: '@testing-library', weight: 2 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: '.a11yrc', weight: 2 },
        { name: 'a11y.config', weight: 2 },
      ]
    }
  },
  {
    domain: 'seo',
    threshold: 2,
    signals: {
      deps: [
        { name: 'next-seo', weight: 3 },
        { name: 'react-helmet', weight: 2 },
        { name: 'next-sitemap', weight: 2 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'sitemap.xml', weight: 3 },
        { name: 'robots.txt', weight: 2 },
      ]
    }
  },
  {
    domain: 'multi-tenancy',
    threshold: 3,
    signals: {
      deps: [
        { name: '@casl/', weight: 2 },
      ],
      files: [],
      dirs: [
        { name: 'tenants', weight: 3 },
      ],
      markers: [
        { name: 'tenant.js', weight: 2 },
        { name: 'tenancy.js', weight: 2 },
      ]
    }
  },
  {
    domain: 'supply-chain',
    threshold: 2,
    signals: {
      deps: [],
      files: [
        { ext: '.lock', weight: 1 },
      ],
      dirs: [],
      markers: [
        { name: '.github/workflows', weight: 2 },
        { name: '.github/dependabot.yml', weight: 3 },
        { name: '.snyk', weight: 3 },
        { name: '.npmrc', weight: 1 },
      ]
    }
  },
  {
    domain: 'error-handling',
    threshold: 2,
    signals: {
      deps: [
        { name: 'express', weight: 1 },
        { name: '@sentry/', weight: 3 },
        { name: 'bugsnag', weight: 3 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'error-handler.js', weight: 2 },
      ]
    }
  },
  {
    domain: 'resilience',
    threshold: 3,
    signals: {
      deps: [
        { name: 'opossum', weight: 3 },
        { name: 'cockatiel', weight: 3 },
        { name: 'polly', weight: 2 },
        { name: 'resilience4j', weight: 3 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'circuit-breaker', weight: 2 },
      ]
    }
  },
  {
    domain: 'cicd-security',
    threshold: 2,
    signals: {
      deps: [],
      files: [],
      dirs: [
        { name: '.github', weight: 1 },
      ],
      markers: [
        { name: '.github/workflows', weight: 2 },
        { name: 'Jenkinsfile', weight: 2 },
        { name: '.gitlab-ci.yml', weight: 2 },
        { name: '.circleci', weight: 2 },
      ]
    }
  },
  {
    domain: 'container-security',
    threshold: 2,
    signals: {
      deps: [],
      files: [
        { ext: '.dockerfile', weight: 2 },
      ],
      dirs: [
        { name: 'k8s', weight: 2 },
        { name: 'kubernetes', weight: 2 },
      ],
      markers: [
        { name: 'Dockerfile', weight: 3 },
        { name: 'docker-compose.yml', weight: 2 },
        { name: 'docker-compose.yaml', weight: 2 },
      ]
    }
  },
  {
    domain: 'graphql',
    threshold: 3,
    signals: {
      deps: [
        { name: 'graphql', weight: 3 },
        { name: 'apollo-server', weight: 3 },
        { name: '@apollo/', weight: 3 },
        { name: 'type-graphql', weight: 3 },
        { name: 'nexus', weight: 2 },
      ],
      files: [
        { ext: '.graphql', weight: 3 },
        { ext: '.gql', weight: 3 },
      ],
      dirs: [],
      markers: [
        { name: 'schema.graphql', weight: 3 },
      ]
    }
  },
  {
    domain: 'licensing',
    threshold: 2,
    signals: {
      deps: [],
      files: [],
      dirs: [],
      markers: [
        { name: 'LICENSE', weight: 2 },
        { name: 'LICENSE.md', weight: 2 },
        { name: 'NOTICE', weight: 2 },
      ]
    }
  },
  {
    domain: 'logging',
    threshold: 2,
    signals: {
      deps: [
        { name: 'winston', weight: 3 },
        { name: 'pino', weight: 3 },
        { name: 'bunyan', weight: 2 },
        { name: 'log4js', weight: 2 },
        { name: 'morgan', weight: 2 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'logger.js', weight: 2 },
        { name: 'logging.js', weight: 2 },
      ]
    }
  },
  {
    domain: 'config-management',
    threshold: 2,
    signals: {
      deps: [
        { name: 'dotenv', weight: 2 },
        { name: 'convict', weight: 3 },
        { name: 'config', weight: 2 },
        { name: 'nconf', weight: 2 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: '.env.example', weight: 2 },
        { name: 'config.js', weight: 1 },
      ]
    }
  },
  {
    domain: 'feature-flags',
    threshold: 3,
    signals: {
      deps: [
        { name: 'launchdarkly', weight: 3 },
        { name: '@unleash/', weight: 3 },
        { name: 'growthbook', weight: 3 },
        { name: 'flagsmith', weight: 3 },
        { name: 'statsig', weight: 3 },
      ],
      files: [],
      dirs: [],
      markers: []
    }
  },
  {
    domain: 'i18n',
    threshold: 3,
    signals: {
      deps: [
        { name: 'i18next', weight: 3 },
        { name: 'react-intl', weight: 3 },
        { name: '@formatjs/', weight: 3 },
        { name: 'vue-i18n', weight: 3 },
        { name: 'lingui', weight: 3 },
      ],
      files: [],
      dirs: [
        { name: 'locales', weight: 2 },
        { name: 'translations', weight: 2 },
      ],
      markers: []
    }
  },
  {
    domain: 'iac',
    threshold: 3,
    signals: {
      deps: [
        { name: 'pulumi', weight: 3 },
        { name: 'cdk', weight: 3 },
      ],
      files: [
        { ext: '.tf', weight: 3 },
      ],
      dirs: [
        { name: 'terraform', weight: 3 },
        { name: 'pulumi', weight: 2 },
        { name: 'cdk', weight: 2 },
      ],
      markers: []
    }
  },
  {
    domain: 'iac-security',
    threshold: 3,
    signals: {
      deps: [
        { name: 'pulumi', weight: 3 },
        { name: 'cdk', weight: 3 },
      ],
      files: [
        { ext: '.tf', weight: 3 },
      ],
      dirs: [
        { name: 'terraform', weight: 3 },
        { name: 'pulumi', weight: 2 },
        { name: 'cdk', weight: 2 },
      ],
      markers: [
        { name: 'checkov.yml', weight: 3 },
        { name: 'tfsec.yml', weight: 3 },
      ]
    }
  },
  {
    domain: 'microservices',
    threshold: 3,
    signals: {
      deps: [
        { name: '@grpc/', weight: 3 },
        { name: 'protobuf', weight: 2 },
      ],
      files: [],
      dirs: [
        { name: 'services', weight: 2 },
        { name: 'gateway', weight: 2 },
        { name: 'api-gateway', weight: 2 },
      ],
      markers: [
        { name: 'docker-compose.yml', weight: 2 },
      ]
    }
  },
  {
    domain: 'design-tokens',
    threshold: 2,
    signals: {
      deps: [
        { name: '@tokens-studio', weight: 3 },
        { name: 'style-dictionary', weight: 3 },
        { name: 'tailwindcss', weight: 1 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'tokens.json', weight: 3 },
        { name: 'design-tokens.json', weight: 3 },
      ]
    }
  },
  {
    domain: 'api-design',
    threshold: 2,
    signals: {
      deps: [
        { name: 'swagger-ui', weight: 2 },
        { name: '@nestjs/swagger', weight: 3 },
      ],
      files: [],
      dirs: [],
      markers: [
        { name: 'openapi.yaml', weight: 3 },
        { name: 'swagger.json', weight: 3 },
        { name: 'openapi.json', weight: 3 },
      ]
    }
  },
  {
    domain: 'migration',
    threshold: 2,
    signals: {
      deps: [],
      files: [],
      dirs: [
        { name: 'migrations', weight: 3 },
        { name: 'db/migrate', weight: 3 },
      ],
      markers: [
        { name: 'knexfile.js', weight: 2 },
        { name: 'ormconfig.js', weight: 2 },
      ]
    }
  },
  {
    domain: 'caching',
    threshold: 3,
    signals: {
      deps: [
        { name: 'redis', weight: 3 },
        { name: 'ioredis', weight: 3 },
        { name: 'memcached', weight: 2 },
        { name: 'keyv', weight: 2 },
        { name: '@neshca/cache-handler', weight: 3 },
      ],
      files: [],
      dirs: [],
      markers: []
    }
  },
  {
    domain: 'dependency-mgmt',
    threshold: 1,
    signals: {
      deps: [],
      files: [],
      dirs: [],
      markers: [
        { name: 'package-lock.json', weight: 2 },
        { name: 'yarn.lock', weight: 2 },
        { name: 'pnpm-lock.yaml', weight: 2 },
        { name: 'Pipfile.lock', weight: 2 },
      ]
    }
  },
  {
    domain: 'testing',
    threshold: 2,
    signals: {
      deps: [
        { name: 'jest', weight: 2 },
        { name: 'mocha', weight: 2 },
        { name: 'vitest', weight: 3 },
        { name: '@testing-library', weight: 2 },
        { name: 'cypress', weight: 3 },
        { name: 'playwright', weight: 3 },
      ],
      files: [],
      dirs: [
        { name: '__tests__', weight: 2 },
        { name: 'e2e', weight: 2 },
      ],
      markers: []
    }
  },
];

// Merge v1 + v2 + v3 domains into main ALL_DOMAIN_RULES array
const ALL_DOMAIN_RULES = [...DOMAIN_RULES, ...DOMAIN_RULES_V2, ...DOMAIN_RULES_V3];

module.exports = {
  detectDomains,
  DOMAIN_RULES,
  DOMAIN_RULES_V2,
  DOMAIN_RULES_V3,
  ALL_DOMAIN_RULES,
  // Exported for testing
  getPackageJsonDeps,
  getPythonDeps,
  getGoDeps,
  getRustDeps,
  getComposerDeps
};
