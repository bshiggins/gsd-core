'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const runtime = require('../gsd-core/bin/gsd-tools.cjs');
const commandAliases = require('../gsd-core/bin/lib/command-aliases.cjs');
const { collectSection } = require('../gsd-core/bin/lib/markdown-sectionizer.cjs');

const ROOT = path.join(__dirname, '..');
const AGENT_PATH = path.join(ROOT, 'agents', 'gsd-plan-checker.md');
const SYNTHETIC_PATH = path.join(ROOT, 'tests', 'synthetic-query-contract.md');
const DOCUMENTED_ROOTS = [
  'agents', path.join('gsd-core', 'workflows'), 'commands',
  'skills', path.join('pi', 'package-skills'), path.join('pi', 'package-agents'),
];
// The runtime probes render output for these roots instead of rejecting an
// unknown subcommand, so they have no router-level subcommand list.
const EXPECTED_ROOT_ONLY = new Set(['progress', 'stats']);
// These documented routers have spaced subcommands but no dotted alias metadata.
const SPACED_ROUTER_ROOTS = ['package-legitimacy', 'planning', 'research-store', 'review-lane'];
const QUERY_PREFIX = String.raw`(?:\b(?:gsd_run|gsd-tools)|\bnode\s+"\$GSD_TOOLS"|"\$GSD_TOOLS")(?:\s+--cwd\s+(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+))?\s+query\s+`;

function shellLines(content) {
  return content.replace(/\\\r?\n/g, '').split(/\r?\n/);
}

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : [];
  });
}

function isExecutableCall(line, index) {
  const before = line.slice(0, index);
  // Ignore grammatical mentions; count shell starts, control operators/substitutions,
  // and Markdown code spans so embedded calls remain covered without a word list.
  return !before.trim() || /(?:\$\(\s*|&&\s*|\|\|\s*|\|\s*|;\s*|\b(?:if|then|do|else|elif|while|until)\s*|`[^`]*$)$/.test(before);
}

function queryNames(content) {
  const names = [];
  for (const line of shellLines(content)) {
    // Scan every occurrence, including shell substitutions, pipelines, and inline examples.
    const re = new RegExp(`${QUERY_PREFIX}([\\w.-]+)(?:\\s+([\\w.-]+))?`, 'g');
    let match;
    while ((match = re.exec(line))) {
      if (!isExecutableCall(line, match.index)) continue;
      names.push([match[1], match[2]].filter(Boolean));
    }
  }
  return names;
}

test('queryNames finds every generated executable call and skips prose mentions', () => {
  const name = fc.tuple(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/),
    fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/),
  ).map(([root, subcommand]) => `${root}.${subcommand}`);
  const secondToken = fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/), { nil: undefined });
  const invoker = fc.constantFrom('gsd_run', 'gsd-tools', 'gsd_run --cwd X', 'gsd_run --cwd "path with spaces"', 'node "$GSD_TOOLS"', '"$GSD_TOOLS"');
  const placement = fc.constantFrom(
    (call) => call,
    (call) => `$(${call})`,
    (call) => `previous && ${call}`,
    (call) => `previous || ${call}`,
    (call) => `previous | ${call}`,
    (call) => `previous; ${call}`,
    (call) => `if ${call}`,
    (call) => `then ${call}`,
    (call) => `do ${call}`,
    (call) => `else ${call}`,
    (call) => `elif ${call}`,
    (call) => `while ${call}`,
    (call) => `until ${call}`,
    (call) => `example \`${call}\``,
  );

  fc.assert(fc.property(name, secondToken, invoker, placement, (queryName, arg, command, place) => {
    const call = [command, 'query', queryName, arg].filter(Boolean).join(' ');
    assert.deepEqual(queryNames(place(call)), [[queryName, arg].filter(Boolean)]);
    assert.deepEqual(queryNames(`documentation mentions ${call}`), []);
  }));
});

function documentedQueryNames(files) {
  const names = files.flatMap((file) => queryNames(fs.readFileSync(file, 'utf8')));
  return [...new Map(names.map((parts) => [parts.join(' '), parts])).values()];
}

