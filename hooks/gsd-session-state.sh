#!/usr/bin/env bash
# gsd-hook-version: {{GSD_VERSION}}
# gsd-session-state.sh — SessionStart hook: inject project state reminder
# Outputs STATE.md head on every session start for orientation.
#
# OPT-IN: This hook is a no-op unless config.json has hooks.community: true.
# Enable with: "hooks": { "community": true } in .planning/config.json

# Check opt-in config — exit silently if not enabled
if [ -f .planning/config.json ]; then
  ENABLED=$(node -e "try{const c=require('./.planning/config.json');process.stdout.write(c.hooks?.community===true?'1':'0')}catch{process.stdout.write('0')}" 2>/dev/null)
  if [ "$ENABLED" != "1" ]; then exit 0; fi
else
  exit 0
fi

# Build the additionalContext text and emit it as a structured JSON
# envelope per the Claude Code SessionStart hook protocol (#2974). Tests
# parse the JSON and assert on typed fields (state_present: bool,
# config_mode: string, etc) rather than substring-matching free-form text.
STATE_PRESENT="false"
STATE_HEAD=""
if [ -f .planning/STATE.md ]; then
  STATE_PRESENT="true"
  STATE_HEAD=$(head -20 .planning/STATE.md)
fi

CONFIG_MODE="unknown"
if [ -f .planning/config.json ]; then
  CONFIG_MODE=$(node -e "try{const c=require('./.planning/config.json');process.stdout.write(String(c.mode||'unknown'))}catch{process.stdout.write('unknown')}" 2>/dev/null)
fi

# ── Axis 2: planning coherence drift surfacing ───────────────────────────────
# Run `validate health --raw` in a sandboxed child process (5 s timeout via
# spawnSync, portable across platforms — no dependency on the `timeout` binary).
# On any failure — timeout, missing CLI, unparseable output, non-GSD dir,
# or coherence ≠ 'drifted' — DRIFT_LINE stays empty and nothing is emitted.
# This is intentional: absolute fail-safe for every session start. Read-only.
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
GSD_TOOLS="$HOOK_DIR/../gsd-core/bin/gsd-tools.cjs"
DRIFT_LINE=""
if [ -f "$GSD_TOOLS" ]; then
  DRIFT_LINE=$(node -e '
    const { spawnSync } = require("child_process");
    const gsdTools = process.argv[1];
    const result = spawnSync(process.execPath, [gsdTools, "validate", "health", "--raw"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!result.stdout || result.error || result.status !== 0) { process.exit(0); }
    try {
      const out = JSON.parse(result.stdout);
      if (out.coherence === "drifted" && out.coherence_detail) {
        process.stdout.write("⚠ Planning: DRIFTED — " + out.coherence_detail);
      }
    } catch {}
    process.exit(0);
  ' "$GSD_TOOLS" 2>/dev/null) || true
fi

# Use Node for JSON encoding so embedded newlines/quotes are escaped correctly.
# additionalContext is the text Claude Code injects at session start; the
# typed fields (state_present, config_mode, coherence_drifted) let tests assert
# on the structured contract without grepping the prose.
node -e '
  const [statePresent, stateHead, configMode, driftLine] = process.argv.slice(1);
  const headerLines = ["## Project State Reminder", ""];
  if (statePresent === "true") {
    headerLines.push("STATE.md exists - check for blockers and current phase.");
    if (stateHead) headerLines.push(stateHead);
  } else {
    headerLines.push("No .planning/ found - suggest /gsd-new-project if starting new work.");
  }
  headerLines.push("");
  headerLines.push("Config: \"mode\": \"" + configMode + "\"");
  if (driftLine) {
    headerLines.push("");
    headerLines.push(driftLine);
  }
  const additionalContext = headerLines.join("\n");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
      state_present: statePresent === "true",
      config_mode: configMode,
      coherence_drifted: driftLine ? true : false,
    },
  }));
' "$STATE_PRESENT" "$STATE_HEAD" "$CONFIG_MODE" "$DRIFT_LINE"

exit 0
