## Book Generation Domain Rules

- [WARN] TABLE OF CONTENTS: Every chapter and section must be registered in TOC/SUMMARY file. Orphan sections break navigation and reader flow. Update TOC immediately when adding new sections.
- [WARN] CROSS REFERENCES: All "See Chapter N" or internal links must point to existing sections. Verify cross-references after reorganization. Use relative links, not hardcoded page numbers.
- [WARN] HEADING HIERARCHY: Never skip heading levels (H1 → H3 without H2). Maintain consistent depth across chapters. Maximum 4 levels deep. Each chapter starts at same heading level.
- [WARN] CONSISTENT STYLE: Maintain consistent voice, tense, and formatting across chapters. Code examples use same language conventions throughout. Terminology defined once, reused consistently.
- [STRICT] CODE EXAMPLES: All code examples must be tested/runnable. Version-pin dependencies in examples. Include expected output. Mark language in fenced code blocks. No syntax errors in published code.
- [STRICT] CHAPTER DEPENDENCIES: Document prerequisite knowledge per chapter. Linear books: each chapter builds on previous. Reference books: chapters standalone. Never assume knowledge from later chapters.
- [STRICT] CONTENT COMPLETENESS: No TODO, FIXME, or placeholder content in published sections. Every section has introduction, body, and summary/transition. Minimum word count per section for substance.
- [STRICT] MEDIA ASSETS: All referenced images, diagrams, and files must exist at specified paths. Use relative paths. Include alt-text for accessibility. Diagrams as source (Mermaid, PlantUML) when possible.
- [CRITICAL] VERSIONING: Major content changes need version bump. Document what changed between versions. Provide migration guide for technical books with API changes. Archive previous versions.
- [CRITICAL] LICENSING: Clearly state content license. Attribute all third-party content (code, images, quotes). Get permission for substantial excerpts. Open-source code examples separately from prose.
