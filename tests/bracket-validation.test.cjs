'use strict';

/**
 * Bracket-native validation (WAVE 2b).
 *
 * Covers the validation surface (§4.3): the bracket checks in
 * `roadmap-command-router.cjs` (W021 form-presence + integer coherence),
 * `verify.cjs` (Check 11b bracket-form-presence, default-on for bracket repos),
 * and the W021→W022 renumber of Check 14 (R4 — milestone-complete-vs-unstarted).
 *
 * Mirrors tests/milestone-prefixed-convention.test.cjs style; uses the
 * subprocess harness (runGsdTools) on temp projects.
 *
 * LOCKED DECISIONS exercised (BRACKET-NATIVE-CJS-SCOPE-ADDENDA.md):
 *   - Q1: `phase_id_convention: 'bracket'` is the gate (the retired
 *     `milestone-prefixed` opt-in is gone; legacy repos stay quiet).
 *   - ADDENDUM-3: phase heading = `### [PROJECT.MM] N: Name` (bracket then NN:),
 *     milestone section heading = `## [PROJECT.MM] Name` (bracket then NAME).
 *   - R1/READING-B: milestone authority = the enclosing bracket section integer
 *     (mirrors STATE.md `milestone:`); NOT derived from the phase-token leading int.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

const BRACKET_MIGRATION_CMD = 'gsd-tools roadmap upgrade --convention bracket';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Write `.planning/config.json` with the given phase_id_convention.
 * @param {string} tmpDir
 * @param {string|null} convention - 'bracket', null, or a legacy value.
 */
function writeConfig(tmpDir, convention) {
  const cfg = convention === undefined ? {} : { phase_id_convention: convention };
  fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify(cfg, null, 2));
}

/**
 * Write a bracket ROADMAP.md.
 *
 * @param {string} tmpDir
 * @param {Array<{milestone:number, name:string, phases:Array<{heading:string}>}>} milestones
 *   `milestone` rides in the section bracket `## [GSD.MM] name`; each phase's
 *   `heading` is the raw heading text after the `### ` (so a test can inject a
 *   clean bracket form, a literal-Phase form, or an M-NN form).
 * @param {object} [opts]
 * @param {string|null} [opts.conventionValue] - ROADMAP frontmatter convention.
 */
function writeRoadmap(tmpDir, milestones, opts = {}) {
  const { conventionValue } = opts;
  let frontmatter = '';
  if (conventionValue !== undefined) {
    const line = conventionValue === null ? 'phase_id_convention: null' : `phase_id_convention: ${conventionValue}`;
    frontmatter = `---\n${line}\n---\n\n`;
  }
  const sections = milestones
    .map(({ milestone, name, phases }) => {
      const mm = String(milestone).padStart(2, '0');
      const phaseBlocks = phases.map(({ heading }) => `### ${heading}\n**Goal:** Placeholder\n`).join('\n');
      return `## [GSD.${mm}] ${name}\n\n${phaseBlocks}`;
    })
    .join('\n\n');
  const content = `${frontmatter}# Roadmap\n\n${sections}\n`;
  fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), content);
}

/** Write a STATE.md with a `milestone:` frontmatter field + status. */
function writeState(tmpDir, { milestone = 'v2.0', name = 'Foundation', status = 'in progress' } = {}) {
  const content = `---
gsd_state_version: 1.0
milestone: ${milestone}
milestone_name: ${name}
status: ${status}
---

# Project State

## Current Position

Phase: working
`;
  fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), content);
}

// ---------------------------------------------------------------------------
// Router: roadmap validate (W021 — form-presence + integer coherence)
// ---------------------------------------------------------------------------

