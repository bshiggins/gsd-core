const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
// Generated round trips each spawn add, find, and analyze commands.
const ROUND_TRIP_TIMEOUT_MS = 120000;
const { createTempProject, cleanup, runGsdTools, homeSandboxEnv } = require('./helpers.cjs');
const locator = require('../gsd-core/bin/lib/phase-locator.cjs');

function fixture(code, naming = 'custom') {
  const cwd = fs.realpathSync(createTempProject());
  fs.writeFileSync(path.join(cwd, '.planning/config.json'), JSON.stringify({phase_naming: naming, project_code: code}));
  fs.writeFileSync(path.join(cwd, '.planning/ROADMAP.md'), '# Roadmap\n\n## Milestone v1.0: Test\n\n## Phases\n');
  return cwd;
}
function run(cwd, args) {
  const result = runGsdTools(args, cwd, homeSandboxEnv(cwd));
  assert.equal(result.success, true, result.error || result.output);
  return JSON.parse(result.output);
}
function add(cwd, id, title = 'Boundary', code = null) {
  run(cwd, ['query', 'phase.add', title, '--id', id]);
  return `.planning/phases/${code ? `${code}-` : ''}${id}-${title.toLowerCase().replaceAll(' ', '-').slice(0,60)}`;
}
function options(code, naming = 'custom') { return {phaseNaming: naming, projectCode: code}; }

