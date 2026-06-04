/**
 * PR 1 — bracket phase-ID core grammar (#612).
 *
 * Ratified contract: ADR docs/adr/612-bracket-phase-id-convention.md §(3).
 * One pure model in core.cts — parsePhaseId / renderPhaseId / toDir sharing one
 * PhaseId shape — replaces the scattered M-NN helpers. READING-B: milestone comes
 * from the [PROJECT.MM] / {CODE}.{MM}- prefix, never the phase-token leading int.
 *
 * Scenarios mirror CARRY-FORWARD.md §3 (PR 1).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../get-shit-done/bin/lib/core.cjs');

// ─── ADR §3 round-trip property table ───────────────────────────────────────
const TABLE = [
  { display: '[GSD.02] 05.03-01', dir: 'GSD.02-05.03-feature' },
  { display: '[GSD.02] 05',       dir: 'GSD.02-05-feature' },
  { display: '[CK.01] 12.04',     dir: 'CK.01-12.04-feature' },
];

describe('bracket grammar: emit/render round-trip pair (ADR §3)', () => {
  test('render(parse(display)) === display', () => {
    for (const { display } of TABLE) {
      assert.strictEqual(core.renderPhaseId(core.parsePhaseId(display)), display);
    }
  });

  test('toDir(parse(display), slug) === dir', () => {
    for (const { display, dir } of TABLE) {
      assert.strictEqual(core.toDir(core.parsePhaseId(display), 'feature'), dir);
    }
  });

  test('parse is idempotent across surfaces: parse(dir) and parse(display) agree on the tuple', () => {
    for (const { display, dir } of TABLE) {
      const a = core.parsePhaseId(display);
      const b = core.parsePhaseId(dir);
      assert.strictEqual(
        `${b.project}.${b.milestone}-${b.phase}`,
        `${a.project}.${a.milestone}-${a.phase}`,
      );
    }
  });
});

// ─── ADR §1 collision-test acceptance (the full 5-tuple, post-fix) ───────────
describe('bracket grammar: full 5-tuple parse (ADR §1 acceptance)', () => {
  test('parsePhaseId resolves a complete milestone/phase/subphase/plan identity', () => {
    const parsed = core.parsePhaseId('GSD.02-05.03-01');
    assert.deepStrictEqual(parsed, {
      project:   'GSD',
      milestone: '02', // from the bracket/dir prefix (READING-B), not the leading int
      phase:     '05',
      subphase:  '03',
      plan:      '01',
    });
    assert.strictEqual(core.renderPhaseId(parsed), '[GSD.02] 05.03-01');
    assert.strictEqual(core.toDir(parsed, 'some-feature'), 'GSD.02-05.03-some-feature');
  });
});

// ─── READING-B milestone source (gated on 'bracket'; legacy paths intact) ────
describe('bracket grammar: getMilestoneFromPhaseId READING-B', () => {
  test("milestone comes from the [PROJECT.MM] prefix, not the phase-token leading int", () => {
    // 'GSD.02-05.03' → milestone 02 (v2.0), NOT phase 05 (v5.0).
    assert.strictEqual(core.getMilestoneFromPhaseId('GSD.02-05.03', 'bracket'), 'v2.0');
  });

  test('sentinel milestone ranges (0.x / 999.x) resolve to null', () => {
    assert.strictEqual(core.getMilestoneFromPhaseId('GSD.00-01', 'bracket'), null);
    assert.strictEqual(core.getMilestoneFromPhaseId('GSD.999-01', 'bracket'), null);
  });

  test("legacy M-NN path is unchanged when convention is not 'bracket'", () => {
    // READING-A leading-int rule, current behavior — must not regress.
    assert.strictEqual(core.getMilestoneFromPhaseId('2-01'), 'v2.0');
    assert.strictEqual(core.getMilestoneFromPhaseId('CK-2-01'), 'v2.0');
  });
});

// ─── extractPhaseToken: bracket dir form (CARRY-FORWARD §3 PR1) ──────────────
describe('bracket grammar: extractPhaseToken', () => {
  test('extracts the phase token PP[.SS] from a bracket dir', () => {
    assert.strictEqual(core.extractPhaseToken('CK.02-02.01-slug'), '02.01');
    assert.strictEqual(core.extractPhaseToken('GSD.02-05-feature'), '05');
    assert.strictEqual(core.extractPhaseToken('GSD.02-05.03-01'), '05.03'); // plan is not part of the token
  });

  test('legacy code-prefixed dirs still extract as before (no regression)', () => {
    assert.strictEqual(core.extractPhaseToken('CK-01-foo'), 'CK-01');
    assert.strictEqual(core.extractPhaseToken('02-04-some-slug'), '02-04');
  });
});

// ─── sentinel guard: isSentinelPhaseId / SENTINEL_RANGES ────────────────────
describe('bracket grammar: sentinel guard', () => {
  test('SENTINEL_RANGES are the {0, 999} milestone ranges', () => {
    assert.deepStrictEqual([...core.SENTINEL_RANGES], [0, 999]);
  });

  test('isSentinelPhaseId is true for milestone 0 / 999 across forms', () => {
    assert.strictEqual(core.isSentinelPhaseId('GSD.999-01'), true);
    assert.strictEqual(core.isSentinelPhaseId('GSD.00-01'), true);
    assert.strictEqual(core.isSentinelPhaseId('999.1'), true);
    assert.strictEqual(core.isSentinelPhaseId('0.1'), true);
  });

  test('isSentinelPhaseId is false for ordinary milestones', () => {
    assert.strictEqual(core.isSentinelPhaseId('GSD.02-05'), false);
    assert.strictEqual(core.isSentinelPhaseId('2-01'), false);
  });
});

// ─── slug guard: toDir never emits a path-traversal slug ────────────────────
describe('bracket grammar: toDir slug guard', () => {
  test('a hostile slug is sanitized to a safe filesystem token', () => {
    const id = core.parsePhaseId('[GSD.02] 05');
    const dir = core.toDir(id, '../../etc/passwd');
    assert.ok(!dir.includes('/'), `dir must not contain a path separator: ${dir}`);
    assert.ok(!dir.includes('..'), `dir must not contain '..': ${dir}`);
    assert.strictEqual(dir, 'GSD.02-05-etc-passwd');
  });

  test('a clean slug is preserved (round-trip unaffected)', () => {
    assert.strictEqual(core.toDir(core.parsePhaseId('[GSD.02] 05.03-01'), 'feature'), 'GSD.02-05.03-feature');
  });
});
