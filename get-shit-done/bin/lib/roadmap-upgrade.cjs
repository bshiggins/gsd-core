'use strict';

/**
 * Roadmap Upgrade — Bracket-native migrator (WAVE 3, SPEC §4.4).
 *
 * Converts BOTH legacy (`Phase N` / `01-slug`) AND M-NN (`Phase 2-01` /
 * `GSD-02-01-slug` / `milestone-prefixed` config) projects to the bracket-native
 * convention. Bracket is the SOLE terminal/skip state; M-NN is now a SOURCE.
 *
 *   - Display:   `### [GSD.02] 01: Name`
 *   - Directory: `GSD.02-01-slug` (dot joins project↔milestone, single hyphen
 *                joins milestone-prefix↔phase token)
 *   - Milestone section heading: `## [GSD.02] Name` (ADDENDUM-3: no `vX.0`, no emoji)
 *
 * Two source-specific transforms (route by classification):
 *   - LEGACY → bracket  : RENUMBER sequentially per milestone (Q2). The legacy
 *                         free integer is DISCARDED as the on-disk id; an
 *                         old→new mapping is printed so external links update.
 *   - M-NN → bracket    : NOTATION LIFT — preserve the phase integer. The
 *                         milestone comes from the M-NN token itself (it already
 *                         solved milestone scoping). `Phase 2-04-01` →
 *                         `[GSD.02] 04.01`; dir `GSD-02-04-01-slug` →
 *                         `GSD.02-04.01-slug` (hyphen-deep → dot-deep).
 *
 * The Wave-1 emit helpers live in core.cjs and are imported (NOT re-implemented).
 *
 * Safety scaffolding (preserved verbatim from the legacy migrator):
 *   - dry-run default-true with JSON plan dump
 *   - clean-working-tree gate (`git status --porcelain`)
 *   - HEAD-sha capture
 *   - on error: `git reset --hard {sha}` + `git clean -fd .planning/phases/` rollback
 *   - idempotence: re-run on bracket → `{alreadyMigrated:true}`
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { planningDir } = require('./planning-workspace.cjs');
const { extractPhaseToken, isSentinelPhaseId } = require('./core.cjs');
const { phaseIdCard } = require('./phase-id-card.cjs');

// ─── Regex helpers ────────────────────────────────────────────────────────────

// LEGACY phase heading: `### Phase N: Name`  (bare int / decimal `2.1`, optional
// letter suffix `12A`). An optional `[token]` prefix is tolerated. A hyphen
// sub-token (`Phase 2-01:`) is M-NN, NOT legacy — see MNN_PHASE_HEADING_RE.
const LEGACY_PHASE_HEADING_RE = /^(#{2,4})\s*(?:\[[^\]]+\]\s*)?Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:(.*)/i;

// M-NN phase heading: `### Phase 2-01: Name`  (hyphen-joined milestone-prefix +
// phase, optionally deep `2-04-01`). Captures the full hyphen token.
const MNN_PHASE_HEADING_RE = /^(#{2,4})\s*(?:\[[^\]]+\]\s*)?Phase\s+(\d+(?:-\d+)+)\s*:(.*)/i;

// BRACKET phase heading (terminal / skip target): `### [GSD.02] 05: Name`.
// The `.\d+` INSIDE the bracket is what distinguishes bracket from M-NN's
// project-only `[GSD]`. Detecting any of these → the project is already migrated.
const BRACKET_PHASE_HEADING_RE = /^#{2,4}\s*\[[A-Z][A-Z0-9]*\.\d+\]\s+\d+[A-Z]?(?:\.\d+)*\s*:/i;

// BRACKET milestone section heading: `## [GSD.02] Name` (bracket + name, no `NN:`).
const BRACKET_SECTION_HEADING_RE = /^#{1,3}\s+\[[A-Z][A-Z0-9]*\.\d+\]\s+(?!\d+[A-Z]?(?:[.-]\d+)*\s*:)/i;

// LEGACY milestone section heading: `## v1.0`, `## Roadmap v2.0`, `## ✅ v1.0`,
// `## [GSD] v1.0`, `## Milestone v1.0 Foundation`, etc. Captures the major int.
const MILESTONE_HEADING_RE = /^(#{1,3})\s+(?:\[[^\]]+\]\s+)?(?:Roadmap\s+|Milestone\s+|[✅🚧]\s*)*v(\d+)\.(\d+)(?:\s|:|$)/iu;

// Checklist phase references in ROADMAP.md:
//   `- [ ] **Phase N:**`  /  `- [x] Phase 2-01:`  (legacy or M-NN)
const CHECKLIST_PHASE_RE = /^(\s*-\s*\[[ x]\]\s*\*{0,2}Phase\s+)(\d+[A-Z]?(?:[.-]\d+)*)(\s*[:*])/i;

// ─── Pure computation helpers ─────────────────────────────────────────────────

/** Read project_code from config.json if present. */
function readConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

