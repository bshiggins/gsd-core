'use strict';

/**
 * Bracket WRITE path (Wave-2a gap).
 *
 * Covers the two ROADMAP.md write commands in roadmap.cjs operating on a
 * BRACKET roadmap (`## [GSD.02] Name` milestone sections + `### [GSD.02] 05:`
 * phase headings), proving they FIND and UPDATE bracket phases — not just the
 * legacy `Phase N` form:
 *
 *   - `roadmap update-plan-progress <N>` (cmdRoadmapUpdatePlanProgress):
 *       progress-table row, `**Plans:**` count, and the phase checkbox are all
 *       scoped through `replaceInCurrentMilestone` → `extractCurrentMilestoneBracket`.
 *       The fixture deliberately makes the phase COMPLETE (summaries >= plans)
 *       so the milestone-scoped checkbox + plan-count edits fire (the load-
 *       bearing bracket-scoped writes, distinct from the unscoped per-plan
 *       checkbox).
 *   - `roadmap annotate-dependencies <N>` (cmdRoadmapAnnotateDependencies):
 *       wave headers + cross-cutting constraints inserted into the bracket
 *       phase's plan list.
 *
 * Both resolve the phase dir via findPhaseInternal (bracket dir
 * `GSD.02-05-slug/`) and match the ROADMAP heading via the
 * `(?:\[…\]\s*|Phase\s+)` bracket alternation.
 *
 * Contract: BRACKET-NATIVE-CJS-SCOPE.md §4.2 + ADDENDUM-3 (bracket heading
 * forms). Subprocess harness (runGsdTools) on a createTempProject fixture.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function planningPath(tmpDir, ...rest) {
  return path.join(tmpDir, '.planning', ...rest);
}

function writeConfig(tmpDir, obj) {
  fs.writeFileSync(planningPath(tmpDir, 'config.json'), JSON.stringify(obj, null, 2));
}

function writeState(tmpDir, milestone = 'v2.0', name = 'Foundation') {
  fs.writeFileSync(
    planningPath(tmpDir, 'STATE.md'),
    `---\nmilestone: ${milestone}\nmilestone_name: ${name}\n---\n`,
  );
}

function writeRoadmap(tmpDir, lines) {
  fs.writeFileSync(planningPath(tmpDir, 'ROADMAP.md'), lines.join('\n') + '\n');
}

/** Create a bracket phase directory `GSD.02-<token>-<slug>/` and return its abs path. */
function makePhaseDir(tmpDir, dirName) {
  const dir = planningPath(tmpDir, 'phases', dirName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

// ---------------------------------------------------------------------------
// update-plan-progress
// ---------------------------------------------------------------------------

describe('bracket write path — roadmap update-plan-progress', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('updates the progress table, **Plans:** count, and bracket phase checkbox for a complete bracket phase', () => {
    writeConfig(tmpDir, { phase_id_convention: 'bracket', project_code: 'GSD' });
    writeState(tmpDir, 'v2.0', 'Foundation');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '| Phase | Plans | Status | Completed |',
      '|-------|-------|--------|-----------|',
      '| 05    | 0/0   | Planned    |   |',
      '',
      '### [GSD.02] 05: Some Feature',
      '**Goal:** ship it',
      '**Plans:** 0 plans',
      '',
      '- [ ] **[GSD.02] 05: Some Feature**',
    ]);

    // Bracket phase dir with one plan + its summary → phase is COMPLETE, so the
    // milestone-scoped checkbox + plan-count edits fire.
    const phaseDir = makePhaseDir(tmpDir, 'GSD.02-05-some-feature');
    writeFile(phaseDir, '05-01-PLAN.md', '# Plan\n');
    writeFile(phaseDir, '05-01-SUMMARY.md', '# Summary\n');

    const result = runGsdTools(['roadmap', 'update-plan-progress', '05'], tmpDir);
    assert.ok(result.success, `update-plan-progress failed: ${result.error}`);

    const out = JSON.parse(result.output);
    assert.strictEqual(out.updated, true, 'command reports updated:true on the bracket phase');
    assert.strictEqual(out.complete, true, 'phase is complete (1/1)');
    assert.strictEqual(out.plan_count, 1);
    assert.strictEqual(out.summary_count, 1);

    const roadmap = fs.readFileSync(planningPath(tmpDir, 'ROADMAP.md'), 'utf-8');
    // Progress table row updated (unscoped — but proves the bracket dir was found).
    assert.match(roadmap, /\|\s*05\s*\|\s*1\/1\s*\|\s*Complete/, 'progress table row updated to 1/1 Complete');
    // **Plans:** count line updated — this edit is scoped to the active bracket
    // milestone section, proving bracket heading-match + bracket scoping work.
    assert.match(roadmap, /\*\*Plans:\*\*\s*1\/1 plans complete/, 'bracket phase **Plans:** count updated');
    // The bracket phase checkbox is checked (also milestone-scoped).
    assert.match(
      roadmap,
      /- \[x\] \*\*\[GSD\.02\] 05: Some Feature\*\* \(completed /,
      'bracket phase checkbox checked + dated',
    );
  });

  test('finds the bracket phase dir even when its token is double-digit (GSD.02-12-…)', () => {
    writeConfig(tmpDir, { phase_id_convention: 'bracket', project_code: 'GSD' });
    writeState(tmpDir, 'v2.0', 'Foundation');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 12: Late Phase',
      '**Goal:** later',
      '**Plans:** 0 plans',
      '',
      '- [ ] **[GSD.02] 12: Late Phase**',
    ]);
    const phaseDir = makePhaseDir(tmpDir, 'GSD.02-12-late-phase');
    writeFile(phaseDir, '12-01-PLAN.md', '# Plan\n');
    writeFile(phaseDir, '12-01-SUMMARY.md', '# Summary\n');

    const result = runGsdTools(['roadmap', 'update-plan-progress', '12'], tmpDir);
    assert.ok(result.success, `update-plan-progress failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.updated, true, 'bracket phase 12 found + updated');
    assert.strictEqual(out.complete, true);

    const roadmap = fs.readFileSync(planningPath(tmpDir, 'ROADMAP.md'), 'utf-8');
    assert.match(roadmap, /\*\*Plans:\*\*\s*1\/1 plans complete/, 'phase 12 **Plans:** updated');
  });

  test('reports updated:false when the bracket phase dir has no plans (in-progress phase, no false write)', () => {
    writeConfig(tmpDir, { phase_id_convention: 'bracket', project_code: 'GSD' });
    writeState(tmpDir, 'v2.0', 'Foundation');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 05: Some Feature',
      '**Goal:** ship it',
    ]);
    makePhaseDir(tmpDir, 'GSD.02-05-some-feature'); // dir exists, no plans

    const before = fs.readFileSync(planningPath(tmpDir, 'ROADMAP.md'), 'utf-8');
    const result = runGsdTools(['roadmap', 'update-plan-progress', '05'], tmpDir);
    assert.ok(result.success, `update-plan-progress failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.updated, false, 'no plans → no update');
    const after = fs.readFileSync(planningPath(tmpDir, 'ROADMAP.md'), 'utf-8');
    assert.strictEqual(after, before, 'ROADMAP unchanged when there are no plans');
  });
});

