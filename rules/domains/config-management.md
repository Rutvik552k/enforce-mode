## Configuration Management Domain Rules

- [WARN] EXTERNALIZE CONFIG: Application configuration must be externalized from code (environment variables, config files, or config service). Never hardcode URLs, ports, or feature settings in source.
- [WARN] ENVIRONMENT PARITY: Config structure must be identical across environments (dev, staging, production). Only values differ. Use the same config schema with environment-specific overrides.
- [WARN] DOCUMENTATION: Document all configuration options with description, type, default value, and valid range. Undocumented config options are tech debt.
- [STRICT] VALIDATE AT STARTUP: Validate all required configuration at application startup. Fail fast with clear error messages listing missing or invalid config values. Never discover missing config at runtime.
- [CRITICAL] SECURE DEFAULTS: Default configuration values must be secure. No debug mode, no verbose logging, no open CORS, no disabled auth by default. Insecure options require explicit opt-in.
- [STRICT] SECRET SEPARATION: Secrets must be stored separately from non-secret config (Vault, KMS, sealed-secrets). Never mix plaintext secrets with application config files. Rotate secrets without redeployment.
- [CRITICAL] CONFIG CHANGE AUDIT: All production configuration changes must be version-controlled, reviewed, and audit-logged. No ad-hoc config changes without traceability.
- [CRITICAL] ROLLBACK CAPABILITY: Configuration changes must be reversible. Maintain previous config versions. Support instant rollback of config without redeployment.