/** Pad an integer (or numeric string) to 2 digits. */
function pad2(n) {
  return String(parseInt(n, 10)).padStart(2, '0');
}

/**
 * Read a phase directory name and return its numeric token (stripping an
 * optional project_code prefix). Used only for LEGACY dir matching.
 *   "GSD-01-setup" → "01", "01-setup" → "01", "02.1-hotfix" → "02.1"
 */
function extractLegacyPhaseNumFromDir(dirName) {
  const stripped = dirName.replace(/^[A-Z]{1,6}-(?=\d)/i, '');
  const m = stripped.match(/^(\d+[A-Z]?(?:\.\d+)*)(?:-|$)/i);
  return m ? m[1] : null;
}

/**
 * Classify a project's phase-id convention by inspecting config + ROADMAP.
 *
 * Detection precedence (SPEC §4.4):
 *   1. config `phase_id_convention === 'bracket'`  → 'bracket' (skip)
 *   2. ANY bracket phase heading present           → 'bracket' (skip)
 *   3. ANY M-NN phase heading / `milestone-prefixed` config / M-NN dir → 'mnn'
 *   4. otherwise (legacy `Phase N` / `01-slug`)    → 'legacy'
 *
 * @returns {'bracket'|'mnn'|'legacy'}
 */
function classifyConvention(lines, config, existingDirs) {
  if (config.phase_id_convention === 'bracket') return 'bracket';
  if (lines.some(l => BRACKET_PHASE_HEADING_RE.test(l))) return 'bracket';

  if (config.phase_id_convention === 'milestone-prefixed') return 'mnn';
  if (lines.some(l => MNN_PHASE_HEADING_RE.test(l))) return 'mnn';
  // M-NN on-disk dir: `GSD-02-01-slug` / `02-01-slug` — a milestone-prefix int,
  // a hyphen, a phase int, then a slug. Distinguish from legacy `01-slug` by the
  // presence of the second hyphen-joined integer segment.
  const mnnDirRe = /^(?:[A-Z]{1,6}-)?\d+-\d+(?:-\d+)*-\S/i;
  const looksMnnDir = existingDirs.some(d => mnnDirRe.test(d) && !/^[A-Z]{1,6}\.\d+-/i.test(d));
  if (looksMnnDir) return 'mnn';

  return 'legacy';
}

// ─── Legacy parsing + renumber ─────────────────────────────────────────────────

/**
 * Parse legacy ROADMAP phase entries with their enclosing milestone int.
 * Returns { lineIndex, headingLine, milestoneInt, legacyPhaseNum, phaseName, hashes }.
 */
function parseLegacyPhases(lines) {
  const results = [];
  let currentMilestoneInt = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const milestoneMatch = line.match(MILESTONE_HEADING_RE);
    if (milestoneMatch) {
      currentMilestoneInt = parseInt(milestoneMatch[2], 10);
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
      });
    }
  }
  return results;
}

/**
 * Assign sequential per-milestone sub-indices (RENUMBER, Q2). Keyed by
 * lineIndex so two `Phase 1` headings in different milestones each get their
 * own correct SS (the collision the bracket convention is designed to resolve).
 *
 * SENTINEL phases (top int 0 / 999 — research spikes, backlog) are left ALONE:
 * they keep their original integer as the bracket token, do NOT consume the SS
 * counter, and so still resolve + flag as sentinels post-migration. A `Phase
 * 999` interleaved with real `Phase 1`/`Phase 2` therefore yields `01`, `999`,
 * `02` — the sentinel does not eat a real slot.
 *
 * Returns Map<lineIndex, { milestoneInt, subIndex (int|null), ss (padded token),
 * legacyPhaseNum, sentinel (bool) }>.
 */
