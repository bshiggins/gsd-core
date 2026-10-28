---
type: Fixed
pr: 5306
---
**A refused symlinked install destination no longer leaves a half-replaced install** — the installer preflights the gsd-core root, guarded layout artifact destinations, legacy dev-preferences migration destinations, and Codex config and agent TOML destinations before installation writes. Codex installs also preflight hooks.json when the projected config enables hook reconciliation; only planned mutations of hooks.json or config.toml defer that check to the reconciler, so unrelated pending migrations and a missing install-state file no longer bypass it. Rejected upgrades preserve the previous install; nested corpus symlinks retain their existing replacement behavior. Artifact plan builders and writers share the config-dir fallback for an empty home, the committed surface resolves before the gsd-core refresh, and orphan recovery runs after destination preflight. (#5179)
