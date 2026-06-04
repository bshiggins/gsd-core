/**
 * Roadmap Upgrade — Migration tool for converting legacy 'Phase N' and
 * milestone-prefixed 'Phase M-NN' phase IDs to the BRACKET form (#612):
 *   heading   ### [{CODE}.{MM}] {SS}: Name
 *   directory {CODE}.{MM}-{SS}-slug
 *
 * Bracket is the terminal convention ("two conventions not three": null +
 * bracket). M-NN is no longer terminal — it is a convertible SOURCE that lifts
 * into bracket preserving its integer (`Phase 2-01` → `[CODE.02] 01`, deep
 * `Phase 2-04-01` → `[CODE.02] 04.01`). Bracket emit requires `[CODE.MM]`, so a
 * repo with no `project_code` HARD-REFUSES (no plan).
 *
 * ADR-457 build-at-publish: the hand-written bin/lib/roadmap-upgrade.cjs collapsed
 * to a TypeScript source of truth.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import planningWorkspace = require('./planning-workspace.cjs');
const { planningDir } = planningWorkspace;

// ─── Regex helpers ────────────────────────────────────────────────────────────

// Legacy phase heading: ### Phase N: Name  (also decimal: Phase 2.1:). The phase
// token has NO hyphen (that is the M-NN form, handled separately below).
// Captures: (hashes)(phase-number)(rest-of-line)
const LEGACY_PHASE_HEADING_RE = /^(#{2,4})\s*(?:\[[^\]]+\]\s*)?Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:(.*)/i;

// M-NN (milestone-prefixed) phase heading — a convertible SOURCE under #612:
//   ### Phase 2-01: Name      → milestone 2, token "01"
//   ### Phase 2-04-01: Name   → milestone 2, token "04.01" (deep)
// Captures: (hashes)(milestone-int)(rest-token e.g. "01" or "04-01")(rest-of-line)
const MNN_PHASE_HEADING_RE = /^(#{2,4})\s*(?:\[[^\]]+\]\s*)?Phase\s+(\d+)-(\d+(?:-\d+)*)\s*:(.*)/i;

// Already-migrated (TERMINAL) phase heading — the bracket form:
//   ### [GSD.02] 01: Name   |   ### [GSD.02] 04.01: Name
const BRACKET_PHASE_HEADING_RE = /^#{2,4}\s*\[[A-Za-z][\w]*\.\d+\]\s*\d+(?:\.\d+)?\s*:/i;

// Milestone section headings: ## v1.0, ## Roadmap v2.0, ## ✅ v1.0, ## [GSD] v1.0.
const MILESTONE_HEADING_RE = /^##\s+(?:\[[^\]]+\]\s+|Roadmap\s+|[✅🚧]\s*)?v(\d+)\.(\d+)(?:\s|:)/iu;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedPhaseEntry {
  lineIndex: number;
  headingLine: string;
  alreadyMigrated: boolean;          // a bracket (terminal) heading is present
  source?: 'legacy' | 'mnn';
  milestoneInt?: number | null;      // legacy: enclosing ## vM.N; mnn: token leading int
  legacyPhaseNum?: string;           // legacy source token: "1", "2.1"
  mnnRest?: string;                  // mnn source rest: "01" or "04-01"
  phaseName?: string;
  hashes?: string;
}

interface PhaseMapping {
  lineIndex: number;
  milestoneInt: number;
  token: string;                     // bracket token: "01", "04.01"
  source: 'legacy' | 'mnn';
  legacyPhaseNum?: string;           // legacy: for dir matching
  mnnRest?: string;                  // mnn: for dir matching
}

interface PhaseRename {
  oldId: string;
  newId: string;
  oldDir: string;
  newDir: string;
}

interface RoadmapEdit {
  lineIndex: number;
  from: string;
  to: string;
}

interface CrossRefEdit {
  file: string;
  from: string;
  to: string;
}

interface MigrationPlan {
  alreadyMigrated: boolean;
  phases: PhaseRename[];
  roadmapEdits: RoadmapEdit[];
  crossRefEdits: CrossRefEdit[];
  refused?: boolean;     // #612: bracket needs [CODE.MM]; no project_code → refuse
  reason?: string;
}

interface ApplyMigrationResult {
  applied?: boolean;
  alreadyMigrated?: boolean;
  refused?: boolean;
  reason?: string;
  dryRun?: boolean;
  renamedDirs?: string[];
  editedFiles?: string[];
}

// ─── Pure computation helpers ─────────────────────────────────────────────────

/**
 * Parse the ROADMAP.md content and build a list of phase entries with their
 * enclosing milestone major version.
 *
 * Returns an array of:
 *   { lineIndex, headingLine, milestoneInt, legacyPhaseNum, phaseName }
 */
