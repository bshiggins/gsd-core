'use strict';

/**
 * ADR-612 PR-3 bracket migrator acceptance tests.
 *
 * These tests copy committed real-layout fixture trees into temporary Git
 * repositories and drive the compiled gsd-tools command. The router and the
 * migrator are intentionally not stubbed: dry-run, dirty-tree refusal,
 * rollback, and idempotence are command-boundary contracts.
 *
 * One exception: the config-write-failure rollback test below calls
 * computeMigrationPlan()/applyMigration() directly (in-process) instead of
 * through the CLI. #4698 Blocker 1 — a chmod-based injection there would be
 * vacuous under the uid-0 `gsd-test` Docker bench (root's own write is not
 * blocked by a 0o444 mode bit), and a mock.method() interception installed
 * from this parent process is invisible to a spawned child process (see
 * tests/broken-windows.test.cjs's #1950-H2 note, and the identical in-process
 * pattern this file's sibling tests/roadmap-upgrade.test.cjs already uses for
 * the milestone-prefixed convention's own config-write rollback test).
 */

const { describe, test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const helpers = require('./helpers.cjs');
const { cleanup, TOOLS_PATH } = helpers;
const { runNode, OUTCOME } = require('./helpers/process-seam.cjs');
const { gitOrThrow } = require('./helpers/git-fixture.cjs');
const { computeMigrationPlan, applyMigration } = require('../gsd-core/bin/lib/roadmap-upgrade.cjs');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'roadmap-upgrade-bracket');
const COMMAND_TIMEOUT_MS = 60000;
const tempRoots = [];

afterEach(() => {
  while (tempRoots.length > 0) cleanup(tempRoots.pop());
});

function materializeFixture(name) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `gsd-bracket-${name}-`));
  tempRoots.push(cwd);
  fs.cpSync(path.join(FIXTURE_ROOT, name, 'planning'), path.join(cwd, '.planning'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.planning/\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Fixture repository\n', 'utf8');

  gitOrThrow(['init', '--quiet'], { cwd });
  gitOrThrow(['config', 'user.email', 'fixture@example.invalid'], { cwd });
  gitOrThrow(['config', 'user.name', 'Fixture Author'], { cwd });
  gitOrThrow(['add', '.gitignore', 'README.md'], { cwd });
  gitOrThrow(['commit', '--quiet', '-m', 'fixture baseline'], { cwd });
  return cwd;
}

function runBracketUpgrade(cwd, extraArgs = []) {
  return runNode(
    [TOOLS_PATH, 'roadmap', 'upgrade', '--convention', 'bracket', ...extraArgs],
    {
      cwd,
      env: {
        ...process.env,
        ...helpers.TEST_ENV_BASE,
        HOME: cwd,
      },
      timeoutMs: COMMAND_TIMEOUT_MS,
    },
  );
}

function assertExited(result, exitCode, context) {
  assert.equal(result.outcome, OUTCOME.EXITED, `${context}: ${result.outcome}`);
  assert.equal(
    result.exitCode,
    exitCode,
    `${context}: expected exit ${exitCode}; stdout=${result.stdout}; stderr=${result.stderr}`,
  );
}

function parseDryRun(result, context) {
  assertExited(result, 0, context);
  assert.match(result.stderr, /Bracket phase-ID convention/);
  assert.match(result.stderr, /\[GSD\.02\] 05\.03-01/);
  return JSON.parse(result.stdout);
}

function snapshotTree(root, options = {}) {
  const skipGit = options.skipGit === true;
  const snapshot = [];

  function walk(current, relative) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .filter((entry) => !(skipGit && relative === '' && entry.name === '.git'))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        snapshot.push({ path: relPath, type: 'directory' });
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        snapshot.push({
          path: relPath,
          type: 'file',
          bytes: fs.readFileSync(fullPath).toString('base64'),
        });
      } else if (entry.isSymbolicLink()) {
        snapshot.push({ path: relPath, type: 'symlink', target: fs.readlinkSync(fullPath) });
      }
    }
  }

  walk(root, '');
  return snapshot;
}

function phaseDirs(cwd) {
  return fs.readdirSync(path.join(cwd, '.planning', 'phases'))
    .filter((entry) => fs.statSync(path.join(cwd, '.planning', 'phases', entry)).isDirectory())
    .sort();
}

