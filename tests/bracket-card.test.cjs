// Tests for the phase-ID convention CARD (ADDENDUM-1) — the single-source
// annotated grammar visualization rendered at install completion + migrator run.
//
// Contract:
//   - phase-id-card.cjs exports phaseIdCard() returning the annotated card.
//   - The card is the ONE source of truth (no duplicated ASCII elsewhere).
//   - `roadmap upgrade` (dry-run AND --apply) prints the card at the start, via
//     the imported helper (roadmap-upgrade.cjs applyMigration).

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const { phaseIdCard, CARD, LEGEND } = require('../get-shit-done/bin/lib/phase-id-card.cjs');

// ─── fixture helpers (mirror bracket-migrator.test.cjs) ──────────────────────

function git(tmpDir, args) {
  execFileSync('git', args, { cwd: tmpDir, stdio: 'pipe' });
}
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
function writeRoadmap(tmpDir, content) {
  fs.writeFileSync(path.join(pDir(tmpDir), 'ROADMAP.md'), content);
}
function writeState(tmpDir, content) {
  fs.writeFileSync(path.join(pDir(tmpDir), 'STATE.md'), content);
}
function mkPhaseDir(tmpDir, name) {
  fs.mkdirSync(path.join(pDir(tmpDir), 'phases', name), { recursive: true });
}

// ─── 1. phaseIdCard() returns the annotated card ─────────────────────────────

describe('phaseIdCard() — single source of truth', () => {
  test('returns the annotated card + legend', () => {
    const card = phaseIdCard();
    // The annotated grammar box: the example line + each labeled stem.
    assert.ok(card.includes('[GSD.02] 05.03-01'), 'card includes the example phase ID');
    assert.ok(/plan\s+01/.test(card), 'card labels plan');
    assert.ok(/subphase\s+03/.test(card), 'card labels subphase');
    assert.ok(/phase\s+05/.test(card), 'card labels phase');
    assert.ok(/milestone\s+02/.test(card), 'card labels milestone');
    assert.ok(/project\s+GSD/.test(card), 'card labels project');
    // One-line legend.
    assert.ok(card.includes(LEGEND), 'card includes the one-line legend');
    assert.ok(/no 'Phase' word/.test(card), 'legend states no "Phase" word');
  });

  test('optional title is rendered above the card', () => {
    const card = phaseIdCard({ title: 'HELLO TITLE' });
    assert.ok(card.startsWith('HELLO TITLE'), 'title leads the output');
    assert.ok(card.includes(CARD), 'card body still present');
  });

  test('the ASCII box has all 7 lines (box drawing intact)', () => {
    // CARD constant is the canonical ASCII — assert structure so a drift in the
    // box (missing stem line) fails loudly.
    const lines = CARD.split('\n');
    assert.strictEqual(lines.length, 7, `CARD has 7 lines; got ${lines.length}`);
    assert.ok(lines[0].includes('[GSD.02] 05.03-01'));
    assert.ok(lines.some(l => l.includes('└──') && /plan/.test(l)));
  });
});

// ─── 2. card renders in `roadmap upgrade` dry-run ─────────────────────────────

describe('roadmap upgrade prints the card (single-source render)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('dry-run output contains the card', () => {
    // Legacy fixture WITH project_code + milestone heading so computeMigrationPlan
    // succeeds (a code-less legacy repo throws before applyMigration → no card).
    writeConfig(tmpDir, { project_code: 'GSD' });
    writeState(tmpDir, '---\nmilestone: v1.0\n---\n');
    writeRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '## v1.0 Foundation',
      '',
      '### Phase 1: First Thing',
      '**Goal:** g1',
      '',
    ].join('\n'));
    mkPhaseDir(tmpDir, '01-first-thing');
    gitInitCommit(tmpDir);

    const res = runGsdTools('roadmap upgrade', tmpDir); // dry-run (no --apply)
    assert.ok(res.success, `dry-run failed: ${res.error}`);
    assert.ok(res.output.includes('[GSD.02] 05.03-01'), `dry-run prints the card; got:\n${res.output}`);
    assert.ok(res.output.includes(LEGEND), `dry-run prints the legend; got:\n${res.output}`);
    // Card precedes the JSON plan (rendered at the start of applyMigration).
    assert.ok(res.output.indexOf('[GSD.02] 05.03-01') < res.output.indexOf('{'),
      'card renders before the JSON plan');
  });
});

// ─── 3. single-source: ASCII is not duplicated in render sites ───────────────

describe('single-source principle (no ASCII drift)', () => {
  test('the migrator + installer import the card, not duplicate the ASCII', () => {
    const migrator = fs.readFileSync(
      path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib', 'roadmap-upgrade.cjs'), 'utf8');
    const installer = fs.readFileSync(
      path.join(__dirname, '..', 'bin', 'install.js'), 'utf8');
    // Neither render site re-embeds the box-drawing stem line.
    assert.ok(!migrator.includes('└───────────────── project'),
      'migrator must not duplicate the card ASCII');
    assert.ok(!installer.includes('└───────────────── project'),
      'installer must not duplicate the card ASCII');
    // Both reference phase-id-card.cjs.
    assert.ok(/phase-id-card\.cjs/.test(migrator), 'migrator imports phase-id-card.cjs');
    assert.ok(/phase-id-card\.cjs/.test(installer), 'installer imports phase-id-card.cjs');
  });
});
