## GraphQL Domain Rules

- [WARN] QUERY COMPLEXITY: Assign complexity scores to fields and enforce a maximum query complexity limit. Reject queries exceeding the threshold before execution.
- [WARN] PAGINATION: All list fields must support pagination (cursor-based preferred). Never return unbounded lists. Set default and maximum page sizes.
- [WARN] ERROR HANDLING: Use structured error extensions with error codes, not just message strings. Distinguish user errors from system errors. Never expose internal details in error messages.
- [STRICT] DEPTH LIMITING: Enforce maximum query depth (typically 7-10 levels). Reject deeply nested queries to prevent resource exhaustion attacks.
- [STRICT] N+1 WITH DATALOADER: Use DataLoader (or equivalent batching) for all resolver fields that fetch related data. Never make individual database calls per list item in resolvers.
- [STRICT] PERSISTED QUERIES: Production clients should use persisted/allowlisted queries. Register queries at build time. Reject arbitrary queries from untrusted clients.
- [CRITICAL] DISABLE INTROSPECTION: Disable GraphQL introspection in production. Schema should not be publicly discoverable. Expose schema documentation through controlled channels only.
- [CRITICAL] RATE LIMITING: Apply rate limiting per client/user on GraphQL endpoint. Consider cost-based rate limiting where expensive queries consume more quota than simple ones.