describe('roadmap upgrade --convention bracket', () => {
  test('legacy → bracket dry-run reports the plan, prints the card, and writes zero bytes', () => {
    const cwd = materializeFixture('legacy-multi-milestone');
    const before = snapshotTree(cwd, { skipGit: true });

    const plan = parseDryRun(runBracketUpgrade(cwd), 'legacy bracket dry-run');

    assert.equal(plan.alreadyMigrated, false);
    assert.equal(plan.targetConvention, 'bracket');
    assert.deepEqual(
      plan.phases.map(({ oldDir, newDir }) => ({ oldDir, newDir })),
      [
        { oldDir: '01-alpha', newDir: 'GSD.01-01-alpha' },
        { oldDir: '02.1-beta', newDir: 'GSD.01-02-beta' },
        { oldDir: '03-gamma', newDir: 'GSD.02-01-gamma' },
      ],
    );
    assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'dry-run must write nothing');
  });

  test('M-NN → bracket preserves the milestone and lifts deep integer segments', () => {
    const cwd = materializeFixture('mnn-multi-milestone');

    const plan = parseDryRun(runBracketUpgrade(cwd), 'M-NN bracket dry-run');

    assert.deepEqual(
      plan.phases.map(({ oldDir, newDir }) => ({ oldDir, newDir })),
      [
        { oldDir: 'GSD-02-01-foundation', newDir: 'GSD.02-01-foundation' },
        { oldDir: 'GSD-02-04-01-deep-slice', newDir: 'GSD.02-04.01-deep-slice' },
      ],
    );
    assert.ok(
      plan.roadmapEdits.some(({ to }) => to === '### [GSD.02] 04.01: Deep slice'),
      'M-NN 2-04-01 must become bracket token 04.01',
    );
  });

  test('project-prefixed single-milestone layouts derive the STATE milestone instead of no-oping', () => {
    const cwd = materializeFixture('project-prefixed-single-milestone');

    const plan = parseDryRun(runBracketUpgrade(cwd), 'single-milestone bracket dry-run');

    assert.equal(plan.alreadyMigrated, false);
    assert.deepEqual(
      plan.phases.map(({ newDir }) => newDir),
      ['HQ.01-01-intake', 'HQ.01-02-delivery'],
    );
  });

  test('refuses a legacy tree whose milestone cannot be derived instead of marking it bracket', () => {
    const cwd = materializeFixture('project-prefixed-single-milestone');
    fs.unlinkSync(path.join(cwd, '.planning', 'STATE.md'));
    const before = snapshotTree(cwd, { skipGit: true });

    const result = runBracketUpgrade(cwd);

    assertExited(result, 1, 'missing milestone source');
    assert.match(result.stderr, /Cannot determine a milestone/);
    assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'refusal must write nothing');
  });

  test('hard-refuses a bracket migration without project_code and writes zero bytes', () => {
    const cwd = materializeFixture('legacy-multi-milestone');
    const configPath = path.join(cwd, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    delete config.project_code;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const before = snapshotTree(cwd, { skipGit: true });

    const result = runBracketUpgrade(cwd);

    assertExited(result, 1, 'missing project_code');
    assert.match(result.stderr, /without a project_code/);
    assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'refusal must write nothing');
  });

  test('hard-refuses a non-canonical project_code before planning any writes', () => {
    const cwd = materializeFixture('legacy-multi-milestone');
    const configPath = path.join(cwd, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.project_code = 'bad-code';
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const before = snapshotTree(cwd, { skipGit: true });

    const result = runBracketUpgrade(cwd);

    assertExited(result, 1, 'invalid project_code');
    assert.match(result.stderr, /invalid project_code/);
    assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'refusal must write nothing');
  });

  test('preserves the v999 sentinel milestone in the bracket identity', () => {
    const cwd = materializeFixture('legacy-multi-milestone');
    fs.writeFileSync(
      path.join(cwd, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n## v999.0 — Backlog\n\n### Phase 1: Someday\n',
      'utf8',
    );

    const plan = parseDryRun(runBracketUpgrade(cwd), 'sentinel milestone dry-run');

    assert.ok(
      plan.roadmapEdits.some(({ to }) => to === '### [GSD.999] 01: Someday'),
      'v999 must remain milestone 999 rather than being skipped or truncated',
    );
    assert.ok(
      plan.phases.some(({ oldDir, newDir }) => oldDir === '01-alpha' && newDir === 'GSD.999-01-alpha'),
      'the directory prefix must carry the same sentinel milestone',
    );
  });

  test('sanitizes a hostile legacy directory slug through the canonical emitter', () => {
    const cwd = materializeFixture('legacy-multi-milestone');
    const phasesPath = path.join(cwd, '.planning', 'phases');
    fs.renameSync(
      path.join(phasesPath, '01-alpha'),
      path.join(phasesPath, '01-..-..-etc'),
    );

    const plan = parseDryRun(runBracketUpgrade(cwd), 'hostile slug dry-run');
    const rename = plan.phases.find(({ oldDir }) => oldDir === '01-..-..-etc');

    assert.ok(rename, 'the hostile source directory must still be matched');
    assert.equal(rename.newDir, path.basename(rename.newDir), 'the target must remain one path segment');
    assert.doesNotMatch(rename.newDir, /\.\./, 'the target must not retain traversal tokens');
  });

  test('names the phase and legacy directory when a bracket slug cannot be emitted', () => {
    const cwd = materializeFixture('legacy-multi-milestone');
    const phasesPath = path.join(cwd, '.planning', 'phases');
    fs.renameSync(
      path.join(phasesPath, '01-alpha'),
      path.join(phasesPath, '01-2026'),
    );
    const before = snapshotTree(cwd, { skipGit: true });

    const result = runBracketUpgrade(cwd);

    assertExited(result, 1, 'all-digit bracket slug');
    assert.match(
      result.stderr,
      /Cannot build bracket directory for phase "1" from source directory "01-2026"/,
    );
    assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'dry-run refusal must write nothing');
  });

  test('apply refuses a dirty tracked working tree before mutating the ignored planning tree', () => {
    const cwd = materializeFixture('legacy-multi-milestone');
    fs.appendFileSync(path.join(cwd, 'README.md'), '\ndirty\n', 'utf8');
    const before = snapshotTree(cwd, { skipGit: true });

    const result = runBracketUpgrade(cwd, ['--apply']);

    assertExited(result, 1, 'dirty-tree refusal');
    assert.match(result.stderr, /Working tree is dirty/);
    assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'dirty refusal must precede mutation');
  });

  test('apply keeps renamed directories, ROADMAP headings/checklists, and config consistent', () => {
    const cwd = materializeFixture('legacy-multi-milestone');

    const result = runBracketUpgrade(cwd, ['--apply']);

    assertExited(result, 0, 'legacy bracket apply');
    assert.match(result.stderr, /Bracket phase-ID convention/);
    const dirs = phaseDirs(cwd);
    const expectedIds = ['GSD.01-01', 'GSD.01-02', 'GSD.02-01'];
    assert.deepEqual(
      dirs,
      ['GSD.01-01-alpha', 'GSD.01-02-beta', 'GSD.02-01-gamma'],
    );

    const roadmap = fs.readFileSync(path.join(cwd, '.planning', 'ROADMAP.md'), 'utf8');
    const headingIds = [...roadmap.matchAll(/^### \[([^\]\r\n]{1,200})\] ([^:\r\n]{1,200}):/gm)]
      .map((match) => `${match[1]}-${match[2]}`);
    assert.deepEqual(headingIds, expectedIds);
    assert.ok(
      headingIds.every((id) => dirs.some((dir) => dir.startsWith(`${id}-`))),
      'every migrated ROADMAP heading must have a matching directory identity',
    );
    assert.match(roadmap, /- \[ \] \*\*\[GSD\.01\] 01:\*\* Alpha/);
    assert.match(roadmap, /- \[x\] \[GSD\.02\] 01: Gamma/);

    const config = JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8'));
    assert.equal(config.phase_id_convention, 'bracket');
  });

  test('a mid-migration rename failure restores an ignored planning tree byte-for-byte', () => {
    const cwd = materializeFixture('legacy-multi-milestone');
    const dryRunPlan = parseDryRun(runBracketUpgrade(cwd), 'rollback setup dry-run');
    assert.ok(dryRunPlan.phases.length >= 2, 'fixture must provide a rename before the failing rename');
    const occupiedTarget = path.join(cwd, '.planning', 'phases', dryRunPlan.phases[1].newDir);
    fs.mkdirSync(occupiedTarget, { recursive: true });
    fs.writeFileSync(path.join(occupiedTarget, 'occupied.txt'), 'do not overwrite\n', 'utf8');
    const before = snapshotTree(path.join(cwd, '.planning'));

    const result = runBracketUpgrade(cwd, ['--apply']);

    assertExited(result, 1, 'mid-migration rollback');
    assert.match(result.stderr, /Migration failed and rolled back/);
    assert.deepEqual(
      snapshotTree(path.join(cwd, '.planning')),
      before,
      'ignored planning tree must be byte-restored after rollback',
    );
  });

  test('a config write failure restores renamed directories and ROADMAP bytes', (t) => {
    const cwd = materializeFixture('legacy-multi-milestone');
    const planningPath = path.join(cwd, '.planning');
    const configPath = path.join(planningPath, 'config.json');

    const plan = computeMigrationPlan(cwd, { convention: 'bracket' });
    assert.equal(plan.alreadyMigrated, false);
    assert.ok(plan.phases.length >= 1, 'fixture must produce phase renames');
    assert.ok(plan.roadmapEdits.length >= 1, 'fixture must produce roadmap edits');

    const before = snapshotTree(planningPath);

    // uid-independent fault injection: a JS-level function replacement throws
    // for every caller regardless of uid, filesystem, or capabilities — unlike
    // fs.chmodSync(configPath, 0o444), which the uid-0 gsd-test Docker bench's
    // own write bypasses entirely (see file header note).
    const realWrite = fs.writeFileSync;
    const writeMock = mock.method(fs, 'writeFileSync', (target, data, opts) => {
      if (path.resolve(String(target)) === configPath) {
        throw Object.assign(
          new Error(`EACCES: permission denied, open '${configPath}'`),
          { code: 'EACCES' },
        );
      }
      return realWrite.call(fs, target, data, opts);
    });
    t.after(() => writeMock.mock.restore());

    // Probe: the injection must actually block a write to this exact path
    // before trusting it to exercise the rollback branch below. A probe that
    // unexpectedly succeeds (e.g. a path-matching bug in the mock above) must
    // fail the test loudly, never let the migration proceed "successfully"
    // and pass with zero rollback coverage.
    assert.throws(
      () => fs.writeFileSync(configPath, 'probe'),
      /EACCES/,
      'fault-injection probe unexpectedly wrote to config.json — refusing to trust this run',
    );

    let caught;
    try {
      applyMigration(cwd, plan, { dryRun: false });
    } catch (err) {
      caught = err;
    }

    assert.ok(caught, 'a config write failure must throw, not silently succeed');
    assert.match(caught.message, /Migration failed and rolled back/);
    assert.match(caught.message, /config\.json write phase/);
    assert.deepEqual(
      snapshotTree(planningPath),
      before,
      'ignored planning tree must be byte-restored after a config write failure',
    );
  });

  test('an applied migration is idempotent on re-run', () => {
    const cwd = materializeFixture('mnn-multi-milestone');
    const first = runBracketUpgrade(cwd, ['--apply']);
    assertExited(first, 0, 'first M-NN bracket apply');
    const afterFirst = snapshotTree(path.join(cwd, '.planning'));

    const second = runBracketUpgrade(cwd, ['--apply']);

    assertExited(second, 0, 'second M-NN bracket apply');
    assert.deepEqual(snapshotTree(path.join(cwd, '.planning')), afterFirst, 'second apply must be a no-op');
  });

  // #4698 Blocker 2: an unrecognized or partially-migrated roadmap must
  // refuse outright rather than silently mark the project "bracket" with
  // zero (or partial) conversions — see computeBracketPlan's idempotency
  // guard, which would otherwise treat that stamp as proof the migration is
  // already complete and make a corrected re-run permanently unreachable.
  describe('refuses unrecognized or partially migrated roadmaps (#4698 Blocker 2)', () => {
    test('refuses an empty ROADMAP.md on both dry-run and apply, writing nothing', () => {
      const cwd = materializeFixture('legacy-multi-milestone');
      fs.writeFileSync(path.join(cwd, '.planning', 'ROADMAP.md'), '', 'utf8');
      const before = snapshotTree(cwd, { skipGit: true });

      const dryRun = runBracketUpgrade(cwd);
      assertExited(dryRun, 1, 'zero recognized headings (dry-run)');
      assert.match(dryRun.stderr, /No recognized phase headings/);
      assert.match(dryRun.stderr, /\[CODE\.MM\] NN/);
      assert.match(dryRun.stderr, /Phase M-NN/);
      assert.match(dryRun.stderr, /Phase N: Name/);
      assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'dry-run refusal must write nothing');

      const apply = runBracketUpgrade(cwd, ['--apply']);
      assertExited(apply, 1, 'zero recognized headings (apply)');
      assert.match(apply.stderr, /No recognized phase headings/);
      assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'apply refusal must write nothing');
    });

    test('refuses a ROADMAP.md whose ### headings match none of the recognized grammars', () => {
      const cwd = materializeFixture('legacy-multi-milestone');
      fs.writeFileSync(
        path.join(cwd, '.planning', 'ROADMAP.md'),
        '# Roadmap\n\n## v1.0 — Foundation\n\n### Overview\n\nSome prose.\n\n### Open questions\n\nMore prose.\n',
        'utf8',
      );
      const before = snapshotTree(cwd, { skipGit: true });

      const result = runBracketUpgrade(cwd);

      assertExited(result, 1, 'prose-only headings match no grammar');
      assert.match(result.stderr, /No recognized phase headings/);
      assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'refusal must write nothing');
    });

    test('refuses a roadmap mixing a bracket heading with an unconverted legacy heading', () => {
      const cwd = materializeFixture('legacy-multi-milestone');
      fs.writeFileSync(
        path.join(cwd, '.planning', 'ROADMAP.md'),
        [
          '# Roadmap',
          '',
          '## v1.0 — Foundation',
          '',
          '### [GSD.01] 01: Alpha',
          '',
          '### Phase 2.1: Beta',
          '',
        ].join('\n'),
        'utf8',
      );
      const before = snapshotTree(cwd, { skipGit: true });

      const result = runBracketUpgrade(cwd, ['--apply']);

      assertExited(result, 1, 'mixed bracket/legacy roadmap');
      assert.match(result.stderr, /still has unconverted phase headings/);
      assert.match(result.stderr, /### Phase 2\.1: Beta/);
      assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'refusal must write nothing');
    });

    test('refuses when config already says bracket but a legacy heading remains (does not return done)', () => {
      const cwd = materializeFixture('legacy-multi-milestone');
      const configPath = path.join(cwd, '.planning', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.phase_id_convention = 'bracket';
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      const before = snapshotTree(cwd, { skipGit: true });

      const result = runBracketUpgrade(cwd, ['--apply']);

      assertExited(result, 1, 'config says bracket but legacy headings remain');
      assert.match(result.stderr, /still has unconverted phase headings/);
      assert.match(result.stderr, /### Phase 1: Alpha/);
      assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'refusal must write nothing, not `done`');
    });

    test('the existing fully-migrated idempotency test still passes (regression guard)', () => {
      // Duplicate, minimal re-assertion of the pre-existing idempotency
      // contract, scoped to this describe block so a future reader can see
      // Blocker 2's fix did not disturb it — the full-fidelity version is
      // the file's own "an applied migration is idempotent on re-run" test
      // above (mnn-multi-milestone), which continues to run unmodified.
      const cwd = materializeFixture('legacy-multi-milestone');
      const first = runBracketUpgrade(cwd, ['--apply']);
      assertExited(first, 0, 'first legacy bracket apply');
      const afterFirst = snapshotTree(path.join(cwd, '.planning'));

      const second = runBracketUpgrade(cwd, ['--apply']);

      assertExited(second, 0, 'second legacy bracket apply (must be `done`, not a mixed refusal)');
      assert.deepEqual(
        snapshotTree(path.join(cwd, '.planning')),
        afterFirst,
        'a fully-migrated roadmap must still short-circuit to done',
      );
    });

    test('applyMigration does not write config.json when the plan converted zero phases', () => {
      const cwd = materializeFixture('legacy-multi-milestone');
      const configPath = path.join(cwd, '.planning', 'config.json');
      const configBefore = fs.readFileSync(configPath, 'utf8');

      const emptyPlan = {
        alreadyMigrated: false,
        phases: [],
        roadmapEdits: [],
        crossRefEdits: [],
        targetConvention: 'bracket',
      };

      const result = applyMigration(cwd, emptyPlan, { dryRun: false });

      assert.equal(result.applied, true);
      assert.equal(
        fs.readFileSync(configPath, 'utf8'),
        configBefore,
        'config.json must be untouched when the plan converted zero phases',
      );
    });
  });

  // #4698 Blocker 2: `matchBracketSourceDir` matched an M-NN mapping by
  // checking only its LEADING integer segments, so a parent mapping (e.g.
  // `2-04`, two segments) is a strict prefix of its own child's mapping
  // (`2-04-01`, three segments) and matches the child's directory just as
  // readily as the child's own mapping — the resolution loop took whichever
  // candidate it reached FIRST (roadmap heading order), so a parent heading
  // that happens to precede its child's heading could claim the child's
  // directory and leave the true parent directory unmapped. These tests call
  // computeMigrationPlan() in-process (not the CLI subprocess `runBracketUpgrade`
  // spawns) specifically so `fs.readdirSync` can be mocked to pin the phases
  // directory's listing order — a subprocess would never see a mock installed
  // in this parent process (the same constraint documented on the Blocker 1
  // config-write-failure test above).
  describe('M-NN directories resolve to their most specific mapping (#4698 Blocker 2)', () => {
    function withPhaseDirOrder(phasesDir, orderedNames, fn) {
      const real = fs.readdirSync;
      const dirMock = mock.method(fs, 'readdirSync', (dir, opts) => {
        if (path.resolve(String(dir)) === path.resolve(phasesDir)) {
          if (opts && opts.withFileTypes) {
            return orderedNames.map((name) => ({
              name,
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
            }));
          }
          return orderedNames.slice();
        }
        return real.call(fs, dir, opts);
      });
      try {
        return fn();
      } finally {
        dirMock.mock.restore();
      }
    }

    function setupParentChildFixture() {
      const cwd = materializeFixture('mnn-multi-milestone');
      fs.writeFileSync(
        path.join(cwd, '.planning', 'ROADMAP.md'),
        [
          '# Roadmap',
          '',
          '## v2.0 — Existing milestone',
          '',
          '### Phase 2-04: Parent',
          '',
          '- [ ] **Phase 2-04:** Parent',
          '',
          '### Phase 2-01: Foundation',
          '',
          '- [ ] **Phase 2-01:** Foundation',
          '',
          '### Phase 2-04-01: Deep slice',
          '',
          '- [x] Phase 2-04-01: Deep slice',
          '',
        ].join('\n'),
        'utf8',
      );
      const phasesDir = path.join(cwd, '.planning', 'phases');
      fs.mkdirSync(path.join(phasesDir, 'GSD-02-04-parent'), { recursive: true });
      fs.writeFileSync(path.join(phasesDir, 'GSD-02-04-parent', '02-04-PLAN.md'), '# Parent plan\n', 'utf8');
      return { cwd, phasesDir };
    }

    const expectedRenames = [
      { oldDir: 'GSD-02-01-foundation', newDir: 'GSD.02-01-foundation' },
      { oldDir: 'GSD-02-04-01-deep-slice', newDir: 'GSD.02-04.01-deep-slice' },
      { oldDir: 'GSD-02-04-parent', newDir: 'GSD.02-04-parent' },
    ].sort((a, b) => a.oldDir.localeCompare(b.oldDir));

    test('parent-before-child directory listing order still maps both to their own bracket directories', () => {
      const { cwd, phasesDir } = setupParentChildFixture();

      const plan = withPhaseDirOrder(
        phasesDir,
        ['GSD-02-04-parent', 'GSD-02-01-foundation', 'GSD-02-04-01-deep-slice'],
        () => computeMigrationPlan(cwd, { convention: 'bracket' }),
      );

      assert.deepEqual(
        plan.phases.map(({ oldDir, newDir }) => ({ oldDir, newDir })).sort((a, b) => a.oldDir.localeCompare(b.oldDir)),
        expectedRenames,
      );
    });

    test('child-before-parent directory listing order still maps both to their own bracket directories', () => {
      const { cwd, phasesDir } = setupParentChildFixture();

      const plan = withPhaseDirOrder(
        phasesDir,
        ['GSD-02-04-01-deep-slice', 'GSD-02-01-foundation', 'GSD-02-04-parent'],
        () => computeMigrationPlan(cwd, { convention: 'bracket' }),
      );

      assert.deepEqual(
        plan.phases.map(({ oldDir, newDir }) => ({ oldDir, newDir })).sort((a, b) => a.oldDir.localeCompare(b.oldDir)),
        expectedRenames,
      );
    });

    test('a digit-leading slug with no matching phase still maps to its milestone-phase parent, slug intact', () => {
      const { cwd, phasesDir } = setupParentChildFixture();
      fs.mkdirSync(path.join(phasesDir, 'GSD-02-04-2024-audit'), { recursive: true });
      fs.writeFileSync(path.join(phasesDir, 'GSD-02-04-2024-audit', '02-04-PLAN.md'), '# Audit plan\n', 'utf8');
      // Remove the literal parent directory so "2-04" has exactly ONE
      // directory candidate: the digit-leading-slug one. This isolates "no
      // `2-04-2024` phase exists, so 2024 must stay slug" from the
      // parent/child specificity claim the two tests above already cover.
      cleanup(path.join(phasesDir, 'GSD-02-04-parent'));

      const plan = computeMigrationPlan(cwd, { convention: 'bracket' });

      const auditRename = plan.phases.find((p) => p.oldDir === 'GSD-02-04-2024-audit');
      assert.ok(auditRename, 'the digit-leading-slug directory must still be matched to the 2-04 mapping');
      assert.equal(auditRename.newDir, 'GSD.02-04-2024-audit', 'the "2024-audit" slug must survive unchanged');
    });
  });

  // #4698 Blocker 1: `applyMigration` stamped `phase_id_convention` only when
  // `plan.phases.length > 0`, but `phases` holds DIRECTORY renames, not
  // converted HEADINGS. A roadmap with recognizable headings and zero phase
  // directories on disk therefore had its headings rewritten to bracket text
  // while config stayed unset — and Blocker 2's own mixed/partial guard above
  // then permanently refuses every retry (headings read bracket, config does
  // not: `alreadyBracket.length > 0 && unconverted.length > 0` after a repair
  // attempt could never apply here since NO unconverted headings remain, but
  // the untouched config also never says "bracket", so a caller checking
  // config directly stays fooled). Activation must instead follow whether any
  // identity — heading OR directory — actually converted.
  describe('activates the convention on converted headings, not just directory renames (#4698 Blocker 1)', () => {
    test('bracket target: headings convert and config is stamped even with zero phase directories', () => {
      const cwd = materializeFixture('legacy-multi-milestone');
      cleanup(path.join(cwd, '.planning', 'phases'));

      const plan = computeMigrationPlan(cwd, { convention: 'bracket' });
      assert.equal(plan.alreadyMigrated, false);
      assert.equal(plan.phases.length, 0, 'fixture must have zero phase directories after removal');
      assert.ok(plan.roadmapEdits.length >= 1, 'fixture must still produce heading conversions');

      const result = runBracketUpgrade(cwd, ['--apply']);
      assertExited(result, 0, 'headings-only bracket apply');

      const roadmap = fs.readFileSync(path.join(cwd, '.planning', 'ROADMAP.md'), 'utf8');
      assert.match(roadmap, /### \[GSD\.01\] 01: Alpha/);
      assert.match(roadmap, /### \[GSD\.01\] 02: Beta/);
      assert.match(roadmap, /### \[GSD\.02\] 01: Gamma/);
      const config = JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8'));
      assert.equal(
        config.phase_id_convention,
        'bracket',
        'config must be stamped once headings convert, even though zero directories were renamed',
      );

      // A second run must see every heading as already bracket and
      // short-circuit to `done` — never re-refuse as "mixed" and never
      // rewrite anything (the exact retry Blocker 1 made unreachable).
      const afterFirst = snapshotTree(cwd, { skipGit: true });
      const second = runBracketUpgrade(cwd, ['--apply']);
      assertExited(second, 0, 'second headings-only bracket apply must be `done`, not refused');
      assert.deepEqual(
        snapshotTree(cwd, { skipGit: true }),
        afterFirst,
        'second run must be a no-op once config already says bracket and headings agree',
      );
    });

    test('the empty-plan refusal from #4698 Blocker 2 still writes nothing (regression guard)', () => {
      const cwd = materializeFixture('legacy-multi-milestone');
      fs.writeFileSync(path.join(cwd, '.planning', 'ROADMAP.md'), '', 'utf8');
      const before = snapshotTree(cwd, { skipGit: true });

      const result = runBracketUpgrade(cwd, ['--apply']);

      assertExited(result, 1, 'zero recognized headings must still refuse under the Blocker 1 fix');
      assert.match(result.stderr, /No recognized phase headings/);
      assert.deepEqual(snapshotTree(cwd, { skipGit: true }), before, 'refusal must write nothing');
    });
  });
});
