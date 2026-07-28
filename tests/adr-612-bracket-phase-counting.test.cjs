'use strict';

/**
 * PR-2 (#2761 / epic #612) — total_phases counts bracket phase headings.
 *
 * `total_phases` is derived TWICE from the ROADMAP: once in buildStateFrontmatter
 * (the `state json` read path) and once in cmdStateSync (the `state sync` write
 * path). The second carries the comment "Mirrors the logic in
 * buildStateFrontmatter so both report consistent percents (#3242 Bug B)".
 * Teaching only one to see bracket headings re-opens that bug class: on a
 * bracket repo `state json` would report 3 while `state sync` wrote 1.
 *
 * RT4 / #1446 — every assertion here is an EXACT number. #1446 removed
 * total_phases from the ratchet, so it corrects DOWNWARD silently: a counting
 * regression produces a wrong-but-quiet number and never an error. Asserting
 * "no error", or asserting `>= n`, would pass straight through the bug.
 *
 * Fixtures are raw markdown strings — not rendered through renderPhaseId/toDir.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

let tmpDir;

const STATE_MD = [
  '---',
  'gsd_state_version: 1.0',
  'milestone: v2.0',
  'milestone_name: Expansion',
  'status: executing',
  '---',
  '',
  '# Project State',
  '',
  '**Phase:** 05',
  '',
].join('\n');

function writeProject(roadmap) {
  const planning = path.join(tmpDir, '.planning');
  fs.writeFileSync(path.join(planning, 'ROADMAP.md'), roadmap, 'utf-8');
  fs.writeFileSync(path.join(planning, 'STATE.md'), STATE_MD, 'utf-8');
}

/** total_phases as the READ path (`state json`) derives it. */
function totalFromStateJson() {
  const r = runGsdTools(['state', 'json'], tmpDir);
  assert.ok(r.success, `state json failed: ${r.error}`);
  return JSON.parse(r.output).progress?.total_phases ?? null;
}

/** total_phases as the WRITE path (`state sync`) derives it. */
function totalFromStateSync() {
  const s = runGsdTools(['state', 'sync'], tmpDir);
  assert.ok(s.success, `state sync failed: ${s.error}`);
  return totalFromStateJson();
}

const BRACKET_ROADMAP = `# Roadmap

## [GSD.02] v2.0

### [GSD.02] 01: Setup
**Goal:** Groundwork

### [GSD.02] 05: Real work
**Goal:** Build it

### [GSD.02] 06: Follow-up
**Goal:** Polish it
`;

describe('#612 PR-2: bracket phase headings enter total_phases', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-count-'); });
  afterEach(() => { cleanup(tmpDir); });

  test('the read path counts all three bracket phases (exact)', () => {
    writeProject(BRACKET_ROADMAP);
    assert.equal(totalFromStateJson(), 3);
  });

  test('#3242: BOTH derivations agree on a bracket roadmap', () => {
    writeProject(BRACKET_ROADMAP);
    const read = totalFromStateJson();
    const afterSync = totalFromStateSync();
    assert.equal(read, 3, 'read path exact');
    assert.equal(afterSync, 3, 'write path exact');
    assert.equal(
      read, afterSync,
      'state json and state sync must derive the same total for one repo',
    );
  });

  test('a mixed legacy + bracket roadmap counts both forms', () => {
    writeProject(`# Roadmap

## v2.0

### Phase 1: Legacy one
**Goal:** a

### [GSD.02] 05: Bracket one
**Goal:** b

### Phase Overview:
`);
    const read = totalFromStateJson();
    const afterSync = totalFromStateSync();
    assert.equal(read, 2, 'both real phases, and `Phase Overview:` excluded');
    assert.equal(afterSync, 2);
  });
});

describe('#612 PR-2: bracket sentinel headings stay OUT of total_phases', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-count-sent-'); });
  afterEach(() => { cleanup(tmpDir); });

  // The #1445 fixture shape translated to bracket. Before the widening these
  // headings matched nothing and were excluded by accident; after it they match,
  // so the sentinel must be read from the BRACKET or an icebox item inflates
  // the denominator — silently, per #1446.
  const SENTINEL_ROADMAP = `# Roadmap

## [GSD.02] v2.0

### [GSD.999] 01: Icebox item
**Goal:** Someday

### [GSD.00] 02: Pre-milestone groundwork
**Goal:** Before v1

### [GSD.02] 05: Real work
**Goal:** Build it

### [GSD.02] 06: Follow-up
**Goal:** Polish it
`;

  test('999.x and 0.x bracket milestones are excluded from BOTH counters (exact)', () => {
    writeProject(SENTINEL_ROADMAP);
    const read = totalFromStateJson();
    const afterSync = totalFromStateSync();
    assert.equal(read, 2, '`### [GSD.999] 01:` must not count anywhere');
    assert.equal(afterSync, 2, 'and not in the write path either');
    assert.equal(read, afterSync);
  });

  test('a bracket phase numbered 999 under a REAL milestone still counts', () => {
    // READING-B: the sentinel is the milestone integer, not the phase token.
    writeProject(`# Roadmap

## [GSD.02] v2.0

### [GSD.02] 999: Late work
**Goal:** Build it
`);
    assert.equal(totalFromStateJson(), 1);
  });
});

describe('#612 PR-2: legacy counting is byte-identical', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-count-legacy-'); });
  afterEach(() => { cleanup(tmpDir); });

  test('#549: pure-word section headings still excluded (exact)', () => {
    writeProject(`# Roadmap

## v2.0

## Phase Overview:

### Phase 1: One
**Goal:** a

### Phase 2.1: Two point one
**Goal:** b

### Phase 12A: Letter suffix
**Goal:** c

#### Phase Details:
`);
    const read = totalFromStateJson();
    const afterSync = totalFromStateSync();
    assert.equal(read, 3, 'Overview/Details excluded, 2.1 and 12A included');
    assert.equal(afterSync, 3);
  });

  test('#1445: a legacy 999.x heading is still excluded from the read path', () => {
    writeProject(`# Roadmap

## v2.0

### Phase 999.1: Icebox
**Goal:** someday

### Phase 5: Real
**Goal:** build
`);
    assert.equal(totalFromStateJson(), 1, 'legacy /^999\\b/ token filter unchanged');
  });

  test('a project-code phase id still counts (exact)', () => {
    writeProject(`# Roadmap

## v2.0

### Phase PROJ-42: Coded
**Goal:** a

### Phase 5: Real
**Goal:** b
`);
    const read = totalFromStateJson();
    const afterSync = totalFromStateSync();
    assert.equal(read, 2);
    assert.equal(afterSync, 2);
  });
});
