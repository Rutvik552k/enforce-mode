## Design Tokens Domain Rules

- [WARN] NO HARDCODED COLORS: Never use raw hex/RGB/HSL color values in component styles. Reference design token variables. Every color must trace back to the token system.
- [WARN] SEMANTIC NAMING: Token names must describe purpose, not appearance (`color-action-primary`, not `color-blue-500`). Semantic tokens enable theme switching without renaming.
- [WARN] SPACING SCALE: Use a consistent spacing scale (4px/8px base). Never use arbitrary pixel values for margin/padding. Reference spacing tokens from the design system.
- [STRICT] TOKEN REFERENCES: Component tokens must reference global tokens, not raw values. Build a layered system: global -> semantic -> component tokens. Changes cascade correctly.
- [STRICT] TYPOGRAPHY TOKENS: Define font family, size, weight, and line-height as tokens. Use type scale tokens (`text-body-md`, `text-heading-lg`), not arbitrary font sizes.
- [STRICT] THEME SUPPORT: Token system must support light/dark themes at minimum. Use CSS custom properties or platform-appropriate theming. Test both themes in CI.
- [CRITICAL] SINGLE SOURCE OF TRUTH: Design tokens must be defined in one canonical source (Figma Tokens, Style Dictionary, JSON). Generate platform-specific outputs (CSS, iOS, Android) from this source.
- [CRITICAL] BREAKING CHANGE PROCESS: Renaming or removing tokens is a breaking change. Deprecate with migration path. Never silently remove tokens that consuming components depend on.
