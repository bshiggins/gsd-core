'use strict';

/**
 * Bracket read-path counter blindness (reland #612, RECURRENCE-FIX QUEUE item 1).
 *
 * buildStateFrontmatter sources total_phases from a standalone legacy
 * `#{2,4}\s*Phase\s+([\w][\w.-]*)\s*:` heading pattern (src/state.cts
 * roadmapPhaseCount). On a bracket-convention ROADMAP the phase headings are
 * `### [CK.03] NN: Name`, which that pattern does NOT match → roadmapPhaseCount
 * stays 0 → totalPhases silently falls back to phaseDirs.length and the
 * ROADMAP↔disk cross-check is dead (the carekit "v3 declares 16, disk shows
 * fewer" drift could never surface from STATE).
 *
 * Discriminator: ROADMAP declares 4 bracket phases [CK.03] 01–04 but only 2
 * phase dirs exist on disk.
 *   BEFORE fix: roadmapPhaseCount=0 → total_phases = dir count (2 or 0).
 *   AFTER fix:  bracket headings counted → total_phases = max(dirs, 4) = 4,
 *               matching roadmap.analyze (already bracket-aware via PR2).
 *
 * The fix routes roadmapPhaseCount through PHASE_HEADING_PREFIX_SRC
 * (src/phase-id.cts) — the bracket-OR-`Phase` prefix PR2 centralized — so this
 * also clears one site for PR6's "zero standalone literal `Phase\s+` parsers"
 * grep-evidence gate.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

// Bracket ROADMAP: 4 phases [CK.03] 01–04 under a v3.0 milestone section.
const ROADMAP = `## Milestone v3.0: Brand System

### [CK.03] 01: Foundation
**Goal:** tokens + modules

### [CK.03] 02: App Shell
**Goal:** shared shell

### [CK.03] 03: AEO Gate
**Goal:** on-page gate

### [CK.03] 04: Voice
**Goal:** voice files
`;

describe('bracket convention — total_phases counts bracket ROADMAP headings', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject('bracket-total-phases-');
    const planning = path.join(tmpDir, '.planning');

    fs.writeFileSync(path.join(planning, 'ROADMAP.md'), ROADMAP, 'utf-8');
    fs.writeFileSync(
      path.join(planning, 'STATE.md'),
      [
        '---',
        'gsd_state_version: 1.0',
        'milestone: v3.0',
        'milestone_name: Brand System',
        'status: executing',
        '---',
        '',
        '# Project State',
        '',
        '## Configuration',
        'Current Phase: 1',
        'Status: Executing Phase 1',
        'Last Activity: 2026-06-29',
        '',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(planning, 'config.json'),
      JSON.stringify({ phase_id_convention: 'bracket', project_code: 'CK' }),
      'utf-8',
    );

    // Only 2 of the 4 declared phases exist on disk — forces the ROADMAP-count
    // path to carry the denominator (dir-count fallback would under-report).
    for (const d of ['CK.03-01-foundation', 'CK.03-02-app-shell']) {
      const dir = path.join(planning, 'phases', d);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'PLAN.md'), '# Plan\n', 'utf-8');
    }
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('state json total_phases reflects the 4 declared bracket phases (not the 2 on disk)', () => {
    const stateResult = runGsdTools(['state', 'json'], tmpDir);
    assert.ok(stateResult.success, `state json failed: ${stateResult.error}`);
    const state = JSON.parse(stateResult.output);

    assert.ok(state.progress, 'state json must return a progress block');
    assert.equal(
      state.progress.total_phases,
      4,
      `bracket ROADMAP declares 4 phases ([CK.03] 01–04); total_phases must be 4, ` +
      `not the on-disk dir count. Got ${state.progress.total_phases}`,
    );
  });
});
