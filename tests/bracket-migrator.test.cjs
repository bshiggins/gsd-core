// Tests for WAVE 3 bracket-native migrator (roadmap-upgrade.cjs, SPEC §4.4).
//
// Contract: BRACKET-NATIVE-CJS-SCOPE.md §4.4 + ADDENDA (Q2 RENUMBER legacy,
// R1 READING-B, milestone heading `## [GSD.02] Name` per ADDENDUM-3, STATE.md
// `milestone:` in v-string form).
//
// The migrator is invoked via `runGsdTools('roadmap upgrade …')` (the router
// default convention is `bracket`). Fixtures are temp `.planning` projects with
// `git init` + an initial COMMIT so the `git reset --hard` rollback path has a
// tracked baseline to restore (reset alone restores only tracked files; the
// renamed dirs are tracked-deleted + untracked-new, so `git clean` removes the
// new ones and the assertion of a pristine tree is non-vacuous).

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const roadmapUpgrade = require('../get-shit-done/bin/lib/roadmap-upgrade.cjs');

// ─── fixture helpers ─────────────────────────────────────────────────────────

function git(tmpDir, args) {
  execFileSync('git', args, { cwd: tmpDir, stdio: 'pipe' });
}

/** Init a git repo and commit the current .planning tree as the baseline. */
function gitInitCommit(tmpDir) {
  git(tmpDir, ['init', '-q']);
  git(tmpDir, ['config', 'user.email', 'test@example.com']);
  git(tmpDir, ['config', 'user.name', 'Test']);
  git(tmpDir, ['add', '-A']);
  git(tmpDir, ['commit', '-q', '-m', 'baseline']);
}

function pDir(tmpDir) { return path.join(tmpDir, '.planning'); }

