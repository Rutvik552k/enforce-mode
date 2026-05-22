## Microservices Domain Rules

- [STRICT] NO SHARED DATABASE: Each service owns its data store. Never share databases between services. Use APIs, events, or data replication for cross-service data access.
- [WARN] API CONTRACT: Define explicit API contracts (OpenAPI, protobuf, GraphQL schema) between services. Version contracts. Breaking changes require deprecation period.
- [WARN] SERVICE DISCOVERY: Use service discovery (DNS, Consul, Kubernetes Services) instead of hardcoded host/port. Services must resolve dependencies dynamically.
- [STRICT] SAGA PATTERN: Distributed transactions across services must use saga pattern (choreography or orchestration). Never use distributed locks or 2PC across service boundaries.
- [STRICT] CIRCUIT BREAKERS: All inter-service calls must have circuit breakers with configurable thresholds. Monitor circuit state. Define fallback behavior for each dependency.
- [STRICT] IDEMPOTENT HANDLERS: Service endpoints that receive events or retried requests must be idempotent. Use idempotency keys or deduplication. Design for at-least-once delivery.
- [STRICT] EVENT SCHEMA EVOLUTION: Event schemas must be backwards-compatible. Use schema registry with compatibility checks. Consumers must tolerate unknown fields. Never remove required fields.
- [CRITICAL] DISTRIBUTED TRACING: All inter-service calls must propagate trace context. Instrument service entry, exit, and async boundaries. Correlate logs with trace IDs across services.
- [CRITICAL] DEPLOYMENT INDEPENDENCE: Services must be independently deployable. No coordinated deployments. If deploying service A requires deploying service B simultaneously, they are not properly decoupled.
