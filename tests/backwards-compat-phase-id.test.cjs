/**
 * Backwards-compatibility tests for the LEGACY `Phase N` phase ID convention
 * under the bracket era (migration-window READ tolerance).
 *
 * Per BRACKET-NATIVE-CJS-SCOPE.md §1: the runtime speaks one convention
 * (bracket), but read locators keep tolerance so a not-yet-migrated LEGACY
 * (`Phase N` / `01-slug`) repo still reads. This is migration-window
 * robustness, NOT a second active convention.
 *
 * Covers (bracket-era legacy `Phase N` tolerance — the M-NN `Phase 2-01` form
 * is NOT a tolerated read form; it is migrator-only input, so those assertions
 * were removed when the M-NN convention was superseded):
 *   1. Legacy 'Phase N' ROADMAP entries still read when phase_id_convention
 *      is null (the legacy default — no config key set).
 *   2. Deprecated warning fires for free-form roadmaps (non-fatal).
 *   3. No automatic migration happens when a free-form roadmap is loaded
 *      (the migrator is the sole on-disk converter).
 *   4. getMilestonePhaseFilter still matches old-style dirs ('02-setup')
 *      against ROADMAP entries 'Phase 2:'.
 *
 * Positive bracket read-path coverage lives in tests/bracket-roadmap-parse.test.cjs
 * and tests/bracket-helper.test.cjs.
 */

'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTempProject, cleanup, captureConsole } = require('./helpers.cjs');
const { getMilestonePhaseFilter } = require('../get-shit-done/bin/lib/core.cjs');

// ─── helpers ─────────────────────────────────────────────────────────────────

function writeRoadmap(tmpDir, content) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), content);
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('backwards-compat: legacy Phase N roadmap entries', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ── test 1: legacy entries work with null phase_id_convention ──────────────

  test('Phase N ROADMAP entries work when phase_id_convention is null (default)', () => {
    // No phase_id_convention key → default (null) must still honour Phase N headings.
    writeRoadmap(tmpDir, [
      '## Roadmap v1.0: Current',
      '',
      '### Phase 1: Setup',
      '**Goal:** initial setup',
      '',
      '### Phase 2: Build',
      '**Goal:** build the thing',
    ].join('\n'));

    const filter = getMilestonePhaseFilter(tmpDir);
    assert.strictEqual(filter('01-setup'), true, 'old-style dir must match Phase 1');
    assert.strictEqual(filter('02-build'), true, 'old-style dir must match Phase 2');
    assert.strictEqual(filter('03-deploy'), false, 'unlisted phase must not match');
  });

  // ── test 2: deprecated warning fires for free-form roadmaps ───────────────

  test('deprecated warning fires (non-fatal) when roadmap has no versioned milestone headings', () => {
    // A "free-form" roadmap: phase headings but no ## vX.Y milestone section.
    writeRoadmap(tmpDir, [
      '### Phase 1: Setup',
      '**Goal:** setup',
      '',
      '### Phase 2: Build',
      '**Goal:** build',
    ].join('\n'));

    const { stderr } = captureConsole(() => {
      getMilestonePhaseFilter(tmpDir);
    });

    // Warning must fire but must not throw — non-fatal.
    assert.match(
      stderr,
      /deprecated|free.form|phase_id_convention/i,
      'a deprecation warning must be emitted for free-form roadmaps'
    );
  });

  // ── test 3: no automatic migration ────────────────────────────────────────

  test('loading a free-form roadmap does not rewrite ROADMAP.md on disk', () => {
    const roadmapContent = [
      '### Phase 1: Setup',
      '**Goal:** setup',
    ].join('\n');

    writeRoadmap(tmpDir, roadmapContent);
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    const before = fs.readFileSync(roadmapPath, 'utf-8');

    // Trigger a load — must not silently migrate the file.
    getMilestonePhaseFilter(tmpDir);

    const after = fs.readFileSync(roadmapPath, 'utf-8');
    assert.equal(after, before, 'ROADMAP.md must not be rewritten during load');
  });

  // ── test 4: old-style dirs ('02-setup') match 'Phase 2:' ─────────────────

  test('isDirInMilestone: old-style dir "02-setup" matches ROADMAP "Phase 2:"', () => {
    writeRoadmap(tmpDir, [
      '## Roadmap v1.0: Current',
      '',
      '### Phase 2: Setup',
      '**Goal:** setup',
    ].join('\n'));

    const filter = getMilestonePhaseFilter(tmpDir);
    assert.strictEqual(filter('02-setup'), true, '"02-setup" must match "Phase 2:"');
    assert.strictEqual(filter('2-setup'), true, '"2-setup" must also match "Phase 2:"');
    assert.strictEqual(filter('03-other'), false, 'unlisted dir must not match');
  });
});
