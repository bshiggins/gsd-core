// Tests for the bracket-native phase-ID helpers (Wave 1 foundation).
//
// Contract source: .planning/proposals/BRACKET-NATIVE-CJS-SCOPE.md §2/§6 +
// BRACKET-NATIVE-CJS-SCOPE-ADDENDA.md (ADDENDUM-3 milestone heading form,
// LOCKED R1 = READING B). These break the READING-A/B tie: milestone comes
// from the {PROJECT}.{MM}- prefix, NEVER from the phase token's leading int.
//
// Unit-only: requires core.cjs directly, no subprocess.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePhaseName,
  getMilestoneFromPhaseId,
  getPhaseDirFromPhaseId,
  getPhaseDisplayLabel,
  extractPhaseToken,
  phaseTokenMatches,
  comparePhaseNum,
  phaseMarkdownRegexSource,
  isSentinelPhaseId,
  SENTINEL_RANGES,
  PHASE_DIR_TOKEN_RE,
  roadmapHeadingPhaseRe,
  extractCurrentMilestone,
} = require('../get-shit-done/bin/lib/core.cjs');

// ─── Discriminator tests (READING-A/B tie-breakers — REQUIRED, §6) ───────────

describe('READING-B discriminator (milestone from prefix, not phase-token int)', () => {
  test("getMilestoneFromPhaseId('GSD.02-05.03') === 'v2.0' (milestone 2, NOT 5)", () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD.02-05.03'), 'v2.0');
  });

  test("getMilestoneFromPhaseId('04', 'v2.0') === 'v2.0' (active-milestone for bare id)", () => {
    assert.strictEqual(getMilestoneFromPhaseId('04', 'v2.0'), 'v2.0');
  });

  test("getPhaseDirFromPhaseId('04','Foo','GSD','02') === 'GSD.02-04-foo' (prefix 02, NOT GSD.04-04)", () => {
    assert.strictEqual(getPhaseDirFromPhaseId('04', 'Foo', 'GSD', '02'), 'GSD.02-04-foo');
  });

  test("getMilestoneFromPhaseId('GSD.10-03') === 'v10.0' (double-digit prefix)", () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD.10-03'), 'v10.0');
  });

  test("getMilestoneFromPhaseId('CK.02-04') === 'v2.0' (prefix milestone, any project code)", () => {
    assert.strictEqual(getMilestoneFromPhaseId('CK.02-04'), 'v2.0');
  });
});

// ─── getMilestoneFromPhaseId (READING B) ─────────────────────────────────────

describe('getMilestoneFromPhaseId', () => {
  test('bare id with no prefix and no activeMilestone → null', () => {
    assert.strictEqual(getMilestoneFromPhaseId('04'), null);
  });

  test('prefix present, activeMilestone major matches → returns activeMilestone verbatim (non-.0)', () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD.02-05', 'v2.1'), 'v2.1');
  });

  test('prefix present, activeMilestone major mismatches → derived vN.0 from prefix', () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD.02-05', 'v3.0'), 'v2.0');
  });

  test('sentinel phase token 999 → null even with prefix', () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD.02-999.1'), null);
  });

  test('sentinel phase token 0 → null', () => {
    assert.strictEqual(getMilestoneFromPhaseId('GSD.02-0.1'), null);
  });
});

// ─── getPhaseDirFromPhaseId (all-dot, explicit milestone) ────────────────────

describe('getPhaseDirFromPhaseId', () => {
  test("('2.1','Foo Bar','GSD','02') === 'GSD.02-02.01-foo-bar' (all-dot, padded)", () => {
    assert.strictEqual(getPhaseDirFromPhaseId('2.1', 'Foo Bar', 'GSD', '02'), 'GSD.02-02.01-foo-bar');
  });

  test("(…, null, '') === '02.01' (bare all-dot token, no hyphen)", () => {
    assert.strictEqual(getPhaseDirFromPhaseId('2.1', null, ''), '02.01');
  });

  test("deep all-dot preserved: ('2.4.3', null, '') === '02.04.03'", () => {
    assert.strictEqual(getPhaseDirFromPhaseId('2.4.3', null, ''), '02.04.03');
  });

  test("no project code → '{token}-{slug}': ('5','Foo Bar','') === '05-foo-bar'", () => {
    assert.strictEqual(getPhaseDirFromPhaseId('5', 'Foo Bar', ''), '05-foo-bar');
  });

  test("round-trips the live dir form: ('03','Bracket Model','GSD','02') === 'GSD.02-03-bracket-model'", () => {
    assert.strictEqual(getPhaseDirFromPhaseId('03', 'Bracket Model', 'GSD', '02'), 'GSD.02-03-bracket-model');
  });
});

