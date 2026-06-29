// tests/planning-drift-baseline.test.cjs
// allow-test-rule: source-text-is-the-product
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const { readReconciledCommit } = require('../gsd-core/bin/lib/planning-drift.cjs');
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