for (const code of [null, 'CCM']) {
  test(`custom readers: roadmap analyze sees disk with code ${code} (#5509)`, () => {
    const cwd = fixture(code);
    try {
      add(cwd, 'PRODUCT-BOUNDARY', 'Boundary', code);
      const result = run(cwd, ['query', 'roadmap.analyze']);
      const row = result.phases.find(p => p.number === 'PRODUCT-BOUNDARY' || p.id === 'PRODUCT-BOUNDARY');
      assert.ok(row, JSON.stringify(result));
      assert.notEqual(row.disk_status, 'no_directory');
    } finally { cleanup(cwd); }
  });
  test(`custom readers: milestone complete checks directory with code ${code} (#5509)`, () => {
    const cwd = fixture(code);
    try {
      add(cwd, 'PRODUCT-BOUNDARY', 'Boundary', code);
      const roadmap = path.join(cwd, '.planning/ROADMAP.md');
      fs.appendFileSync(roadmap, '\n### Phase MISSING: Missing\n');
      const missing = runGsdTools(['milestone', 'complete', 'v1.0', '--dry-run'], cwd, homeSandboxEnv(cwd));
      assert.equal(missing.success, false, 'a declared custom phase without a directory must block completion');
      assert.match(missing.error, /Phase MISSING/);
      assert.doesNotMatch(missing.error, /Phase PRODUCT-BOUNDARY/);
      fs.writeFileSync(roadmap, fs.readFileSync(roadmap, 'utf8').replace('### Phase MISSING: Missing', ''));
      assert.equal(run(cwd, ['milestone', 'complete', 'v1.0', '--dry-run']).dry_run, true);
    } finally { cleanup(cwd); }
  });
  test(`custom readers: suffix is never a guessed project code with code ${code} (#5509)`, () => {
    const cwd = fixture(code);
    try {
      add(cwd, 'PRODUCT-BOUNDARY', 'Boundary', code);
      assert.equal(run(cwd, ['query', 'find-phase', 'BOUNDARY']).found, false);
      assert.equal(locator.findPhaseInternal(cwd, 'BOUNDARY', undefined, options(code)), null);
      // Legacy callers receive the configured policy without an override.
      assert.equal(locator.findPhaseInternal(cwd, 'BOUNDARY'), null);
    } finally { cleanup(cwd); }
  });
  for (const id of ['PRODUCT-BOUNDARY', 'SETUP-2']) for (const verb of ['roadmap.annotate-dependencies', 'verify-command-paths', 'verify-failure-directions', 'context-drift']) {
    test(`custom readers: add then ${verb} ${id} with code ${code} (#5509)`, () => {
      const cwd = fixture(code);
      try {
        const dir = add(cwd, id, 'Boundary', code);
        fs.writeFileSync(path.join(cwd, dir, `${id}-01-PLAN.md`), `---\nphase: ${id}\nplan: 01\nwave: 1\n---\n# Plan\n`);
        const roadmap = path.join(cwd, '.planning/ROADMAP.md');
        fs.writeFileSync(roadmap, fs.readFileSync(roadmap, 'utf8').replace('- [ ] TBD', `- [ ] ${id}-01: Build boundary\n- [ ] ${id}-02: Finish boundary`));
        fs.writeFileSync(path.join(cwd, dir, `${id}-02-PLAN.md`), `---\nphase: ${id}\nplan: 02\nwave: 2\n---\n# Plan\n`);
        const args = verb.startsWith('roadmap.') ? ['query', verb, id]
          : verb === 'context-drift' ? ['verify', verb, id] : ['check', verb, id];
        const result = run(cwd, args);
        if (verb.startsWith('roadmap.')) assert.equal(result.updated, true, JSON.stringify(result));
        else if (verb === 'context-drift') assert.equal(result.reason, 'no-context-md');
        else assert.notEqual(result.status, 'unresolvable', JSON.stringify(result));
      } finally { cleanup(cwd); }
    });
  }
  test(`custom controls: scaffold equals add with code ${code} (#5509)`, () => {
    const cwd = fixture(code);
    try {
      const dir = add(cwd, 'mixed-2', 'Boundary', code);
      cleanup(path.join(cwd, dir));
      run(cwd, ['scaffold', 'phase-dir', '--phase', 'mixed-2', '--name', 'Boundary']);
      assert.ok(fs.statSync(path.join(cwd, dir)).isDirectory());
    } finally { cleanup(cwd); }
  });
}
test('custom controls: numeric projects keep custom matching disabled (#5509)', () => {
  const phaseId = require('../gsd-core/bin/lib/phase-id.cjs');
  const context = {phaseNaming: 'custom', projectCode: 'CCM', roadmap: ''};
  for (const id of ['CCM-03', 'CCM-03A', 'CCM-03.2']) {
    assert.equal(phaseId.phaseMarkdownRegexSource(id, context), phaseId.phaseMarkdownRegexSource(id));
  }
  const cwd = fixture(null, 'sequential');
  try {
    fs.mkdirSync(path.join(cwd, '.planning/phases/PRODUCT-BOUNDARY-boundary'));
    assert.equal(run(cwd, ['query', 'find-phase', 'BOUNDARY']).found, false);
    assert.equal(locator.findPhaseInternal(cwd, 'BOUNDARY'), null);
    fs.mkdirSync(path.join(cwd, '.planning/phases/03-numeric'));
    assert.equal(run(cwd, ['query', 'find-phase', '3']).directory, '.planning/phases/03-numeric');
    fs.writeFileSync(path.join(cwd, '.planning/config.json'), JSON.stringify({phase_naming: 'custom', project_code: 'CCM'}));
    fs.renameSync(path.join(cwd, '.planning/phases/03-numeric'), path.join(cwd, '.planning/phases/CCM-03-numeric'));
    fs.writeFileSync(path.join(cwd, '.planning/ROADMAP.md'), '# Roadmap\n\n### Phase 3: Numeric\n');
    const bare = run(cwd, ['query', 'init.plan-phase', '3']);
    const prefixed = run(cwd, ['query', 'init.plan-phase', 'CCM-03']);
    assert.equal(prefixed.phase_dir, bare.phase_dir);
    assert.equal(prefixed.expected_phase_dir, bare.expected_phase_dir);
    assert.equal(bare.expected_phase_dir, null);
  } finally { cleanup(cwd); }
});
for (const length of [59, 60, 61]) {
  test(`custom controls: expected directory slug boundary ${length} (#5509)`, () => {
    const cwd = fixture('CCM');
    try {
      const dir = add(cwd, 'BOUNDARY', 'a'.repeat(length), 'CCM');
      const init = run(cwd, ['query', 'init.plan-phase', 'BOUNDARY']);
      assert.equal(init.expected_phase_dir, path.join(cwd, dir));
      assert.equal(init.phase_dir, init.expected_phase_dir);
    } finally { cleanup(cwd); }
  });
}
test('custom readers: fast-check prefix ids with small mixed alphabet (#5509)', {timeout: ROUND_TRIP_TIMEOUT_MS}, () => {
  const segment = fc.tuple(
    fc.constantFrom('A', 'b', 'c', '2A', '7b'),
    fc.array(fc.constantFrom('A', 'b', 'c', '2'), {maxLength: 2}),
  ).map(([head, tail]) => head + tail.join(''));
  fc.assert(fc.property(segment, fc.constantFrom('2', 'b', 'Ab'), fc.boolean(), fc.tuple(fc.constantFrom('2024', '3', 'Boundary', 'a2'), fc.constantFrom('roadmap', 'steps', 'Ab')).map(words => words.join(' ')), (id, suffix, prefixed, title) => {
    const code = prefixed ? 'CCM' : null;
    const cwd = fixture(code);
    try {
      const longer = `${id}-${suffix}`;
      const shortDir = add(cwd, id, title, code);
      const longDir = add(cwd, longer, title, code);
      assert.equal(run(cwd, ['query', 'find-phase', id]).directory, shortDir);
      assert.equal(run(cwd, ['query', 'find-phase', longer]).directory, longDir);
      const rows = run(cwd, ['query', 'roadmap.analyze']).phases;
      for (const token of [id, longer]) {
        const row = rows.find(p => p.number === token || p.id === token);
        assert.ok(row, JSON.stringify(rows));
        assert.notEqual(row.disk_status, 'no_directory');
      }
    } finally { cleanup(cwd); }
  }), {numRuns: 30, seed: 5186, examples: [['2A', '2', false, '2024 roadmap'], ['7b', 'Ab', true, '3 steps'], ['A', '2', false, '2024 roadmap']]});
});