function assignSubIndices(phaseEntries) {
  const counters = new Map(); // milestoneInt → counter
  const mapping = new Map();

  for (const entry of phaseEntries) {
    const m = entry.milestoneInt;
    if (m === null || m === undefined) continue;

    if (isSentinelPhaseId(entry.legacyPhaseNum)) {
      // Preserve the sentinel integer verbatim as the token; skip the counter.
      mapping.set(entry.lineIndex, {
        milestoneInt: m,
        subIndex: null,
        ss: pad2(entry.legacyPhaseNum),
        legacyPhaseNum: entry.legacyPhaseNum,
        sentinel: true,
      });
      continue;
    }

    const counter = (counters.get(m) || 0) + 1;
    counters.set(m, counter);

    mapping.set(entry.lineIndex, {
      milestoneInt: m,
      subIndex: counter,
      ss: pad2(counter),
      legacyPhaseNum: entry.legacyPhaseNum,
      sentinel: false,
    });
  }
  return mapping;
}

/**
 * Build the LEGACY bracket dir name from old name + assigned mapping.
 *   old "01-setup", m=2, ss="01", code "GSD" → "GSD.02-01-setup"
 *   old "01-setup", m=2, ss="01", code null  → "01-setup"   (degenerate: no MM prefix)
 */
function buildLegacyBracketDir(oldDirName, milestoneInt, ss, projectCode) {
  const stripped = oldDirName.replace(/^[A-Z]{1,6}-(?=\d)/i, '');
  const slugMatch = stripped.match(/^\d+[A-Z]?(?:\.\d+)*-(.*)/i);
  const slug = slugMatch ? slugMatch[1] : '';

  if (projectCode) {
    const base = slug ? `${ss}-${slug}` : ss;
    return `${projectCode}.${pad2(milestoneInt)}-${base}`;
  }
  // Degenerate (no project_code): no milestone prefix is possible on disk — the
  // dir carries only the renumbered token + slug.
  return slug ? `${ss}-${slug}` : ss;
}

/**
 * Compute the legacy → bracket migration plan.
 */
