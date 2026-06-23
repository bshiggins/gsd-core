# Phase ID Convention

How GSD phase IDs are formatted on disk and in `ROADMAP.md`, controlled by
`phase_id_convention` in `.planning/config.json`. This is the canonical grammar;
the runtime helpers in `phase-id.cjs` (`parsePhaseId`/`renderPhaseId`/`toDir`) are
the implementation.

This doc describes what IS — the deployed grammar the runtime emits and parses.

---

## Conventions

`phase_id_convention` is one of three values (validated; `null`/absent ⇒ sequential):

| Convention | Checklist form | Detail header | Phase dir |
|---|---|---|---|
| `sequential` (null/absent fallback) | `- [ ] **Phase 1: Name**` | `### Phase 1: Name` | `01-name` |
| `milestone-prefixed` | `- [ ] **Phase 1-01: Name**` | `### Phase 1-01: Name` | `01-01-name` |
| `bracket` (new-project default) | `- [ ] **[CODE.MM] NN: Name**` | `### [CODE.MM] NN: Name` | `CODE.MM-NN-name` |

`CODE` is the `project_code`, `MM` the two-digit milestone, `NN` the two-digit
phase index within that milestone, `SS` an optional two-digit sub-phase.

## Bracket grammar

The bracket convention has two surface forms for one identity:

- **Display form** (ROADMAP headings, checklists, `Depends on`): `[CODE.MM] NN[.SS]`
  — e.g. `[CK.02] 01`, `[CK.02] 02.01`.
- **Directory / token form** (on disk; `extractPhaseToken` yields `NN[.SS]`):
  `CODE.MM-NN[.SS]-slug` — e.g. `CK.02-01-foundation`, `CK.02-02.01-hotfix`.

`parsePhaseId`/`renderPhaseId`/`toDir` round-trip between them: for any id,
`renderPhaseId(parsePhaseId(x)) === x`, and `parsePhaseId(toDir(id, slug))`
recovers the same `{project, milestone, phase, subphase}` tuple.

### READING-B — the milestone lives in the prefix

Under bracket, the milestone is the `MM` in the `[CODE.MM]` / `CODE.MM-` prefix —
NOT the leading integer of the phase token (that rule, READING-A, is for the
`milestone-prefixed` `M-NN` form). So `CK.02-05.03` is milestone **2**, phase 5,
sub 3: `getMilestoneFromPhaseId('CK.02-05.03', 'bracket') === 'v2.0'`, not `v5.0`.

### Sentinels

Milestone `MM` of `0` (backlog / `0.x`) or `999` (icebox) carries no real
milestone — these ranges are sentinel-exempt across validation and verify.

### project_code is part of the id (the deliberate exception)

For `sequential` and `milestone-prefixed`, `project_code` is a directory prefix
only and never appears in ROADMAP headings or checklists. **Bracket is the
exception:** the `[CODE.MM]` token IS the phase id, so the milestone-qualified
`project_code` appears in every bracket heading and checklist by design.

A bracket repo therefore REQUIRES a `project_code`; `config new-project` derives
one from the project directory basename when bracket is active and none is set
(GSD fallback).

## Examples

| Display | Directory | Milestone | Phase | Sub |
|---|---|---|---|---|
| `[GSD.01] 01` | `GSD.01-01-setup` | 1 | 01 | — |
| `[CK.02] 05` | `CK.02-05-dashboard` | 2 | 05 | — |
| `[CK.02] 05.03` | `CK.02-05.03-hotfix` | 2 | 05 | 03 |

## Implementation

- **Grammar:** `gsd-core/bin/lib/phase-id.cjs` — `parsePhaseId`, `renderPhaseId`,
  `toDir`, `extractPhaseToken`, `getMilestoneFromPhaseId`, `normalizePhaseName`.
- **Read tolerance:** `roadmap.cts` / `validate.cts` / `verify.cts` recognize
  bracket headings, dirs, and checklists via `PHASE_HEADING_PREFIX_SRC`.
- **Write path:** `phase.cts` (add / add-batch / insert), `config.cts`
  (new-project default + `deriveProjectCode`), `commands.cts` (progress / stats
  display), `roadmap.cts` (update-plan-progress).
- **Migration:** `roadmap-upgrade.cts` (`roadmap upgrade --convention bracket`).
- **Agent output:** `agents/gsd-roadmapper.md` emits the bracket form when the
  convention is active.
