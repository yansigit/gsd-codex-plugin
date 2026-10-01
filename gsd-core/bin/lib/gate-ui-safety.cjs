"use strict";
/**
 * `check ui-safety-gate` as a gate module (#5139, epic #5056, ADR-5057 §4 first bullet): it returns
 * a `GateResult`; the command router formats it. Imports no io module and performs no direct
 * console/stdout/stderr write (ESLint-enforced).
 *
 * Post-wave check that verifies UI-changed files conform to the active UI-SPEC for the phase.
 * Uses `checkUiPresence` from `ui-safety-gate.cjs` (frontend detection is not reimplemented) and
 * looks for frontend file changes in `git diff --name-only HEAD~1 HEAD`.
 *
 * Limitation: `HEAD~1..HEAD` covers only the last commit; in a multi-plan wave the wave-start
 * commit would be more accurate but is not yet stored in the wave manifest.
 *
 * Argv after the verb: `<phase>`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeUiSafetyGate = computeUiSafetyGate;
exports.evaluateUiSafetyGate = evaluateUiSafetyGate;
const node_child_process_1 = require("node:child_process");
const gate_verdict_cjs_1 = require("./gate-verdict.cjs");
const gate_phase_context_cjs_1 = require("./gate-phase-context.cjs");
const ui_safety_gate_cjs_1 = require("./ui-safety-gate.cjs");
const UI_FILE_EXTENSIONS_RE = /\.(tsx|jsx|css|scss|sass|less|vue|svelte|html)$/i;
const UI_PATH_PATTERNS_RE = /\/(components|pages|views|screens|layouts|ui|frontend)\//i;
/**
 * Pure logic for ui-safety-gate — exposed for direct behavioral testing.
 *
 *   (a) ROADMAP phase section via the shared lookup (same as ui-plan-gate) → is this a frontend phase.
 *   (b) checkUiPresence (frontend detection).
 *   (c) `git diff HEAD~1..HEAD` for UI file changes in the current worktree (10 s bound; a git
 *       failure is "no UI files changed").
 *   (d) Phase directory → `*-UI-SPEC.md`.
 *
 * `block = frontend && hasUiFiles && !hasUiSpec`.
 */
function computeUiSafetyGate(projectDir, phase) {
    // (a) phase section text (same two-pass lookup as computeUiPlanGate)
    const { phaseSection, phaseLookupFailed } = (0, gate_phase_context_cjs_1.lookupRoadmapPhase)(projectDir, phase);
    // (b) frontend detection — reuse the existing helper; no reimplementation
    const presenceResult = (0, ui_safety_gate_cjs_1.checkUiPresence)(phaseSection);
    const frontend = presenceResult.hasUI;
    // (c) any UI files changed in recent git commits?
    let hasUiFiles = false;
    try {
        const changed = (0, node_child_process_1.execFileSync)('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
            cwd: projectDir,
            encoding: 'utf-8',
            // stderr is piped (and dropped), never inherited: a gate module writes nothing to the
            // process's stderr, and a git failure here already means "no UI files changed".
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
            timeout: 10_000,
        });
        hasUiFiles = changed.split('\n').some((f) => f.trim() && (UI_FILE_EXTENSIONS_RE.test(f) || UI_PATH_PATTERNS_RE.test(f)));
    }
    catch { /* git unavailable or no prior commit — treat as no UI files changed */ }
    // (d) phase directory and *-UI-SPEC.md
    const uiSpecPath = (0, gate_phase_context_cjs_1.findUiSpecInDir)((0, gate_phase_context_cjs_1.resolvePhaseDirOrEmpty)(projectDir, phase));
    const hasUiSpec = uiSpecPath !== '';
    // block only when: this is a frontend phase AND UI files were changed AND no UI-SPEC exists
    const block = frontend && hasUiFiles && !hasUiSpec;
    const result = { frontend, hasUiFiles, hasUiSpec, block };
    if (block) {
        result.message = `UI files changed in this wave but no UI-SPEC.md exists for Phase ${phase}. ` +
            `Run /gsd:ui-phase ${phase} to generate the design contract before continuing.`;
    }
    if (phaseLookupFailed)
        result.phaseLookupFailed = true;
    return result;
}
function evaluateUiSafetyGate(input) {
    const phase = input.args[0] || '';
    if (!phase) {
        return (0, gate_verdict_cjs_1.gateUsageFailure)(gate_verdict_cjs_1.GATE_FAILURE_CODE.SDK_MISSING_ARG, 'ui-safety-gate requires a phase argument: check ui-safety-gate <phase>');
    }
    const result = computeUiSafetyGate(input.projectDir, phase);
    return (0, gate_verdict_cjs_1.gateVerdict)(result.block ? 'block' : 'pass', result.block, { ...result });
}
