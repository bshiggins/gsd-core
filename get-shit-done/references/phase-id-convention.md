<!-- BEGIN:gsd-bracket-convention -->
**Phase-ID convention (GSD runs on this everywhere).** Every phase reference — in ROADMAP
headings, banners, statuslines, agent labels, commits, handoffs, and all inter-agent
communication — uses the bracket form. There is **no "Phase" word**, **no `vX.Y` version
literal**, and **no milestone emoji**.

```
[GSD.02] 05.03-01
 │   │   │  │   │
 │   │   │  │   └── plan        01
 │   │   │  └────── subphase    03
 │   │   └───────── phase       05
 │   └───────────── milestone   02
 └───────────────── project     GSD
```

- **Bracket = `[{PROJECT}.{MM}]`** — project code + zero-padded milestone integer. The
  milestone **is** the bracket integer; the milestone boundary is where it increments
  (`[GSD.01]` → `[GSD.02]`).
- **Phase / subphase** = dot-joined (`05`, `05.03`). **Plan** = the single hyphen suffix
  (`-01`). Dots are always phase-levels; the one hyphen is always the plan.
- **Headings:** `### [GSD.02] 05.03: Name` (phase — bracket **followed by a phase
  number**) vs `## [GSD.02] Name` (milestone section — bracket **followed by a
  name**, no phase number, no version, no emoji). The discriminator is the phase
  number after the bracket, not the bracket itself — `[GSD.02]` appears on both.
  On disk: `GSD.02-05.03-slug/`.
- When you emit or reference a phase, use this form. When you read one, parse it this way.
<!-- END:gsd-bracket-convention -->

# Phase-ID Convention — Canonical Reference

This is the canonical reference for the GSD bracket phase-ID convention. The compact card
above is the single source injected into every agent and workflow; this doc expands it with
the full grammar, heading forms, on-disk encoding, the argument contract, and what the
bracket convention replaced.

## The card

A phase identity has **three numeric dimensions and two separators**:

```
[GSD.02] 05.03-01
 │   │   │  │   └── plan      (one hyphen — only ever the plan)
 │   │   │  └────── subphase  (dot, optional)
 │   │   └───────── phase     (zero-padded integer)
 │   └───────────── milestone (dot-joined INTO the bracket)
 └───────────────── project   (uppercase alpha code)
```

The milestone is **lifted out of the phase token** into `[project.milestone]`. The phase
token therefore carries only phase-levels (dots) and one plan (one hyphen). Dots are always
phase-levels; the single hyphen is always the plan. There is **no "Phase" word** on any
human surface.

## Grammar

| Segment | Format | Example |
|---|---|---|
| Project | Uppercase alpha code `[A-Z]{1,6}` | `GSD`, `CK` |
| Milestone | Zero-padded integer, dot-joined into the bracket / dir prefix | `.02` in `[GSD.02]`, `GSD.02-` |
| Phase | Zero-padded integer | `05` |
| Subphase | Optional `.NN` (genuine decomposition) | `.03` |
| Plan | One hyphen + zero-padded integer (filename only) | `-01` |

Phase-path regex (the phase token, after stripping the bracket/prefix): `\d+[A-Z]?(\.\d+)*`.
**The milestone is never inside the phase token.**

## Heading forms

GSD uses one bracket form `[{PROJECT}.{MM}]` on both phase and milestone-section headings.
The discriminator is **what follows the bracket**, not the bracket itself:

- **Phase heading** — bracket **followed by a phase number** (then `:` then name):

  ```markdown
  ### [GSD.02] 05: Name
  ### [GSD.02] 05.03: Name
  ```

  Pattern: `### [{PROJECT}.{MM}] {NN}[.{SS}]: Name`. Zero-padded.

- **Milestone-section heading** — bracket **followed by a name** (no phase number, no
  version literal, no emoji):

  ```markdown
  ## [GSD.02] Foundation
  ```

  Pattern: `## [{PROJECT}.{MM}] Name`. The milestone integer rides in the bracket on the
  section heading too. The milestone boundary is where the bracket integer increments
  (`## [GSD.02]` → `## [GSD.03]`).

Edge case: a milestone name that begins with a digit (`## [GSD.02] 2024 Plan`) must not
parse as a phase. The phase signal is `{NN}[.{SS}]:` — a phase number **followed by a
colon**. Milestone names have no such `NN:` pattern.

Phases renumber freely **within** a milestone — there is no global "never restart at 01"
rule. A new milestone restarts phase numbering.

## On-disk encoding

A phase directory encodes project, milestone, phase (with optional subphase), and slug —
but **not** the plan (the plan lives in the filename):

```
{PROJECT}.{MM}-{NN}[.{SS}]-slug/
```

- `GSD.02-05-some-feature/` — project `GSD`, milestone `02`, phase `05`.
- `GSD.02-05.03-some-feature/` — same, subphase `03`.

The dot joins project↔milestone; the single hyphen joins the milestone prefix↔phase token;
dots within the phase token are subphase levels. There are **no brackets on disk**.

Plan and summary files live **inside** the phase dir and carry the phase[.subphase] + plan,
but **not** the milestone (the milestone is already in the dir prefix):

```
{NN}[.{SS}]-{plan}-PLAN.md       e.g.  05.03-01-PLAN.md
{NN}[.{SS}]-{plan}-SUMMARY.md
```

The `{phase}-{plan}` token in plan filenames, commit scopes (`feat({phase}-{plan}): …`),
threat-model IDs (`T-{phase}-NN`), and `depends_on` plan references is **bracket-preserved**
— it does not gain a milestone prefix and must not be rewritten when adopting bracket. The
milestone lives only in the bracket and the dir prefix.

## The argument contract (D-IDENT)

A command that takes a phase argument resolves it as follows:

- **Bare phase** `04` or `4` — resolves against the active milestone (from `STATE.md
  milestone:`). Zero-padding-tolerant: `4` and `04` resolve the same phase.
- **Milestone-qualified** `GSD.02-04` (or `GSD.02-04.02` for a subphase) — resolves the
  phase in milestone `02` explicitly, including archived milestones.
- **Bare `NN-NN`** (e.g. `02-04`) — **rejected** with an explicit disambiguation error.
  This form is ambiguous (milestone-qualified vs phase-plan) and must never silently
  mis-resolve. Use the bare active-milestone phase (`04`) or the milestone-qualified id
  (`GSD.02-04`).

See `phase-argument-parsing.md` for the parsing detail.

## What is gone

The bracket convention **replaces** the older surfaces. Do not emit or key on:

- The **`vX.Y` version literal** as a milestone identity marker (`### Phase 5:` under
  `## 🚧 v1.1 …`). Milestone identity is the bracket integer.
- The **milestone status emoji** (✅/🚧/📋/🟡) as a milestone marker.
- The literal **"Phase" word** on any human-facing surface.
- The decimal-insertion idiom (`Phase 2.1 (INSERTED)` for urgent work). Subphases (`.NN`)
  are now **genuine decomposition**, not an urgent-insertion hack.

Legacy (`### Phase N:`) and M-NN (`### [GSD] Phase 2-01:`) repos are read tolerantly during
the migration window and converted on disk exactly once by the `roadmap upgrade` migrator.
