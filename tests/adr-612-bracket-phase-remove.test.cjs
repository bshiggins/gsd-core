'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const { splitLines } = require('../gsd-core/bin/lib/text-lines.cjs');

let tmpDir;

const planning = (...parts) => path.join(tmpDir, '.planning', ...parts);

function makePhaseDir(name, files = []) {
  const dir = planning('phases', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file), '# artifact\n');
}

function snapshotTree(root) {
  const snapshot = [];
  function visit(dir, relativeDir = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(relativeDir, entry.name);
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        snapshot.push({ type: 'directory', path: relative });
        visit(absolute, relative);
      } else {
        snapshot.push({
          type: 'file',
          path: relative,
          bytes: fs.readFileSync(absolute).toString('base64'),
        });
      }
    }
  }
  visit(root);
  return snapshot;
}

function replaceSeed(roadmapLines, phaseDirs) {
  fs.writeFileSync(planning('ROADMAP.md'), roadmapLines.join('\n'));
  // eslint-disable-next-line local/no-raw-rmsync-in-tests -- this fixture helper replaces only seed()'s known .planning/phases subtree; helpers.cleanup() would destroy the whole live fixture.
  fs.rmSync(planning('phases'), { recursive: true, force: true });
  for (const [name, files] of phaseDirs) makePhaseDir(name, files);
}

function seed() {
  fs.writeFileSync(
    planning('config.json'),
    JSON.stringify({ project_code: 'CK', phase_id_convention: 'bracket' }, null, 2) + '\n',
  );
  fs.writeFileSync(
    planning('STATE.md'),
    '---\nmilestone: v2.0\n---\n\n# State\n\n**Status:** Planning\n**Last Activity:** 2026-09-01\n',
  );
  fs.writeFileSync(
    planning('ROADMAP.md'),
    [
      '# Roadmap',
      '',
      '## [CK.01] v1.0 — Prior',
      '',
      '- [ ] [CK.01] 02: Prior Decoy',
      '',
      '### [CK.01] 02: Prior Decoy',
      '**Goal:** untouched',
      '',
      '## [CK.02] v2.0 — Current',
      '',
      '- [ ] [CK.02] 01: One',
      '- [ ] [CK.02] 01.01: First Insert',
      '- [ ] [CK.02] 01.02: Second Insert',
      '- [ ] [CK.02] 02: Two',
      '- [ ] [CK.02] 03: Three',
      '- [ ] [CK.02] 04: Four',
      '',
      '### [CK.02] 01: One',
      '**Goal:** keep',
      '',
      '### [CK.02] 01.01: First Insert',
      '**Goal:** remove independently',
      '',
      '### [CK.02] 01.02: Second Insert',
      '**Goal:** renumber independently',
      '**Plans:** `01.02-01-PLAN.md`',
      '',
      '### [CK.02] 02: Two',
      '**Goal:** remove',
      '',
      '### [CK.02] 03: Three',
      '**Goal:** renumber',
      '**Plans:** `03-01-PLAN.md`',
      '',
      '### [CK.02] 04: Four',
      '**Goal:** renumber after an occupied destination moves',
      '**Depends on:** [CK.02] 03',
      '**Plans:** `04-01-PLAN.md`',
      '',
      '## Progress',
      '',
      '| Phase | Plans | Status |',
      '| --- | --- | --- |',
      '| [CK.01] 02 | 0/1 | Prior |',
      '| [CK.02] 01 | 0/1 | Planned |',
      '| [CK.02] 01.01 | 0/1 | Planned |',
      '| [CK.02] 01.02 | 0/1 | Planned |',
      '| [CK.02] 02 | 0/1 | Planned |',
      '| [CK.02] 03 | 0/1 | Planned |',
      '| [CK.02] 04 | 0/1 | Planned |',
      '',
    ].join('\n'),
  );
  makePhaseDir('CK.01-02-prior-decoy', ['02-01-PLAN.md']);
  makePhaseDir('CK.02-01-one', ['01-01-PLAN.md']);
  makePhaseDir('CK.02-01.01-first-insert', ['01.01-01-PLAN.md']);
  makePhaseDir('CK.02-01.02-second-insert', ['01.02-01-PLAN.md']);
  makePhaseDir('CK.02-02-two', ['02-01-PLAN.md']);
  makePhaseDir('CK.02-03-three', ['03-01-PLAN.md']);
  makePhaseDir('CK.02-04-four', ['04-01-PLAN.md']);
}

