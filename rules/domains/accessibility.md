## Accessibility Domain Rules

- [WARN] KEYBOARD NAVIGATION: All interactive elements must be reachable and operable via keyboard. Tab order must follow logical reading order. No keyboard traps.
- [WARN] ALT TEXT: All meaningful images must have descriptive `alt` text. Decorative images use `alt=""`. Never use filename or placeholder text as alt.
- [WARN] FORM LABELS: Every form input must have an associated `<label>` element or `aria-label`. Placeholder text is not a substitute for labels. Error messages must identify the field.
- [WARN] FOCUS MANAGEMENT: Focus must be visible on all interactive elements. Custom focus styles must meet 3:1 contrast. Manage focus on route changes and modal open/close.
- [STRICT] COLOR CONTRAST: Text must meet WCAG AA contrast ratios (4.5:1 normal text, 3:1 large text). Non-text UI components require 3:1 contrast against adjacent colors.
- [STRICT] ARIA USAGE: Use semantic HTML before ARIA. When ARIA is needed, follow ARIA authoring practices. Never use ARIA roles that conflict with native semantics.
- [STRICT] LIVE REGIONS: Dynamic content updates must use `aria-live` regions with appropriate politeness (polite/assertive). Screen readers must announce status messages and errors.
- [STRICT] MOTION SAFETY: Respect `prefers-reduced-motion` media query. Provide controls to pause/stop animations. No flashing content above 3 flashes per second.
- [CRITICAL] AUTOMATED TESTING: Run axe-core or equivalent in CI pipeline. Zero critical or serious a11y violations allowed in production. Test with screen reader (VoiceOver, NVDA) before release.
- [CRITICAL] SEMANTIC STRUCTURE: Use proper heading hierarchy (h1-h6) without skipping levels. Landmark regions (`main`, `nav`, `aside`) must be present. Page must have a single `h1`.