function writeConfig(tmpDir, obj) {
  fs.writeFileSync(path.join(pDir(tmpDir), 'config.json'), JSON.stringify(obj, null, 2) + '\n');
}
function readConfig(tmpDir) {
  return JSON.parse(fs.readFileSync(path.join(pDir(tmpDir), 'config.json'), 'utf8'));
}
function writeRoadmap(tmpDir, content) {
  fs.writeFileSync(path.join(pDir(tmpDir), 'ROADMAP.md'), content);
}
function readRoadmap(tmpDir) {
  return fs.readFileSync(path.join(pDir(tmpDir), 'ROADMAP.md'), 'utf8');
}
function writeState(tmpDir, content) {
  fs.writeFileSync(path.join(pDir(tmpDir), 'STATE.md'), content);
}
function readStateMilestone(tmpDir) {
  const sp = path.join(pDir(tmpDir), 'STATE.md');
  if (!fs.existsSync(sp)) return null;
  const m = fs.readFileSync(sp, 'utf8').match(/^milestone:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}
function mkPhaseDir(tmpDir, name) {
  const dir = path.join(pDir(tmpDir), 'phases', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PLAN.md'), `# ${name}\n`);
}
function listPhaseDirs(tmpDir) {
  const phasesDir = path.join(pDir(tmpDir), 'phases');
  if (!fs.existsSync(phasesDir)) return [];
  return fs.readdirSync(phasesDir).filter(d => fs.statSync(path.join(phasesDir, d)).isDirectory()).sort();
}
function gitClean(tmpDir) {
  return execFileSync('git', ['status', '--porcelain'], { cwd: tmpDir, encoding: 'utf8' }).trim();
}

// ─── 1. legacy single-milestone ─────────────────────────────────────────────

describe('legacy single-milestone → bracket (RENUMBER)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('renumbers sequentially, emits bracket headings + dirs, read path resolves', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## v1.0 Foundation',
      '',
      '### Summary',
      '- [x] **Phase 3: First Thing**',
      '- [ ] **Phase 7: Second Thing**',
      '',
      '### Phase 3: First Thing',
      '**Goal:** g1',
      '',
      '### Phase 7: Second Thing',
      '**Goal:** g2',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '03-first-thing');
    mkPhaseDir(tmpDir, '07-second-thing');
    gitInitCommit(tmpDir);

    const res = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.ok(res.success, `apply failed: ${res.error}`);

    // Renumbered sequentially: Phase 3 → SS 01, Phase 7 → SS 02.
    assert.deepStrictEqual(listPhaseDirs(tmpDir), ['GSD.01-01-first-thing', 'GSD.01-02-second-thing']);

    const rm = readRoadmap(tmpDir);
    assert.ok(/^## \[GSD\.01\] Foundation$/m.test(rm), `milestone section lifted to bracket; got:\n${rm}`);
    assert.ok(/^### \[GSD\.01\] 01: First Thing$/m.test(rm), 'phase 3 → [GSD.01] 01');
    assert.ok(/^### \[GSD\.01\] 02: Second Thing$/m.test(rm), 'phase 7 → [GSD.01] 02');
    // Checklist refs rewritten to bracket, "Phase" word stripped.
    assert.ok(/^- \[x\] \*\*\[GSD\.01\] 01: First Thing\*\*$/m.test(rm), `checklist rewritten to bracket; got:\n${rm}`);
    assert.ok(/^- \[ \] \*\*\[GSD\.01\] 02: Second Thing\*\*$/m.test(rm), `checklist rewritten; got:\n${rm}`);
    assert.ok(!/Phase\s+\d/.test(rm), `no "Phase" word remains; got:\n${rm}`);

    assert.strictEqual(readConfig(tmpDir).phase_id_convention, 'bracket');
    assert.strictEqual(readStateMilestone(tmpDir), 'v1.0', 'STATE.md milestone present');

    // Read path (Wave 1/2): bracket phase resolves by token.
    const get = runGsdTools('roadmap get-phase 01', tmpDir);
    assert.ok(get.success, `get-phase failed: ${get.error}`);
    const out = JSON.parse(get.output);
    assert.strictEqual(out.found, true, 'bracket phase 01 resolves');
    assert.strictEqual(out.phase_name, 'First Thing');

    // Validate emits no W021 (form-presence + coherence both satisfied).
    const val = runGsdTools('roadmap validate', tmpDir);
    assert.ok(val.success, `validate failed: ${val.error}`);
    const vout = JSON.parse(val.output);
    const w021 = (vout.warnings || []).filter(w => w.code === 'W021');
    assert.strictEqual(w021.length, 0, `no W021 after migration; got ${JSON.stringify(w021)}`);
  });
});

// ─── 2. legacy MULTI-milestone with COLLIDING Phase 1 ────────────────────────

describe('legacy multi-milestone colliding Phase 1 (collision-free renumber)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('two Phase 1 headings in v1.0 and v2.0 each get their own bracket id', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v2.0\n---\n');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## v1.0 First Milestone',
      '',
      '### Phase 1: Alpha',
      '**Goal:** ga',
      '',
      '### Phase 2: Beta',
      '**Goal:** gb',
      '',
      '## v2.0 Second Milestone',
      '',
      '### Phase 1: Gamma',
      '**Goal:** gg',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '01-alpha');
    mkPhaseDir(tmpDir, '02-beta');
    // Second-milestone Phase 1 dir collides on the bare number; give it a distinct slug.
    mkPhaseDir(tmpDir, '01-gamma');
    gitInitCommit(tmpDir);

    const res = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.ok(res.success, `apply failed: ${res.error}`);

    const dirs = listPhaseDirs(tmpDir);
    // v1.0: alpha→01, beta→02 ; v2.0: gamma→01 (per-milestone restart).
    assert.ok(dirs.includes('GSD.01-01-alpha'), `got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('GSD.01-02-beta'), `got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('GSD.02-01-gamma'), `got ${JSON.stringify(dirs)}`);

    const rm = readRoadmap(tmpDir);
    assert.ok(/^### \[GSD\.01\] 01: Alpha$/m.test(rm));
    assert.ok(/^### \[GSD\.02\] 01: Gamma$/m.test(rm), 'second milestone restarts at 01');

    // Coherence: each phase bracket MM matches its section → no W021.
    const val = runGsdTools('roadmap validate', tmpDir);
    const vout = JSON.parse(val.output);
    assert.strictEqual((vout.warnings || []).filter(w => w.code === 'W021').length, 0);
  });
});

// ─── 3. legacy decimal ───────────────────────────────────────────────────────