describe('bracket validation — roadmap validate (router)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  // ── bracket-form-presence: literal "Phase" word fires ─────────────────────
  test('W021 fires on a heading carrying the literal "Phase" word', () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: 'Phase 5: Legacy form' }] },
    ]);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate should exit 0 with warnings: ${result.error}`);

    const out = JSON.parse(result.output);
    assert.ok(Array.isArray(out.warnings), 'output.warnings should be an array');
    const w021 = out.warnings.filter(w => w.code === 'W021');
    assert.ok(w021.length > 0, 'literal "Phase" heading should fire W021 form-presence');
    assert.ok(w021[0].message, 'W021 entry should have a message field');
  });

  // ── bracket-form-presence: M-NN token fires ───────────────────────────────
  test('W021 fires on a bracket heading carrying an M-NN token', () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: '[GSD.02] 2-01: M-NN form' }] },
    ]);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = out.warnings.filter(w => w.code === 'W021');
    assert.ok(w021.length > 0, 'M-NN token inside bracket should fire W021 form-presence');
  });

  // ── clean bracket form passes ──────────────────────────────────────────────
  test('no W021 on a clean ### [GSD.02] 05: heading', () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: '[GSD.02] 05: Clean Feature' }] },
    ]);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = out.warnings.filter(w => w.code === 'W021');
    assert.strictEqual(w021.length, 0, `clean bracket heading must not fire W021. Got: ${JSON.stringify(out.warnings)}`);
  });

  // ── integer-coherence: phase MM != enclosing section MM fires ─────────────
  test('W021 fires when a phase bracket MM differs from its enclosing section MM', () => {
    writeConfig(tmpDir, 'bracket');
    // Section is milestone 02 but the phase heading declares [GSD.03].
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: '[GSD.03] 05: Wrong milestone' }] },
    ]);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = out.warnings.filter(w => w.code === 'W021');
    assert.ok(w021.length > 0, 'phase MM != section MM should fire W021 coherence');
    assert.ok(/mismatch/i.test(w021[0].message), `coherence message should mention mismatch: ${w021[0].message}`);
  });

  // ── multi-milestone: each phase coheres with its OWN section (no false positive) ──
  test('no W021 across multiple milestone sections when each phase matches its section', () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: '[GSD.02] 01: A' }, { heading: '[GSD.02] 02: B' }] },
      { milestone: 3, name: 'Expansion', phases: [{ heading: '[GSD.03] 01: C' }] },
    ]);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = out.warnings.filter(w => w.code === 'W021');
    assert.strictEqual(w021.length, 0,
      `phases in a future milestone section must NOT be flagged against the active one. Got: ${JSON.stringify(out.warnings)}`);
  });

  // ── sentinel exempt ────────────────────────────────────────────────────────
  test('no W021 for sentinel phases (999.x backlog) carrying a legacy form', () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 999, name: 'Backlog', phases: [{ heading: 'Phase 999.1: Backlog item' }] },
    ]);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = (out.warnings || []).filter(w => w.code === 'W021');
    assert.strictEqual(w021.length, 0, `sentinel phase should be exempt. Got: ${JSON.stringify(out.warnings)}`);
  });

  // ── legacy repo (null convention) stays quiet — read-tolerance ────────────
  test('no W021 when phase_id_convention is null (legacy read-tolerance)', () => {
    writeConfig(tmpDir, null);
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: 'Phase 5: Legacy' }] },
    ], { conventionValue: null });

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = (out.warnings || []).filter(w => w.code === 'W021');
    assert.strictEqual(w021.length, 0, 'bracket check must not fire on a non-bracket (legacy) repo');
  });

  // ── JSON warning shape ─────────────────────────────────────────────────────
  test("'roadmap validate' returns JSON with a warnings array of {code,message}", () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: 'Phase 5: Legacy' }] },
    ]);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    let out;
    try { out = JSON.parse(result.output); }
    catch { assert.fail(`output is not valid JSON: ${result.output}`); }
    assert.ok(typeof out === 'object' && out !== null, 'output should be a JSON object');
    assert.ok(Array.isArray(out.warnings), 'output.warnings should be an array');
    for (const w of out.warnings) {
      assert.ok(typeof w.code === 'string', 'each warning has a code');
      assert.ok(typeof w.message === 'string', 'each warning has a message');
    }
  });

  // ── fix-hint mentions --convention bracket ─────────────────────────────────
  test('W021 fix-hint includes `--convention bracket`', () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: 'Phase 5: Legacy' }] },
    ]);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = (out.warnings || []).filter(w => w.code === 'W021');
    assert.ok(w021.length > 0, 'W021 expected');
    const hasHint = w021.some(w => typeof w.message === 'string' && w.message.includes(BRACKET_MIGRATION_CMD));
    assert.ok(hasHint, `W021 message should include "${BRACKET_MIGRATION_CMD}". Got: ${JSON.stringify(w021.map(w => w.message))}`);
  });
});

// ---------------------------------------------------------------------------
// verify.cjs: validate health Check 11b (bracket-form-presence, default-on)
// ---------------------------------------------------------------------------

describe('bracket validation — validate health Check 11b (W021 form-presence)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('W021 fires on a legacy "Phase" heading in a bracket repo', () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: 'Phase 5: Legacy form' }] },
    ]);
    writeState(tmpDir, { status: 'in progress' });

    const result = runGsdTools(['validate', 'health'], tmpDir);
    assert.ok(result.success, `validate health failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const warnings = out.warnings || [];
    const w021 = warnings.filter(w => w.code === 'W021');
    assert.ok(w021.length > 0, `expected W021 form-presence. Got: ${JSON.stringify(warnings.map(w => w.code))}`);
    const hasHint = w021.some(w => typeof w.message === 'string' && /--convention bracket/.test(w.message) || /--convention bracket/.test(w.fix || ''));
    assert.ok(hasHint, `W021 should point at the bracket migrator. Got: ${JSON.stringify(w021)}`);
  });

  test('no W021 on a clean bracket repo', () => {
    writeConfig(tmpDir, 'bracket');
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: '[GSD.02] 05: Clean Feature' }] },
    ]);
    writeState(tmpDir, { status: 'in progress' });

    const result = runGsdTools(['validate', 'health'], tmpDir);
    assert.ok(result.success, `validate health failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = (out.warnings || []).filter(w => w.code === 'W021');
    assert.strictEqual(w021.length, 0, `clean bracket repo must not fire W021. Got: ${JSON.stringify(out.warnings)}`);
  });

  test('no W021 (form-presence) on a legacy repo (null convention)', () => {
    writeConfig(tmpDir, null);
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [{ heading: 'Phase 5: Legacy' }] },
    ], { conventionValue: null });
    writeState(tmpDir, { status: 'in progress' });

    const result = runGsdTools(['validate', 'health'], tmpDir);
    assert.ok(result.success, `validate health failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = (out.warnings || []).filter(w => w.code === 'W021');
    assert.strictEqual(w021.length, 0, 'form-presence must not fire on a legacy repo');
  });
});

