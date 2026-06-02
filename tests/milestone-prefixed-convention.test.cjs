'use strict';

/**
 * RETIRED M-NN W021 GUARD (was: "W021 — milestone-prefixed phase ID convention").
 *
 * The original W021 fired on a *redundancy mismatch* between an M-NN phase id's
 * leading integer and its enclosing `## vX.Y` milestone section (phase `1-01`
 * under `## v2.0`), gated on `phase_id_convention: milestone-prefixed`, with a
 * fix-hint of `roadmap upgrade --convention milestone-prefixed`.
 *
 * That behavior is SUPERSEDED. Under the bracket convention W021 is repurposed
 * as the bracket-convention check (form-presence + integer-coherence), gated on
 * `phase_id_convention: bracket`, fix-hint `roadmap upgrade --convention bracket`.
 *
 * POSITIVE bracket-W021 coverage lives in tests/bracket-validation.test.cjs.
 * Old→new coverage map (proves no coverage lost — every old assertion has a
 * bracket successor; none is orphaned here):
 *
 *   OLD (this file, M-NN)                         NEW (bracket-validation.test.cjs)
 *   ─────────────────────────────────────────    ─────────────────────────────────────────
 *   mismatch fires W021 (1-01 under v2.0)      →  W021 form-presence (literal "Phase"/M-NN
 *                                                 token fires) + W021 integer-coherence
 *                                                 (phase MM != section MM fires)
 *   match does NOT fire (2-01 under v2.0)      →  "no W021 on clean ### [GSD.02] 05" +
 *                                                 multi-milestone no-false-positive
 *   sentinel exempt (999-xx / 0-xx)            →  "no W021 for sentinel phases (999.x)"
 *   null convention disables W021              →  "no W021 when convention is null"
 *   roadmap validate returns JSON warnings[]   →  JSON warning-shape {code,message}
 *   fix-hint = --convention milestone-prefixed →  fix-hint = --convention bracket
 *
 * This file is a thin SUPERSESSION guard: it asserts the OLD M-NN W021 semantics
 * are GONE (the retired gate value no longer fires W021; the retired fix-hint is
 * no longer emitted), without duplicating the positive bracket assertions.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

const RETIRED_MIGRATION_CMD = 'gsd-tools roadmap upgrade --convention milestone-prefixed';
const BRACKET_MIGRATION_CMD = 'gsd-tools roadmap upgrade --convention bracket';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Write `.planning/config.json` with the given phase_id_convention. */
function writeConfig(tmpDir, convention) {
  const cfg = convention === undefined ? {} : { phase_id_convention: convention };
  fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify(cfg, null, 2));
}

/**
 * Build a legacy M-NN ROADMAP: `## [GSD] vX.Y — Label` milestone sections with
 * `### Phase <id>: <name>` phase headings (the retired form). Used to prove the
 * old W021 mismatch path no longer fires under the (also retired) gate value.
 */
function buildMNNRoadmap(tmpDir, milestones, conventionValue) {
  const conventionLine =
    conventionValue === null ? 'phase_id_convention: null' : `phase_id_convention: ${conventionValue}`;
  const frontmatter = `---\n${conventionLine}\n---\n\n`;
  const sections = milestones
    .map(({ version, label, phases }) => {
      const phaseBlocks = phases
        .map(({ id, name }) => `### Phase ${id}: ${name}\n**Goal:** Placeholder goal\n`)
        .join('\n');
      return `## [GSD] ${version} — ${label}\n\n${phaseBlocks}`;
    })
    .join('\n\n');
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'ROADMAP.md'),
    `${frontmatter}# Roadmap\n\n${sections}\n`,
  );
}

/** Write a bracket ROADMAP carrying a retired-form (literal "Phase") heading. */
function buildBracketRoadmapWithLegacyHeading(tmpDir) {
  const content = [
    '# Roadmap',
    '',
    '## [GSD.02] Foundation',
    '',
    '### Phase 5: Legacy form',
    '**Goal:** Placeholder goal',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), content);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('W021 — milestone-prefixed convention RETIRED (superseded by bracket)', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  // ── 1. The retired `milestone-prefixed` gate value no longer fires W021 ────
  // Old behavior: this exact fixture (phase 1-01 under v2.0, convention
  // milestone-prefixed) fired the M-NN redundancy-mismatch W021. The gate value
  // is retired, so the M-NN mismatch path produces no W021.
  test('retired gate `milestone-prefixed` + M-NN mismatch (1-01 under v2.0) fires no M-NN W021', () => {
    writeConfig(tmpDir, 'milestone-prefixed');
    buildMNNRoadmap(tmpDir, [
      { version: 'v2.0', label: 'Expansion', phases: [{ id: '1-01', name: 'Setup' }] },
    ], 'milestone-prefixed');

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate should exit 0: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(Array.isArray(out.warnings), 'output.warnings should be an array');

    // No W021 may carry the retired M-NN migration fix-hint — the old check is gone.
    const w021 = out.warnings.filter(w => w.code === 'W021');
    const retiredHint = w021.some(
      w => typeof w.message === 'string' && w.message.includes(RETIRED_MIGRATION_CMD),
    );
    assert.ok(!retiredHint, `retired M-NN fix-hint "${RETIRED_MIGRATION_CMD}" must not be emitted`);
  });

  // ── 2. The retired M-NN fix-hint string is gone repo-wide ──────────────────
  // Bracket W021 (when it does fire) points at `--convention bracket`, never the
  // retired `--convention milestone-prefixed`.
  test('bracket repo fires W021 with the bracket fix-hint, not the retired M-NN one', () => {
    writeConfig(tmpDir, 'bracket');
    buildBracketRoadmapWithLegacyHeading(tmpDir);

    const result = runGsdTools(['roadmap', 'validate'], tmpDir);
    assert.ok(result.success, `roadmap validate failed: ${result.error}`);
    const out = JSON.parse(result.output);
    const w021 = (out.warnings || []).filter(w => w.code === 'W021');
    assert.ok(w021.length > 0, 'a legacy "Phase" heading in a bracket repo should fire W021');

    const hasBracketHint = w021.some(
      w => typeof w.message === 'string' && w.message.includes(BRACKET_MIGRATION_CMD),
    );
    assert.ok(hasBracketHint, `W021 should point at "${BRACKET_MIGRATION_CMD}"`);

    const hasRetiredHint = w021.some(
      w => typeof w.message === 'string' && w.message.includes(RETIRED_MIGRATION_CMD),
    );
    assert.ok(!hasRetiredHint, 'retired M-NN fix-hint must not appear');
  });

  // ── 3. JSON warning shape preserved (carried over from the old suite) ──────
  test("'roadmap validate' still returns JSON with a warnings array (shape preserved)", () => {
    writeConfig(tmpDir, 'bracket');
    buildBracketRoadmapWithLegacyHeading(tmpDir);

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
});