function parseRoadmapPhases(lines: string[]): ParsedPhaseEntry[] {
  const results: ParsedPhaseEntry[] = [];
  let currentMilestoneInt: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const milestoneMatch = line.match(MILESTONE_HEADING_RE);
    if (milestoneMatch) {
      currentMilestoneInt = parseInt(milestoneMatch[1], 10);
      continue;
    }

    // Bracket form is TERMINAL — already migrated.
    if (BRACKET_PHASE_HEADING_RE.test(line)) {
      results.push({ lineIndex: i, headingLine: line, alreadyMigrated: true });
      continue;
    }

    // M-NN is a convertible SOURCE (must be tested before legacy: the legacy
    // regex's `(\d+…)\s*:` fails on `Phase 2-01:` anyway, but order makes intent
    // explicit). Milestone = leading int; rest token lifts into the bracket token.
    const mnnMatch = line.match(MNN_PHASE_HEADING_RE);
    if (mnnMatch) {
      results.push({
        lineIndex: i,
        headingLine: line,
        source: 'mnn',
        milestoneInt: parseInt(mnnMatch[2], 10),
        mnnRest: mnnMatch[3],
        phaseName: mnnMatch[4].trim(),
        hashes: mnnMatch[1],
        alreadyMigrated: false,
      });
      continue;
    }

    const phaseMatch = line.match(LEGACY_PHASE_HEADING_RE);
    if (phaseMatch) {
      results.push({
        lineIndex: i,
        headingLine: line,
        source: 'legacy',
        milestoneInt: currentMilestoneInt,
        legacyPhaseNum: phaseMatch[2],
        phaseName: phaseMatch[3].trim(),
        hashes: phaseMatch[1],
        alreadyMigrated: false,
      });
    }
  }

  return results;
}

/**
 * Resolve each source phase to its bracket (milestoneInt, token), keyed by
 * lineIndex so identical legacy phase numbers across milestones each keep their
 * own mapping. Legacy entries get a 1-based sequential sub-index within their
 * milestone; M-NN entries PRESERVE their integer (`2-01`→token "01",
 * `2-04-01`→token "04.01").
 */
function assignBracketTokens(phaseEntries: ParsedPhaseEntry[]): Map<number, PhaseMapping> {
  const milestoneCounters = new Map<number, number>(); // milestoneInt → counter (legacy)
  const mapping = new Map<number, PhaseMapping>();      // lineIndex → PhaseMapping

  for (const entry of phaseEntries) {
    if (entry.alreadyMigrated) continue;
    const m = entry.milestoneInt;
    if (m === null || m === undefined) continue;

    if (entry.source === 'mnn') {
      // rest "01" → "01"; "04-01" → "04.01" (zero-pad each segment)
      const token = entry.mnnRest!.split('-').map(s => String(parseInt(s, 10)).padStart(2, '0')).join('.');
      mapping.set(entry.lineIndex, { lineIndex: entry.lineIndex, milestoneInt: m, token, source: 'mnn', mnnRest: entry.mnnRest });
    } else {
      const counter = (milestoneCounters.get(m) || 0) + 1;
      milestoneCounters.set(m, counter);
      const token = String(counter).padStart(2, '0');
      mapping.set(entry.lineIndex, { lineIndex: entry.lineIndex, milestoneInt: m, token, source: 'legacy', legacyPhaseNum: entry.legacyPhaseNum });
    }
  }

  return mapping;
}

/**
 * Strip a leading project_code prefix (legacy `GSD-…` or bracket `GSD.…`) so the
 * numeric phase token can be read from a directory name.
 */
function stripCodePrefix(dirName: string): string {
  return dirName.replace(/^[A-Z]{1,6}[-.](?=\d)/i, '');
}

