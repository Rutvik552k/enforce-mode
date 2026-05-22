## Model Training Domain Rules

- [WARN] LEARNING RATE: Validate learning rate before training starts. Use LR finder/warmup schedule. Document LR choice rationale. Common ranges: 1e-5 to 1e-3 for fine-tuning, 1e-4 to 1e-2 for training from scratch.
- [WARN] DATA SPLIT: Never train on test data. Use proper train/validation/test splits (typical: 80/10/10 or 70/15/15). For small datasets, use k-fold cross-validation. Document split strategy.
- [WARN] CHECKPOINTING: Save checkpoints at regular intervals (every N steps or epochs). Keep best model by validation metric. Implement checkpoint resume for interrupted training. Version checkpoints.
- [WARN] LOGGING: Log loss curves, learning rate, gradient norms, and evaluation metrics to experiment tracker (wandb, mlflow, tensorboard). Monitor for divergence, loss spikes, and plateau.
- [STRICT] OVERFITTING DETECTION: Monitor train vs validation loss gap. Implement early stopping with patience. Use regularization (dropout, weight decay, data augmentation) proportional to model capacity vs data size.
- [STRICT] GRADIENT HEALTH: Monitor gradient norms. Clip gradients (max_norm=1.0 typical). Detect NaN/Inf in loss or gradients. Use mixed precision carefully (loss scaling required for FP16).
- [STRICT] DATA VALIDATION: Validate dataset before training: check for NaN/null values, class imbalance ratio, corrupt samples, encoding issues. Report dataset statistics. Handle edge cases (empty inputs, max-length sequences).
- [STRICT] RESOURCE BUDGET: Estimate training cost (GPU hours × cost/hr) before starting. Set maximum epoch/step limits. Use smaller model or subset for hyperparameter search. Document total compute used.
- [CRITICAL] EVALUATION PROTOCOL: Final model evaluation on held-out test set ONCE. Multiple test evaluations inflate reported performance. Use validation set for all intermediate decisions.
- [CRITICAL] MODEL CARD: Document model capabilities, limitations, training data sources, intended use cases, and known biases. Report performance across demographic subgroups when applicable.
