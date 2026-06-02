// Tests for bracket-aware `phase remove` + renumber (W4 gap).
//
// Contract (phase-id-convention.md "phase.remove scope"):
//   On a bracket repo (config.phase_id_convention === 'bracket' + project_code),
//   removal + renumber are SCOPED to the removed phase's milestone bracket prefix
//   (`[{PROJECT}.{MM}]` / `{PROJECT}.{MM}-`):
//     - the section is removed,
//     - sibling `### [{PROJECT}.{MM}] {N}:` headings renumber,
//     - on-disk dirs renumber,
//   ALL confined to that one milestone — a same-numbered phase in ANOTHER
//   milestone is never touched. Bare-number cross-refs / inline "Phase N" /
//   bare-number `Depends on` are NOT rewritten (milestone-ambiguous).

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─── fixture helpers ─────────────────────────────────────────────────────────

function git(tmpDir, args) {
  execFileSync('git', args, { cwd: tmpDir, stdio: 'pipe' });
}
function gitInitCommit(tmpDir) {
  git(tmpDir, ['init', '-q']);
  git(tmpDir, ['config', 'user.email', 'test@example.com']);
  git(tmpDir, ['config', 'user.name', 'Test']);
  git(tmpDir, ['add', '-A']);
  git(tmpDir, ['commit', '-q', '-m', 'baseline']);
}
function pDir(tmpDir) { return path.join(tmpDir, '.planning'); }
function writeConfig(tmpDir, obj) {
  fs.writeFileSync(path.join(pDir(tmpDir), 'config.json'), JSON.stringify(obj, null, 2) + '\n');
}
function writeRoadmap(tmpDir, content) {
  fs.writeFileSync(path.join(pDir(tmpDir), 'ROADMAP.md'), content);
}
function readRoadmap(tmpDir) {
  return fs.readFileSync(path.join(pDir(tmpDir), 'ROADMAP.md'), 'utf8');
}
function writeState(tmpDir, content) {
  fs.writeFileSync(path.join(pDir(tmpDir), 'STATE.md'), content);
}
function mkPhaseDir(tmpDir, name, files = {}) {
  const dir = path.join(pDir(tmpDir), 'phases', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [fname, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, fname), body);
  }
}
function listPhaseDirs(tmpDir) {
  return fs.readdirSync(path.join(pDir(tmpDir), 'phases'))
    .filter(d => fs.statSync(path.join(pDir(tmpDir), 'phases', d)).isDirectory())
    .sort();
}

/**
 * Build a bracket project: milestone 02 active with phases 01/02/03, and a
 * milestone 01 (prior) with a SAME-NUMBERED phase 02 that must be left alone.
 */