/**
 * Does an on-disk directory belong to the given phase mapping? Padding-tolerant.
 *   legacy entry (token assigned, legacyPhaseNum="2.1"): dir "02.1-x" / "2.1-x" / "GSD-02.1-x"
 *   mnn entry (mnnRest="04-01", milestone 2): dir "02-04-01-x" / "GSD-2-04-01-x"
 */
function dirMatchesMapping(dirName: string, e: PhaseMapping): boolean {
  const stripped = stripCodePrefix(dirName);
  if (e.source === 'mnn') {
    const m = stripped.match(/^(\d+(?:-\d+)+)(?:-|$)/);
    if (!m) return false;
    const dirSegs = m[1].split('-').map(s => parseInt(s, 10));
    const entrySegs = [e.milestoneInt, ...e.mnnRest!.split('-').map(s => parseInt(s, 10))];
    return dirSegs.length === entrySegs.length && dirSegs.every((v, i) => v === entrySegs[i]);
  }
  const m = stripped.match(/^(\d+[A-Z]?(?:\.\d+)*)(?:-|$)/i);
  if (!m) return false;
  const norm = (s: string) => {
    const dot = s.indexOf('.');
    const intPart = parseInt(s, 10);
    return dot !== -1 ? `${intPart}${s.slice(dot)}` : String(intPart);
  };
  return norm(m[1]) === norm(e.legacyPhaseNum!);
}

/** Sanitize a slug to a safe filesystem token (no path separators / traversal). */
function sanitizeSlug(slug: string): string {
  return slug.replace(/[/\\]/g, '-').replace(/\.\./g, '-');
}

/**
 * Build the new BRACKET directory name. projectCode is REQUIRED for bracket
 * (the caller HARD-REFUSES when it is null).
 *   old "01-setup"        code "GSD" m 2 token "01" → "GSD.02-01-setup"
 *   old "GSD-2-01-setup"  code "GSD" m 2 token "01" → "GSD.02-01-setup"
 */
function buildNewDirName(oldDirName: string, code: string, milestoneInt: number, token: string): string {
  const stripped = stripCodePrefix(oldDirName);
  // slug = everything after the leading numeric token (legacy "01-", mnn "02-01-", decimal "02.1-")
  const slugMatch = stripped.match(/^\d+[A-Z]?(?:[.-]\d+)*-(.*)/i);
  const slug = sanitizeSlug(slugMatch ? slugMatch[1] : '');
  const mm = String(milestoneInt).padStart(2, '0');
  return slug ? `${code}.${mm}-${token}-${slug}` : `${code}.${mm}-${token}`;
}

/**
 * Read project_code from config.json if present.
 */
function readProjectCode(configPath: string): string | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed['project_code'] === 'string' ? parsed['project_code'] : null;
  } catch {
    return null;
  }
}

// ─── computeMigrationPlan ─────────────────────────────────────────────────────

/**
 * Compute a migration plan without touching the filesystem.
 */
