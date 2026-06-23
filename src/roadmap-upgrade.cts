/**
 * Roadmap Upgrade — Migration tool for converting legacy 'Phase N' phase IDs
 * to milestone-prefixed 'Phase M-NN' form.
 *
 * ADR-457 build-at-publish: the hand-written bin/lib/roadmap-upgrade.cjs collapsed
 * to a TypeScript source of truth. Behaviour is preserved byte-for-behaviour
 * from the prior hand-written .cjs; only types are added.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import planningWorkspace = require('./planning-workspace.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import phaseIdMod = require('./phase-id.cjs');
const { planningDir } = planningWorkspace;
const { stripProjectCodePrefix } = phaseIdMod;

// ─── Regex helpers ────────────────────────────────────────────────────────────

// Matches legacy phase headings: ### Phase N: Name  (also decimal: Phase 2.1:)
// Captures: (hashes)(spaces)(phase-number)(rest-of-line)
const LEGACY_PHASE_HEADING_RE = /^(#{2,4})\s*(?:\[[^\]]+\]\s*)?Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:(.*)/i;

// Matches already-migrated phase headings: ### Phase M-NN: Name
const MIGRATED_PHASE_HEADING_RE = /^#{2,4}\s*(?:\[[^\]]+\]\s*)?Phase\s+\d+-\d{2}\s*:/i;

// Matches milestone section headings: ## v1.0, ## Roadmap v2.0, ## ✅ v1.0, ## [GSD] v1.0, etc.
// The optional bracket-token prefix (e.g., [GSD]) must be tested before the emoji group.
const MILESTONE_HEADING_RE = /^##\s+(?:\[[^\]]+\]\s+|Roadmap\s+|[✅🚧]\s*)?v(\d+)\.(\d+)(?:\s|:)/iu;

// ── Bracket-convention recognizers (#612, used only by computeBracketPlan) ──────
// Under the bracket convention M-NN is a convertible SOURCE (not terminal): the
// milestone is the leading int and the rest lifts into the bracket token.
//   ### Phase 2-01: Name      → milestone 2, rest "01"      → [GSD.02] 01
//   ### Phase 2-04-01: Name   → milestone 2, rest "04-01"   → [GSD.02] 04.01
// Captures: (hashes)(milestone-int)(rest-token)(rest-of-line)
const MNN_PHASE_HEADING_RE = /^(#{2,4})\s*(?:\[[^\]]+\]\s*)?Phase\s+(\d+)-(\d+(?:-\d+)*)\s*:(.*)/i;

// The bracket form itself is TERMINAL — its presence means "already migrated".
//   ### [GSD.02] 01: Name   |   ### [GSD.02] 04.01: Name
const BRACKET_PHASE_HEADING_RE = /^#{2,4}\s*\[[A-Za-z][\w]*\.\d+\]\s*\d+(?:\.\d+)?\s*:/i;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedPhaseEntry {
  lineIndex: number;
  headingLine: string;
  alreadyMigrated: boolean;
  milestoneInt?: number | null;
  legacyPhaseNum?: string;
  phaseName?: string;
  hashes?: string;
}

interface AssignedMapping {
  newId: string;
  milestoneInt: number;
  subIndex: number;
  legacyPhaseNum: string;
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
  // Convention the plan migrates TO. Absent ⇒ 'milestone-prefixed' (the legacy
  // default), so milestone-prefixed plans carry no extra field. computeBracketPlan
  // sets 'bracket'; applyMigration writes this value into config.json.
  targetConvention?: string;
}

interface ApplyMigrationResult {
  applied?: boolean;
  alreadyMigrated?: boolean;
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

    if (MIGRATED_PHASE_HEADING_RE.test(line)) {
      // Already-migrated heading found — caller will detect this
      results.push({ lineIndex: i, headingLine: line, alreadyMigrated: true });
      continue;
    }

    const phaseMatch = line.match(LEGACY_PHASE_HEADING_RE);
    if (phaseMatch) {
      results.push({
        lineIndex: i,
        headingLine: line,
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
 * Assign sub-indices within each milestone, building a per-entry mapping.
 *
 * Input: array from parseRoadmapPhases (non-migrated entries only).
 * Returns: Map<lineIndex, { newId, milestoneInt, subIndex }>
 *
 * Keyed by `lineIndex` (the unique position of the heading line in ROADMAP.md)
 * so that identical legacy phase numbers in different milestones (e.g., two
 * `Phase 1` headings in v1.0 and v2.0) each get their own correct M-NN ID
 * instead of the later milestone's mapping overwriting the earlier one.
 *
 * Sub-indices are 1-based and sequential within each milestone.
 */