describe('#4304 / ADR-612 bracket phase remove', () => {
  beforeEach(() => {
    tmpDir = createTempProject('adr-612-remove-');
    seed();
  });
  afterEach(() => cleanup(tmpDir));

  test('removes and renumbers only inside the active milestone bracket', () => {
    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);

    assert.equal(out.directory_deleted, 'CK.02-02-two');
    assert.deepEqual(
      fs.readdirSync(planning('phases')).sort(),
      [
        'CK.01-02-prior-decoy',
        'CK.02-01-one',
        'CK.02-01.01-first-insert',
        'CK.02-01.02-second-insert',
        'CK.02-02-three',
        'CK.02-03-four',
      ],
    );
    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);
    assert.equal(fs.existsSync(planning('phases', 'CK.02-03-four', '03-01-PLAN.md')), true);

    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('### [CK.01] 02: Prior Decoy'), true);
    assert.equal(roadmap.includes('| [CK.01] 02 | 0/1 | Prior |'), true);
    assert.equal(roadmap.includes('### [CK.02] 02: Two'), false);
    assert.equal(roadmap.includes('### [CK.02] 02: Three'), true);
    assert.equal(roadmap.includes('### [CK.02] 03: Three'), false);
    assert.equal(roadmap.includes('### [CK.02] 03: Four'), true);
    assert.equal(roadmap.includes('**Depends on:** [CK.02] 02'), true);
    assert.equal(roadmap.includes('`02-01-PLAN.md`'), true);
    assert.equal(roadmap.includes('`03-01-PLAN.md`'), true);
    assert.equal(roadmap.includes('| [CK.02] 02 | 0/1 | Planned |'), true);
    assert.equal(roadmap.includes('| [CK.02] 03 | 0/1 | Planned |'), true);
    assert.equal(roadmap.includes('| [CK.02] 04 | 0/1 | Planned |'), false);
    assert.equal((roadmap.match(/^\| \[CK\.02\] 02 \|/gm) ?? []).length, 1);
  });

  test('removes a bracket subphase and renumbers only later siblings', () => {
    const result = runGsdTools(['phase', 'remove', '01.01', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);

    assert.equal(fs.existsSync(planning('phases', 'CK.02-01.01-first-insert')), false);
    assert.equal(fs.existsSync(planning('phases', 'CK.02-01.01-second-insert')), true);
    assert.equal(
      fs.existsSync(planning('phases', 'CK.02-01.01-second-insert', '01.01-01-PLAN.md')),
      true,
    );
    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-two')), true);

    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('First Insert'), false);
    assert.equal(roadmap.includes('### [CK.02] 01.01: Second Insert'), true);
    assert.equal(roadmap.includes('### [CK.02] 01.02: Second Insert'), false);
    assert.equal(roadmap.includes('`01.01-01-PLAN.md`'), true);
    assert.equal(roadmap.includes('| [CK.02] 01.02 |'), false);
    assert.equal((roadmap.match(/^\| \[CK\.02\] 01\.01 \|/gm) ?? []).length, 1);
    assert.equal(roadmap.includes('### [CK.02] 02: Two'), true);
  });

  // #4304 Blocker 1: a qualified bracket id (`CK.02-02`) used to resolve and
  // delete its directory, then crash on `parseInt(normalized, 10)` (NaN)
  // inside renameBracketPhases/updateRoadmapAfterBracketPhaseRemoval, leaving
  // ROADMAP and STATE unsynced with the already-deleted directory. The fix
  // parses the qualified form through parsePhaseId and validates it BEFORE
  // any deletion.
  test('removes a phase using its fully-qualified bracket id, identically to the bare form', () => {
    const result = runGsdTools(['phase', 'remove', 'CK.02-02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);

    assert.equal(out.directory_deleted, 'CK.02-02-two');
    assert.equal(out.roadmap_updated, true);
    assert.equal(out.state_updated, true);
    assert.deepEqual(
      fs.readdirSync(planning('phases')).sort(),
      [
        'CK.01-02-prior-decoy',
        'CK.02-01-one',
        'CK.02-01.01-first-insert',
        'CK.02-01.02-second-insert',
        'CK.02-02-three',
        'CK.02-03-four',
      ],
    );
    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);
    assert.equal(fs.existsSync(planning('phases', 'CK.02-03-four', '03-01-PLAN.md')), true);

    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('### [CK.01] 02: Prior Decoy'), true);
    assert.equal(roadmap.includes('### [CK.02] 02: Two'), false);
    assert.equal(roadmap.includes('### [CK.02] 02: Three'), true);
    assert.equal(roadmap.includes('### [CK.02] 03: Three'), false);
    assert.equal(roadmap.includes('### [CK.02] 03: Four'), true);
  });

  test('removes a phase using its fully-qualified decimal bracket id (subphase)', () => {
    const result = runGsdTools(['phase', 'remove', 'CK.02-01.01', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);

    assert.equal(fs.existsSync(planning('phases', 'CK.02-01.01-first-insert')), false);
    assert.equal(fs.existsSync(planning('phases', 'CK.02-01.01-second-insert')), true);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('First Insert'), false);
    assert.equal(roadmap.includes('### [CK.02] 01.01: Second Insert'), true);
    assert.equal(roadmap.includes('### [CK.02] 02: Two'), true);
  });

  test('refuses a qualified id naming a different milestone, leaving the directory in place', () => {
    const roadmapBefore = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const dirsBefore = fs.readdirSync(planning('phases')).sort();

    const result = runGsdTools(['phase', 'remove', 'CK.01-02', '--force'], tmpDir);

    assert.equal(result.success, false, result.output);
    assert.match(result.error, /active milestone/i);
    assert.equal(fs.existsSync(planning('phases', 'CK.01-02-prior-decoy')), true);
    assert.equal(fs.readFileSync(planning('ROADMAP.md'), 'utf8'), roadmapBefore);
    assert.deepEqual(fs.readdirSync(planning('phases')).sort(), dirsBefore);
  });

  test('refuses a nested bracket phase argument before mutating any planning file or directory', () => {
    const before = snapshotTree(planning());

    const result = runGsdTools(['phase', 'remove', '1.1.1', '--force'], tmpDir);

    assert.equal(result.success, false, result.output);
    assert.match(result.error, /cannot be resolved to a bracket phase number/i);
    assert.deepEqual(snapshotTree(planning()), before);
  });

  test('refuses a nonnumeric bracket phase argument before mutating any planning file or directory', () => {
    const before = snapshotTree(planning());

    const result = runGsdTools(['phase', 'remove', 'abc', '--force'], tmpDir);

    assert.equal(result.success, false, result.output);
    assert.match(result.error, /cannot be resolved to a bracket phase number/i);
    assert.deepEqual(snapshotTree(planning()), before);
  });

  // #4304 round-3 Blocker 1: `normalizePhaseName` (the legacy grammar) pads
  // only a decimal query's leading integer, not its subphase segment — "1.1"
  // normalizes to "01.1", not the bracket directory's own "01.01" — so the
  // bare-argument path never matched CK.02-01.01-first, yet still deleted the
  // ROADMAP section and renumbered 01.02 to 01.01, leaving the undeleted
  // 01.01 directory and the renamed-from-01.02 directory both claiming
  // subphase 01.01.
  test('removes a phase using an unpadded bracket subphase argument, identically to the padded form', () => {
    const result = runGsdTools(['phase', 'remove', '1.1', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);

    assert.equal(out.directory_deleted, 'CK.02-01.01-first-insert');
    assert.equal(fs.existsSync(planning('phases', 'CK.02-01.01-first-insert')), false);
    assert.equal(fs.existsSync(planning('phases', 'CK.02-01.01-second-insert')), true);
    assert.equal(
      fs.existsSync(planning('phases', 'CK.02-01.01-second-insert', '01.01-01-PLAN.md')),
      true,
    );
    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-two')), true);

    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('First Insert'), false);
    assert.equal(roadmap.includes('### [CK.02] 01.01: Second Insert'), true);
    assert.equal(roadmap.includes('### [CK.02] 01.02: Second Insert'), false);
    assert.equal(roadmap.includes('`01.01-01-PLAN.md`'), true);
    assert.equal(roadmap.includes('| [CK.02] 01.02 |'), false);
    assert.equal((roadmap.match(/^\| \[CK\.02\] 01\.01 \|/gm) ?? []).length, 1);
    assert.equal(roadmap.includes('### [CK.02] 02: Two'), true);
  });

  test('padded and unpadded spellings of the same bracket subphase id produce byte-identical results', () => {
    const dirUnpadded = createTempProject('adr-612-remove-unpadded-');
    const dirPadded = createTempProject('adr-612-remove-padded-');
    const savedTmpDir = tmpDir;
    try {
      tmpDir = dirUnpadded;
      seed();
      const resultUnpadded = runGsdTools(['phase', 'remove', '1.1', '--force'], dirUnpadded);
      assert.equal(resultUnpadded.success, true, resultUnpadded.error || resultUnpadded.output);

      tmpDir = dirPadded;
      seed();
      const resultPadded = runGsdTools(['phase', 'remove', '01.01', '--force'], dirPadded);
      assert.equal(resultPadded.success, true, resultPadded.error || resultPadded.output);
    } finally {
      tmpDir = savedTmpDir;
    }

    const roadmapUnpadded = fs.readFileSync(path.join(dirUnpadded, '.planning', 'ROADMAP.md'), 'utf8');
    const roadmapPadded = fs.readFileSync(path.join(dirPadded, '.planning', 'ROADMAP.md'), 'utf8');
    assert.equal(roadmapUnpadded, roadmapPadded);

    const dirsUnpadded = fs.readdirSync(path.join(dirUnpadded, '.planning', 'phases')).sort();
    const dirsPadded = fs.readdirSync(path.join(dirPadded, '.planning', 'phases')).sort();
    assert.deepEqual(dirsUnpadded, dirsPadded);

    cleanup(dirUnpadded);
    cleanup(dirPadded);
  });

  // #4304 Blocker 3: the artifact-token rewrite (`03-01-PLAN.md` -> `02-01-PLAN.md`)
  // ran as a global replace with no milestone qualifier, so an EARLIER
  // milestone's own same-numbered artifact reference was corrupted even
  // though that milestone's directory/files were never touched. The display-id
  // rewrite (`[CK.02] 03` -> `[CK.02] 02`) was already milestone-qualified and
  // safe; only the bare-token rewrite needed scoping.
  test('confines artifact-token renumbering to the active milestone, leaving an earlier milestone byte-identical', () => {
    fs.writeFileSync(
      planning('ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## [CK.01] v1.0 — Prior',
        '',
        '### [CK.01] 03: Prior Three',
        '',
        '**Goal:** untouched',
        '**Plans:** `03-01-PLAN.md`, `03-01-SUMMARY.md`',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '### [CK.02] 02: Two',
        '',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '',
        '**Goal:** renumber',
        '**Plans:** `03-01-PLAN.md`',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.01] 03 | 0/1 | Prior |',
        '| [CK.02] 02 | 0/1 | Planned |',
        '| [CK.02] 03 | 0/1 | Planned |',
        '',
      ].join('\n'),
    );
    // eslint-disable-next-line local/no-raw-rmsync-in-tests -- removing only the .planning/phases subdir within a still-live fixture (this test replaces seed()'s ROADMAP with its own, and the seeded phase dirs would otherwise leak in as unrelated rename candidates); helpers.cleanup() tears down the whole tmpDir, not a subdirectory, so it cannot substitute here.
    fs.rmSync(planning('phases'), { recursive: true, force: true });
    makePhaseDir('CK.01-03-prior-three', ['03-01-PLAN.md', '03-01-SUMMARY.md']);
    makePhaseDir('CK.02-02-two', ['02-01-PLAN.md']);
    makePhaseDir('CK.02-03-three', ['03-01-PLAN.md']);

    const roadmapBefore = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const ck01SectionBefore = roadmapBefore.slice(
      roadmapBefore.indexOf('## [CK.01]'),
      roadmapBefore.indexOf('## [CK.02]'),
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);

    const roadmapAfter = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const ck01SectionAfter = roadmapAfter.slice(
      roadmapAfter.indexOf('## [CK.01]'),
      roadmapAfter.indexOf('## [CK.02]'),
    );
    assert.equal(ck01SectionAfter, ck01SectionBefore);
    assert.equal(fs.existsSync(planning('phases', 'CK.01-03-prior-three', '03-01-PLAN.md')), true);
    assert.equal(fs.existsSync(planning('phases', 'CK.01-03-prior-three', '03-01-SUMMARY.md')), true);

    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);
    assert.equal(roadmapAfter.includes('### [CK.02] 02: Three'), true);
    assert.equal(roadmapAfter.includes('### [CK.02] 03: Three'), false);
  });

  // #4304 follow-up: the ADR-612 canonical milestone heading carries no vX.Y
  // token at all (`## [GSD.09] Hidden`) — currentMilestoneRawRanges must
  // scope the artifact-token rewrite for this shape too, not only the
  // vX.Y-bearing shape every other fixture in this file uses.
  test('confines artifact-token renumbering to the active milestone when milestone headings carry no version token', () => {
    fs.writeFileSync(
      planning('ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## [CK.01] Prior',
        '',
        '### [CK.01] 03: Prior Three',
        '',
        '**Goal:** untouched',
        '**Plans:** `03-01-PLAN.md`, `03-01-SUMMARY.md`',
        '',
        '## [CK.02] Current',
        '',
        '### [CK.02] 02: Two',
        '',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '',
        '**Goal:** renumber',
        '**Plans:** `03-01-PLAN.md`',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.01] 03 | 0/1 | Prior |',
        '| [CK.02] 02 | 0/1 | Planned |',
        '| [CK.02] 03 | 0/1 | Planned |',
        '',
      ].join('\n'),
    );
    // eslint-disable-next-line local/no-raw-rmsync-in-tests -- removing only the .planning/phases subdir within a still-live fixture (this test replaces seed()'s ROADMAP with its own, and the seeded phase dirs would otherwise leak in as unrelated rename candidates); helpers.cleanup() tears down the whole tmpDir, not a subdirectory, so it cannot substitute here.
    fs.rmSync(planning('phases'), { recursive: true, force: true });
    makePhaseDir('CK.01-03-prior-three', ['03-01-PLAN.md', '03-01-SUMMARY.md']);
    makePhaseDir('CK.02-02-two', ['02-01-PLAN.md']);
    makePhaseDir('CK.02-03-three', ['03-01-PLAN.md']);

    const roadmapBefore = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const ck01SectionBefore = roadmapBefore.slice(
      roadmapBefore.indexOf('## [CK.01]'),
      roadmapBefore.indexOf('## [CK.02]'),
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);

    const roadmapAfter = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const ck01SectionAfter = roadmapAfter.slice(
      roadmapAfter.indexOf('## [CK.01]'),
      roadmapAfter.indexOf('## [CK.02]'),
    );
    assert.equal(ck01SectionAfter, ck01SectionBefore);
    assert.equal(fs.existsSync(planning('phases', 'CK.01-03-prior-three', '03-01-PLAN.md')), true);
    assert.equal(fs.existsSync(planning('phases', 'CK.01-03-prior-three', '03-01-SUMMARY.md')), true);

    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);
    assert.equal(roadmapAfter.includes('### [CK.02] 02: Three'), true);
    assert.equal(roadmapAfter.includes('### [CK.02] 03: Three'), false);
  });

  // #4304 round-3 Blocker 3: round 2 confined BOTH the display-id replace and
  // the bare artifact-token replace to `ranges.primary`, but a fully
  // qualified reference (a global Progress table AFTER a later sibling
  // milestone, e.g. CK.03) carries its own milestone and cannot collide —
  // scoping it too left it stale after a renumber.
  test('renumbers fully qualified references in a global Progress table outside the active milestone section, while another milestone stays byte-identical', () => {
    fs.writeFileSync(
      planning('ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## [CK.01] v1.0 — Prior',
        '',
        '### [CK.01] 03: Prior Three',
        '',
        '**Goal:** untouched',
        '**Plans:** `03-01-PLAN.md`, `03-01-SUMMARY.md`',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '### [CK.02] 02: Two',
        '',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '',
        '**Goal:** renumber',
        '**Plans:** `03-01-PLAN.md`',
        '',
        '## [CK.03] v3.0 — Future',
        '',
        '### [CK.03] 01: Later',
        '',
        '**Goal:** untouched by the CK.02 removal',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.01] 03 | 0/1 | Prior |',
        '| [CK.02] 02 | 0/1 | Planned |',
        '| [CK.02] 03 | 0/1 | Planned |',
        '| [CK.03] 01 | 0/1 | Future |',
        '',
      ].join('\n'),
    );
    // eslint-disable-next-line local/no-raw-rmsync-in-tests -- removing only the .planning/phases subdir within a still-live fixture (this test replaces seed()'s ROADMAP with its own, and the seeded phase dirs would otherwise leak in as unrelated rename candidates); helpers.cleanup() tears down the whole tmpDir, not a subdirectory, so it cannot substitute here.
    fs.rmSync(planning('phases'), { recursive: true, force: true });
    makePhaseDir('CK.01-03-prior-three', ['03-01-PLAN.md', '03-01-SUMMARY.md']);
    makePhaseDir('CK.02-02-two', ['02-01-PLAN.md']);
    makePhaseDir('CK.02-03-three', ['03-01-PLAN.md']);
    makePhaseDir('CK.03-01-later', []);

    const roadmapBefore = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const ck01SectionBefore = roadmapBefore.slice(
      roadmapBefore.indexOf('## [CK.01]'),
      roadmapBefore.indexOf('## [CK.02]'),
    );
    const ck03SectionBefore = roadmapBefore.slice(
      roadmapBefore.indexOf('## [CK.03]'),
      roadmapBefore.indexOf('## Progress'),
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);

    const roadmapAfter = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const ck01SectionAfter = roadmapAfter.slice(
      roadmapAfter.indexOf('## [CK.01]'),
      roadmapAfter.indexOf('## [CK.02]'),
    );
    assert.equal(ck01SectionAfter, ck01SectionBefore);
    assert.equal(fs.existsSync(planning('phases', 'CK.01-03-prior-three', '03-01-PLAN.md')), true);
    assert.equal(fs.existsSync(planning('phases', 'CK.01-03-prior-three', '03-01-SUMMARY.md')), true);

    const ck03SectionAfter = roadmapAfter.slice(
      roadmapAfter.indexOf('## [CK.03]'),
      roadmapAfter.indexOf('## Progress'),
    );
    assert.equal(ck03SectionAfter, ck03SectionBefore);

    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);
    assert.equal(roadmapAfter.includes('### [CK.02] 02: Three'), true);
    assert.equal(roadmapAfter.includes('### [CK.02] 03: Three'), false);

    const progressAfter = roadmapAfter.slice(roadmapAfter.indexOf('## Progress'));
    assert.equal(progressAfter.includes('| [CK.02] 02 | 0/1 | Planned |'), true);
    assert.equal(progressAfter.includes('| [CK.02] 03 | 0/1 | Planned |'), false);
    assert.equal(progressAfter.includes('| [CK.01] 03 | 0/1 | Prior |'), true);
    assert.equal(progressAfter.includes('| [CK.03] 01 | 0/1 | Future |'), true);
    assert.equal((progressAfter.match(/^\| \[CK\.02\] 02 \|/gm) ?? []).length, 1);
  });

  test('discovers and renumbers later phases in both the active primary and Phase Details ranges', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 02: Two',
        '',
        '## [CK.03] v3.0 — Future',
        '',
        '### [CK.03] 01: Future',
        '**Goal:** untouched',
        '',
        '## [CK.02] v2.0 — Current (Phase Details)',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '**Plans:** `03-01-PLAN.md`',
        '',
      ],
      [
        ['CK.02-02-two', ['02-01-PLAN.md']],
        ['CK.02-03-three', ['03-01-PLAN.md']],
        ['CK.03-01-future', []],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');

    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);
    assert.equal(roadmap.includes('- [ ] [CK.02] 02: Two'), false);
    assert.equal(roadmap.includes('### [CK.02] 02: Two'), false);
    assert.equal(roadmap.includes('### [CK.02] 02: Three'), true);
    assert.equal(roadmap.includes('### [CK.02] 03: Three'), false);
    assert.equal(roadmap.includes('`02-01-PLAN.md`'), true);
    assert.equal(roadmap.includes('## [CK.03] v3.0 — Future'), true);
    assert.equal(out.roadmap_lines_rewritten > 0, true);
    assert.deepEqual(out.references_left_untouched, []);
  });

  test('renumbers only complete qualified identities, preserving prefixed and subphase identities byte-for-byte', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '**Depends on:** CK.02-03',
        'Boundary decoy: XCK.02-03-other',
        'Subphase decoy: CK.02-03.1',
        '',
      ],
      [
        ['CK.02-02-two', []],
        ['CK.02-03-three', []],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');

    assert.equal(roadmap.includes('**Depends on:** CK.02-02'), true);
    assert.equal(roadmap.includes('Boundary decoy: XCK.02-03-other'), true);
    assert.equal(roadmap.includes('Subphase decoy: CK.02-03.1'), true);
    assert.equal(roadmap.includes('XCK.02-02-other'), false);
    assert.equal(roadmap.includes('CK.02-02.1'), false);
  });

  test('renumbers bare artifact filenames without rewriting a filename owned by a directory path', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '**Plans:** `../CK.01-03-prior/03-01-PLAN.md`, `03-01-PLAN.md`, `03-01-SUMMARY.md`',
        '',
      ],
      [
        ['CK.01-03-prior', ['03-01-PLAN.md']],
        ['CK.02-02-two', []],
        ['CK.02-03-three', ['03-01-PLAN.md', '03-01-SUMMARY.md']],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');

    assert.equal(
      roadmap.includes('**Plans:** `../CK.01-03-prior/03-01-PLAN.md`, `02-01-PLAN.md`, `02-01-SUMMARY.md`'),
      true,
    );
    assert.equal(roadmap.includes('../CK.01-03-prior/02-01-PLAN.md'), false);
    assert.equal(fs.existsSync(planning('phases', 'CK.01-03-prior', '03-01-PLAN.md')), true);
  });

  test('rewrites only owned roadmap line classes and reports untouched phase prose', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] **[CK.02] 02: Two**',
        '- [ ] [CK.02] 03 Three',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03 (FOLLOW-UP): Three',
        '**Goal:** renumber',
        '**Depends on:** [CK.02] 03',
        '**Plans:** `03-01-PLAN.md`, `03-01-SUMMARY.md`',
        'Qualified reference: CK.02-03',
        'Phase 03 remains prose and must stay byte-identical.',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.02] 02 | 0/1 | Planned |',
        '| [CK.02] 03 | 0/1 | Planned |',
        '',
      ],
      [
        ['CK.02-02-two', []],
        ['CK.02-03-three', ['03-01-PLAN.md', '03-01-SUMMARY.md']],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const lines = splitLines(roadmap);
    const proseLine = lines.indexOf('Phase 03 remains prose and must stay byte-identical.') + 1;

    assert.equal(roadmap.includes('- [ ] **[CK.02] 02: Two**'), false);
    assert.equal(roadmap.includes('- [ ] [CK.02] 02 Three'), true);
    assert.equal(roadmap.includes('### [CK.02] 02 (FOLLOW-UP): Three'), true);
    assert.equal(roadmap.includes('**Depends on:** [CK.02] 02'), true);
    assert.equal(roadmap.includes('**Plans:** `02-01-PLAN.md`, `02-01-SUMMARY.md`'), true);
    assert.equal(roadmap.includes('Qualified reference: CK.02-02'), true);
    assert.equal(lines[proseLine - 1], 'Phase 03 remains prose and must stay byte-identical.');
    assert.equal(roadmap.includes('| [CK.02] 02 | 0/1 | Planned |'), true);
    assert.equal((roadmap.match(/^\| \[CK\.02\] 02 \|/gm) ?? []).length, 1);
    assert.equal(out.roadmap_lines_rewritten, 9);
    assert.deepEqual(out.references_left_untouched, [proseLine]);
  });

  // #4304 round-5 Blocker 1: classifyBracketOwnedLine's table-row guard and
  // bold-cell strip were regex LITERALS written with doubled backslashes
  // (`/^[ \\t]*\\|/`, `/^\\*\\*(.*)\\*\\*$/`), so the guard matched every
  // line (an empty alternation branch) and any prose line beginning with the
  // removed phase's display id was misclassified 'progress' and deleted
  // anywhere in the document — the preamble, another milestone's section, a
  // trailing '## Notes' section, all outside the active milestone. Free
  // prose is never an owned line class and must survive byte-identical; a
  // genuine (optionally bold) pipe-table row whose first cell is the
  // target's complete identity is the only thing removed, wherever it sits.
  test('leaves free prose byte-identical everywhere and deletes only genuine (bold or plain) progress rows', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '[CK.02] 02 mentioned before any milestone heading must stay untouched.',
        '',
        '## [CK.01] v1.0 — Prior',
        '',
        '[CK.02] 02 referenced from another milestone section must stay untouched.',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 03: Three',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '',
        '## Notes',
        '',
        '[CK.02] 02 was descoped; its work moved to the auth epic.',
        '[CK.02] 02: descoped (colon form)',
        '[CK.02] 02',
        'Keep: see [CK.02] 02 for history.',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| **[CK.02] 02** | 0/1 | Planned |',
        '| **[CK.02] 03** | 0/1 | Planned |',
        '',
      ],
      [
        ['CK.02-02-two', []],
        ['CK.02-03-three', []],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');

    assert.equal(
      roadmap.includes('[CK.02] 02 mentioned before any milestone heading must stay untouched.'),
      true,
    );
    assert.equal(
      roadmap.includes('[CK.02] 02 referenced from another milestone section must stay untouched.'),
      true,
    );
    assert.equal(
      roadmap.includes('[CK.02] 02 was descoped; its work moved to the auth epic.'),
      true,
    );
    assert.equal(roadmap.includes('[CK.02] 02: descoped (colon form)'), true);
    assert.equal(splitLines(roadmap).includes('[CK.02] 02'), true);
    assert.equal(roadmap.includes('Keep: see [CK.02] 02 for history.'), true);

    assert.equal(roadmap.includes('| **[CK.02] 02** | 0/1 | Planned |'), true);
    assert.equal(roadmap.includes('| **[CK.02] 03** | 0/1 | Planned |'), false);
    assert.equal((roadmap.match(/^\| \*\*\[CK\.02\] 02\*\* \|/gm) ?? []).length, 1);
  });

  // #4304 round-5 Blocker 2: renameBracketPhases renames a later phase's
  // sub-phase directories and artifact files on disk (03.01 -> 02.01), but
  // updateRoadmapAfterBracketPhaseRemoval's own token collection tracked
  // only bare integer phase numbers, so a decimal identity like
  // `[CK.02] 03.01` never got a renumber mapping entry and every ROADMAP
  // spelling of it (checklist, heading, progress row, bare artifact token)
  // was left pointing at the pre-renumber id while disk had already moved.
  // Both consumers must now come from the same identity mapping.
  test('renumbers a later phase\'s sub-phase on disk and in ROADMAP from one mapping', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 03: Three',
        '- [ ] [CK.02] 03.01: Three Sub',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '**Plans:** `03-01-PLAN.md`',
        '',
        '### [CK.02] 03.01: Three Sub',
        '**Goal:** renumber sub',
        '**Depends on:** [CK.02] 03',
        '**Plans:** `03.01-01-PLAN.md`',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.02] 01 | 0/1 | Planned |',
        '| [CK.02] 02 | 0/1 | Planned |',
        '| [CK.02] 03 | 0/1 | Planned |',
        '| [CK.02] 03.01 | 0/1 | Planned |',
        '',
      ],
      [
        ['CK.02-01-one', ['01-01-PLAN.md']],
        ['CK.02-02-two', ['02-01-PLAN.md']],
        ['CK.02-03-three', ['03-01-PLAN.md']],
        ['CK.02-03.01-three-sub', ['03.01-01-PLAN.md']],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);

    assert.deepEqual(
      fs.readdirSync(planning('phases')).sort(),
      ['CK.02-01-one', 'CK.02-02-three', 'CK.02-02.01-three-sub'],
    );
    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);
    assert.equal(
      fs.existsSync(planning('phases', 'CK.02-02.01-three-sub', '02.01-01-PLAN.md')),
      true,
    );

    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('- [ ] [CK.02] 02.01: Three Sub'), true);
    assert.equal(roadmap.includes('### [CK.02] 02.01: Three Sub'), true);
    assert.equal(roadmap.includes('**Depends on:** [CK.02] 02'), true);
    assert.equal(roadmap.includes('**Plans:** `02.01-01-PLAN.md`'), true);
    assert.equal(roadmap.includes('| [CK.02] 02.01 | 0/1 | Planned |'), true);
    assert.equal(roadmap.includes('03.01'), false);
    assert.equal(roadmap.includes('### [CK.02] 03: Three'), false);
    assert.deepEqual(out.references_left_untouched, []);
  });

  // #4304 round-5 Blocker 5: references_left_untouched re-searched the
  // PERSISTED (already-rewritten) content for pre-renumber ids, so whenever
  // two or more phases shift, a later phase's NEW value collides textually
  // with an earlier phase's OLD value and every correctly-rewritten line
  // is reported as "untouched". Computing the report from the ORIGINAL
  // line instead makes each occurrence unambiguous.
  test('does not report correctly-renumbered lines as untouched when two phases shift', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 03: Three',
        '- [ ] [CK.02] 04: Four',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '**Plans:** `03-01-PLAN.md`',
        '',
        '### [CK.02] 04: Four',
        '**Goal:** renumber',
        '**Depends on:** [CK.02] 03',
        '**Plans:** `04-01-PLAN.md`',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.02] 01 | 0/1 | Planned |',
        '| [CK.02] 02 | 0/1 | Planned |',
        '| [CK.02] 03 | 0/1 | Planned |',
        '| [CK.02] 04 | 0/1 | Planned |',
        '',
      ],
      [
        ['CK.02-01-one', ['01-01-PLAN.md']],
        ['CK.02-02-two', ['02-01-PLAN.md']],
        ['CK.02-03-three', ['03-01-PLAN.md']],
        ['CK.02-04-four', ['04-01-PLAN.md']],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');

    assert.equal(roadmap.includes('### [CK.02] 02: Three'), true);
    assert.equal(roadmap.includes('### [CK.02] 03: Four'), true);
    assert.equal(roadmap.includes('**Depends on:** [CK.02] 02'), true);
    assert.deepEqual(out.references_left_untouched, []);
  });

  // #4304 round-5 Blocker 5: dangling references to the REMOVED identity
  // (not renumbered — deleted) were missed because the check only
  // recognized the legacy "Phase NN" spelling, not the display or dash
  // qualified forms.
  test('reports dangling references to the removed identity in display and dash form', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 03: Three',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '**Depends on:** [CK.02] 02',
        'Also blocked by CK.02-02 and Phase 02.',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-03-three', []],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const lines = splitLines(roadmap);
    const dependsLine = lines.indexOf('**Depends on:** [CK.02] 02') + 1;
    const blockedLine = lines.indexOf('Also blocked by CK.02-02 and Phase 02.') + 1;

    assert.equal(roadmap.includes('**Depends on:** [CK.02] 02'), true);
    assert.equal(roadmap.includes('Also blocked by CK.02-02 and Phase 02.'), true);
    assert.deepEqual(out.references_left_untouched.sort((a, b) => a - b), [dependsLine, blockedLine].sort((a, b) => a - b));
  });

  // #4304 round-5 Blocker 5: a stale pre-renumber reference followed by
  // sentence-final punctuation or a directory-name suffix was missed
  // because the (?![\d.]) lookahead rejected any following '.', and a
  // dash-form reference embedded in a directory path (a hyphen following
  // the identity) was likewise never reported.
  test('reports pre-renumber identities left stale by sentence-final punctuation and directory-name suffixes', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 03: Three',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        'Blocked until [CK.02] 03.',
        'Dir name: CK.02-03-three',
        '**Plans:** `03-01-PLAN.md`',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-03-three', ['03-01-PLAN.md']],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const lines = splitLines(roadmap);
    const blockedLine = lines.indexOf('Blocked until [CK.02] 03.') + 1;
    const dirNameLine = lines.indexOf('Dir name: CK.02-03-three') + 1;

    // The rewrite itself is unchanged by this fix: both stale lines remain
    // byte-identical (their own stricter boundary still declines to rewrite
    // sentence-final punctuation or a directory-name-owned dash form), but
    // the bare artifact reference on the next line IS rewritten.
    assert.equal(roadmap.includes('Blocked until [CK.02] 03.'), true);
    assert.equal(roadmap.includes('Dir name: CK.02-03-three'), true);
    assert.equal(roadmap.includes('**Plans:** `02-01-PLAN.md`'), true);
    assert.deepEqual(out.references_left_untouched.sort((a, b) => a - b), [blockedLine, dirNameLine].sort((a, b) => a - b));
  });

  // #4304 round-5 W2 (fix): deleteSection removes the FIRST matching
  // heading in the whole document, not the one inside the active milestone
  // — a shipped v2.0 milestone and an active v2.1 milestone sharing the
  // same bracket code (milestoneToken folds both to [CK.02]) let a shipped
  // "## [CK.02] v2.0" section's own "### [CK.02] 02" detail heading be
  // deleted while the ACTIVE v2.1 section's own "### [CK.02] 02" survives
  // untouched, then gets duplicated by the renumber. Scope the deletion to
  // the same active-milestone ranges (primary + Phase Details) the
  // checklist-row deletion already uses.
  test('scopes detail-section deletion to the active milestone, leaving a shipped section with the same bracket code untouched', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Shipped ✅',
        '',
        '- [x] [CK.02] 01: Old One',
        '- [x] [CK.02] 02: Old Two',
        '',
        '### [CK.02] 01: Old One',
        '**Goal:** shipped',
        '',
        '### [CK.02] 02: Old Two',
        '**Goal:** shipped',
        '',
        '## [CK.02] v2.1 — Current 🚧',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 03: Three',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-03-three', []],
      ],
    );
    fs.writeFileSync(
      planning('STATE.md'),
      '---\nmilestone: v2.1\n---\n\n# State\n\n**Status:** Planning\n**Last Activity:** 2026-09-01\n',
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');

    // The shipped section's own detail heading is untouched.
    assert.equal(roadmap.includes('### [CK.02] 02: Old Two'), true);
    assert.equal(roadmap.includes('**Goal:** shipped'), true);
    const shippedSection = roadmap.slice(
      roadmap.indexOf('## [CK.02] v2.0'),
      roadmap.indexOf('## [CK.02] v2.1'),
    );
    assert.equal(shippedSection.includes('### [CK.02] 02: Old Two'), true);
    // The active section's own target heading is gone, and its later
    // sibling is renumbered — not duplicated onto the removed heading's slot.
    const activeSection = roadmap.slice(roadmap.indexOf('## [CK.02] v2.1'));
    assert.equal(activeSection.includes('### [CK.02] 02: Two'), false);
    assert.equal(activeSection.includes('**Goal:** remove'), false);
    assert.equal(activeSection.includes('### [CK.02] 02: Three'), true);
    assert.equal(activeSection.includes('### [CK.02] 03: Three'), false);
    assert.equal((activeSection.match(/^### \[CK\.02\] 02:/gm) ?? []).length, 1);
  });

  // #4304 round 6 (B1): currentMilestoneRawRanges' details-range END omitted
  // the bracketBoundary the SAME function applies to the primary range end
  // (roadmap-parser.cts:2298), so on version-less bracket milestone headings
  // the active details window ran through the NEXT sibling milestone's own
  // "(Phase Details)" section. Removal's active-range rewrite and its W2
  // pre-delete ranges both consume this window, so the sibling's own bare
  // artifact token ('**Plans:** `03-01-PLAN.md`') was rewritten to point at
  // a file that does not exist on disk.
  test('does not leak the details range into a sibling milestone when headings carry no version token', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] Current',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 03: Three',
        '',
        '## [CK.03] Future',
        '',
        '- [ ] [CK.03] 03: Future Three',
        '',
        '## [CK.02] Current (Phase Details)',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '**Plans:** `03-01-PLAN.md`',
        '',
        '## [CK.03] Future (Phase Details)',
        '',
        '### [CK.03] 03: Future Three',
        '**Goal:** untouched',
        '**Plans:** `03-01-PLAN.md`',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-03-three', ['03-01-PLAN.md']],
        ['CK.03-03-future-three', ['03-01-PLAN.md']],
      ],
    );
    fs.writeFileSync(
      planning('STATE.md'),
      '---\nmilestone: v2.0\n---\n\n# State\n\n**Status:** Planning\n**Last Activity:** 2026-09-01\n',
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);
    assert.deepEqual(out.references_left_untouched, []);

    // The sibling milestone's own Phase Details section is untouched — in
    // particular its own bare artifact token still names the file that
    // actually exists on disk, not '02-01-PLAN.md' (round 5's own W2 fix
    // already keeps the HEADING out of the leaked window; this pins the
    // bare-artifact-token rewrite the leaked window also drove).
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const ck03SectionAfter = roadmap.slice(roadmap.indexOf('## [CK.03] Future (Phase Details)'));
    assert.equal(
      ck03SectionAfter,
      [
        '## [CK.03] Future (Phase Details)',
        '',
        '### [CK.03] 03: Future Three',
        '',
        '**Goal:** untouched',
        '**Plans:** `03-01-PLAN.md`',
        '',
      ].join('\n'),
    );
    assert.equal(fs.existsSync(planning('phases', 'CK.03-03-future-three', '03-01-PLAN.md')), true);

    // The active milestone's own phase 03 correctly renumbers to 02.
    const ck02Section = roadmap.slice(
      roadmap.indexOf('## [CK.02] Current (Phase Details)'),
      roadmap.indexOf('## [CK.03] Future (Phase Details)'),
    );
    assert.equal(ck02Section.includes('### [CK.02] 02: Three'), true);
    assert.equal(ck02Section.includes('`02-01-PLAN.md`'), true);
    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);
  });

  // #4304 round 6 (W1): progress/table rows were deleted roadmap-wide with
  // no active-range check (src/phase.cts:3099-3104), so a shipped milestone
  // sharing the bracket code lost its own completed-phase row, and any
  // non-Progress table (a Requirements Traceability table) whose first cell
  // happened to be the removed identity lost its row too — even though
  // qualified-reference RENUMBERING (a different mechanism) correctly stays
  // roadmap-wide. Deletion is scoped to the active milestone's own table
  // content plus a `## Progress` section (the #2012 scope legacy already
  // uses); a table elsewhere is never touched.
  test('deletes a progress row only inside the active milestone\'s own table, never in a shipped section or an unrelated table', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Shipped ✅',
        '',
        '- [x] [CK.02] 01: Old One',
        '- [x] [CK.02] 02: Old Two',
        '',
        '### [CK.02] 02: Old Two',
        '**Goal:** shipped',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.02] 01 | 1/1 | Complete |',
        '| [CK.02] 02 | 1/1 | Complete |',
        '',
        '## [CK.02] v2.1 — Current 🚧',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 03: Three',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.02] 01 | 0/1 | Planned |',
        '| [CK.02] 02 | 0/1 | Planned |',
        '| [CK.02] 03 | 0/1 | Planned |',
        '',
        '## Requirements Traceability',
        '',
        '| Phase | Requirement | Status |',
        '| --- | --- | --- |',
        '| [CK.01] 02 | REQ-01 | Done |',
        '| [CK.02] 02 | REQ-07 | Open |',
        '| [CK.02] 03 | REQ-08 | Open |',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-03-three', []],
      ],
    );
    fs.writeFileSync(
      planning('STATE.md'),
      '---\nmilestone: v2.1\n---\n\n# State\n\n**Status:** Planning\n**Last Activity:** 2026-09-01\n',
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');

    // The shipped section's own Complete row survives byte-identical.
    assert.equal(roadmap.includes('| [CK.02] 01 | 1/1 | Complete |'), true);
    assert.equal(roadmap.includes('| [CK.02] 02 | 1/1 | Complete |'), true);

    // The active table's own target row is gone; its later sibling is
    // renumbered onto that slot, not duplicated.
    assert.equal(roadmap.includes('| [CK.02] 03 | 0/1 | Planned |'), false);
    assert.equal((roadmap.match(/^\| \[CK\.02\] 02 \| 0\/1 \| Planned \|$/gm) ?? []).length, 1);

    // The Requirements Traceability table is not a Progress table: the
    // dangling REQ-07 row (naming the just-removed identity) survives
    // byte-identical, and REQ-08's identity is renumbered like any other
    // qualified reference — its ROW is never a deletion candidate.
    assert.equal(roadmap.includes('| [CK.02] 02 | REQ-07 | Open |'), true);
    assert.equal(roadmap.includes('| [CK.02] 03 | REQ-08 | Open |'), false);
    assert.equal(roadmap.includes('| [CK.02] 02 | REQ-08 | Open |'), true);
    assert.equal(roadmap.includes('| [CK.01] 02 | REQ-01 | Done |'), true);
  });

  // #4304 round 6 (W2): removing an integer phase that has its own
  // sub-phases neither removed nor refused them (computeBracketRenumberMapping's
  // filter only ever selects phase > removedInt, never phase === removedInt) —
  // the sub-phase directories and ROADMAP rows stayed while the NEXT phase's
  // sub-phases renumbered onto the SAME identities, manufacturing duplicate
  // [CK.02] 02.01 identities on disk and in ROADMAP. Refuse before any
  // mutation, naming the orphan sub-phases.
  test('refuses removing a bracket phase that still has sub-phases, naming them, before any mutation', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 02.01: Two Sub A',
        '- [ ] [CK.02] 02.02: Two Sub B',
        '- [ ] [CK.02] 03: Three',
        '- [ ] [CK.02] 03.01: Three Sub',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] 02.01: Two Sub A',
        '**Goal:** sub of removed',
        '',
        '### [CK.02] 02.02: Two Sub B',
        '**Goal:** sub of removed',
        '',
        '### [CK.02] 03: Three',
        '**Goal:** renumber',
        '',
        '### [CK.02] 03.01: Three Sub',
        '**Goal:** renumber sub',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.02] 01 | 0/1 | Planned |',
        '| [CK.02] 02 | 0/1 | Planned |',
        '| [CK.02] 02.01 | 0/1 | Planned |',
        '| [CK.02] 02.02 | 0/1 | Planned |',
        '| [CK.02] 03 | 0/1 | Planned |',
        '| [CK.02] 03.01 | 0/1 | Planned |',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-02.01-two-sub-a', []],
        ['CK.02-02.02-two-sub-b', []],
        ['CK.02-03-three', []],
        ['CK.02-03.01-three-sub', []],
      ],
    );
    const before = snapshotTree(planning());

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);

    assert.equal(result.success, false, result.output);
    assert.match(result.error, /still has sub-phase/i);
    assert.match(result.error, /\[CK\.02\] 02\.01/);
    assert.match(result.error, /\[CK\.02\] 02\.02/);
    assert.deepEqual(snapshotTree(planning()), before);
  });

  test('removing a bracket phase\'s own sub-phase directly is unaffected by the parent-sub-phase refusal', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '- [ ] [CK.02] 02.01: Two Sub A',
        '- [ ] [CK.02] 02.02: Two Sub B',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** keep',
        '',
        '### [CK.02] 02.01: Two Sub A',
        '**Goal:** remove',
        '',
        '### [CK.02] 02.02: Two Sub B',
        '**Goal:** renumber',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-02.01-two-sub-a', []],
        ['CK.02-02.02-two-sub-b', []],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02.01', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);

    assert.equal(fs.existsSync(planning('phases', 'CK.02-02.01-two-sub-a')), false);
    assert.equal(fs.existsSync(planning('phases', 'CK.02-02.01-two-sub-b')), true);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('### [CK.02] 02.01: Two Sub B'), true);
  });

  // #4304 round 6 (W3): the read grammar admits BOTH `[CK.02] 02:` and the
  // labeled `[CK.02] Phase 02:` spelling (pinned at
  // tests/adr-612-bracket-grammar.test.cjs:644), and this PR's own owned-
  // line classifier (BRACKET_HEADING_LINE_RE et al) already admits it too —
  // but deleteSection's predicate compared heading.text against the
  // label-less display form with a literal startsWith, and
  // replaceQualifiedBracketReference matched the label-less literal
  // substring only, so a labeled removal was half-applied: rows deleted,
  // the target's own detail section kept, later phases renamed on disk
  // with NONE of their ROADMAP headings/rows renumbered.
  test('removes and fully renumbers the labeled "[CK.MM] Phase NN:" bracket spelling', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] Phase 01: One',
        '- [ ] [CK.02] Phase 02: Two',
        '- [ ] [CK.02] Phase 03: Three',
        '',
        '### [CK.02] Phase 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] Phase 02: Two',
        '**Goal:** remove',
        '',
        '### [CK.02] Phase 03: Three',
        '**Goal:** renumber',
        '**Plans:** `03-01-PLAN.md`',
        '',
        '## Progress',
        '',
        '| Phase | Plans | Status |',
        '| --- | --- | --- |',
        '| [CK.02] Phase 01 | 0/1 | Planned |',
        '| [CK.02] Phase 02 | 0/1 | Planned |',
        '| [CK.02] Phase 03 | 0/1 | Planned |',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-03-three', ['03-01-PLAN.md']],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);

    assert.deepEqual(
      fs.readdirSync(planning('phases')).sort(),
      ['CK.02-01-one', 'CK.02-02-three'],
    );
    assert.equal(fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')), true);

    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    // The target is completely gone: checklist row, detail section, progress row.
    assert.equal(roadmap.includes('- [ ] [CK.02] Phase 02: Two'), false);
    assert.equal(roadmap.includes('### [CK.02] Phase 02: Two'), false);
    assert.equal(roadmap.includes('**Goal:** remove'), false);
    // Phase 03 is fully renumbered to 02, label preserved, disk agreeing —
    // and the target's own progress row is gone (only ONE "Phase 02" row
    // remains, the renumbered one; the count assertions below pin this,
    // since the target and renumbered rows share identical placeholder text).
    assert.equal(roadmap.includes('- [ ] [CK.02] Phase 02: Three'), true);
    assert.equal(roadmap.includes('### [CK.02] Phase 02: Three'), true);
    assert.equal(roadmap.includes('### [CK.02] Phase 03: Three'), false);
    assert.equal((roadmap.match(/^### \[CK\.02\] Phase 02:/gm) ?? []).length, 1);
    assert.equal((roadmap.match(/^\| \[CK\.02\] Phase 02 \|/gm) ?? []).length, 1);
    assert.equal(roadmap.includes('`02-01-PLAN.md`'), true);
    assert.deepEqual(out.references_left_untouched, []);
  });

  // #4304 round 6 (B5 follow-up): references_left_untouched exists so the
  // report never omits a dangling reference to the removed identity.
  // bracketQualifiedMentionedInLine only ever recognized the label-less
  // display form ("[CK.02] 02"), which is not a substring of a labeled
  // mention ("[CK.02] Phase 02") — so a genuinely dangling
  // "**Depends on:** [CK.02] Phase 02" line (a phase that depended on the
  // just-removed phase, spelled in the labeled bracket form) survived the
  // removal byte-identical but was never flagged. Fixed by teaching
  // bracketQualifiedMentionedInLine the SAME optional "Phase " label
  // replaceQualifiedBracketReference already rewrites (W3), rather than a
  // second, independent label grammar.
  test('reports a dangling labeled mention of the removed identity by its persisted line number', () => {
    replaceSeed(
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] Phase 01: One',
        '- [ ] [CK.02] Phase 02: Two',
        '- [ ] [CK.02] Phase 03: Three',
        '',
        '### [CK.02] Phase 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] Phase 02: Two',
        '**Goal:** remove me',
        '',
        '### [CK.02] Phase 03: Three',
        '**Goal:** renumber',
        '**Depends on:** [CK.02] Phase 02',
        '**Plans:** `03-01-PLAN.md`',
        '',
      ],
      [
        ['CK.02-01-one', []],
        ['CK.02-02-two', []],
        ['CK.02-03-three', ['03-01-PLAN.md']],
      ],
    );

    const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);
    const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
    const lines = splitLines(roadmap);
    const dependsLine = lines.indexOf('**Depends on:** [CK.02] Phase 02') + 1;

    assert.ok(dependsLine > 0, 'the dangling Depends-on line must survive byte-identical');
    assert.equal(roadmap.includes('**Depends on:** [CK.02] Phase 02'), true);
    assert.deepEqual(out.references_left_untouched, [dependsLine]);
  });

  // #4304 round 7 (B1): the read grammar (phase-id.cts's bracketAlt, compiled
  // with `i` at roadmap-parser.cts's BRACKET_PHASE_ENTRY_HEADING_RE) and this
  // PR's own `phase insert`/`phase add` (canonicalizeBracketPhaseArgument)
  // already accept a lowercase project code ("[ck.02] 02:"), a lowercase or
  // uppercase "Phase" label ("[CK.02] phase 02:" / "[CK.02] PHASE 02:"),
  // extra internal spacing, and no space at all between the bracket and the
  // number ("[CK.02]02:") as real phases. Round 6's write-side regexes
  // (BRACKET_HEADING_LINE_RE et al, replaceQualifiedBracketReference,
  // bracketQualifiedMentionedInLine) were hand-composed case-sensitively
  // with `[ \t]+` instead of being derived from that same grammar, so
  // `phase remove` on any of these spellings deleted and renamed on disk
  // but left the target's own heading/checklist/progress row and the later
  // phase's stale number in ROADMAP, reporting references_left_untouched: []
  // over a ROADMAP that still named both the removed and the pre-rename
  // identity.
  test('removes and fully renumbers every case/spacing variant of the bracket phase spelling', () => {
    const spellings = [
      ['lower-code', (n) => `[ck.02] ${n}`],
      ['lower-label', (n) => `[CK.02] phase ${n}`],
      ['upper-label', (n) => `[CK.02] PHASE ${n}`],
      ['extra-spaces', (n) => `[CK.02]  Phase  ${n}`],
      ['no-space', (n) => `[CK.02]${n}`],
    ];
    for (const [name, spell] of spellings) {
      replaceSeed(
        [
          '# Roadmap',
          '',
          '## [CK.02] v2.0 — Current 🚧',
          '',
          `- [ ] ${spell('01')}: One`,
          `- [ ] ${spell('02')}: Two`,
          `- [ ] ${spell('03')}: Three`,
          '',
          `### ${spell('01')}: One`,
          '**Goal:** keep',
          '',
          `### ${spell('02')}: Two`,
          '**Goal:** remove',
          '',
          `### ${spell('03')}: Three`,
          '**Goal:** renumber',
          `**Depends on:** ${spell('02')}`,
          '**Plans:** `03-01-PLAN.md`',
          '',
          '## Progress',
          '',
          '| Phase | Plans | Status |',
          '| --- | --- | --- |',
          `| ${spell('01')} | 0/1 | Planned |`,
          `| ${spell('02')} | 0/1 | Planned |`,
          `| ${spell('03')} | 0/1 | Planned |`,
          '',
        ],
        [
          ['CK.02-01-one', []],
          ['CK.02-02-two', []],
          ['CK.02-03-three', ['03-01-PLAN.md']],
        ],
      );

      const result = runGsdTools(['phase', 'remove', '02', '--force'], tmpDir);
      assert.equal(result.success, true, `[${name}] ${result.error || result.output}`);
      const out = JSON.parse(result.output);

      assert.deepEqual(
        fs.readdirSync(planning('phases')).sort(),
        ['CK.02-01-one', 'CK.02-02-three'],
        `[${name}] directories`,
      );
      assert.equal(
        fs.existsSync(planning('phases', 'CK.02-02-three', '02-01-PLAN.md')),
        true,
        `[${name}] renamed artifact`,
      );

      const roadmap = fs.readFileSync(planning('ROADMAP.md'), 'utf8');
      // The target is completely gone: checklist row, detail section
      // (its own "Goal" line), and progress row — in the line's own spelling.
      assert.equal(roadmap.includes(`${spell('02')}: Two`), false, `[${name}] target gone`);
      assert.equal(roadmap.includes('**Goal:** remove'), false, `[${name}] target section gone`);
      // Phase 03 is fully renumbered to 02, spelling and case preserved,
      // disk agreeing — and the target's own row is gone (only ONE
      // instance of the renumbered heading/row survives).
      assert.equal(roadmap.includes(`### ${spell('02')}: Three`), true, `[${name}] renumbered heading`);
      assert.equal(roadmap.includes(`### ${spell('03')}: Three`), false, `[${name}] old heading gone`);
      assert.equal(roadmap.includes(`- [ ] ${spell('02')}: Three`), true, `[${name}] renumbered checklist`);
      assert.equal(
        roadmap.includes(`| ${spell('02')} | 0/1 | Planned |`),
        true,
        `[${name}] renumbered progress row`,
      );
      const headingLines = splitLines(roadmap).filter((l) => l.startsWith(`### ${spell('02')}:`));
      assert.equal(headingLines.length, 1, `[${name}] no duplicate heading`);
      const progressLines = splitLines(roadmap).filter((l) => l.startsWith(`| ${spell('02')} |`));
      assert.equal(progressLines.length, 1, `[${name}] no duplicate progress row`);

      // The only genuinely dangling reference is the "Depends on" line
      // naming the just-removed identity — never an empty report over a
      // half-applied removal.
      const lines = splitLines(roadmap);
      const dependsLine = lines.indexOf(`**Depends on:** ${spell('02')}`) + 1;
      assert.ok(dependsLine > 0, `[${name}] dangling Depends-on line must survive`);
      assert.deepEqual(out.references_left_untouched, [dependsLine], `[${name}] references_left_untouched`);
    }
  });
});
