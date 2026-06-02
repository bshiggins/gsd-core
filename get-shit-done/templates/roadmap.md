# Roadmap Template

Template for `.planning/ROADMAP.md`.

Phase identity uses the **bracket convention**: `[{PROJECT}.{MM}]` (project code +
zero-padded milestone integer), then a zero-padded phase number, then optional
`.SS` subphase. There is **no "Phase" word**, no `vX.Y` version literal, and no
milestone emoji on any heading. On disk: `{PROJECT}.{MM}-{NN}[.{SS}]-slug/`.

## Initial Roadmap (First Milestone)

```markdown
# Roadmap: [Project Name]

## Overview

[One paragraph describing the journey from start to finish]

## Phases

**Phase Numbering:**
- Phases are zero-padded integers within a milestone (`01`, `02`, `03`).
- Subphases (`02.01`, `02.02`) are genuine decomposition of a phase into
  parallel/sequential parts — NOT urgent insertions. They appear under their
  parent phase in numeric order.
- Phase numbers restart at `01` in each new milestone (the milestone integer in
  the bracket disambiguates: `[GSD.01] 01` vs `[GSD.02] 01`).

- [ ] **[GSD.01] 01: [Name]** - [One-line description]
- [ ] **[GSD.01] 02: [Name]** - [One-line description]
- [ ] **[GSD.01] 03: [Name]** - [One-line description]
- [ ] **[GSD.01] 04: [Name]** - [One-line description]

## Phase Details

### [GSD.01] 01: [Name]
**Goal**: [What this phase delivers]
**Depends on**: Nothing (first phase)
**Requirements**: [REQ-01, REQ-02, REQ-03]  <!-- brackets optional, parser handles both formats -->
**Success Criteria** (what must be TRUE):
  1. [Observable behavior from user perspective]
  2. [Observable behavior from user perspective]
  3. [Observable behavior from user perspective]
**Plans**: [Number of plans, e.g., "3 plans" or "TBD"]

Plans:
- [ ] 01-01: [Brief description of first plan]
- [ ] 01-02: [Brief description of second plan]
- [ ] 01-03: [Brief description of third plan]

### [GSD.01] 02: [Name]
**Goal**: [What this phase delivers]
**Depends on:** [GSD.01] 01
**Requirements**: [REQ-04, REQ-05]
**Success Criteria** (what must be TRUE):
  1. [Observable behavior from user perspective]
  2. [Observable behavior from user perspective]
**Plans**: [Number of plans]

Plans:
- [ ] 02-01: [Brief description]
- [ ] 02-02: [Brief description]

### [GSD.01] 02.01: [Name]
**Goal**: [A genuine decomposition of phase 02 — a coherent sub-slice planned and
executed on its own. Use a subphase when one phase splits into independently
plannable parts, NOT for urgent fixes.]
**Depends on:** [GSD.01] 02
**Success Criteria** (what must be TRUE):
  1. [What this sub-slice achieves]
**Plans**: 1 plan

Plans:
- [ ] 02.01-01: [Description]

### [GSD.01] 03: [Name]
**Goal**: [What this phase delivers]
**Depends on:** [GSD.01] 02
**Requirements**: [REQ-06, REQ-07, REQ-08]
**Success Criteria** (what must be TRUE):
  1. [Observable behavior from user perspective]
  2. [Observable behavior from user perspective]
  3. [Observable behavior from user perspective]
**Plans**: [Number of plans]

Plans:
- [ ] 03-01: [Brief description]
- [ ] 03-02: [Brief description]

### [GSD.01] 04: [Name]
**Goal**: [What this phase delivers]
**Depends on:** [GSD.01] 03
**Requirements**: [REQ-09, REQ-10]
**Success Criteria** (what must be TRUE):
  1. [Observable behavior from user perspective]
  2. [Observable behavior from user perspective]
**Plans**: [Number of plans]

Plans:
- [ ] 04-01: [Brief description]

## Progress

**Execution Order:**
Phases execute in numeric order within a milestone: 01 → 02 → 02.01 → 03 → 04

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| [GSD.01] 01: [Name] | 0/3 | Not started | - |
| [GSD.01] 02: [Name] | 0/2 | Not started | - |
| [GSD.01] 02.01: [Name] | 0/1 | Not started | - |
| [GSD.01] 03: [Name] | 0/2 | Not started | - |
| [GSD.01] 04: [Name] | 0/1 | Not started | - |
```

