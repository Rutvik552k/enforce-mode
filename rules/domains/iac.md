## Infrastructure as Code Domain Rules

- [WARN] RESOURCE TAGGING: All cloud resources must have standard tags (environment, team, cost-center, service). Enforce tagging policy with linting. Untagged resources should be flagged and cleaned up.
- [STRICT] NO HARDCODED VALUES: Never hardcode IP addresses, AMI IDs, account IDs, or region names. Use variables, data sources, or parameter stores. Hardcoded values break portability.
- [WARN] MODULE STRUCTURE: Organize IaC into reusable modules with clear inputs/outputs. Pin module versions. Document module purpose, required variables, and outputs.
- [STRICT] REMOTE STATE: Store Terraform/Pulumi state in a remote backend (S3, GCS, Azure Blob) with locking. Never commit state files to git. Enable state encryption at rest.
- [STRICT] DRIFT DETECTION: Run periodic drift detection to catch manual changes. Alert on infrastructure drift from declared state. Reconcile drift through IaC, not manual fixes.
- [STRICT] PLAN REVIEW: Every infrastructure change must produce a plan/diff for review before apply. No direct apply without plan approval. CI must show plan output in PR comments.
- [CRITICAL] NO SECRETS IN PLAINTEXT: Never store secrets, passwords, API keys, or credentials in IaC source files, variable defaults, or tfvars. Use secret management tools (Vault, AWS Secrets Manager, SOPS). Scan for plaintext secrets in CI.
- [CRITICAL] BLAST RADIUS: Use workspaces or state separation to limit blast radius. Separate stateful resources (databases) from stateless (compute). Never manage all infrastructure in one state file.
- [CRITICAL] DESTROY PROTECTION: Enable deletion protection on stateful resources (databases, storage, DNS). Require explicit confirmation for destructive operations. Use `prevent_destroy` lifecycle rules.
