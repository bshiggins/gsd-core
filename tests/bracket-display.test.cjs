// Tests for WAVE 4 bracket-native banners + display + emit (§4.6).
//
// Contract source: .planning/proposals/BRACKET-NATIVE-CJS-SCOPE.md §4.6 +
// BRACKET-NATIVE-CJS-SCOPE-ADDENDA.md (LOCKED R1 = READING B: milestone from
// the {PROJECT}.{MM}- prefix; ADDENDUM-3 bracket heading forms).
//
// Surfaces under test:
//   - hooks/gsd-statusline.js  renderPhaseDisplay (direct require, unit)
//   - commands.cjs  progress JSON  phases[].display_id (bracket) + bare number
//   - phase.cjs  add/insert emit: `### [GSD.02] NN:` heading + `GSD.02-NN-slug`
//     dir on a bracket repo; legacy `### Phase NN:` + `NN-slug` on a non-bracket
//     repo (the convention gate); NO `.00` milestone-prefix regression.
//
// renderPhaseDisplay is direct-require (pure). The command-level cases go through
// the runGsdTools subprocess on a createTempProject fixture (the bracket-roadmap-
// parse.test.cjs / bracket-validation.test.cjs pattern).

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const { renderPhaseDisplay } = require('../hooks/gsd-statusline.js');

// ─── Fixture builders ────────────────────────────────────────────────────────

function writeConfig(tmpDir, obj) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify(obj, null, 2));
}

function writeState(tmpDir, milestone = 'v2.0', name = 'Foundation') {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'STATE.md'),
    `---\ngsd_state_version: 1.0\nmilestone: ${milestone}\nmilestone_name: ${name}\nstatus: in progress\n---\n\n# Project State\n`
  );
}

function writeRoadmap(tmpDir, lines) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), lines.join('\n'));
}

function bracketProject(tmpDir, { phases = [] } = {}) {
  writeConfig(tmpDir, { phase_id_convention: 'bracket', project_code: 'GSD' });
  writeState(tmpDir, 'v2.0', 'Foundation');
  const phaseBlocks = phases
    .map(({ token, name }) => `### [GSD.02] ${token}: ${name}\n**Goal:** placeholder\n`)
    .join('\n');
  writeRoadmap(tmpDir, ['# Roadmap', '', '## [GSD.02] Foundation', '', phaseBlocks]);
}

function legacyProject(tmpDir, { phases = [] } = {}) {
  // Legacy = NO phase_id_convention (project_code present, to prove the gate is
  // on convention, NOT project_code).
  writeConfig(tmpDir, { project_code: 'GSD' });
  writeState(tmpDir, 'v2.0', 'Foundation');
  const phaseBlocks = phases
    .map(({ n, name }) => `### Phase ${n}: ${name}\n**Goal:** placeholder\n`)
    .join('\n');
  writeRoadmap(tmpDir, ['# Roadmap', '', phaseBlocks]);
}

// ─── renderPhaseDisplay (statusline unit) ────────────────────────────────────

describe('renderPhaseDisplay (gsd-statusline)', () => {
  test("renderPhaseDisplay('v2.0', '05', 'GSD') === '[GSD.02] 05'", () => {
    assert.strictEqual(renderPhaseDisplay('v2.0', '05', 'GSD'), '[GSD.02] 05');
  });

  test("renderPhaseDisplay('02', '05', 'GSD') === '[GSD.02] 05' (already-stripped MM)", () => {
    assert.strictEqual(renderPhaseDisplay('02', '05', 'GSD'), '[GSD.02] 05');
  });

  test("renderPhaseDisplay('v10.0', '03', 'CK') === '[CK.10] 03' (double-digit)", () => {
    assert.strictEqual(renderPhaseDisplay('v10.0', '03', 'CK'), '[CK.10] 03');
  });

  test('no project code → bare phase (no bracket)', () => {
    assert.strictEqual(renderPhaseDisplay('v2.0', '05', ''), '05');
  });

  test('subphase token preserved verbatim', () => {
    assert.strictEqual(renderPhaseDisplay('v2.0', '05.03', 'GSD'), '[GSD.02] 05.03');
  });
});

