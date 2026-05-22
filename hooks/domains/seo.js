'use strict';

/**
 * seo.js — Domain patterns for search engine optimization
 *
 * Detects missing meta descriptions, Open Graph tags, canonical links,
 * and images without lazy loading attributes.
 */

module.exports = {
  domain: 'seo',

  patterns: [
    {
      name: 'Missing meta description',
      regex: /<head>[\s\S]*?<\/head>(?![\s\S]*<meta\s+name=["']description)/,
      risk: 'Page missing meta description — search engines use default snippet.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: true,
      justification: ['description', 'meta', 'next/head', 'Head'],
    },
    {
      name: 'Missing Open Graph tags',
      regex: /<head>[\s\S]*?<\/head>(?![\s\S]*og:)/,
      risk: 'No Open Graph tags — social sharing previews will be generic.',
      confidence: 'LOW',
      severity: 'WARN',
      multiline: true,
      justification: ['og:', 'openGraph', 'meta property', 'next-seo'],
    },
    {
      name: 'Image without lazy loading',
      regex: /<img\s+(?:(?!loading=)[^>])*\/?>/,
      risk: 'Image without loading attribute — eager loading impacts page speed.',
      confidence: 'LOW',
      severity: 'WARN',
      multiline: false,
      justification: ['loading=', 'priority', 'above-fold', 'eager'],
    },
    {
      name: 'Missing canonical link',
      regex: /<head>[\s\S]*?<\/head>(?![\s\S]*canonical)/,
      risk: 'No canonical link — duplicate content may dilute search rankings.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: true,
      justification: ['canonical', 'next/head'],
    },
  ],

  extMap: {},
};
