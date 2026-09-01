/**
 * Canonical bracket convention card (ADR-612).
 *
 * PR-5 owns the wider display rollout. PR-3 needs the same single-source card
 * at the migration boundary so dry-runs and applies explain the target grammar
 * before doing any work.
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

export = {
  phaseIdCard,
  PHASE_ID_CARD,
  PHASE_ID_LEGEND,
};
