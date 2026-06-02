/**
 * Bracket templates test (WAVE 5, SPEC §4.7).
 *
 * Asserts the human-facing forms baked into get-shit-done/templates/* are
 * byte-consistent with the Wave-3 migrator (roadmap-upgrade.cjs) and the Wave-4
 * emit path (phase.cjs via core.cjs helpers). The templates are the
 * authored-by-hand surface; the migrator/phase.cjs are the runtime emit. A phase
 * the migrator produces must look identical to what the template documents.
 *
 * These tests parse the template strings, never grep loosely — they pin the
 * exact bracket grammar:
 *   - phase heading   `### [{PROJECT}.{MM}] {NN}: {Name}`
 *   - phase bullet    `- [ ] **[{PROJECT}.{MM}] {NN}: [Name]**`
 *   - milestone head  `## [{PROJECT}.{MM}] {Name}`  (no v-literal, no emoji)
 *   - depends-on      `**Depends on:** [{PROJECT}.{MM}] {NN}`
 *   - dir token       `{PROJECT}.{MM}-{NN}[.{SS}]-slug`
 *   - plan filename   `{NN}[.{SS}]-{PP}-PLAN.md`  (milestone NOT in filename)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { getPhaseDisplayLabel, getPhaseDirFromPhaseId } = require('../get-shit-done/bin/lib/core.cjs');

const TEMPLATES = path.join(__dirname, '..', 'get-shit-done', 'templates');
const read = (f) => fs.readFileSync(path.join(TEMPLATES, f), 'utf8');

describe('bracket templates — emit-parity', () => {
  test('roadmap.md phase headings match getPhaseDisplayLabel emit', () => {
    const roadmap = read('roadmap.md');
    // The label helper is the SOLE source of the bracket display string used by
    // phase.cjs heading emit. The template must reuse the identical form.
    const label = getPhaseDisplayLabel('01', 'GSD.01'); // "[GSD.01] 01"
    assert.ok(
      roadmap.includes(`### ${label}: [Name]`),
      `roadmap.md must contain the bracket phase heading "### ${label}: [Name]"`
    );
    const subLabel = getPhaseDisplayLabel('2.1', 'GSD.01'); // "[GSD.01] 02.01"
    assert.ok(
      roadmap.includes(`### ${subLabel}: [Name]`),
      `roadmap.md must document a subphase heading "### ${subLabel}: [Name]"`
    );
  });

  test('roadmap.md phase bullets carry the bracket label inside bold', () => {
    const roadmap = read('roadmap.md');
    const label = getPhaseDisplayLabel('01', 'GSD.01');
    assert.ok(
      roadmap.includes(`- [ ] **${label}: [Name]**`),
      `roadmap.md must contain the bracket bullet "- [ ] **${label}: [Name]**"`
    );
  });

  test('roadmap.md milestone section heading is bracket+name (no v-literal, no emoji)', () => {
    const roadmap = read('roadmap.md');
    assert.ok(roadmap.includes('## [GSD.02] [Name]'), 'milestone section must be "## [GSD.02] [Name]"');
    // No version literal or emoji on any heading line.
    const headingLines = roadmap.split('\n').filter(l => /^#{1,4}\s/.test(l));
    for (const line of headingLines) {
      assert.ok(!/v\d+\.\d+/.test(line), `heading must not carry a v-literal: ${line}`);
      assert.ok(!/[✅🚧📋🟡]/u.test(line), `heading must not carry a milestone emoji: ${line}`);
      assert.ok(!/\bPhase\s+\d/.test(line), `heading must not carry the "Phase" word: ${line}`);
    }
  });

  test('roadmap.md depends-on uses the bracket label with colon inside bold', () => {
    const roadmap = read('roadmap.md');
    // phase.cjs emits `**Depends on:** [GSD.MM] {prev}` (colon inside the bold).
    assert.ok(
      roadmap.includes('**Depends on:** [GSD.01] 01'),
      'roadmap.md depends-on must be "**Depends on:** [GSD.01] 01"'
    );
  });

  test('roadmap.md no longer carries the decimal-insertion / INSERTED convention', () => {
    const roadmap = read('roadmap.md');
    assert.ok(!/INSERTED/.test(roadmap), 'roadmap.md must not reference the INSERTED insertion pattern');
    assert.ok(!/never restart at 01/i.test(roadmap), 'roadmap.md must not keep continuous-numbering guidance');
    assert.ok(/restart/i.test(roadmap), 'roadmap.md must document per-milestone phase restart');
  });

  test('roadmap.md collapses to a single progress table (no separate Milestone column)', () => {
    const roadmap = read('roadmap.md');
    // The unified table header has Phase/Plans Complete/Status/Completed and the
    // Phase cell carries the bracket label, so no standalone Milestone column.
    assert.ok(
      !/\|\s*Phase\s*\|\s*Milestone\s*\|/.test(roadmap),
      'progress table must not have a separate Milestone column'
    );
  });

  test('state.md frontmatter carries milestone: and milestone_name:', () => {
    const state = read('state.md');
    assert.ok(/^milestone:\s*v\d+\.\d+/m.test(state), 'state.md must have a `milestone: v{N}.0` frontmatter line');
    assert.ok(/^milestone_name:/m.test(state), 'state.md must have a `milestone_name:` frontmatter line');
  });

  test('milestone.md + milestone-archive.md use bracket milestone headings (no v-literal)', () => {
    const ms = read('milestone.md');
    assert.ok(ms.includes('## [{PROJECT}.{MM}] [Name]'), 'milestone.md template heading must be bracket+name');
    const arch = read('milestone-archive.md');
    assert.ok(arch.includes('### [{{PROJECT}}.{{MM}}] {{PHASE_NUM}}:'), 'archive phase heading must be bracket form');
    assert.ok(!/Decimal Phases:/.test(arch), 'archive must not keep a "Decimal Phases:" section');
  });

  test('phase-prompt.md + summary.md dir token carries the milestone prefix; plan filename stays bare', () => {
    const pp = read('phase-prompt.md');
    const sm = read('summary.md');
    // Dir token = getPhaseDirFromPhaseId form (milestone in the prefix).
    const dir = getPhaseDirFromPhaseId('03', 'Features', 'GSD', '01'); // "GSD.01-03-features"
    assert.ok(pp.includes(`${dir}/`), `phase-prompt.md must use the bracket dir prefix "${dir}/"`);
    assert.ok(pp.includes('{PROJECT}.{MM}-{NN}[.{SS}]-name'), 'phase-prompt.md must document the bracket dir token');
    assert.ok(sm.includes('{PROJECT}.{MM}-{NN}[.{SS}]-name'), 'summary.md must document the bracket dir token');
    // Plan/summary filenames remain bare {phase}[.{subphase}]-{plan} (R5 — no milestone).
    assert.ok(pp.includes('01-02-PLAN.md'), 'plan filename must stay bare (no milestone in filename)');
    assert.ok(pp.includes('02.01-01-PLAN.md'), 'subphase plan filename must stay bare {phase}.{sub}-{plan}');
    assert.ok(pp.includes('03-01-SUMMARY.md'), 'summary filename must stay bare');
    // depends_on plan-ids stay bare (no bracket, no milestone) — R5 regression guard.
    assert.ok(/depends_on:\s*\[("?\d{2}(\.\d{2})?-\d{2}"?(,\s*)?)+\]/.test(pp), 'depends_on plan-ids stay bare');
  });

  test('config.json sets phase_id_convention bracket with a project_code present', () => {
    const cfg = JSON.parse(read('config.json'));
    assert.equal(cfg.phase_id_convention, 'bracket', 'config.json must declare bracket convention');
    // ADDENDUM-4: bracket REQUIRES project_code. The template ships a placeholder
    // so the bracket emit gate (conv==='bracket' && !!project_code) is satisfiable.
    assert.ok(cfg.project_code && typeof cfg.project_code === 'string' && cfg.project_code.length > 0,
      'config.json must ship a non-null project_code for a bracket project');
  });
});
