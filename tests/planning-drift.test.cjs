// tests/planning-drift.test.cjs
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const pd = require('../gsd-core/bin/lib/planning-drift.cjs');

describe('detectPlanningDrift', () => {
  test('no baseline → skipped(no-baseline), never throws', () => {
    const r = pd.detectPlanningDrift({ baselineCommit: null, baseCommits: ['a'], baseMerges: [] });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'no-baseline');
    assert.equal(r.drifted, false);
  });

  test('no base ref resolvable → skipped(no-base-branch)', () => {
    const r = pd.detectPlanningDrift({ baselineCommit: 'sha1', baseRef: '', baseCommits: [], baseMerges: [] });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'no-base-branch');
  });

  test('below threshold → not drifted', () => {
    const r = pd.detectPlanningDrift({
      baselineCommit: 'sha1', baseRef: 'origin/main',
      baseCommits: ['c1', 'c2'], baseMerges: [], threshold: 4,
    });
    assert.equal(r.skipped, false);
    assert.equal(r.drifted, false);
    assert.equal(r.commitsAhead, 2);
  });

  test('large gap AND stale baseline → drifted (the impeccable case)', () => {
    const r = pd.detectPlanningDrift({
      baselineCommit: 'sha1', baseRef: 'origin/main',
      reconciledAt: '2026-06-17', nowIso: '2026-06-29',   // 12 days → stale
      baseCommits: ['c1', 'c2', 'c3', 'c4'],
      baseMerges: ['Merge PR #65 five-year-wall', 'Merge feat/v3-design-system'],
      threshold: 4, stalenessWindowDays: 7,
    });
    assert.equal(r.drifted, true);
    assert.equal(r.commitsAhead, 4);
    assert.equal(r.mergesAhead, 2);
    assert.equal(r.ageDays, 12);
    assert.match(r.message, /4 commits/);
    assert.match(r.message, /five-year-wall/);
  });

  test('large gap but FRESH baseline → NOT drifted (the healthy just-shipped boundary — the discriminator)', () => {
    // A phase just merged (big gap) but verify/begin-phase stamped today → fresh → not drift.
    const r = pd.detectPlanningDrift({
      baselineCommit: 'sha1', baseRef: 'origin/main',
      reconciledAt: '2026-06-29', nowIso: '2026-06-29',   // 0 days → fresh
      baseCommits: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], baseMerges: ['m1'],
      threshold: 4, stalenessWindowDays: 7,
    });
    assert.equal(r.drifted, false);   // gap alone must NOT trip it
    assert.equal(r.ageDays, 0);
  });

  test('missing reconciledAt → ageDays null → not drifted (conservative)', () => {
    const r = pd.detectPlanningDrift({
      baselineCommit: 'sha1', baseRef: 'origin/main', nowIso: '2026-06-29',
      baseCommits: ['c1', 'c2', 'c3', 'c4', 'c5'], baseMerges: [], threshold: 4,
    });
    assert.equal(r.ageDays, null);
    assert.equal(r.drifted, false);
  });

  test('malformed input → skipped, never throws', () => {
    assert.equal(pd.detectPlanningDrift(null).skipped, true);
    assert.equal(pd.detectPlanningDrift(42).skipped, true);
  });
});

describe('reconciled-commit frontmatter', () => {
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  test('write then read round-trips, preserving other frontmatter', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-'));
    const p = path.join(dir, 'STATE.md');
    fs.writeFileSync(p, '---\nmilestone: v3.0\nstatus: in_progress\n---\n# Body\n');
    pd.writeReconciledCommit(p, 'abc123', '2026-06-29');
    assert.equal(pd.readReconciledCommit(p), 'abc123');
    const after = fs.readFileSync(p, 'utf8');
    assert.match(after, /milestone: v3\.0/);      // preserved
    assert.match(after, /status: in_progress/);   // preserved
    assert.match(after, /# Body/);                // body preserved
  });
  test('read missing file → null', () => {
    assert.equal(pd.readReconciledCommit('/no/such/STATE.md'), null);
  });
});
