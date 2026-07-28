'use strict';

/**
 * PR-2 (#2761 / epic #612) — the single-owner heading + dir prefix sources that
 * every bracket-tolerant READER interpolates.
 *
 * PR-1 introduced `PHASE_HEADING_PREFIX_SRC` with zero production consumers.
 * PR-2 is its first consumer, and consuming it surfaced that the permissive
 * `\[[^\]]{1,200}\]\s*(?:Phase\s+)?` alternative admits NON-phase headings at
 * the letter-tolerant capture sites (validate.cts captures `[\w][\w.-]*`):
 * `## [v1.0] Overview:` would enter `roadmapPhases` as a phantom phase named
 * "Overview" on a repo that has never opted into the bracket convention. That
 * is a brand-new false positive on legacy input, so the source is tightened
 * here — before its first use, while it still has zero production callers.
 *
 * The contract this file locks, and the reason every reader can widen UNGATED:
 *
 *   PHASE_HEADING_PREFIX_SRC is a strict SUPERSET of the pre-existing upstream
 *   heading prefix `(?:\[[^\]]{1,200}\]\s*)?Phase\s+`, and the ONLY shape it
 *   newly admits is a `[CODE.MM]` bracket followed by a digit-leading token.
 *
 * Everything a legacy (null / milestone-prefixed) ROADMAP can contain therefore
 * reads byte-identically, because the newly-admitted shape cannot occur in one.
 *
 * L2 note: the superset property holds the OLD prefix as a LITERAL in this file
 * and generates its corpus from raw template primitives (heading level × prefix
 * form × padding × tag × colon). It is deliberately NOT seeded through the
 * exported constant or through renderPhaseId/toDir — a generator seeded by the
 * code under test proves only that the code agrees with itself.
 *
 * All assertions are BEHAVIORAL: compose the exported source into a RegExp and
 * assert what it matches. No source-grep.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const core = require('../gsd-core/bin/lib/phase-id.cjs');

// The pre-existing upstream heading prefix, held here as a LITERAL so the
// superset property is falsifiable. This is the exact fragment that is spelled
// inline at roadmap.cts / validate.cts / verify.cts on the base commit.
const LEGACY_HEADING_PREFIX_SRC = '(?:\\[[^\\]]{1,200}\\]\\s*)?Phase\\s+';

// The letter-tolerant capture class validate.cts uses. This is the class that
// makes a phantom phase possible at all — a digit-leading class (roadmap.cts,
// state.cts) cannot capture "Overview" no matter how loose the prefix is.
const LETTER_TOLERANT_TOKEN = '([\\w][\\w.-]*)';

const headingScanner = (prefixSrc, tokenSrc = LETTER_TOLERANT_TOKEN) =>
  new RegExp(`#{2,4}\\s*${prefixSrc}${tokenSrc}(?:\\s*\\([^)\\n]{0,200}\\))?\\s*:`, 'gi');

const scanTokens = (prefixSrc, doc, tokenSrc) => {
  const re = headingScanner(prefixSrc, tokenSrc);
  const out = [];
  let m;
  while ((m = re.exec(doc)) !== null) out.push(m[1]);
  return out;
};

// ─── The phantom-phase negative (the reason for the tightening) ─────────────

describe('#612 PR-2: the widened heading prefix admits no phantom phase on legacy input', () => {
  // A legacy ROADMAP corpus containing bracket-shaped headings that are NOT
  // phase headings. None of these may become a phase.
  const LEGACY_DOC = [
    '## [Cluster B] Overview:',
    '### Phase 5: Real',
    '### [GSD] Phase 2-01: Legacy bracket + Phase label',
    '#### Phase Details:',
    '## [v1.0] Overview:',
    '## [RFC.7] Discussion:',
  ].join('\n');

  test('legacy capture set is byte-identical before and after the widening', () => {
    const before = scanTokens(LEGACY_HEADING_PREFIX_SRC, LEGACY_DOC);
    const after = scanTokens(core.PHASE_HEADING_PREFIX_SRC, LEGACY_DOC);
    assert.deepEqual(after, before, 'a legacy ROADMAP must read identically after the widening');
    assert.deepEqual(before, ['5', '2-01', 'Details'], 'pinned legacy capture set');
  });

  test('a CODE.MM-shaped bracket followed by a WORD is not a phase heading', () => {
    // `## [v1.0] Overview:` is the killer input: `[A-Z][A-Z0-9_]*\.\d+` matches
    // `v1.0` under the /i flag every reader uses, so a bracket-shape check alone
    // is not enough — the token after the bracket must be digit-leading.
    const tokens = scanTokens(core.PHASE_HEADING_PREFIX_SRC, '## [v1.0] Overview:');
    assert.deepEqual(tokens, [], 'no phantom phase');
  });

  test('a CODE.MM-shaped bracket followed by a DIGIT is a phase heading', () => {
    const tokens = scanTokens(core.PHASE_HEADING_PREFIX_SRC, '### [GSD.02] 05: Bracket phase');
    assert.deepEqual(tokens, ['05']);
  });

  test('the bracket branch still accepts an explicit Phase label after the bracket', () => {
    const tokens = scanTokens(core.PHASE_HEADING_PREFIX_SRC, '### [GSD.02] Phase 5: Titled');
    assert.deepEqual(tokens, ['5']);
  });
});

// ─── The superset property (L2: old prefix is a literal, corpus is raw) ─────

describe('#612 PR-2: PHASE_HEADING_PREFIX_SRC is a strict superset of the legacy prefix', () => {
  // Raw template primitives. NOTHING here is produced by renderPhaseId/toDir.
  const levelArb = fc.constantFrom('##', '###', '####');
  const bracketArb = fc.constantFrom(
    '', '[GSD] ', '[GSD.02] ', '[Cluster B] ', '[v1.0] ', '[GSD_X2.100] ',
    '[ck.7] ', '[GSD.999] ', '[GSD.00] ', '[GSD.02]', '[GSD.02]  ',
  );
  const labelArb = fc.constantFrom('Phase ', '');
  const tokenArb = fc.constantFrom(
    '5', '05', '2-01', '02-01', '12A', '05.03', '117', '999', '0',
    'Overview', 'Details', '2024',
  );
  const tagArb = fc.constantFrom('', ' (INSERTED)', '(x)');
  const tailArb = fc.constantFrom(':', ': Name', '');

  const headingArb = fc
    .tuple(levelArb, bracketArb, labelArb, tokenArb, tagArb, tailArb)
    .map(([lvl, br, lab, tok, tag, tail]) => `${lvl} ${br}${lab}${tok}${tag}${tail}`);

  test('every heading the legacy prefix matched, the new prefix matches identically', () => {
    fc.assert(
      fc.property(headingArb, (heading) => {
        const before = scanTokens(LEGACY_HEADING_PREFIX_SRC, heading);
        if (before.length === 0) return true; // superset says nothing about non-matches
        const after = scanTokens(core.PHASE_HEADING_PREFIX_SRC, heading);
        assert.deepEqual(after, before, `legacy match changed for: ${JSON.stringify(heading)}`);
        return true;
      }),
      { numRuns: 2000 },
    );
  });

  test('the ONLY newly-admitted shape is a CODE.MM bracket + digit-leading token', () => {
    fc.assert(
      fc.property(headingArb, (heading) => {
        const before = scanTokens(LEGACY_HEADING_PREFIX_SRC, heading);
        const after = scanTokens(core.PHASE_HEADING_PREFIX_SRC, heading);
        if (after.length === before.length) return true;
        // Something new matched. It must be a `[CODE.MM]` bracket whose next
        // non-space character is a digit (or which carries a `Phase ` label).
        assert.match(
          heading,
          /\[[A-Za-z][A-Za-z0-9_]*\.\d+\]\s*(?:Phase\s+)?\d/,
          `unexpected newly-admitted shape: ${JSON.stringify(heading)}`,
        );
        return true;
      }),
      { numRuns: 2000 },
    );
  });
});

// ─── L3 deterministic boundary pinning (hand-written literals) ──────────────

describe('#612 PR-2: heading-prefix boundaries', () => {
  const matches = (heading) => scanTokens(core.PHASE_HEADING_PREFIX_SRC, heading);

  test('heading levels track the pre-existing scanner shape exactly', () => {
    assert.deepEqual(matches('# [GSD.02] 05:'), [], 'h1 is below the #{2,4} floor');
    assert.deepEqual(matches('## [GSD.02] 05:'), ['05']);
    assert.deepEqual(matches('### [GSD.02] 05:'), ['05']);
    assert.deepEqual(matches('#### [GSD.02] 05:'), ['05']);
    // h5+ DOES match: `#{2,4}` is unanchored in every upstream scanner, so it
    // simply consumes the trailing 4 of 5 hashes. Pinned as parity with the
    // legacy prefix rather than "fixed" — changing it would alter legacy reads.
    assert.deepEqual(matches('##### [GSD.02] 05:'), ['05'], 'h5 matches (unanchored #{2,4})');
    assert.deepEqual(
      matches('##### Phase 5:'),
      scanTokens(LEGACY_HEADING_PREFIX_SRC, '##### Phase 5:'),
      'h5 behaviour is identical to the legacy prefix',
    );
  });

  test('spacing between the bracket and the token', () => {
    assert.deepEqual(matches('### [GSD.02]05:'), ['05'], 'no space');
    assert.deepEqual(matches('### [GSD.02] 05:'), ['05'], 'one space');
    assert.deepEqual(matches('### [GSD.02]  05:'), ['05'], 'two spaces');
  });

  test('sentinel milestones and their neighbours are all RECOGNISED here', () => {
    // Recognition is not filtering: the source admits sentinel brackets so the
    // reader can SEE them and route them through isSentinelPhaseId. Dropping
    // them at the regex level would make the sentinel invisible instead of
    // excluded, which is how the #1445 bug class reopens.
    for (const mm of ['00', '01', '998', '999', '1000']) {
      assert.deepEqual(matches(`### [GSD.${mm}] 05:`), ['05'], `milestone ${mm} recognised`);
    }
  });

  test('bracket content length bound is 200 (the ReDoS parity bound)', () => {
    // The legacy any-bracket alternative is bounded at 200 chars; at 201 it no
    // longer matches. The CODE.MM alternative is bounded by its own grammar.
    const at200 = 'x'.repeat(200);
    const at201 = 'x'.repeat(201);
    assert.deepEqual(matches(`### [${at200}] Phase 5:`), ['5'], '200-char bracket matches');
    assert.deepEqual(matches(`### [${at201}] Phase 5:`), [], '201-char bracket does not');
  });

  test('lowercase project code is admitted under the /i flag every reader uses', () => {
    assert.deepEqual(matches('### [ck.01] 12:'), ['12']);
  });

  test('3-digit milestone integers are admitted', () => {
    assert.deepEqual(matches('### [GSD_X2.100] 05:'), ['05']);
  });

  test('CRLF line endings do not break recognition', () => {
    assert.deepEqual(matches('### [GSD.02] 05: Name\r\n### [GSD.02] 06: Other\r\n'), ['05', '06']);
  });

  test('ACCEPTED-and-disclosed: a digit-leading word after a bracket reads as a phase', () => {
    // `## [GSD.02] 2024:` is string-indistinguishable from a real phase 2024.
    // The identical tolerance already exists on the legacy `Phase ` branch
    // (`## Phase 2024:`), so this is not a new class of imprecision — it is the
    // pre-existing one, reached through a new spelling. Pinned so nobody later
    // claims "no non-phase heading can match".
    assert.deepEqual(matches('## [GSD.02] 2024:'), ['2024']);
    assert.deepEqual(matches('## Phase 2024:'), ['2024']);
  });

  test('a bare number is still not a phase-heading intro', () => {
    assert.deepEqual(matches('### 05: Title'), []);
  });
});

// ─── The capturing variant's group contract ─────────────────────────────────

describe('#612 PR-2: BRACKET_ID_HEADING_PREFIX_CAPTURING_SRC group contract', () => {
  // Readers that filter sentinels need the bracket's `CODE.MM` OUT of the match
  // (READING-B: under bracket the sentinel lives in the bracket, not in the
  // phase token). The capturing variant adds EXACTLY ONE group, at position 1,
  // ahead of any group the call site appends.
  const re = () =>
    new RegExp(
      `#{2,4}\\s*${core.PHASE_HEADING_PREFIX_CAPTURING_SRC}${LETTER_TOLERANT_TOKEN}\\s*:`,
      'i',
    );

  test('group 1 is the bracket id, group 2 the phase token', () => {
    const m = '### [GSD.999] 01: Icebox'.match(re());
    assert.equal(m[1], 'GSD.999');
    assert.equal(m[2], '01');
  });

  test('group 1 is undefined on the legacy branches, group 2 still the token', () => {
    const legacy = '### Phase 5: Real'.match(re());
    assert.equal(legacy[1], undefined, 'no bracket captured');
    assert.equal(legacy[2], '5');

    const anyBracket = '### [GSD] Phase 2-01: Legacy'.match(re());
    assert.equal(anyBracket[1], undefined, 'an any-content bracket is not a bracket ID');
    assert.equal(anyBracket[2], '2-01');
  });

  test('the capturing and non-capturing variants accept exactly the same strings', () => {
    const corpus = [
      '### [GSD.02] 05:', '### Phase 5:', '### [GSD] Phase 2-01:', '## [v1.0] Overview:',
      '#### Phase Details:', '### [GSD.999] 01:', '### 05:', '### [Cluster B] Overview:',
      '### [GSD.02] Phase 5:', '### [GSD.02]05:', '## [GSD.02] 2024:',
    ];
    for (const line of corpus) {
      const plain = scanTokens(core.PHASE_HEADING_PREFIX_SRC, line);
      const cap = [];
      const capRe = new RegExp(
        `#{2,4}\\s*${core.PHASE_HEADING_PREFIX_CAPTURING_SRC}${LETTER_TOLERANT_TOKEN}(?:\\s*\\([^)\\n]{0,200}\\))?\\s*:`,
        'gi',
      );
      let m;
      while ((m = capRe.exec(line)) !== null) cap.push(m[2]);
      assert.deepEqual(cap, plain, `variants diverged on ${JSON.stringify(line)}`);
    }
  });

  test('the captured bracket id routes cleanly into isSentinelPhaseId', () => {
    const sentinel = '### [GSD.999] 01: Icebox'.match(re());
    assert.equal(core.isSentinelPhaseId(sentinel[1], 'bracket'), true);
    const zero = '### [GSD.00] 01: Pre-milestone'.match(re());
    assert.equal(core.isSentinelPhaseId(zero[1], 'bracket'), true);
    const real = '### [GSD.02] 05: Real'.match(re());
    assert.equal(core.isSentinelPhaseId(real[1], 'bracket'), false);
  });
});

// ─── BRACKET_DIR_PREFIX_SRC ─────────────────────────────────────────────────

describe('#612 PR-2: BRACKET_DIR_PREFIX_SRC', () => {
  const re = () => new RegExp(`^(?:${core.BRACKET_DIR_PREFIX_SRC})`, 'i');

  test('matches the `{CODE}.{MM}-` dir prefix toDir emits', () => {
    assert.ok(re().test('GSD.02-05-feature'));
    assert.ok(re().test('CK.01-12.04-feature'));
    assert.ok(re().test('GSD_X2.100-05-feature'));
  });

  test('does not match legacy dir forms', () => {
    assert.ok(!re().test('02-01-setup'), 'milestone-prefixed');
    assert.ok(!re().test('01-setup'), 'plain numeric');
    assert.ok(!re().test('GSD-02-01-setup'), 'project-code-prefixed');
  });

  test('requires a >=2-digit milestone, so the 1-digit legacy family is excluded', () => {
    // `P0.3-2` (#1324/#2043) must not read as a bracket dir prefix.
    assert.ok(!re().test('P0.3-2-x'));
  });
});

// ─── bracketQualifiedKey + phaseTokenMatches (the dir-resolution half) ──────

describe('#612 PR-2: bracketQualifiedKey is convention-gated', () => {
  test('returns null without an explicit bracket convention', () => {
    // `{CODE}.{MM}-{PP}` is string-INDISTINGUISHABLE from the legacy #1324/#2043
    // letter-prefixed-decimal family whenever the code ends in a digit. An
    // ungated qualified key silently widens matching on legacy repos: it is
    // padding-INsensitive (parseInt per segment) where the legacy token path is
    // padding-sensitive, so `P0.3-2` would newly match dir `P0.03-02-tenant`.
    for (const id of ['P0.3-2', 'P0.12-34-name', 'X9.9-9-name', 'CK.03-02']) {
      assert.equal(core.bracketQualifiedKey(id), null, `${id} must be null when unconventioned`);
      assert.equal(core.bracketQualifiedKey(id, 'milestone-prefixed'), null);
      assert.equal(core.bracketQualifiedKey(id, null), null);
    }
  });

  test('lifts the milestone out of the prefix under the bracket convention', () => {
    assert.equal(core.bracketQualifiedKey('CK.03-02', 'bracket'), 'CK.3-2');
    assert.equal(core.bracketQualifiedKey('CK.03-02.01', 'bracket'), 'CK.3-2.1');
    assert.equal(core.bracketQualifiedKey('CK.03-02-shared-shell', 'bracket'), 'CK.3-2');
  });

  test('returns null for UNQUALIFIED ids even under bracket', () => {
    for (const id of ['02', '11.01', 'HQ-11', '2-01']) {
      assert.equal(core.bracketQualifiedKey(id, 'bracket'), null, id);
    }
  });
});

describe('#612 PR-2: phaseTokenMatches bracket branch', () => {
  test('legacy behaviour is byte-identical when no convention is passed', () => {
    // The #2043 numeric-tail family: these must keep answering exactly as today.
    assert.equal(core.phaseTokenMatches('P0.03-02-tenant', 'P0.3-2'), false);
    assert.equal(core.phaseTokenMatches('P0.3-2-x', 'P0.03-002'), false);
    assert.equal(core.phaseTokenMatches('02-01-setup', '02-01'), true);
    assert.equal(core.phaseTokenMatches('01-setup', '01'), true);
    assert.equal(core.phaseTokenMatches('GSD.02-05-feature', '05'), false,
      'a bracket dir does not resolve without the convention signal');
  });

  test('a milestone-qualified query resolves to its OWN milestone dir', () => {
    assert.equal(core.phaseTokenMatches('CK.03-02-shell', 'CK.03-02', 'bracket'), true);
    assert.equal(core.phaseTokenMatches('CK.02-02-other', 'CK.03-02', 'bracket'), false,
      'must not resolve to the first same-numbered dir of another milestone');
  });

  test('a bare phase token resolves against a bracket dir under the convention', () => {
    // This is the RT0 path: the ROADMAP heading `### [GSD.02] 05:` yields token
    // `05`, which must find dir `GSD.02-05-feature`.
    assert.equal(core.phaseTokenMatches('GSD.02-05-feature', '05', 'bracket'), true);
    assert.equal(core.phaseTokenMatches('GSD.02-05.03-feature', '05.03', 'bracket'), true);
    assert.equal(core.phaseTokenMatches('GSD.02-05-feature', '06', 'bracket'), false);
  });

  test('legacy dirs still resolve on a bracket repo (migration window)', () => {
    assert.equal(core.phaseTokenMatches('02-01-setup', '02-01', 'bracket'), true);
    assert.equal(core.phaseTokenMatches('01-setup', '01', 'bracket'), true);
  });
});

describe('#612 PR-2: roadmapPhaseLookupSources bracket source', () => {
  test('legacy source lists are byte-identical (ordering included)', () => {
    for (const q of ['5', '05', '2-01', 'PROJ-42', 'P0.3-2', '117']) {
      assert.deepEqual(
        core.roadmapPhaseLookupSources(q, 'bracket'),
        core.roadmapPhaseLookupSources(q),
        `unqualified query ${q} must produce the same sources under any convention`,
      );
    }
  });

  test('#2114 precedence is preserved: bare numeric still precedes prefix-tolerant', () => {
    const sources = core.roadmapPhaseLookupSources('117');
    const bare = sources.indexOf('0*117');
    const prefixed = sources.findIndex((s) => s.startsWith('(?:[A-Z][A-Z0-9_]*-)?'));
    assert.ok(bare !== -1 && prefixed !== -1, 'both sources present');
    assert.ok(bare < prefixed, 'bare numeric must precede the prefix-tolerant form');
  });

  test('a bracket-qualified query gains a bare-token source, APPENDED LAST', () => {
    const sources = core.roadmapPhaseLookupSources('GSD.02-05', 'bracket');
    const legacy = core.roadmapPhaseLookupSources('GSD.02-05');
    assert.deepEqual(
      sources.slice(0, legacy.length), legacy,
      'the pre-existing sources keep their exact order and position',
    );
    assert.equal(sources.length, legacy.length + 1, 'exactly one source added');
    assert.equal(sources[sources.length - 1], '0*5', 'bare phase token, padding-tolerant');
  });

  test('the bracket source is GATED — a legacy query never gains it', () => {
    // Ungated, `P0.3-2` would gain a `0*2` source and newly resolve `### Phase 2:`.
    assert.deepEqual(
      core.roadmapPhaseLookupSources('P0.3-2', 'bracket'),
      core.roadmapPhaseLookupSources('P0.3-2'),
      'the 1-digit-milestone legacy family is not bracket-qualified',
    );
  });

  test('the added source resolves a bracket heading when composed with the prefix', () => {
    const doc = '### [GSD.02] 05: Real work\n';
    const sources = core.roadmapPhaseLookupSources('GSD.02-05', 'bracket');
    const last = sources[sources.length - 1];
    const re = new RegExp(`^${core.PHASE_HEADING_PREFIX_SRC}${last}\\s*:\\s*(.+)$`, 'i');
    assert.ok(re.test('[GSD.02] 05: Real work'), 'heading text resolves');
    assert.ok(doc.includes('[GSD.02] 05'));
  });
});

// ─── The minimal-additive variant (for BARE `Phase\s+` sites) ───────────────

describe('#612 PR-2: BRACKET_OR_PHASE_LABEL_PREFIX_SRC is minimal-additive', () => {
  // Several read sites (the checklist / bullet matchers) spell a BARE `Phase\s+`
  // with no bracket tolerance at all. Giving them the full heading grammar would
  // RETRO-GRANT the any-bracket tolerance they never had — a legacy behaviour
  // change wearing the costume of a bracket feature.
  const scan = (prefixSrc, doc) => {
    const re = new RegExp(`-\\s*\\[[ x]\\]\\s*\\*{0,2}${prefixSrc}([\\w][\\w.-]*)\\s*:`, 'gi');
    const out = [];
    let m;
    while ((m = re.exec(doc)) !== null) out.push(m[1]);
    return out;
  };
  const BARE = 'Phase\\s+';

  test('admits the bracket ID form', () => {
    assert.deepEqual(scan(core.BRACKET_OR_PHASE_LABEL_PREFIX_SRC, '- [ ] **[GSD.02] 05: X**'), ['05']);
  });

  test('does NOT admit the any-content bracket form the site never had', () => {
    const doc = '- [x] **[GSD] Phase 2-01: Legacy**';
    assert.deepEqual(scan(BARE, doc), [], 'precondition: unmatched today');
    assert.deepEqual(
      scan(core.BRACKET_OR_PHASE_LABEL_PREFIX_SRC, doc), [],
      'minimal-additive must not retro-grant any-bracket tolerance',
    );
    assert.deepEqual(
      scan(core.PHASE_HEADING_PREFIX_SRC, doc), ['2-01'],
      'the FULL grammar would have — which is why these sites must not use it',
    );
  });

  test('the bare `Phase` label branch is byte-identical', () => {
    for (const doc of ['- [ ] **Phase 5: Name**', '- [x] **Phase 12A: Hotfix**', '- [ ] Phase 2-01: API']) {
      assert.deepEqual(
        scan(core.BRACKET_OR_PHASE_LABEL_PREFIX_SRC, doc), scan(BARE, doc), doc,
      );
    }
  });

  test('the capturing twin adds one group at position 1, same accepted language', () => {
    const re = new RegExp(
      `-\\s*\\[[ x]\\]\\s*\\*{0,2}${core.BRACKET_OR_PHASE_LABEL_PREFIX_CAPTURING_SRC}([\\w][\\w.-]*)\\s*:`,
      'i',
    );
    const bracket = '- [ ] **[GSD.999] 01: Icebox**'.match(re);
    assert.equal(bracket[1], 'GSD.999');
    assert.equal(bracket[2], '01');
    const legacy = '- [ ] **Phase 5: Name**'.match(re);
    assert.equal(legacy[1], undefined);
    assert.equal(legacy[2], '5');
  });
});