function computeMigrationPlan(cwd: string, options: Record<string, unknown> = {}): MigrationPlan {
  void options;
  const pDir = planningDir(cwd);
  const roadmapPath = path.join(pDir, 'ROADMAP.md');
  const configPath = path.join(pDir, 'config.json');
  const phasesDir = path.join(pDir, 'phases');
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const EMPTY = { phases: [] as PhaseRename[], roadmapEdits: [] as RoadmapEdit[], crossRefEdits: [] as CrossRefEdit[] };

  // ── Config: bracket is the TERMINAL convention ────────────────────────────
  let configData: Record<string, unknown> = {};
  try {
    configData = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch { /* config may not exist */ }

  if (configData['phase_id_convention'] === 'bracket') {
    return { alreadyMigrated: true, ...EMPTY };
  }

  const projectCode = typeof configData['project_code'] === 'string' ? configData['project_code'] : null;

  // ── Read ROADMAP.md ───────────────────────────────────────────────────────
  let roadmapContent = '';
  try {
    roadmapContent = fs.readFileSync(roadmapPath, 'utf8');
  } catch {
    throw new Error(`ROADMAP.md not found at ${roadmapPath}`);
  }

  const lines = roadmapContent.split('\n');
  const parsedPhases = parseRoadmapPhases(lines);

  // Any bracket (terminal) heading present → already migrated.
  if (parsedPhases.some(e => e.alreadyMigrated)) {
    return { alreadyMigrated: true, ...EMPTY };
  }

  const sourcePhases = parsedPhases.filter(e => !e.alreadyMigrated);

  // B-migrator-real-layouts: single-milestone projects (HQ-NN) often omit the
  // `## vN.M` heading, so legacy phases have no enclosing milestone and would
  // 0-op. Derive the milestone from STATE.md `milestone:` instead of skipping.
  if (sourcePhases.some(e => e.source === 'legacy' && (e.milestoneInt === null || e.milestoneInt === undefined))) {
    let fallbackMilestone: number | null = null;
    try {
      const stateRaw = fs.readFileSync(path.join(pDir, 'STATE.md'), 'utf8');
      const mm = stateRaw.match(/^milestone:\s*v?(\d+)/im);
      if (mm) fallbackMilestone = parseInt(mm[1], 10);
    } catch { /* no STATE.md → cannot derive; leave as 0-op */ }
    if (fallbackMilestone !== null) {
      for (const e of sourcePhases) {
        if (e.source === 'legacy' && (e.milestoneInt === null || e.milestoneInt === undefined)) {
          e.milestoneInt = fallbackMilestone;
        }
      }
    }
  }

  const idMapping = assignBracketTokens(sourcePhases);

  // ── HARD-REFUSE: bracket IDs are [CODE.MM] — impossible without project_code ─
  if (idMapping.size > 0 && !projectCode) {
    return {
      alreadyMigrated: false,
      refused: true,
      reason: 'Cannot migrate to the bracket convention without a project_code in .planning/config.json '
        + '(bracket phase IDs are [CODE.MM] NN). Set "project_code" first, then re-run.',
      ...EMPTY,
    };
  }
  const code = projectCode as string; // guarded above when there is work to do

  // Per-milestone legacy lookup (for checklist resolution): milestoneInt → (normNum → token)
  const milestoneLegacyMap = new Map<number, Map<string, string>>();
  for (const e of idMapping.values()) {
    if (e.source !== 'legacy') continue;
    if (!milestoneLegacyMap.has(e.milestoneInt)) milestoneLegacyMap.set(e.milestoneInt, new Map());
    const mMap = milestoneLegacyMap.get(e.milestoneInt)!;
    const ln = e.legacyPhaseNum!;
    const intPart = parseInt(ln, 10);
    mMap.set(ln, e.token);
    mMap.set(String(intPart), e.token);
    mMap.set(pad2(intPart), e.token);
    const dot = ln.indexOf('.');
    if (dot !== -1) {
      mMap.set(pad2(intPart) + ln.slice(dot), e.token);
      mMap.set(String(intPart) + ln.slice(dot), e.token);
    }
  }

  // ── Phase directory renames ─────────────────────────────────────────────────
  let existingDirs: string[] = [];
  try {
    existingDirs = fs.readdirSync(phasesDir).filter(d => {
      try { return fs.statSync(path.join(phasesDir, d)).isDirectory(); } catch { return false; }
    });
  } catch { /* phases dir may not exist */ }

  // Match dirs to mappings in ROADMAP order; first occurrence of a number claims
  // the first matching dir (the only unambiguous strategy for flat legacy dirs).
  const ordered = [...idMapping.values()].map(e => ({ e, used: false }));
  const phases: PhaseRename[] = [];
  for (const dirName of existingDirs) {
    const hit = ordered.find(o => !o.used && dirMatchesMapping(dirName, o.e));
    if (!hit) continue;
    hit.used = true;
    const newDir = buildNewDirName(dirName, code, hit.e.milestoneInt, hit.e.token);
    if (newDir !== dirName) {
      phases.push({
        oldId: hit.e.source === 'mnn' ? `${hit.e.milestoneInt}-${hit.e.mnnRest}` : (hit.e.legacyPhaseNum ?? ''),
        newId: `${code}.${pad2(hit.e.milestoneInt)}-${hit.e.token}`,
        oldDir: dirName,
        newDir,
      });
    }
  }

  // ── ROADMAP.md heading edits ────────────────────────────────────────────────
  const roadmapEdits: RoadmapEdit[] = [];
  for (const entry of sourcePhases) {
    const map = idMapping.get(entry.lineIndex);
    if (!map) continue;
    const oldLine = lines[entry.lineIndex];
    const head = `${entry.hashes} [${code}.${pad2(map.milestoneInt)}] ${map.token}:`;
    const name = entry.phaseName ?? '';
    const newLine = name ? `${head} ${name}` : head;
    if (newLine !== oldLine) {
      roadmapEdits.push({ lineIndex: entry.lineIndex, from: oldLine, to: newLine });
    }
  }

  // ── ROADMAP.md checklist edits (bracket form), milestone-context aware ───────
  let curMilestone: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const msm = line.match(MILESTONE_HEADING_RE);
    if (msm) { curMilestone = parseInt(msm[1], 10); continue; }
    if (roadmapEdits.some(e => e.lineIndex === i)) continue;

    // M-NN checklist bullet: integer preserved directly from the line.
    const cmMnn = line.match(/^(\s*-\s*\[[ x]\]\s*\*{0,2})Phase\s+(\d+)-(\d+(?:-\d+)*)(\s*:)/i);
    if (cmMnn) {
      const m = parseInt(cmMnn[2], 10);
      const token = cmMnn[3].split('-').map(s => pad2(parseInt(s, 10))).join('.');
      const newLine = `${cmMnn[1]}[${code}.${pad2(m)}] ${token}${cmMnn[4]}` + line.slice(cmMnn[0].length);
      roadmapEdits.push({ lineIndex: i, from: line, to: newLine });
      continue;
    }

    // Legacy checklist bullet: resolve token via enclosing milestone's counter map.
    const cm = line.match(/^(\s*-\s*\[[ x]\]\s*\*{0,2})Phase\s+(\d+[A-Z]?(?:\.\d+)*)(\s*:)/i);
    if (cm) {
      const num = cm[2];
      const intPart = parseInt(num, 10);
      let token: string | undefined;
      if (curMilestone !== null && milestoneLegacyMap.has(curMilestone)) {
        const mMap = milestoneLegacyMap.get(curMilestone)!;
        token = mMap.get(num) || mMap.get(String(intPart)) || mMap.get(pad2(intPart));
      }
      if (!token) {
        // Fallback: single-milestone roadmaps carry no collision — first legacy map wins.
        for (const mm of milestoneLegacyMap.values()) {
          token = mm.get(num) || mm.get(String(intPart)) || mm.get(pad2(intPart));
          if (token) { curMilestone = [...milestoneLegacyMap.entries()].find(([, v]) => v === mm)![0]; break; }
        }
      }
      if (token && curMilestone !== null) {
        const newLine = `${cm[1]}[${code}.${pad2(curMilestone)}] ${token}${cm[3]}` + line.slice(cm[0].length);
        roadmapEdits.push({ lineIndex: i, from: line, to: newLine });
      }
    }
  }

  // ── Cross-ref edits for STATE.md / PROJECT.md — DEFERRED to PR 4 ─────────────
  // Bare prose references (`Phase 1:`) carry NO milestone context, so in a
  // multi-milestone repo the same `from` string maps to two different bracket
  // targets — and the string-replace apply (split/join) would assign every
  // occurrence the FIRST milestone, silently corrupting the others (the exact
  // ambiguity #612 exists to kill). The heading/dir paths avoid this via
  // lineIndex / ordered-_used matching; prose has no such anchor. STATE/PROJECT
  // reference emit belongs with the PR 4 write path (state.cts), where it can be
  // generated from a single milestone-scoped source rather than guessed from
  // ambiguous prose. Emitting nothing here is correct-and-incomplete, not wrong.
  const crossRefEdits: CrossRefEdit[] = [];

  return { alreadyMigrated: false, phases, roadmapEdits, crossRefEdits };
}