function buildBracketFixture(tmpDir) {
  writeConfig(tmpDir, { project_code: 'GSD', phase_id_convention: 'bracket' });
  writeState(tmpDir, '---\nmilestone: v2.0\n---\n');
  writeRoadmap(tmpDir, [
    '# Roadmap',
    '',
    '## [GSD.01] Foundation',
    '',
    '### [GSD.01] 01: Old Alpha',
    '**Goal:** prior milestone, untouched.',
    '',
    '### [GSD.01] 02: Old Beta',
    '**Goal:** SAME-NUMBERED decoy — must NOT be renumbered or removed.',
    '',
    '## [GSD.02] Core',
    '',
    '### [GSD.02] 01: One',
    '**Goal:** keep.',
    'Depends on: 01',
    '',
    '### [GSD.02] 02: Two',
    '**Goal:** REMOVE this one.',
    '',
    '### [GSD.02] 03: Three',
    '**Goal:** should renumber 03 → 02.',
    '',
  ].join('\n'));
  // Active-milestone phase dirs (GSD.02-*), with plan/summary files to assert
  // in-dir file renumber.
  mkPhaseDir(tmpDir, 'GSD.02-01-one', { '01-01-PLAN.md': 'plan one' });
  mkPhaseDir(tmpDir, 'GSD.02-02-two', { '02-01-PLAN.md': 'plan two' });
  mkPhaseDir(tmpDir, 'GSD.02-03-three', { '03-01-PLAN.md': 'plan three' });
  // Prior-milestone decoy dir, same bare number as a GSD.02 phase.
  mkPhaseDir(tmpDir, 'GSD.01-02-old-beta', { '02-01-PLAN.md': 'old beta plan' });
  gitInitCommit(tmpDir);
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('bracket phase remove — milestone-scoped renumber', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); buildBracketFixture(tmpDir); });
  afterEach(() => { cleanup(tmpDir); });

  test('removing [GSD.02] 02 renumbers 03 → 02 (heading + dir) within milestone 02', () => {
    const res = runGsdTools('phase remove 02', tmpDir);
    assert.ok(res.success, `remove failed: ${res.error}`);

    const dirs = listPhaseDirs(tmpDir);
    // 02 removed, 03 renumbered → 02, within milestone 02.
    assert.ok(dirs.includes('GSD.02-01-one'), `01 kept; got ${JSON.stringify(dirs)}`);
    assert.ok(!dirs.includes('GSD.02-02-two'), `02 removed; got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('GSD.02-02-three'), `03 → 02 (dir); got ${JSON.stringify(dirs)}`);
    assert.ok(!dirs.includes('GSD.02-03-three'), `old 03 dir gone; got ${JSON.stringify(dirs)}`);

    // In-dir plan file renumbered: 03-01-PLAN.md → 02-01-PLAN.md.
    const renamedFiles = fs.readdirSync(path.join(pDir(tmpDir), 'phases', 'GSD.02-02-three'));
    assert.ok(renamedFiles.includes('02-01-PLAN.md'), `plan file token renumbered; got ${JSON.stringify(renamedFiles)}`);

    const rm = readRoadmap(tmpDir);
    // Heading renumbered within milestone 02.
    assert.ok(/^### \[GSD\.02\] 01: One$/m.test(rm), 'phase 01 kept');
    assert.ok(!/^### \[GSD\.02\] 02: Two$/m.test(rm), 'removed phase 02 section gone');
    assert.ok(/^### \[GSD\.02\] 02: Three$/m.test(rm), `phase 03 heading → 02; got:\n${rm}`);
    assert.ok(!/^### \[GSD\.02\] 03: Three$/m.test(rm), 'old 03 heading gone');
  });

  test('a same-numbered phase in milestone 01 is NOT touched', () => {
    const res = runGsdTools('phase remove 02', tmpDir);
    assert.ok(res.success, `remove failed: ${res.error}`);

    const dirs = listPhaseDirs(tmpDir);
    // Prior-milestone decoy dir survives unchanged.
    assert.ok(dirs.includes('GSD.01-02-old-beta'), `decoy dir untouched; got ${JSON.stringify(dirs)}`);

    const rm = readRoadmap(tmpDir);
    // Prior-milestone headings unchanged (NOT renumbered to 01).
    assert.ok(/^### \[GSD\.01\] 01: Old Alpha$/m.test(rm), 'GSD.01 01 untouched');
    assert.ok(/^### \[GSD\.01\] 02: Old Beta$/m.test(rm), `GSD.01 02 decoy untouched; got:\n${rm}`);
    assert.ok(/^## \[GSD\.01\] Foundation$/m.test(rm), 'GSD.01 section heading intact');
    assert.ok(/^## \[GSD\.02\] Core$/m.test(rm), 'GSD.02 section heading intact (not consumed)');
  });

  test('decimal/subphase remove is refused on a bracket repo (no orphaned section)', () => {
    // Removing a subphase on a bracket repo would orphan the ROADMAP heading
    // against a deleted dir — the remover refuses BEFORE deleting anything.
    const before = readRoadmap(tmpDir);
    const res = runGsdTools('phase remove 02.01', tmpDir);
    assert.ok(!res.success, 'decimal bracket remove must fail loud');
    assert.ok(/not supported on bracket repos/i.test(res.error), `error names the limitation; got: ${res.error}`);
    // Nothing was deleted or rewritten.
    assert.strictEqual(readRoadmap(tmpDir), before, 'ROADMAP untouched on refusal');
    assert.ok(listPhaseDirs(tmpDir).includes('GSD.02-02-two'), 'target dir NOT deleted on refusal');
  });

  test('bare-number cross-refs / inline Depends-on are NOT rewritten', () => {
    const res = runGsdTools('phase remove 02', tmpDir);
    assert.ok(res.success, `remove failed: ${res.error}`);
    const rm = readRoadmap(tmpDir);
    // The bare `Depends on: 01` under phase 01 must remain a bare number
    // (milestone-ambiguous → deliberately not rewritten on bracket repos).
    assert.ok(/Depends on: 01/.test(rm), `bare Depends-on preserved; got:\n${rm}`);
  });
});

// ─── legacy path unchanged (regression guard) ────────────────────────────────

describe('legacy phase remove still renumbers (non-bracket repo)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('legacy repo: remove Phase 2 renumbers Phase 3 → 2', () => {
    // No phase_id_convention → legacy path.
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## v1.0 Foundation',
      '',
      '### Phase 1: One',
      '**Goal:** keep.',
      '',
      '### Phase 2: Two',
      '**Goal:** remove.',
      '',
      '### Phase 3: Three',
      '**Goal:** renumber to 2.',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '01-one');
    mkPhaseDir(tmpDir, '02-two');
    mkPhaseDir(tmpDir, '03-three');
    gitInitCommit(tmpDir);

    const res = runGsdTools('phase remove 2', tmpDir);
    assert.ok(res.success, `remove failed: ${res.error}`);

    const dirs = listPhaseDirs(tmpDir);
    assert.ok(dirs.includes('01-one'), `01 kept; got ${JSON.stringify(dirs)}`);
    assert.ok(!dirs.includes('02-two'), `02 removed; got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('02-three'), `03 → 02 (legacy); got ${JSON.stringify(dirs)}`);

    const rm = readRoadmap(tmpDir);
    assert.ok(/^### Phase 1: One$/m.test(rm), 'Phase 1 kept');
    assert.ok(/^### Phase 2: Three$/m.test(rm), `Phase 3 → 2 (legacy heading); got:\n${rm}`);
  });
});
