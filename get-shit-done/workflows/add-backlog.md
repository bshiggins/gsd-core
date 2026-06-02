<!-- BEGIN:gsd-bracket-convention -->
**Phase-ID convention.** Bracket form `[{PROJECT}.{MM}] {phase}[.{sub}][-{plan}]`, e.g. `[GSD.02] 05.03-01`. No "Phase" word, no `vX.Y` version literal, no milestone emoji.
- Milestone = the bracket integer; the milestone boundary is where it increments (`[GSD.01]` -> `[GSD.02]`). Dots are phase-levels; the single hyphen is the plan.
- Headings: `### [GSD.02] 05: Name` (phase -- a phase number after the bracket) vs `## [GSD.02] Name` (milestone -- a name after the bracket). On disk: `GSD.02-05.03-slug/`.
- Full card + grammar: references/phase-id-convention.md.
<!-- END:gsd-bracket-convention -->

# Add Backlog Item Workflow

Invoked by `/gsd:capture --backlog` (`commands/gsd/capture.md`).

Adds an idea to the ROADMAP.md backlog parking lot using 999.x numbering. Backlog items
are unsequenced ideas that aren't ready for active planning — they live outside the normal
phase sequence and accumulate context over time.

<process>

## Step 1: Read ROADMAP.md

Check for existing backlog entries:

```bash
cat .planning/ROADMAP.md
```

## Step 2: Find next backlog number

```bash
_GSD_SHIM_NAME="gsd-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/get-shit-done/bin/${_GSD_SHIM_NAME}"; if [ -f "$GSD_TOOLS" ]; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${_GSD_RUNTIME_ROOT}/.claude/get-shit-done/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.claude/get-shit-done/bin/${_GSD_SHIM_NAME}"; gsd_run() { node "$GSD_TOOLS" "$@"; }; elif command -v gsd-tools >/dev/null 2>&1; then GSD_TOOLS="$(command -v gsd-tools)"; gsd_run() { "$GSD_TOOLS" "$@"; }; elif [ -f "$HOME/.claude/get-shit-done/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="$HOME/.claude/get-shit-done/bin/${_GSD_SHIM_NAME}"; gsd_run() { node "$GSD_TOOLS" "$@"; }; else echo "ERROR: gsd-tools.cjs not found at $GSD_TOOLS and gsd-tools is not on PATH. Run: npx -y @opengsd/gsd-core@latest --claude --local" >&2; exit 1; fi
NEXT=$(gsd_run query phase.next-decimal 999 --raw)
```

If no 999.x phases exist yet, `phase.next-decimal` returns `999.1`. Sparse numbering
is fine (e.g. 999.1, 999.3) — always use `phase.next-decimal`, never guess.

## Step 3: Write ROADMAP entry

**Write the ROADMAP entry BEFORE creating the directory.** Directory existence is a
reliable indicator that the phase is already registered, which prevents false duplicate
detection in any hook that checks for existing 999.x directories (#2280).

Add under a `## Backlog` section. If the section doesn't exist, create it at the end
of ROADMAP.md:

```markdown
## Backlog

### Phase {NEXT}: {description} (BACKLOG)

**Goal:** [Captured for future planning]
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
```

## Step 4: Create the phase directory

Route directory creation through the CLI (`scaffold phase-dir`) so the backlog
directory is produced by the same centralized, convention-aware code path as
`phase.add`/`phase.insert` — rather than fabricating the dir name in bash. The
CLI applies the `project_code` prefix when set (e.g. `GSD-999.1-slug`) and omits
it on legacy/code-less repos (`999.1-slug`); backlog phases are milestone-less
sentinels (`999.x`), so the prefix is the project-only single-hyphen form under
both bracket and legacy conventions. The sentinel ROADMAP heading written in
Step 3 stays in the legacy `### Phase 999.1:` form (milestone-less,
convention-independent).

```bash
SCAFFOLD=$(gsd_run query scaffold phase-dir --phase "${NEXT}" --name "$ARGUMENTS")
PHASE_DIR=$(printf '%s' "$SCAFFOLD" | grep -o '"directory": *"[^"]*"' | head -1 | sed 's/.*"directory": *"//;s/"$//')
# scaffold creates the dir but not the placeholder file — add it so the empty
# backlog phase is git-trackable.
touch "${PHASE_DIR}/.gitkeep"
```

## Step 5: Commit

```bash
gsd_run query commit "docs: add backlog item ${NEXT} — ${ARGUMENTS}" --files .planning/ROADMAP.md "${PHASE_DIR}/.gitkeep"
```

## Step 6: Report

```
## 📋 Backlog Item Added

Phase {NEXT}: {description}
Directory: {PHASE_DIR}/

This item lives in the backlog parking lot.
Use /gsd:discuss-phase {NEXT} to explore it further.
Use /gsd:review-backlog to promote items to active milestone.
```

</process>

<notes>
- 999.x numbering keeps backlog items out of the active phase sequence
- Phase directories are created immediately so /gsd:discuss-phase and /gsd:plan-phase work on them
- No `Depends on:` field — backlog items are unsequenced by definition
- Sparse numbering is fine (999.1, 999.3) — always uses next-decimal
- Promote backlog items to the active milestone with /gsd:review-backlog
</notes>
