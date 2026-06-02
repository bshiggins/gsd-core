// Tests for WAVE 2a bracket-native read-path parsing in roadmap.cjs (§4.2).
//
// Contract source: .planning/proposals/BRACKET-NATIVE-CJS-SCOPE.md §3/§4.2 +
// BRACKET-NATIVE-CJS-SCOPE-ADDENDA.md (ADDENDUM-3 milestone heading form =
// `## [GSD.02] Name`, phase heading = `### [GSD.02] 05: Name`).
//
// roadmap.cjs exposes only the four `cmd*` functions, which read ROADMAP.md
// from disk and emit JSON via core.cjs `output()` (raw fd-1 write — not
// console-capturable). So these go through the `runGsdTools` subprocess on a
// `createTempProject` fixture (the established roadmap.test.cjs pattern), per
// the task's "subprocess when a function needs fs" allowance.
//
// Coverage (§4.2 acceptance gate):
//   - bracket heading `### [GSD.02] 05: Name` parses (phase 05)
//   - subphase `### [GSD.02] 05.03: Name` parses (05.03)
//   - milestone section `## [GSD.02] Foundation` recognized as a milestone, NOT a phase
//   - legacy `### Phase 5: Name` still parses (migration-window tolerance)
//   - all-dot capture rejects a stray hyphen sub-token

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

function writeRoadmap(tmpDir, content) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), content);
}

function writeState(tmpDir, milestone) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'STATE.md'),
    `---\nmilestone: ${milestone}\n---\n`
  );
}

// ─── roadmap get-phase: bracket heading parse ────────────────────────────────

describe('roadmap get-phase — bracket heading parse', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('bracket heading `### [GSD.02] 05: Name` parses (phase 05)', () => {
    writeState(tmpDir, 'v2.0');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 05: Some Feature',
      '**Goal:** ship the feature',
      '**Plans:** 2 plans',
      '',
      'Body text.',
      '',
    ].join('\n'));

    const result = runGsdTools('roadmap get-phase 05', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.found, true, 'bracket phase heading found');
    assert.strictEqual(out.phase_name, 'Some Feature', 'name parsed without "Phase" word');
    assert.strictEqual(out.goal, 'ship the feature');
  });

  test('subphase `### [GSD.02] 05.03: Name` parses (05.03)', () => {
    writeState(tmpDir, 'v2.0');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 05.03: Decomposed Slice',
      '**Goal:** a genuine subphase',
      '',
      'Body.',
      '',
    ].join('\n'));

    const result = runGsdTools('roadmap get-phase 05.03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.found, true, 'bracket subphase heading found');
    assert.strictEqual(out.phase_name, 'Decomposed Slice');
    assert.strictEqual(out.goal, 'a genuine subphase');
  });

  test('legacy `### Phase 5: Name` still parses (migration-window tolerance)', () => {
    writeState(tmpDir, 'v1.0');
    writeRoadmap(tmpDir, [
      '# Roadmap v1.0',
      '',
      '## Phases',
      '',
      '### Phase 5: Legacy Feature',
      '**Goal:** legacy goal',
      '**Plans:** 1 plan',
      '',
      'Legacy body.',
      '',
    ].join('\n'));

    const result = runGsdTools('roadmap get-phase 5', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.found, true, 'legacy Phase heading still found');
    assert.strictEqual(out.phase_name, 'Legacy Feature');
    assert.strictEqual(out.goal, 'legacy goal');
  });

  test('milestone section `## [GSD.02] Foundation` is NOT resolvable as a phase', () => {
    // The milestone section heading carries no `NN:` token, so a get-phase
    // query for its name must not resolve it as a phase. We also confirm a
    // bracket digit-leading milestone name does not become a phase number.
    writeState(tmpDir, 'v2.0');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] 2024 Foundation',
      '',
      '### [GSD.02] 01: Only Phase',
      '**Goal:** the only phase',
      '',
    ].join('\n'));

    // A query for `2024` (the digit-leading milestone name) must NOT resolve.
    const result = runGsdTools('roadmap get-phase 2024', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.found, false, 'milestone-name digits are not a phase');
  });
});

// ─── roadmap analyze: phase + milestone classification ───────────────────────