// ─── commands.cjs progress JSON: display_id bracket + bare number ─────────────

describe('progress JSON — display_id (bracket) + bare number', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('phase has bracket display_id and bare number on a bracket repo', () => {
    bracketProject(tmpDir, { phases: [{ token: '05', name: 'Some Feature' }] });
    // Seed an on-disk phase dir with a plan so progress sees it.
    const pdir = path.join(tmpDir, '.planning', 'phases', 'GSD.02-05-some-feature');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, '05-01-PLAN.md'), '# plan\n');

    // `stats` (cmdStats) extracts the bracket dir token via extractPhaseToken
    // and attaches display_id; its `number` is the bare on-disk join key.
    const result = runGsdTools('stats', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const phase = out.phases.find(p => p.number === '05');
    assert.ok(phase, `phase 05 present (got: ${JSON.stringify(out.phases.map(p => p.number))})`);
    // number is the BARE on-disk join key.
    assert.strictEqual(phase.number, '05', 'number stays bare');
    // display_id is the bracket human-facing label.
    assert.strictEqual(phase.display_id, '[GSD.02] 05', 'display_id is the bracket form');
    // name parses from the bracket ROADMAP heading — NOT garbage from a
    // dir-slice (the heading regex must match `### [GSD.02] 05:` w/o "Phase").
    assert.strictEqual(phase.name, 'Some Feature', 'name parsed from bracket heading');
  });

  test('milestone section heading is NOT counted as a phase', () => {
    bracketProject(tmpDir, { phases: [{ token: '05', name: 'Some Feature' }] });
    const pdir = path.join(tmpDir, '.planning', 'phases', 'GSD.02-05-some-feature');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, '05-01-PLAN.md'), '# plan\n');
    const out = JSON.parse(runGsdTools('stats', tmpDir).output);
    // `## [GSD.02] Foundation` (no NN: colon) must not parse as a phase.
    assert.strictEqual(out.phases.length, 1, `only the real phase counts (got ${JSON.stringify(out.phases.map(p => p.number))})`);
  });

  test('progress json: bracket dir yields bare number + correct name (no dir-slice garbage)', () => {
    bracketProject(tmpDir, { phases: [{ token: '05', name: 'Some Feature' }] });
    const pdir = path.join(tmpDir, '.planning', 'phases', 'GSD.02-05-some-feature');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, '05-01-PLAN.md'), '# plan\n');
    const out = JSON.parse(runGsdTools('progress json', tmpDir).output);
    const phase = out.phases.find(p => p.number === '05');
    assert.ok(phase, `phase 05 present (got: ${JSON.stringify(out.phases.map(p => p.number))})`);
    assert.strictEqual(phase.name, 'some feature', 'name from dir slug, not garbage');
    assert.strictEqual(phase.display_id, '[GSD.02] 05', 'display_id bracket form');
  });

  test('display_id degrades to bare token on a no-project-code repo', () => {
    // No project_code → getPhaseDisplayLabel returns the bare token.
    writeConfig(tmpDir, {});
    writeState(tmpDir, 'v1.0', 'M1');
    writeRoadmap(tmpDir, ['# Roadmap', '', '### Phase 3: Thing', '**Goal:** x', '']);
    const pdir = path.join(tmpDir, '.planning', 'phases', '03-thing');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, '03-01-PLAN.md'), '# plan\n');

    const result = runGsdTools('stats', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const phase = out.phases.find(p => p.number === '03');
    assert.ok(phase, 'phase 03 present');
    assert.strictEqual(phase.display_id, '03', 'display_id is bare token without project_code');
  });
});