// ─── getPhaseDisplayLabel ────────────────────────────────────────────────────

describe('getPhaseDisplayLabel', () => {
  test("('2.1','GSD.02') === '[GSD.02] 02.01'", () => {
    assert.strictEqual(getPhaseDisplayLabel('2.1', 'GSD.02'), '[GSD.02] 02.01');
  });

  test("('2.4.3','CK.02') === '[CK.02] 02.04.03'", () => {
    assert.strictEqual(getPhaseDisplayLabel('2.4.3', 'CK.02'), '[CK.02] 02.04.03');
  });

  test("('2.1','') === '02.01' (no bracket when prefix empty)", () => {
    assert.strictEqual(getPhaseDisplayLabel('2.1', ''), '02.01');
  });

  test('no literal "Phase" word in output', () => {
    assert.ok(!/Phase/i.test(getPhaseDisplayLabel('5', 'GSD.02')));
  });
});

// ─── extractPhaseToken (bracket Option-B primary + legacy fallbacks) ─────────

describe('extractPhaseToken', () => {
  test("bracket form: 'GSD.02-02.01-slug' === '02.01'", () => {
    assert.strictEqual(extractPhaseToken('GSD.02-02.01-slug'), '02.01');
  });

  test("bracket form, no subphase: 'GSD.02-01-foundation' === '01'", () => {
    assert.strictEqual(extractPhaseToken('GSD.02-01-foundation'), '01');
  });

  test("bracket deep: 'CK.02-02.04.03-slug' === '02.04.03'", () => {
    assert.strictEqual(extractPhaseToken('CK.02-02.04.03-slug'), '02.04.03');
  });

  test("legacy bare numeric still parses: '01-name' === '01'", () => {
    assert.strictEqual(extractPhaseToken('01-name'), '01');
  });

  test("legacy all-dot still parses: '999.6-name' === '999.6'", () => {
    assert.strictEqual(extractPhaseToken('999.6-name'), '999.6');
  });
});

// ─── phaseTokenMatches (numeric-segment-tolerant / padding-agnostic) ─────────

describe('phaseTokenMatches', () => {
  test("('GSD.02-01-slug','01') === true", () => {
    assert.strictEqual(phaseTokenMatches('GSD.02-01-slug', '01'), true);
  });

  test("padding-agnostic: ('GSD.02-02.01-slug','2.1') === true", () => {
    assert.strictEqual(phaseTokenMatches('GSD.02-02.01-slug', '2.1'), true);
  });

  test("('GSD.02-05.03-slug','05.03') === true", () => {
    assert.strictEqual(phaseTokenMatches('GSD.02-05.03-slug', '05.03'), true);
  });

  test("non-match: ('GSD.02-01-slug','02') === false", () => {
    assert.strictEqual(phaseTokenMatches('GSD.02-01-slug', '02'), false);
  });
});

// ─── normalizePhaseName ──────────────────────────────────────────────────────

describe('normalizePhaseName', () => {
  test("THROWS on bare '02-04' (ambiguous milestone-vs-plan)", () => {
    assert.throws(
      () => normalizePhaseName('02-04'),
      /Ambiguous phase id '02-04'/,
    );
  });

  test("accepts canonical dir form 'GSD.02-04' → '04' (milestone dropped, recovered elsewhere)", () => {
    assert.strictEqual(normalizePhaseName('GSD.02-04'), '04');
  });

  test("accepts canonical dir form with subphase 'GSD.02-04.02' → '04.02'", () => {
    assert.strictEqual(normalizePhaseName('GSD.02-04.02'), '04.02');
  });

  test("bare integer padded: '4' → '04'", () => {
    assert.strictEqual(normalizePhaseName('4'), '04');
  });

  test("legacy project-code prefix stripped: 'CK-01' → '01'", () => {
    assert.strictEqual(normalizePhaseName('CK-01'), '01');
  });
});

// ─── Sentinels ───────────────────────────────────────────────────────────────

describe('sentinels', () => {
  test('SENTINEL_RANGES contains 0 and 999', () => {
    assert.ok(SENTINEL_RANGES.has(0));
    assert.ok(SENTINEL_RANGES.has(999));
  });

  test("isSentinelPhaseId('0.5') === true", () => {
    assert.strictEqual(isSentinelPhaseId('0.5'), true);
  });

  test("isSentinelPhaseId('999.1') === true", () => {
    assert.strictEqual(isSentinelPhaseId('999.1'), true);
  });

  test("isSentinelPhaseId('05.03') === false", () => {
    assert.strictEqual(isSentinelPhaseId('05.03'), false);
  });

  test("getMilestoneFromPhaseId('0.1') === null (sentinel)", () => {
    assert.strictEqual(getMilestoneFromPhaseId('0.1'), null);
  });
});

