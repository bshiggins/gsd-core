'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

let tmpDir;

const planning = (...parts) => path.join(tmpDir, '.planning', ...parts);

function makePhaseDir(name, files = []) {
  const dir = planning('phases', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file), '# artifact\n');
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
});
