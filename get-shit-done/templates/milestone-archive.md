# Milestone Archive Template

This template is used by the complete-milestone workflow to create archive files in `.planning/milestones/`.

---

## File Template

# Milestone [{{PROJECT}}.{{MM}}]: {{MILESTONE_NAME}}

**Status:** SHIPPED {{DATE}}
**Phases:** {{PHASE_START}}-{{PHASE_END}}
**Total Plans:** {{TOTAL_PLANS}}

## Overview

{{MILESTONE_DESCRIPTION}}

## Phases

{{PHASES_SECTION}}

[For each phase in this milestone, include:]

### [{{PROJECT}}.{{MM}}] {{PHASE_NUM}}: {{PHASE_NAME}}

**Goal**: {{PHASE_GOAL}}
**Depends on:** [{{PROJECT}}.{{MM}}] {{DEPENDS_ON}}
**Plans**: {{PLAN_COUNT}} plans

Plans:

- [x] {{PHASE}}-01: {{PLAN_DESCRIPTION}}
- [x] {{PHASE}}-02: {{PLAN_DESCRIPTION}}
      [... all plans ...]

**Details:**
{{PHASE_DETAILS_FROM_ROADMAP}}

**For a subphase (genuine decomposition `.SS` of a phase):**

### [{{PROJECT}}.{{MM}}] 02.01: Auth Hardening

**Goal**: Harden the authentication path split out of phase 02
**Depends on:** [{{PROJECT}}.{{MM}}] 02
**Plans**: 1 plan

Plans:

- [x] 02.01-01: Patch auth vulnerability

**Details:**
{{PHASE_DETAILS_FROM_ROADMAP}}

---

## Milestone Summary

**Key Decisions:**
{{DECISIONS_FROM_PROJECT_STATE}}
[Example:]

- Decision: Use ROADMAP.md split (Rationale: Constant context cost)
- Decision: Subphase decomposition `.SS` (Rationale: Parallel-plannable slices)

**Issues Resolved:**
{{ISSUES_RESOLVED_DURING_MILESTONE}}
[Example:]

- Fixed context overflow at 100+ phases
- Resolved phase insertion confusion

**Issues Deferred:**
{{ISSUES_DEFERRED_TO_LATER}}
[Example:]

- PROJECT-STATE.md tiering (deferred until decisions > 300)

**Technical Debt Incurred:**
{{SHORTCUTS_NEEDING_FUTURE_WORK}}
[Example:]

- Some workflows still have hardcoded paths (fix in Phase 5)

---

_For current project status, see .planning/ROADMAP.md_

---

## Usage Guidelines

<guidelines>
**When to create milestone archives:**
- After completing all phases in a milestone (v1.0, v1.1, v2.0, etc.)
- Triggered by complete-milestone workflow
- Before planning next milestone work

**How to fill template:**

- Replace {{PLACEHOLDERS}} with actual values
- Extract phase details from ROADMAP.md
- Document subphases (`.SS`) as genuine decomposition of their parent phase
- Include key decisions from PROJECT-STATE.md or SUMMARY files
- List issues resolved vs deferred
- Capture technical debt for future reference

**Archive location:**

- Save to `.planning/milestones/v{VERSION}-{NAME}.md`
- Example: `.planning/milestones/v1.0-mvp.md`

**After archiving:**

- Update ROADMAP.md to collapse completed milestone in `<details>` tag
- Update PROJECT.md to brownfield format with Current State section
- Phase numbering restarts at `01` in the next milestone (the bracket integer
  `[{PROJECT}.{MM}]` disambiguates phases across milestones)
  </guidelines>
