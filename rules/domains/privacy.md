## Privacy Domain Rules

- [WARN] PII TAGGING: All fields containing personally identifiable information must be tagged/annotated in the schema. Maintain a PII inventory per service.
- [WARN] DATA MINIMIZATION: Collect only the PII strictly necessary for the stated purpose. Do not store PII "just in case." Review data collection annually.
- [WARN] CONSENT TRACKING: Record user consent with timestamp, scope, and version. Consent must be freely given, specific, and revocable. Never pre-check consent boxes.
- [STRICT] PII ENCRYPTION: PII at rest must be encrypted with application-level encryption (not just disk encryption). Use envelope encryption with key rotation support.
- [STRICT] DATA MASKING: PII displayed in logs, admin panels, and support tools must be masked or redacted. Show only last 4 digits of SSN, mask email domains.
- [STRICT] CROSS-BORDER TRANSFER: Data transfers across jurisdictions must comply with local regulations (GDPR, CCPA). Document legal basis for each cross-border transfer.
- [STRICT] RETENTION POLICY: Define and enforce retention periods for all PII categories. Auto-delete or anonymize data past retention period. Document exceptions.
- [CRITICAL] RIGHT TO ERASURE: Implement deletion workflows that remove PII from all systems including backups, caches, logs, and analytics. Verify deletion completeness.
- [CRITICAL] BREACH NOTIFICATION: Implement breach detection and notification workflows. GDPR requires 72-hour notification. Maintain incident response playbook for data breaches.
