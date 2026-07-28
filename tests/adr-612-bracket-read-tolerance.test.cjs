'use strict';

/**
 * PR-2 (#2761 / epic #612) — the bracket-tolerant READ path.
 *
 * ADR-612 Decision 2: "reads remain tolerant of all forms during the migration
 * window; read-tolerance is not a second active convention." Every heading and
 * checklist matcher on the read path therefore widens UNGATED, resting on the
 * superset property proved in tests/adr-612-bracket-heading-tolerance.test.cjs
 * (the widened intro admits exactly one shape the old one didn't — `[CODE.MM]`
 * followed by a digit-leading token — which a legacy ROADMAP cannot contain).
 *
 * Two things this file is built to catch, both of which fail SILENTLY:
 *
 *   1. The sentinel leak. Before the widening, `### [GSD.999] 01: Icebox` did
 *      not match any reader, so it was excluded by accident. After it, the
 *      heading matches and — because every sentinel filter tests the phase
 *      TOKEN, while READING-B puts the sentinel milestone in the BRACKET — an
 *      icebox item becomes a real phase. That inflates phase_count and
 *      missingDetails with no error, reopening the #1445 / #1580 bug class.
 *
 *   2. The capture-group shift. Sites that route sentinels use the CAPTURING
 *      heading intro, which inserts the bracket id at group 1 and pushes the
 *      token to group 2 and the name to group 3. A missed shift garbles the
 *      phase NAME before it garbles the count, so every assertion here checks
 *      the name as well as the number.
 *
 * All assertions are BEHAVIORAL: drive the real CLI over a real ROADMAP on
 * disk and assert the emitted JSON. Fixtures are raw template strings — never
 * rendered through renderPhaseId/toDir, which would only prove the code agrees
 * with itself.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

let tmpDir;

const writeRoadmap = (content) =>
  fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), content, 'utf-8');

const analyze = () => {
  const result = runGsdTools(['roadmap', 'analyze'], tmpDir);
  assert.ok(result.success, `roadmap analyze failed: ${result.error}`);
  return JSON.parse(result.output);
};

// ─── A bracket ROADMAP, written as raw markdown ────────────────────────────
const BRACKET_ROADMAP = `# Roadmap

## [GSD.02] v2.0 — Foundation

- [x] **[GSD.02] 01: Setup**
- [ ] **[GSD.02] 05: Real work**
- [ ] **[GSD.02] 06: Follow-up**

### [GSD.02] 01: Setup
**Goal:** Lay the groundwork

### [GSD.02] 05: Real work
**Goal:** Build the thing

### [GSD.02] 06: Follow-up
**Goal:** Polish it
`;

describe('#612 PR-2: roadmap analyze reads bracket phase headings', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-read-'); });
  afterEach(() => { cleanup(tmpDir); });

  test('counts every bracket phase and reads its NAME from the right group', () => {
    writeRoadmap(BRACKET_ROADMAP);
    const out = analyze();
    assert.equal(out.phase_count, 3, 'all three bracket phases counted');
    assert.deepEqual(
      out.phases.map(p => [p.number, p.name]),
      [['01', 'Setup'], ['05', 'Real work'], ['06', 'Follow-up']],
      'number AND name — a capture-group shift garbles the name first',
    );
  });

  test('reads the Goal out of each bracket section (heading is a section boundary)', () => {
    writeRoadmap(BRACKET_ROADMAP);
    const out = analyze();
    assert.deepEqual(
      out.phases.map(p => p.goal),
      ['Lay the groundwork', 'Build the thing', 'Polish it'],
      'a bracket heading must terminate the preceding section',
    );
  });

  test('reads the summary-checkbox completion state through a bracket bullet', () => {
    writeRoadmap(BRACKET_ROADMAP);
    const out = analyze();
    assert.deepEqual(
      out.phases.map(p => p.roadmap_complete),
      [true, false, false],
      'the `- [x] **[GSD.02] 01: …**` bullet marks phase 01 complete',
    );
  });
});

// ─── The sentinel leak (§1.6) ──────────────────────────────────────────────

describe('#612 PR-2: bracket sentinel milestones are excluded, not counted', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-sentinel-'); });
  afterEach(() => { cleanup(tmpDir); });

  // The #1445 fixture shape, translated to bracket: under READING-B the
  // sentinel integer lives in the bracket, so `### [GSD.999] 01:` is an ICEBOX
  // item and `### [GSD.00] 01:` is PRE-MILESTONE — neither is a real phase.
  const SENTINEL_ROADMAP = `# Roadmap

## [GSD.999] Backlog

- [ ] **[GSD.999] 01: Icebox item**

### [GSD.999] 01: Icebox item
**Goal:** Someday

## [GSD.00] Pre-milestone

### [GSD.00] 01: Groundwork
**Goal:** Before v1

## [GSD.02] v2.0

- [ ] **[GSD.02] 05: Real work**

### [GSD.02] 05: Real work
**Goal:** Build the thing
`;

  test('a 999 bracket phase does not enter phase_count', () => {
    writeRoadmap(SENTINEL_ROADMAP);
    const out = analyze();
    const numbers = out.phases.map(p => `${p.number}:${p.name}`);
    assert.equal(
      out.phase_count, 1,
      `only the real phase counts; got ${JSON.stringify(numbers)}`,
    );
    assert.deepEqual(numbers, ['05:Real work']);
  });

  test('a 0 bracket phase (pre-milestone) does not enter phase_count either', () => {
    writeRoadmap(SENTINEL_ROADMAP);
    const out = analyze();
    assert.ok(
      !out.phases.some(p => p.name === 'Groundwork'),
      'the [GSD.00] pre-milestone phase must not be surfaced',
    );
  });

  test('a 999 bracket checklist entry does not become a missing-detail phantom', () => {
    // The icebox bullet has a detail section, so it would not show here anyway;
    // strip the detail sections to isolate the missingDetails filter.
    writeRoadmap(`# Roadmap

## [GSD.02] v2.0

- [ ] **[GSD.999] 01: Icebox item**
- [ ] **[GSD.02] 07: Genuinely missing**
- [ ] **[GSD.02] 05: Real work**

### [GSD.02] 05: Real work
**Goal:** Build the thing
`);
    const out = analyze();
    assert.deepEqual(
      out.missing_phase_details, ['07'],
      'the icebox bullet must not be reported as a missing detail section',
    );
  });

  test('a 999 bracket phase is still excluded when it is the ONLY heading', () => {
    writeRoadmap(`# Roadmap

## [GSD.999] Backlog

### [GSD.999] 01: Icebox item
**Goal:** Someday
`);
    const out = analyze();
    assert.equal(out.phase_count, 0, 'an all-icebox roadmap has zero real phases');
  });

  test('legacy sentinel filtering is unchanged', () => {
    writeRoadmap(`# Roadmap

## v2.0

### Phase 999.1: Icebox item
**Goal:** Someday

### Phase 0: Pre-milestone
**Goal:** Before v1

### Phase 5: Real work
**Goal:** Build the thing
`);
    const out = analyze();
    assert.deepEqual(out.phases.map(p => p.number), ['5'], 'legacy 0/999 still excluded');
  });

  test('a REAL phase numbered 999 under a real milestone still counts (READING-B)', () => {
    // The sentinel is the MILESTONE, not the token — `[GSD.02] 999` is phase 999
    // of milestone 2, which is a real (if unusual) phase. Pinned so the bracket
    // filter is not quietly re-implemented as a token test.
    writeRoadmap(`# Roadmap

## [GSD.02] v2.0

### [GSD.02] 999: Late work
**Goal:** Build the thing
`);
    const out = analyze();
    assert.deepEqual(out.phases.map(p => [p.number, p.name]), [['999', 'Late work']]);
  });
});

// ─── get-phase resolution through the widened heading + checklist reads ─────

describe('#612 PR-2: roadmap get-phase resolves a bracket heading', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-getphase-'); });
  afterEach(() => { cleanup(tmpDir); });

  test('a bare phase token resolves its bracket detail section', () => {
    writeRoadmap(BRACKET_ROADMAP);
    const result = runGsdTools(['roadmap', 'get-phase', '05'], tmpDir);
    assert.ok(result.success, `get-phase failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.equal(out.found, true, 'the bracket heading must resolve');
    assert.equal(out.phase_name, 'Real work');
    assert.equal(out.goal, 'Build the thing');
  });

  test('a checklist-only bracket phase reports malformed_roadmap, not "not found"', () => {
    writeRoadmap(`# Roadmap

## [GSD.02] v2.0

- [ ] **[GSD.02] 09: Summary only**

### [GSD.02] 05: Real work
**Goal:** Build the thing
`);
    const result = runGsdTools(['roadmap', 'get-phase', '09'], tmpDir);
    assert.ok(result.success, `get-phase failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.equal(out.found, false);
    assert.equal(out.error, 'malformed_roadmap');
    assert.equal(out.phase_name, 'Summary only');
  });
});

// ─── The byte-untouched control ────────────────────────────────────────────

describe('#612 PR-2: a legacy ROADMAP reads exactly as before', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-legacy-'); });
  afterEach(() => { cleanup(tmpDir); });

  test('legacy headings, checklists, tags and non-phase sections are unaffected', () => {
    writeRoadmap(`# Roadmap

## v1.0 — Foundation

## Phase Overview:

- [x] **Phase 1: Foundation**
- [ ] **Phase 2-01: API**
- [ ] **Phase 12A: Hotfix**

### Phase 1: Foundation
**Goal:** Set up

### Phase 2-01 (INSERTED): API
**Goal:** Build it

### Phase 12A: Hotfix
**Goal:** Patch it

#### Phase Details:
`);
    const out = analyze();
    assert.deepEqual(
      out.phases.map(p => [p.number, p.name]),
      [['1', 'Foundation'], ['2-01', 'API'], ['12A', 'Hotfix']],
      'pure-word section headings stay excluded; tags still tolerated',
    );
    assert.deepEqual(
      out.phases.map(p => p.roadmap_complete), [true, false, false],
    );
  });

  test('a bracket-SHAPED but non-phase legacy heading creates no phantom phase', () => {
    // `## [v1.0] Overview:` — the bracket content matches `{CODE}.{MM}` under
    // the /i flag every reader uses. Only the digit-leading requirement on the
    // token keeps it out.
    writeRoadmap(`# Roadmap

## v1.0

## [v1.0] Overview:

## [Cluster B] Overview:

### Phase 5: Real work
**Goal:** Build the thing
`);
    const out = analyze();
    assert.deepEqual(out.phases.map(p => p.number), ['5'], 'no phantom phase');
  });
});

// ─── validate.cts heading + checklist variants (W006 / W007 feeders) ────────

describe('#612 PR-2: buildRoadmapPhaseVariants reads bracket headings', () => {
  // These helpers carry the LETTER-TOLERANT capture class `[\w][\w.-]*`. That is
  // the only place a phantom phase is reachable at all — the roadmap.cts and
  // state.cts scanners capture digit-leading tokens and cannot produce one no
  // matter how loose the intro is. So the phantom negatives belong HERE, driven
  // through the real helper, not through `roadmap analyze`.
  const validate = require('../gsd-core/bin/lib/validate.cjs');

  test('a bracket phase heading enters roadmapPhases', () => {
    const { roadmapPhases } = validate.buildRoadmapPhaseVariants(
      '### [GSD.02] 05: Real work\n### [GSD.02] 06: Follow-up\n',
    );
    assert.deepEqual([...roadmapPhases].sort(), ['05', '06']);
  });

  test('PHANTOM NEGATIVE: a CODE.MM-shaped bracket + WORD never enters roadmapPhases', () => {
    // Without the owner's digit-leading requirement each of these lands in
    // roadmapPhases and then drives a W007 "Phase X in ROADMAP.md but no
    // directory on disk" warning on a repo that never opted into bracket.
    const { roadmapPhases } = validate.buildRoadmapPhaseVariants(
      [
        '## [v1.0] Overview:',
        '## [Cluster B] Overview:',
        '## [RFC.7] Discussion:',
        '## [GSD.02] Summary:',
        '### Phase 5: Real work',
      ].join('\n'),
    );
    assert.deepEqual([...roadmapPhases], ['5'], 'only the real legacy phase');
  });

  test('legacy headings and checklist bullets are byte-identical', () => {
    const { roadmapPhases } = validate.buildRoadmapPhaseVariants(
      [
        '### Phase 1: Foundation',
        '### Phase 2-01 (INSERTED): API',
        '### Phase 12A: Hotfix',
        '#### Phase Details:',
        '- [x] **Phase 3: Done**',
        '- [ ] **Phase 4: Todo**',
      ].join('\n'),
    );
    assert.deepEqual(
      [...roadmapPhases].sort(),
      ['1', '12A', '2-01', '3', '4', 'Details'].sort(),
      'including the pre-existing `Details` tolerance, which must not change',
    );
  });

  test('MINIMAL-ADDITIVE: a bullet site does NOT gain any-bracket tolerance', () => {
    // The checklist bullets spell a BARE `Phase\s+` today — no bracket tolerance
    // at all. Handing them the full heading grammar would retro-grant
    // `- [x] **[GSD] Phase 2-01: …**`, which does not match today. It must stay
    // unmatched; only the bracket-ID form is newly admitted.
    const { roadmapPhases } = validate.buildRoadmapPhaseVariants(
      '- [x] **[GSD] Phase 2-01: Legacy**\n- [ ] **[GSD.02] 07: Bracket**\n',
    );
    assert.deepEqual([...roadmapPhases], ['07'], 'bracket ID yes, any-bracket no');
  });

  test('buildNotStartedPhaseVariants picks up unchecked bracket bullets', () => {
    const notStarted = validate.buildNotStartedPhaseVariants(
      '- [ ] **[GSD.02] 05: Real work**\n- [x] **[GSD.02] 01: Done**\n',
    );
    assert.ok(notStarted.has('05'), 'the unchecked bracket bullet is not-started');
    assert.ok(!notStarted.has('01'), 'the checked one is not');
  });

  test('buildNotStartedPhaseVariants keeps legacy bullets byte-identical', () => {
    const before = validate.buildNotStartedPhaseVariants(
      '- [ ] **Phase 5: Name**\n- [ ] Phase 6 draft\n- [ ] **[GSD] Phase 2-01: Legacy**\n',
    );
    assert.deepEqual(
      [...before].sort(), ['05', '5', '06', '6'].sort(),
      'the any-bracket bullet stays unmatched, exactly as today',
    );
  });
});

// ─── validate.cts DIRECTORY recognition (convention-gated) ─────────────────

describe('#612 PR-2: bracket phase-directory recognition is convention-gated', () => {
  const validate = require('../gsd-core/bin/lib/validate.cjs');

  // The legacy corpus. Every one of these must answer identically through the
  // new functions (any convention) and through the untouched constants — the
  // functions delegate, so this is byte-identical by construction, and this
  // probe is the assertion that keeps it that way.
  const LEGACY_DIRS = [
    '02-01-setup', '01-setup', 'GSD-02-01-setup', '999.1-backlog',
    '14-2026-photos', '02-04-01-deep', '12A-hotfix', 'not-a-phase',
    'P0.34-56-name', 'P0.12-34-name', 'P0.3-2-tenant', 'P0.16-gate',
  ];

  test('(c) legacy dirs answer identically to the untouched constants', () => {
    for (const d of LEGACY_DIRS) {
      assert.equal(
        validate.isPhaseDirName(d), validate.phaseDirNameRe.test(d),
        `isPhaseDirName diverged from phaseDirNameRe on ${d}`,
      );
      const viaConst = d.match(validate.PHASE_TOKEN_FROM_DIR_RE);
      assert.equal(
        validate.phaseTokenFromDir(d), viaConst ? viaConst[1] : null,
        `phaseTokenFromDir diverged from PHASE_TOKEN_FROM_DIR_RE on ${d}`,
      );
    }
  });

  test('(c) a genuinely-legacy dir answers identically UNDER bracket too', () => {
    // A bracket repo carries legacy directories mid-migration; they must keep
    // resolving. Only the ambiguous `{CODE}.{DD,}-` family is expected to differ.
    const unambiguous = LEGACY_DIRS.filter(d => !/^[A-Za-z][\w]*\.\d{2,}-/.test(d));
    for (const d of unambiguous) {
      assert.equal(validate.isPhaseDirName(d, 'bracket'), validate.phaseDirNameRe.test(d), d);
      const viaConst = d.match(validate.PHASE_TOKEN_FROM_DIR_RE);
      assert.equal(validate.phaseTokenFromDir(d, 'bracket'), viaConst ? viaConst[1] : null, d);
    }
  });

  test('(e) the :202 default-off invariant, extended to the DIRECTORY side', () => {
    // `P0.34-56-name` is the family upstream documents as ambiguous with a
    // padded bracket dir. Without an explicit convention signal it must answer
    // exactly as it does today — not-a-phase-dir, no token — and NOT be
    // reinterpreted as bracket milestone 34 / phase 56.
    for (const d of ['P0.34-56-name', 'P0.12-34-name']) {
      assert.equal(validate.isPhaseDirName(d), false, `${d} unconventioned`);
      assert.equal(validate.isPhaseDirName(d, null), false);
      assert.equal(validate.isPhaseDirName(d, 'milestone-prefixed'), false);
      assert.equal(validate.phaseTokenFromDir(d), null);
      assert.equal(validate.phaseTokenFromDir(d, 'milestone-prefixed'), null);
      // Opting in is what changes the reading — and only then.
      assert.equal(validate.isPhaseDirName(d, 'bracket'), true, `${d} under bracket`);
    }
  });

  test('bracket dirs are recognized under the bracket convention', () => {
    for (const [dir, token] of [
      ['GSD.02-05-feature', '05'],
      ['GSD.02-05.03-feature', '05.03'],
      ['GSD.02-05', '05'],
      ['CK.01-12.04-feature', '12.04'],
      ['GSD_X2.100-05-feature', '05'],
    ]) {
      assert.equal(validate.isPhaseDirName(dir, 'bracket'), true, dir);
      assert.equal(validate.phaseTokenFromDir(dir, 'bracket'), token, dir);
      assert.equal(validate.isPhaseDirName(dir), false, `${dir} stays unrecognized without the signal`);
    }
  });

  test('a genuinely malformed dir is still malformed under bracket', () => {
    for (const d of ['not-a-phase', 'GSD.02', 'GSD.2-05-x', 'random_dir']) {
      assert.equal(validate.isPhaseDirName(d, 'bracket'), false, d);
    }
  });
});

describe('#612 PR-2: W005 and W006/W007 on a bracket repo', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-dirs-'); });
  afterEach(() => { cleanup(tmpDir); });

  const setup = ({ convention, dirs }) => {
    const planning = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planning, 'ROADMAP.md'), `# Roadmap

## [GSD.02] v2.0

### [GSD.02] 05: Real work
**Goal:** a

### [GSD.02] 06: Follow-up
**Goal:** b
`, 'utf-8');
    fs.writeFileSync(path.join(planning, 'config.json'),
      JSON.stringify(convention === undefined ? {} : { phase_id_convention: convention }), 'utf-8');
    const phasesDir = path.join(planning, 'phases');
    fs.mkdirSync(phasesDir, { recursive: true });
    for (const d of dirs) fs.mkdirSync(path.join(phasesDir, d), { recursive: true });
  };

  const codes = () => {
    const r = runGsdTools(['validate', 'health'], tmpDir);
    const o = JSON.parse(r.output);
    return [...(o.issues || []), ...(o.warnings || [])];
  };

  test('(a) W005 is SILENT on bracket phase dirs under the bracket convention', () => {
    setup({ convention: 'bracket', dirs: ['GSD.02-05-real-work', 'GSD.02-06-follow-up'] });
    const w005 = codes().filter(i => i.code === 'W005');
    assert.deepEqual(w005.map(i => i.message), [], 'a bracket phase dir is well-formed');
  });

  test('(a) W005 still FIRES on a genuinely malformed dir under bracket', () => {
    setup({ convention: 'bracket', dirs: ['GSD.02-05-real-work', 'totally bogus dir'] });
    const w005 = codes().filter(i => i.code === 'W005');
    assert.equal(w005.length, 1, JSON.stringify(w005.map(i => i.message)));
    assert.match(w005[0].message, /totally bogus dir/);
  });

  test('(b) W007 does not report bracket phases as missing from disk', () => {
    setup({ convention: 'bracket', dirs: ['GSD.02-05-real-work', 'GSD.02-06-follow-up'] });
    const w007 = codes().filter(i => i.code === 'W007');
    assert.deepEqual(w007.map(i => i.message), [], 'roadmap membership resolves both directions');
  });

  test('(b) a bracket dir with no ROADMAP entry is still surfaced', () => {
    setup({ convention: 'bracket', dirs: ['GSD.02-05-real-work', 'GSD.02-06-follow-up', 'GSD.02-09-orphan'] });
    const surfaced = codes().filter(i => /\b09\b/.test(i.message));
    assert.ok(surfaced.length >= 1, 'an orphan bracket dir must not become invisible');
  });

  test('(e) the SAME repo without the convention set keeps todays behaviour', () => {
    setup({ convention: undefined, dirs: ['GSD.02-05-real-work', 'GSD.02-06-follow-up'] });
    const w005 = codes().filter(i => i.code === 'W005');
    assert.equal(w005.length, 2, 'unconventioned, these dirs are still reported as malformed');
  });

  test('legacy repo is unaffected: no W005, no W007', () => {
    const planning = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planning, 'ROADMAP.md'), `# Roadmap

## v2.0

### Phase 5: Real work
**Goal:** a
`, 'utf-8');
    fs.writeFileSync(path.join(planning, 'config.json'), '{}', 'utf-8');
    const phasesDir = path.join(planning, 'phases');
    fs.mkdirSync(phasesDir, { recursive: true });
    fs.mkdirSync(path.join(phasesDir, '05-real-work'), { recursive: true });
    const issues = codes().filter(i => ['W005', 'W007'].includes(i.code));
    assert.deepEqual(issues.map(i => i.message), []);
  });
});
