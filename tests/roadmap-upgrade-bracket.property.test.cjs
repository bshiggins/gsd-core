'use strict';

/**
 * ADR-612 PR-3 (#4144) — property-based coverage for the bracket roadmap
 * migration transform.
 *
 * Module: gsd-core/bin/lib/roadmap-upgrade.cjs (src/roadmap-upgrade.cts)
 *
 * Why this file exists (#4698 review round 28, trek-e Blocker): the sibling
 * `roadmap-upgrade-bracket.test.cjs` covers the command boundary with four
 * committed fixture trees. A migrator runs against real user ROADMAP.md files,
 * so `RULESET.TESTS.property-based-testing` (idempotency and round-trip, over
 * the input-shape space rather than four hand-picked examples) applies.
 *
 * What it drives: the REAL planner (`computeMigrationPlan(cwd,
 * { convention: 'bracket' })`) against a generated `.planning/` tree, and the
 * REAL roadmap writer (`applyRoadmapEdits` — the same function
 * `applyMigration` writes through), never a hand-rolled line-replacer.
 * `applyMigration` itself is not called here: its real run demands a clean git
 * tree, and a `git init` + commit per generated case would put this file in
 * minutes rather than seconds. The command-boundary contracts it owns
 * (dry-run, dirty-tree refusal, rollback) stay covered by the fixture tests.
 *
 * Properties:
 *   (a) idempotency   — the planner no-ops on its own output: migrate(migrate(x))
 *                       produces zero edits, and the content is byte-identical
 *   (b) preservation  — every line the plan did not name is byte-identical,
 *                       fenced example blocks included
 *   (c) round-trip    — every emitted heading is a canonical bracket id
 *                       (parsePhaseId round-trips it), and an M-NN source's
 *                       integer identity survives the move into the bracket
 *   (d) preservation  — phase names and document order are preserved 1:1
 *   (e) injectivity   — no two phases collapse onto one (milestone, token)
 */

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('./helpers/fast-check-setup.cjs');
const { cleanup } = require('./helpers.cjs');

const {
  computeMigrationPlan,
  applyRoadmapEdits,
} = require('../gsd-core/bin/lib/roadmap-upgrade.cjs');
const { parsePhaseId, renderPhaseId } = require('../gsd-core/bin/lib/phase-id.cjs');

// ─── Generators ──────────────────────────────────────────────────────────────

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pad2 = (n) => String(n).padStart(2, '0');

const wordArb = fc
  .array(fc.constantFrom(...LOWER), { minLength: 3, maxLength: 8 })
  .map((cs) => cs.join(''));

const nameArb = fc
  .array(wordArb, { minLength: 1, maxLength: 3 })
  .map((ws) => ws.map((w) => w[0].toUpperCase() + w.slice(1)).join(' '));

const projectCodeArb = fc
  .tuple(
    fc.constantFrom(...UPPER),
    fc.array(fc.constantFrom(...`${UPPER}0123456789_`), { maxLength: 4 }),
  )
  .map(([head, rest]) => head + rest.join(''));

const phaseArb = fc.record({
  // The three source shapes the bracket migrator accepts: legacy `Phase N`,
  // M-NN `Phase M-NN`, and deep M-NN `Phase M-NN-SS`.
  kind: fc.constantFrom('legacy', 'mnn', 'mnn-deep'),
  name: nameArb,
  tagged: fc.boolean(),
  bullet: fc.constantFrom('bold', 'plain', 'none'),
  prose: nameArb,
});

