// tests/planning-drift-baseline.test.cjs
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { runGsdTools, createTempProject, createTempGitProject, cleanup } = require('./helpers.cjs');
const { readReconciledCommit } = require('../gsd-core/bin/lib/planning-drift.cjs');
const { extractFrontmatter } = require('../gsd-core/bin/lib/frontmatter.cjs');
const { execSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');

describe('baseline stamping', () => {
  test('state sync stamps last_reconciled_commit to current base tip', () => {
    const tmp = createTempProject();
    execSync('git init -q && git add -A && git commit -q -m init --allow-empty', { cwd: tmp, shell: true });
    const head = execSync('git rev-parse HEAD', { cwd: tmp }).toString().trim();
    // Seed a minimal STATE.md so state sync does not exit with "STATE.md not found"
    const statePath = path.join(tmp, '.planning', 'STATE.md');
    fs.writeFileSync(statePath, '# Project State\n\n**Status:** in_progress\n');
    runGsdTools(['state', 'sync'], tmp);
    assert.equal(readReconciledCommit(statePath), head);
    cleanup(tmp);
  });

  test('state update (field write) does NOT stamp a baseline', () => {
    const tmp = createTempProject();
    execSync('git init -q && git add -A && git commit -q -m init --allow-empty', { cwd: tmp, shell: true });
    const statePath = path.join(tmp, '.planning', 'STATE.md');
    // Seed STATE.md so the update command actually runs (no STATE.md → silent error)
    fs.writeFileSync(statePath, '# Project State\n\n**Status:** in_progress\n');
    // Positional args: field=status value=executing
    runGsdTools(['state', 'update', 'status', 'executing'], tmp);
    assert.equal(readReconciledCommit(statePath), null);
    cleanup(tmp);
  });

  test('state update after sync preserves last_reconciled_commit (key not dropped)', () => {
    const tmp = createTempProject();
    execSync('git init -q && git add -A && git commit -q -m init --allow-empty', { cwd: tmp, shell: true });
    const head = execSync('git rev-parse HEAD', { cwd: tmp }).toString().trim();
    const statePath = path.join(tmp, '.planning', 'STATE.md');
    fs.writeFileSync(statePath, '# Project State\n\n**Status:** in_progress\n');
    // Stamp via sync
    runGsdTools(['state', 'sync'], tmp);
    assert.equal(readReconciledCommit(statePath), head, 'stamp after sync should equal HEAD');
    // Non-stamping write — syncStateFrontmatter must NOT drop the key
    runGsdTools(['state', 'update', 'status', 'executing'], tmp);
    assert.equal(readReconciledCommit(statePath), head, 'key must survive state update');
    cleanup(tmp);
  });

  // ─── Critical regression: flat writer drops nested progress block ──────────
  // RED: before the fix, stampReconcileBaseline called writeReconciledCommit which
  // used a flat regex parser (parseFm). That parser silently dropped every indented
  // child line of a nested `progress:` block, collapsing it to an empty key.
  // Since stampReconcileBaseline ran AFTER the canonical write (writeStateMd /
  // readModifyWriteStateMd), its overwriting write was the one that landed on disk.
  // GREEN: the fix routes stampReconcileBaseline through readModifyWriteStateMd
  // (locked, canonical reconstructFrontmatter codec) with resync:false, which
  // correctly round-trips nested objects.
  test('stampReconcileBaseline preserves nested progress block (regression: flat writer dropped nested keys)', () => {
    const tmp = createTempGitProject();
    const statePath = path.join(tmp, '.planning', 'STATE.md');

    // Mirror the real STATE.md nested frontmatter shape (progress with 5 scalar children).
    // Uses a minimal body with no sync-triggering fields so writeStateMd is NOT called
    // during `state sync` — making stampReconcileBaseline the sole writer that runs.
    // This isolates the bug: if the flat writer fires, it corrupts the block; if the
    // canonical writer fires, the block survives.
    const nestedStateMd = [
      '---',
      'gsd_state_version: 1.0',
      'milestone: v1.0',
      'status: in_progress',
      'progress:',
      '  total_phases: 5',
      '  completed_phases: 2',
      '  total_plans: 20',
      '  completed_plans: 8',
      '  percent: 40',
      '---',
      '',
      '# Project State',
      '',
    ].join('\n');
    fs.writeFileSync(statePath, nestedStateMd);

    // state sync → calls stampReconcileBaseline unconditionally
    const result = runGsdTools(['state', 'sync'], tmp);
    assert.ok(result.success, `state sync should succeed: ${result.error}`);

    // (a) last_reconciled_commit must be stamped (proves stampReconcileBaseline ran)
    const stamped = readReconciledCommit(statePath);
    assert.ok(stamped, 'last_reconciled_commit must be stamped after state sync');

    // (b) nested progress block must survive
    const afterContent = fs.readFileSync(statePath, 'utf8');
    const fm = extractFrontmatter(afterContent);
    assert.ok(fm.progress && typeof fm.progress === 'object',
      'progress must be a nested object after stampReconcileBaseline, not empty string or missing');
    assert.ok('total_phases' in fm.progress,
      `progress.total_phases must survive stampReconcileBaseline; got progress=${JSON.stringify(fm.progress)}`);
    assert.ok('completed_phases' in fm.progress,
      `progress.completed_phases must survive stampReconcileBaseline; got progress=${JSON.stringify(fm.progress)}`);

    cleanup(tmp);
  });

  test('milestone complete stamps last_reconciled_commit', () => {
    const tmp = createTempProject();
    execSync('git init -q && git add -A && git commit -q -m init --allow-empty', { cwd: tmp, shell: true });
    const head = execSync('git rev-parse HEAD', { cwd: tmp }).toString().trim();
    const statePath = path.join(tmp, '.planning', 'STATE.md');
    fs.writeFileSync(path.join(tmp, '.planning', 'ROADMAP.md'), '# Roadmap v1.0 MVP\n\n### Phase 1: Foundation\n**Goal:** Setup\n');
    fs.writeFileSync(statePath, '# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n');
    fs.mkdirSync(path.join(tmp, '.planning', 'phases', '01-foundation'), { recursive: true });
    runGsdTools(['milestone', 'complete', 'v1.0', '--name', 'MVP Foundation'], tmp);
    assert.equal(readReconciledCommit(statePath), head);
    cleanup(tmp);
  });
});
