/**
 * #612 — milestone-qualified bracket-ID resolution in multi-milestone flat layouts.
 *
 * A repo that keeps more than one milestone's phase dirs in the SAME flat
 * `.planning/phases/` (e.g. CK.02-* alongside CK.03-*) exposes a milestone-blind
 * resolver: `normalizePhaseName('CK.03-02')` yields the bare token `02`, which
 * collides with `CK.02-02`. Every `phaseTokenMatches(dir, normalized)` caller
 * then returns the FIRST same-numbered dir — the wrong milestone.
 *
 * Contract (CARRY-FORWARD §3 PR 6 — D-IDENT live matrix): a milestone-qualified
 * query resolves to its OWN milestone's dir; bare/legacy queries are unchanged.
 *
 * Scenarios mirror the carekit repro: CK.02-02 and CK.03-02 coexisting.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const core = require('../gsd-core/bin/lib/phase-id.cjs');

function mkPhase(tmp, name) {
  fs.mkdirSync(path.join(tmp, '.planning', 'phases', name), { recursive: true });
}

describe('#612 multi-milestone bracket-ID resolution', () => {
  let tmp;

  beforeEach(() => {
    tmp = createTempProject('gsd-612-mm-');
    fs.writeFileSync(
      path.join(tmp, '.planning', 'config.json'),
      JSON.stringify({ project_code: 'CK', phase_id_convention: 'bracket' }, null, 2)
    );
    // Two milestones sharing phase numbers in ONE flat phases/ dir (the carekit case).
    mkPhase(tmp, 'CK.02-01-business-listings');
    mkPhase(tmp, 'CK.02-02-pre-launch-punch-list');
    mkPhase(tmp, 'CK.02-02.01-seo-critical-fixes');
    mkPhase(tmp, 'CK.03-01-clinical-editorial-foundation');
    mkPhase(tmp, 'CK.03-02-shared-v3-app-shell');
  });

  afterEach(() => cleanup(tmp));

  test('find-phase CK.03-02 resolves to the v3 dir, NOT CK.02-02', () => {
    const r = JSON.parse(runGsdTools('find-phase CK.03-02', tmp).output);
    assert.equal(r.found, true);
    assert.match(r.directory, /CK\.03-02-shared-v3-app-shell$/);
  });

  test('find-phase CK.02-02 still resolves to its own milestone dir', () => {
    const r = JSON.parse(runGsdTools('find-phase CK.02-02', tmp).output);
    assert.equal(r.found, true);
    assert.match(r.directory, /CK\.02-02-pre-launch-punch-list$/);
  });

  test('find-phase CK.03-01 resolves to v3, not CK.02-01', () => {
    const r = JSON.parse(runGsdTools('find-phase CK.03-01', tmp).output);
    assert.equal(r.found, true);
    assert.match(r.directory, /CK\.03-01-clinical-editorial-foundation$/);
  });

  test('sub-phase CK.02-02.01 resolves to the decimal dir', () => {
    const r = JSON.parse(runGsdTools('find-phase CK.02-02.01', tmp).output);
    assert.equal(r.found, true);
    assert.match(r.directory, /CK\.02-02\.01-seo-critical-fixes$/);
  });

  test('init plan-phase CK.03-02 points at the v3 dir', () => {
    const r = JSON.parse(runGsdTools('init plan-phase CK.03-02', tmp).output);
    assert.equal(r.phase_found, true);
    assert.match(r.phase_dir, /CK\.03-02-shared-v3-app-shell$/);
  });
});

describe('#612 phaseTokenMatches qualified vs bare', () => {
  test('qualified id compares on the full milestone-qualified key', () => {
    assert.equal(core.phaseTokenMatches('CK.03-02-shared', 'CK.03-02'), true);
    assert.equal(core.phaseTokenMatches('CK.02-02-prelaunch', 'CK.03-02'), false);
    assert.equal(core.phaseTokenMatches('CK.02-02.01-seo', 'CK.02-02.01'), true);
  });

  test('bare / legacy tokens keep bare-token matching (unqualified path untouched)', () => {
    assert.equal(core.phaseTokenMatches('CK.03-02-shared', '02'), true);
    assert.equal(core.phaseTokenMatches('HQ-01-registry', '01'), true);
    assert.equal(core.phaseTokenMatches('02-api', '02'), true);
  });
});
