// allow-test-rule: source-text-is-the-product
// Planner markdown is the deployed planning contract; these checks lock the
// exact canonical forms that downstream phase-plan-index accepts.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLANNER_PATH = path.join(__dirname, '..', 'agents', 'gsd-planner.md');

function readPlanner() {
  return fs.readFileSync(PLANNER_PATH, 'utf8');
}

test('#3430: planner SUMMARY instruction uses canonical bracket phase/plan form', () => {
  const content = readPlanner();
  // Bracket era: the milestone rides in the DIRECTORY prefix
  // (`{PROJECT}.{MM}-…`); the SUMMARY FILENAME is the all-dot phase token plus
  // the plan only — `{phase}[.{sub}]-{plan}-SUMMARY.md` (zero-padded per D-PAD,
  // so it stays phase-plan-index-resolvable — the original #3430 intent).
  assert.match(
    content,
    /Create `\.planning\/phases\/\{PROJECT\}\.\{MM\}-\{phase\}\[\.\{sub\}\]-name\/\{phase\}\[\.\{sub\}\]-\{plan\}-SUMMARY\.md` when done/,
    'planner must instruct the bracket SUMMARY form (milestone in dir prefix, filename = {phase}[.{sub}]-{plan}-SUMMARY.md)'
  );
  // The milestone must NOT leak into the SUMMARY filename — it belongs only in
  // the directory prefix. And the retired pre-bracket `{padded_phase}` token
  // must be gone.
  assert.doesNotMatch(
    content,
    /-name\/\{PROJECT\}\.\{MM\}-[^`]*-SUMMARY\.md/,
    'milestone must NOT appear in the SUMMARY filename — only in the directory prefix'
  );
  assert.doesNotMatch(
    content,
    /\{padded_phase\}-\{plan\}-SUMMARY\.md/,
    'planner must not use the retired pre-bracket {padded_phase} token'
  );
});

test('#3430: planner depends_on docs show canonical in-phase plan ids', () => {
  const content = readPlanner();
  assert.match(
    content,
    /depends_on:[^\n]*Use `01-01`\/`01-01-auth-hardening`/,
    'planner must document canonical depends_on examples that phase-plan-index resolves'
  );
  assert.doesNotMatch(
    content,
    /depends_on:[^\n]*01-trust\/01/,
    'planner must not document phase-slug/plan-number depends_on examples as canonical'
  );
});
