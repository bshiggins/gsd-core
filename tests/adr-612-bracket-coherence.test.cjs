'use strict';

/**
 * PR-2 (#2761 / epic #612) — verify.cts: the advisory bracket-coherence W021 and
 * the milestone-complete (B6) bracket tolerance.
 *
 * Two different postures in one file, and the difference is the whole design:
 *
 *   - checkBracketCoherence is a CHECK THAT CAN FAIL A REPO, so it is GATED on
 *     `phase_id_convention === 'bracket'`. A null or milestone-prefixed repo
 *     must never see it. (ADR-612 Decision 2: gating applies to checks, not to
 *     reads.)
 *   - The milestone-complete check (B6) is a READ, and it is UNGATED. It has to
 *     be: it is pinned by bug-557 with `config.json = '{}'`, so it fires on
 *     every repo regardless of convention.
 *
 * RT0 — the highest-risk interaction in the PR, and the reason B6's heading read
 * and the directory read had to land together. B6 resolves each ROADMAP phase to
 * a directory via phaseTokenMatches. Widening the HEADING read without widening
 * the DIRECTORY read means every bracket phase is found in the ROADMAP, matched
 * to no directory, and reported as unstarted — so the UNGATED W021 false-fires
 * on `validate health` for any bracket repo whose STATE says milestone complete.
 * That scenario gets its own oracle below.
 *
 * W021 is deliberately reused rather than renumbered: W022 and W023 are both
 * taken upstream, and bug-557 pins W021 for the milestone-complete check. The
 * code is already a family of message shapes, so the bracket messages are
 * disambiguated by stem, not by a new code.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

let tmpDir;

function writeProject({ roadmap, convention, status = 'executing', phaseDirs = [] }) {
  const planning = path.join(tmpDir, '.planning');
  fs.writeFileSync(path.join(planning, 'ROADMAP.md'), roadmap, 'utf-8');
  fs.writeFileSync(
    path.join(planning, 'STATE.md'),
    ['---', 'gsd_state_version: 1.0', 'milestone: v2.0', 'milestone_name: Expansion',
      `status: ${status}`, '---', '', '# Project State', '', '**Phase:** 05', ''].join('\n'),
    'utf-8',
  );
  const config = convention === undefined ? {} : { phase_id_convention: convention };
  fs.writeFileSync(path.join(planning, 'config.json'), JSON.stringify(config), 'utf-8');
  const phasesDir = path.join(planning, 'phases');
  fs.mkdirSync(phasesDir, { recursive: true });
  for (const d of phaseDirs) fs.mkdirSync(path.join(phasesDir, d), { recursive: true });
}

function w021s() {
  const result = runGsdTools(['validate', 'health'], tmpDir);
  const out = JSON.parse(result.output);
  const all = [...(out.issues || []), ...(out.warnings || [])];
  return all.filter(i => i.code === 'W021').map(i => i.message);
}

const COHERENT = `# Roadmap

## [GSD.02] v2.0 — Expansion

### [GSD.02] 05: Real work
**Goal:** Build it

### [GSD.02] 06: Follow-up
**Goal:** Polish it
`;

// ─── RT0: the ungated milestone-complete W021 must not false-fire ──────────

describe('#612 PR-2 (RT0): bracket phases resolve to their dirs, so W021 stays silent', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-rt0-'); });
  afterEach(() => { cleanup(tmpDir); });

  test('milestone complete + every bracket phase on disk => NO W021', () => {
    writeProject({
      roadmap: COHERENT,
      convention: 'bracket',
      status: 'milestone complete',
      phaseDirs: ['GSD.02-05-real-work', 'GSD.02-06-follow-up'],
    });
    assert.deepEqual(
      w021s(), [],
      'a bracket phase whose directory exists must not read as unstarted',
    );
  });

  test('the same repo with a MISSING dir still fires — the check is not just disabled', () => {
    writeProject({
      roadmap: COHERENT,
      convention: 'bracket',
      status: 'milestone complete',
      phaseDirs: ['GSD.02-05-real-work'],
    });
    const messages = w021s();
    assert.equal(messages.length, 1, `expected exactly one W021, got ${JSON.stringify(messages)}`);
    assert.match(messages[0], /STATE says milestone complete but ROADMAP lists 1 unstarted phase/);
  });

  test('a MID-MIGRATION repo (bracket headings, convention not yet set) also resolves', () => {
    // The convention signal for the directory read comes from the heading that
    // produced the token, not from config — a `[CODE.MM]` bracket cannot occur
    // in a legacy ROADMAP. Without that, this repo shape would false-fire.
    writeProject({
      roadmap: COHERENT,
      convention: undefined,
      status: 'milestone complete',
      phaseDirs: ['GSD.02-05-real-work', 'GSD.02-06-follow-up'],
    });
    assert.deepEqual(w021s(), [], 'no convention set, but the headings are unambiguous');
  });

  test('a bracket SENTINEL heading is not reported as an unstarted phase', () => {
    writeProject({
      roadmap: `# Roadmap

## [GSD.02] v2.0

### [GSD.999] 01: Icebox item
**Goal:** Someday

### [GSD.02] 05: Real work
**Goal:** Build it
`,
      convention: 'bracket',
      status: 'milestone complete',
      phaseDirs: ['GSD.02-05-real-work'],
    });
    assert.deepEqual(w021s(), [], 'the icebox item has no directory and needs none');
  });

  test('legacy repos are unaffected: milestone complete + dirs present => silent', () => {
    writeProject({
      roadmap: `# Roadmap

## v2.0

### Phase 5: Real work
**Goal:** Build it
`,
      convention: undefined,
      status: 'milestone complete',
      phaseDirs: ['05-real-work'],
    });
    assert.deepEqual(w021s(), []);
  });
});

// ─── checkBracketCoherence: the gate ───────────────────────────────────────

describe('#612 PR-2: bracket-coherence is gated on the active convention', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-gate-'); });
  afterEach(() => { cleanup(tmpDir); });

  const INCOHERENT = `# Roadmap

## [GSD.02] v2.0 — Expansion

### [GSD.03] 05: Wrong milestone
**Goal:** Build it
`;

  test('fires under the bracket convention', () => {
    writeProject({ roadmap: INCOHERENT, convention: 'bracket' });
    const messages = w021s();
    assert.equal(messages.length, 1, JSON.stringify(messages));
    assert.match(messages[0], /bracket milestone 03 does not match its section milestone 02/);
  });

  test('SILENT when the convention is null', () => {
    writeProject({ roadmap: INCOHERENT, convention: undefined });
    assert.deepEqual(w021s(), [], 'a repo that never opted in must not be checked');
  });

  test('SILENT when the convention is milestone-prefixed', () => {
    writeProject({ roadmap: INCOHERENT, convention: 'milestone-prefixed' });
    assert.deepEqual(
      w021s().filter(m => /bracket/.test(m)), [],
      'the milestone-prefixed branch must not gain bracket findings',
    );
  });

  test('a coherent bracket roadmap is silent', () => {
    writeProject({ roadmap: COHERENT, convention: 'bracket' });
    assert.deepEqual(w021s(), []);
  });
});

// ─── checkBracketCoherence: the two sub-checks and their boundaries ─────────

describe('#612 PR-2: bracket-coherence sub-checks', () => {
  beforeEach(() => { tmpDir = createTempProject('adr-612-coh-'); });
  afterEach(() => { cleanup(tmpDir); });

  test('(2) a legacy-form phase heading under bracket is flagged', () => {
    writeProject({
      roadmap: `# Roadmap

## [GSD.02] v2.0

### Phase 5: Legacy form
**Goal:** Build it
`,
      convention: 'bracket',
    });
    const messages = w021s();
    assert.equal(messages.length, 1, JSON.stringify(messages));
    assert.match(messages[0], /heading is not in bracket form/);
    assert.match(messages[0], /\[CODE\.02\] 5:/, 'the fix hint names the expected form');
  });

  test('sentinel sections are exempt from both sub-checks', () => {
    writeProject({
      roadmap: `# Roadmap

## [GSD.999] Backlog

### Phase 1: Icebox in legacy form
**Goal:** Someday

### [GSD.02] 07: Wrong milestone but in an icebox section
**Goal:** Someday
`,
      convention: 'bracket',
    });
    assert.deepEqual(w021s(), [], 'a 999 section has no milestone to cohere with');
  });

  test('BOUNDARY: a flat, section-less bracket roadmap gets no checking', () => {
    // Conscious and pinned: without a `## [CODE.MM] Name` section there is
    // nothing to compare a phase bracket against, so presence checking is off.
    writeProject({
      roadmap: `# Roadmap

### [GSD.03] 05: No enclosing section
**Goal:** Build it

### Phase 6: Also legacy form
**Goal:** Build it
`,
      convention: 'bracket',
    });
    assert.deepEqual(w021s(), []);
  });

  test('a bracket example inside a fenced code block raises nothing', () => {
    writeProject({
      roadmap: `# Roadmap

## [GSD.02] v2.0

Docs for contributors:

\`\`\`markdown
### [GSD.09] 42: An example heading in docs
### Phase 7: A legacy example
\`\`\`

### [GSD.02] 05: Real work
**Goal:** Build it
`,
      convention: 'bracket',
    });
    assert.deepEqual(w021s(), [], 'tokenizeHeadings strips fenced blocks');
  });

  test('a table row or prose line containing "N:" raises nothing', () => {
    writeProject({
      roadmap: `# Roadmap

## [GSD.02] v2.0

| Phase | Plans |
| --- | --- |
| 05: Real work | 2 |

Note: see 12: the appendix for details.

### [GSD.02] 05: Real work
**Goal:** Build it
`,
      convention: 'bracket',
    });
    assert.deepEqual(w021s(), [], 'only real headings are considered');
  });

  test('a milestone section heading is not mistaken for a phase heading', () => {
    // If `### [GSD.02] 05:` were read as its own section, every phase would
    // self-coherently match and sub-check (1) would never fire.
    writeProject({
      roadmap: `# Roadmap

## [GSD.02] v2.0

### [GSD.03] 05: Wrong
**Goal:** a

### [GSD.04] 06: Also wrong
**Goal:** b
`,
      convention: 'bracket',
    });
    const messages = w021s();
    assert.equal(messages.length, 2, JSON.stringify(messages));
    assert.match(messages[0], /bracket milestone 03 does not match its section milestone 02/);
    assert.match(messages[1], /bracket milestone 04 does not match its section milestone 02/);
  });

  test('SECTION RESET: a legacy milestone heading closes the preceding bracket section', () => {
    // Regression: `sectionMilestone` used to persist across a non-bracket
    // section heading, so `### Phase 7:` under `## v3.0` was reported against
    // milestone 02 — "expected `[CODE.02] 7:`", naming a section the phase is
    // not in. A level-<=3 heading that is not phase-shaped must CLOSE the
    // previous section, not leave it in scope.
    writeProject({
      roadmap: `# Roadmap

## [GSD.02] v2.0

### [GSD.02] 05: Real
**Goal:** a

## v3.0 — Legacy milestone

### Phase 7: Legacy phase
**Goal:** b
`,
      convention: 'bracket',
    });
    assert.deepEqual(
      w021s(), [],
      'a phase outside any bracket section is out of scope, not mis-attributed',
    );
  });

  test('SECTION RESET: sentinel scope does not leak past its own section', () => {
    writeProject({
      roadmap: `# Roadmap

## [GSD.999] Backlog

### [GSD.999] 01: Icebox
**Goal:** a

## [GSD.02] v2.0

### [GSD.03] 07: Wrong milestone
**Goal:** b
`,
      convention: 'bracket',
    });
    const messages = w021s();
    assert.equal(messages.length, 1, JSON.stringify(messages));
    assert.match(
      messages[0], /bracket milestone 03 does not match its section milestone 02/,
      'the real section after a sentinel one must still be checked',
    );
  });

  test('a phase heading with an explicit Phase label inside a bracket is coherent', () => {
    writeProject({
      roadmap: `# Roadmap

## [GSD.02] v2.0

### [GSD.02] Phase 5: Labelled
**Goal:** Build it
`,
      convention: 'bracket',
    });
    assert.deepEqual(w021s(), []);
  });
});
