'use strict';

const fs = require('fs');
const path = require('path');
const { ROADMAP_SUBCOMMANDS } = require('./command-aliases.cjs');
const { routeCjsCommandFamily } = require('./cjs-command-router-adapter.cjs');
const roadmapUpgrade = require('./roadmap-upgrade.cjs');
const { planningDir } = require('./planning-workspace.cjs');
const { isSentinelPhaseId } = require('./core.cjs');

const BRACKET_MIGRATION_CMD = 'gsd-tools roadmap upgrade --convention bracket';

/**
 * Bracket-native ROADMAP validation (WAVE 2b — supersedes the M-NN `checkW021`).
 *
 * Two parts, both emitting under W021 (the phase-id-convention warning slot,
 * now bracket-semantic):
 *
 *   (A) BRACKET-FORM-PRESENCE — the INVERSE of the old M-NN check. A phase
 *       heading that carries a literal "Phase " word OR an M-NN `N-NN` token
 *       (instead of a clean `### [PROJECT.MM] N:` bracket heading) is a
 *       violation. Sentinel phases (0.x / 999.x) are exempt.
 *
 *   (B) BRACKET-INTEGER COHERENCE — capture each phase heading's enclosing
 *       milestone integer. ADDENDUM-3 makes the milestone SECTION heading itself
 *       integer-bearing (`## [PROJECT.MM] Name`), so the authority is the
 *       enclosing section's MM (mirrors getMilestoneInfo's read). A phase whose
 *       own bracket MM differs from its enclosing section's MM is incoherent.
 *       (Comparing each phase to its enclosing section — rather than to a single
 *       STATE.md `milestone:` — avoids flagging every phase in a non-active /
 *       future milestone section when the ROADMAP spans multiple milestones.)
 *
 * @param {string} content - ROADMAP.md content
 * @returns {Array<{code:'W021', message:string}>}
 */
function checkBracketConsistency(content) {
  const warnings = [];

  // Milestone SECTION heading (ADDENDUM-3): `## [PROJECT.MM] Name` — bracket
  // followed by a NAME (no `NN:` phase-number colon). Capture MM. A digit-leading
  // name (`## [GSD.02] 2024 Plan`) is still a section (no `NN:` colon). The
  // negative lookahead rejects ANY phase-number-then-colon form, including M-NN
  // hyphen tokens (`2-01:`), so an M-NN phase heading is NOT consumed as a
  // section (which would let it slip past the form-presence check below).
  const SECTION_RE = /^#{1,3}\s+\[[A-Z][A-Z0-9]*\.(\d+)\]\s+(?!\d+[A-Z]?(?:[.-]\d+)*\s*:)/i;
  // Phase heading (canonical bracket): `### [PROJECT.MM] N[.sub]: Name`.
  const BRACKET_PHASE_RE = /^#{2,4}\s*\[[A-Z][A-Z0-9]*\.(\d+)\]\s+(\d+[A-Z]?(?:\.\d+)*)\s*:/i;
  // A phase heading carrying a literal "Phase " word (legacy / M-NN) — the
  // form-presence violation target on a bracket repo.
  const LITERAL_PHASE_RE = /^#{2,4}\s*(?:\[[^\]]*\]\s*)?Phase\s+(\d+[A-Z]?(?:[.-]\d+)*)\s*:/i;
  // A bracket heading whose phase token is M-NN hyphenated (`[GSD.02] 2-01:`).
  const BRACKET_MNN_RE = /^#{2,4}\s*\[[A-Z][A-Z0-9]*\.\d+\]\s+(\d+-\d+(?:-\d+)*)\s*:/i;

  let currentSectionMilestone = null;
  const lines = content.split('\n');

  for (const line of lines) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      currentSectionMilestone = parseInt(sectionMatch[1], 10);
      continue;
    }

    // (A) Literal "Phase " word → form-presence violation (unless sentinel).
    const literalMatch = line.match(LITERAL_PHASE_RE);
    if (literalMatch) {
      if (!isSentinelPhaseId(literalMatch[1])) {
        warnings.push({
          code: 'W021',
          message:
            `Phase heading "${literalMatch[1]}" uses the legacy "Phase" word; ` +
            `bracket convention requires \`### [PROJECT.MM] ${literalMatch[1].split(/[.-]/)[0]}: Name\`. ` +
            `Run \`${BRACKET_MIGRATION_CMD}\` to migrate.`,
        });
      }
      continue;
    }

    // (A) M-NN hyphen token inside a bracket → form-presence violation.
    const mnnMatch = line.match(BRACKET_MNN_RE);
    if (mnnMatch) {
      if (!isSentinelPhaseId(mnnMatch[1])) {
        warnings.push({
          code: 'W021',
          message:
            `Phase heading carries an M-NN token "${mnnMatch[1]}"; bracket phase tokens are ` +
            `all-dot (milestone rides in the bracket prefix). ` +
            `Run \`${BRACKET_MIGRATION_CMD}\` to migrate.`,
        });
      }
      continue;
    }

    // (B) Clean bracket phase heading → integer-coherence check.
    const phaseMatch = line.match(BRACKET_PHASE_RE);
    if (phaseMatch) {
      const phaseMilestone = parseInt(phaseMatch[1], 10);
      const phaseToken = phaseMatch[2];
      if (isSentinelPhaseId(phaseToken)) continue; // exempt
      if (currentSectionMilestone !== null && phaseMilestone !== currentSectionMilestone) {
        warnings.push({
          code: 'W021',
          message:
            `Bracket milestone mismatch: phase "[…${phaseMatch[1]}] ${phaseToken}" is listed under ` +
            `milestone section [..${String(currentSectionMilestone).padStart(2, '0')}] ` +
            `but its bracket integer (${phaseMatch[1]}) does not match. ` +
            `Run \`${BRACKET_MIGRATION_CMD}\` to fix.`,
        });
      }
    }
  }

  return warnings;
}

