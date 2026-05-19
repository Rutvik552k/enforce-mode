## API Security Domain Rules

- [WARN] AUTH REQUIRED: Every API endpoint MUST have authentication (API key, JWT, or OAuth). No unauthenticated public endpoints in production without explicit user confirmation.
- [WARN] INPUT VALIDATION: Validate and sanitize ALL request inputs — file uploads (type + size + header validation), text prompts (length + sanitization), parameters (range checks). Use schema validation (Pydantic, Zod, class-validator).
- [WARN] SECRETS MANAGEMENT: Never hardcode API keys, tokens, or credentials in code. Use environment variables or secret managers. Check for leaked secrets before every commit.
- [STRICT] RATE LIMITING: All public endpoints must have rate limiting per user/IP. Research appropriate limits for compute-intensive endpoints (video generation = expensive). Document rate limits.
- [STRICT] FILE UPLOAD PROTECTION: Validate file type by header inspection (not just extension). Enforce size limits. Scan for malicious payloads. Reject unexpected MIME types.
- [STRICT] PROMPT INJECTION: When handling user text that reaches LLM prompts, apply input sanitization and output validation. Never trust user-supplied text as instructions.
- [STRICT] ERROR HANDLING: Never expose internal errors, stack traces, or system paths to API users. Return sanitized error messages. Log full errors server-side with request ID.
- [CRITICAL] DDOS MITIGATION: Production APIs must have request size limits, connection timeouts, concurrent request limits, and abuse detection at infrastructure level.
- [CRITICAL] P99 MONITORING: Production deployments require latency monitoring with P99 alerting. Report P99, not just averages. Design for graceful degradation, not crash.
- [CRITICAL] AUDIT LOGGING: Log all API requests with user ID, timestamp, resource usage, and response status for security audit.
