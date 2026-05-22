## CI/CD Security Domain Rules

- [WARN] BRANCH PROTECTION: Main/production branches must require PR review, passing CI checks, and no force pushes. Enforce linear history or merge commits per team convention.
- [WARN] ROLLBACK PLAN: Every deployment must have a documented rollback procedure. Blue-green or canary deploys preferred. Test rollback before deploying to production.
- [WARN] BUILD REPRODUCIBILITY: Builds must be reproducible — same source produces same artifact. Pin build tool versions. Use deterministic dependency resolution.
- [STRICT] SAST IN PIPELINE: Run static application security testing (SAST) in CI on every PR. Block merge on critical findings. Use tools appropriate to the language (Semgrep, CodeQL, Bandit).
- [STRICT] SCA IN PIPELINE: Run software composition analysis (SCA) in CI. Block PRs introducing dependencies with known critical CVEs. Auto-create upgrade PRs for vulnerable dependencies.
- [STRICT] CONTAINER SCANNING: Scan container images for vulnerabilities before pushing to registry. Block images with critical/high CVEs. Rebuild images when base image updates are available.
- [CRITICAL] SECRETS IN CI: CI/CD secrets must use the platform's secret management (GitHub Secrets, Vault). Never hardcode secrets in pipeline config, Dockerfiles, or build scripts. Rotate CI secrets quarterly.
- [CRITICAL] ARTIFACT SIGNING: Sign build artifacts and container images. Verify signatures before deployment. Use Sigstore/cosign or GPG signing. Reject unsigned artifacts in production.
