# Phase Argument Parsing

Parse and normalize phase arguments for commands that operate on phases.

See `phase-id-convention.md` for the full bracket grammar.

## The argument contract (D-IDENT)

A phase argument resolves to exactly one of:

- **Bare phase** `04` or `4` — resolves against the **active milestone** (from `STATE.md
  milestone:`). Zero-padding-tolerant: `4` and `04` resolve the same phase. Subphases work
  the same way (`4.2` / `04.02`).
- **Milestone-qualified** `GSD.02-04` (or `GSD.02-04.02`) — resolves the phase in
  milestone `02` explicitly, including archived milestones.
- **Bare `NN-NN`** (e.g. `02-04`) — **REJECTED** with an explicit disambiguation error. This
  hyphenated form is ambiguous (is it milestone `02` phase `04`, or phase `02` plan `04`?)
  and must **never silently mis-resolve**. Tell the user to use the bare active-milestone
  phase (`04`) or the milestone-qualified id (`GSD.02-04`).

`gsd-tools` enforces this contract; do not re-implement parsing inline.

## Extraction

From `$ARGUMENTS`:
- Extract phase number (first phase argument — bare `04`/`4` or qualified `GSD.02-04`)
- Extract flags (prefixed with `--`)
- Remaining text is description (for insert/add commands)

## Using gsd-tools

The `find-phase` command handles normalization and validation in one step:

```bash
PHASE_INFO=$(gsd-tools query find-phase "${PHASE}")
```

Returns JSON with:
- `found`: true/false
- `directory`: Full path to phase directory
- `phase_number`: Normalized number (e.g., "06", "06.1")
- `phase_name`: Name portion (e.g., "foundation")
- `plans`: Array of PLAN.md files
- `summaries`: Array of SUMMARY.md files

## Manual Normalization (Legacy)

Zero-pad integer phases to 2 digits. Preserve decimal suffixes.

```bash
# Normalize phase number
if [[ "$PHASE" =~ ^[0-9]+$ ]]; then
  # Integer: 8 → 08
  PHASE=$(printf "%02d" "$PHASE")
elif [[ "$PHASE" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
  # Decimal: 2.1 → 02.1
  PHASE=$(printf "%02d.%s" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
fi
```

## Validation

Use `roadmap get-phase` to validate phase exists:

```bash
PHASE_CHECK=$(gsd-tools query roadmap.get-phase "${PHASE}" --pick found)
if [ "$PHASE_CHECK" = "false" ]; then
  echo "ERROR: Phase ${PHASE} not found in roadmap"
  exit 1
fi
```

## Directory Lookup

Use `find-phase` for directory lookup:

```bash
PHASE_DIR=$(gsd-tools query find-phase "${PHASE}" --raw)
```
