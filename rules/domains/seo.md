## SEO Domain Rules

- [WARN] META TAGS: Every page must have unique `<title>` (50-60 chars) and `<meta name="description">` (150-160 chars). No duplicate titles across pages.
- [WARN] OPEN GRAPH: Include `og:title`, `og:description`, `og:image`, and `og:url` meta tags on all public pages. Twitter Card meta tags for X sharing. Test with social preview tools.
- [WARN] HEADING HIERARCHY: Use a single `<h1>` per page that matches the page topic. Headings must follow hierarchical order (h1 > h2 > h3). Never skip heading levels for styling.
- [WARN] IMAGE OPTIMIZATION: Serve images in modern formats (WebP/AVIF) with responsive `srcset`. Include `width` and `height` attributes to prevent layout shift. Lazy-load below-fold images.
- [STRICT] CANONICAL URLS: Every page must have a `<link rel="canonical">` pointing to the preferred URL. Prevent duplicate content issues across www/non-www, http/https, and trailing slashes.
- [STRICT] STRUCTURED DATA: Add JSON-LD structured data (Schema.org) for content type (Article, Product, FAQ, BreadcrumbList). Validate with Google Rich Results Test. No invalid markup.
- [STRICT] ROBOTS CONFIGURATION: Maintain `robots.txt` with accurate crawl rules. Use `<meta name="robots">` for page-level control. Never accidentally noindex production pages.
- [CRITICAL] CORE WEB VITALS: Meet Google Core Web Vitals thresholds — LCP < 2.5s, INP < 200ms, CLS < 0.1. Monitor in production with RUM. Fix regressions before deployment.
- [CRITICAL] SITEMAP: Generate and maintain an XML sitemap with all indexable URLs. Submit to Google Search Console. Update sitemap on content changes. Exclude noindex pages.