const PRE_HUB_PHASE_SUBCOMMANDS = ['mvp-mode', 'tdd-applicable'];

let runtimeRegisteredNamesCache;

function runtimeRegisteredNames() {
  if (runtimeRegisteredNamesCache) return runtimeRegisteredNamesCache;

  const registered = new Set(Object.keys(runtime.HOST_COMMAND_ROUTERS));
  const commandList = runtime.TOP_LEVEL_USAGE.match(/Commands: ([^\n]+)/)?.[1] || '';
  for (const name of commandList.split(/,\s*/)) if (name) registered.add(name.trim());
  const families = new Set();
  const routerRoots = new Set(SPACED_ROUTER_ROOTS);
  const capabilities = require('../gsd-core/bin/lib/capability-registry.cjs');
  for (const name of Object.keys(capabilities.commandFamilies)) registered.add(name);
  const phase = require('../gsd-core/bin/lib/phase.cjs');
  // Only the two pre-hub phase subcommands are query verbs; the other cmdPhase*
  // exports (plan-index, add, ...) are not documented query targets.
  for (const subcommand of PRE_HUB_PHASE_SUBCOMMANDS) {
    const handler = `cmdPhase${subcommand.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())}`;
    assert.equal(typeof phase[handler], 'function', `phase.cjs must export ${handler}`);
    registered.add(`phase.${subcommand}`);
  }
  for (const value of Object.values(commandAliases)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!entry || typeof entry.canonical !== 'string') continue;
      registered.add(entry.canonical);
      if (entry.subcommand) families.add(entry.canonical.split('.')[0]);
      else if (entry.canonical.includes('.')) routerRoots.add(entry.canonical.split('.')[0]);
      for (const alias of entry.aliases || []) registered.add(alias);
    }
  }
  const subcommands = new Map();
  const dottedRoots = new Set(routerRoots);
  for (const root of DOCUMENTED_ROOTS) {
    for (const file of markdownFiles(path.join(ROOT, root))) {
      for (const [name] of queryNames(fs.readFileSync(file, 'utf8'))) {
        const commandRoot = name.split('.')[0];
        if (name.includes('.') && !families.has(commandRoot)) dottedRoots.add(commandRoot);
      }
    }
  }
  const probeRoots = [...dottedRoots]
    .filter((root) => registered.has(root) && runtime.HOST_COMMAND_ROUTERS[root])
    .sort();
  const probedRootOnly = new Set();
  const dir = createTempProject('agent-query-contract-probe-');
  try {
    for (const root of probeRoots) {
      const result = runGsdTools([root, 'zz-agent-query-contract-probe'], dir);
      const error = result.error || '';
      const available = error.match(/Unknown\b[^\n]*\bsubcommand\b[^\n]*Available:\s*([^\r\n]+)/i);
      const usage = error.match(new RegExp(`Usage: ${root} <([\\w|.-]+)>`));
      if (!available && !usage) {
        probedRootOnly.add(root);
        continue;
      }
      subcommands.set(root, new Set(available ? available[1].split(/,\s*/).filter(Boolean) : usage[1].split('|')));
    }
  } finally {
    cleanup(dir);
  }

  assert.deepEqual([...EXPECTED_ROOT_ONLY].sort(), [...probedRootOnly].sort(),
    'EXPECTED_ROOT_ONLY must equal exactly the documented roots whose runtime probe does not report unknown subcommands');
  runtimeRegisteredNamesCache = { registered, families, subcommands };
  return runtimeRegisteredNamesCache;
}

function isRegistered(parts, registry) {
  const [name, subcommand] = parts;
  const root = name.split('.')[0];
  if (registry.families.has(root)) {
    const canonical = name.includes('.') ? name : `${name}.${subcommand || ''}`;
    return Boolean(subcommand || name.includes('.')) && (registry.registered.has(canonical) || registry.registered.has(canonical.replace('.', ' ')));
  }
  if (!name.includes('.')) {
    if (registry.subcommands.has(name)) return registry.subcommands.get(name).has(subcommand);
    return registry.registered.has(name);
  }
  if (registry.registered.has(name)) return true;
  return registry.subcommands.get(root)?.has(name.slice(root.length + 1)) || false;
}

