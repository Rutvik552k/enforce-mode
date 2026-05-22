## Database Domain Rules

- [WARN] PRIMARY KEYS: Every table must have an explicit primary key. Prefer UUID or ULID for distributed systems. Never use composite keys unless modeling a join table.
- [WARN] INDEX COVERAGE: Queries in WHERE, JOIN, and ORDER BY clauses must have supporting indexes. Run EXPLAIN on queries with >100ms latency. Add missing indexes proactively.
- [WARN] N+1 QUERIES: Detect and eliminate N+1 query patterns. Use eager loading, batch fetching, or DataLoader. Monitor query count per request.
- [STRICT] PARAMETERIZED QUERIES: All database queries must use parameterized statements or an ORM. Never concatenate user input into SQL strings. No raw SQL without bind parameters.
- [STRICT] MIGRATION SAFETY: Schema migrations must be backwards-compatible. No column renames or drops without expand-contract pattern. Test migrations against production-scale data.
- [STRICT] CONNECTION POOLING: Use connection pools with bounded size (min/max), idle timeout, and connection validation. Never open unbounded connections. Monitor pool exhaustion.
- [STRICT] TRANSACTION SCOPE: Keep transactions as short as possible. Never hold transactions open across network calls or user interactions. Use explicit isolation levels.
- [CRITICAL] BACKUP VERIFICATION: Database backups must run on schedule AND be verified with periodic restore tests. Untested backups are not backups.
- [CRITICAL] ENCRYPTION AT REST: Production databases must encrypt data at rest. Use TLS for all database connections. Rotate encryption keys on schedule.
