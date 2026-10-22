---
type: Fixed
pr: 5509
---

**Custom phase IDs resolve safely and consistently** — custom creation records the exact ID in `.phase-id`, so ownership survives roadmap edits and archival. Lookups, lifecycle commands, progress and health share custom-aware identities and effective project naming. Destructive operations refuse ambiguous markerless owners, and writers reject custom IDs when project naming is not custom, including shadowed global defaults. (#5186)