describe('legacy decimal phase → bracket', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('decimal Phase 2.1 renumbers into the sequential SS slot', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, [
      '## v1.0 Foundation',
      '',
      '### Phase 1: Base',
      '**Goal:** g1',
      '',
      '### Phase 2.1: Inserted Hotfix',
      '**Goal:** g2',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '01-base');
    mkPhaseDir(tmpDir, '02.1-inserted-hotfix');
    gitInitCommit(tmpDir);

    const res = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.ok(res.success, `apply failed: ${res.error}`);

    const dirs = listPhaseDirs(tmpDir);
    assert.ok(dirs.includes('GSD.01-01-base'), `got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('GSD.01-02-inserted-hotfix'), `decimal renumbered to SS 02; got ${JSON.stringify(dirs)}`);

    const rm = readRoadmap(tmpDir);
    assert.ok(/^### \[GSD\.01\] 02: Inserted Hotfix$/m.test(rm), `got:\n${rm}`);
    assert.strictEqual(readConfig(tmpDir).phase_id_convention, 'bracket');
  });
});

// ─── 4. M-NN flat (notation lift, preserve integer) ──────────────────────────

describe('M-NN flat → bracket (NOTATION LIFT)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('Phase 2-01 → [GSD.02] 01; dir GSD-02-01-slug → GSD.02-01-slug', () => {
    writeConfig(tmpDir, { project_code: 'GSD', phase_id_convention: 'milestone-prefixed' });
    writeState(tmpDir, '---\nmilestone: v2.0\n---\n');
    writeRoadmap(tmpDir, [
      '## v2.0 Core',
      '',
      '### Phase 2-01: Lifted Feature',
      '**Goal:** g1',
      '',
      '### Phase 2-02: Another',
      '**Goal:** g2',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, 'GSD-02-01-lifted-feature');
    mkPhaseDir(tmpDir, 'GSD-02-02-another');
    gitInitCommit(tmpDir);

    const res = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.ok(res.success, `apply failed: ${res.error}`);

    const dirs = listPhaseDirs(tmpDir);
    assert.ok(dirs.includes('GSD.02-01-lifted-feature'), `got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('GSD.02-02-another'), `got ${JSON.stringify(dirs)}`);

    const rm = readRoadmap(tmpDir);
    assert.ok(/^### \[GSD\.02\] 01: Lifted Feature$/m.test(rm), `phase integer preserved; got:\n${rm}`);
    assert.ok(/^### \[GSD\.02\] 02: Another$/m.test(rm));
    assert.ok(/^## \[GSD\.02\] Core$/m.test(rm), 'milestone section lifted');

    assert.strictEqual(readConfig(tmpDir).phase_id_convention, 'bracket');

    const get = runGsdTools('roadmap get-phase 01', tmpDir);
    const out = JSON.parse(get.output);
    assert.strictEqual(out.found, true);
    assert.strictEqual(out.phase_name, 'Lifted Feature');

    const val = runGsdTools('roadmap validate', tmpDir);
    const vout = JSON.parse(val.output);
    assert.strictEqual((vout.warnings || []).filter(w => w.code === 'W021').length, 0);
  });
});

// ─── 5. M-NN deep (2-04-01 → [GSD.02] 04.01) ─────────────────────────────────

describe('M-NN deep → bracket (hyphen-deep → dot-deep)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('Phase 2-04-01 → [GSD.02] 04.01; dir GSD-02-04-01-slug → GSD.02-04.01-slug', () => {
    writeConfig(tmpDir, { project_code: 'GSD', phase_id_convention: 'milestone-prefixed' });
    writeState(tmpDir, '---\nmilestone: v2.0\n---\n');
    writeRoadmap(tmpDir, [
      '## v2.0 Core',
      '',
      '### Phase 2-04: Parent',
      '**Goal:** gp',
      '',
      '### Phase 2-04-01: Deep Child',
      '**Goal:** gc',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, 'GSD-02-04-parent');
    mkPhaseDir(tmpDir, 'GSD-02-04-01-deep-child');
    gitInitCommit(tmpDir);

    const res = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.ok(res.success, `apply failed: ${res.error}`);

    const dirs = listPhaseDirs(tmpDir);
    assert.ok(dirs.includes('GSD.02-04-parent'), `got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('GSD.02-04.01-deep-child'), `deep hyphen → dot; got ${JSON.stringify(dirs)}`);

    const rm = readRoadmap(tmpDir);
    assert.ok(/^### \[GSD\.02\] 04: Parent$/m.test(rm), `got:\n${rm}`);
    assert.ok(/^### \[GSD\.02\] 04\.01: Deep Child$/m.test(rm), `deep dot token; got:\n${rm}`);

    // Read path resolves the deep subphase token.
    const get = runGsdTools('roadmap get-phase 04.01', tmpDir);
    const out = JSON.parse(get.output);
    assert.strictEqual(out.found, true, 'deep subphase resolves');
    assert.strictEqual(out.phase_name, 'Deep Child');
  });
});

// ─── 6. sentinel left alone ──────────────────────────────────────────────────

describe('sentinel phases (0 / 999) left untouched', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('sentinel keeps its integer, does NOT consume a real SS slot, still flags exempt', () => {
    // A 999 spike interleaved with real phases must: (a) keep its 999 token
    // (so the sentinel marker survives migration), (b) NOT eat a real SS slot
    // (real Phase 1/2 stay 01/02, not pushed to 02/03), (c) remain W021-exempt.
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, [
      '## v1.0 Foundation',
      '',
      '### Phase 1: Real Work',
      '**Goal:** g1',
      '',
      '### Phase 999: Research Spike',
      '**Goal:** spike',
      '',
      '### Phase 2: More Real Work',
      '**Goal:** g2',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '01-real-work');
    mkPhaseDir(tmpDir, '999-research-spike');
    mkPhaseDir(tmpDir, '02-more-real-work');
    gitInitCommit(tmpDir);

    const res = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.ok(res.success, `apply failed: ${res.error}`);

    const dirs = listPhaseDirs(tmpDir);
    // Real phases renumber 01, 02 (sentinel does NOT consume a slot); sentinel
    // keeps its 999 integer as the token.
    assert.ok(dirs.includes('GSD.01-01-real-work'), `real phase 1 → 01; got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('GSD.01-02-more-real-work'), `real phase 2 → 02 (not pushed by sentinel); got ${JSON.stringify(dirs)}`);
    assert.ok(dirs.includes('GSD.01-999-research-spike'), `sentinel keeps 999 token; got ${JSON.stringify(dirs)}`);

    const rm = readRoadmap(tmpDir);
    assert.ok(/^### \[GSD\.01\] 01: Real Work$/m.test(rm), `got:\n${rm}`);
    assert.ok(/^### \[GSD\.01\] 999: Research Spike$/m.test(rm), `sentinel integer preserved in heading; got:\n${rm}`);
    assert.ok(/^### \[GSD\.01\] 02: More Real Work$/m.test(rm), `got:\n${rm}`);

    // Sentinel still resolves AND is still recognized as a sentinel.
    const get = runGsdTools('roadmap get-phase 999', tmpDir);
    assert.strictEqual(JSON.parse(get.output).found, true, 'sentinel 999 still resolves post-migration');

    // Validate must not emit W021 referencing the sentinel (exempt).
    const val = runGsdTools('roadmap validate', tmpDir);
    const vout = JSON.parse(val.output);
    const sentinelWarn = (vout.warnings || []).filter(w => w.code === 'W021' && /999/.test(w.message));
    assert.strictEqual(sentinelWarn.length, 0, `sentinel exempt from W021; got ${JSON.stringify(sentinelWarn)}`);
  });
});

// ─── 7. no-project_code (degenerate) ─────────────────────────────────────────

describe('no project_code (degenerate emit)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('legacy without project_code REFUSES to migrate (bracket needs PROJECT) and mutates nothing', () => {
    // A bracket identity is `[PROJECT.MM] token` — the PROJECT code is
    // structurally required. Without it, a code-less heading like `### 01:`
    // resolves to nothing via the Wave-1/2 read path. The migrator must refuse
    // rather than half-migrate into an unreadable state.
    writeConfig(tmpDir, {}); // no project_code
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, [
      '## v1.0 Foundation',
      '',
      '### Phase 3: Only Thing',
      '**Goal:** g1',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '03-only-thing');
    gitInitCommit(tmpDir);

    const before = readRoadmap(tmpDir);

    // computeMigrationPlan throws the prerequisite error (in-process).
    assert.throws(
      () => roadmapUpgrade.computeMigrationPlan(tmpDir),
      /project_code is required/i,
      'no project_code → refuse with a prerequisite error'
    );

    // Via the CLI: non-zero exit, error surfaced, nothing mutated.
    const res = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.strictEqual(res.success, false, 'CLI exits non-zero');
    assert.match(res.error, /project_code is required/i, `error surfaced; got: ${res.error}`);
    assert.deepStrictEqual(listPhaseDirs(tmpDir), ['03-only-thing'], 'dirs unchanged');
    assert.strictEqual(readRoadmap(tmpDir), before, 'ROADMAP unchanged');
    assert.strictEqual(readConfig(tmpDir).phase_id_convention, undefined, 'config not flipped');
  });
});

