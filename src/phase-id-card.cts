/**
 * Canonical bracket convention card (#3638 / ADR-612 PR-5).
 *
 * This module is the sole editable source of the compact grammar diagram.
 * Render sites import phaseIdCard(); generated documentation is held to the
 * same bytes by tests/phase-id-card.test.cjs. PR-6 can therefore inject the
 * card broadly without inventing another copy.
 */

const PHASE_ID_CARD = [
  '[GSD.02] 05.03-01',
  ' │   │   │  │   │',
  ' │   │   │  │   └── plan        01',
  ' │   │   │  └────── subphase    03',
  ' │   │   └───────── phase       05',
  ' │   └───────────── milestone   02',
  ' └───────────────── project     GSD',
].join('\n');

const PHASE_ID_LEGEND =
  "milestone = bracket integer; dots = phase-levels; one hyphen = plan; "
  + "no 'Phase' word, no vX.Y";

function phaseIdCard(options: { title?: string } = {}): string {
  const parts: string[] = [];
  if (options.title) parts.push(options.title, '');
  parts.push(PHASE_ID_CARD, '', PHASE_ID_LEGEND);
  return parts.join('\n');
}

function phaseIdConventionRules(): string {
  return [
    "## Phase ID convention",
    "",
    "Read phase_id_convention from resolved config; phase_naming is independent.",
    "Use CLI/writer IDs/paths; never derive paths from displays.",
    "Unset/null or sequential: Phase N; retain legacy paths.",
    "milestone-prefixed: Phase M-NN. M is the active milestone number; NN is the phase index padded to at least two digits: ### Phase 1-01: Name.",
    "Checklists: - [ ] **Phase N: Name** or - [ ] **Phase M-NN: Name**.",
    "Never Phase PROJ-7: project_code is excluded from legacy headings/checklists.",
    "bracket: [PROJECT.MM] PP[.SS], plan [PROJECT.MM] PP[.SS]-LL, dir PROJECT.MM-PP[.SS]-slug. MM is the active milestone integer, never phase number; widths >= two digits.",
    "Use ### [PROJECT.MM] PP: Name, - [ ] **[PROJECT.MM] PP: Name**, ## [PROJECT.MM] Name.",
    "Do not prepend Phase or a vX.Y to bracket IDs; keep milestone metadata. No implicit migration.",
    "Notation (not query keys): phase_display = CLI display_id (src/commands.cts:161) or writer phase identity; next_phase_display/dependency_phase_display = phase projection; backlog_phase_display = Phase + CLI backlog number (all conventions, no active milestone projection); plan_display = writer plan identity; *_milestone_display = writer milestone identity. phase_dir = returned disk path.",
    "Numeric CLI args stay valid inputs, not convention switches.",
  ].join('\n');
}

function phaseIdConventionBlock(): string {
  return [phaseIdConventionRules(), '', '```text', phaseIdCard(), '```'].join('\n');
}

export = {
  phaseIdConventionRules,
  phaseIdConventionBlock,
  phaseIdCard,
  PHASE_ID_CARD,
  PHASE_ID_LEGEND,
};