// ─── phase.cjs add/insert emit (bracket repo) ────────────────────────────────

describe('phase add — bracket emit + milestone wiring (.00 fix)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('add on a bracket repo emits `### [GSD.02] NN:` heading + GSD.02-NN-slug dir', () => {
    bracketProject(tmpDir, { phases: [{ token: '05', name: 'Existing' }] });
    const result = runGsdTools(['phase', 'add', 'New Thing'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);

    // maxPhase scan saw bracket heading 05 → emits 06 (the read-regex swap).
    assert.strictEqual(out.padded, '06', 'next phase is 06 (bracket heading was scanned)');
    // Dir prefix carries milestone 02 from STATE.md — NOT a wrong .00 (.00 fix).
    assert.match(out.directory, /\/GSD\.02-06-new-thing$/, `dir got milestone prefix 02: ${out.directory}`);
    assert.doesNotMatch(out.directory, /GSD\.00-/, 'no .00 milestone-prefix regression');

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /### \[GSD\.02\] 06: New Thing/, 'bracket heading emitted (no "Phase" word)');
    assert.doesNotMatch(roadmap, /### Phase 06:/, 'no legacy "Phase" heading on a bracket repo');
  });

  test('two consecutive adds increment without restart (max-phase read works)', () => {
    // The .00 / read-regex regression only surfaces when the max-phase scan must
    // parse a bracket heading written by a PRIOR add. Add twice.
    bracketProject(tmpDir, { phases: [{ token: '05', name: 'Existing' }] });
    const a = JSON.parse(runGsdTools(['phase', 'add', 'First Add'], tmpDir).output);
    const b = JSON.parse(runGsdTools(['phase', 'add', 'Second Add'], tmpDir).output);
    assert.strictEqual(a.padded, '06', 'first add → 06');
    assert.strictEqual(b.padded, '07', 'second add → 07 (did NOT restart at 01)');
    const dirs = fs.readdirSync(path.join(tmpDir, '.planning', 'phases')).sort();
    assert.deepStrictEqual(dirs, ['GSD.02-06-first-add', 'GSD.02-07-second-add']);
  });

  test('insert on a bracket repo emits `### [GSD.02] NN.SS:` + GSD.02-NN.SS-slug dir', () => {
    bracketProject(tmpDir, {
      phases: [{ token: '05', name: 'Existing' }, { token: '06', name: 'Later' }],
    });
    const result = runGsdTools(['phase', 'insert', '05', 'Urgent Fix'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.phase_number, '05.1', 'first decimal under 05');
    assert.match(out.directory, /\/GSD\.02-05\.01-urgent-fix$/, `bracket insert dir: ${out.directory}`);

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /### \[GSD\.02\] 05\.01: Urgent Fix \(INSERTED\)/, 'bracket subphase heading');
    assert.match(roadmap, /\*\*Depends on:\*\* \[GSD\.02\] 05/, 'bracket Depends on');
  });
});

// ─── Convention gate: legacy repo keeps legacy emit ──────────────────────────

describe('convention gate — non-bracket repo keeps legacy emit', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('add on a legacy repo (project_code set, NO convention) emits `### Phase NN:` + NN-slug dir', () => {
    legacyProject(tmpDir, { phases: [{ n: '5', name: 'Existing' }] });
    const result = runGsdTools(['phase', 'add', 'New Thing'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);

    // Legacy emit: optional CODE- prefix, NO `.MM` milestone segment, "Phase" word.
    assert.match(out.directory, /\/GSD-06-new-thing$/, `legacy dir form (gate held): ${out.directory}`);
    assert.doesNotMatch(out.directory, /GSD\.\d\d-/, 'NO bracket milestone prefix on a legacy repo');

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /### Phase 6: New Thing/, 'legacy "Phase" heading preserved');
    assert.doesNotMatch(roadmap, /### \[GSD\./, 'NO bracket heading on a legacy repo');
  });
});
