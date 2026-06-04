'use strict';

/**
 * PR 2 — bracket phase-ID read tolerance: verify.cts bracket-coherence (#612).
 *
 * Surface under test: `cmdValidateHealth` (reached via `gsd-tools validate
 * health`), specifically `checkMilestonePrefixMismatches` + its W021 gate
 * (verify.cts:1235) and the milestone-complete-vs-unstarted check (verify.cts
 * :1311) whose code collides on W021 (CARRY-FORWARD §4 B5).
 *
 * IMPORTANT — CLI surface: these scenarios drive `validate health`, NOT
 * `roadmap validate`. The `roadmap validate` subcommand routes to a SEPARATE
 * `checkW021` living in roadmap-command-router.cts; the verify.cts function is
 * reachable ONLY through `validate health`. (The legacy M-NN W021 coverage in
 * milestone-prefixed-convention.test.cjs deliberately uses the other surface.)
 *
 * RED reasoning (read-only analysis, tests run the built .cjs not .cts): today
 * the verify.cts W021 gate is keyed on `phase_id_convention === 'milestone-
 * prefixed'`, so under a `'bracket'` repo `checkMilestonePrefixMismatches` is
 * never called and emits nothing — the firing tests below fail today. The
 * milestone-complete check currently emits literal 'W021' for legacy `### Phase
 * N:` headings (its check is NOT convention-gated), so the W022-renumber test
 * fails today too. The two GUARD tests (sentinel-exempt, null-convention
 * install-base) are green both before and after — they assert the gate
 * firewall holds; nothing inside the rewritten function is reachable for
 * null/milestone-prefixed repos.
 *
 * Ratified contract: docs/adr/612-bracket-phase-id-convention.md;
 * CARRY-FORWARD.md §2 (PR-2 verify surfaces) + §3 (PR-2 scenarios) + §4 B5/B6.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeConfig(tmpDir, obj) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'config.json'),
    JSON.stringify({ model_profile: 'balanced', commit_docs: true, ...obj }, null, 2),
  );
}

function writeRoadmap(tmpDir, body) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), body);
}

function writeState(tmpDir, content) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), content);
}

function writeProject(tmpDir) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'PROJECT.md'),
    '# Project\n\n## What This Is\n\nx\n\n## Core Value\n\nx\n\n## Requirements\n\nx\n',
  );
}

function health(tmpDir) {
  const r = runGsdTools('validate health', tmpDir);
  assert.ok(r.success, `validate health failed: ${r.error}`);
  return JSON.parse(r.output);
}

function w021s(out) {
  return (out.warnings || []).filter((w) => w.code === 'W021');
}
function w022s(out) {
  return (out.warnings || []).filter((w) => w.code === 'W022');
}

// ===========================================================================
// Sub-check A — bracket-integer coherence (W021, gated on 'bracket')
// ===========================================================================

describe('PR2-C: bracket-integer coherence W021 (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('W021 fires when a phase\'s in-bracket milestone differs from its section', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'bracket' });
    // Section says milestone 02; phase carries milestone 03 → incoherent.
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.03] 05: Wrong Milestone Phase
**Goal:** g
`);
    const out = health(tmpDir);
    const hits = w021s(out);
    assert.ok(hits.length > 0,
      `expected a W021 bracket-integer mismatch; got ${JSON.stringify(out.warnings)}`);
    assert.ok(hits.some((w) => /05/.test(w.message)),
      `W021 should name the offending phase; got ${JSON.stringify(hits.map((w) => w.message))}`);
  });

  test('W021 does NOT fire when phase in-bracket milestone matches its section', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'bracket' });
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.02] 05: Coherent Phase
**Goal:** g
`);
    const out = health(tmpDir);
    assert.equal(w021s(out).length, 0,
      `coherent bracket phase must not warn; got ${JSON.stringify(out.warnings)}`);
  });

  test('W021 fix-text references --convention bracket', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'bracket' });
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.03] 05: Wrong Milestone Phase
**Goal:** g
`);
    const out = health(tmpDir);
    const hits = w021s(out);
    assert.ok(hits.length > 0, 'expected W021');
    assert.ok(hits.some((w) => /--convention bracket/.test(w.fix) || /--convention bracket/.test(w.message)),
      `W021 fix should reference '--convention bracket'; got ${JSON.stringify(hits)}`);
  });
});

// ===========================================================================
// Sub-check B — bracket-form-presence (W021, fires when bracket ABSENT)
// ===========================================================================

describe('PR2-C: bracket-form-presence W021 (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('W021 fires under bracket convention when a phase heading is NOT in bracket form', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'bracket' });
    // Legacy heading under a repo that has opted into bracket → presence failure.
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### Phase 5: Legacy Heading In A Bracket Repo
**Goal:** g
`);
    const out = health(tmpDir);
    assert.ok(w021s(out).length > 0,
      `non-bracket phase heading in a 'bracket' repo must fire W021; got ${JSON.stringify(out.warnings)}`);
  });

  // Boundary lock: the presence sub-check is intentionally broad (any non-bracket
  // colon-terminated `…N:` heading), but it keys on a trailing DIGIT-then-colon —
  // ordinary prose/section headings (no `\d+:`) must NOT be false-flagged.
  test('presence check ignores ordinary non-phase headings (no trailing digit-colon)', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'bracket' });
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.02] 05: Real Coherent Phase
**Goal:** g

### Success Criteria:
- a thing

### Overview

## Phases
`);
    const out = health(tmpDir);
    assert.equal(w021s(out).length, 0,
      `ordinary headings without a trailing digit-colon must not fire missing-bracket W021; got ${JSON.stringify(out.warnings)}`);
  });

  // Documented boundary (NOT a silent assumption): both bracket sub-checks are
  // SECTION-SCOPED — they only run inside a detected `## [CODE.MM] Name` section.
  // A flat bracket roadmap with no milestone section heading (e.g. an HQ-NN
  // single-milestone project) therefore gets NO presence/coherence checking.
  // Integer-coherence is moot single-milestone (nothing to mismatch); the
  // presence check going dark is the conscious gap (warning-only, outside §3).
  // This test pins the current behavior so a future change to whole-doc scoping
  // is a deliberate, test-visible decision.
  test('section-less flat bracket roadmap is unchecked (presence is section-scoped)', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'bracket' });
    // No `## [CODE.MM]` milestone section heading — a stray legacy phase heading.
    writeRoadmap(tmpDir,
`# Roadmap

### Phase 5: Legacy Heading, No Milestone Section
**Goal:** g
`);
    const out = health(tmpDir);
    assert.equal(w021s(out).length, 0,
      `section-scoped behavior: a section-less roadmap fires no bracket W021 (pinned, not aspirational); got ${JSON.stringify(out.warnings)}`);
  });
});

// ===========================================================================
// GUARD — sentinel exemption (green both ways)
// ===========================================================================

describe('PR2-C: sentinel bracket integers are coherence-exempt (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('999 / 0 sentinel sections+phases never fire bracket coherence W021', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'bracket' });
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.999] Backlog

### [GSD.999] 02: Backlog Item
**Goal:** g

## [GSD.0] Pre-Milestone

### [GSD.0] 01: Pre-Milestone Work
**Goal:** g
`);
    const out = health(tmpDir);
    assert.equal(w021s(out).length, 0,
      `sentinel ranges (0/999) must be exempt; got ${JSON.stringify(out.warnings)}`);
  });
});

// ===========================================================================
// GUARD — install-base regression: null / milestone-prefixed repos see NO new
// W-code. This is the single most important test (B6: reads tolerant, CHECKS
// gated). Green both before and after — the gate is the firewall.
// ===========================================================================

describe('PR2-C: install-base guard — no new W-code for legacy repos (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('null-convention repo with a milestone-mismatched phase fires NO bracket W021', () => {
    writeProject(tmpDir);
    // No phase_id_convention key → null.
    writeConfig(tmpDir, {});
    // A roadmap that WOULD be incoherent under bracket rules.
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.03] 05: Would Be A Mismatch Under Bracket
**Goal:** g
`);
    const out = health(tmpDir);
    assert.equal(w021s(out).length, 0,
      `null-convention repo must not see bracket coherence W021; got ${JSON.stringify(out.warnings)}`);
  });

  test("'milestone-prefixed' repo does not gain bracket-coherence W021", () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'milestone-prefixed' });
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.03] 05: Bracket-Shaped But Under M-NN Convention
**Goal:** g
`);
    const out = health(tmpDir);
    // The bracket coherence sub-checks are gated to 'bracket' only; an M-NN repo
    // must not pick them up. (M-NN's own W021 lives on the `roadmap validate`
    // surface, not here.)
    assert.equal(w021s(out).length, 0,
      `milestone-prefixed repo must not gain bracket W021 via validate health; got ${JSON.stringify(out.warnings)}`);
  });
});

// ===========================================================================
// B5 — W021 collision renumber: milestone-complete-vs-unstarted → W022
// ===========================================================================

describe('PR2-C: milestone-complete check renumbered off the W021 collision (#612 B5)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('STATE complete + unstarted ROADMAP phase emits W022, not W021', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, {}); // null convention — isolate the milestone-complete check
    writeState(tmpDir, '---\nstatus: milestone complete\n---\n# Session State\n');
    // Legacy phase heading with no on-disk phase dir → "unstarted".
    writeRoadmap(tmpDir,
`# Roadmap

### Phase 5: Never Started
**Goal:** g
`);
    const out = health(tmpDir);
    const w22 = w022s(out);
    assert.ok(w22.length > 0,
      `milestone-complete-vs-unstarted must now emit W022; got ${JSON.stringify(out.warnings)}`);
    assert.ok(w22.some((w) => /milestone complete|unstarted/i.test(w.message)),
      `W022 should be the milestone-complete check; got ${JSON.stringify(w22.map((w) => w.message))}`);
    // And it must NOT masquerade as W021 anymore.
    assert.ok(
      !w021s(out).some((w) => /unstarted/i.test(w.message)),
      `the milestone-complete message must no longer carry code W021; got ${JSON.stringify(out.warnings)}`,
    );
  });

  test('milestone-complete check is bracket-tolerant (B6): bracket heading counts as a phase', () => {
    writeProject(tmpDir);
    writeConfig(tmpDir, { phase_id_convention: 'bracket' });
    writeState(tmpDir, '---\nstatus: milestone complete\n---\n# Session State\n');
    // A bracket phase heading with no on-disk dir. Today the check's literal
    // 'Phase' regex misses it (goes blind under bracket); after the
    // PHASE_HEADING_PREFIX_SRC edit it is recognized as an unstarted phase.
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.02] 05: Never Started
**Goal:** g
`);
    const out = health(tmpDir);
    assert.ok(w022s(out).length > 0,
      `bracket phase heading must be seen by the (now bracket-tolerant) milestone-complete check; got ${JSON.stringify(out.warnings)}`);
  });
});
