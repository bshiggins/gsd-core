'use strict';

/**
 * Phase-ID convention CARD — the SINGLE source of truth for the annotated
 * bracket-grammar visualization (ADDENDUM-1).
 *
 * This module owns the ASCII card + one-line legend. It is rendered identically
 * at:
 *   - install completion notice (bin/install.js finishInstall)
 *   - `roadmap upgrade` start (roadmap-upgrade.cjs applyMigration), dry-run + --apply
 *
 * DO NOT duplicate the ASCII anywhere else — every render site imports from here.
 * Changing the convention display = editing this one module.
 *
 * Source: GSD-BRACKET-CONVENTION.md (the compact annotated card) + the one-line
 * legend distilled from its grammar rules.
 */

// The annotated grammar card (verbatim from the canonical convention source).
const CARD = [
  '[GSD.02] 05.03-01',
  ' │   │   │  │   │',
  ' │   │   │  │   └── plan        01',
  ' │   │   │  └────── subphase    03',
  ' │   │   └───────── phase       05',
  ' │   └───────────── milestone   02',
  ' └───────────────── project     GSD',
].join('\n');

// One-line legend (the load-bearing rules, compressed).
const LEGEND =
  "milestone = bracket integer; dots = phase-levels; one hyphen = plan; " +
  "no 'Phase' word, no vX.0";

/**
 * Return the annotated convention card + one-line legend as a single string.
 *
 * @param {object} [options]
 * @param {string} [options.title] - Optional heading rendered above the card.
 * @returns {string} The card block (card + blank line + legend), no trailing newline.
 */
function phaseIdCard(options = {}) {
  const parts = [];
  if (options.title) parts.push(options.title, '');
  parts.push(CARD, '', LEGEND);
  return parts.join('\n');
}

module.exports = { phaseIdCard, CARD, LEGEND };
