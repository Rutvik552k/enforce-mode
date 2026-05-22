## Dependency Management Domain Rules

- [WARN] COMMIT LOCKFILES: Always commit lockfiles (package-lock.json, yarn.lock, Gemfile.lock, poetry.lock) to version control. Lockfiles ensure deterministic builds and prevent phantom dependency drift between environments.
- [WARN] REMOVE UNUSED: Regularly audit and remove unused dependencies. Dead dependencies increase attack surface, slow installs, and inflate bundle size. Use tools like depcheck or npm-check to identify unused packages.
- [STRICT] NPM CI IN CI: Use `npm ci` (or equivalent deterministic install) in CI/CD pipelines, never `npm install`. Non-deterministic installs cause works-on-my-machine failures and unreproducible builds.
- [STRICT] AUDIT BEFORE ADDING: Run security audit and license check before adding any new dependency. Evaluate maintenance status, download trends, and known vulnerabilities. Prefer well-maintained dependencies with active communities.
- [CRITICAL] NO CRITICAL CVES IN PROD: No dependency with a known critical or high-severity CVE may ship to production. Automate vulnerability scanning in CI. Block merges until critical vulnerabilities are resolved or explicitly risk-accepted with documentation.