const docArb = fc.record({
  projectCode: projectCodeArb,
  milestones: fc.array(
    fc.record({
      title: nameArb,
      phases: fc.array(phaseArb, { minLength: 1, maxLength: 4 }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

// A fenced example block carrying phase-like lines: fenced content is never a
// phase heading or bullet, so the migrator must leave it byte-identical.
const FENCE = [
  '```markdown',
  '### Phase 9: Example Inside A Fence',
  '- [ ] **Phase 9:** Example Inside A Fence',
  '```',
];

/**
 * Render a generated spec as ROADMAP.md, assigning source tokens that are
 * unique by construction (the planner legitimately refuses colliding ones —
 * that refusal is a fixture-test contract, not what these properties are
 * about). Returns the content plus the expected phase sequence in document
 * order.
 */
function buildRoadmap(spec) {
  const lines = ['# Roadmap', ''];
  const expected = [];
  let legacyCounter = 0;
  spec.milestones.forEach((ms, mi) => {
    const milestoneInt = mi + 1;
    lines.push(`## v${milestoneInt}.0 — ${ms.title}`, '');
    let mnnCounter = 0;
    for (const ph of ms.phases) {
      let sourceToken;
      if (ph.kind === 'legacy') {
        legacyCounter += 1;
        sourceToken = String(legacyCounter);
      } else {
        mnnCounter += 1;
        sourceToken =
          `${milestoneInt}-${pad2(mnnCounter)}` + (ph.kind === 'mnn-deep' ? '-01' : '');
      }
      const tag = ph.tagged ? ' (Cluster B)' : '';
      lines.push(`### Phase ${sourceToken}${tag}: ${ph.name}`, '');
      if (ph.bullet === 'bold') {
        lines.push(`- [ ] **Phase ${sourceToken}:** ${ph.name}`, '');
      } else if (ph.bullet === 'plain') {
        lines.push(`- [x] Phase ${sourceToken}: ${ph.name}`, '');
      }
      lines.push(`${ph.prose} notes for this slice.`, '');
      expected.push({ kind: ph.kind, sourceToken, milestoneInt, name: ph.name, tag });
    }
  });
  lines.push(...FENCE, '');
  return { content: lines.join('\n'), expected };
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-bracket-prop-'));
const planningDir = path.join(cwd, '.planning');
const roadmapPath = path.join(planningDir, 'ROADMAP.md');
const configPath = path.join(planningDir, 'config.json');
fs.mkdirSync(planningDir, { recursive: true });

after(() => {
  cleanup(cwd);
});

/** Write a case into the shared scratch tree and plan it. Each run fully
 *  overwrites both files, so runs cannot leak into one another. */
function planFor(content, projectCode) {
  fs.writeFileSync(configPath, `${JSON.stringify({ project_code: projectCode }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(roadmapPath, content, 'utf8');
  return computeMigrationPlan(cwd, { convention: 'bracket' });
}

// `### [CODE.MM] TOKEN[ (Tag)]: Name`
const EMITTED_HEADING_RE = /^(#{2,4})\s+(\[[A-Z][A-Z0-9_]*\.\d+\] \d+(?:\.\d+)?)( \([^)]*\))?: (.*)$/;

describe('bracket roadmap migration: transform properties', () => {
  test('property: migrate is idempotent and loses nothing', () => {
    // Coverage guard: a future generator change that stopped producing one of
    // the source shapes would leave the property passing while covering less.
    // Counted here and asserted after the run.
    const kinds = new Set();
    const bullets = new Set();
    fc.assert(
      fc.property(docArb, (spec) => {
        for (const ms of spec.milestones) {
          for (const ph of ms.phases) {
            kinds.add(ph.kind);
            bullets.add(ph.bullet);
          }
        }
        const { content, expected } = buildRoadmap(spec);
        const plan1 = planFor(content, spec.projectCode);

        // Non-vacuity: the generated document must actually be migratable —
        // otherwise every assertion below would pass on an untouched file.
        assert.ok(!plan1.alreadyMigrated, 'planner reported nothing to migrate');
        assert.ok(plan1.roadmapEdits.length > 0, 'planner produced no edits');

        const migrated = applyRoadmapEdits(content, plan1.roadmapEdits);
        const before = content.split('\n');
        const afterLines = migrated.split('\n');

        // (b) Preservation: line count is stable and every line the plan did
        // not name is byte-identical.
        assert.equal(afterLines.length, before.length);
        const touched = new Set(plan1.roadmapEdits.map((e) => e.lineIndex));
        for (let i = 0; i < before.length; i++) {
          if (!touched.has(i)) {
            assert.equal(afterLines[i], before[i], `line ${i} changed unexpectedly`);
          }
        }

        // (b) cont. — the fenced example block is never touched, headings and
        // bullets inside it included.
        for (const fenceLine of FENCE) {
          assert.ok(
            afterLines.includes(fenceLine),
            `fenced line lost: ${JSON.stringify(fenceLine)}`,
          );
        }

        // (c)(d)(e) Every emitted heading, in document order.
        const emitted = afterLines
          .map((line) => line.match(EMITTED_HEADING_RE))
          .filter(Boolean)
          // The fence's own `### Phase 9: …` never matches the bracket shape,
          // so nothing from inside the fence can reach this list.
          .map((m) => ({ id: m[2], tag: m[3] ?? '', name: m[4] }));
        assert.equal(emitted.length, expected.length, 'heading count changed');

        const seen = new Set();
        emitted.forEach((head, idx) => {
          const want = expected[idx];

          // (c) The emitted id is canonical: it survives parse → render
          // byte-for-byte, which is the bracket format's own contract.
          const parsed = parsePhaseId(head.id);
          assert.equal(renderPhaseId(parsed), head.id);

          // (c) cont. — the milestone the phase lived under is the milestone
          // it lands in.
          assert.equal(parsed.milestone, pad2(want.milestoneInt));

          // (c) cont. — an M-NN source keeps its integer identity through the
          // move: `2-04-01` → `[CODE.02] 04.01`.
          if (want.kind !== 'legacy') {
            const segments = want.sourceToken.split('-');
            assert.equal(parsed.milestone, pad2(parseInt(segments[0], 10)));
            assert.equal(parsed.phase, pad2(parseInt(segments[1], 10)));
            if (segments[2] !== undefined) {
              assert.equal(parsed.subphase, pad2(parseInt(segments[2], 10)));
            } else {
              assert.equal(parsed.subphase, undefined);
            }
          }

          // (d) Name and tag ride through untouched, in order.
          assert.equal(head.name, want.name);
          assert.equal(head.tag, want.tag);

          // (e) Injectivity: no two phases collapse onto one identity.
          assert.ok(!seen.has(head.id), `duplicate identity emitted: ${head.id}`);
          seen.add(head.id);
        });

        // (a) Idempotency. Note config.json still says nothing about the
        // convention, so this re-plan is NOT short-circuited by the
        // `phase_id_convention: 'bracket'` guard — the planner has to decide
        // from the roadmap's own content that there is nothing left to do.
        const plan2 = planFor(migrated, spec.projectCode);
        assert.equal(plan2.alreadyMigrated, true);
        assert.equal(plan2.roadmapEdits.length, 0);
        assert.equal(applyRoadmapEdits(migrated, plan2.roadmapEdits), migrated);
      }),
    );
    assert.deepEqual([...kinds].sort(), ['legacy', 'mnn', 'mnn-deep']);
    assert.deepEqual([...bullets].sort(), ['bold', 'none', 'plain']);
  });
});
