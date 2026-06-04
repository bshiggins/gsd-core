/**
 * PR 2 — bracket phase-ID read tolerance: validate.cts (W005 / W006 / W007) (#612).
 *
 * Ratified contract: ADR docs/adr/612-bracket-phase-id-convention.md;
 * CARRY-FORWARD.md §2 (PR-2 read-path surface map) + §3 (PR-2 scenarios).
 *
 * These exercise the validate.cts surfaces via `gsd-tools validate health`:
 *   - phaseDirNameRe        → W005 "Phase directory doesn't follow NN-name format"
 *   - PHASE_TOKEN_FROM_DIR_RE → token extraction feeding W006/W007 disk membership
 *   - buildRoadmapPhaseVariants (heading) → W006 (roadmap-but-no-dir) / W007 sets
 *   - buildNotStartedPhaseVariants (checklist) → W006 not-started skip
 *
 * Canonical bracket dir form:  {CODE}.{MM}-{N}[.{sub}]-slug  (GSD.02-05-network).
 * Canonical bracket heading:   ### [GSD.02] 05: Name   (milestone INSIDE the
 * bracket, phase token directly after, NO literal "Phase" word; the trailing
 * COLON discriminates a phase heading from a no-colon milestone boundary).
 *
 * Reads are tolerant-additive regardless of `phase_id_convention` (B6: "reads
 * stay tolerant regardless"), so these fixtures set NO convention flag — the
 * default config.json has no phase_id_convention key.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

function planningPath(tmpDir, ...rest) {
  return path.join(tmpDir, '.planning', ...rest);
}

function writeProjectMd(tmpDir) {
  fs.writeFileSync(
    planningPath(tmpDir, 'PROJECT.md'),
    '# Project\n\n## What This Is\n\nx\n\n## Core Value\n\nx\n\n## Requirements\n\nx\n',
  );
}

function writeStateMd(tmpDir) {
  fs.writeFileSync(
    planningPath(tmpDir, 'STATE.md'),
    '# Session State\n\n## Current Position\n\nPhase: 5\n',
  );
}

function writeConfigJson(tmpDir) {
  fs.writeFileSync(
    planningPath(tmpDir, 'config.json'),
    JSON.stringify({ model_profile: 'balanced', commit_docs: true }, null, 2),
  );
}

function writeRoadmap(tmpDir, body) {
  fs.writeFileSync(planningPath(tmpDir, 'ROADMAP.md'), body);
}

function mkPhaseDir(tmpDir, name) {
  fs.mkdirSync(planningPath(tmpDir, 'phases', name), { recursive: true });
}

function health(tmpDir) {
  const r = runGsdTools('validate health', tmpDir);
  assert.ok(r.success, `validate health failed: ${r.error}`);
  const out = JSON.parse(r.output);
  // Normalize: collect every {code} across errors/warnings/info for membership asserts.
  const codes = (arr) => (Array.isArray(arr) ? arr.map((x) => x.code) : []);
  out._warningCodes = codes(out.warnings);
  return out;
}

describe('PR2-B: validate health does not emit spurious W005 for bracket dirs (#612)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    writeProjectMd(tmpDir);
    writeStateMd(tmpDir);
    writeConfigJson(tmpDir);
  });
  afterEach(() => cleanup(tmpDir));

  test('bracket dir `GSD.02-05-network` does NOT trigger W005', () => {
    writeRoadmap(tmpDir,
`# Roadmap

### [GSD.02] 05: Network Providers
`);
    mkPhaseDir(tmpDir, 'GSD.02-05-network');
    const out = health(tmpDir);
    const w005 = (out.warnings || []).filter((w) => w.code === 'W005' && /GSD\.02-05-network/.test(w.message));
    assert.equal(w005.length, 0,
      `bracket dir must not be flagged W005; got ${JSON.stringify(w005)}`);
  });

  test('sub-phase bracket dir `GSD.02-05.03-sub` does NOT trigger W005', () => {
    writeRoadmap(tmpDir,
`# Roadmap

### [GSD.02] 05.03: Sub Slice
`);
    mkPhaseDir(tmpDir, 'GSD.02-05.03-sub');
    const out = health(tmpDir);
    const w005 = (out.warnings || []).filter((w) => w.code === 'W005' && /GSD\.02-05\.03-sub/.test(w.message));
    assert.equal(w005.length, 0,
      `bracket sub-phase dir must not be flagged W005; got ${JSON.stringify(w005)}`);
  });

  test('garbage dir `not-a-phase-at-all` STILL triggers W005 (no over-broadening)', () => {
    writeRoadmap(tmpDir,
`# Roadmap

### [GSD.02] 05: Network Providers
`);
    mkPhaseDir(tmpDir, 'GSD.02-05-network');
    // 'foo' has no leading digit/code and must remain rejected.
    mkPhaseDir(tmpDir, 'foo');
    const out = health(tmpDir);
    const w005 = (out.warnings || []).filter((w) => w.code === 'W005' && /"foo"/.test(w.message));
    assert.ok(w005.length > 0,
      `garbage dir must still be flagged W005; got warnings ${JSON.stringify(out.warnings)}`);
  });

  test('legacy dir `02-01-setup` still does NOT trigger W005 (no regression)', () => {
    writeRoadmap(tmpDir,
`# Roadmap

### Phase 2-01: Legacy
`);
    mkPhaseDir(tmpDir, '02-01-setup');
    const out = health(tmpDir);
    const w005 = (out.warnings || []).filter((w) => w.code === 'W005' && /02-01-setup/.test(w.message));
    assert.equal(w005.length, 0,
      `legacy milestone-prefixed dir must not be flagged W005; got ${JSON.stringify(w005)}`);
  });
});

describe('PR2-B: validate health W006 round-trip on bracket headings/dirs (#612)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    writeProjectMd(tmpDir);
    writeStateMd(tmpDir);
    writeConfigJson(tmpDir);
  });
  afterEach(() => cleanup(tmpDir));

  test('bracket heading `### [GSD.02] 05:` with NO matching dir fires W006', () => {
    // Asymmetric: roadmap declares phase 05 (bracket), but no 05 dir on disk.
    writeRoadmap(tmpDir,
`# Roadmap

### [GSD.02] 05: Network Providers
**Goal:** g
`);
    // A different, valid dir so the phases root is non-empty but lacks token 05.
    mkPhaseDir(tmpDir, 'GSD.02-06-billing');
    const out = health(tmpDir);
    const w006 = (out.warnings || []).filter((w) => w.code === 'W006');
    assert.ok(w006.some((w) => /\b05\b|\b5\b/.test(w.message)),
      `bracket phase 05 in roadmap with no dir must fire W006; got ${JSON.stringify(w006)}`);
  });

  test('bracket heading `### [GSD.02] 05:` WITH matching bracket dir does NOT fire W006', () => {
    writeRoadmap(tmpDir,
`# Roadmap

### [GSD.02] 05: Network Providers
**Goal:** g
`);
    mkPhaseDir(tmpDir, 'GSD.02-05-network');
    const out = health(tmpDir);
    const w006 = (out.warnings || []).filter((w) => w.code === 'W006');
    assert.equal(w006.length, 0,
      `bracket heading + matching bracket dir must reconcile (no W006); got ${JSON.stringify(w006)}`);
  });

  test('bracket unchecked checklist bullet is treated as not-started (no W006)', () => {
    // The checklist marks phase 07 not-started; no dir on disk → must be skipped,
    // not flagged W006. Today the bracket bullet is unrecognized so it would fire.
    writeRoadmap(tmpDir,
`# Roadmap

- [ ] **[GSD.02] 07: Future Phase**

### [GSD.02] 05: Network Providers
**Goal:** g
`);
    mkPhaseDir(tmpDir, 'GSD.02-05-network');
    const out = health(tmpDir);
    const w006_07 = (out.warnings || []).filter((w) => w.code === 'W006' && /\b07\b|\b7\b/.test(w.message));
    assert.equal(w006_07.length, 0,
      `bracket not-started checklist phase 07 must be skipped, not W006; got ${JSON.stringify(out.warnings)}`);
  });
});

describe('PR2-B: validate health W007 on-disk bracket dir reconciliation (#612)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    writeProjectMd(tmpDir);
    writeStateMd(tmpDir);
    writeConfigJson(tmpDir);
  });
  afterEach(() => cleanup(tmpDir));

  test('bracket dir on disk that IS in the bracket roadmap does NOT fire W007', () => {
    // Today PHASE_TOKEN_FROM_DIR_RE returns null for bracket dirs, so the dir
    // token is dropped and reconciliation cannot occur. After the fix the dir
    // token '05' matches the roadmap-heading token '05'.
    writeRoadmap(tmpDir,
`# Roadmap

### [GSD.02] 05: Network Providers
**Goal:** g
`);
    mkPhaseDir(tmpDir, 'GSD.02-05-network');
    const out = health(tmpDir);
    const w007 = (out.warnings || []).filter((w) => w.code === 'W007');
    assert.equal(w007.length, 0,
      `bracket dir present in bracket roadmap must reconcile (no W007); got ${JSON.stringify(w007)}`);
  });

  test('legacy dir on disk that IS in legacy roadmap does NOT fire W007 (no regression)', () => {
    writeRoadmap(tmpDir,
`# Roadmap

### Phase 5: Legacy Phase
**Goal:** g
`);
    mkPhaseDir(tmpDir, '05-legacy');
    const out = health(tmpDir);
    const w007 = (out.warnings || []).filter((w) => w.code === 'W007');
    assert.equal(w007.length, 0,
      `legacy dir present in legacy roadmap must reconcile (no W007); got ${JSON.stringify(w007)}`);
  });
});