function findUnregisteredQueries(files, registry) {
  const failures = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file.path).split(path.sep).join('/');
    for (const parts of queryNames(file.content)) {
      if (!isRegistered(parts, registry)) {
        failures.push(`${relative}: ${parts.join(' ')}`);
      }
    }
  }
  return failures;
}

test('every documented query names a registered command', () => {
  const files = DOCUMENTED_ROOTS
    .flatMap((root) => markdownFiles(path.join(ROOT, root)));
  const names = documentedQueryNames(files);
  const registered = runtimeRegisteredNames();
  assert.deepEqual(names.filter((parts) => !isRegistered(parts, registered)).map((parts) => parts.join(' ')), []);

  assert.deepEqual(findUnregisteredQueries([{
    path: SYNTHETIC_PATH,
    content: 'gsd-tools query synthetic.unregistered\n',
  }], registered), ['tests/synthetic-query-contract.md: synthetic.unregistered']);
  assert.deepEqual(findUnregisteredQueries([{
    path: SYNTHETIC_PATH,
    content: 'gsd-tools query verify.plan-structure\n',
  }], registered), []);
});

test('a bad subcommand under a registered non-family root is rejected', () => {
  const registered = runtimeRegisteredNames();
  assert.deepEqual(findUnregisteredQueries([{
    path: SYNTHETIC_PATH,
    content: [
      'gsd-tools query frontmatter.no-such-subcommand',
      'gsd-tools query worktree.no-such-subcommand',
      'gsd-tools query phase.plan-index',
      'gsd-tools query phase.mvp-mode',
      'gsd-tools query phase.tdd-applicable',
      'gsd-tools query frontmatter.get',
      'gsd-tools query worktree.base-check',
    ].join('\n'),
  }], registered), [
    'tests/synthetic-query-contract.md: frontmatter.no-such-subcommand',
    'tests/synthetic-query-contract.md: worktree.no-such-subcommand',
    'tests/synthetic-query-contract.md: phase.plan-index',
  ]);
});

test('spaced router-owned subcommands reject frontmatter bogus without rejecting leaf arguments', () => {
  const registered = runtimeRegisteredNames();
  assert.deepEqual(findUnregisteredQueries([{
    path: SYNTHETIC_PATH,
    content: [
      'gsd_run query frontmatter bogus',
      'gsd_run query worktree bogus',
      'gsd_run query state bogus',
      'gsd_run query frontmatter get file --field status',
      'gsd_run query resolve-model gsd-planner',
    ].join('\n'),
  }], registered), [
    'tests/synthetic-query-contract.md: frontmatter bogus',
    'tests/synthetic-query-contract.md: worktree bogus',
    'tests/synthetic-query-contract.md: state bogus',
  ]);
});

for (const [root, valid] of [
  ['package-legitimacy', 'check'], ['planning', 'inspect'],
  ['research-store', 'put'], ['review-lane', 'plan'],
]) {
  test(`the spaced-only ${root} router checks its subcommand`, () => {
    const registered = runtimeRegisteredNames();
    assert.equal(isRegistered([root, 'bogus'], registered), false);
    assert.equal(isRegistered([root, valid], registered), true);
  });
}

for (const [label, invoker] of [
  ['node wrapper', 'node "$GSD_TOOLS"'],
  ['executable wrapper', '"$GSD_TOOLS"'],
  ['continuation before query', 'gsd_run \\\n  '],
]) {
  test(`query contracts recognize ${label}`, () => {
    const content = `RESULT=$(${invoker} query synthetic.unregistered)`;
    assert.deepEqual(findUnregisteredQueries([{ path: SYNTHETIC_PATH, content }], runtimeRegisteredNames()), [
      'tests/synthetic-query-contract.md: synthetic.unregistered',
    ]);
    assert.deepEqual(frontmatterCalls(`${invoker} query frontmatter.get "file with spaces" --field status`), [
      { planExpression: 'file with spaces', args: ['--field', 'status'], field: 'status' },
    ]);
  });
}

