// allow-test-rule: source-text-is-the-product
// Workflow .md / agent .md / command .md / reference .md files — their text
// IS what the runtime loads. Testing text content tests the deployed contract.
// Per CONTRIBUTING.md exception matrix.
// Migrated (#455): tests parse JSON output and assert on typed fields
// (output.status, error/warning/info codes). The single message.includes()
// at W001 checks the canonical section name '## Core Value' which is the
// product contract for PROJECT.md; stateContent.includes('# Session State')
// checks the canonical header of a generated file — both are
// source-text-is-the-product assertions, not output-grep violations.

/**
 * GSD Tools Tests - Validate Health Command
 *
 * Comprehensive tests for validate-health covering all 8 health checks
 * and the repair path.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, createTempGitProject, cleanup } = require('./helpers.cjs');

// ─── Helpers for setting up minimal valid projects ────────────────────────────

function writeMinimalRoadmap(tmpDir, phases = ['1']) {
  const lines = phases.map(n => `### Phase ${n}: Phase ${n} Description`).join('\n');
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'ROADMAP.md'),
    `# Roadmap\n\n${lines}\n`
  );
}

function writeMinimalProjectMd(tmpDir, sections = ['## What This Is', '## Core Value', '## Requirements']) {
  const content = sections.map(s => `${s}\n\nContent here.\n`).join('\n');
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'PROJECT.md'),
    `# Project\n\n${content}`
  );
}

function writeMinimalStateMd(tmpDir, content) {
  const defaultContent = content || `# Session State\n\n## Current Position\n\nPhase: 1\n`;
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'STATE.md'),
    defaultContent
  );
}

function writeValidConfigJson(tmpDir) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'config.json'),
    JSON.stringify({ model_profile: 'balanced', commit_docs: true }, null, 2)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// validate health command — all 8 checks
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── Check 1: .planning/ exists ───────────────────────────────────────────

  test("returns 'broken' when .planning directory is missing", () => {
    // createTempProject creates .planning/phases — remove it entirely
    // eslint-disable-next-line local/no-raw-rmsync-in-tests -- mid-test SUT setup: removes .planning/ to simulate missing dir condition
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken', 'should be broken');
    assert.ok(
      output.errors.some(e => e.code === 'E001'),
      `Expected E001 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  // ─── Check 2: PROJECT.md exists and has required sections ─────────────────

  test('warns when PROJECT.md is missing', () => {
    // No PROJECT.md in .planning
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // Create valid phase dir so no W007
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E002'),
      `Expected E002 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  test('warns when PROJECT.md missing required sections', () => {
    // PROJECT.md missing "## Core Value" section
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Project\n\n## What This Is\n\nFoo\n\n## Requirements\n\nBar\n'
    );
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w001s = output.warnings.filter(w => w.code === 'W001');
    assert.ok(w001s.length > 0, `Expected W001 warnings: ${JSON.stringify(output.warnings)}`);
    assert.ok(
      w001s.some(w => w.message.includes('## Core Value')),
      `Expected W001 mentioning "## Core Value": ${JSON.stringify(w001s)}`
    );
  });

  test('passes when PROJECT.md has all required sections', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.errors.some(e => e.code === 'E002'),
      `Should not have E002: ${JSON.stringify(output.errors)}`
    );
    assert.ok(
      !output.warnings.some(w => w.code === 'W001'),
      `Should not have W001: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 3: ROADMAP.md exists ───────────────────────────────────────────

  test('errors when ROADMAP.md is missing', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // No ROADMAP.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E003'),
      `Expected E003 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  // ─── Check 4: STATE.md exists and references valid phases ─────────────────

  test('errors when STATE.md is missing with repairable true', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No STATE.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const e004 = output.errors.find(e => e.code === 'E004');
    assert.ok(e004, `Expected E004 in errors: ${JSON.stringify(output.errors)}`);
    assert.strictEqual(e004.repairable, true, 'E004 should be repairable');
  });

  test('warns when STATE.md references nonexistent phase', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeValidConfigJson(tmpDir);
    // STATE.md mentions Phase 99 but only 01-a dir exists
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Session State\n\nPhase 99 is the current phase.\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w002 = output.warnings.find(w => w.code === 'W002');
    assert.ok(w002, `Expected W002 in warnings: ${JSON.stringify(output.warnings)}`);
    assert.strictEqual(w002.repairable, false, 'W002 should not be auto-repairable');
  });

  // Regression: #3652 — after /gsd:complete-milestone, phase dirs move into
  // milestones/vX.Y-phases/ and their `#### Phase N:` headings in ROADMAP.md
  // get collapsed inside <details> blocks. The heading-scan regex misses
  // collapsed phases and collectDiskPhases() only walks the active archive,
  // so W002 used to fire for every historical phase number mentioned in
  // STATE.md's narrative body. Cross-referencing every milestone archive
  // suppresses the false positive.
  test('does not warn W002 for phase refs that live in any milestones archive (#3652)', () => {
    writeMinimalProjectMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '23-current'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'milestones', 'v1.3a-phases', '12-old-phase'), { recursive: true });
    for (const n of ['19-alpha', '20-beta', '21-gamma', '22-delta']) {
      fs.mkdirSync(path.join(tmpDir, '.planning', 'milestones', 'v1.3b-phases', n), { recursive: true });
    }
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap', '',
        '<details><summary>v1.3a: Shipped</summary>', '',
        '- Phase 12: archived', '',
        '</details>', '',
        '<details><summary>v1.3b: Shipped</summary>', '',
        '- Phase 19, 20, 21, 22: archived', '',
        '</details>', '',
        '## v1.4: Current', '',
        '### Phase 23: Current work', '',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      [
        '---', 'milestone: v1.4', 'milestone_name: Current', 'status: executing', '---', '',
        '# State', '',
        '**Current Phase:** 23', '',
        '## Recent', '- Phase 19 shipped', '- Phase 20 shipped', '- Phase 21 shipped', '- Phase 22 shipped',
        '', '## Decisions', '- Decision from Phase 12 still applies',
      ].join('\n')
    );

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w002s = (output.warnings || []).filter(w => w.code === 'W002');
    assert.strictEqual(w002s.length, 0, `Did not expect W002s for archived phases: ${JSON.stringify(w002s)}`);
    // Also no W006 for the archived phases — extractCurrentMilestone strips
    // shipped milestones before the Check 8 heading scan in the CJS path,
    // so archived phase numbers never reach `roadmapPhases`. Pins the
    // assumption that drove the decision NOT to mirror the W002 archive
    // union into Check 8 on the CJS side.
    const w006s = (output.warnings || []).filter(w =>
      w.code === 'W006' && /Phase (?:12|19|20|21|22)\b/.test(String(w.message)),
    );
    assert.strictEqual(w006s.length, 0, `Did not expect W006s for archived phases: ${JSON.stringify(w006s)}`);
  });

  // ─── Check 5: config.json valid JSON + valid schema ───────────────────────

  test('warns when config.json is missing with repairable true', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No config.json

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w003 = output.warnings.find(w => w.code === 'W003');
    assert.ok(w003, `Expected W003 in warnings: ${JSON.stringify(output.warnings)}`);
    assert.strictEqual(w003.repairable, true, 'W003 should be repairable');
  });

  test('errors when config.json has invalid JSON', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      '{broken json'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E005'),
      `Expected E005 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  test('warns when config.json has invalid model_profile', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'invalid' })
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W004'),
      `Expected W004 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('accepts inherit model_profile as valid', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        model_profile: 'inherit',
        workflow: {
          research: true,
          plan_check: true,
          verifier: true,
          nyquist_validation: true,
        },
      })
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W004'),
      `Should not warn for inherit model_profile: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 6: Phase directory naming (NN-name format) ─────────────────────

  test('warns about incorrectly named phase directories', () => {
    writeMinimalProjectMd(tmpDir);
    // Roadmap with no phases to avoid W006
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases yet.\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase references.\n');
    writeValidConfigJson(tmpDir);
    // Create a badly named dir
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', 'bad_name'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W005'),
      `Expected W005 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 7: Orphaned plans (PLAN without SUMMARY) ───────────────────────

  test('reports orphaned plans (PLAN without SUMMARY) as info', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // Create 01-test phase dir with a PLAN but no matching SUMMARY
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    // No 01-01-SUMMARY.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.info.some(i => i.code === 'I001'),
      `Expected I001 in info: ${JSON.stringify(output.info)}`
    );
  });

  // ─── Check 8: Consistency (roadmap/disk sync) ─────────────────────────────

  test('warns about phase in ROADMAP but not on disk', () => {
    writeMinimalProjectMd(tmpDir);
    // ROADMAP mentions Phase 5 but no 05-xxx dir
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 5: Future Phase\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase refs.\n');
    writeValidConfigJson(tmpDir);
    // No phase dirs

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W006'),
      `Expected W006 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('warns about phase on disk but not in ROADMAP', () => {
    writeMinimalProjectMd(tmpDir);
    // ROADMAP has no phases
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases listed.\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase refs.\n');
    writeValidConfigJson(tmpDir);
    // Orphan phase dir not in ROADMAP
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '99-orphan'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W007'),
      `Expected W007 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 5b: Nyquist validation key presence (W008) ─────────────────────

  test('detects W008 when workflow.nyquist_validation absent from config', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow section but WITHOUT nyquist_validation key
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true } }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W008'),
      `Expected W008 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('does not emit W008 when nyquist_validation is explicitly set', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow.nyquist_validation explicitly set
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true, nyquist_validation: true } }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W008'),
      `Should not have W008: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 8b: W006 false-positives for not-yet-started phases (#2009) ──────

  test('does not emit W006 for phases listed in ROADMAP summary as unchecked (not started)', () => {
    // A ROADMAP with Phase 1 started (has disk dir) and Phase 2 listed but
    // unchecked (- [ ]) — phase 2 has no directory because it hasn't started.
    // W006 must NOT fire for phase 2.
    writeMinimalProjectMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## v1.0.0',
        '',
        '- [x] **Phase 1: Setup** - First phase',
        '- [ ] **Phase 2: Build** - Not yet started',
        '',
        '### Phase 1: Setup',
        '',
        '### Phase 2: Build',
        '',
      ].join('\n')
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Only phase 1 dir exists; phase 2 dir does not (not started yet)
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w006s = output.warnings.filter(w => w.code === 'W006');
    assert.ok(
      w006s.length === 0,
      'W006 must not fire for phases with an unchecked summary checkbox (not yet started), got: ' +
        JSON.stringify(w006s)
    );
  });

  test('still emits W006 for a phase that was started (checked) but has no directory', () => {
    // Phase 1 is marked complete ([x]) in ROADMAP summary but has no directory
    // on disk — that IS a genuine inconsistency and should still trigger W006.
    writeMinimalProjectMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '- [x] **Phase 1: Setup** - Completed',
        '',
        '### Phase 1: Setup',
        '',
      ].join('\n')
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 done.\n');
    writeValidConfigJson(tmpDir);
    // No phase 1 directory — even though roadmap says it's complete

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W006'),
      'W006 must still fire when a completed phase has no directory, warnings: ' +
        JSON.stringify(output.warnings)
    );
  });

  // ─── Check 7b: Nyquist VALIDATION.md consistency (W009) ──────────────────

  test('detects W009 when RESEARCH.md has Validation Architecture but no VALIDATION.md', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create phase dir with RESEARCH.md containing Validation Architecture
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\n\nSome validation content.\n'
    );
    // No VALIDATION.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W009'),
      `Expected W009 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('does not emit W009 when VALIDATION.md exists alongside RESEARCH.md', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create phase dir with both RESEARCH.md and VALIDATION.md
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\n\nSome validation content.\n'
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-VALIDATION.md'),
      '# Validation\n\nValidation content.\n'
    );

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W009'),
      `Should not have W009: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Overall status ────────────────────────────────────────────────────────

  test("returns 'healthy' when all checks pass", () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create valid phase dir matching ROADMAP
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-a');
    fs.mkdirSync(phaseDir, { recursive: true });
    // Add PLAN+SUMMARY so no I001
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'healthy', `Expected healthy, got ${output.status}. Errors: ${JSON.stringify(output.errors)}, Warnings: ${JSON.stringify(output.warnings)}`);
    assert.deepStrictEqual(output.errors, [], 'should have no errors');
    assert.deepStrictEqual(output.warnings, [], 'should have no warnings');
  });

  test("returns 'degraded' when only warnings exist", () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    // No config.json → W003 (warning, not error)
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'degraded', `Expected degraded, got ${output.status}`);
    assert.strictEqual(output.errors.length, 0, 'should have no errors');
    assert.ok(output.warnings.length > 0, 'should have warnings');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health --repair command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health --repair command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Set up base project with ROADMAP and PROJECT.md so repairs are triggered
    // (E001, E003 are not repairable so we always need .planning/ and ROADMAP.md)
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates config.json with defaults when missing', () => {
    // STATE.md present so no STATE repair; no config.json
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Ensure no config.json
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed array: ${JSON.stringify(output)}`
    );
    const createAction = output.repairs_performed.find(r => r.action === 'createConfig');
    assert.ok(createAction, `Expected createConfig action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(createAction.success, true, 'createConfig should succeed');

    // Verify config.json now exists on disk with valid JSON and balanced profile
    assert.ok(fs.existsSync(configPath), 'config.json should now exist on disk');
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(diskConfig.model_profile, 'balanced', 'default model_profile should be balanced');
    // Verify nested workflow structure matches config.cjs canonical format
    assert.ok(diskConfig.workflow, 'config should have nested workflow object');
    assert.strictEqual(diskConfig.workflow.research, true, 'workflow.research should default to true');
    assert.strictEqual(diskConfig.workflow.plan_check, true, 'workflow.plan_check should default to true');
    assert.strictEqual(diskConfig.workflow.verifier, true, 'workflow.verifier should default to true');
    assert.strictEqual(diskConfig.workflow.nyquist_validation, true, 'workflow.nyquist_validation should default to true');
    // Verify branch templates are present
    assert.strictEqual(diskConfig.phase_branch_template, 'gsd/phase-{phase}-{slug}');
    assert.strictEqual(diskConfig.milestone_branch_template, 'gsd/{milestone}-{slug}');
  });

  test('resets config.json when JSON is invalid', () => {
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, '{broken json');

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed: ${JSON.stringify(output)}`
    );
    const resetAction = output.repairs_performed.find(r => r.action === 'resetConfig');
    assert.ok(resetAction, `Expected resetConfig action: ${JSON.stringify(output.repairs_performed)}`);

    // Verify config.json is now valid JSON with correct nested structure
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(typeof diskConfig === 'object', 'config.json should be valid JSON after repair');
    assert.ok(diskConfig.workflow, 'reset config should have nested workflow object');
    assert.strictEqual(diskConfig.workflow.research, true, 'workflow.research should be true after reset');
  });

  test('regenerates STATE.md when missing', () => {
    writeValidConfigJson(tmpDir);
    // No STATE.md
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed: ${JSON.stringify(output)}`
    );
    const regenerateAction = output.repairs_performed.find(r => r.action === 'regenerateState');
    assert.ok(regenerateAction, `Expected regenerateState action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(regenerateAction.success, true, 'regenerateState should succeed');

    // Verify STATE.md now exists and contains "# Session State"
    assert.ok(fs.existsSync(statePath), 'STATE.md should now exist on disk');
    const stateContent = fs.readFileSync(statePath, 'utf-8');
    assert.ok(stateContent.includes('# Session State'), 'regenerated STATE.md should contain "# Session State"');
  });

  test('does not rewrite existing STATE.md for invalid phase references', () => {
    writeValidConfigJson(tmpDir);
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    const originalContent = '# Session State\n\nPhase 99 is current.\n';
    fs.writeFileSync(
      statePath,
      originalContent
    );

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !Array.isArray(output.repairs_performed) || !output.repairs_performed.some(r => r.action === 'regenerateState'),
      `Did not expect regenerateState for W002: ${JSON.stringify(output)}`
    );

    const stateContent = fs.readFileSync(statePath, 'utf-8');
    assert.strictEqual(stateContent, originalContent, 'existing STATE.md should be preserved');

    const planningDir = path.join(tmpDir, '.planning');
    const planningFiles = fs.readdirSync(planningDir);
    const backupFile = planningFiles.find(f => f.startsWith('STATE.md.bak-'));
    assert.strictEqual(backupFile, undefined, `Did not expect backup file for non-destructive repair. Found: ${planningFiles.join(', ')}`);
  });

  test('adds nyquist_validation key to config.json via addNyquistKey repair', () => {
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow section but missing nyquist_validation
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true } }, null, 2)
    );

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed array: ${JSON.stringify(output)}`
    );
    const addKeyAction = output.repairs_performed.find(r => r.action === 'addNyquistKey');
    assert.ok(addKeyAction, `Expected addNyquistKey action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(addKeyAction.success, true, 'addNyquistKey should succeed');

    // Read config.json and verify workflow.nyquist_validation is true
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(diskConfig.workflow.nyquist_validation, true, 'nyquist_validation should be true');
  });

  test('reports repairable_count correctly', () => {
    // No config.json (W003, repairable=true) and no STATE.md (E004, repairable=true)
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

    // Run WITHOUT --repair to just check repairable_count
    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.repairable_count >= 2,
      `Expected repairable_count >= 2, got ${output.repairable_count}. Full output: ${JSON.stringify(output)}`
    );
  });

  test('phase mismatch warnings do not count as repairable issues', () => {
    writeValidConfigJson(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Session State\n\nPhase 99 is the current phase.\n'
    );

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.repairable_count, 0, `Expected no repairable issues for W002: ${JSON.stringify(output)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: CJS bundle drift — W005/W006/I001 false positives (#3806)
// PR #3479 fixed these in sdk/src/query/validate.ts but never propagated to
// gsd-core/bin/lib/verify.cjs. These tests fail on old verify.cjs and
// pass on the fixed version.
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — #3806 CJS bundle drift regressions', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // W005 regression: \d{2} → \d{2,} so 999.1-foo is accepted (#3806)
  test('does not emit W005 for a phase directory with a 3-digit prefix (999.1-foo)', () => {
    writeMinimalProjectMd(tmpDir);
    // Roadmap with no phases to avoid spurious W006
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases yet.\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase refs.\n');
    writeValidConfigJson(tmpDir);
    // 999.1-foo should be valid under the widened \d{2,} pattern
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '999.1-foo'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w005s = output.warnings.filter(w => w.code === 'W005');
    assert.strictEqual(
      w005s.length, 0,
      `W005 must not fire for "999.1-foo" (3-digit prefix is valid under \\d{2,}), got: ${JSON.stringify(w005s)}`
    );
  });

  // W005 regression: additional multi-digit variants
  test('does not emit W005 for phase directories with 4-digit and 2-digit prefixes', () => {
    writeMinimalProjectMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases yet.\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase refs.\n');
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '1000-backlog'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '99-done'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '100.2-feature'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w005s = output.warnings.filter(w => w.code === 'W005');
    assert.strictEqual(
      w005s.length, 0,
      `W005 must not fire for multi-digit prefix dirs (\\d{2,} pattern), got: ${JSON.stringify(w005s)}`
    );
  });

  // W006 regression: archived phases in milestones/*-phases/ must not trigger W006 (#3806)
  test('does not emit W006 for a ROADMAP phase whose directory lives in a milestone archive', () => {
    writeMinimalProjectMd(tmpDir);
    // ROADMAP references Phase 1 in the current section
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## v1.0.0',
        '',
        '### Phase 1: Setup',
        '',
      ].join('\n')
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 complete.\n');
    writeValidConfigJson(tmpDir);
    // Phase 1 directory is in a milestone archive, NOT in the flat phases/ dir
    const archiveDir = path.join(tmpDir, '.planning', 'milestones', 'v1.0.0-phases');
    fs.mkdirSync(path.join(archiveDir, '01-setup'), { recursive: true });
    // Ensure flat phases dir exists but does NOT contain phase 1
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w006s = output.warnings.filter(w => w.code === 'W006');
    assert.strictEqual(
      w006s.length, 0,
      `W006 must not fire for Phase 1 when its directory is in a milestone archive, got: ${JSON.stringify(w006s)}`
    );
  });

  // I001 regression: FOO-PLAN.md + FOO-SUMMARY.md must match via canonicalPlanStem (#3806)
  // e.g. 68-01-scaffolding-PLAN.md should match 68-01-SUMMARY.md (canonical stem = "68-01")
  test('does not emit I001 when PLAN name has a descriptor suffix but SUMMARY uses canonical stem', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create phase dir with descriptor-named PLAN and canonical-named SUMMARY
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    // PLAN has a descriptor suffix; SUMMARY uses the canonical stem only
    fs.writeFileSync(path.join(phaseDir, '01-01-scaffolding-PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const i001s = output.info.filter(i => i.code === 'I001');
    assert.strictEqual(
      i001s.length, 0,
      `I001 must not fire when SUMMARY stem (01-01) matches the canonical base of PLAN (01-01-scaffolding → 01-01), got: ${JSON.stringify(i001s)}`
    );
  });

  // Confirm I001 still fires for a genuinely orphaned plan (no summary at all)
  test('still emits I001 for a PLAN with no matching SUMMARY at all', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    // No SUMMARY file at all

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.info.some(i => i.code === 'I001'),
      `I001 must still fire for an orphaned PLAN (no SUMMARY exists), got: ${JSON.stringify(output.info)}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful degradation when phasesDir is missing (#1973)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — missing phasesDir', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('completes without throwing and emits zero phase-directory warnings when phasesDir does not exist', () => {
    // Setup: valid PROJECT, ROADMAP, STATE, config but NO phases directory
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1', '2']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);

    // Remove the phases directory if it exists
    const phasesDir = path.join(tmpDir, '.planning', 'phases');
    if (fs.existsSync(phasesDir)) {
      // eslint-disable-next-line local/no-raw-rmsync-in-tests -- mid-test SUT setup: removes phases/ to simulate missing phasesDir condition
      fs.rmSync(phasesDir, { recursive: true, force: true });
    }

    // Should complete without throwing
    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command should succeed when phasesDir is missing: ${result.error}`);

    const output = JSON.parse(result.output);

    // Assert no phase-directory warnings fired
    const phaseDirCodes = ['W005', 'W006', 'W007', 'W009', 'I001'];
    const issues = output.issues || [];
    for (const code of phaseDirCodes) {
      const matches = issues.filter(i => i.code === code);
      assert.strictEqual(matches.length, 0, `Expected no ${code} issues when phasesDir is missing, got: ${JSON.stringify(matches)}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #1472 regression — workstream-aware paths
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — #1472 workstream-aware path resolution', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports healthy when GSD_WORKSTREAM is set and files are in the correct workstream layout', () => {
    // Shared-root files at .planning/
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Project\n\n## What This Is\n\nTest project.\n\n## Core Value\n\nCore value here.\n\n## Requirements\n\nRequirements here.\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', commit_docs: true, workflow: { nyquist_validation: true, ai_integration_phase: true } }, null, 2)
    );

    // Workstream-scoped files at .planning/workstreams/ws-a/
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'ws-a');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Setup\n'
    );
    fs.writeFileSync(
      path.join(wsDir, 'STATE.md'),
      '# Session State\n\n## Current Position\n\nPhase: 1\n'
    );
    const wsPhaseDir = path.join(wsDir, 'phases', '01-setup');
    fs.mkdirSync(wsPhaseDir, { recursive: true });

    const result = runGsdTools('validate health', tmpDir, { GSD_WORKSTREAM: 'ws-a' });
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // PROJECT.md and config.json must NOT be reported missing (E002/W003)
    assert.ok(
      !output.errors.some(e => e.code === 'E002'),
      `E002 (PROJECT.md missing) should not fire with workstream layout: ${JSON.stringify(output.errors)}`
    );
    assert.ok(
      !output.errors.some(e => e.code === 'E003'),
      `E003 (ROADMAP.md missing) should not fire with workstream layout: ${JSON.stringify(output.errors)}`
    );
    assert.ok(
      !output.errors.some(e => e.code === 'E004'),
      `E004 (STATE.md missing) should not fire with workstream layout: ${JSON.stringify(output.errors)}`
    );
    assert.ok(
      !output.warnings.some(w => w.code === 'W003'),
      `W003 (config.json missing) should not fire with workstream layout: ${JSON.stringify(output.warnings)}`
    );
    // Status should not be 'broken' due to path misrouting
    assert.notStrictEqual(
      output.status, 'broken',
      `Status should not be broken when files exist in the correct workstream layout: ${JSON.stringify(output)}`
    );
  });

  test('without GSD_WORKSTREAM, shared-root files are found at .planning/ root', () => {
    // All files at .planning/ root (no workstream sub-path)
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.errors.some(e => ['E002', 'E003', 'E004'].includes(e.code)),
      `No E002/E003/E004 should fire in standard non-workstream layout: ${JSON.stringify(output.errors)}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #1454 regression — W017 must not fire for the active worktree
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — #1454 W017 excludes active worktree', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // The active-worktree exclusion guard in the SUT (src/verify.cts) compares
  // process.cwd() against each stale-finding path at runtime. The integration
  // scenario below covers the observable CLI contract; the unit-level injection
  // path is omitted here because bin/lib/verify.cjs is a gitignored tsc artifact
  // not present in a fresh worktree.

  test('validate health completes without W017 for the cwd itself when inspected as worktree root', () => {
    // Set up a minimal healthy project at tmpDir
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    // Run with cwd = tmpDir. The SUT will call process.cwd() which is the test runner's cwd,
    // not tmpDir, so any stale worktree that matches tmpDir (as a non-cwd) CAN legitimately
    // be flagged. The guard only protects the CURRENT process.cwd().
    // What we assert: when there is no real git repo at tmpDir, no W017 fires (git worktree
    // list will fail / return empty — the try/catch swallows it silently).
    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W017'),
      `W017 should not fire for a non-git project dir: ${JSON.stringify(output.warnings)}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// planning coherence axis (#612) — additive coherence field
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — planning coherence axis (#612)', () => {
  const { execFileSync } = require('child_process');
  let tmpDir;

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('no baseline → coherence unknown', () => {
    tmpDir = createTempProject();
    // Full valid project but STATE.md has no frontmatter → no last_reconciled_commit
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir); // default: no frontmatter, no baseline
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.coherence, 'unknown',
      `expected coherence=unknown, got: ${out.coherence}; warnings=${JSON.stringify(out.warnings)}`);
  });

  test('W011 state/roadmap conflict → coherence drifted', () => {
    tmpDir = createTempProject();
    writeMinimalProjectMd(tmpDir);
    // ROADMAP: Phase 1 marked complete with [x]
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n- [x] **Phase 1: Setup**\n'
    );
    // STATE.md: current phase = 1, status = in-progress → W011 fires
    writeMinimalStateMd(tmpDir, '# Session State\n\n**Current Phase:** 1\n**Status:** in-progress\n');
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(
      out.warnings.some(w => w.code === 'W011'),
      `Expected W011 in warnings: ${JSON.stringify(out.warnings)}`
    );
    assert.strictEqual(out.coherence, 'drifted',
      `expected coherence=drifted, got: ${out.coherence}`);
  });

  test('status verdict unchanged: degraded+coherent (additivity guarantee)', () => {
    tmpDir = createTempGitProject();
    // Resolve actual HEAD SHA and branch — pin base_branch in config for determinism
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
    const branchName = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();

    // PROJECT.md missing "## Core Value" → W001 (benign, not coherence-bearing)
    writeMinimalProjectMd(tmpDir, ['## What This Is', '## Requirements']);
    writeMinimalRoadmap(tmpDir, ['1']);

    // STATE.md with baseline frontmatter pointing at current HEAD (0 commits ahead → not drifted)
    // reconciledAt is 1 day ago — well within the 7-day staleness window → not stale
    const recentIso = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    writeMinimalStateMd(tmpDir,
      `---\nlast_reconciled_commit: ${headSha}\nlast_reconciled_at: ${recentIso}\n---\n` +
      '# Session State\n\n**Current Phase:** 1\n**Status:** in-progress\n'
    );

    // Pin git.base_branch so resolveBaseRef(cwd) is deterministic regardless of git host config
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', commit_docs: true, git: { base_branch: branchName } }, null, 2)
    );

    // Phase dir — avoid W006/W007
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    // Axis 1: W001 (missing section) → degraded; must be unchanged by the coherence axis
    assert.strictEqual(out.status, 'degraded',
      `axis-1 status must be degraded (W001 fires); got: ${out.status}; warnings=${JSON.stringify(out.warnings)}`);
    // Axis 2: 0 commits ahead, recent baseline, no coherence-bearing codes → coherent
    assert.strictEqual(out.coherence, 'coherent',
      `axis-2 coherence must be coherent; got: ${out.coherence}; warnings=${JSON.stringify(out.warnings)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W007 coherence-bearing / W006 advisory-only (Task 4)
//
// W007 (active disk phase not in ROADMAP) feeds the coherence axis.
// W006 (roadmap phase not on disk) is advisory-only and must NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — W007 coherence-bearing, W006 advisory (task-4)', () => {
  const { execFileSync } = require('child_process');
  let tmpDir;

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Test A — RED before task-4 (coherence='unknown'), GREEN after (coherence='drifted').
  // Rationale: W007 is emitted for activeDiskPhases only (excludes archived), so every
  // W007 is an active phase that shipped without being in the plan — genuine drift.
  // With no baseline the drift check is skipped (reason='no-baseline'), so pre-task-4
  // coherence defaults to 'unknown'. Post-task-4 W007's coherenceBearing flag fires
  // the drifted branch before the unknown branch is reached.
  test('W007 (active disk phase absent from ROADMAP) → coherence drifted', () => {
    tmpDir = createTempProject();
    writeMinimalProjectMd(tmpDir);
    // ROADMAP with no phases — prevents W006 from firing
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases listed.\n'
    );
    writeMinimalStateMd(tmpDir); // no frontmatter → no baseline → driftResult.reason='no-baseline'
    writeValidConfigJson(tmpDir);
    // Active disk phase not mentioned in ROADMAP → W007 (coherenceBearing=true after task-4)
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-active'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);

    assert.ok(
      out.warnings.some(w => w.code === 'W007'),
      `Expected W007 in warnings: ${JSON.stringify(out.warnings)}`
    );
    assert.strictEqual(out.coherence, 'drifted',
      `W007 must flip coherence to drifted; got: ${out.coherence}; warnings=${JSON.stringify(out.warnings)}`);
  });

  // Test B — regression guard: W006 must never become coherence-bearing.
  // Passes both before and after task-4. Uses a real git project with a pinned
  // baseline so the drift check produces a clean 'coherent' (not 'unknown').
  test('W006-only project keeps coherence coherent (W006 is advisory-only)', () => {
    tmpDir = createTempGitProject();
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
    const branchName = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
    const recentIso = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    writeMinimalProjectMd(tmpDir); // all required sections → no W001
    // ROADMAP with phase 1 (no checkbox = not "not-started") → W006 fires when no disk dir
    writeMinimalRoadmap(tmpDir, ['1']);
    // Baseline at HEAD, recent timestamp → drift check: 0 commits ahead, not stale → coherent
    writeMinimalStateMd(tmpDir,
      `---\nlast_reconciled_commit: ${headSha}\nlast_reconciled_at: ${recentIso}\n---\n` +
      '# Session State\n\nNo phase refs.\n' // no **Current Phase:** → W011 safe
    );
    // Pin base_branch for determinism; no phase_id_convention → W021 safe
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', commit_docs: true, git: { base_branch: branchName } }, null, 2)
    );
    // No disk phase dirs → activeDiskPhases empty → no W007
    // ROADMAP has phase 1 with no disk dir → W006 fires

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);

    assert.ok(
      out.warnings.some(w => w.code === 'W006'),
      `Expected W006 in warnings: ${JSON.stringify(out.warnings)}`
    );
    assert.ok(
      !out.warnings.some(w => w.code === 'W007'),
      `W007 must not fire when no orphan disk phases: ${JSON.stringify(out.warnings)}`
    );
    assert.strictEqual(out.coherence, 'coherent',
      `W006 must NOT affect coherence; got: ${out.coherence}; warnings=${JSON.stringify(out.warnings)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I-3: coherenceBearing must not appear in serialized warning objects
// Minor: unreachable baseline / exception → coherence unknown
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — I-3 coherenceBearing stripped + minor unreachable-baseline', () => {
  const { execFileSync } = require('child_process');
  let tmpDir;

  afterEach(() => {
    cleanup(tmpDir);
  });

  // I-3: coherenceBearing is an internal computation tag. It must not appear in
  // the serialized warning objects in the public JSON output. W007 is the only
  // warning that currently sets coherenceBearing, so we use the W007 fixture and
  // assert the serialized warning object has no coherenceBearing key.
  test('W007 serialized warning object does NOT contain coherenceBearing key (I-3)', () => {
    tmpDir = createTempProject();
    writeMinimalProjectMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases listed.\n'
    );
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // Active disk phase not in ROADMAP → W007 emitted
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-active'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);

    const w007 = out.warnings.find(w => w.code === 'W007');
    assert.ok(w007, `Expected W007 in warnings: ${JSON.stringify(out.warnings)}`);

    // The coherence verdict must still compute correctly (coherenceBearing logic intact)
    assert.strictEqual(out.coherence, 'drifted',
      `W007 must still produce coherence=drifted; got: ${out.coherence}`);

    // The serialized warning object must NOT carry the internal tag
    assert.ok(!('coherenceBearing' in w007),
      `W007 warning must not have coherenceBearing in output JSON; got: ${JSON.stringify(w007)}`);
  });

  // Minor fix: a garbage/unreachable last_reconciled_commit should produce
  // coherence='unknown' rather than 'coherent'. Before the fix, commitsSince
  // returned empty commits for an unreachable SHA (git log exits non-zero)
  // which detectPlanningDrift treated as 0 commits ahead → coherent.
  // After the fix, the reachability pre-check detects the unreachable SHA and
  // sets driftResult.reason='baseline-unreachable' → coherence='unknown'.
  test('unreachable last_reconciled_commit → coherence unknown (minor fix)', () => {
    tmpDir = createTempGitProject();
    const branchName = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();

    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    // Stamp a garbage SHA that doesn't exist in the repo
    const garbageSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const recentIso = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    writeMinimalStateMd(tmpDir,
      `---\nlast_reconciled_commit: ${garbageSha}\nlast_reconciled_at: ${recentIso}\n---\n` +
      '# Session State\n\nNo phase refs.\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', commit_docs: true, git: { base_branch: branchName } }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);

    assert.strictEqual(out.coherence, 'unknown',
      `Unreachable baseline must yield coherence=unknown; got: ${out.coherence}; detail=${out.coherence_detail}`);
  });
});