// ─── comparePhaseNum (single all-dot space) ──────────────────────────────────

describe('comparePhaseNum', () => {
  test('05 sorts before 10 (numeric, not lexical)', () => {
    assert.ok(comparePhaseNum('05', '10') < 0);
  });

  test('subphase ordering: 05 < 05.01 < 05.02', () => {
    assert.ok(comparePhaseNum('05', '05.01') < 0);
    assert.ok(comparePhaseNum('05.01', '05.02') < 0);
  });

  test('equal padded vs unpadded: 05.03 === 5.3', () => {
    assert.strictEqual(comparePhaseNum('05.03', '5.3'), 0);
  });
});

// ─── phaseMarkdownRegexSource (all-dot, 0*-tolerant) ─────────────────────────

describe('phaseMarkdownRegexSource', () => {
  test('matches both padded and unpadded prose form', () => {
    const src = phaseMarkdownRegexSource('02.07');
    const re = new RegExp(src);
    assert.ok(re.test('2.7'));
    assert.ok(re.test('02.07'));
  });

  test('no hyphen-joiner in emitted fragment (M-NN branch deleted)', () => {
    const src = phaseMarkdownRegexSource('05.03');
    assert.ok(!src.includes('-'));
  });
});

// ─── Centralized extractors (added exports) ──────────────────────────────────

describe('PHASE_DIR_TOKEN_RE / roadmapHeadingPhaseRe', () => {
  test('PHASE_DIR_TOKEN_RE strips bracket prefix: GSD.02-05.03-slug → 05.03', () => {
    const m = PHASE_DIR_TOKEN_RE.exec('GSD.02-05.03-slug');
    assert.strictEqual(m[1], '05.03');
  });

  test('roadmapHeadingPhaseRe captures bracket phase heading number', () => {
    const re = roadmapHeadingPhaseRe();
    const m = re.exec('### [GSD.02] 05: Some Feature');
    assert.strictEqual(m[1], '05');
  });

  test('roadmapHeadingPhaseRe still captures legacy Phase heading', () => {
    const re = roadmapHeadingPhaseRe();
    const m = re.exec('## Phase 5: Legacy');
    assert.strictEqual(m[1], '5');
  });
});

// ─── extractCurrentMilestone discriminator (ADDENDUM-3) ──────────────────────
//
// Milestone heading = `## [GSD.02] Name` (bracket then NAME, no NN: colon) → boundary.
// Phase heading      = `### [GSD.02] 05: Name` (bracket then NN:) → NOT a boundary.
// Edge: `## [GSD.02] 2024 Plan` (digit-leading name, no colon) → milestone, NOT phase 2024.