for (const [label, content] of [
  ['query name', 'gsd-tools query \\\n  synthetic.unregistered'],
  ['spaced subcommand', 'gsd_run query frontmatter \\\n  bogus'],
]) {
  test(`query contracts recognize a continued ${label}`, () => {
    const expected = label === 'query name' ? 'synthetic.unregistered' : 'frontmatter bogus';
    assert.deepEqual(findUnregisteredQueries([{ path: SYNTHETIC_PATH, content }], runtimeRegisteredNames()), [
      `tests/synthetic-query-contract.md: ${expected}`,
    ]);
  });
}

test('frontmatter argument validation follows line continuations', () => {
  assert.deepEqual(frontmatterCalls('gsd_run query frontmatter.get "file with spaces" \\\r\n  must_haves'), [
    { planExpression: 'file with spaces', args: ['must_haves'], field: 'must_haves' },
  ]);
});

test('scope guidance retains the base thresholds without a zero-task blocker', () => {
  const scope = collectSection(fs.readFileSync(AGENT_PATH, 'utf8'), (heading) => heading.text === 'Step 8: Assess Scope');
  assert.ok(scope);
  assert.doesNotMatch(scope.body, /Zero tasks[^\n]*blocker/i);
  assert.match(scope.body, /Thresholds: 2-3 tasks\/plan good, 4 warning, 5\+ blocker \(split required\)\./);
});

for (const [label, content, expectedError] of [
  ['missing file', null, 'File not found'],
  ['empty file', '', 'File not found'],
  ['invalid YAML', '---\nmust_haves: [\n---\n# Plan\n', 'Frontmatter is not parseable YAML — fix the syntax error in the frontmatter block'],
]) {
  test(`frontmatter guidance documents the exit-zero error for ${label}`, (t) => {
    const dir = createTempProject('agent-query-error-');
    t.after(() => cleanup(dir));
    const planPath = path.join(dir, 'PLAN.md');
    if (content !== null) fs.writeFileSync(planPath, content);
    const result = runGsdTools(['query', 'frontmatter.get', planPath, '--field', 'must_haves'], dir);
    assert.equal(result.exitCode, 0, result.error);
    assert.equal(JSON.parse(result.output).error, expectedError);
    const guidance = collectSection(fs.readFileSync(AGENT_PATH, 'utf8'), (heading) => heading.text === 'Step 3: Parse must_haves');
    assert.ok(guidance.body.includes(expectedError), `Step 3 must document ${expectedError}`);
  });
}

function frontmatterCalls(agent) {
  const calls = [];
  for (const line of shellLines(agent)) {
    const re = new RegExp(QUERY_PREFIX + 'frontmatter\\.get\\s+(.+?)(?=\\s*(?:\\)|\\|\\||&&|\\||;|`|$))', 'g');
    let match;
    while ((match = re.exec(line))) {
      if (!isExecutableCall(line, match.index)) continue;
      const args = [...match[1].matchAll(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g)]
        .map(([word]) => word.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_whole, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted));
      if (args.length) {
        const fieldIndex = args.indexOf('--field');
        calls.push({ planExpression: args[0], args: args.slice(1), field: fieldIndex >= 0 ? args[fieldIndex + 1] : args[1] });
      }
    }
  }
  return calls;
}