// ─── 8. dry-run mutates NOTHING ──────────────────────────────────────────────

describe('dry-run (default) mutates nothing', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('default dry-run leaves tree pristine and prints a plan + old→new mapping', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, [
      '## v1.0 Foundation',
      '',
      '### Phase 1: Thing',
      '**Goal:** g',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '01-thing');
    gitInitCommit(tmpDir);

    const before = readRoadmap(tmpDir);
    const res = runGsdTools('roadmap upgrade', tmpDir); // no --apply → dry-run
    assert.ok(res.success, `dry-run failed: ${res.error}`);

    // Plan + mapping printed.
    assert.ok(/old → new/i.test(res.output) || /"newDir"/.test(res.output), `dry-run prints a plan; got:\n${res.output}`);

    // Nothing mutated.
    assert.deepStrictEqual(listPhaseDirs(tmpDir), ['01-thing'], 'dirs unchanged in dry-run');
    assert.strictEqual(readRoadmap(tmpDir), before, 'ROADMAP unchanged in dry-run');
    assert.strictEqual(readConfig(tmpDir).phase_id_convention, undefined, 'config unchanged in dry-run');
    assert.strictEqual(gitClean(tmpDir), '', 'git tree pristine after dry-run');
  });
});

// ─── 9. dirty tree throws pre-write ──────────────────────────────────────────

