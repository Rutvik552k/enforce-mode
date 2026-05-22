## Logging Domain Rules

- [WARN] STRUCTURED FORMAT: All logs must be structured JSON with consistent field names (timestamp, level, service, message, traceId). No free-form string concatenation in production logs.
- [STRICT] CORRELATION IDS: Include correlation/request ID in every log entry. Propagate correlation ID across service boundaries. Enable log aggregation tools to trace requests end-to-end.
- [STRICT] RETENTION POLICIES: Configure log rotation by size and time. Set retention limits to prevent disk exhaustion. Archive logs to durable storage for compliance. Define retention periods per log category based on regulatory requirements.
- [STRICT] NO SECRETS IN LOGS: Never log passwords, API keys, tokens, session IDs, credit card numbers, or PII. Use structured logging with field-level redaction. Audit log output regularly.
- [CRITICAL] SECURITY EVENT LOGGING: Log authentication attempts (success and failure), authorization failures, privilege escalation, and configuration changes. These logs must be tamper-resistant and retained per compliance requirements.
- [STRICT] LOG LEVEL DISCIPLINE: Use consistent log levels — ERROR for failures requiring attention, WARN for recoverable issues, INFO for business events, DEBUG for troubleshooting. Never log expected conditions at ERROR.
- [CRITICAL] AUDIT TRAIL: Security-relevant actions (login, data access, admin operations, permission changes) must have immutable audit logs with actor, action, target, and timestamp.
- [CRITICAL] LOG INJECTION PREVENTION: Sanitize user input before including in log messages. Prevent log injection attacks that could corrupt log analysis or trigger false alerts.
