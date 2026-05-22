'use strict';

/**
 * graphql.js — Domain patterns for GraphQL API security and performance
 *
 * Detects introspection left on in production, missing query depth limits,
 * and N+1 query problems in resolvers.
 */

module.exports = {
  domain: 'graphql',

  patterns: [
    {
      name: 'Introspection enabled in production',
      regex: /introspection\s*:\s*true/,
      risk: 'GraphQL introspection enabled — exposes full schema to attackers.',
      confidence: 'HIGH',
      severity: 'CRITICAL',
      multiline: false,
      justification: ['development', 'NODE_ENV', 'dev only'],
    },
    {
      name: 'Missing query depth limit',
      regex: /(?:ApolloServer|createServer|graphqlHTTP)\s*\([^)]*\)(?![\s\S]{0,200}(?:depthLimit|maxDepth|queryDepth))/,
      risk: 'No query depth limit — deeply nested queries cause DoS.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: true,
      justification: ['depthLimit', 'maxDepth', 'validationRules'],
    },
    {
      name: 'N+1 query in resolver',
      regex: /(?:resolve|resolver)\s*[\s\S]{0,100}(?:for\s*\(|\.map\s*\()[\s\S]{0,100}(?:findOne|findById|load|fetch)\s*\(/,
      risk: 'N+1 query pattern in resolver — use DataLoader for batching.',
      confidence: 'MEDIUM',
      severity: 'STRICT',
      multiline: true,
      justification: ['DataLoader', 'dataloader', 'batch', 'loader'],
    },
  ],

  extMap: {
    '.graphql': 'graphql',
    '.gql': 'graphql',
  },
};
