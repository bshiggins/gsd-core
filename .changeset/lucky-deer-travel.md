---
type: Changed
pr: 5509
---

**Custom phase IDs resolve safely and consistently** — creation records the exact ID in `.phase-id`, preserving ownership through roadmap edits and archival. Lookups accept IDs and full directory basenames; lifecycle, init, progress and health readers share custom-aware identities and roadmap order. Markerless directories with one known owner remain supported; ambiguous mutations refuse with candidates and a marker repair path. (#5186)

`phase.add --id` now returns a usage error unless effective `phase_naming` is `custom`, because its previous behavior wrote an unresolvable directory. Custom writers reject unreadable IDs, IDs already carrying the project prefix, equivalent recorded/declared/batch IDs and writes that would claim markerless directories. Marked prefix pairs remain supported. Add-batch validates all directory components and containment before writing.

Legacy numeric families retain padding-tolerant removal and renumbering, including inserted decimal children. Smart-entry failure detection handles numeric phases in custom projects and continues past dangling symlinks in the phase tree.
