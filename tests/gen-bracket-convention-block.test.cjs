// allow-test-rule: source-text-is-the-product see #612
// The real-tree parity gate reads agent/workflow/template .md source via
// findStale() — their text IS the deployed contract. Per CONTRIBUTING.md
// exception matrix (same basis as workflow-size.test.cjs).
'use strict';

/**
 * gen-bracket-convention-block.test.cjs — behavioral tests for
 * scripts/gen-bracket-convention-block.cjs (#612 PR-6, injection prototype).
 *
 * Uses node:test + node:assert/strict. The parity gate is exercised two ways:
 *   1. Against the REAL tree — findStale() must be empty (every manifest target
 *      carries the current canonical block).
 *   2. Against a TEMP fixture — a mutated / missing block must be caught, proving
 *      the gate actually fires (regression-must-fail-first).
 * Stamping mechanics (idempotency, append, in-place replace, HR-footer insert)
 * are tested on in-memory fixtures — no mutation of the real tree.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanup } = require('./helpers.cjs');

const {
  MANIFEST,
  BLOCK,
  BEGIN_MARKER,
  END_MARKER,
  BLOCK_RE,
  stamp,
  findStale,
} = require('../scripts/gen-bracket-convention-block.cjs');

function countBlocks(content) {
  return content.split(BEGIN_MARKER).length - 1;
}

describe('gen-bracket-convention-block: real-tree parity gate', () => {
  test('every manifest target carries the canonical block (--check is green)', () => {
    const stale = findStale();
    assert.deepEqual(
      stale,
      [],
      'stale targets: ' + stale.map((s) => s.file + ' (' + s.reason + ')').join(', '),
    );
  });

  test('the manifest is non-empty and lists real repo-relative paths', () => {
    assert.ok(MANIFEST.length >= 1);
    const ROOT = path.resolve(__dirname, '..');
    for (const rel of MANIFEST) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), 'manifest target missing on disk: ' + rel);
    }
  });
});

describe('gen-bracket-convention-block: stamping mechanics', () => {
  test('appends the block when none is present, ending with a single newline', () => {
    const src = '# Title\n\nBody line.\n';
    const out = stamp(src);
    assert.ok(out.startsWith(src.replace(/\n+$/, '\n')), 'original content is preserved at the head');
    assert.ok(BLOCK_RE.test(out), 'block was appended');
    assert.equal(countBlocks(out), 1, 'exactly one block');
    assert.ok(out.endsWith(END_MARKER + '\n'), 'ends with the END marker + single newline');
  });

  test('is idempotent — re-stamping is a no-op', () => {
    const src = '# Title\n\nBody line.\n';
    const once = stamp(src);
    const twice = stamp(once);
    assert.equal(twice, once, 'stamp(stamp(x)) === stamp(x)');
    assert.equal(countBlocks(twice), 1, 'no duplicate blocks after re-stamp');
  });

  test('replaces an existing block in place rather than duplicating it', () => {
    const src = '# Title\n\nBody.\n';
    const stamped = stamp(src);
    // Corrupt the block body, then re-stamp — the canonical text must be restored.
    const mutated = stamped.replace('never a bare `Phase NN`', 'HAND-EDITED DRIFT');
    assert.notEqual(mutated, stamped);
    const restored = stamp(mutated);
    assert.equal(restored, stamped, 'a drifted block is rewritten to the canonical text');
    assert.equal(countBlocks(restored), 1, 'still exactly one block');
  });

  test('inserts before a trailing horizontal-rule footer', () => {
    const src = '# Title\n\nBody.\n\n---\n';
    const out = stamp(src);
    assert.ok(BLOCK_RE.test(out), 'block present');
    const blockIdx = out.indexOf(BEGIN_MARKER);
    const footerIdx = out.lastIndexOf('\n---');
    assert.ok(blockIdx < footerIdx, 'block sits BEFORE the trailing --- footer');
    assert.ok(out.trimEnd().endsWith('---'), 'the HR footer remains the last content');
    assert.equal(countBlocks(out), 1);
  });
});

describe('gen-bracket-convention-block: gate catches drift (temp fixture)', () => {
  function buildTempTree(mutator) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bracket-conv-'));
    for (const rel of MANIFEST) {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // A minimal, correctly-stamped file for each target.
      fs.writeFileSync(abs, stamp('# ' + rel + '\n\nplaceholder body.\n'), 'utf8');
    }
    mutator(tmp);
    return tmp;
  }

  test('a hand-edited (drifted) block is reported as differing', () => {
    const target = MANIFEST[0];
    const tmp = buildTempTree((root) => {
      const abs = path.join(root, target);
      const drifted = fs.readFileSync(abs, 'utf8').replace('Phase-ID convention', 'DRIFTED HEADING');
      fs.writeFileSync(abs, drifted, 'utf8');
    });
    try {
      const stale = findStale(tmp);
      assert.equal(stale.length, 1, 'exactly one target flagged');
      assert.equal(stale[0].file, target);
      assert.match(stale[0].reason, /differs/);
    } finally {
      cleanup(tmp);
    }
  });

  test('a missing block is reported as missing', () => {
    const target = MANIFEST[MANIFEST.length - 1];
    const tmp = buildTempTree((root) => {
      const abs = path.join(root, target);
      fs.writeFileSync(abs, '# no block here\n', 'utf8');
    });
    try {
      const stale = findStale(tmp);
      assert.equal(stale.length, 1);
      assert.equal(stale[0].file, target);
      assert.match(stale[0].reason, /missing/);
    } finally {
      cleanup(tmp);
    }
  });

  test('a fully-stamped temp tree is clean', () => {
    const tmp = buildTempTree(() => {});
    try {
      assert.deepEqual(findStale(tmp), []);
    } finally {
      cleanup(tmp);
    }
  });
});

describe('gen-bracket-convention-block: canonical block is grammar-faithful', () => {
  test('teaches the bracket phase-level forms from references/phase-id-convention.md', () => {
    assert.match(BLOCK, /- \[ \] \*\*\[CODE\.MM\] NN: Name\*\*/, 'checklist form');
    assert.match(BLOCK, /### \[CODE\.MM\] NN: Name/, 'detail heading form');
    assert.match(BLOCK, /CODE\.MM-NN\[\.SS\]-slug/, 'phase dir form');
    assert.match(BLOCK, /NN-PP-PLAN\.md/, 'plan file form (phase + plan, milestone-free)');
    assert.match(BLOCK, /phase_id_convention/, 'gated on the config key');
    assert.match(BLOCK, /references\/phase-id-convention\.md/, 'points at the canonical doc');
  });

  test('does NOT contradict the doc: no `## [CODE.MM]` milestone heading, no vX.Y prohibition', () => {
    // Milestones remain vX.Y-labelled under bracket (getMilestoneFromPhaseId ->
    // v2.0); the milestone `##` heading form is not part of the canonical grammar.
    assert.doesNotMatch(BLOCK, /(^|\n)## \[CODE\.MM\]/, 'must not teach a `## [CODE.MM]` milestone heading');
    assert.doesNotMatch(BLOCK, /vX\.Y/, 'must not prohibit vX.Y milestone labels');
  });
});
