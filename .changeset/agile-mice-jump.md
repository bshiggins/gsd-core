---
type: Fixed
pr: 5306
---
**A refused symlinked install destination no longer leaves a half-replaced install** — the installer preflights the gsd-core root, guarded layout artifact destinations, and Codex config, agent TOML, and hooks.json destinations before installation writes. Rejected upgrades preserve the previous install; nested corpus symlinks retain their existing replacement behavior. (#5179)
