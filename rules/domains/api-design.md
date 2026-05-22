## API Design Domain Rules

- [WARN] CONSISTENT NAMING: Use consistent naming conventions across all endpoints. Resource names are plural nouns, lowercase with hyphens. Actions use standard HTTP verbs. Never mix camelCase and snake_case in the same API.
- [WARN] CURSOR PAGINATION: Use cursor-based pagination for list endpoints instead of offset-based. Offset pagination degrades with large datasets and produces inconsistent results during concurrent writes. Return next/previous cursor tokens.
- [STRICT] RFC 7807 ERRORS: Error responses must follow RFC 7807 Problem Details format with type, title, status, detail, and instance fields. Provide actionable error messages. Never expose stack traces or internal details in production errors.
- [STRICT] API VERSIONING: APIs must be explicitly versioned (URL path, header, or query parameter). Document versioning strategy. Maintain backward compatibility within a version. Support at least one previous version during deprecation.
- [STRICT] OPENAPI SPEC MAINTAINED: Maintain an up-to-date OpenAPI specification for all endpoints. Generate spec from code or validate code against spec in CI. Spec drift from implementation is a bug.
- [CRITICAL] BREAKING CHANGES NEED NEW VERSION: Breaking changes (removing fields, changing types, altering semantics) require a new API version. Never introduce breaking changes in an existing version. Communicate deprecation timelines to consumers.