test('every documented frontmatter.get call accepts its argument form', (t) => {
  const dir = createTempProject('agent-query-arguments-');
  t.after(() => cleanup(dir));
  const fixturePath = path.join(dir, 'fixture.md');
  fs.writeFileSync(fixturePath, '---\nstatus: complete\ndepends_on: []\nmust_haves: {}\nfiles_modified: []\n---\n');
  const failures = [];
  for (const root of DOCUMENTED_ROOTS) {
    for (const file of markdownFiles(path.join(ROOT, root))) {
      for (const call of frontmatterCalls(fs.readFileSync(file, 'utf8'))) {
        const result = runGsdTools(['query', 'frontmatter.get', fixturePath, ...call.args], dir);
        if (!result.success) failures.push(`${path.relative(ROOT, file).split(path.sep).join('/')}: ${call.args.join(' ')}: ${result.error}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('plan-checker frontmatter.get calls return must_haves and files_modified', (t) => {
  const calls = frontmatterCalls(fs.readFileSync(AGENT_PATH, 'utf8'));
  assert.ok(calls.length > 0, 'expected documented frontmatter.get calls');

  const dir = createTempProject('agent-query-contract-');
  t.after(() => cleanup(dir));
  const planPath = path.join(dir, '.planning', 'phases', '01-test', '01-01-PLAN.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  const expectedMustHaves = { truths: ['Fixture truth'], artifacts: [], key_links: [] };
  const expectedFiles = ['src/example.js'];
  fs.writeFileSync(planPath, [
    '---', 'phase: 1', 'plan: 1',
    'must_haves:', '  truths:', '    - Fixture truth', '  artifacts: []', '  key_links: []',
    'files_modified:', '  - src/example.js', '---', '# Fixture plan', '',
  ].join('\n'));

  for (const call of calls) {
    const result = runGsdTools(['query', 'frontmatter.get', planPath, ...call.args], dir);
    assert.equal(result.success, true, `${call.planExpression} ${call.args.join(' ')}: ${result.error}`);
    const parsed = JSON.parse(result.output);
    if (call.field === 'must_haves') assert.deepEqual(parsed.must_haves, expectedMustHaves);
    if (call.field === 'files_modified') assert.deepEqual(parsed.files_modified, expectedFiles);
  }
  const fields = new Set(calls.map((call) => call.field));
  assert.ok(fields.has('must_haves'), 'expected a documented must_haves query');
  assert.ok(fields.has('files_modified'), 'expected a documented files_modified query');
});

test('missing must_haves is an error payload even when frontmatter.get exits zero', (t) => {
  const dir = createTempProject('agent-query-missing-field-');
  t.after(() => cleanup(dir));
  const planPath = path.join(dir, 'PLAN.md');
  fs.writeFileSync(planPath, '---\nphase: 1\n---\n# Plan\n');

  const result = runGsdTools(['query', 'frontmatter.get', planPath, '--field', 'must_haves'], dir);
  assert.equal(result.exitCode, 0, result.error);
  const parsed = JSON.parse(result.output);
  assert.equal(parsed.error, 'Field not found');
  assert.equal(Object.hasOwn(parsed, 'must_haves'), false);
});

test('plan-checker verify.plan-structure fields match the runtime output', (t) => {
  const dir = createTempProject('agent-query-structure-');
  t.after(() => cleanup(dir));
  const planPath = path.join(dir, '.planning', 'phases', '01-test', '01-01-PLAN.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, [
    '---', 'phase: 1', 'plan: 1', 'type: execute', 'wave: 1',
    'depends_on: []', 'files_modified: [src/example.js]', 'autonomous: true',
    'must_haves:', '  truths: [Fixture truth]', '  artifacts: []', '  key_links: []', '---',
    '# Plan', '', '<tasks>', '<task type="auto">', '<name>Add fixture</name>',
    '<files>src/example.js</files>', '<action>Add fixture behavior.</action>',
    '<verify>node --test</verify>', '<done>Fixture behavior exists.</done>',
    '</task>', '</tasks>', '',
  ].join('\n'));

  const result = runGsdTools(['query', 'verify.plan-structure', planPath], dir);
  assert.equal(result.success, true, result.error);
  const parsed = JSON.parse(result.output);
  assert.equal(parsed.task_count, 1);
  assert.ok(Array.isArray(parsed.tasks));
  for (const field of ['name', 'hasFiles', 'hasAction', 'hasVerify', 'hasDone']) {
    assert.ok(Object.hasOwn(parsed.tasks[0], field), `task output is missing ${field}`);
  }
});

test('zero XML tasks produces a warning and an invalid plan exits one with JSON', (t) => {
  const dir = createTempProject('agent-query-empty-structure-');
  t.after(() => cleanup(dir));
  const planPath = path.join(dir, 'PLAN.md');
  fs.writeFileSync(planPath, [
    '---', 'phase: 1', 'plan: 1', 'type: execute', 'wave: 1',
    'depends_on: []', 'files_modified: []', 'autonomous: true',
    'must_haves: {}', '---', '# Plan', '## Task 1', 'Markdown-only task.', '',
  ].join('\n'));
  const empty = runGsdTools(['query', 'verify.plan-structure', planPath], dir);
  assert.equal(empty.exitCode, 0, empty.error);
  const emptyParsed = JSON.parse(empty.output);
  assert.equal(emptyParsed.task_count, 0);
  assert.deepEqual(emptyParsed.tasks, []);
  assert.ok(emptyParsed.warnings.includes('No <task> elements found'));

  fs.writeFileSync(planPath, '# Plan without required frontmatter\n');
  const invalid = runGsdTools(['query', 'verify.plan-structure', planPath], dir);
  assert.equal(invalid.exitCode, 1);
  const invalidParsed = JSON.parse(invalid.output);
  assert.equal(invalidParsed.valid, false);
  assert.ok(invalidParsed.errors.length > 0);
});


// Literal classification independently checked against each router's actual rejection.
const CLOSED_ROUTER_ROOTS = new Set([
  'state', 'phase', 'roadmap', 'verify', 'validate', 'init', 'capability', 'git',
  'research-store', 'agent', 'check', 'commit-docs-guard', 'template', 'task',
  'frontmatter', 'eval', 'verification', 'quick-batch', 'phases', 'planning',
  'assumption-delta', 'requirements', 'milestone', 'uat', 'todo', 'scaffold',
  'loop', 'workstream', 'worktree', 'learnings', 'review-lane', 'package-legitimacy',
  'effort', 'user-story', 'drift-guard', 'windows', 'skills-root',
]);
const BOGUS_SUBCOMMAND = 'zz-agent-query-contract-probe';
let hostRouterProbes;
function probeHostRouters() {
  if (hostRouterProbes) return hostRouterProbes;
  hostRouterProbes = new Map();
  for (const root of Object.keys(runtime.HOST_COMMAND_ROUTERS)) {
    const dir = createTempProject('agent-query-router-');
    try {
      // No ambient credentials or config homes: leaf probes can only write fixtures.
      const env = Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined]));
      Object.assign(env, { HOME: dir, USERPROFILE: dir, PATH: process.env.PATH,
        TMPDIR: fs.realpathSync(require('node:os').tmpdir()), GIT_CONFIG_NOSYSTEM: '1',
        SystemRoot: process.env.SystemRoot });
      const bogus = runGsdTools(['query', root, BOGUS_SUBCOMMAND], dir, env);
      const bare = CLOSED_ROUTER_ROOTS.has(root) ? runGsdTools(['query', root], dir, env) : null;
      hostRouterProbes.set(root, { bogus, bare });
    } finally {
      cleanup(dir);
    }
  }
  return hostRouterProbes;
}

for (const root of Object.keys(runtime.HOST_COMMAND_ROUTERS)) {
  test(`router ${root}: bogus dispatch name agrees with the runtime`, () => {
    const result = probeHostRouters().get(root).bogus;
    const rejected = /Unknown.*(?:subcommand|workflow|scaffold type|runtime)|Usage: review-lane </i.test(result.error || '');
    assert.equal(rejected, CLOSED_ROUTER_ROOTS.has(root), `update the audited classification for ${root}: ${result.error}`);
    assert.equal(isRegistered([root, BOGUS_SUBCOMMAND], runtimeRegisteredNames()), !CLOSED_ROUTER_ROOTS.has(root), result.error);
  });
}

test('bare query state remains registered when its default runtime operation succeeds', () => {
  assert.equal(probeHostRouters().get('state').bare.exitCode, 0);
  assert.equal(isRegistered(['state'], runtimeRegisteredNames()), true);
});

for (const [label, content] of [
  ['negated if', 'if ! gsd_run query synthetic.unregistered; then :; fi'],
  ['negation', '! gsd_run query synthetic.unregistered'],
  ['assignment prefix', 'NAME=value gsd_run query synthetic.unregistered'],
  ['quoted assignment prefix', 'NAME="a b" gsd_run query synthetic.unregistered'],
  ['env prefix', 'env NAME=value gsd_run query synthetic.unregistered'],
  ['env options', 'env -i -u NAME OTHER=value gsd_run query synthetic.unregistered'],
  ['cwd equals', 'gsd_run --cwd=/tmp query synthetic.unregistered'],
  ['quoted cwd equals', 'gsd_run --cwd="path with spaces" query synthetic.unregistered'],
  ['braced node variable', 'node "${GSD_TOOLS}" query synthetic.unregistered'],
  ['unquoted node variable', 'node $GSD_TOOLS query synthetic.unregistered'],
  ['literal node path', 'node ~/.claude/gsd-core/bin/gsd-tools.cjs query synthetic.unregistered'],
  ['quoted literal node path', 'node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" query synthetic.unregistered'],
  ['braced executable variable', '"${GSD_TOOLS}" query synthetic.unregistered'],
  ['brace group', '{ gsd_run query synthetic.unregistered; }'],
  ['subshell group', '(gsd_run query synthetic.unregistered)'],
  ['time prefix', 'time gsd_run query synthetic.unregistered'],
]) {
  test(`shell parser recognizes ${label}`, () => {
    assert.deepEqual(queryNames(content), [['synthetic.unregistered']]);
  });
}

for (const [label, content, expected] of [
  ['descriptor duplication', 'gsd_run query state.load 2>&1', [['state.load']]],
  ['raw flag', 'gsd_run query state.load --raw', [['state.load']]],
  ['global flag before subcommand', 'gsd_run query frontmatter --raw get file', [['frontmatter', 'get']]],
  ['bare root redirect', 'gsd_run query state 2>/dev/null', [['state']]],
]) {
  test(`shell parser separates ${label} from command names`, () => assert.deepEqual(queryNames(content), expected));
}

for (const [label, content, expected] of [
  ['spaced get', 'gsd_run query frontmatter get "$P" must_haves', { planExpression: '$P', args: ['must_haves'], field: 'must_haves' }],
  ['stderr redirect', 'X=$(gsd_run query frontmatter.get "$P" --field status 2>/dev/null)', { planExpression: '$P', args: ['--field', 'status'], field: 'status' }],
  ['fd duplication', 'gsd_run query frontmatter get "$P" --field status 2>&1', { planExpression: '$P', args: ['--field', 'status'], field: 'status' }],
  ['nested substitution', 'gsd_run query frontmatter.get "$(dirname "$PLAN")/x.md" --field status', { planExpression: '$(dirname "$PLAN")/x.md', args: ['--field', 'status'], field: 'status' }],
  ['field equals', 'gsd_run query frontmatter.get "$P" --field=must_haves', { planExpression: '$P', args: ['--field=must_haves'], field: 'must_haves' }],
  ['trailing comment', 'gsd_run query frontmatter.get "$P" --field status # note', { planExpression: '$P', args: ['--field', 'status'], field: 'status' }],
  ['single-quoted newline', "gsd_run query frontmatter.get 'file\\\nname' --field status", { planExpression: 'file\\\nname', args: ['--field', 'status'], field: 'status' }],
]) {
  test(`frontmatter parser preserves argv for ${label}`, () => assert.deepEqual(frontmatterCalls(content), [expected]));
}

test('a spaced positional frontmatter field reaches the runtime argument validator', (t) => {
  const calls = frontmatterCalls('gsd_run query frontmatter get "$P" must_haves');
  assert.equal(calls.length, 1);
  const dir = createTempProject('agent-query-spaced-');
  t.after(() => cleanup(dir));
  const fixture = path.join(dir, 'PLAN.md');
  fs.writeFileSync(fixture, '---\nmust_haves: {}\n---\n');
  assert.equal(runGsdTools(['query', 'frontmatter.get', fixture, ...calls[0].args], dir).success, false);
});

test('quoted heredoc content is data rather than executable query calls', () => {
  assert.deepEqual(queryNames("cat <<'EOF'\ngsd_run query synthetic.unregistered\nEOF\n"), []);
});