describe('roadmap analyze — bracket phase/milestone classification', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('bracket phase headings parse; subphase preserved; milestone section is a milestone not a phase', () => {
    writeState(tmpDir, 'v2.0');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 05: First Feature',
      '**Goal:** g1',
      '',
      '### [GSD.02] 05.03: Subphase Slice',
      '**Goal:** g2',
      '',
    ].join('\n'));

    const result = runGsdTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);

    const numbers = out.phases.map(p => p.number);
    assert.ok(numbers.includes('05'), 'phase 05 captured');
    assert.ok(numbers.includes('05.03'), 'subphase 05.03 captured (all-dot)');
    // The milestone section heading must NOT be captured as a phase.
    assert.ok(!numbers.includes('Foundation'), 'milestone name not a phase');

    // The milestone section IS recognized as a milestone (ADDENDUM-3:
    // bracket integer 02 → v2.0).
    const versions = out.milestones.map(m => m.version);
    assert.ok(versions.includes('v2.0'), `milestone v2.0 derived from bracket int; got ${JSON.stringify(out.milestones)}`);
    const foundationMs = out.milestones.find(m => /Foundation/.test(m.heading));
    assert.ok(foundationMs, 'Foundation milestone heading present in milestones[]');
    assert.strictEqual(foundationMs.version, 'v2.0', 'bracket [GSD.02] → v2.0');
  });

  test('phase names are NOT captured as milestones (NN: discriminator)', () => {
    writeState(tmpDir, 'v2.0');
    writeRoadmap(tmpDir, [
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 05: Some Feature',
      '**Goal:** g',
      '',
    ].join('\n'));

    const result = runGsdTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    // Exactly one milestone (Foundation); the phase heading must not be one.
    const phaseAsMilestone = out.milestones.find(m => /Some Feature/.test(m.heading));
    assert.ok(!phaseAsMilestone, 'phase heading must not appear in milestones[]');
  });

  test('legacy `## v1.0` milestone + `### Phase N:` headings still parse (no regression)', () => {
    writeState(tmpDir, 'v1.0');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## Milestone v1.0 Foundation',
      '',
      '### Phase 1: Setup',
      '**Goal:** g1',
      '',
      '### Phase 2: Build',
      '**Goal:** g2',
      '',
    ].join('\n'));

    const result = runGsdTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const numbers = out.phases.map(p => p.number);
    assert.ok(numbers.includes('1') && numbers.includes('2'), 'legacy Phase headings parse');
    const versions = out.milestones.map(m => m.version);
    assert.ok(versions.includes('v1.0'), 'legacy v-literal milestone still derived');
  });

  test('all-dot capture rejects a stray hyphen sub-token (M-NN heading no longer parses)', () => {
    // The phase capture is all-dot `(\d+[A-Z]?(?:\.\d+)*)` immediately followed
    // by `:`. A heading with a hyphen sub-token `### [GSD.02] 05-03:` therefore
    // does NOT parse as a phase at all — after `05` the regex requires `:` but
    // finds `-`, so the heading is rejected entirely. The hyphen is the plan
    // suffix on filenames only, never inside a heading token. We assert: the
    // hyphen heading yields neither `05-03` nor `05.03` (nor a bare `05` from
    // that malformed heading), while a sibling clean `06` heading still parses
    // (proving the rejection is targeted, not a parser bailout).
    writeState(tmpDir, 'v2.0');
    writeRoadmap(tmpDir, [
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 05-03: Stray Hyphen',
      '**Goal:** g1',
      '',
      '### [GSD.02] 06: Clean Sibling',
      '**Goal:** g2',
      '',
    ].join('\n'));

    const result = runGsdTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const numbers = out.phases.map(p => p.number);
    assert.ok(!numbers.includes('05-03'), 'hyphen sub-token NOT captured into the phase token');
    assert.ok(!numbers.includes('05.03'), 'hyphen is not silently coerced to a dot sub-token');
    assert.ok(!numbers.includes('05'), 'the malformed M-NN heading does not parse as phase 05');
    assert.ok(numbers.includes('06'), 'a clean sibling heading still parses (targeted rejection)');
  });
});
