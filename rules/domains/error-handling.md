## Error Handling Domain Rules

- [WARN] NO EMPTY CATCH: Never swallow exceptions with empty catch blocks. At minimum, log the error with context. If ignoring intentionally, add a comment explaining why.
- [WARN] TYPED EXCEPTIONS: Use typed/custom exception classes, not generic Error or Exception. Include error codes, context, and recovery hints. Differentiate retriable vs non-retriable errors.
- [WARN] ERROR MESSAGES: Error messages must be actionable for the audience. User-facing errors explain what to do next. Developer errors include context for debugging.
- [STRICT] ASYNC ERROR HANDLING: All async operations (Promises, callbacks, event handlers) must have error handlers. Unhandled promise rejections must crash or log, never silently fail.
- [STRICT] RESOURCE CLEANUP: Use try/finally, using/defer, or RAII patterns to ensure resources (files, connections, locks) are released on error paths. Never leak resources on exception.
- [STRICT] ERROR BOUNDARIES: UI frameworks must have error boundaries at route and feature boundaries. Backend services must have top-level exception handlers. Never show white screens or raw stack traces.
- [CRITICAL] NO STACK TRACES TO USERS: Never expose stack traces, internal paths, or system details in API responses or UI. Return sanitized error with correlation ID. Log full details server-side.
- [CRITICAL] FAIL LOUD, NO FALLBACK: Wrap fallible operations in try/catch with a typed/specific catch. Every error message must identify where the logic failed — operation, triggering inputs, failing component. Do NOT write fallback or graceful-degradation paths (no silent defaults, no swallow-and-continue, no serving stale/cached results in place of the real failure). Surface the failure instead of masking it. Re-raise or propagate after logging full context; never swallow. The point is to locate the failure, not hide it.
