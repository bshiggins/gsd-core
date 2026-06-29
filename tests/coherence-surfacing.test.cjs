// allow-test-rule: source-text-is-the-product see #612
/**
 * Task 5: Proactive session-start drift surfacing
 *
 * Tests for the coherence-surfacing feature added to gsd-session-state.sh.
 * Verifies that:
 *   - A drifted project causes the hook to inject "Planning: DRIFTED" into
 *     additionalContext and set coherence_drifted: true.
 *   - A non-drifted project does NOT inject a drift line.
 *   - The existing hooks.community gate still suppresses all output when false.
 *
 * Drifted fixture uses the W011 trigger (ROADMAP marks phase complete with [x]
 * while STATE says in-progress) — proven to yield coherence:'drifted' in
 * tests/verify-health.test.cjs without any git setup.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const isWindows = process.platform === 'win32';

// Ensure the running node binary is on PATH so bash hooks can call `node`
// (Claude Code shell sessions do not have `node` on PATH).
const hookEnv = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
};

function spawnHook(hookPath, options) {
  return spawnSync('bash', [hookPath], { ...options, env: hookEnv });
}

function createTempProject(prefix = 'gsd-coherence-surfacing-test-') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  // eslint-disable-next-line local/no-raw-rmsync-in-tests -- this IS the local teardown helper
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

function writeMinimalProjectMd(tmpDir) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'PROJECT.md'),
    '# Project\n\n## What This Is\n\nContent here.\n\n## Core Value\n\nContent here.\n\n## Requirements\n\nContent here.\n'
  );
}

function writeConfig(tmpDir, opts = {}) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'config.json'),
    JSON.stringify({ model_profile: 'balanced', commit_docs: true, ...opts }, null, 2)
  );
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * W011 drifted fixture: ROADMAP marks phase 1 complete ([x]) while STATE says
 * current phase 1 is in-progress. Proven to yield coherence:'drifted' from
 * `validate health --raw` (no git setup needed).
 */
function writeDriftedFixture(tmpDir, hooksCommunity = true) {
  writeMinimalProjectMd(tmpDir);
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'ROADMAP.md'),
    '# Roadmap\n\n- [x] **Phase 1: Setup**\n'
  );
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'STATE.md'),
    '# Session State\n\n**Current Phase:** 1\n**Status:** in-progress\n'
  );
  writeConfig(tmpDir, { hooks: { community: hooksCommunity } });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
}

/**
 * Non-drifted fixture: ROADMAP has no completed phases and STATE agrees.
 * No baseline → coherence:'unknown'; no W011 → no coherence-bearing warnings.
 * Either way, coherence ≠ 'drifted' → no drift line should be injected.
 */
function writeNonDriftedFixture(tmpDir) {
  writeMinimalProjectMd(tmpDir);
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'ROADMAP.md'),
    '### Phase 1: Setup\n'
  );
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'STATE.md'),
    '# Session State\n\n**Current Phase:** 1\n**Status:** in-progress\n'
  );
  writeConfig(tmpDir, { hooks: { community: true } });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('coherence surfacing — session-start drift injection', {
  skip: isWindows ? 'bash hooks require unix shell' : false,
}, () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('drifted project: hook injects Planning: DRIFTED into additionalContext', () => {
    writeDriftedFixture(tmpDir);
    const hookPath = path.join(HOOKS_DIR, 'gsd-session-state.sh');

    const result = spawnHook(hookPath, {
      input: '',
      encoding: 'utf-8',
      cwd: tmpDir,
    });

    assert.strictEqual(result.status, 0, `Should exit 0. stderr: ${result.stderr}`);
    assert.ok(result.stdout.length > 0, 'Should produce output when hooks enabled');

    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SessionStart');

    // Primary: typed field
    assert.strictEqual(parsed.hookSpecificOutput.coherence_drifted, true,
      `coherence_drifted must be true for a drifted project; got: ${JSON.stringify(parsed.hookSpecificOutput)}`);

    // Secondary: human-readable text in additionalContext (source-text-is-the-product:
    // 'Planning: DRIFTED' is the injected context contract that sessions read)
    assert.ok(
      parsed.hookSpecificOutput.additionalContext.includes('Planning: DRIFTED'),
      `additionalContext must include 'Planning: DRIFTED'; got:\n${parsed.hookSpecificOutput.additionalContext}`
    );
  });

  test('non-drifted project: hook does NOT inject drift line', () => {
    writeNonDriftedFixture(tmpDir);
    const hookPath = path.join(HOOKS_DIR, 'gsd-session-state.sh');

    const result = spawnHook(hookPath, {
      input: '',
      encoding: 'utf-8',
      cwd: tmpDir,
    });

    assert.strictEqual(result.status, 0, `Should exit 0. stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SessionStart');

    // Primary: typed field
    assert.strictEqual(parsed.hookSpecificOutput.coherence_drifted, false,
      `coherence_drifted must be false for a non-drifted project; got: ${JSON.stringify(parsed.hookSpecificOutput)}`);

    // Secondary: no drift text in context
    assert.ok(
      !parsed.hookSpecificOutput.additionalContext.includes('Planning: DRIFTED'),
      `additionalContext must NOT include 'Planning: DRIFTED'; got:\n${parsed.hookSpecificOutput.additionalContext}`
    );
  });

  test('hooks.community:false on drifted project: hook emits nothing (existing gate holds)', () => {
    writeDriftedFixture(tmpDir, false /* hooksCommunity */);
    const hookPath = path.join(HOOKS_DIR, 'gsd-session-state.sh');

    const result = spawnHook(hookPath, {
      input: '',
      encoding: 'utf-8',
      cwd: tmpDir,
    });

    assert.strictEqual(result.status, 0, `Should exit 0. stderr: ${result.stderr}`);
    assert.strictEqual(result.stdout.trim(), '',
      `Should produce no output when hooks.community is false; got: ${JSON.stringify(result.stdout)}`);
  });
});
