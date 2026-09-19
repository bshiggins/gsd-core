'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

const projects = new Set();

afterEach(() => {
  for (const dir of projects) cleanup(dir);
  projects.clear();
});

function project(prefix = 'adr-612-write-') {
  const dir = createTempProject(prefix);
  projects.add(dir);
  return dir;
}

function planning(dir, ...parts) {
  return path.join(dir, '.planning', ...parts);
}

function writeConfig(dir, phaseIdConvention) {
  fs.writeFileSync(
    planning(dir, 'config.json'),
    JSON.stringify({ project_code: 'CK', phase_id_convention: phaseIdConvention }, null, 2) + '\n',
  );
}

function writeBracketFixture(dir) {
  writeConfig(dir, 'bracket');
  fs.writeFileSync(
    planning(dir, 'STATE.md'),
    [
      '---',
      'gsd_state_version: 1.0',
      'milestone: v2.0',
      'milestone_name: Foundation',
      'status: planning',
      'last_activity_desc: Roadmap created',
      '---',
      '',
      '# Project State',
      '',
      '**Current focus:** Pending',
      '**Status:** Planning',
      '**Current Phase:** 01',
      '**Current Phase Name:** Foundation',
      '**Current Plan:** 1',
      '**Total Plans in Phase:** 1',
      '**Last Activity:** 2026-09-01',
      '**Last Activity Description:** Roadmap created',
      '',
      '## Current Position',
      '',
      'Phase: 01 (Foundation) — READY TO PLAN',
      'Plan: 1 of 1',
      'Status: Planning',
      'Last activity: 2026-09-01 — Roadmap created',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    planning(dir, 'ROADMAP.md'),
    [
      '# Roadmap',
      '',
      '## [CK.02] v2.0 — Foundation',
      '',
      '### [CK.02] 01: Foundation',
      '',
      '**Goal:** Existing',
      '',
    ].join('\n'),
  );
  fs.mkdirSync(planning(dir, 'phases', 'CK.02-01-foundation'), { recursive: true });
}

function run(args, cwd) {
  const result = runGsdTools(args, cwd);
  assert.equal(result.success, true, `${args.join(' ')} failed: ${result.error || result.output}`);
  return JSON.parse(result.output);
}

describe('#4304 / ADR-612 PR-4 bracket writers', () => {
  test('phase add emits a canonical bracket heading and directory', () => {
    const dir = project();
    writeBracketFixture(dir);

    const out = run(['phase', 'add', 'User Dashboard'], dir);

    assert.equal(out.phase_number, 2);
    assert.equal(out.directory, '.planning/phases/CK.02-02-user-dashboard');
    assert.equal(fs.existsSync(planning(dir, 'phases', 'CK.02-02-user-dashboard')), true);
    assert.equal(
      fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8').includes('### [CK.02] 02: User Dashboard'),
      true,
    );
  });

  test('phase add can mint the first bracket phase in an empty milestone', () => {
    const dir = project('adr-612-first-bracket-');
    writeConfig(dir, 'bracket');
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    fs.writeFileSync(planning(dir, 'ROADMAP.md'), '# Roadmap\n\n## [CK.02] v2.0 — Foundation\n');

    const out = run(['phase', 'add', 'Foundation'], dir);

    assert.equal(out.phase_number, 1);
    assert.equal(out.directory, '.planning/phases/CK.02-01-foundation');
    const roadmap = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('### [CK.02] 01: Foundation'), true);
    assert.equal(roadmap.includes('**Depends on:** [CK.02] 00'), true);
  });

  test('bracket convention without a project code refuses instead of falling back to legacy emit', () => {
    const dir = project('adr-612-bracket-gate-');
    fs.writeFileSync(
      planning(dir, 'config.json'),
      JSON.stringify({ project_code: null, phase_id_convention: 'bracket' }, null, 2) + '\n',
    );
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    fs.writeFileSync(planning(dir, 'ROADMAP.md'), '# Roadmap\n');
    const before = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');

    const result = runGsdTools(['phase', 'add', 'Must Refuse'], dir);

    assert.equal(result.success, false);
    assert.match(result.error, /project_code is missing/);
    assert.equal(fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(planning(dir, 'phases')), []);
  });

  test('a bracket ROADMAP with only bullet-style phase rows refuses phase insert instead of falling back to legacy bullet insertion', () => {
    // #4304 review fix (Minor 3): bracket identities live in headings only
    // (cmdPhaseInsert forces isBulletStyle=false whenever bracketContext is
    // set), so a bracket ROADMAP whose only phase row is bullet-style must
    // take the checklist-only refusal path, not the legacy bullet-insertion
    // path — even though the bullet line itself matches the bracket-aware
    // bullet pattern.
    const dir = project('adr-612-bracket-bullet-only-');
    writeConfig(dir, 'bracket');
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    fs.writeFileSync(
      planning(dir, 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Foundation',
        '',
        '- [ ] [CK.02] 01: Foundation',
        '',
      ].join('\n'),
    );
    const before = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');

    const result = runGsdTools(['phase', 'insert', '01', 'Second Hotfix'], dir);

    assert.equal(result.success, false, result.error || result.output);
    assert.match(result.error, /missing a detail section/);
    assert.equal(fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(planning(dir, 'phases')), []);
  });

  // #4304 round-5 Blocker 3: the pre-flight headingMatch check ran against
  // extractCurrentMilestone's content, which merges the primary section with
  // a later "(Phase Details)" section sharing the same milestone identity —
  // so it passed even when the target's own detail heading lives ONLY in
  // that Phase Details section, separated from primary by an unrelated
  // sibling milestone. The actual header search that followed was scoped to
  // bracketSectionRanges.primary alone, so it failed AFTER platformEnsureDir
  // had already created the new phase's directory: a partial write. The
  // header search must check both ranges the round-3 remove fix already
  // discovers (primary and Phase Details), and every validation — locating
  // the header and computing the ROADMAP edit — must happen before any
  // directory is created.
  function snapshotTree(root) {
    const snapshot = [];
    (function visit(dir, rel) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const relPath = path.join(rel, entry.name);
        const absPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          snapshot.push({ type: 'directory', path: relPath });
          visit(absPath, relPath);
        } else {
          snapshot.push({ type: 'file', path: relPath, bytes: fs.readFileSync(absPath).toString('base64') });
        }
      }
    })(root, '');
    return snapshot;
  }

  test('phase insert finds the target heading in the Phase Details range across an intervening sibling milestone', () => {
    const dir = project('adr-612-bracket-insert-details-');
    writeConfig(dir, 'bracket');
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    fs.writeFileSync(
      planning(dir, 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 01: One',
        '- [ ] [CK.02] 02: Two',
        '',
        '## [CK.03] v3.0 — Future',
        '',
        '### [CK.03] 01: Future',
        '**Goal:** untouched',
        '',
        '## [CK.02] v2.0 — Current (Phase Details)',
        '',
        '### [CK.02] 01: One',
        '**Goal:** keep',
        '',
        '### [CK.02] 02: Two',
        '**Goal:** keep',
        '',
      ].join('\n'),
    );
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01-one'), { recursive: true });
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-02-two'), { recursive: true });
    fs.mkdirSync(planning(dir, 'phases', 'CK.03-01-future'), { recursive: true });

    const result = runGsdTools(['phase', 'insert', '1', 'Urgent fix'], dir);
    assert.equal(result.success, true, result.error || result.output);
    const out = JSON.parse(result.output);

    assert.equal(out.phase_number, '01.01');
    assert.equal(fs.existsSync(planning(dir, 'phases', 'CK.02-01.01-urgent-fix')), true);

    const roadmap = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('### [CK.02] 01.01: Urgent fix (INSERTED)'), true);
    const detailsSection = roadmap.slice(roadmap.indexOf('(Phase Details)'));
    assert.equal(
      detailsSection.indexOf('### [CK.02] 01.01: Urgent fix')
        < detailsSection.indexOf('### [CK.02] 02: Two'),
      true,
    );
  });

  test('an insert that fails to locate its header leaves the planning tree byte-identical', () => {
    const dir = project('adr-612-bracket-insert-refuse-');
    writeConfig(dir, 'bracket');
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    fs.writeFileSync(
      planning(dir, 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## [CK.02] v2.0 — Current',
        '',
        '- [ ] [CK.02] 09: Nine',
        '',
      ].join('\n'),
    );
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-09-nine'), { recursive: true });
    const before = snapshotTree(planning(dir));

    const result = runGsdTools(['phase', 'insert', '9', 'Urgent fix'], dir);

    assert.equal(result.success, false, result.output);
    assert.match(result.error, /missing a detail section|Could not find Phase 9 header/);
    assert.deepEqual(snapshotTree(planning(dir)), before);
  });

  test('phase add-batch allocates consecutive bracket ids', () => {
    const dir = project();
    writeBracketFixture(dir);

    const out = run(['phase', 'add-batch', '--descriptions', '["Alpha","Beta"]'], dir);

    assert.deepEqual(out.phases.map((phase) => phase.phase_number), [2, 3]);
    assert.deepEqual(
      out.phases.map((phase) => phase.directory),
      ['.planning/phases/CK.02-02-alpha', '.planning/phases/CK.02-03-beta'],
    );
    assert.deepEqual(
      fs.readdirSync(planning(dir, 'phases')).sort(),
      ['CK.02-01-foundation', 'CK.02-02-alpha', 'CK.02-03-beta'],
    );
    const roadmap = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    assert.equal(roadmap.includes('### [CK.02] 02: Alpha'), true);
    assert.equal(roadmap.includes('### [CK.02] 03: Beta'), true);
  });

  // #4304 round-5 Blocker 4: the per-description loop computed a phase
  // number, called toDir (which THROWS "slug sanitizes to empty" for a
  // description that transliterates to nothing), and immediately created
  // that item's directory — all inside one loop iteration. An item further
  // down the batch whose description sanitizes to empty therefore left
  // every EARLIER item's directory already created on disk with no ROADMAP
  // write at all, contradicting the function's own "all-or-nothing, ...
  // no phase directories created" comment.
  test('phase add-batch validates every item before the first directory is created', () => {
    const dir = project('adr-612-bracket-addbatch-partial-');
    writeBracketFixture(dir);
    const dirsBefore = fs.readdirSync(planning(dir, 'phases')).sort();
    const roadmapBefore = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');

    const result = runGsdTools(
      [
        'phase',
        'add-batch',
        '--descriptions',
        JSON.stringify(['Alpha work', 'Beta work', '日本語のみ', 'Delta work', 'Epsilon work']),
      ],
      dir,
    );

    assert.equal(result.success, false, result.output);
    assert.match(result.error, /slug sanitizes to empty|Cannot create a phase directory/);
    assert.deepEqual(fs.readdirSync(planning(dir, 'phases')).sort(), dirsBefore);
    assert.equal(fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8'), roadmapBefore);
  });

  test('phase add-batch still creates all five directories with one ROADMAP write when every item validates', () => {
    const dir = project('adr-612-bracket-addbatch-full-');
    writeBracketFixture(dir);

    const out = run(
      ['phase', 'add-batch', '--descriptions', JSON.stringify(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])],
      dir,
    );

    assert.deepEqual(out.phases.map((phase) => phase.phase_number), [2, 3, 4, 5, 6]);
    assert.deepEqual(
      fs.readdirSync(planning(dir, 'phases')).sort(),
      [
        'CK.02-01-foundation',
        'CK.02-02-alpha',
        'CK.02-03-beta',
        'CK.02-04-gamma',
        'CK.02-05-delta',
        'CK.02-06-epsilon',
      ],
    );
    const roadmap = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']) {
      assert.equal(roadmap.includes(`: ${name}`), true);
    }
  });

  test('phase insert emits the next canonical bracket subphase', () => {
    const dir = project();
    writeBracketFixture(dir);
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01.01-first'), { recursive: true });
    fs.appendFileSync(
      planning(dir, 'ROADMAP.md'),
      '### [CK.02] 01.01: First (INSERTED)\n\n**Goal:** Existing\n',
    );

    const out = run(['phase', 'insert', '01', 'Second Hotfix'], dir);

    assert.equal(out.phase_number, '01.02');
    assert.equal(out.directory, '.planning/phases/CK.02-01.02-second-hotfix');
    assert.equal(fs.existsSync(planning(dir, 'phases', 'CK.02-01.02-second-hotfix')), true);
    assert.equal(
      fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8').includes('### [CK.02] 01.02: Second Hotfix (INSERTED)'),
      true,
    );
  });

  // #4304 Blocker 2: the bracket branch validated the parent heading against
  // extractCurrentMilestone (correctly scoped to the active milestone) but
  // then located the insertion point with headerPattern against the WHOLE
  // rawContent. rawContent.match found CK.01's OWN "01:" heading first (an
  // earlier milestone sharing the same phase number), and the "next phase"
  // boundary search from there found CK.01's OWN later phase heading before
  // ever reaching CK.02 — landing the new phase BETWEEN CK.01's own phase
  // headings, so the active milestone (CK.02) never received it at all.
  test('phase insert scopes the insertion point to the active milestone when an earlier milestone shares the same phase number', () => {
    const dir = project('adr-612-bracket-cross-milestone-insert-');
    writeConfig(dir, 'bracket');
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    const roadmapBefore = [
      '# Roadmap',
      '',
      '## [CK.01] v1.0 — Prior',
      '',
      '### [CK.01] 01: Old One',
      '',
      '**Goal:** untouched',
      '',
      '### [CK.01] 02: Old Two',
      '',
      '**Goal:** also untouched',
      '',
      '## [CK.02] v2.0 — Current',
      '',
      '### [CK.02] 01: One',
      '',
      '**Goal:** keep',
      '',
    ].join('\n');
    fs.writeFileSync(planning(dir, 'ROADMAP.md'), roadmapBefore);
    fs.mkdirSync(planning(dir, 'phases', 'CK.01-01-old-one'), { recursive: true });
    fs.mkdirSync(planning(dir, 'phases', 'CK.01-02-old-two'), { recursive: true });
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01-one'), { recursive: true });

    const ck01SectionBefore = roadmapBefore.slice(
      roadmapBefore.indexOf('## [CK.01]'),
      roadmapBefore.indexOf('## [CK.02]'),
    );

    const out = run(['phase', 'insert', '01', 'Hotfix'], dir);

    assert.equal(out.phase_number, '01.01');
    assert.equal(out.directory, '.planning/phases/CK.02-01.01-hotfix');
    assert.equal(fs.existsSync(planning(dir, 'phases', 'CK.02-01.01-hotfix')), true);

    const roadmapAfter = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    const ck01SectionAfter = roadmapAfter.slice(
      roadmapAfter.indexOf('## [CK.01]'),
      roadmapAfter.indexOf('## [CK.02]'),
    );
    assert.equal(ck01SectionAfter, ck01SectionBefore);

    const ck02SectionAfter = roadmapAfter.slice(roadmapAfter.indexOf('## [CK.02]'));
    assert.equal(ck02SectionAfter.includes('### [CK.02] 01.01: Hotfix (INSERTED)'), true);
    assert.equal(roadmapAfter.includes('### [CK.01] 01.01'), false);
  });

  // #4304 follow-up: the ADR-612 canonical milestone heading carries no vX.Y
  // token at all (`## [GSD.09] Hidden`) — currentMilestoneRawRanges must
  // scope the insertion point for this shape too, not only the vX.Y-bearing
  // shape every other fixture in this file uses.
  test('phase insert scopes the insertion point to the active milestone when milestone headings carry no version token', () => {
    const dir = project('adr-612-bracket-versionless-insert-');
    writeConfig(dir, 'bracket');
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    const roadmapBefore = [
      '# Roadmap',
      '',
      '## [CK.01] Prior',
      '',
      '### [CK.01] 01: Old One',
      '',
      '**Goal:** untouched',
      '',
      '### [CK.01] 02: Old Two',
      '',
      '**Goal:** also untouched',
      '',
      '## [CK.02] Current',
      '',
      '### [CK.02] 01: One',
      '',
      '**Goal:** keep',
      '',
    ].join('\n');
    fs.writeFileSync(planning(dir, 'ROADMAP.md'), roadmapBefore);
    fs.mkdirSync(planning(dir, 'phases', 'CK.01-01-old-one'), { recursive: true });
    fs.mkdirSync(planning(dir, 'phases', 'CK.01-02-old-two'), { recursive: true });
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01-one'), { recursive: true });

    const ck01SectionBefore = roadmapBefore.slice(
      roadmapBefore.indexOf('## [CK.01]'),
      roadmapBefore.indexOf('## [CK.02]'),
    );

    const out = run(['phase', 'insert', '01', 'Hotfix'], dir);

    assert.equal(out.phase_number, '01.01');
    assert.equal(out.directory, '.planning/phases/CK.02-01.01-hotfix');
    assert.equal(fs.existsSync(planning(dir, 'phases', 'CK.02-01.01-hotfix')), true);

    const roadmapAfter = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    const ck01SectionAfter = roadmapAfter.slice(
      roadmapAfter.indexOf('## [CK.01]'),
      roadmapAfter.indexOf('## [CK.02]'),
    );
    assert.equal(ck01SectionAfter, ck01SectionBefore);

    const ck02SectionAfter = roadmapAfter.slice(roadmapAfter.indexOf('## [CK.02]'));
    assert.equal(ck02SectionAfter.includes('### [CK.02] 01.01: Hotfix (INSERTED)'), true);
    assert.equal(roadmapAfter.includes('### [CK.01] 01.01'), false);
  });

  test('phase insert --sibling allocates the next bracket subphase at the parent level', () => {
    const dir = project('adr-612-bracket-sibling-insert-');
    writeBracketFixture(dir);
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01.01-first'), { recursive: true });
    fs.appendFileSync(
      planning(dir, 'ROADMAP.md'),
      '### [CK.02] 01.02: Second (INSERTED)\n\n**Goal:** Existing\n',
    );

    const out = run(['phase', 'insert', '01.02', 'Sibling Hotfix', '--sibling'], dir);

    assert.equal(out.phase_number, '01.03');
    assert.equal(out.directory, '.planning/phases/CK.02-01.03-sibling-hotfix');
    assert.equal(fs.existsSync(planning(dir, 'phases', 'CK.02-01.03-sibling-hotfix')), true);
    assert.equal(
      fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8')
        .includes('### [CK.02] 01.03: Sibling Hotfix (INSERTED)'),
      true,
    );
  });

  // #4304 round-5 W4 (fix): `phase insert 1.1` normalized its bare argument
  // through the legacy normalizePhaseName, which pads only the FIRST
  // segment ("1.1" -> "01.1") and never matches the bracket-canonical
  // "01.01" heading, so it errored "Phase 1.1 not found" even though
  // `phase remove 1.1` (via phaseToken) resolves the very same phase.
  // `phase insert 01.01` (default nested) died with an uncaught
  // "toDir: invalid phase" throw instead of a clean refusal, because
  // nesting one level under an already-decimal phase produces a
  // three-level id bracket cannot represent. Both spellings now
  // canonicalize identically (through phaseToken, like remove) and both
  // refuse cleanly with the SAME message naming the correctly-resolved
  // "01.01" — proving canonicalization found the real phase rather than
  // reporting it missing.
  test('phase insert canonicalizes a bare decimal argument the way phase remove does', () => {
    const dir = project('adr-612-bracket-insert-decimal-canon-');
    writeBracketFixture(dir);
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01.01-first-sub'), { recursive: true });
    fs.appendFileSync(
      planning(dir, 'ROADMAP.md'),
      '### [CK.02] 01.01: First Sub (INSERTED)\n\n**Goal:** Existing\n',
    );
    const before = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    const dirsBefore = fs.readdirSync(planning(dir, 'phases')).sort();

    const bare = runGsdTools(['phase', 'insert', '1.1', 'Urgent fix'], dir);
    const padded = runGsdTools(['phase', 'insert', '01.01', 'Urgent fix'], dir);

    assert.equal(bare.success, false, bare.output);
    assert.equal(padded.success, false, padded.output);
    assert.match(bare.error, /01\.01/);
    assert.match(padded.error, /01\.01/);
    assert.doesNotMatch(bare.error, /not found/i);
    assert.match(bare.error, /decimal level/i);
    assert.match(padded.error, /decimal level/i);
    assert.equal(bare.error, padded.error);
    assert.equal(fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8'), before);
    assert.equal(fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(planning(dir, 'phases')).sort(), dirsBefore);
  });

  test('phase insert --sibling under a decimal afterPhase still succeeds (only nested three-level ids are refused)', () => {
    const dir = project('adr-612-bracket-insert-decimal-sibling-');
    writeBracketFixture(dir);
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01.01-first-sub'), { recursive: true });
    fs.appendFileSync(
      planning(dir, 'ROADMAP.md'),
      '### [CK.02] 01.01: First Sub (INSERTED)\n\n**Goal:** Existing\n',
    );

    const out = run(['phase', 'insert', '1.1', 'Second Sub', '--sibling'], dir);

    assert.equal(out.phase_number, '01.02');
    assert.equal(fs.existsSync(planning(dir, 'phases', 'CK.02-01.02-second-sub')), true);
  });

  test('state descriptive writes use bracket display while operational fields stay compatible', () => {
    const dir = project();
    writeBracketFixture(dir);

    run(['state', 'begin-phase', '--phase', '02', '--name', 'User Dashboard', '--plans', '2'], dir);

    const state = fs.readFileSync(planning(dir, 'STATE.md'), 'utf8');
    assert.equal(state.includes('**Last Activity Description:** [CK.02] 02 execution started'), true);
    assert.equal(state.includes('**Current focus:** [CK.02] 02 — User Dashboard'), true);
    assert.equal(state.includes('**Current Phase:** 02'), true);
    assert.equal(state.includes('**Status:** Executing Phase 02'), true);
    assert.equal(state.includes('Status: Executing Phase 02'), true);
    assert.match(state, /Last activity: \d{4}-\d{2}-\d{2} — \[CK\.02\] 02 execution started/);
    assert.equal(state.includes('Phase: 02 (User Dashboard) — EXECUTING'), true);
  });

  test('a repeated bracket begin-phase is a resume and preserves mid-flight counters', () => {
    const dir = project('adr-612-state-resume-');
    writeBracketFixture(dir);
    run(['state', 'begin-phase', '--phase', '02', '--name', 'User Dashboard', '--plans', '2'], dir);

    const statePath = planning(dir, 'STATE.md');
    fs.writeFileSync(
      statePath,
      fs.readFileSync(statePath, 'utf8').replace('**Current Plan:** 1', '**Current Plan:** 2'),
    );

    run(['state', 'begin-phase', '--phase', '02', '--name', 'Ignored Resume Name', '--plans', '9'], dir);
    const resumed = fs.readFileSync(statePath, 'utf8');
    assert.equal(resumed.includes('**Status:** Executing Phase 02'), true);
    assert.equal(resumed.includes('**Current Plan:** 2'), true);
    assert.equal(resumed.includes('**Total Plans in Phase:** 2'), true);
    assert.equal(resumed.includes('**Current Phase Name:** User Dashboard'), true);
    assert.match(resumed, /Last activity: \d{4}-\d{2}-\d{2} — \[CK\.02\] 02 execution resumed/);
  });

  test('state planned-phase and complete-phase descriptions use bracket display', () => {
    const plannedDir = project('adr-612-state-planned-');
    writeBracketFixture(plannedDir);
    const plannedStatePath = planning(plannedDir, 'STATE.md');
    fs.writeFileSync(
      plannedStatePath,
      fs.readFileSync(plannedStatePath, 'utf8')
        .replace('Last activity: 2026-09-01 — Roadmap created', 'Last activity: 2026-09-01'),
    );
    run(['state', 'planned-phase', '--phase', '02', '--name', 'User Dashboard', '--plans', '2'], plannedDir);
    assert.equal(
      fs.readFileSync(planning(plannedDir, 'STATE.md'), 'utf8')
        .includes('**Last Activity Description:** [CK.02] 02 planning complete — 2 plans ready'),
      true,
    );
    assert.match(
      fs.readFileSync(planning(plannedDir, 'STATE.md'), 'utf8'),
      /Last activity: \d{4}-\d{2}-\d{2} — \[CK\.02\] 02 planning complete/,
    );

    const completeDir = project('adr-612-state-complete-');
    writeBracketFixture(completeDir);
    run(['state', 'begin-phase', '--phase', '02', '--name', 'User Dashboard', '--plans', '2'], completeDir);
    run(['state', 'complete-phase', '--phase', '02'], completeDir);
    const completed = fs.readFileSync(planning(completeDir, 'STATE.md'), 'utf8');
    assert.equal(completed.includes('**Last Activity Description:** [CK.02] 02 marked complete'), true);
    assert.equal(completed.includes('**Status:** Phase 02 complete'), true);
    assert.equal(completed.includes('Status: Phase 02 complete'), true);
    assert.match(completed, /Last activity: \d{4}-\d{2}-\d{2} — \[CK\.02\] 02 marked complete/);
    assert.equal(completed.includes('Phase: 02 — COMPLETE'), true);
  });

  test('a state write materializes milestone frontmatter from the active ROADMAP milestone', () => {
    const dir = project('adr-612-state-milestone-');
    writeBracketFixture(dir);
    const statePath = planning(dir, 'STATE.md');
    const withoutMilestone = fs.readFileSync(statePath, 'utf8')
      .replace('milestone: v2.0\n', '')
      .replace('milestone_name: Foundation\n', '');
    fs.writeFileSync(statePath, withoutMilestone);

    run(['state', 'begin-phase', '--phase', '01', '--name', 'Foundation', '--plans', '1'], dir);

    const state = fs.readFileSync(statePath, 'utf8');
    assert.equal(state.includes('milestone: v2.0'), true);
    assert.equal(JSON.parse(runGsdTools(['state', 'json'], dir).output).milestone, 'v2.0');
  });

  // #4304 round-3 Blocker 2: phaseEntryInsertOffset called currentMilestoneRawRanges
  // without the resolved convention, so on version-less bracket headings
  // (`## [CK.02] Current` followed by `## [CK.03] Future`) it got null and
  // fell back to whole-document insertion (past CK.03, at EOF) instead of
  // the active milestone's own end.
  function versionlessTwoMilestoneRoadmap() {
    return [
      '# Roadmap',
      '',
      '## [CK.02] Current',
      '',
      '### [CK.02] 01: One',
      '',
      '**Goal:** keep',
      '',
      '## [CK.03] Future',
      '',
      '### [CK.03] 01: Later',
      '',
      '**Goal:** untouched',
      '',
    ].join('\n');
  }

  test('phase add scopes the insertion point to the active milestone when milestone headings carry no version token', () => {
    const dir = project('adr-612-bracket-versionless-add-');
    writeConfig(dir, 'bracket');
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    const roadmapBefore = versionlessTwoMilestoneRoadmap();
    fs.writeFileSync(planning(dir, 'ROADMAP.md'), roadmapBefore);
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01-one'), { recursive: true });
    fs.mkdirSync(planning(dir, 'phases', 'CK.03-01-later'), { recursive: true });

    const ck03SectionBefore = roadmapBefore.slice(roadmapBefore.indexOf('## [CK.03]'));

    const out = run(['phase', 'add', 'Two'], dir);

    assert.equal(out.phase_number, 2);
    assert.equal(out.directory, '.planning/phases/CK.02-02-two');
    assert.equal(fs.existsSync(planning(dir, 'phases', 'CK.02-02-two')), true);

    const roadmapAfter = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    const ck03SectionAfter = roadmapAfter.slice(roadmapAfter.indexOf('## [CK.03]'));
    assert.equal(ck03SectionAfter, ck03SectionBefore);

    const ck02SectionAfter = roadmapAfter.slice(
      roadmapAfter.indexOf('## [CK.02]'),
      roadmapAfter.indexOf('## [CK.03]'),
    );
    assert.equal(ck02SectionAfter.includes('### [CK.02] 02: Two'), true);
  });

  test('phase add-batch scopes the insertion point to the active milestone when milestone headings carry no version token', () => {
    const dir = project('adr-612-bracket-versionless-addbatch-');
    writeConfig(dir, 'bracket');
    fs.writeFileSync(planning(dir, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
    const roadmapBefore = versionlessTwoMilestoneRoadmap();
    fs.writeFileSync(planning(dir, 'ROADMAP.md'), roadmapBefore);
    fs.mkdirSync(planning(dir, 'phases', 'CK.02-01-one'), { recursive: true });
    fs.mkdirSync(planning(dir, 'phases', 'CK.03-01-later'), { recursive: true });

    const ck03SectionBefore = roadmapBefore.slice(roadmapBefore.indexOf('## [CK.03]'));

    const out = run(['phase', 'add-batch', '--descriptions', '["Two","Three"]'], dir);

    assert.deepEqual(out.phases.map((phase) => phase.phase_number), [2, 3]);
    assert.deepEqual(
      out.phases.map((phase) => phase.directory),
      ['.planning/phases/CK.02-02-two', '.planning/phases/CK.02-03-three'],
    );

    const roadmapAfter = fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8');
    const ck03SectionAfter = roadmapAfter.slice(roadmapAfter.indexOf('## [CK.03]'));
    assert.equal(ck03SectionAfter, ck03SectionBefore);

    const ck02SectionAfter = roadmapAfter.slice(
      roadmapAfter.indexOf('## [CK.02]'),
      roadmapAfter.indexOf('## [CK.03]'),
    );
    assert.equal(ck02SectionAfter.includes('### [CK.02] 02: Two'), true);
    assert.equal(ck02SectionAfter.includes('### [CK.02] 03: Three'), true);
  });
});

const LEGACY_ROADMAP_BYTES = '# Roadmap\n\n'
  + '### Phase 1: Foundation\n\n'
  + '**Goal:** Existing\n\n'
  + '### Phase 01.1: Hotfix (INSERTED)\n\n'
  + '**Goal:** [Urgent work - to be planned]\n'
  + '**Requirements**: TBD\n'
  + '**Depends on:** Phase 1\n'
  + '**Plans:** 0 plans\n\n'
  + 'Plans:\n'
  + '- [ ] TBD (run /gsd-plan-phase 01.1 to break down)\n\n'
  + '### Phase 2: Second\n\n'
  + '**Goal:** [To be planned]\n'
  + '**Requirements**: TBD\n'
  + '**Depends on:** Phase 1\n'
  + '**Plans:** 0 plans\n\n'
  + 'Plans:\n'
  + '- [ ] TBD (run /gsd-plan-phase 2 to break down)\n\n'
  + '### Phase 3: Third\n\n'
  + '**Goal:** [To be planned]\n'
  + '**Requirements**: TBD\n'
  + '**Depends on:** Phase 2\n'
  + '**Plans:** 0 plans\n\n'
  + 'Plans:\n'
  + '- [ ] TBD (run /gsd-plan-phase 3 to break down)\n\n'
  + '### Phase 4: Fourth\n\n'
  + '**Goal:** [To be planned]\n'
  + '**Requirements**: TBD\n'
  + '**Depends on:** Phase 3\n'
  + '**Plans:** 0 plans\n\n'
  + 'Plans:\n'
  + '- [ ] TBD (run /gsd-plan-phase 4 to break down)\n';

for (const convention of [null, 'sequential', 'milestone-prefixed']) {
  test(`#4304 byte identity: ${String(convention)} preserves phase add/add-batch/insert output`, () => {
    const dir = project('adr-612-legacy-bytes-');
    writeConfig(dir, convention);
    fs.writeFileSync(
      planning(dir, 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Foundation\n**Goal:** Existing\n',
    );

    const add = run(['phase', 'add', 'Second'], dir);
    const batch = run(['phase', 'add-batch', '--descriptions', '["Third","Fourth"]'], dir);
    const insert = run(['phase', 'insert', '1', 'Hotfix'], dir);

    assert.deepEqual(
      [add.phase_number, batch.phases.map((phase) => phase.phase_number), insert.phase_number],
      [2, [3, 4], '01.1'],
    );
    assert.equal(fs.readFileSync(planning(dir, 'ROADMAP.md'), 'utf8'), LEGACY_ROADMAP_BYTES);
    assert.deepEqual(
      fs.readdirSync(planning(dir, 'phases')).sort(),
      ['CK-01.1-hotfix', 'CK-02-second', 'CK-03-third', 'CK-04-fourth'],
    );
  });
}