test('custom readers: canonical matcher owns the configured inverse (#5509)', () => {
  const { matchPhaseDirs } = require('../gsd-core/bin/lib/phase-id.cjs');
  const context = {phaseNaming: 'custom', projectCode: 'CCM', roadmap: '### Phase SETUP: Setup\n### Phase SETUP-2: Extra\n'};
  const dirs = ['CCM-SETUP-setup', 'CCM-SETUP-2-extra'];
  assert.deepEqual(matchPhaseDirs(dirs, 'SETUP', undefined, context).matches, [dirs[0]]);
  assert.deepEqual(matchPhaseDirs(dirs, 'SETUP-2', undefined, context).matches, [dirs[1]]);
});

test('custom readers: smart-entry sees the current failed custom phase (#5509)', () => {
  const cwd = fixture('CCM');
  try {
    const dir = add(cwd, 'PRODUCT-BOUNDARY', 'Boundary', 'CCM');
    fs.writeFileSync(path.join(cwd, '.planning/STATE.md'), '---\ncurrent_phase: PRODUCT-BOUNDARY\nstatus: executing\n---\n# State\n');
    fs.writeFileSync(path.join(cwd, dir, 'PRODUCT-BOUNDARY-VERIFICATION.md'), 'STATUS: failed\n');
    const result = require('../gsd-core/bin/lib/smart-entry.cjs').classifyProject(cwd);
    assert.equal(result.signals.verify_failed, true);
  } finally { cleanup(cwd); }
});