function assignSubIndices(phaseEntries: ParsedPhaseEntry[]): Map<number, AssignedMapping> {
  const milestoneCounters = new Map<number, number>(); // milestoneInt → counter
  const mapping = new Map<number, AssignedMapping>(); // lineIndex → { newId, milestoneInt, subIndex }

  for (const entry of phaseEntries) {
    if (entry.alreadyMigrated) continue;
    const m = entry.milestoneInt;
    if (m === null || m === undefined) continue;

    const counter = (milestoneCounters.get(m) || 0) + 1;
    milestoneCounters.set(m, counter);

    const subIndex = String(counter).padStart(2, '0');
    const newId = `${m}-${subIndex}`;

    mapping.set(entry.lineIndex, { newId, milestoneInt: m, subIndex: counter, legacyPhaseNum: entry.legacyPhaseNum! });
  }

  return mapping;
}

/**
 * Read a phase directory name and return its numeric token (stripping project_code prefix).
 * e.g. "GSD-01-setup" → "01", "01-setup" → "01", "02-implement" → "02", "02.1-hotfix" → "02.1"
 */
function extractPhaseNumFromDir(dirName: string): string | null {
  // Strip optional project_code prefix: "GSD-01-setup" → "01-setup"
  const stripped = stripProjectCodePrefix(dirName);
  // Matches: digits + optional letter + optional decimal suffix, followed by '-' or end.
  // e.g. "02.1-hotfix" → "02.1", "01-setup" → "01"
  const m = stripped.match(/^(\d+[A-Z]?(?:\.\d+)*)(?:-|$)/i);
  return m ? m[1] : null;
}


/**
 * Build the new directory name from old name and new phase ID.
 * old: "01-setup"         newId: "1-02"  projectCode: "GSD"  → "GSD-01-02-setup"
 * old: "01-setup"         newId: "1-02"  projectCode: null   → "01-02-setup"
 * old: "GSD-01-setup"     newId: "1-02"  projectCode: "GSD"  → "GSD-01-02-setup"
 */
function buildNewDirName(oldDirName: string, newId: string, projectCode: string | null): string {
  // Strip existing project_code prefix
  const stripped = stripProjectCodePrefix(oldDirName);

  // Extract slug: everything after "NN-" (the old phase num, including decimal like 02.1)
  const slugMatch = stripped.match(/^\d+[A-Z]?(?:\.\d+)*-(.*)/i);
  const slug = slugMatch ? slugMatch[1] : stripped;

  // Build M-NN prefix (zero-pad both parts)
  const [milestoneStr, subStr] = newId.split('-');
  const milestoneInt = parseInt(milestoneStr, 10);
  const paddedMilestone = String(milestoneInt).padStart(2, '0');
  const newBase = slug ? `${paddedMilestone}-${subStr}-${slug}` : `${paddedMilestone}-${subStr}`;

  return projectCode ? `${projectCode}-${newBase}` : newBase;
}

// ─── computeBracketPlan (#612 bracket convention) ───────────────────────────────

interface BracketSourceEntry {
  lineIndex: number;
  alreadyMigrated: boolean;        // a bracket (terminal) heading is present
  source?: 'legacy' | 'mnn';
  milestoneInt?: number | null;    // legacy: enclosing ## vN.M; mnn: leading int
  legacyPhaseNum?: string;         // legacy token: "1", "2.1"
  mnnRest?: string;                // mnn rest: "01" or "04-01"
  phaseName?: string;
  hashes?: string;
}

interface BracketMapping {
  lineIndex: number;
  milestoneInt: number;
  token: string;                   // bracket token: "01", "04.01"
  source: 'legacy' | 'mnn';
  legacyPhaseNum?: string;
  mnnRest?: string;
}

const bpad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Parse ROADMAP lines for the bracket convention: bracket headings are TERMINAL
 * (already migrated), M-NN headings are convertible SOURCES, and legacy `Phase N`
 * headings are sources whose milestone comes from the enclosing `## vN.M`.
 */
