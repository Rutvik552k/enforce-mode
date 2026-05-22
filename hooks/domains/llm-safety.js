'use strict';

/**
 * llm-safety.js — LLM/GenAI Safety domain patterns
 *
 * Tier 0 domain: covers prompt injection, untrusted LLM output
 * in dangerous sinks (SQL, shell), and token budget enforcement.
 */

const domain = 'llm-safety';

const patterns = [
  {
    name: 'Prompt injection risk',
    regex: /(?:prompt|messages?)\s*[:=][\s\S]{0,50}(?:\+\s*(?:user|input|req\.|request\.)|\$\{(?:user|input|req|request))/,
    risk: 'User input concatenated into prompt — prompt injection risk. Sanitize or use structured messages.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: true,
    justification: ['sanitize', 'escape', 'validate', 'DOMPurify', 'system prompt', 'guardrail', 'allowlist'],
  },
  {
    name: 'LLM output in SQL',
    regex: /(?:query|execute|sql)\s*\([^)]*(?:response|completion|output|result)\.(?:text|content|message)/,
    risk: 'LLM output used in SQL query — second-order injection. Parameterize or validate output.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['sanitize', 'parameterized', 'prepared', 'escape', 'validate', 'allowlist'],
  },
  {
    name: 'LLM output in shell',
    regex: /(?:exec|spawn|execSync|system)\s*\([^)]*(?:response|completion|output|result)\.(?:text|content|message)/,
    risk: 'LLM output passed to shell command — remote code execution risk. Never exec untrusted output.',
    confidence: 'HIGH',
    severity: 'CRITICAL',
    multiline: false,
    justification: ['sanitize', 'escape', 'validate', 'allowlist', 'sandbox', 'shellEscape'],
  },
  {
    name: 'Missing token budget',
    regex: /(?:openai|anthropic|claude|gpt)\.\w+\s*\([^)]*\)(?![\s\S]{0,100}(?:max_tokens|maxTokens|token_limit))/,
    risk: 'LLM API call without token limit — unbounded cost and latency. Set max_tokens.',
    confidence: 'MEDIUM',
    severity: 'WARN',
    multiline: true,
    justification: ['max_tokens', 'maxTokens', 'token_limit', 'budget', 'max_completion_tokens'],
  },
];

const extMap = {};

module.exports = { domain, patterns, extMap };