// ─── applyMigration ───────────────────────────────────────────────────────────

/**
 * Apply the migration plan computed by computeMigrationPlan().
 *
 * @param cwd
 * @param plan
 * @param options
 * @param options.dryRun - Print plan and exit without mutating. (default true)
 */
function applyMigration(cwd: string, plan: MigrationPlan, options: { dryRun?: boolean } = {}): ApplyMigrationResult {
  const dryRun = options.dryRun !== false; // default true

  // #612 HARD-REFUSE: no project_code → cannot emit bracket IDs. Never mutate.
  if (plan.refused) {
    process.stderr.write(`Migration refused: ${plan.reason ?? 'cannot migrate'}\n`);
    return { refused: true, reason: plan.reason };
  }

  // Dry-run prints the full plan (including alreadyMigrated:true) so callers can
  // see "nothing to do" rather than silent empty output.
  if (dryRun) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    return plan.alreadyMigrated ? { alreadyMigrated: true, dryRun: true } : { dryRun: true };
  }

  if (plan.alreadyMigrated) {
    return { alreadyMigrated: true };
  }

  // ── Real run: verify clean working tree ───────────────────────────────────
  let gitStatus: string;
  try {
    gitStatus = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
  } catch (err) {
    throw new Error(`git status failed: ${(err as Error).message}`);
  }
  if (gitStatus.trim().length > 0) {
    throw new Error('Working tree is dirty. Commit or stash changes before migrating.');
  }

  // Capture HEAD sha for rollback
  let headSha: string;
  try {
    headSha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch (err) {
    throw new Error(`git rev-parse HEAD failed: ${(err as Error).message}`);
  }

  const pDir = planningDir(cwd);
  const phasesDir = path.join(pDir, 'phases');
  const roadmapPath = path.join(pDir, 'ROADMAP.md');
  const configPath = path.join(pDir, 'config.json');

  const renamedDirs: string[] = [];
  const editedFiles: string[] = [];

  try {
    // 1. Rename phase directories
    for (const phaseEntry of plan.phases) {
      const oldPath = path.join(phasesDir, phaseEntry.oldDir);
      const newPath = path.join(phasesDir, phaseEntry.newDir);
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        renamedDirs.push(`${phaseEntry.oldDir} → ${phaseEntry.newDir}`);
      }
    }

    // 2. Rewrite ROADMAP.md phase headings
    if (plan.roadmapEdits.length > 0) {
      const roadmapContent = fs.readFileSync(roadmapPath, 'utf8');
      const lines = roadmapContent.split('\n');

      // Sort edits by lineIndex to apply in order
      const sortedEdits = [...plan.roadmapEdits].sort((a, b) => a.lineIndex - b.lineIndex);
      for (const edit of sortedEdits) {
        if (lines[edit.lineIndex] === edit.from) {
          lines[edit.lineIndex] = edit.to;
        }
      }

      fs.writeFileSync(roadmapPath, lines.join('\n'), 'utf8');
      editedFiles.push('ROADMAP.md');
    }

    // 3. Rewrite cross-refs in STATE.md and PROJECT.md
    const crossRefsByFile = new Map<string, CrossRefEdit[]>();
    for (const edit of plan.crossRefEdits) {
      if (!crossRefsByFile.has(edit.file)) {
        crossRefsByFile.set(edit.file, []);
      }
      crossRefsByFile.get(edit.file)!.push(edit);
    }

    for (const [fileName, edits] of crossRefsByFile) {
      const filePath = path.join(pDir, fileName);
      if (!fs.existsSync(filePath)) continue;

      let content = fs.readFileSync(filePath, 'utf8');
      let changed = false;

      for (const edit of edits) {
        if (content.includes(edit.from)) {
          // Replace all occurrences
          content = content.split(edit.from).join(edit.to);
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(filePath, content, 'utf8');
        editedFiles.push(fileName);
      }
    }

    // 4. Update config.json: set phase_id_convention to 'bracket'
    let configData: Record<string, unknown> = {};
    try {
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch { /* config may not exist yet */ }

    configData['phase_id_convention'] = 'bracket';
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf8');
    editedFiles.push('config.json');

  } catch (err) {
    // Rollback via git reset --hard + git clean
    try {
      execSync(`git reset --hard ${headSha}`, { cwd, stdio: 'pipe' });
      execSync('git clean -fd .planning/phases/', { cwd, stdio: 'pipe' });
    } catch {
      // Swallow rollback errors — surface original error
    }
    throw new Error(`Migration failed (rolled back to ${headSha}): ${(err as Error).message}`);
  }

  return { applied: true, renamedDirs, editedFiles };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export = {
  computeMigrationPlan,
  applyMigration,
};