function parseBracketSourcePhases(lines: string[]): BracketSourceEntry[] {
  const results: BracketSourceEntry[] = [];
  let currentMilestoneInt: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const milestoneMatch = line.match(MILESTONE_HEADING_RE);
    if (milestoneMatch) {
      currentMilestoneInt = parseInt(milestoneMatch[1], 10);
      continue;
    }

    if (BRACKET_PHASE_HEADING_RE.test(line)) {
      results.push({ lineIndex: i, alreadyMigrated: true });
      continue;
    }

    // M-NN tested before legacy for explicit intent (the legacy regex would not
    // match `Phase 2-01:` anyway — the `-01` breaks its `\s*:` tail).
    const mnnMatch = line.match(MNN_PHASE_HEADING_RE);
    if (mnnMatch) {
      results.push({
        lineIndex: i,
        alreadyMigrated: false,
        source: 'mnn',
        milestoneInt: parseInt(mnnMatch[2], 10),
        mnnRest: mnnMatch[3],
        phaseName: mnnMatch[4].trim(),
        hashes: mnnMatch[1],
      });
      continue;
    }

    const phaseMatch = line.match(LEGACY_PHASE_HEADING_RE);
    if (phaseMatch) {
      results.push({
        lineIndex: i,
        alreadyMigrated: false,
        source: 'legacy',
        milestoneInt: currentMilestoneInt,
        legacyPhaseNum: phaseMatch[2],
        phaseName: phaseMatch[3].trim(),
        hashes: phaseMatch[1],
      });
    }
  }

  return results;
}

/**
 * Resolve each bracket source phase to (milestoneInt, token), keyed by lineIndex.
 * Legacy entries get a 1-based per-milestone sequential sub-index; M-NN entries
 * PRESERVE their integer (`2-01`→"01", `2-04-01`→"04.01").
 */
function assignBracketTokens(entries: BracketSourceEntry[]): Map<number, BracketMapping> {
  const milestoneCounters = new Map<number, number>();
  const mapping = new Map<number, BracketMapping>();

  for (const entry of entries) {
    if (entry.alreadyMigrated) continue;
    const m = entry.milestoneInt;
    if (m === null || m === undefined) continue;

    if (entry.source === 'mnn') {
      const token = entry.mnnRest!.split('-').map(s => bpad2(parseInt(s, 10))).join('.');
      mapping.set(entry.lineIndex, { lineIndex: entry.lineIndex, milestoneInt: m, token, source: 'mnn', mnnRest: entry.mnnRest });
    } else {
      const counter = (milestoneCounters.get(m) || 0) + 1;
      milestoneCounters.set(m, counter);
      mapping.set(entry.lineIndex, { lineIndex: entry.lineIndex, milestoneInt: m, token: bpad2(counter), source: 'legacy', legacyPhaseNum: entry.legacyPhaseNum });
    }
  }

  return mapping;
}

/** Strip a leading project_code prefix (legacy `GSD-…` or bracket `GSD.…`) before the numeric token. */
function stripCodePrefix(dirName: string): string {
  return dirName.replace(/^[A-Z]{1,6}[-.](?=\d)/i, '');
}

/** Sanitize a slug to a filesystem-safe token (no path separators / traversal). */
function sanitizeSlug(slug: string): string {
  return slug.replace(/[/\\]/g, '-').replace(/\.\./g, '-');
}

/**
 * Does an on-disk directory belong to this bracket mapping? Padding-tolerant.
 *   legacy (legacyPhaseNum="2.1"): "02.1-x" / "2.1-x" / "GSD-02.1-x"
 *   mnn (mnnRest="04-01", milestone 2): "02-04-01-x" / "GSD-2-04-01-x"
 */
function dirMatchesBracketMapping(dirName: string, e: BracketMapping): boolean {
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
  const norm = (s: string): string => {
    const dot = s.indexOf('.');
    const intPart = parseInt(s, 10);
    return dot !== -1 ? `${intPart}${s.slice(dot)}` : String(intPart);
  };
  return norm(m[1]) === norm(e.legacyPhaseNum!);
}

/**
 * Build the new BRACKET directory name. projectCode is REQUIRED (caller refuses
 * when it is null).  "01-setup" code GSD m 2 token 01 → "GSD.02-01-setup".
 */
function buildBracketDirName(oldDirName: string, code: string, milestoneInt: number, token: string): string {
  const stripped = stripCodePrefix(oldDirName);
  const slugMatch = stripped.match(/^\d+[A-Z]?(?:[.-]\d+)*-(.*)/i);
  const slug = sanitizeSlug(slugMatch ? slugMatch[1] : '');
  const mm = bpad2(milestoneInt);
  return slug ? `${code}.${mm}-${token}-${slug}` : `${code}.${mm}-${token}`;
}

