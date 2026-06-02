// RETIRED M-NN HELPER GUARD (was: getMilestoneFromPhaseId / getPhaseDirFromPhaseId
// M-NN behavior, issue #39).
//
// The M-NN convention (milestone derived from the phase token's leading
// hyphen segment, dirs `GSD-MM-NN-slug`) is SUPERSEDED by the bracket
// convention. Per BRACKET-NATIVE-CJS-SCOPE.md §1 (clean-supersede) +
// LOCKED R1/READING-B: the milestone now rides in the `[PROJECT.MM]` prefix,
// NEVER in the phase token's leading int, and the only place M-NN parsing
// survives is the migrator (roadmap-upgrade.cjs).
//
// POSITIVE bracket coverage of these two helpers lives in
// tests/bracket-helper.test.cjs (READING-B discriminators, all-dot dir emit,
// sentinels, double-digit milestone, etc.). This file does NOT duplicate it.
//
// This suite is a thin SUPERSESSION guard: it asserts the OLD M-NN inputs no
// longer produce the OLD M-NN outputs — proving the M-NN branches were removed,
// not silently preserved. bracket-helper.test.cjs does not exercise these
// retired M-NN-shaped inputs, so there is no overlap.
//
// Unit-only: requires core.cjs directly, no subprocess.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  getMilestoneFromPhaseId,
  getPhaseDirFromPhaseId,
} = require('../get-shit-done/bin/lib/core.cjs');

// ─── getMilestoneFromPhaseId: M-NN milestone derivation is GONE ──────────────
//
// Old M-NN behavior: the milestone came from the phase token's FIRST hyphen
// segment (`1-01` → v1.0, `CK-2-01` → v2.0). Under bracket/READING-B a bare id
// with no `[PROJECT.MM]` prefix carries NO milestone, so these return null
// (no activeMilestone passed). The milestone is no longer recoverable from a
// hyphenated bare token.

describe('getMilestoneFromPhaseId — M-NN derivation retired (READING-B)', () => {
  test("'1-01' no longer maps to v1.0 (was M-NN) — bare id has no prefix → null", () => {
    assert.strictEqual(getMilestoneFromPhaseId('1-01'), null);
  });

  test("'2-4-1' no longer maps to v2.0 (M-NN leading-int rule removed) → null", () => {
    assert.strictEqual(getMilestoneFromPhaseId('2-4-1'), null);
  });

  test("'10-01' no longer maps to v10.0 (M-NN double-digit removed) → null", () => {
    assert.strictEqual(getMilestoneFromPhaseId('10-01'), null);
  });

  test("project-code-prefixed M-NN 'CK-2-01' no longer maps to v2.0 → null", () => {
    assert.strictEqual(getMilestoneFromPhaseId('CK-2-01'), null);
  });

  test("project-code-prefixed M-NN 'GSD-10-01' no longer maps to v10.0 → null", () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD-10-01'), null);
  });

  // Milestone now comes from the bracket prefix, NOT a hyphen segment — the
  // bracket discriminator (cross-checked in bracket-helper.test.cjs).
  test("the bracket prefix is the milestone source: 'GSD.02-05.03' → v2.0 (not v5.0)", () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD.02-05.03'), 'v2.0');
  });

  // Sentinels remain convention-independent (carried over unchanged).
  test("sentinel 999 still → null", () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD.02-999.1'), null);
  });

  test("non-numeric input still → null", () => {
    assert.strictEqual(getMilestoneFromPhaseId('invalid'), null);
  });
});

// ─── getPhaseDirFromPhaseId: M-NN dir emission is GONE ───────────────────────
//
// Old M-NN behavior emitted `{CODE}-{MM}-{NN}-slug` (milestone baked from the
// token's leading int) and returned null for any non-M-NN-hyphen input. Under
// bracket the dir is `{CODE}.{MM}-{allDotToken}-slug` with an EXPLICIT
// milestone param; the leading int is never the milestone. These assert the
// retired M-NN signatures no longer hold.

describe('getPhaseDirFromPhaseId — M-NN dir emission retired (READING-B)', () => {
  test("M-NN '2-01' no longer emits 'GSD-02-01-setup-database' (hyphen-MM-NN form gone)", () => {
    // Bare '2-01' is now an ambiguous milestone-vs-plan id → normalizePhaseName
    // THROWS rather than silently truncating, so dir emission propagates the
    // throw (it is no longer a silent 'GSD-02-01-…').
    assert.throws(
      () => getPhaseDirFromPhaseId('2-01', 'Setup Database', 'GSD'),
      /Ambiguous phase id '2-01'/,
    );
    assert.notStrictEqual(
      tryGetDir('2-01', 'Setup Database', 'GSD'),
      'GSD-02-01-setup-database',
    );
  });

  test("M-NN '2-01' (no code) no longer emits '02-01-setup-database'", () => {
    assert.notStrictEqual(tryGetDir('2-01', 'Setup Database'), '02-01-setup-database');
  });

  test("M-NN '10-01' no longer emits 'CK-10-01-build-feature'", () => {
    assert.notStrictEqual(tryGetDir('10-01', 'Build Feature', 'CK'), 'CK-10-01-build-feature');
  });

  test("non-hyphen 'nohyphen' no longer returns null (M-NN null-guard removed)", () => {
    // Old M-NN returned null for any input lacking the M-NN hyphen form.
    // Bracket treats it as a phase token + slug; the result is non-null.
    assert.notStrictEqual(getPhaseDirFromPhaseId('nohyphen', 'Some Title', 'GSD'), null);
  });

  // The bracket round-trip (positive form) — cross-checked in bracket-helper.
  test("bracket round-trip: ('04','Foo','GSD','02') → 'GSD.02-04-foo' (explicit milestone param)", () => {
    assert.strictEqual(getPhaseDirFromPhaseId('04', 'Foo', 'GSD', '02'), 'GSD.02-04-foo');
  });
});

/**
 * Call getPhaseDirFromPhaseId but swallow the D-IDENT ambiguity throw so a
 * `notStrictEqual` assertion can still prove the result is NOT the old M-NN
 * string. A throw is, by construction, not equal to the M-NN literal.
 */
function tryGetDir(...args) {
  try {
    return getPhaseDirFromPhaseId(...args);
  } catch {
    return undefined; // not the M-NN literal → notStrictEqual holds
  }
}
