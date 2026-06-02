'use strict';

/**
 * Bracket new-project config defaults (TASK 1 — Q1 + ADDENDUM-4).
 *
 * New projects must default to `phase_id_convention: 'bracket'`
 * (LOCKED DECISION Q1). Bracket structurally REQUIRES a non-null
 * `project_code` (ADDENDUM-4): if the user does not supply one,
 * `buildNewProjectConfig` derives a deterministic fallback from the
 * project name so init never produces a bracket project with
 * `project_code: null` and never hard-blocks.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  buildNewProjectConfig,
  deriveProjectCode,
} = require('../get-shit-done/bin/lib/config.cjs');
const { VALID_CONFIG_KEYS } = require('../get-shit-done/bin/lib/config-schema.cjs');

describe('buildNewProjectConfig — bracket default (Q1)', () => {
  test('defaults phase_id_convention to bracket', () => {
    const config = buildNewProjectConfig({});
    assert.strictEqual(config.phase_id_convention, 'bracket');
  });

  test('phase_id_convention is overridable via userChoices', () => {
    const config = buildNewProjectConfig({ phase_id_convention: 'milestone-prefixed' });
    assert.strictEqual(config.phase_id_convention, 'milestone-prefixed');
  });

  test('bracket convention never yields a null project_code', () => {
    const config = buildNewProjectConfig({ project_name: 'CareKit Continuity' });
    assert.strictEqual(config.phase_id_convention, 'bracket');
    assert.ok(config.project_code, 'project_code must be non-null under bracket');
    assert.match(config.project_code, /^[A-Z0-9]{1,5}$/);
  });
});

describe('buildNewProjectConfig — project_code derivation (ADDENDUM-4)', () => {
  test('derives initials from a multi-word project name', () => {
    const config = buildNewProjectConfig({ project_name: 'My Care UC' });
    assert.strictEqual(config.project_code, 'MCU');
  });

  test('derives first-4-chars from a single-word project name', () => {
    const config = buildNewProjectConfig({ project_name: 'carekit' });
    assert.strictEqual(config.project_code, 'CARE');
  });

  test('falls back to PROJ when no usable name is given', () => {
    assert.strictEqual(buildNewProjectConfig({}).project_code, 'PROJ');
    assert.strictEqual(buildNewProjectConfig({ project_name: '' }).project_code, 'PROJ');
    assert.strictEqual(buildNewProjectConfig({ project_name: '!!!' }).project_code, 'PROJ');
  });

  test('explicit userChoices.project_code wins over derivation', () => {
    const config = buildNewProjectConfig({ project_code: 'CK', project_name: 'CareKit Continuity' });
    assert.strictEqual(config.project_code, 'CK');
  });

  test('does NOT derive a code under a non-bracket convention', () => {
    const config = buildNewProjectConfig({ phase_id_convention: 'milestone-prefixed' });
    assert.strictEqual(config.project_code, null);
  });

  test('project_name is a derivation input only — never persisted', () => {
    const config = buildNewProjectConfig({ project_name: 'My Care UC' });
    assert.ok(!('project_name' in config), 'project_name must be stripped from final config');
    // It is not a valid config key, so persisting it would trip bug-2530.
    assert.ok(!VALID_CONFIG_KEYS.has('project_name'));
  });
});

describe('deriveProjectCode — unit rule', () => {
  test('multi-word → uppercased initials, capped at 5', () => {
    assert.strictEqual(deriveProjectCode('My Care UC'), 'MCU');
    assert.strictEqual(deriveProjectCode('GSD Core'), 'GC');
    assert.strictEqual(deriveProjectCode('one two three four five six'), 'OTTFF');
  });

  test('single word → first 4 chars uppercased', () => {
    assert.strictEqual(deriveProjectCode('carekit'), 'CARE');
    assert.strictEqual(deriveProjectCode('Eclipse'), 'ECLI');
  });

  test('non-alphanumerics are stripped; interior digits are kept', () => {
    assert.strictEqual(deriveProjectCode('foo-bar_baz'), 'FBB');
    assert.strictEqual(deriveProjectCode('h2o filter'), 'HF'); // initials, no digit
  });

  test('leading digits are stripped so the code is letter-first (parser requirement)', () => {
    // "2024 plan" → initials "2P" → strip leading digit → "P"
    assert.strictEqual(deriveProjectCode('2024 plan'), 'P');
    // single word "3M" → first-4 "3M" → strip leading digit → "M"
    assert.strictEqual(deriveProjectCode('3M'), 'M');
    // digits-only → nothing letter-led remains → PROJ
    assert.strictEqual(deriveProjectCode('123'), 'PROJ');
    assert.strictEqual(deriveProjectCode('2024'), 'PROJ');
  });

  test('every derived code matches the bracket project-code class [A-Z][A-Z0-9]*', () => {
    const samples = ['My Care UC', 'carekit', '2024 plan', '3M', 'h2o filter', '!!!', '', '99 problems'];
    for (const s of samples) {
      assert.match(deriveProjectCode(s), /^[A-Z][A-Z0-9]*$/,
        `derived code for "${s}" must be a parseable bracket project-code`);
    }
  });

  test('empty / symbol-only / non-string → PROJ', () => {
    assert.strictEqual(deriveProjectCode(''), 'PROJ');
    assert.strictEqual(deriveProjectCode('   '), 'PROJ');
    assert.strictEqual(deriveProjectCode('!!!'), 'PROJ');
    assert.strictEqual(deriveProjectCode(undefined), 'PROJ');
    assert.strictEqual(deriveProjectCode(null), 'PROJ');
  });
});