/**
 * Compute a BRACKET migration plan (#612). Legacy `Phase N` and milestone-prefixed
 * `Phase M-NN` headings/dirs convert to the bracket terminal form `[CODE.MM] SS`
 * / `CODE.MM-SS-slug`. Bracket IDs require `[CODE.MM]`, so a repo with no
 * project_code HARD-REFUSES (throws). Pure — no filesystem mutation.
 */
function computeBracketPlan(cwd: string): MigrationPlan {
  const pDir = planningDir(cwd);
  const roadmapPath = path.join(pDir, 'ROADMAP.md');
  const configPath = path.join(pDir, 'config.json');
  const phasesDir = path.join(pDir, 'phases');
  const DONE: MigrationPlan = { alreadyMigrated: true, phases: [], roadmapEdits: [], crossRefEdits: [], targetConvention: 'bracket' };

  let configData: Record<string, unknown> = {};
  try {
    configData = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch { /* config may not exist */ }

  // Bracket is the terminal convention → config 'bracket' means already migrated.
  if (configData['phase_id_convention'] === 'bracket') return DONE;

  const projectCode = typeof configData['project_code'] === 'string' ? configData['project_code'] : null;

  let roadmapContent = '';
  try {
    roadmapContent = fs.readFileSync(roadmapPath, 'utf8');
  } catch {
    throw new Error(`ROADMAP.md not found at ${roadmapPath}`);
  }

  const lines = roadmapContent.split('\n');
  const parsed = parseBracketSourcePhases(lines);

  // Any bracket (terminal) heading present → already migrated.
  if (parsed.some(e => e.alreadyMigrated)) return DONE;

  const sourcePhases = parsed.filter(e => !e.alreadyMigrated);

  // B-migrator-real-layouts: single-milestone projects (HQ-NN) omit the `## vN.M`
  // heading, so legacy phases carry no enclosing milestone and would 0-op. Derive
  // the milestone from STATE.md `milestone:` instead of skipping.
  if (sourcePhases.some(e => e.source === 'legacy' && (e.milestoneInt === null || e.milestoneInt === undefined))) {
    let fallback: number | null = null;
    try {
      const stateRaw = fs.readFileSync(path.join(pDir, 'STATE.md'), 'utf8');
      const mm = stateRaw.match(/^milestone:\s*v?(\d+)/im);
      if (mm) fallback = parseInt(mm[1], 10);
    } catch { /* no STATE.md → leave as 0-op */ }
    if (fallback !== null) {
      for (const e of sourcePhases) {
        if (e.source === 'legacy' && (e.milestoneInt === null || e.milestoneInt === undefined)) e.milestoneInt = fallback;
      }
    }
  }

  const idMapping = assignBracketTokens(sourcePhases);

  // HARD-REFUSE: bracket IDs are [CODE.MM] — impossible without a project_code.
  if (idMapping.size > 0 && !projectCode) {
    throw new Error(
      'Cannot migrate to the bracket convention without a project_code in .planning/config.json '
      + '(bracket phase IDs are [CODE.MM] NN). Set "project_code" first, then re-run.',
    );
  }
  const code = projectCode as string;

  // Per-milestone legacy lookup for checklist resolution: milestoneInt → (normNum → token)
  const milestoneLegacyMap = new Map<number, Map<string, string>>();
  for (const e of idMapping.values()) {
    if (e.source !== 'legacy') continue;
    if (!milestoneLegacyMap.has(e.milestoneInt)) milestoneLegacyMap.set(e.milestoneInt, new Map());
    const mMap = milestoneLegacyMap.get(e.milestoneInt)!;
    const ln = e.legacyPhaseNum!;
    const intPart = parseInt(ln, 10);
    mMap.set(ln, e.token);
    mMap.set(String(intPart), e.token);
    mMap.set(bpad2(intPart), e.token);
    const dot = ln.indexOf('.');
    if (dot !== -1) {
      mMap.set(bpad2(intPart) + ln.slice(dot), e.token);
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
    const hit = ordered.find(o => !o.used && dirMatchesBracketMapping(dirName, o.e));
    if (!hit) continue;
    hit.used = true;
    const newDir = buildBracketDirName(dirName, code, hit.e.milestoneInt, hit.e.token);
    if (newDir !== dirName) {
      phases.push({
        oldId: hit.e.source === 'mnn' ? `${hit.e.milestoneInt}-${hit.e.mnnRest}` : (hit.e.legacyPhaseNum ?? ''),
        newId: `${code}.${bpad2(hit.e.milestoneInt)}-${hit.e.token}`,
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
    const head = `${entry.hashes} [${code}.${bpad2(map.milestoneInt)}] ${map.token}:`;
    const name = entry.phaseName ?? '';
    const newLine = name ? `${head} ${name}` : head;
    if (newLine !== oldLine) roadmapEdits.push({ lineIndex: entry.lineIndex, from: oldLine, to: newLine });
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
      const token = cmMnn[3].split('-').map(s => bpad2(parseInt(s, 10))).join('.');
      const newLine = `${cmMnn[1]}[${code}.${bpad2(m)}] ${token}${cmMnn[4]}` + line.slice(cmMnn[0].length);
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
        token = mMap.get(num) || mMap.get(String(intPart)) || mMap.get(bpad2(intPart));
      }
      if (!token) {
        // Fallback: single-milestone roadmaps carry no collision — first legacy map wins.
        for (const [mi, mm] of milestoneLegacyMap) {
          token = mm.get(num) || mm.get(String(intPart)) || mm.get(bpad2(intPart));
          if (token) { curMilestone = mi; break; }
        }
      }
      if (token && curMilestone !== null) {
        const newLine = `${cm[1]}[${code}.${bpad2(curMilestone)}] ${token}${cm[3]}` + line.slice(cm[0].length);
        roadmapEdits.push({ lineIndex: i, from: line, to: newLine });
      }
    }
  }

  // ── Cross-ref edits (STATE.md / PROJECT.md) — DEFERRED to PR 4 ───────────────
  // Bare prose `Phase 1:` carries no milestone context; in a multi-milestone repo
  // the same `from` maps to two bracket targets, and the string-replace apply would
  // assign every occurrence the FIRST milestone (the exact ambiguity #612 kills).
  // STATE/PROJECT reference emit belongs with the PR 4 write path. Empty here is
  // correct-and-incomplete, not wrong.
  const crossRefEdits: CrossRefEdit[] = [];

  return { alreadyMigrated: false, phases, roadmapEdits, crossRefEdits, targetConvention: 'bracket' };
}

// ─── computeMigrationPlan ─────────────────────────────────────────────────────

/**
 * Compute a migration plan without touching the filesystem.
 *
 * Dispatches on `options.convention`: 'bracket' → computeBracketPlan (#612,
 * additive); anything else → the milestone-prefixed migrator below (unchanged).
 */
function computeMigrationPlan(cwd: string, options: Record<string, unknown> = {}): MigrationPlan {
  if (options['convention'] === 'bracket') {
    return computeBracketPlan(cwd);
  }
  const pDir = planningDir(cwd);
  const roadmapPath = path.join(pDir, 'ROADMAP.md');
  const configPath = path.join(pDir, 'config.json');
  const phasesDir = path.join(pDir, 'phases');

  // ── Check config for existing convention ─────────────────────────────────
  let configData: Record<string, unknown> = {};
  try {
    configData = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch { /* config may not exist */ }

  if (configData['phase_id_convention'] === 'milestone-prefixed') {
    return { alreadyMigrated: true, phases: [], roadmapEdits: [], crossRefEdits: [] };
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

  // Check for any already-migrated headings
  const hasAnyMigrated = parsedPhases.some(e => e.alreadyMigrated);
  if (hasAnyMigrated) {
    return { alreadyMigrated: true, phases: [], roadmapEdits: [], crossRefEdits: [] };
  }

  const legacyPhases = parsedPhases.filter(e => !e.alreadyMigrated);
  const idMapping = assignSubIndices(legacyPhases);

  // Secondary lookup: (milestoneInt, normalizedLegacyNum) → newId
  // Used for directory renames and checklist rewrites where line position is unknown.
  // For simplicity, each milestone gets its own Map from legacy num → newId.
  const milestoneIdMap = new Map<number, Map<string, string>>(); // milestoneInt → Map<normalizedLegacyNum, newId>
  for (const [, entry] of idMapping) {
    if (!milestoneIdMap.has(entry.milestoneInt)) {
      milestoneIdMap.set(entry.milestoneInt, new Map<string, string>());
    }
    const mMap = milestoneIdMap.get(entry.milestoneInt)!;
    const legacyNum = entry.legacyPhaseNum;
    // Register integer forms (covers plain numeric and letter-suffix IDs)
    const intPart = parseInt(legacyNum, 10);
    const paddedLegacy = String(intPart).padStart(2, '0');
    const unpaddedLegacy = String(intPart);
    mMap.set(paddedLegacy, entry.newId);
    mMap.set(unpaddedLegacy, entry.newId);
    // Also register the original form and padded-integer+decimal form
    // so decimal IDs like "2.1" / "02.1" round-trip correctly.
    mMap.set(legacyNum, entry.newId);
    const dotIdx = legacyNum.indexOf('.');
    if (dotIdx !== -1) {
      const decimalSuffix = legacyNum.slice(dotIdx); // e.g. ".1"
      mMap.set(paddedLegacy + decimalSuffix, entry.newId);
      mMap.set(unpaddedLegacy + decimalSuffix, entry.newId);
    }
  }

  // ── Read existing phase directories ───────────────────────────────────────
  let existingDirs: string[] = [];
  try {
    existingDirs = fs.readdirSync(phasesDir).filter(d => {
      try {
        return fs.statSync(path.join(phasesDir, d)).isDirectory();
      } catch { return false; }
    });
  } catch { /* phases dir may not exist */ }

  // ── Build phase rename pairs ───────────────────────────────────────────────
  // Flat ordered list of (legacyPhaseNum, newId) in ROADMAP order, for dir matching.
  const orderedMappings = [...idMapping.values()].map(e => ({
    legacyPhaseNum: e.legacyPhaseNum,
    newId: e.newId,
    milestoneInt: e.milestoneInt,
    _used: false,
  }));

  // Note: if the same legacy phase number appears in multiple milestones (the exact legacy
  // ambiguity this tool is designed to resolve), directories are matched in ROADMAP document
  // order — the first ROADMAP occurrence of a given number claims the first matching disk dir.
  // This is the only unambiguous assignment strategy for flat dirs that carry no milestone
  // context. The dry-run output shows the complete rename plan so users can review before
  // applying with --apply.

  const phases: PhaseRename[] = [];
  for (const dirName of existingDirs) {
    const phaseNum = extractPhaseNumFromDir(dirName);
    if (!phaseNum) continue;

    const intPart = parseInt(phaseNum, 10);
    const paddedPhaseNum = String(intPart).padStart(2, '0');
    const unpaddedPhaseNum = String(intPart);
    // For decimal IDs like "02.1", also try "2.1"
    const dotIdx = phaseNum.indexOf('.');
    const decimalUnpadded = dotIdx !== -1 ? unpaddedPhaseNum + phaseNum.slice(dotIdx) : null;

    // Find the first unused mapping whose legacy number matches (exact, padded, unpadded, or decimal)
    const found = orderedMappings.find(m => !m._used && (
      m.legacyPhaseNum === phaseNum ||
      m.legacyPhaseNum === paddedPhaseNum ||
      m.legacyPhaseNum === unpaddedPhaseNum ||
      (decimalUnpadded && m.legacyPhaseNum === decimalUnpadded)
    ));
    if (!found) continue;
    found._used = true;

    const newDirName = buildNewDirName(dirName, found.newId, projectCode);
    if (newDirName !== dirName) {
      phases.push({
        oldId: phaseNum,
        newId: found.newId,
        oldDir: dirName,
        newDir: newDirName,
      });
    }
  }

  // ── Build ROADMAP.md line edits ────────────────────────────────────────────
  const roadmapEdits: RoadmapEdit[] = [];

  for (const entry of legacyPhases) {
    // Use lineIndex as the canonical key (not legacyPhaseNum, which may collide across milestones)
    const mapping = idMapping.get(entry.lineIndex);
    if (!mapping) continue;

    // Rewrite heading line: "### Phase N: Name" → "### Phase M-NN: Name"
    const oldLine = lines[entry.lineIndex];
    const newLine = oldLine.replace(
      /^(#{2,4}\s*(?:\[[^\]]+\]\s*)?Phase\s+)\d+[A-Z]?(?:\.\d+)*(\s*:)/i,
      `$1${mapping.newId}$2`
    );
    if (newLine !== oldLine) {
      roadmapEdits.push({ lineIndex: entry.lineIndex, from: oldLine, to: newLine });
    }
  }

  // Rewrite checklist lines in ROADMAP.md — use milestone context to resolve collisions.
  let currentChecklistMilestone: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track enclosing milestone section for context-aware lookup
    const milestoneHeadingMatch = line.match(MILESTONE_HEADING_RE);
    if (milestoneHeadingMatch) {
      currentChecklistMilestone = parseInt(milestoneHeadingMatch[1], 10);
    }

    // Already in roadmapEdits? skip
    if (roadmapEdits.some(e => e.lineIndex === i)) continue;

    // Match checklist items: "- [ ] **Phase N:**" or "- [x] Phase N:"  (also decimal)
    const checklistMatch = line.match(/^(\s*-\s*\[[ x]\]\s*\*{0,2}Phase\s+)(\d+[A-Z]?(?:\.\d+)*)(\s*[:\s*])/i);
    if (checklistMatch) {
      const legacyNum = checklistMatch[2];
      const cIntPart = parseInt(legacyNum, 10);
      const paddedLegacy = String(cIntPart).padStart(2, '0');
      const unpaddedLegacy = String(cIntPart);
      const cDotIdx = legacyNum.indexOf('.');
      const paddedLegacyDecimal = cDotIdx !== -1 ? paddedLegacy + legacyNum.slice(cDotIdx) : null;

      // Prefer milestone-context lookup (avoids collision across milestones)
      let newId: string | undefined;
      if (currentChecklistMilestone !== null && milestoneIdMap.has(currentChecklistMilestone)) {
        const mMap = milestoneIdMap.get(currentChecklistMilestone)!;
        newId = mMap.get(legacyNum) || mMap.get(paddedLegacy) || mMap.get(unpaddedLegacy);
        if (!newId && paddedLegacyDecimal) newId = mMap.get(paddedLegacyDecimal);
      }
      if (!newId) {
        // Fallback: use ordered flat list (no milestone collision in this roadmap)
        const found = orderedMappings.find(m =>
          m.legacyPhaseNum === legacyNum ||
          m.legacyPhaseNum === paddedLegacy ||
          m.legacyPhaseNum === unpaddedLegacy ||
          (paddedLegacyDecimal && m.legacyPhaseNum === paddedLegacyDecimal)
        );
        if (found) newId = found.newId;
      }

      if (newId) {
        const newLine = line.replace(
          /^(\s*-\s*\[[ x]\]\s*\*{0,2}Phase\s+)\d+[A-Z]?(?:\.\d+)*(\s*[:\s*])/i,
          `$1${newId}$2`
        );
        if (newLine !== line) {
          roadmapEdits.push({ lineIndex: i, from: line, to: newLine });
        }
      }
    }
  }

  // ── Build cross-ref edits for STATE.md and PROJECT.md ────────────────────
  const crossRefEdits: CrossRefEdit[] = [];
  const crossRefFiles = ['STATE.md', 'PROJECT.md'];

  for (const fileName of crossRefFiles) {
    const filePath = path.join(pDir, fileName);
    if (!fs.existsSync(filePath)) continue;

    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Iterate using orderedMappings (ROADMAP order) — idMapping is now keyed by lineIndex.
    for (const m of orderedMappings) {
      const legacyNum = m.legacyPhaseNum;
      const xIntPart = parseInt(legacyNum, 10);
      const paddedNum = String(xIntPart).padStart(2, '0');
      const unpaddedNum = String(xIntPart);
      // Decimal suffix (e.g. ".1" from "2.1") — preserve in cross-ref patterns
      const xDotIdx = legacyNum.indexOf('.');
      const decimalSuffix = xDotIdx !== -1 ? legacyNum.slice(xDotIdx) : '';

      // Rewrite project_code-prefixed references: "GSD-01-" → "GSD-01-02-"
      if (projectCode) {
        const [milestoneStr, subStr] = m.newId.split('-');
        const paddedMilestone = String(parseInt(milestoneStr, 10)).padStart(2, '0');
        const prefixedNew = `${projectCode}-${paddedMilestone}-${subStr}-`;
        // Try both padded and original forms as old prefix
        for (const oldNum of new Set([paddedNum + decimalSuffix, unpaddedNum + decimalSuffix, paddedNum, unpaddedNum])) {
          const prefixedOld = `${projectCode}-${oldNum}-`;
          if (fileContent.includes(prefixedOld)) {
            crossRefEdits.push({ file: fileName, from: prefixedOld, to: prefixedNew });
          }
        }
      }

      // Rewrite prose references: "Phase 1:" → "Phase 1-01:", "Phase 2.1:" → "Phase 1-02:"
      const proseOldPatterns = new Set([
        `Phase ${unpaddedNum}${decimalSuffix}:`,
        `Phase ${paddedNum}${decimalSuffix}:`,
        `Phase ${legacyNum}:`,
      ]);
      for (const proseOld of proseOldPatterns) {
        if (fileContent.includes(proseOld)) {
          const proseNew = `Phase ${m.newId}:`;
          crossRefEdits.push({ file: fileName, from: proseOld, to: proseNew });
        }
      }
    }
  }

  return {
    alreadyMigrated: false,
    phases,
    roadmapEdits,
    crossRefEdits,
  };
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

  // Dry-run prints the full plan (including alreadyMigrated:true) so callers can
  // see "nothing to do" rather than silent empty output, then exits without mutating.
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
    gitStatus = execSync('git status --porcelain', { cwd, encoding: 'utf8', windowsHide: true });
  } catch (err) {
    throw new Error(`git status failed: ${(err as Error).message}`);
  }
  if (gitStatus.trim().length > 0) {
    throw new Error('Working tree is dirty. Commit or stash changes before migrating.');
  }

  const pDir = planningDir(cwd);
  const phasesDir = path.join(pDir, 'phases');
  const roadmapPath = path.join(pDir, 'ROADMAP.md');
  const configPath = path.join(pDir, 'config.json');

  const renamedDirs: string[] = [];
  const editedFiles: string[] = [];

  // Surgical, git-independent rollback state (#1542). A `git reset --hard` +
  // `git clean` rollback restores NOTHING for a gitignored `.planning/`
  // (commit_docs:false — the default) and is a whole-repo operation besides.
  // Instead, record the exact renames performed and snapshot each file before
  // rewriting it, then undo precisely those on failure — correct whether
  // `.planning/` is git-tracked or ignored.
  const performedRenames: Array<{ oldPath: string; newPath: string }> = [];
  const fileBackups = new Map<string, { existed: boolean; content: string }>();
  const snapshotFile = (filePath: string): void => {
    if (fileBackups.has(filePath)) return;
    try {
      fileBackups.set(filePath, { existed: true, content: fs.readFileSync(filePath, 'utf8') });
    } catch {
      fileBackups.set(filePath, { existed: false, content: '' });
    }
  };

  try {
    // 1. Rename phase directories
    for (const phaseEntry of plan.phases) {
      const oldPath = path.join(phasesDir, phaseEntry.oldDir);
      const newPath = path.join(phasesDir, phaseEntry.newDir);
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        performedRenames.push({ oldPath, newPath });
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

      snapshotFile(roadmapPath);
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
        snapshotFile(filePath);
        fs.writeFileSync(filePath, content, 'utf8');
        editedFiles.push(fileName);
      }
    }

    // 4. Update config.json: set phase_id_convention to the plan's target.
    // Absent ⇒ 'milestone-prefixed' (the legacy default) so milestone-prefixed
    // applies write the identical value they always did; bracket plans set 'bracket'.
    let configData: Record<string, unknown> = {};
    try {
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch { /* config may not exist yet */ }

    configData['phase_id_convention'] = plan.targetConvention || 'milestone-prefixed';
    snapshotFile(configPath);
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf8');
    editedFiles.push('config.json');

  } catch (err) {
    // Surgical rollback: reverse the renames (newest first) and restore every
    // file we snapshotted (deleting files that did not previously exist). This
    // actually restores `.planning/` regardless of git tracking — so the
    // "rolled back" claim is truthful — and never touches anything else.
    for (let i = performedRenames.length - 1; i >= 0; i--) {
      const { oldPath, newPath } = performedRenames[i];
      try {
        if (fs.existsSync(newPath)) fs.renameSync(newPath, oldPath);
      } catch { /* best-effort */ }
    }
    for (const [filePath, backup] of fileBackups) {
      try {
        if (backup.existed) fs.writeFileSync(filePath, backup.content, 'utf8');
        else if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch { /* best-effort */ }
    }
    throw new Error(`Migration failed and rolled back: ${(err as Error).message}`);
  }

  return { applied: true, renamedDirs, editedFiles };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export = {
  computeMigrationPlan,
  applyMigration,
};
