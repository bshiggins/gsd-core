<!-- BEGIN:gsd-bracket-convention -->
**Phase-ID convention.** Bracket form `[{PROJECT}.{MM}] {phase}[.{sub}][-{plan}]`, e.g. `[GSD.02] 05.03-01`. No "Phase" word, no `vX.Y` version literal, no milestone emoji.
- Milestone = the bracket integer; the milestone boundary is where it increments (`[GSD.01]` -> `[GSD.02]`). Dots are phase-levels; the single hyphen is the plan.
- Headings: `### [GSD.02] 05: Name` (phase -- a phase number after the bracket) vs `## [GSD.02] Name` (milestone -- a name after the bracket). On disk: `GSD.02-05.03-slug/`.
- Full card + grammar: references/phase-id-convention.md.
<!-- END:gsd-bracket-convention -->

# DISCUSSION-LOG.md template — for discuss-phase git_commit step

> **Lazy-loaded.** Read this file only inside the `git_commit` step of
> `workflows/discuss-phase.md`, immediately before writing
> `${phase_dir}/${padded_phase}-DISCUSSION-LOG.md`.

## Purpose

Audit trail for human review (compliance, learning, retrospectives). NOT
consumed by downstream agents — those read CONTEXT.md only.

## Template body

```markdown
# Phase [X]: [Name] - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** [ISO date]
**Phase:** [phase number]-[phase name]
**Areas discussed:** [comma-separated list]

---

[For each gray area discussed:]

## [Area Name]

| Option | Description | Selected |
|--------|-------------|----------|
| [Option 1] | [Description from AskUserQuestion] | |
| [Option 2] | [Description] | ✓ |
| [Option 3] | [Description] | |

**User's choice:** [Selected option or free-text response]
**Notes:** [Any clarifications, follow-up context, or rationale the user provided]

---

[Repeat for each area]

## Claude's Discretion

[List areas where user said "you decide" or deferred to Claude]

## Deferred Ideas

[Ideas mentioned during discussion that were noted for future phases]
```