describe('dirty working tree gate', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('--apply on a dirty tree fails before any mutation', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, ['## v1.0 Foundation', '', '### Phase 1: Thing', '**Goal:** g', ''].join('\n'));
    mkPhaseDir(tmpDir, '01-thing');
    gitInitCommit(tmpDir);

    // Dirty the tree.
    fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'uncommitted\n');

    const res = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.strictEqual(res.success, false, 'apply must fail on dirty tree');
    assert.match(res.error, /dirty/i, `error mentions dirty tree; got: ${res.error}`);

    // No migration occurred.
    assert.deepStrictEqual(listPhaseDirs(tmpDir), ['01-thing']);
  });
});

// ─── 10. forced mid-apply failure → rollback to pristine ─────────────────────

describe('mid-apply failure triggers git reset --hard + git clean rollback', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('a poisoned plan whose first rename throws leaves a pristine tree', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, [
      '## v1.0 Foundation',
      '',
      '### Phase 1: Alpha',
      '**Goal:** g1',
      '',
      '### Phase 2: Beta',
      '**Goal:** g2',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '01-alpha');
    mkPhaseDir(tmpDir, '02-beta');
    gitInitCommit(tmpDir);

    // Compute a real plan, then POISON it WITHOUT dirtying the tree (so the
    // clean-tree gate passes and we exercise the rollback after a PARTIAL
    // mutation). The first phase's rename runs normally; the second phase's
    // newDir is routed THROUGH the first phase's freshly-created dir's PLAN.md
    // file — `renameSync` into a path whose parent is a file throws ENOTDIR.
    // This guarantees: rename #1 succeeded (mutation in progress) → rename #2
    // throws → catch → git reset --hard + git clean rollback. Use the exported
    // applyMigration directly (in-process) so we can inject the poisoned plan.
    const plan = roadmapUpgrade.computeMigrationPlan(tmpDir);
    assert.strictEqual(plan.alreadyMigrated, false);
    assert.ok(plan.phases.length >= 2, 'two phases planned');
    // plan.phases[0].newDir (e.g. GSD.01-01-alpha) is created by rename #1 and
    // contains PLAN.md. Route rename #2 under that file → ENOTDIR mid-apply.
    plan.phases[1] = {
      ...plan.phases[1],
      newDir: path.join(plan.phases[0].newDir, 'PLAN.md', 'impossible'),
    };

    // applyMigration must throw and roll back.
    assert.throws(
      () => roadmapUpgrade.applyMigration(tmpDir, plan, { dryRun: false }),
      /rolled back/i,
      'mid-apply failure surfaces a rollback error'
    );

    // After rollback: tree pristine (reset --hard restored tracked, git clean
    // removed the untracked BLOCKER file + any renamed-new dirs).
    assert.strictEqual(gitClean(tmpDir), '', `tree pristine after rollback; got:\n${gitClean(tmpDir)}`);
    assert.deepStrictEqual(listPhaseDirs(tmpDir), ['01-alpha', '02-beta'], 'original dirs restored');
    // Config not flipped (rollback).
    const cfg = readConfig(tmpDir);
    assert.notStrictEqual(cfg.phase_id_convention, 'bracket', 'convention not committed after rollback');
  });
});

// ─── 11. idempotence: re-run on bracket → alreadyMigrated ────────────────────

