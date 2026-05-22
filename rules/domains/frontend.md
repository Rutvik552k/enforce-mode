## Frontend Domain Rules

- [WARN] XSS PREVENTION: Never use `dangerouslySetInnerHTML`, `v-html`, or `innerHTML` without DOMPurify sanitization. User-generated content always sanitized before render.
- [WARN] KEY PROPS: List-rendered components MUST have stable, unique `key` props. Never use array index as key for dynamic lists. Use item ID or unique hash.
- [WARN] ACCESSIBILITY: All interactive elements need keyboard handlers. Images need `alt` text. Form inputs need labels. Color alone never conveys information. ARIA roles where semantic HTML insufficient.
- [WARN] EFFECT DEPENDENCIES: `useEffect`/`watch` dependency arrays must include all referenced variables. Missing deps cause stale closures. Use ESLint exhaustive-deps rule.
- [STRICT] STATE MANAGEMENT: Derived state computed from existing state, never duplicated. Single source of truth per data entity. No prop drilling beyond 2 levels — use context or state management.
- [STRICT] PERFORMANCE: No inline object/function creation in render paths unless memoized. Virtualize lists over 100 items. Lazy-load routes and heavy components. Measure with React DevTools Profiler.
- [STRICT] INPUT VALIDATION: Client-side validation is UX, not security. Never trust client input server-side. Sanitize before display AND before API submission. Validate file uploads (type + size).
- [STRICT] ERROR BOUNDARIES: Production apps need Error Boundaries around route-level and feature-level components. Show fallback UI, report errors to monitoring. Never white-screen.
- [CRITICAL] AUTH STATE: Authentication tokens stored in httpOnly cookies, never localStorage for production. CSRF protection on state-mutating endpoints. Token refresh logic handles race conditions.
- [CRITICAL] SSR HYDRATION: Server-rendered content must match client initial render. No browser-only APIs in SSR paths. Use dynamic imports with `ssr: false` for client-only components.