test('custom readers: health rules claim directories and detect missing custom phases (#5509)', () => {
  const cwd = fixture('CCM');
  try {
    add(cwd, 'PRODUCT-BOUNDARY', 'Boundary', 'CCM');
    fs.appendFileSync(path.join(cwd, '.planning/ROADMAP.md'), '\n### Phase MISSING: Missing\n');
    fs.writeFileSync(path.join(cwd, '.planning/STATE.md'), '---\nstatus: milestone complete\n---\n# State\n');
    const configPath = path.join(cwd, '.planning/config.json');
    const beforeConfig = JSON.stringify({phase_naming: 'custom', project_code: 'CCM', branching_strategy: 'bogus-strategy'});
    fs.writeFileSync(configPath, beforeConfig);
    const snapshot = require('../gsd-core/bin/lib/planning-snapshot.cjs').buildPlanningSnapshot(cwd);
    assert.equal(fs.readFileSync(configPath, 'utf8'), beforeConfig);
    const diskRules = require('../gsd-core/bin/lib/health-diagnostic-rules/roadmap-disk-consistency.cjs').RULES;
    assert.deepEqual(diskRules.find(r => r.code === 'W007').check(snapshot), []);
    const stateRules = require('../gsd-core/bin/lib/health-diagnostic-rules/state-consistency.cjs').RULES;
    const warnings = stateRules.find(r => r.code === 'W026').check(snapshot);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /Phase MISSING/);
    assert.doesNotMatch(warnings[0].message, /Phase PRODUCT-BOUNDARY/);
  } finally { cleanup(cwd); }
});

test('custom readers: directory lookup bounds roadmap identity hints (#5509)', () => {
  const cwd = fixture(null);
  const originalReadFile = fs.readFileSync;
  const originalRead = fs.readSync;
  let bytes = 0;
  let reading = false;
  try {
    add(cwd, 'PRODUCT-BOUNDARY');
    const roadmap = path.join(cwd, '.planning/ROADMAP.md');
    fs.appendFileSync(roadmap, 'x'.repeat(2 * 1024 * 1024));
    fs.readFileSync = function(file, ...args) {
      const value = originalReadFile.call(this, file, ...args);
      if (reading && file === roadmap) bytes += Buffer.byteLength(value);
      return value;
    };
    fs.readSync = function(...args) {
      const count = originalRead.apply(this, args);
      if (reading) bytes += count;
      return count;
    };
    reading = true;
    const context = locator.phaseDirectoryOptions(cwd, {phase_naming: 'custom'});
    assert.equal(locator.findPhaseInternal(cwd, 'PRODUCT-BOUNDARY', undefined, context).found, true);
    reading = false;
    assert.ok(bytes > 0 && bytes <= 1024 * 1024, `roadmap read ${bytes} bytes`);
  } finally {
    fs.readFileSync = originalReadFile;
    fs.readSync = originalRead;
    cleanup(cwd);
  }
});

for (const id of ['2FA', '7B', '12AB', '2fa', '7b', '12ab']) for (const code of [null, 'CCM']) {
  test(`custom readers: digit-leading ID ${id} round trips with code ${code} (#5186)`, () => {
    const cwd = fixture(code);
    try {
      const dir = add(cwd, id, `T ${id}`, code);
      assert.equal(run(cwd, ['query', 'find-phase', id]).directory, dir);
      assert.equal(locator.findPhaseInternal(cwd, id).directory, dir);
    } finally { cleanup(cwd); }
  });
}

for (const value of ['Phase 3', '3', '3 of 5 (Foo)']) {
  test(`smart-entry: numeric state ${value} detects failed verification under custom naming (#5186)`, () => {
    const cwd = fixture(null);
    try {
      const dir = path.join(cwd, '.planning/phases/03-foo');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, '03-VERIFICATION.md'), 'STATUS: failed\n');
      fs.writeFileSync(path.join(cwd, '.planning/STATE.md'), `---\ncurrent_phase: "${value}"\nstatus: executing\n---\n# State\n`);
      assert.equal(require('../gsd-core/bin/lib/smart-entry.cjs').classifyProject(cwd).signals.verify_failed, true);
    } finally { cleanup(cwd); }
  });
}
test('smart-entry: non-phase directories cannot hide the latest failed numeric phase (#5186)', () => {
  const cwd = fixture(null);
  try {
    for (const name of ['03-foo', 'zzz-not-a-phase']) {
      const dir = path.join(cwd, '.planning/phases', name);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'VERIFICATION.md'), `STATUS: ${name === '03-foo' ? 'failed' : 'passed'}\n`);
    }
    fs.writeFileSync(path.join(cwd, '.planning/STATE.md'), '---\nstatus: executing\n---\n# State\n');
    assert.equal(require('../gsd-core/bin/lib/smart-entry.cjs').classifyProject(cwd).signals.verify_failed, true);
  } finally { cleanup(cwd); }
});