// ---------------------------------------------------------------------------
// annotate-dependencies
// ---------------------------------------------------------------------------

describe('bracket write path — roadmap annotate-dependencies', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('inserts wave headers + cross-cutting constraints into a bracket phase plan list', () => {
    writeConfig(tmpDir, { phase_id_convention: 'bracket', project_code: 'GSD' });
    writeState(tmpDir, 'v2.0', 'Foundation');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 06: Multi Wave',
      '**Goal:** parallel build',
      '**Plans:** 2 plans across 2 waves',
      '',
      '- [ ] 06-01-PLAN.md — first',
      '- [ ] 06-02-PLAN.md — second',
    ]);

    const phaseDir = makePhaseDir(tmpDir, 'GSD.02-06-multi-wave');
    writeFile(phaseDir, '06-01-PLAN.md', [
      '---',
      'wave: 1',
      'must_haves:',
      '  truths:',
      '    - API contract is frozen',
      '---',
      '# Plan 1',
    ].join('\n'));
    writeFile(phaseDir, '06-02-PLAN.md', [
      '---',
      'wave: 2',
      'must_haves:',
      '  truths:',
      '    - API contract is frozen',
      '---',
      '# Plan 2',
    ].join('\n'));

    const result = runGsdTools(['roadmap', 'annotate-dependencies', '06'], tmpDir);
    assert.ok(result.success, `annotate-dependencies failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.updated, true, 'bracket phase 06 annotated');
    assert.strictEqual(out.waves, 2, 'two waves detected');
    assert.strictEqual(out.cross_cutting_constraints, 1, 'one shared truth surfaced');

    const roadmap = fs.readFileSync(planningPath(tmpDir, 'ROADMAP.md'), 'utf-8');
    assert.match(roadmap, /\*\*Wave 1\*\*/, 'Wave 1 header inserted');
    assert.match(
      roadmap,
      /\*\*Wave 2\*\* \*\(blocked on Wave 1 completion\)\*/,
      'Wave 2 blocked-on header inserted',
    );
    assert.match(roadmap, /\*\*Cross-cutting constraints:\*\*/, 'cross-cutting subsection inserted');
    assert.match(roadmap, /- API contract is frozen/, 'the shared truth is listed');
  });

  test('is idempotent — re-running on an already-annotated bracket phase is a no-op', () => {
    writeConfig(tmpDir, { phase_id_convention: 'bracket', project_code: 'GSD' });
    writeState(tmpDir, 'v2.0', 'Foundation');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 06: Multi Wave',
      '**Goal:** parallel build',
      '**Plans:** 2 plans across 2 waves',
      '',
      '- [ ] 06-01-PLAN.md — first',
      '- [ ] 06-02-PLAN.md — second',
    ]);
    const phaseDir = makePhaseDir(tmpDir, 'GSD.02-06-multi-wave');
    writeFile(phaseDir, '06-01-PLAN.md', '---\nwave: 1\n---\n# Plan 1\n');
    writeFile(phaseDir, '06-02-PLAN.md', '---\nwave: 2\n---\n# Plan 2\n');

    const first = runGsdTools(['roadmap', 'annotate-dependencies', '06'], tmpDir);
    assert.ok(first.success, `first annotate failed: ${first.error}`);
    assert.strictEqual(JSON.parse(first.output).updated, true);
    const afterFirst = fs.readFileSync(planningPath(tmpDir, 'ROADMAP.md'), 'utf-8');

    const second = runGsdTools(['roadmap', 'annotate-dependencies', '06'], tmpDir);
    assert.ok(second.success, `second annotate failed: ${second.error}`);
    assert.strictEqual(JSON.parse(second.output).updated, false, 'second run is a no-op (already annotated)');
    const afterSecond = fs.readFileSync(planningPath(tmpDir, 'ROADMAP.md'), 'utf-8');
    assert.strictEqual(afterSecond, afterFirst, 'ROADMAP unchanged on idempotent re-run');
  });
});
