## Research Paper Domain Rules

- [WARN] CITATION REQUIRED: Every factual claim, comparison to prior work, or SOTA reference needs a citation. "Recent work shows..." without `\cite{}` or `[N]` reference is unverifiable. Use citation managers (BibTeX, Zotero).
- [WARN] REPRODUCIBILITY: Report random seeds, hardware specs, library versions, and hyperparameters. Every experiment must be reproducible from the paper alone. Link to code repository when possible.
- [WARN] STATISTICAL RIGOR: Report mean ± standard deviation, confidence intervals, or error bars. Single-run results without variance are unreliable. Use at least 3 runs with different seeds for stochastic methods.
- [WARN] FIGURES QUALITY: All figures need descriptive captions, axis labels with units, legends for multi-line plots. Vector graphics (PDF/SVG) preferred over raster. Resolution minimum 300 DPI for raster.
- [STRICT] METHODOLOGY: Clearly state null hypothesis, experimental controls, dataset splits (train/val/test), and evaluation metrics. Ablation studies required for multi-component systems.
- [STRICT] DATASET DOCUMENTATION: Document dataset size, collection method, potential biases, preprocessing steps, and license. Use datasheets for datasets format. Report class distributions.
- [STRICT] BASELINE COMPARISON: Compare against published baselines with identical evaluation protocols. Report improvements with statistical significance tests (p-values, confidence intervals). Never cherry-pick metrics.
- [STRICT] LIMITATIONS: Every paper needs explicit limitations section. Acknowledge failure modes, dataset bias, computational cost, and scope boundaries. Overstating results violates scientific integrity.
- [CRITICAL] ETHICAL REVIEW: Research involving human subjects needs IRB/ethics board approval. Document consent process. Anonymize PII in published data. Dual-use risk assessment for adversarial methods.
- [CRITICAL] PLAGIARISM: All text must be original or properly quoted with attribution. Paraphrase with citation, never copy. Self-plagiarism of previously published work requires proper reference.
