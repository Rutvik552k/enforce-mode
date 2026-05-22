## Supply Chain Domain Rules

- [WARN] SBOM GENERATION: Generate Software Bill of Materials (SBOM) in SPDX or CycloneDX format for every release. Include all direct and transitive dependencies.
- [WARN] LICENSE AUDIT: Audit dependency licenses before adding. Flag copyleft licenses (GPL, AGPL) that may conflict with project licensing. Maintain an approved license allowlist.
- [STRICT] PIN VERSIONS: Lock all dependency versions with exact pinning in lockfiles. Never use floating ranges (^, ~) in production. Review all version bumps before merging.
- [STRICT] VULNERABILITY SCANNING: Run automated dependency vulnerability scanning (npm audit, Snyk, Dependabot) in CI. Block merges with critical/high severity CVEs unfixed.
- [STRICT] PROVENANCE VERIFICATION: Verify package provenance and integrity. Use npm provenance attestations, sigstore, or GPG signatures. Reject packages without verifiable source.
- [CRITICAL] REGISTRY SECURITY: Use private registries for internal packages. Configure scoped registries to prevent dependency confusion attacks. Never publish internal packages to public registries.
- [CRITICAL] TYPOSQUATTING DEFENSE: Review package names carefully before installing. Use allowlisted packages where possible. Monitor for name-squatting on internal package names.