<guidelines>
**Initial planning (first milestone):**
- Phase count depends on granularity setting (coarse: 3-5, standard: 5-8, fine: 8-12)
- Each phase delivers something coherent
- Phases can have 1+ plans (split if >3 tasks or multiple subsystems)
- Plans use naming: {phase}[.{subphase}]-{plan}-PLAN.md (e.g., 01-02-PLAN.md, 02.01-01-PLAN.md)
  — the milestone lives in the directory prefix, NOT the plan filename
- No time estimates (this isn't enterprise PM)
- Progress table updated by execute workflow
- Plan count can be "TBD" initially, refined during planning

**Success criteria:**
- 2-5 observable behaviors per phase (from user's perspective)
- Cross-checked against requirements during roadmap creation
- Flow downstream to `must_haves` in plan-phase
- Verified by verify-phase after execution
- Format: "User can [action]" or "[Thing] works/exists"

**After milestones ship:**
- Collapse completed milestones in `<details>` tags
- Add new milestone sections for upcoming work
- Phase numbers restart at `01` in each new milestone — the milestone integer in
  the bracket (`[GSD.02]`) keeps them unambiguous
</guidelines>

<status_values>
- `Not started` - Haven't begun
- `In progress` - Currently working
- `Complete` - Done (add completion date)
- `Deferred` - Pushed to later (with reason)
</status_values>

## Milestone-Grouped Roadmap (After First Milestone Ships)

After completing the first milestone, reorganize with milestone groupings. Each
milestone section heading is `## [{PROJECT}.{MM}] [Name]` — the milestone integer
rides in the bracket; no version literal, no emoji.

```markdown
# Roadmap: [Project Name]

## Milestones

- **[GSD.01] MVP** - phases 01-04 (shipped YYYY-MM-DD)
- **[GSD.02] [Name]** - phases 01-02 (in progress)
- **[GSD.03] [Name]** - phases 01-04 (planned)

## Phases

<details>
<summary>[GSD.01] MVP (phases 01-04) - SHIPPED YYYY-MM-DD</summary>

### [GSD.01] 01: [Name]
**Goal**: [What this phase delivers]
**Plans**: 3 plans

Plans:
- [x] 01-01: [Brief description]
- [x] 01-02: [Brief description]
- [x] 01-03: [Brief description]

[... remaining milestone 01 phases ...]

</details>

## [GSD.02] [Name]

**Milestone Goal:** [What this milestone delivers]

### [GSD.02] 01: [Name]
**Goal**: [What this phase delivers]
**Depends on:** [GSD.01] 04
**Plans**: 2 plans

Plans:
- [ ] 01-01: [Brief description]
- [ ] 01-02: [Brief description]

[... remaining milestone 02 phases ...]

## [GSD.03] [Name]

**Milestone Goal:** [What this milestone delivers]

[... milestone 03 phases ...]

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| [GSD.01] 01: Foundation | 3/3 | Complete | YYYY-MM-DD |
| [GSD.01] 02: Features | 2/2 | Complete | YYYY-MM-DD |
| [GSD.02] 01: Security | 0/2 | Not started | - |
```

**Notes:**
- Milestone section heading = `## [{PROJECT}.{MM}] [Name]` (bracket + name, no
  phase number after the bracket — that's the milestone-vs-phase discriminator)
- Phase heading = `### [{PROJECT}.{MM}] {NN}: [Name]` (bracket followed by a phase
  number then a colon)
- Completed milestones collapsed in `<details>` for readability
- Current/future milestones expanded
- Phase numbers restart at `01` each milestone; the bracket integer disambiguates
- The single Progress table's Phase cell carries the full bracket label, so no
  separate milestone column is needed
