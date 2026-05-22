## Migration Domain Rules

- [STRICT] REVERSIBLE MIGRATIONS: Every migration must have a working rollback (down migration). Test rollbacks in CI. Irreversible migrations require explicit approval and a documented recovery plan.
- [STRICT] EXPAND CONTRACT: Use expand-and-contract pattern for breaking schema changes. First expand (add new column/table), migrate data, update code, then contract (remove old column/table). Never rename or remove columns in a single step.
- [STRICT] ONLINE DDL FOR LARGE TABLES: Use online DDL tools (pt-online-schema-change, gh-ost, pg_repack) for schema changes on tables with more than 1M rows. Direct ALTER TABLE locks the table and causes downtime.
- [CRITICAL] BACKUP BEFORE MIGRATE: Take a verified backup before running any migration in production. Confirm backup integrity and test restore procedure. Never run destructive migrations without a proven recovery path.
- [CRITICAL] NO DROP WITHOUT PLAN: Never execute DROP TABLE, DROP COLUMN, or DROP DATABASE without a documented rollback plan and data preservation strategy. Require explicit approval for destructive DDL in production.
