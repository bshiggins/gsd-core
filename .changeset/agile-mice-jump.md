---
type: Fixed
pr: 5306
---
**A refused symlinked install destination no longer leaves a half-replaced install** — the installer preflights the gsd-core root, guarded layout artifact destinations, and Codex config and agent TOML destinations before installation writes. Already-migrated Codex installs also preflight hooks.json when the projected config enables hook reconciliation; pending migrations retain the reconciler’s existing check because they can replace the destination or change config inputs. Rejected upgrades preserve the previous install; nested corpus symlinks retain their existing replacement behavior. (#5179)