function computeLegacyPlan(lines, existingDirs, projectCode, pDir) {
  const legacyPhases = parseLegacyPhases(lines);
  const idMapping = assignSubIndices(legacyPhases);

  // milestoneInt → Map<normalizedLegacyNum, mapping-entry> for collision-safe lookup.
  const milestoneIdMap = new Map();
  for (const [, entry] of idMapping) {
    if (!milestoneIdMap.has(entry.milestoneInt)) milestoneIdMap.set(entry.milestoneInt, new Map());
    const mMap = milestoneIdMap.get(entry.milestoneInt);
    const legacyNum = entry.legacyPhaseNum;
    const intPart = parseInt(legacyNum, 10);
    for (const k of new Set([legacyNum, pad2(intPart), String(intPart)])) mMap.set(k, entry);
    const dotIdx = legacyNum.indexOf('.');
    if (dotIdx !== -1) {
      const suffix = legacyNum.slice(dotIdx);
      mMap.set(pad2(intPart) + suffix, entry);
      mMap.set(String(intPart) + suffix, entry);
    }
  }

  // Ordered flat list for dir matching (ROADMAP order; first occurrence claims dir).
  const ordered = [...idMapping.values()].map(e => ({ ...e, _used: false }));

  // ── Dir renames + old→new id mapping ──
  const phases = [];
  for (const dirName of existingDirs) {
    const phaseNum = extractLegacyPhaseNumFromDir(dirName);
    if (!phaseNum) continue;
    const intPart = parseInt(phaseNum, 10);
    const dotIdx = phaseNum.indexOf('.');
    const decimalUnpadded = dotIdx !== -1 ? String(intPart) + phaseNum.slice(dotIdx) : null;

    const found = ordered.find(m => !m._used && (
      m.legacyPhaseNum === phaseNum ||
      m.legacyPhaseNum === pad2(intPart) ||
      m.legacyPhaseNum === String(intPart) ||
      (decimalUnpadded && m.legacyPhaseNum === decimalUnpadded)
    ));
    if (!found) continue;
    found._used = true;

    const newDirName = buildLegacyBracketDir(dirName, found.milestoneInt, found.ss, projectCode);
    if (newDirName !== dirName) {
      phases.push({
        oldId: phaseNum,
        newId: projectCode ? `[${projectCode}.${pad2(found.milestoneInt)}] ${found.ss}` : found.ss,
        oldDir: dirName,
        newDir: newDirName,
      });
    }
  }

  // ── ROADMAP.md line edits ──
  const roadmapEdits = [];

  // Milestone SECTION headings: `## v1.0 Foundation` → `## [CODE.01] Foundation`
  // (ADDENDUM-3: drop the v-literal + emoji). Only when a project code exists —
  // without one a bracket section is impossible, so leave the legacy heading.
  if (projectCode) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(MILESTONE_HEADING_RE);
      if (!m) continue;
      const milestoneInt = parseInt(m[2], 10);
      const newLine = rewriteMilestoneSection(lines[i], m[1], projectCode, milestoneInt);
      if (newLine && newLine !== lines[i]) {
        roadmapEdits.push({ lineIndex: i, from: lines[i], to: newLine });
      }
    }
  }

  // Phase headings: `### Phase N: Name` → `### [CODE.MM] SS: Name` (or bare `### SS: Name`).
  for (const entry of legacyPhases) {
    const mapping = idMapping.get(entry.lineIndex);
    if (!mapping) continue;
    const oldLine = lines[entry.lineIndex];
    const display = projectCode
      ? `[${projectCode}.${pad2(mapping.milestoneInt)}] ${mapping.ss}`
      : mapping.ss;
    const newLine = oldLine.replace(
      /^(#{2,4})\s*(?:\[[^\]]+\]\s*)?Phase\s+\d+[A-Z]?(?:\.\d+)*\s*:(.*)$/i,
      `$1 ${display}:$2`
    );
    if (newLine !== oldLine) roadmapEdits.push({ lineIndex: entry.lineIndex, from: oldLine, to: newLine });
  }

  // Checklist phase references.
  let currentChecklistMilestone = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mh = line.match(MILESTONE_HEADING_RE);
    if (mh) { currentChecklistMilestone = parseInt(mh[2], 10); continue; }
    if (roadmapEdits.some(e => e.lineIndex === i)) continue;

    const cm = line.match(CHECKLIST_PHASE_RE);
    if (!cm) continue;
    const legacyNum = cm[2];
    if (/-/.test(legacyNum)) continue; // M-NN token — not a legacy checklist item
    const intPart = parseInt(legacyNum, 10);
    let entry;
    if (currentChecklistMilestone !== null && milestoneIdMap.has(currentChecklistMilestone)) {
      const mMap = milestoneIdMap.get(currentChecklistMilestone);
      entry = mMap.get(legacyNum) || mMap.get(pad2(intPart)) || mMap.get(String(intPart));
    }
    if (!entry) entry = ordered.find(m => m.legacyPhaseNum === legacyNum || m.legacyPhaseNum === pad2(intPart) || m.legacyPhaseNum === String(intPart));
    if (!entry) continue;
    const display = projectCode ? `[${projectCode}.${pad2(entry.milestoneInt)}] ${entry.ss}` : entry.ss;
    const newLine = line.replace(CHECKLIST_PHASE_RE, `$1${display}$3`)
      // The replacement re-inserts the literal "Phase " word from the capture
      // group prefix; strip it (bracket form carries no "Phase" word).
      .replace(/(-\s*\[[ x]\]\s*\*{0,2})Phase\s+(\[)/i, '$1$2')
      .replace(/(-\s*\[[ x]\]\s*\*{0,2})Phase\s+(\d)/i, '$1$2');
    if (newLine !== line) roadmapEdits.push({ lineIndex: i, from: line, to: newLine });
  }

  // ── Cross-ref edits for STATE.md / PROJECT.md ──
  const crossRefEdits = buildLegacyCrossRefs(ordered, projectCode, pDir);

  return { phases, roadmapEdits, crossRefEdits, mapping: ordered, kind: 'legacy' };
}

