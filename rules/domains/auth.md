## Authentication Domain Rules

- [WARN] SESSION TIMEOUT: Session timeout must be configured, not unlimited. Set reasonable expiry (15min-24hr based on sensitivity).
- [WARN] PASSWORD VALIDATION: Password validation must enforce minimum complexity. Use zxcvbn or similar strength estimator.
- [STRICT] JWT EXPIRY: JWT must have expiry (`exp` claim required). Access tokens max 15min, refresh tokens max 7 days.
- [STRICT] OAUTH PKCE: OAuth must use PKCE for public clients. Authorization code flow only — never implicit.
- [STRICT] CSRF PROTECTION: CSRF protection required on all state-mutating endpoints. Use SameSite cookies or CSRF tokens.
- [STRICT] MFA ENFORCEMENT: Multi-factor authentication must be available for privileged accounts. TOTP or WebAuthn preferred over SMS.
- [CRITICAL] PASSWORD HASHING: Passwords must be hashed with bcrypt/argon2/scrypt, never plaintext or MD5/SHA.
- [CRITICAL] SESSION INVALIDATION: Session tokens must be invalidated on logout. Clear server-side session state.
- [CRITICAL] CREDENTIAL ROTATION: API keys and service credentials must have rotation policy. Revoke compromised credentials immediately, never reuse.
