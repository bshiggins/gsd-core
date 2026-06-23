/**
 * PR 2 — bracket phase-ID read tolerance: roadmap.cts analyze (#612).
 *
 * Ratified contract: ADR docs/adr/612-bracket-phase-id-convention.md;
 * CARRY-FORWARD.md §2 (PR-2 read-path surface map) + §3 (PR-2 scenarios).
 *
 * The bracket heading form `### [GSD.02] 05: Name` carries the milestone INSIDE
 * the bracket and the phase token directly after it — there is NO literal
 * `Phase` word. The discriminator between a phase heading and a milestone
 * boundary heading is the COLON: `### [GSD.02] 05:` is phase 05;
 * `## [GSD.02] Foundation` / `## [GSD.02] 2024 Plan` (no colon) are boundaries.
 *
 * Reads are tolerant-additive regardless of `phase_id_convention` (B6: "reads
 * stay tolerant regardless"), so these fixtures set no convention flag.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

function writeRoadmap(tmpDir, body) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), body);
}

function analyze(tmpDir) {
  const r = runGsdTools(['roadmap', 'analyze'], tmpDir);
  assert.ok(r.success, `roadmap analyze failed: ${r.error}`);
  return JSON.parse(r.output);
}

describe('PR2-A: roadmap analyze accepts bracket phase headings (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('bracket phase heading `### [GSD.02] 05: Name` parses as phase 05 with its goal', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## Phases

### [GSD.02] 05: Network Providers
**Goal:** Ship the provider directory

### [GSD.02] 06: Billing
**Goal:** Wire up billing
`);
    const a = analyze(tmpDir);
    const p5 = a.phases.find(p => p.number === '05');
    assert.ok(p5, `expected a phase numbered 05, got ${JSON.stringify(a.phases.map(p => p.number))}`);
    assert.match(p5.name, /Network Providers/);
    assert.equal(p5.goal, 'Ship the provider directory');
  });

  test('sub-phase bracket heading `### [GSD.02] 05.03: Name` parses as phase 05.03', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## Phases

### [GSD.02] 05.03: Sub Slice
**Goal:** A vertical slice
`);
    const a = analyze(tmpDir);
    const sub = a.phases.find(p => p.number === '05.03');
    assert.ok(sub, `expected phase 05.03, got ${JSON.stringify(a.phases.map(p => p.number))}`);
    assert.match(sub.name, /Sub Slice/);
  });

  test('bracket milestone boundary `## [GSD.02] Foundation` (no colon) is NOT a phase', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.02] 01: First Phase
**Goal:** g
`);
    const a = analyze(tmpDir);
    assert.ok(!a.phases.some(p => /Foundation/.test(p.name)),
      `milestone boundary must not be parsed as a phase; got ${JSON.stringify(a.phases.map(p => p.name))}`);
    assert.ok(a.phases.find(p => p.number === '01'), 'the real phase 01 must still parse');
  });

  test('digit-leading milestone name `## [GSD.02] 2024 Plan` (no colon) is not parsed as phase 2024', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] 2024 Plan

### [GSD.02] 01: First Phase
**Goal:** g
`);
    const a = analyze(tmpDir);
    assert.ok(!a.phases.some(p => p.number === '2024'),
      `digit-leading milestone name must not parse as a phase number; got ${JSON.stringify(a.phases.map(p => p.number))}`);
  });

  test('legacy `### Phase 6: Name` still parses (no regression)', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## Phases

### Phase 6: Legacy Phase
**Goal:** legacy goal
`);
    const a = analyze(tmpDir);
    const p6 = a.phases.find(p => p.number === '6');
    assert.ok(p6, `legacy phase 6 must still parse; got ${JSON.stringify(a.phases.map(p => p.number))}`);
    assert.equal(p6.goal, 'legacy goal');
  });

  test('mixed bracket + legacy headings both extract with goals', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## Phases

### [GSD.02] 05: Bracketed Phase
**Goal:** bracket goal

### Phase 6: Legacy Phase
**Goal:** legacy goal
`);
    const a = analyze(tmpDir);
    const bracketed = a.phases.find(p => p.number === '05');
    const legacy = a.phases.find(p => p.number === '6');
    assert.ok(bracketed, 'bracket phase must parse in a mixed roadmap');
    assert.equal(bracketed.goal, 'bracket goal');
    assert.ok(legacy, 'legacy phase must parse in a mixed roadmap');
    assert.equal(legacy.goal, 'legacy goal');
  });
});

describe('PR2-A: roadmap get-phase resolves a bracket heading (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('`get-phase 5` finds `### [GSD.02] 05: Name`', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## Phases

### [GSD.02] 05: Network Providers
**Goal:** Ship the provider directory
`);
    const r = runGsdTools(['roadmap', 'get-phase', '5'], tmpDir);
    assert.ok(r.success, `get-phase failed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(p.found, true, `bracket phase 5 must be found; got ${r.output}`);
    assert.match(p.phase_name, /Network Providers/);
  });

  test('legacy `get-phase 5` against `### Phase 5:` still works (no regression)', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## Phases

### Phase 5: Legacy
**Goal:** g
`);
    const r = runGsdTools(['roadmap', 'get-phase', '5'], tmpDir);
    assert.ok(r.success, `get-phase failed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(p.found, true);
    assert.match(p.phase_name, /Legacy/);
  });
});

describe('PR2-A: roadmap analyze checklist tolerates bracket bullets (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('a bracket checklist bullet without a detail section is reported in missing_phase_details', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## Phases

- [ ] **[GSD.02] 07: Orphaned Checklist Phase**

### [GSD.02] 05: Real Detail Phase
**Goal:** g
`);
    const a = analyze(tmpDir);
    assert.ok(
      Array.isArray(a.missing_phase_details) && a.missing_phase_details.includes('07'),
      `bracket checklist phase 07 (no detail section) must be flagged; got missing_phase_details=${JSON.stringify(a.missing_phase_details)}`,
    );
  });

  test('a checked bracket checklist bullet marks the phase roadmap_complete', () => {
    writeRoadmap(tmpDir,
`# Roadmap

## Phases

- [x] **[GSD.02] 05: Done Phase**

### [GSD.02] 05: Done Phase
**Goal:** g
`);
    const a = analyze(tmpDir);
    const p5 = a.phases.find(p => p.number === '05');
    assert.ok(p5, 'phase 05 must parse');
    assert.equal(p5.roadmap_complete, true,
      `checked bracket checklist bullet must set roadmap_complete; got ${JSON.stringify(p5)}`);
  });
});