// ---------------------------------------------------------------------------
// R4: Check 14 renumber W021 -> W022 (no collision with Check 11b)
// ---------------------------------------------------------------------------

describe('bracket validation — Check 14 renumber (R4: W021 → W022)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('milestone-complete-but-unstarted now emits W022, not W021', () => {
    writeConfig(tmpDir, 'bracket');
    // Clean bracket roadmap (so Check 11b does NOT fire W021), but a phase has
    // no directory on disk while STATE says the milestone is complete.
    writeRoadmap(tmpDir, [
      { milestone: 2, name: 'Foundation', phases: [
        { heading: '[GSD.02] 01: Started' },
        { heading: '[GSD.02] 02: Never started' },
      ] },
    ]);
    writeState(tmpDir, { milestone: 'v2.0', name: 'Foundation', status: 'v2.0 milestone complete' });

    const result = runGsdTools(['validate', 'health'], tmpDir);
    assert.ok(result.success, `validate health failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const warnings = out.warnings || [];

    const w022 = warnings.filter(w => w.code === 'W022');
    assert.ok(w022.length > 0, `Check 14 should emit W022 (renumbered). Got: ${JSON.stringify(warnings.map(w => w.code))}`);

    // The renumbered code must NOT collide with the form-presence W021: on this
    // clean-bracket fixture there is no form-presence violation, so any W021
    // present would be a collision regression.
    const w021 = warnings.filter(w => w.code === 'W021');
    assert.strictEqual(w021.length, 0,
      `Check 14 must no longer emit W021 (R4 collision). Got W021: ${JSON.stringify(w021)}`);
  });
});
