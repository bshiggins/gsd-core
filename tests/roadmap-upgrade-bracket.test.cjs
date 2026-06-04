/**
 * PR 3 — bracket phase-ID migrator: roadmap-upgrade.cts (#612).
 *
 * Ratified contract: ADR docs/adr/612-bracket-phase-id-convention.md;
 * CARRY-FORWARD.md §2 (PR-3 migrator surfaces) + §3 (PR-3 scenarios) + §4
 * (B-migrator-real-layouts).
 *
 * The migrator retargets from M-NN to BRACKET as the terminal form:
 *   - dir:      {CODE}.{MM}-{SS}-slug          (GSD.02-01-foo)
 *   - heading:  ### [{CODE}.{MM}] {SS}: Name
 *   - checklist:- [ ] **[{CODE}.{MM}] {SS}: Name**
 *   - config:   phase_id_convention: 'bracket'
 * M-NN demotes from terminal to a convertible SOURCE: `Phase 2-01` lifts to
 * `[CODE.02] 01`, deep `Phase 2-04-01` to `[CODE.02] 04.01`.
 * Bracket requires `[CODE.MM]`, so a repo with no project_code HARD-REFUSES.
 *
 * Dry-run (`roadmap upgrade`) prints the MigrationPlan JSON to stdout; apply
 * (`roadmap upgrade --apply`) mutates on disk behind the dirty-guard + rollback.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runGsdTools, createTempProject, createTempGitProject, cleanup } = require('./helpers.cjs');

function p(tmpDir, ...rest) { return path.join(tmpDir, '.planning', ...rest); }
function writeRoadmap(tmpDir, body) { fs.writeFileSync(p(tmpDir, 'ROADMAP.md'), body); }
function writeConfig(tmpDir, obj) { fs.writeFileSync(p(tmpDir, 'config.json'), JSON.stringify(obj, null, 2)); }
function mkPhaseDir(tmpDir, name) { fs.mkdirSync(p(tmpDir, 'phases', name), { recursive: true }); }

// Dry-run: parse the printed MigrationPlan JSON.
function plan(tmpDir) {
  const r = runGsdTools(['roadmap', 'upgrade'], tmpDir);
  assert.ok(r.success, `roadmap upgrade (dry-run) failed: ${r.error}`);
  return JSON.parse(r.output);
}

describe('PR3-A: migrator legacy → bracket (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('legacy `Phase N` under `## v2.0` → bracket dirs + headings (project_code GSD)', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v2.0 Foundation

- [ ] **Phase 1: Foo**
- [ ] **Phase 2: Bar**

### Phase 1: Foo
**Goal:** g

### Phase 2: Bar
**Goal:** g
`);
    mkPhaseDir(tmpDir, '01-foo');
    mkPhaseDir(tmpDir, '02-bar');

    const pl = plan(tmpDir);
    assert.equal(pl.alreadyMigrated, false, `should produce a plan; got ${JSON.stringify(pl)}`);
    const newDirs = pl.phases.map((x) => x.newDir).sort();
    assert.deepEqual(newDirs, ['GSD.02-01-foo', 'GSD.02-02-bar'],
      `bracket dirs expected; got ${JSON.stringify(pl.phases)}`);
    const tos = pl.roadmapEdits.map((e) => e.to);
    assert.ok(tos.some((t) => /^#{2,4}\s*\[GSD\.02\]\s*01\s*:/.test(t)),
      `heading should rewrite to bracket form; got ${JSON.stringify(tos)}`);
    // checklist bullets also retarget to bracket form
    assert.ok(tos.some((t) => /-\s*\[ \]\s*\*\*\[GSD\.02\]\s*01\s*:/.test(t)),
      `checklist bullet should rewrite to bracket form; got ${JSON.stringify(tos)}`);
  });

  test('M-NN `Phase 2-01` is a SOURCE that lifts to `[GSD.02] 01` (not treated as already-done)', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v2.0 Foundation

### Phase 2-01: Foo
**Goal:** g
`);
    mkPhaseDir(tmpDir, 'GSD-02-01-foo');

    const pl = plan(tmpDir);
    assert.equal(pl.alreadyMigrated, false,
      `M-NN must be a convertible source, not terminal; got ${JSON.stringify(pl)}`);
    assert.ok(pl.phases.some((x) => x.newDir === 'GSD.02-01-foo'),
      `M-NN dir should lift to bracket; got ${JSON.stringify(pl.phases)}`);
    const tos = pl.roadmapEdits.map((e) => e.to);
    assert.ok(tos.some((t) => /\[GSD\.02\]\s*01\s*:/.test(t)),
      `M-NN heading should lift to [GSD.02] 01:; got ${JSON.stringify(tos)}`);
  });

  test('deep M-NN `Phase 2-04-01` lifts to `[GSD.02] 04.01`', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v2.0 Foundation

### Phase 2-04-01: Deep
**Goal:** g
`);
    const pl = plan(tmpDir);
    const tos = pl.roadmapEdits.map((e) => e.to);
    assert.ok(tos.some((t) => /\[GSD\.02\]\s*04\.01\s*:/.test(t)),
      `deep M-NN should lift to [GSD.02] 04.01:; got ${JSON.stringify(tos)}`);
  });

  test('HARD-REFUSE: a repo with no project_code cannot emit bracket and refuses (no plan)', () => {
    writeConfig(tmpDir, {}); // no project_code
    writeRoadmap(tmpDir,
`# Roadmap

## v2.0 Foundation

### Phase 1: Foo
**Goal:** g
`);
    mkPhaseDir(tmpDir, '01-foo');
    const r = runGsdTools(['roadmap', 'upgrade'], tmpDir);
    // Either a non-zero exit OR an alreadyMigrated:false plan that emits NOTHING
    // is unacceptable — bracket without [CODE.MM] is impossible; it must refuse.
    const refused = !r.success || /project_code|cannot|refus/i.test(r.output + r.error);
    assert.ok(refused,
      `no-project_code repo must HARD-REFUSE, not emit unprefixed dirs; got success=${r.success} out=${r.output} err=${r.error}`);
    if (r.success) {
      // If it exits 0, it must NOT have produced any unprefixed bracket dirs.
      let pl; try { pl = JSON.parse(r.output); } catch { pl = null; }
      if (pl && Array.isArray(pl.phases)) {
        assert.equal(pl.phases.length, 0, `must not plan any renames without project_code; got ${JSON.stringify(pl.phases)}`);
      }
    }
  });

  test('idempotent: an already-bracket roadmap is alreadyMigrated (no edits)', () => {
    writeConfig(tmpDir, { project_code: 'GSD', phase_id_convention: 'bracket' });
    writeRoadmap(tmpDir,
`# Roadmap

## [GSD.02] Foundation

### [GSD.02] 01: Foo
**Goal:** g
`);
    const pl = plan(tmpDir);
    assert.equal(pl.alreadyMigrated, true,
      `already-bracket repo must be idempotent; got ${JSON.stringify(pl)}`);
  });
});

describe('PR3-B: migrator real-layout bugs (#612 B-migrator-real-layouts)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('multi-milestone legacy keeps DISTINCT per-milestone prefixes (no flatten)', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v1.0 Foundation

### Phase 1: A
**Goal:** g

### Phase 2: B
**Goal:** g

## v2.0 Next

### Phase 1: C
**Goal:** g
`);
    const pl = plan(tmpDir);
    const tos = pl.roadmapEdits.map((e) => e.to);
    // v1 phases land under [GSD.01] with their own 01/02 counter; v2 restarts at 01.
    assert.ok(tos.some((t) => /\[GSD\.01\]\s*01\s*:\s*A/.test(t)), `v1 Phase1→[GSD.01] 01; got ${JSON.stringify(tos)}`);
    assert.ok(tos.some((t) => /\[GSD\.01\]\s*02\s*:\s*B/.test(t)), `v1 Phase2→[GSD.01] 02; got ${JSON.stringify(tos)}`);
    assert.ok(tos.some((t) => /\[GSD\.02\]\s*01\s*:\s*C/.test(t)), `v2 Phase1→[GSD.02] 01 (not flattened); got ${JSON.stringify(tos)}`);
  });

  test('single-milestone HQ-NN (no ## vN.M heading) derives milestone from STATE.md', () => {
    writeConfig(tmpDir, { project_code: 'HQ' });
    // No milestone version heading anywhere — milestone identity is in STATE.md.
    fs.writeFileSync(p(tmpDir, 'STATE.md'), '---\nmilestone: v1.0\n---\n# Session State\n');
    writeRoadmap(tmpDir,
`# Roadmap

### Phase 1: Alpha
**Goal:** g

### Phase 2: Beta
**Goal:** g
`);
    const pl = plan(tmpDir);
    assert.equal(pl.alreadyMigrated, false,
      `single-milestone repo must NOT 0-op; got ${JSON.stringify(pl)}`);
    const tos = pl.roadmapEdits.map((e) => e.to);
    assert.ok(tos.some((t) => /\[HQ\.01\]\s*01\s*:\s*Alpha/.test(t)),
      `Phase 1 should become [HQ.01] 01 (milestone derived from STATE.md); got ${JSON.stringify(tos)}`);
    assert.ok(tos.some((t) => /\[HQ\.01\]\s*02\s*:\s*Beta/.test(t)),
      `Phase 2 should become [HQ.01] 02; got ${JSON.stringify(tos)}`);
  });
});

describe('PR3-A: migrator apply end-to-end (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempGitProject(); });
  afterEach(() => cleanup(tmpDir));

  test('--apply renames dirs, rewrites headings, sets config bracket', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v2.0 Foundation

### Phase 1: Foo
**Goal:** g
`);
    mkPhaseDir(tmpDir, '01-foo');
    // commit so the working tree is clean for the dirty-guard
    const { execSync } = require('node:child_process');
    execSync('git add -A && git commit -m fixture -q', { cwd: tmpDir });

    const r = runGsdTools(['roadmap', 'upgrade', '--apply'], tmpDir);
    assert.ok(r.success, `apply failed: ${r.error}`);
    assert.ok(fs.existsSync(p(tmpDir, 'phases', 'GSD.02-01-foo')),
      `dir should be renamed to GSD.02-01-foo; got ${fs.readdirSync(p(tmpDir, 'phases'))}`);
    assert.ok(!fs.existsSync(p(tmpDir, 'phases', '01-foo')), 'old dir should be gone');
    const roadmap = fs.readFileSync(p(tmpDir, 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /\[GSD\.02\]\s*01\s*:/, 'ROADMAP heading rewritten to bracket');
    const cfg = JSON.parse(fs.readFileSync(p(tmpDir, 'config.json'), 'utf8'));
    assert.equal(cfg.phase_id_convention, 'bracket', 'config convention set to bracket');
  });

  test('--apply on a DIRTY tree refuses and mutates nothing', () => {
    const { execSync } = require('node:child_process');
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v2.0 Foundation

### Phase 1: Foo
**Goal:** g
`);
    mkPhaseDir(tmpDir, '01-foo');
    execSync('git add -A && git commit -m fixture -q', { cwd: tmpDir });
    // Dirty the tree.
    fs.writeFileSync(p(tmpDir, 'ROADMAP.md'), fs.readFileSync(p(tmpDir, 'ROADMAP.md'), 'utf8') + '\nuncommitted\n');

    const r = runGsdTools(['roadmap', 'upgrade', '--apply'], tmpDir);
    assert.ok(!r.success, `dirty tree must refuse; got success=${r.success}`);
    assert.ok(/dirty|commit|stash/i.test(r.error), `should explain the dirty-tree refusal; got ${r.error}`);
    assert.ok(fs.existsSync(p(tmpDir, 'phases', '01-foo')), 'no dir should be renamed on a dirty tree');
  });

  test('--apply rolls back on a mid-apply fault (target occupied)', () => {
    const { execSync } = require('node:child_process');
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v2.0 Foundation

### Phase 1: Foo
**Goal:** g
`);
    mkPhaseDir(tmpDir, '01-foo');
    fs.writeFileSync(p(tmpDir, 'phases', '01-foo', 'PLAN.md'), 'x'); // tracked content (git ignores empty dirs)
    // Occupy the rename TARGET with a committed regular file so renameSync throws.
    fs.writeFileSync(p(tmpDir, 'phases', 'GSD.02-01-foo'), 'occupied');
    execSync('git add -A && git commit -m fixture -q', { cwd: tmpDir });

    const r = runGsdTools(['roadmap', 'upgrade', '--apply'], tmpDir);
    assert.ok(!r.success, `a mid-apply fault must fail (rolled back); got success=${r.success}`);
    // Rollback (git reset --hard + clean) restores the original layout.
    assert.ok(fs.existsSync(p(tmpDir, 'phases', '01-foo')), 'original dir must be restored after rollback');
    const cfg = JSON.parse(fs.readFileSync(p(tmpDir, 'config.json'), 'utf8'));
    assert.notEqual(cfg.phase_id_convention, 'bracket', 'config must not be flipped after a rolled-back apply');
  });
});

describe('PR3-C: migrator sentinel + slug safety (#612)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('sentinel milestone v999 migrates to [CODE.999] (not skipped/mangled)', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v999.0 Backlog

### Phase 1: Someday
**Goal:** g
`);
    const pl = plan(tmpDir);
    const tos = pl.roadmapEdits.map((e) => e.to);
    assert.ok(tos.some((t) => /\[GSD\.999\]\s*01\s*:\s*Someday/.test(t)),
      `sentinel milestone should bracket-ify to [GSD.999] 01; got ${JSON.stringify(tos)}`);
  });

  test('a hostile slug in a phase dir is sanitized (no path traversal)', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeRoadmap(tmpDir,
`# Roadmap

## v2.0 Foundation

### Phase 1: Foo
**Goal:** g
`);
    // A dir whose slug contains traversal characters.
    mkPhaseDir(tmpDir, '01-..-..-etc');
    const pl = plan(tmpDir);
    const target = pl.phases.find((x) => x.oldDir === '01-..-..-etc');
    assert.ok(target, `dir should be matched; got ${JSON.stringify(pl.phases)}`);
    assert.ok(!target.newDir.includes('..'), `newDir must not contain '..'; got ${target.newDir}`);
    assert.ok(!/[/\\]/.test(target.newDir.replace(/^[^/]*/, '')), `newDir must not introduce path separators; got ${target.newDir}`);
  });
});
