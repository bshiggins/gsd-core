/**
 * Planning↔Reality Drift Detection.
 *
 * Distinct from src/drift.cts (CODEBASE drift vs STRUCTURE.md). This diffs
 * planning CLAIMS against shipped reality: how far the default branch has
 * advanced since planning was last reconciled (the `last_reconciled_commit`
 * baseline). Detection only — never throws, never writes plan state, never
 * blocks. The caller runs git and passes parsed inputs in (pure-lib pattern,
 * mirroring drift.cts).
 */
'use strict';

import fs from 'node:fs';
import { platformWriteSync } from './shell-command-projection.cjs';

const PLANNING_DRIFT_THRESHOLD_DEFAULT = 4;
const PLANNING_DRIFT_STALENESS_DAYS_DEFAULT = 7;

interface DetectInput {
  baselineCommit?: string | null;
  baseRef?: string;
  baseCommits?: unknown[];
  baseMerges?: unknown[];
  threshold?: number;
  reconciledAt?: string | null;
  nowIso?: string;
  stalenessWindowDays?: number;
}
interface PlanningDriftResult {
  skipped: false;
  drifted: boolean;
  commitsAhead: number;
  mergesAhead: number;
  ageDays: number | null;
  threshold: number;
  stalenessWindowDays: number;
  baseRef: string;
  baselineCommit: string;
  reconciledAt: string | null;
  recentMerges: string[];
  message: string;
}

// Whole-day age between two ISO dates/datetimes; null if either is missing/unparseable.
function ageInDays(reconciledAt: string | null | undefined, nowIso: string | undefined): number | null {
  if (!reconciledAt || typeof reconciledAt !== 'string') return null;
  const then = Date.parse(reconciledAt);
  const now = nowIso && typeof nowIso === 'string' ? Date.parse(nowIso) : Date.parse(new Date().toISOString());
  if (Number.isNaN(then) || Number.isNaN(now)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}
interface PlanningDriftSkipped {
  skipped: true;
  reason: string;
  drifted: false;
  message: '';
}

function skipped(reason: string): PlanningDriftSkipped {
  return { skipped: true, reason, drifted: false, message: '' };
}

function detectPlanningDrift(input: unknown): PlanningDriftResult | PlanningDriftSkipped {
  try {
    if (!input || typeof input !== 'object') return skipped('invalid-input');
    const inp = input as DetectInput;
    if (!inp.baselineCommit || typeof inp.baselineCommit !== 'string') return skipped('no-baseline');
    if (!inp.baseRef || typeof inp.baseRef !== 'string') return skipped('no-base-branch');

    const threshold =
      Number.isInteger(inp.threshold) && (inp.threshold as number) >= 1
        ? (inp.threshold as number)
        : PLANNING_DRIFT_THRESHOLD_DEFAULT;
    const stalenessWindowDays =
      Number.isInteger(inp.stalenessWindowDays) && (inp.stalenessWindowDays as number) >= 0
        ? (inp.stalenessWindowDays as number)
        : PLANNING_DRIFT_STALENESS_DAYS_DEFAULT;
    const commits = Array.isArray(inp.baseCommits)
      ? inp.baseCommits.filter((x): x is string => typeof x === 'string')
      : [];
    const merges = Array.isArray(inp.baseMerges)
      ? inp.baseMerges.filter((x): x is string => typeof x === 'string')
      : [];

    const commitsAhead = commits.length;
    const mergesAhead = merges.length;
    const reconciledAt = typeof inp.reconciledAt === 'string' ? inp.reconciledAt : null;
    const ageDays = ageInDays(reconciledAt, inp.nowIso);

    // The resolved discriminator: large gap AND stale baseline. A fresh baseline
    // (verify/begin-phase just stamped) means a healthy just-shipped phase, NOT drift.
    const drifted = commitsAhead >= threshold && ageDays !== null && ageDays >= stalenessWindowDays;
    const recentMerges = merges.slice(0, 5);

    let message = '';
    if (drifted) {
      const lines = [
        `Planning may be behind reality: ${inp.baseRef} has advanced ${commitsAhead} commit${commitsAhead === 1 ? '' : 's'}` +
          (mergesAhead ? ` / ${mergesAhead} merge${mergesAhead === 1 ? '' : 's'}` : '') +
          ` and ${ageDays} day${ageDays === 1 ? '' : 's'} since planning was last reconciled` +
          (reconciledAt ? ` (${reconciledAt})` : '') + '.',
      ];
      if (recentMerges.length) {
        lines.push('Recent merges:');
        for (const m of recentMerges) lines.push(`  - ${m}`);
      }
      lines.push('Review and reconcile planning (no automatic changes were made).');
      message = lines.join('\n');
    }

    return {
      skipped: false, drifted, commitsAhead, mergesAhead, ageDays, threshold, stalenessWindowDays,
      baseRef: inp.baseRef, baselineCommit: inp.baselineCommit, reconciledAt, recentMerges, message,
    };
  } catch (err) {
    return skipped('exception:' + ((err as Error)?.message || String(err)));
  }
}

// ─── Baseline frontmatter (symmetric with drift.readMappedCommit) ─────────────
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFm(content: string): { data: Record<string, string>; body: string } {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: content };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2];
  }
  return { data, body: content.slice(m[0].length) };
}

function readReconciledCommit(statePath: string): string | null {
  let content: string;
  try { content = fs.readFileSync(statePath, 'utf8'); } catch { return null; }
  const { data } = parseFm(content);
  const sha = data['last_reconciled_commit'];
  return typeof sha === 'string' && sha.length > 0 ? sha : null;
}

function readReconciledAt(statePath: string): string | null {
  let content: string;
  try { content = fs.readFileSync(statePath, 'utf8'); } catch { return null; }
  const { data } = parseFm(content);
  const at = data['last_reconciled_at'];
  return typeof at === 'string' && at.length > 0 ? at : null;
}

function writeReconciledCommit(statePath: string, commitSha: string, isoDate?: string): void {
  let content = '';
  try { content = fs.readFileSync(statePath, 'utf8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const { data, body } = parseFm(content);
  data['last_reconciled_commit'] = commitSha;
  if (isoDate) data['last_reconciled_at'] = isoDate;
  const keys = Object.keys(data);
  const out = keys.length
    ? '---\n' + keys.map((k) => `${k}: ${data[k]}`).join('\n') + '\n---\n' + body
    : body;
  platformWriteSync(statePath, out);
}

export = {
  PLANNING_DRIFT_THRESHOLD_DEFAULT,
  PLANNING_DRIFT_STALENESS_DAYS_DEFAULT,
  detectPlanningDrift,
  readReconciledCommit,
  readReconciledAt,
  writeReconciledCommit,
};