for (const code of [null, 'CCM']) {
  test(`custom removal: orphaned longer ID survives removing its prefix with code ${code} (#5186)`, () => {
    const cwd = fixture(code);
    try {
      const short = add(cwd, 'A', 'First', code);
      const long = add(cwd, 'A-B', 'Second', code);
      fs.writeFileSync(path.join(cwd, '.planning/ROADMAP.md'), '# Roadmap\n## Phases\n### Phase A: First\n');
      run(cwd, ['phase', 'remove', 'A', '--force']);
      assert.equal(fs.existsSync(path.join(cwd, short)), false);
      assert.equal(fs.existsSync(path.join(cwd, long)), true);
      assert.equal(run(cwd, ['query', 'find-phase', 'A']).found, false);
      assert.equal(run(cwd, ['query', 'find-phase', 'A-B']).directory, long);
    } finally { cleanup(cwd); }
  });
  test(`custom ownership: headings cannot reassign a directory with code ${code} (#5186)`, () => {
    const cwd = fixture(code);
    try {
      const long = add(cwd, 'A-B', 'Second', code);
      fs.writeFileSync(path.join(cwd, '.planning/ROADMAP.md'), '# Roadmap\n## Phases\n### Phase A: First\n');
      run(cwd, ['phase', 'remove', 'A', '--force']);
      assert.equal(fs.existsSync(path.join(cwd, long)), true);
    } finally { cleanup(cwd); }
  });
}

test('custom context: one heading scan serves all phase key and directory matches (#5186)', () => {
  const parser = require('../gsd-core/bin/lib/markdown-sectionizer.cjs');
  const original = parser.tokenizeHeadings;
  let scans = 0;
  parser.tokenizeHeadings = function(...args) { scans++; return original.apply(this, args); };
  try {
    const phaseId = require('../gsd-core/bin/lib/phase-id.cjs');
    const roadmap = Array.from({length: 1200}, (_, i) => `### Phase AUTH-${i}: Step ${i}\n`).join('');
    const context = phaseId.phaseDirectoryContext({phase_naming: 'custom'}, roadmap);
    for (let i = 0; i < 1200; i++) {
      const id = `AUTH-${i}`;
      const dir = `${id}-step-${i}`;
      assert.equal(phaseId.phaseKeyFromDir(dir, undefined, context), id);
      assert.equal(phaseId.phaseKeyFromToken(id, context), id);
      assert.deepEqual(phaseId.matchPhaseDirs([dir], id, undefined, context).matches, [dir]);
    }
    assert.equal(scans, 1, `heading scans for one context: ${scans}`);
  } finally { parser.tokenizeHeadings = original; }
});

test('custom context: roadmap read buffer follows file size and stays bounded (#5186)', () => {
  const cwd = fixture(null);
  const original = fs.readSync;
  const reads = [];
  fs.readSync = function(fd, buffer, ...args) {
    reads.push(buffer.length);
    return original.call(this, fd, buffer, ...args);
  };
  try {
    const roadmap = path.join(cwd, '.planning/ROADMAP.md');
    for (const text of ['', '# Roadmap\n### Phase AUTH: Sign in\n', 'x'.repeat(2 * 1024 * 1024)]) {
      fs.writeFileSync(roadmap, text);
      reads.length = 0;
      locator.phaseDirectoryOptions(cwd, {phase_naming: 'custom'});
      assert.deepEqual(reads, [Math.min(Buffer.byteLength(text), 1024 * 1024)]);
    }
  } finally { fs.readSync = original; cleanup(cwd); }
});