describe('idempotence on bracket', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('re-running --apply after migration is a no-op (alreadyMigrated)', () => {
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, ['## v1.0 Foundation', '', '### Phase 1: Thing', '**Goal:** g', ''].join('\n'));
    mkPhaseDir(tmpDir, '01-thing');
    gitInitCommit(tmpDir);

    const first = runGsdTools('roadmap upgrade --apply', tmpDir);
    assert.ok(first.success, `first apply failed: ${first.error}`);
    assert.strictEqual(readConfig(tmpDir).phase_id_convention, 'bracket');

    // Commit the migrated state (clean tree for the second --apply gate).
    git(tmpDir, ['add', '-A']);
    git(tmpDir, ['commit', '-q', '-m', 'migrated']);

    const dirsBefore = listPhaseDirs(tmpDir);

    // Second run: plan reports alreadyMigrated, apply is a no-op.
    const plan2 = roadmapUpgrade.computeMigrationPlan(tmpDir);
    assert.strictEqual(plan2.alreadyMigrated, true, 'config bracket → alreadyMigrated');
    const apply2 = roadmapUpgrade.applyMigration(tmpDir, plan2, { dryRun: false });
    assert.strictEqual(apply2.alreadyMigrated, true);
    assert.deepStrictEqual(listPhaseDirs(tmpDir), dirsBefore, 'no dirs changed on re-run');
  });

  test('bracket detection via heading even when config is absent', () => {
    writeConfig(tmpDir, { project_code: 'GSD' }); // no convention key
    writeState(tmpDir, '---\nmilestone: v2.0\n---\n');
    writeRoadmap(tmpDir, ['## [GSD.02] Foundation', '', '### [GSD.02] 01: Already Bracket', '**Goal:** g', ''].join('\n'));
    mkPhaseDir(tmpDir, 'GSD.02-01-already-bracket');
    gitInitCommit(tmpDir);

    const plan = roadmapUpgrade.computeMigrationPlan(tmpDir);
    assert.strictEqual(plan.alreadyMigrated, true, 'bracket heading → alreadyMigrated despite missing config key');
  });
});

// ─── 12. mixed/partial ───────────────────────────────────────────────────────

describe('mixed/partial — classifier precedence', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('a repo with ANY bracket heading is treated as already-migrated (precedence)', () => {
    // Even if a stray legacy `### Phase N` line exists, the presence of a bracket
    // phase heading short-circuits to alreadyMigrated (detection precedence §4.4).
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v2.0\n---\n');
    writeRoadmap(tmpDir, [
      '## [GSD.02] Foundation',
      '',
      '### [GSD.02] 01: Bracket Phase',
      '**Goal:** g1',
      '',
      '### Phase 9: Stray Legacy',
      '**Goal:** g2',
      '',
    ].join('\n'));
    gitInitCommit(tmpDir);

    const plan = roadmapUpgrade.computeMigrationPlan(tmpDir);
    assert.strictEqual(plan.alreadyMigrated, true, 'bracket heading present → skip whole project');
  });

  test('classifier: M-NN config beats legacy headings', () => {
    const dirs = ['GSD-02-01-x'];
    const linesLegacy = ['### Phase 1: Thing'];
    assert.strictEqual(roadmapUpgrade.classifyConvention(linesLegacy, { phase_id_convention: 'milestone-prefixed' }, []), 'mnn');
    assert.strictEqual(roadmapUpgrade.classifyConvention(['### Phase 2-01: X'], {}, []), 'mnn');
    assert.strictEqual(roadmapUpgrade.classifyConvention([], {}, dirs), 'mnn');
    assert.strictEqual(roadmapUpgrade.classifyConvention(['### Phase 1: X'], {}, ['01-x']), 'legacy');
    assert.strictEqual(roadmapUpgrade.classifyConvention(['### [GSD.02] 01: X'], {}, []), 'bracket');
  });
});

// ─── liftMnnToken unit ────────────────────────────────────────────────────────

describe('liftMnnToken unit', () => {
  test('flat and deep lift', () => {
    assert.deepStrictEqual(roadmapUpgrade.liftMnnToken('2-01'), { milestoneInt: 2, token: '01' });
    assert.deepStrictEqual(roadmapUpgrade.liftMnnToken('2-04-01'), { milestoneInt: 2, token: '04.01' });
    assert.deepStrictEqual(roadmapUpgrade.liftMnnToken('12-3-4'), { milestoneInt: 12, token: '03.04' });
  });
});
