# Subphase Calculation

Calculate the next **subphase** number for a phase. A subphase (`.NN`) is genuine
decomposition of a phase — breaking phase `06` into `06.1`, `06.2` — not an "urgent
insertion" hack. See `phase-id-convention.md` for the bracket grammar.

> The `gsd-tools query phase.next-decimal` command name is a code surface and is unchanged;
> only the conceptual framing (subphase, not insertion) is updated here.

## Using gsd-tools

```bash
# Get next subphase after phase 6
gsd-tools query phase.next-decimal 6
```

Output:
```json
{
  "found": true,
  "base_phase": "06",
  "next": "06.1",
  "existing": []
}
```

With existing decimals:
```json
{
  "found": true,
  "base_phase": "06",
  "next": "06.3",
  "existing": ["06.1", "06.2"]
}
```

## Extract Values

```bash
SUBPHASE=$(gsd-tools query phase.next-decimal "${AFTER_PHASE}" --pick next)
BASE_PHASE=$(gsd-tools query phase.next-decimal "${AFTER_PHASE}" --pick base_phase)
```

Or with --raw flag:
```bash
SUBPHASE=$(gsd-tools query phase.next-decimal "${AFTER_PHASE}" --raw)
# Returns just: 06.1
```

## Examples

| Existing Phases | Next Subphase |
|-----------------|---------------|
| 06 only | 06.1 |
| 06, 06.1 | 06.2 |
| 06, 06.1, 06.2 | 06.3 |
| 06, 06.1, 06.3 (gap) | 06.4 |

## Directory Naming

Subphase directories use the bracket on-disk encoding: project + milestone prefix, then the
full phase token (`{NN}.{SS}`), then the slug. Build the dir through `gsd-tools` so the
`{PROJECT}.{MM}-` prefix is sourced from `STATE.md milestone:`; do not hand-assemble it:

```bash
SLUG=$(gsd-tools query generate-slug "$DESCRIPTION" --raw)
# Resolved form: .planning/phases/{PROJECT}.{MM}-{NN}.{SS}-{slug}/
```

Example: `.planning/phases/GSD.02-06.1-fix-critical-auth-bug/` (project `GSD`, milestone
`02`, phase `06`, subphase `1`).
