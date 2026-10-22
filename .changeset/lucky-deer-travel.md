---
type: Fixed
pr: 5509
---

**Custom phase IDs resolve safely and consistently** — custom creation records the exact ID in `.phase-id`, so ownership survives roadmap edits and archival. Lookups, lifecycle commands, progress and health share custom-aware identities and effective project naming. Destructive operations refuse ambiguous markerless owners, and phase removal preserves surviving custom IDs without renumbering them. (#5186)

`phase.add --id` now returns a usage error unless effective `phase_naming` is `custom`: its previous behavior wrote an unresolvable directory in other naming modes. Project config continues to shadow global defaults, and the usage error explains that case. Custom add, add-batch and scaffold share collision checks against recorded IDs, roadmap declarations, markerless directory owners and other IDs in the same batch. New custom IDs reject whitespace, colons and a leading bracket. Existing non-custom scaffold behavior remains available.

Unmarked legacy numeric phases retain padding-tolerant removal and renumbering in custom-naming projects. Recorded and known custom identities remain stable on disk and in the roadmap.