describe('extractCurrentMilestone (ADDENDUM-3 bracket discriminator)', () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  function tmpProject(stateMilestone, roadmap) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bracket-ecm-'));
    const planning = path.join(dir, '.planning');
    mkdirSync(planning, { recursive: true });
    writeFileSync(path.join(planning, 'STATE.md'), `---\nmilestone: ${stateMilestone}\n---\n`);
    writeFileSync(path.join(planning, 'ROADMAP.md'), roadmap);
    return dir;
  }

  test('scopes to the active bracket milestone section, excludes the next milestone', () => {
    const roadmap = [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 01: First Phase',
      'phase 01 body',
      '',
      '### [GSD.02] 02: Second Phase',
      'phase 02 body',
      '',
      '## [GSD.03] Expansion',
      '',
      '### [GSD.03] 01: Later Phase',
      'phase 03-01 body',
      '',
    ].join('\n');
    const dir = tmpProject('v2.0', roadmap);
    try {
      const scoped = extractCurrentMilestone(roadmap, dir);
      assert.ok(scoped.includes('01: First Phase'), 'includes active milestone phase 01');
      assert.ok(scoped.includes('02: Second Phase'), 'includes active milestone phase 02');
      assert.ok(!scoped.includes('Later Phase'), 'excludes next milestone phase');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('phase heading is NOT treated as a milestone boundary (NN: colon discriminator)', () => {
    // If `### [GSD.02] 05:` were wrongly read as a boundary, phase 06 would be dropped.
    const roadmap = [
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 05: Fifth',
      'body five',
      '',
      '### [GSD.02] 06: Sixth',
      'body six',
      '',
    ].join('\n');
    const dir = tmpProject('v2.0', roadmap);
    try {
      const scoped = extractCurrentMilestone(roadmap, dir);
      assert.ok(scoped.includes('05: Fifth'));
      assert.ok(scoped.includes('06: Sixth'), 'phase heading must not end the section');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('digit-leading milestone name does not misparse as a phase (no NN: colon)', () => {
    const roadmap = [
      '## [GSD.02] 2024 Plan',
      '',
      '### [GSD.02] 01: Only Phase',
      'body',
      '',
      '## [GSD.03] 2025 Plan',
      '',
      '### [GSD.03] 01: Next',
      'next body',
      '',
    ].join('\n');
    const dir = tmpProject('v2.0', roadmap);
    try {
      const scoped = extractCurrentMilestone(roadmap, dir);
      assert.ok(scoped.includes('01: Only Phase'));
      assert.ok(!scoped.includes('01: Next'), 'next milestone (digit-leading name) is a boundary');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('legacy `### Phase N:` headings still parse under a legacy `## vX.Y` milestone', () => {
    const roadmap = [
      '## v2.0 Foundation',
      '',
      '### Phase 5: Legacy Five',
      'body',
      '',
      '## v3.0 Future',
      '',
      '### Phase 1: Future One',
      'future body',
      '',
    ].join('\n');
    const dir = tmpProject('v2.0', roadmap);
    try {
      const scoped = extractCurrentMilestone(roadmap, dir);
      assert.ok(scoped.includes('Phase 5: Legacy Five'));
      assert.ok(!scoped.includes('Future One'), 'legacy next milestone is still a boundary');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Bracket read-path: filter / roadmap-get-phase / milestone-info ──────────
//
// Proves the NEW bracket branches in getMilestonePhaseFilter, getRoadmapPhaseInternal,
// and getMilestoneInfo (legacy suites only exercise the v-string fallback).

describe('bracket read-path (filter / get-phase / milestone-info)', () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {
    getMilestonePhaseFilter,
    getRoadmapPhaseInternal,
    getMilestoneInfo,
  } = require('../get-shit-done/bin/lib/core.cjs');

  const ROADMAP = [
    '# Roadmap',
    '',
    '## [GSD.02] Foundation',
    '',
    '### [GSD.02] 05: Some Feature',
    '**Goal:** ship it',
    '',
    '### [GSD.02] 06: Other Feature',
    'body',
    '',
    '## [GSD.03] Expansion',
    '',
    '### [GSD.03] 01: Later Phase',
    'later body',
    '',
  ].join('\n');

  function bracketProject(milestone = 'v2.0') {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bracket-readpath-'));
    const planning = path.join(dir, '.planning');
    mkdirSync(planning, { recursive: true });
    writeFileSync(path.join(planning, 'STATE.md'), `---\nmilestone: ${milestone}\n---\n`);
    writeFileSync(path.join(planning, 'ROADMAP.md'), ROADMAP);
    return dir;
  }

  test('getMilestonePhaseFilter is structural: active-milestone dir in, other-milestone dir out (READING B)', () => {
    const dir = bracketProject('v2.0');
    try {
      const filter = getMilestonePhaseFilter(dir);
      assert.strictEqual(filter('GSD.02-05-some-feature'), true, 'active milestone dir included');
      assert.strictEqual(filter('GSD.02-06-other-feature'), true);
      assert.strictEqual(filter('GSD.03-01-later-phase'), false, 'other-milestone dir excluded by prefix int');
      assert.strictEqual(filter.phaseCount, 2, 'counts the two active-milestone phase headings');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getRoadmapPhaseInternal resolves a bracket phase heading (no "Phase" word)', () => {
    const dir = bracketProject('v2.0');
    try {
      const res = getRoadmapPhaseInternal(dir, '05');
      assert.ok(res && res.found, 'found the bracket phase heading');
      assert.strictEqual(res.phase_name, 'Some Feature');
      assert.strictEqual(res.goal, 'ship it');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getMilestoneInfo reads name + integer from the bracket section heading', () => {
    const dir = bracketProject('v2.0');
    try {
      const info = getMilestoneInfo(dir);
      assert.strictEqual(info.version, 'v2.0');
      assert.strictEqual(info.name, 'Foundation');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getMilestoneInfo preserves a non-.0 STATE milestone (R3 lockstep)', () => {
    const dir = bracketProject('v2.1');
    try {
      const info = getMilestoneInfo(dir);
      assert.strictEqual(info.version, 'v2.1', 'non-.0 milestone preserved when major matches');
      assert.strictEqual(info.name, 'Foundation');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