/** Build a bracket milestone section heading, preserving the name after the version literal. */
function rewriteMilestoneSection(line, hashes, projectCode, milestoneInt) {
  // Capture the descriptive NAME after the version literal.
  // `## v1.0 Foundation` → name "Foundation"; `## Milestone v2.0: Core` → "Core".
  const m = line.match(/^#{1,3}\s+(?:\[[^\]]+\]\s+)?(?:Roadmap\s+|Milestone\s+|[✅🚧]\s*)*v\d+\.\d+\s*[:\-]?\s*(.*)$/iu);
  const name = (m && m[1] ? m[1].trim() : '') || 'Milestone';
  return `${hashes} [${projectCode}.${pad2(milestoneInt)}] ${name}`;
}

/** Legacy cross-ref rewrites (dir-prefix mentions + prose `Phase N:`). */
function buildLegacyCrossRefs(ordered, projectCode, pDir) {
  const crossRefEdits = [];
  for (const fileName of ['STATE.md', 'PROJECT.md']) {
    const filePath = path.join(pDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');

    for (const m of ordered) {
      const legacyNum = m.legacyPhaseNum;
      const intPart = parseInt(legacyNum, 10);
      const dotIdx = legacyNum.indexOf('.');
      const decimalSuffix = dotIdx !== -1 ? legacyNum.slice(dotIdx) : '';

      // Dir-prefix mentions: `GSD-01-` → `GSD.02-01-`
      if (projectCode) {
        const prefixedNew = `${projectCode}.${pad2(m.milestoneInt)}-${m.ss}-`;
        for (const oldNum of new Set([pad2(intPart) + decimalSuffix, String(intPart) + decimalSuffix])) {
          const prefixedOld = `${projectCode}-${oldNum}-`;
          if (content.includes(prefixedOld)) crossRefEdits.push({ file: fileName, from: prefixedOld, to: prefixedNew });
        }
      }

      // Prose: `Phase 1:` → `[GSD.01] 01:` (or bare `01:` with no project code).
      const display = projectCode ? `[${projectCode}.${pad2(m.milestoneInt)}] ${m.ss}` : m.ss;
      for (const proseOld of new Set([`Phase ${String(intPart)}${decimalSuffix}:`, `Phase ${pad2(intPart)}${decimalSuffix}:`, `Phase ${legacyNum}:`])) {
        if (content.includes(proseOld)) crossRefEdits.push({ file: fileName, from: proseOld, to: `${display}:` });
      }
    }
  }
  return crossRefEdits;
}

// ─── M-NN parsing + notation lift ──────────────────────────────────────────────

/**
 * Lift an M-NN hyphen token to an all-dot bracket form.
 *   "2-01"    → { milestoneInt: 2, token: "01" }
 *   "2-04-01" → { milestoneInt: 2, token: "04.01" }
 */
function liftMnnToken(hyphenToken) {
  const parts = hyphenToken.split('-');
  const milestoneInt = parseInt(parts[0], 10);
  const token = parts.slice(1).map(p => pad2(p)).join('.');
  return { milestoneInt, token };
}

/**
 * Compute the M-NN → bracket migration plan (NOTATION LIFT — preserve integers).
 */
function computeMnnPlan(lines, existingDirs, projectCode, pDir) {
  const roadmapEdits = [];

  // Milestone SECTION headings → bracket (same as legacy, code-gated).
  if (projectCode) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(MILESTONE_HEADING_RE);
      if (!m) continue;
      const milestoneInt = parseInt(m[2], 10);
      const newLine = rewriteMilestoneSection(lines[i], m[1], projectCode, milestoneInt);
      if (newLine && newLine !== lines[i]) roadmapEdits.push({ lineIndex: i, from: lines[i], to: newLine });
    }
  }

  // M-NN phase headings → bracket display.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MNN_PHASE_HEADING_RE);
    if (!m) continue;
    const { milestoneInt, token } = liftMnnToken(m[2]);
    const display = projectCode ? `[${projectCode}.${pad2(milestoneInt)}] ${token}` : token;
    const newLine = lines[i].replace(
      /^(#{2,4})\s*(?:\[[^\]]+\]\s*)?Phase\s+\d+(?:-\d+)+\s*:(.*)$/i,
      `$1 ${display}:$2`
    );
    if (newLine !== lines[i]) roadmapEdits.push({ lineIndex: i, from: lines[i], to: newLine });
  }

  // Checklist M-NN refs → bracket.
  for (let i = 0; i < lines.length; i++) {
    if (roadmapEdits.some(e => e.lineIndex === i)) continue;
    const cm = lines[i].match(CHECKLIST_PHASE_RE);
    if (!cm || !/-/.test(cm[2])) continue;
    const { milestoneInt, token } = liftMnnToken(cm[2]);
    const display = projectCode ? `[${projectCode}.${pad2(milestoneInt)}] ${token}` : token;
    const newLine = lines[i].replace(CHECKLIST_PHASE_RE, `$1${display}$3`)
      .replace(/(-\s*\[[ x]\]\s*\*{0,2})Phase\s+(\[)/i, '$1$2')
      .replace(/(-\s*\[[ x]\]\s*\*{0,2})Phase\s+(\d)/i, '$1$2');
    if (newLine !== lines[i]) roadmapEdits.push({ lineIndex: i, from: lines[i], to: newLine });
  }

  // ── Dir renames: `GSD-02-04-01-slug` → `GSD.02-04.01-slug` ──
  const phases = [];
  const mapping = [];
  // M-NN dir token: optional code prefix, then `MM-NN[-NN]`, then slug.
  const mnnDirRe = /^([A-Z]{1,6}-)?(\d+)-(\d+(?:-\d+)*)-(.*)$/i;
  for (const dirName of existingDirs) {
    if (/^[A-Z]{1,6}\.\d+-/i.test(dirName)) continue; // already bracket
    const dm = dirName.match(mnnDirRe);
    if (!dm) continue;
    const milestoneInt = parseInt(dm[2], 10);
    const phaseToken = dm[3].split('-').map(p => pad2(p)).join('.');
    const slug = dm[4];
    const code = projectCode || (dm[1] ? dm[1].slice(0, -1) : '');
    const newDir = code
      ? `${code}.${pad2(milestoneInt)}-${phaseToken}-${slug}`
      : `${pad2(milestoneInt)}-${phaseToken}-${slug}`;
    if (newDir !== dirName) {
      const display = code ? `[${code}.${pad2(milestoneInt)}] ${phaseToken}` : phaseToken;
      phases.push({ oldId: `${dm[2]}-${dm[3]}`, newId: display, oldDir: dirName, newDir });
      mapping.push({ milestoneInt, token: phaseToken, oldHyphen: `${dm[2]}-${dm[3]}` });
    }
  }

  // ── Cross-ref edits for STATE.md / PROJECT.md ──
  const crossRefEdits = [];
  for (const fileName of ['STATE.md', 'PROJECT.md']) {
    const filePath = path.join(pDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');

    // Dir-prefix mentions: `GSD-02-01-` → `GSD.02-01-`; `GSD-02-04-01-` → `GSD.02-04.01-`.
    if (projectCode) {
      const dirMentionRe = new RegExp(`${projectCode}-(\\d+)-(\\d+(?:-\\d+)*)-`, 'gi');
      const seen = new Set();
      let mm;
      while ((mm = dirMentionRe.exec(content)) !== null) {
        const from = mm[0];
        if (seen.has(from)) continue;
        seen.add(from);
        const milestoneInt = parseInt(mm[1], 10);
        const phaseToken = mm[2].split('-').map(p => pad2(p)).join('.');
        crossRefEdits.push({ file: fileName, from, to: `${projectCode}.${pad2(milestoneInt)}-${phaseToken}-` });
      }
    }

    // Prose: `Phase 2-01:` → `[GSD.02] 01:`.
    const proseRe = /Phase\s+(\d+(?:-\d+)+):/gi;
    const seenProse = new Set();
    let pm;
    while ((pm = proseRe.exec(content)) !== null) {
      const from = pm[0];
      if (seenProse.has(from)) continue;
      seenProse.add(from);
      const { milestoneInt, token } = liftMnnToken(pm[1]);
      const display = projectCode ? `[${projectCode}.${pad2(milestoneInt)}] ${token}` : token;
      crossRefEdits.push({ file: fileName, from, to: `${display}:` });
    }
  }

  return { phases, roadmapEdits, crossRefEdits, mapping, kind: 'mnn' };
}

// ─── STATE.md milestone: ensure ───────────────────────────────────────────────

/**
 * Determine the milestone value to write into STATE.md frontmatter (v-string
 * form, plumbing decision). Prefers an existing `milestone:` value; otherwise
 * derives the highest milestone int seen in the ROADMAP (legacy v-literal or
 * M-NN token) and emits `vN.0`. Returns null if none can be derived.
 */
function deriveMilestoneVString(lines, pDir) {
  const statePath = path.join(pDir, 'STATE.md');
  if (fs.existsSync(statePath)) {
    const content = fs.readFileSync(statePath, 'utf8');
    const m = content.match(/^milestone:\s*(.+)$/m);
    if (m) {
      const val = m[1].trim().replace(/^["']|["']$/g, '');
      if (val) return val;
    }
  }
  let maxInt = null;
  for (const line of lines) {
    const mh = line.match(MILESTONE_HEADING_RE);
    if (mh) { const v = parseInt(mh[2], 10); if (maxInt === null || v > maxInt) maxInt = v; continue; }
    const mnn = line.match(MNN_PHASE_HEADING_RE);
    if (mnn) { const v = parseInt(mnn[2].split('-')[0], 10); if (maxInt === null || v > maxInt) maxInt = v; }
  }
  return maxInt !== null ? `v${maxInt}.0` : null;
}

/**
 * Build the STATE.md frontmatter edit ensuring a `milestone:` line is present.
 * Returns { file, content } (full rewritten content) or null if no change.
 */
function ensureStateMilestone(pDir, milestoneVString) {
  const statePath = path.join(pDir, 'STATE.md');
  if (!milestoneVString) return null;
  let content;
  try {
    content = fs.readFileSync(statePath, 'utf8');
  } catch {
    // No STATE.md — create a minimal one with frontmatter.
    return { file: 'STATE.md', content: `---\nmilestone: ${milestoneVString}\n---\n` };
  }
  if (/^milestone:\s*\S/m.test(content)) return null; // already present

  if (content.startsWith('---')) {
    // Insert after the opening delimiter.
    const lines = content.split('\n');
    lines.splice(1, 0, `milestone: ${milestoneVString}`);
    return { file: 'STATE.md', content: lines.join('\n') };
  }
  // No frontmatter — prepend a block.
  return { file: 'STATE.md', content: `---\nmilestone: ${milestoneVString}\n---\n${content}` };
}

// ─── computeMigrationPlan ─────────────────────────────────────────────────────

/**
 * Compute a migration plan without touching the filesystem.
 *
 * @returns {{
 *   alreadyMigrated: boolean,
 *   kind?: 'legacy'|'mnn',
 *   phases: Array<{oldId,newId,oldDir,newDir}>,
 *   roadmapEdits: Array<{lineIndex,from,to}>,
 *   crossRefEdits: Array<{file,from,to}>,
 *   stateMilestoneEdit?: {file,content}|null,
 *   idMap?: Array<{from,to}>,        // printed old→new mapping
 *   conventionCard?: undefined,
 * }}
 */
function computeMigrationPlan(cwd, _options = {}) {
  const pDir = planningDir(cwd);
  const roadmapPath = path.join(pDir, 'ROADMAP.md');
  const configPath = path.join(pDir, 'config.json');
  const phasesDir = path.join(pDir, 'phases');

  const config = readConfig(configPath);
  const projectCode = config.project_code || null;

  let roadmapContent = '';
  try {
    roadmapContent = fs.readFileSync(roadmapPath, 'utf8');
  } catch {
    throw new Error(`ROADMAP.md not found at ${roadmapPath}`);
  }
  const lines = roadmapContent.split('\n');

  let existingDirs = [];
  try {
    existingDirs = fs.readdirSync(phasesDir).filter(d => {
      try { return fs.statSync(path.join(phasesDir, d)).isDirectory(); } catch { return false; }
    });
  } catch { /* phases dir may not exist */ }

  const convention = classifyConvention(lines, config, existingDirs);

  if (convention === 'bracket') {
    return { alreadyMigrated: true, phases: [], roadmapEdits: [], crossRefEdits: [] };
  }

  // A bracket identity is `[PROJECT.MM] token` / `PROJECT.MM-token-slug` — the
  // PROJECT code is structurally required (the milestone rides in the bracket
  // alongside it). Without a project_code there is no readable bracket form to
  // emit: a code-less heading like `### 01:` carries neither the "Phase" word
  // nor a `[PROJECT.MM]` bracket, so the Wave-1/2 read path cannot resolve it
  // (`roadmapHeadingPhaseRe` matches only those two forms). Refuse rather than
  // half-migrate a repo into an UNREADABLE state — surface the prerequisite.
  if (!projectCode) {
    throw new Error(
      'project_code is required for bracket migration (the milestone rides in ' +
      'the `[PROJECT.MM]` bracket). Set "project_code" in .planning/config.json ' +
      'before running `roadmap upgrade`.'
    );
  }

  const partial = convention === 'mnn'
    ? computeMnnPlan(lines, existingDirs, projectCode, pDir)
    : computeLegacyPlan(lines, existingDirs, projectCode, pDir);

  // STATE.md milestone: ensure present (read-path anchor).
  const milestoneVString = deriveMilestoneVString(lines, pDir);
  const stateMilestoneEdit = ensureStateMilestone(pDir, milestoneVString);

  // Old→new id mapping for printing (external-link maintenance).
  const idMap = partial.phases.map(p => ({ from: p.oldDir, to: p.newDir }));

  return {
    alreadyMigrated: false,
    kind: partial.kind,
    phases: partial.phases,
    roadmapEdits: partial.roadmapEdits,
    crossRefEdits: partial.crossRefEdits,
    stateMilestoneEdit,
    idMap,
  };
}

// ─── applyMigration ───────────────────────────────────────────────────────────

/**
 * Apply the migration plan computed by computeMigrationPlan().
 *
 * @param {boolean} [options.dryRun=true] - Print plan and exit without mutating.
 */
function applyMigration(cwd, plan, options = {}) {
  const dryRun = options.dryRun !== false; // default true

  // Render the canonical convention card at the START of every `roadmap upgrade`
  // (dry-run AND --apply), so the user sees what their phase IDs are becoming.
  // Single source of truth — imported from phase-id-card.cjs (ADDENDUM-1).
  process.stdout.write(
    phaseIdCard({ title: 'Phase IDs are migrating to the bracket convention:' }) + '\n\n'
  );

  if (plan.alreadyMigrated) {
    return { alreadyMigrated: true };
  }

  // Print the old→new dir mapping in BOTH modes so external links can be
  // updated. On `--apply` the renumber actually breaks links, so the mapping is
  // most load-bearing there (not only in dry-run preview).
  if (plan.idMap && plan.idMap.length > 0) {
    process.stdout.write('Phase ID migration (old → new):\n');
    for (const m of plan.idMap) process.stdout.write(`  ${m.from} → ${m.to}\n`);
  }

  if (dryRun) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    return { dryRun: true };
  }

  // ── Real run: verify clean working tree ──
  let gitStatus;
  try {
    gitStatus = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
  } catch (err) {
    throw new Error(`git status failed: ${err.message}`);
  }
  if (gitStatus.trim().length > 0) {
    throw new Error('Working tree is dirty. Commit or stash changes before migrating.');
  }

  // Capture HEAD sha for rollback.
  let headSha;
  try {
    headSha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch (err) {
    throw new Error(`git rev-parse HEAD failed: ${err.message}`);
  }

  const pDir = planningDir(cwd);
  const phasesDir = path.join(pDir, 'phases');
  const roadmapPath = path.join(pDir, 'ROADMAP.md');
  const configPath = path.join(pDir, 'config.json');

  const renamedDirs = [];
  const editedFiles = [];

  try {
    // 1. Rename phase directories.
    for (const phaseEntry of plan.phases) {
      const oldPath = path.join(phasesDir, phaseEntry.oldDir);
      const newPath = path.join(phasesDir, phaseEntry.newDir);
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        renamedDirs.push(`${phaseEntry.oldDir} → ${phaseEntry.newDir}`);
      }
    }

    // 2. Rewrite ROADMAP.md line edits.
    if (plan.roadmapEdits.length > 0) {
      const lines = fs.readFileSync(roadmapPath, 'utf8').split('\n');
      const sortedEdits = [...plan.roadmapEdits].sort((a, b) => a.lineIndex - b.lineIndex);
      for (const edit of sortedEdits) {
        if (lines[edit.lineIndex] === edit.from) lines[edit.lineIndex] = edit.to;
      }
      fs.writeFileSync(roadmapPath, lines.join('\n'), 'utf8');
      editedFiles.push('ROADMAP.md');
    }

    // 3. Rewrite cross-refs in STATE.md and PROJECT.md.
    const crossRefsByFile = new Map();
    for (const edit of plan.crossRefEdits) {
      if (!crossRefsByFile.has(edit.file)) crossRefsByFile.set(edit.file, []);
      crossRefsByFile.get(edit.file).push(edit);
    }
    for (const [fileName, edits] of crossRefsByFile) {
      const filePath = path.join(pDir, fileName);
      if (!fs.existsSync(filePath)) continue;
      let content = fs.readFileSync(filePath, 'utf8');
      let changed = false;
      for (const edit of edits) {
        if (content.includes(edit.from)) { content = content.split(edit.from).join(edit.to); changed = true; }
      }
      if (changed) { fs.writeFileSync(filePath, content, 'utf8'); editedFiles.push(fileName); }
    }

    // 4. Ensure STATE.md milestone: present (read-path anchor).
    if (plan.stateMilestoneEdit) {
      const filePath = path.join(pDir, plan.stateMilestoneEdit.file);
      fs.writeFileSync(filePath, plan.stateMilestoneEdit.content, 'utf8');
      if (!editedFiles.includes(plan.stateMilestoneEdit.file)) editedFiles.push(plan.stateMilestoneEdit.file);
    }

    // 5. Update config.json: set phase_id_convention = 'bracket'.
    let configData = {};
    try {
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch { /* config may not exist yet */ }
    configData.phase_id_convention = 'bracket';
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf8');
    editedFiles.push('config.json');

  } catch (err) {
    // Rollback via git reset --hard + git clean.
    try {
      execSync(`git reset --hard ${headSha}`, { cwd, stdio: 'pipe' });
      execSync('git clean -fd .planning/phases/', { cwd, stdio: 'pipe' });
    } catch {
      // Swallow rollback errors — surface original error.
    }
    throw new Error(`Migration failed (rolled back to ${headSha}): ${err.message}`);
  }

  return { applied: true, kind: plan.kind, renamedDirs, editedFiles };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  computeMigrationPlan,
  applyMigration,
  // Exposed for unit testing.
  classifyConvention,
  liftMnnToken,
};