/**
 * Manifest-backed roadmap subcommand router.
 * Keeps gsd-tools.cjs thin while preserving existing command semantics.
 */
function routeRoadmapCommand({ roadmap, args, cwd, raw, error }) {
  routeCjsCommandFamily({
    args,
    subcommands: ROADMAP_SUBCOMMANDS,
    unsupported: {},
    error,
    unknownMessage: (_subcommand, available) => `Unknown roadmap subcommand. Available: ${available.join(', ')}`,
    handlers: {
      'get-phase': () => roadmap.cmdRoadmapGetPhase(cwd, args[2], raw),
      analyze: () => roadmap.cmdRoadmapAnalyze(cwd, raw),
      'update-plan-progress': () => roadmap.cmdRoadmapUpdatePlanProgress(cwd, args[2], raw),
      'annotate-dependencies': () => roadmap.cmdRoadmapAnnotateDependencies(cwd, args[2], raw),
      'validate': () => {
        const roadmapPath = path.join(planningDir(cwd), 'ROADMAP.md');
        let roadmapContent = '';
        try {
          roadmapContent = fs.readFileSync(roadmapPath, 'utf8');
        } catch {
          // ROADMAP.md missing — return empty warnings
        }

        // Bracket-native validation runs DEFAULT-ON for bracket repos (the
        // new-project default per Q1). The retired opt-in `milestone-prefixed`
        // gate is gone. Authority: .planning/config.json (set by the migrator);
        // fallback to ROADMAP.md frontmatter.
        //
        // Legacy READ-TOLERANCE: un-migrated repos (convention null / absent)
        // are NOT flagged here — the bracket form is the violation target only
        // on a bracket repo. This keeps not-yet-migrated projects quiet during
        // the migration window (the migrator is the on-disk converter).
        // Read phase_id_convention from config.json RAW (loadConfig drops keys
        // not in the schema defaults, including phase_id_convention — the
        // migrator writes it directly to config.json, so verify.cjs and this
        // router both read it raw to keep config.json authoritative).
        let convention;
        try {
          const configPath = path.join(planningDir(cwd), 'config.json');
          const cfgRaw = fs.readFileSync(configPath, 'utf8');
          convention = JSON.parse(cfgRaw).phase_id_convention;
        } catch {
          convention = undefined;
        }
        if (convention === undefined || convention === null) {
          // Fallback: read from ROADMAP.md frontmatter
          const fmMatch = roadmapContent.match(/^---\r?\n([\s\S]+?)\r?\n---/);
          if (fmMatch) {
            const kvMatch = fmMatch[1].match(/^phase_id_convention:\s*(.*)$/m);
            if (kvMatch) {
              const val = kvMatch[1].trim();
              if (val !== 'null' && val !== '') {
                convention = val.replace(/^["']|["']$/g, '');
              }
            }
          }
        }
        const warnings = (convention === 'bracket')
          ? checkBracketConsistency(roadmapContent)
          : [];

        const result = { warnings };
        if (raw) process.stdout.write(JSON.stringify(result));
        else process.stdout.write(JSON.stringify(result, null, 2));
      },
      'upgrade': () => {
        const dryRun = !args.includes('--apply');
        // Bracket is the default and only supported target convention. The
        // migrator (roadmap-upgrade.cjs) accepts legacy + M-NN as SOURCE and
        // emits bracket.
        const convention = args.find((a, i) => args[i-1] === '--convention') || 'bracket';
        if (convention !== 'bracket') {
          process.stderr.write('Only --convention bracket is supported\n');
          process.exit(1);
        }
        const plan = roadmapUpgrade.computeMigrationPlan(cwd);
        roadmapUpgrade.applyMigration(cwd, plan, { dryRun });
      },
    },
  });
}

module.exports = {
  routeRoadmapCommand,
};
