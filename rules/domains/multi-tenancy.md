## Multi-Tenancy Domain Rules

- [WARN] TENANT CONTEXT: Every request must carry tenant context (header, JWT claim, or subdomain). Validate tenant ID at the middleware layer before business logic executes.
- [WARN] DEFAULT DENY: If tenant context is missing or invalid, deny the request. Never fall back to a default tenant. Log and alert on missing tenant context.
- [STRICT] QUERY FILTERING: All database queries must include tenant filter. Use row-level security, ORM scopes, or middleware-injected WHERE clauses. Audit queries without tenant predicate.
- [STRICT] RESOURCE ISOLATION: Tenant-scoped resources (files, queues, caches) must include tenant ID in the key/path. Shared caches must namespace by tenant. No cross-tenant cache leaks.
- [STRICT] RATE LIMITING: Apply per-tenant rate limits and quotas. One tenant's traffic spike must not degrade service for others. Implement noisy-neighbor detection.
- [CRITICAL] CROSS-TENANT TESTING: Integration tests must verify that tenant A cannot access tenant B's data. Test with multiple tenants concurrently. Fuzz tenant ID boundaries.
- [CRITICAL] DATA EXPORT: Tenant data export and deletion must be complete — all tables, files, caches, logs, and backups. Verify no residual data after tenant offboarding.
- [CRITICAL] ADMIN ESCALATION: Admin/superuser access across tenants must be audit-logged, time-bounded, and require explicit justification. No permanent cross-tenant access.