test('custom controls: legacy numeric, suffix, decimal and bracket results stay unchanged (#5186)', () => {
  const cwd = fixture('CCM', 'sequential');
  const phaseId = require('../gsd-core/bin/lib/phase-id.cjs');
  try {
    for (const dir of ['CCM-03-number', 'CCM-04A-suffix', 'CCM-05.2-decimal', 'GSD.02-06-bracket']) {
      fs.mkdirSync(path.join(cwd, '.planning/phases', dir));
    }
    const queries = ['3', 'CCM-03', '4A', 'CCM-04A', '5.2', 'CCM-05.2'];
    const before = queries.map(id => run(cwd, ['query', 'find-phase', id]));
    const bracketBefore = locator.findPhaseInternal(cwd, 'GSD.02-06', 'bracket');
    fs.writeFileSync(path.join(cwd, '.planning/config.json'), JSON.stringify({phase_naming: 'custom', project_code: 'CCM'}));
    assert.deepEqual(queries.map(id => run(cwd, ['query', 'find-phase', id])), before);
    assert.deepEqual(locator.findPhaseInternal(cwd, 'GSD.02-06', 'bracket'), bracketBefore);
    const context = locator.phaseDirectoryOptions(cwd);
    for (const id of queries) assert.equal(phaseId.phaseMarkdownRegexSource(id, context), phaseId.phaseMarkdownRegexSource(id));
  } finally { cleanup(cwd); }
});

for (const writer of ['add', 'batch', 'scaffold']) {
  test(`custom naming policy: ${writer} refuses a custom ID shadowed by project config (#5186)`, () => {
    const cwd = fixture(null);
    try {
      fs.mkdirSync(path.join(cwd, '.gsd'));
      fs.writeFileSync(path.join(cwd, '.gsd/defaults.json'), JSON.stringify({phase_naming: 'custom', project_code: 'GLOBAL'}));
      fs.writeFileSync(path.join(cwd, '.planning/config.json'), '{}');
      const before = fs.readFileSync(path.join(cwd, '.planning/ROADMAP.md'), 'utf8');
      const args = writer === 'add' ? ['query', 'phase.add', 'Boundary', '--id', 'PRODUCT-BOUNDARY']
        : writer === 'batch' ? ['phase', 'add-batch', 'Boundary', '--id', 'PRODUCT-BOUNDARY']
          : ['scaffold', 'phase-dir', '--phase', 'PRODUCT-BOUNDARY', '--name', 'Boundary'];
      const result = runGsdTools(['--json-errors', ...args], cwd, {...homeSandboxEnv(cwd), GSD_HOME: cwd});
      assert.equal(result.success, false, result.output);
      assert.match(result.error, /"reason":"usage"/);
      assert.match(result.error, /phase_naming is not custom for this project/);
      assert.match(result.error, /project config shadows.*defaults\.json/);
      assert.deepEqual(fs.readdirSync(path.join(cwd, '.planning/phases')), []);
      assert.equal(fs.readFileSync(path.join(cwd, '.planning/ROADMAP.md'), 'utf8'), before);
      assert.equal(fs.readFileSync(path.join(cwd, '.planning/config.json'), 'utf8'), '{}');
    } finally { cleanup(cwd); }
  });
}
test('custom naming policy: explicit project naming and project code agree at every writer and reader (#5186)', () => {
  const cwd = fixture('LOCAL');
  try {
    fs.mkdirSync(path.join(cwd, '.gsd'));
    fs.writeFileSync(path.join(cwd, '.gsd/defaults.json'), JSON.stringify({phase_naming: 'sequential', project_code: 'GLOBAL'}));
    const added = add(cwd, 'PRODUCT-BOUNDARY', 'Boundary', 'LOCAL');
    assert.equal(run(cwd, ['query', 'find-phase', 'PRODUCT-BOUNDARY']).directory, added);
    assert.equal(locator.findPhaseInternal(cwd, 'PRODUCT-BOUNDARY').directory, added);
    run(cwd, ['scaffold', 'phase-dir', '--phase', 'SCAFFOLD', '--name', 'Other']);
    assert.equal(run(cwd, ['query', 'find-phase', 'SCAFFOLD']).directory, '.planning/phases/LOCAL-SCAFFOLD-other');
    run(cwd, ['phase', 'add-batch', 'Batch Boundary']);
    assert.equal(run(cwd, ['query', 'find-phase', 'BATCH-BOUNDARY']).directory, '.planning/phases/LOCAL-BATCH-BOUNDARY-batch-boundary');
  } finally { cleanup(cwd); }
});
