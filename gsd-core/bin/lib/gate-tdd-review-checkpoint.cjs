"use strict";
/**
 * `check tdd-review-checkpoint` as a gate module (#5139, epic #5056, ADR-5057 §4 first bullet): it
 * returns a `GateResult`; the command router formats it. Imports no io module and performs no
 * direct console/stdout/stderr write (ESLint-enforced).
 *
 * End-of-phase advisory check: scans `type: tdd` plans for RED/GREEN/REFACTOR gate-sequence
 * compliance (`test(<plan>):` / `feat(<plan>):` / `refactor(<plan>):` commits) and builds a review
 * table. `passed` is always true (advisory — never truly blocks); `block` is `violations > 0` so
 * the host loop can read one uniform field.
 *
 * `type: tdd` is detected by the Frontmatter Module's `frontmatterKeyHasValue` (the old
 * `^type:\s*tdd\s*$` multiline test over the fence owner's block, key and value escaped).
 *
 * The plan id (a plan FILE NAME) reaches git as an extended-regex `--grep` pattern with every
 * metacharacter escaped, so a plan named `.*-PLAN.md` matches only commits that name it literally.
 *
 * Argv after the verb: `<phase>` (a number; an unresolvable phase reports zero plans).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateTddReviewCheckpoint = evaluateTddReviewCheckpoint;
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const gate_verdict_cjs_1 = require("./gate-verdict.cjs");
const gate_phase_context_cjs_1 = require("./gate-phase-context.cjs");
const pattern_cjs_1 = require("./pattern.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const frontmatterMod = require("./frontmatter.cjs");
const { frontmatterKeyHasValue } = frontmatterMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const planScanMod = require("./plan-scan.cjs");
const { scanPhasePlans } = planScanMod;
/**
 * True when the plan's frontmatter declares `type: tdd` (CRLF included, #2449). The block is the
 * one fence owner's, read as RAW text — not through the YAML parser — so a block the parser refuses
 * (a `--- x` line before `type:`) still classifies, exactly as under the old `^type:\s*tdd\s*$`
 * multiline regex, whose edge behaviour (a duplicate `type:` key, a value on the next line,
 * `type : tdd` NOT matching, `type: "tdd"` / `type: tdd # note` NOT matching) is preserved.
 */
function isTddPlan(content) {
    return frontmatterKeyHasValue(content, 'type', 'tdd');
}
/**
 * True when `git log` finds at least one commit whose message has a line `<kind>(<planId>):` (a
 * git failure is "none"). `planId` is matched LITERALLY: its extended-regex metacharacters are
 * escaped, so it can never widen the pattern.
 */
function hasCommitMatching(projectDir, kind, planId) {
    try {
        const out = (0, node_child_process_1.execFileSync)('git', ['log', '--oneline', '--extended-regexp', `--grep=^${kind}\\(${(0, pattern_cjs_1.escapeEre)(planId)}\\):`, '--', '.'], 
        // stderr piped (and dropped), never inherited: a gate module writes nothing to stderr.
        { cwd: projectDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, windowsHide: true, timeout: 10_000 });
        return out.trim().length > 0;
    }
    catch { /* git unavailable or no match */ }
    return false;
}
function evaluateTddReviewCheckpoint(input) {
    const { projectDir } = input;
    const phase = input.args[0] || '';
    if (!phase) {
        return (0, gate_verdict_cjs_1.gateUsageFailure)(gate_verdict_cjs_1.GATE_FAILURE_CODE.SDK_MISSING_ARG, 'tdd.review-checkpoint requires a phase argument: check tdd.review-checkpoint <phase>');
    }
    const phaseDir = (0, gate_phase_context_cjs_1.resolvePhaseDirOrEmpty)(projectDir, phase);
    // Find all PLAN.md files with type: tdd in frontmatter
    const tddPlanFiles = [];
    if (phaseDir) {
        try {
            // #3183: canonical plan set (root+nested, superseded-excluded) from the single owner.
            const files = scanPhasePlans(phaseDir).planFiles;
            for (const file of files) {
                const planPath = node_path_1.default.join(phaseDir, file);
                if (isTddPlan((0, gate_phase_context_cjs_1.readIfExists)(planPath)))
                    tddPlanFiles.push(planPath);
            }
        }
        catch { /* directory read failure */ }
    }
    if (tddPlanFiles.length === 0) {
        return (0, gate_verdict_cjs_1.gateVerdict)('skip', false, {
            // Uniform gate contract: block = violations > 0 (advisory; never truly blocks).
            block: false,
            passed: true,
            tddPlans: 0,
            violations: 0,
            table: '',
            rows: [],
            message: `No type:tdd plans found in phase ${phase}. TDD review skipped.`,
        });
    }
    // For each TDD plan, extract the plan ID (e.g. "01-02-PLAN.md" → "01-02") and check git log
    const rows = [];
    for (const planPath of tddPlanFiles) {
        const planId = node_path_1.default.basename(planPath, '-PLAN.md');
        const red = hasCommitMatching(projectDir, 'test', planId);
        const green = hasCommitMatching(projectDir, 'feat', planId);
        const refactor = hasCommitMatching(projectDir, 'refactor', planId);
        const missing = [];
        if (!red)
            missing.push('RED');
        if (!green)
            missing.push('GREEN');
        const status = missing.length === 0 ? 'Pass' : 'FAIL';
        rows.push({ planId, red, green, refactor, status, missing });
    }
    const violations = rows.filter(r => r.status === 'FAIL').length;
    // Build review table
    const tableHeader = '| Plan | RED | GREEN | REFACTOR | Status |';
    const tableDivider = '|------|-----|-------|----------|--------|';
    const tableRows = rows.map(r => `| ${r.planId.padEnd(4)} | ${r.red ? ' ✓ ' : ' ✗ '} | ${r.green ? '  ✓  ' : '  ✗  '} | ${r.refactor ? '   ✓    ' : '   —    '} | ${r.status.padEnd(6)} |`);
    let table = [
        `### TDD REVIEW — Phase ${phase}`,
        '',
        `TDD Plans: ${tddPlanFiles.length} | Gate violations: ${violations}`,
        '',
        tableHeader,
        tableDivider,
        ...tableRows,
    ].join('\n');
    if (violations > 0) {
        table += '\n\n⚠ Gate violations are advisory — review before advancing.';
        for (const r of rows.filter(row => row.status === 'FAIL')) {
            table += `\n  Plan ${r.planId} missing: ${r.missing.join(', ')} gate commit(s).`;
            table += `\n  Expected commit pattern: test(${r.planId}): ... → feat(${r.planId}): ...`;
        }
    }
    // Uniform gate contract: block = violations > 0. The gate is advisory (blocking:false in
    // capability.json), so block:true only surfaces as a warning, never halts. The human-readable
    // report is carried in `message` (and `table`) for the dispatch's advisory branch.
    return (0, gate_verdict_cjs_1.gateVerdict)(violations > 0 ? 'advisory' : 'pass', violations > 0, {
        block: violations > 0,
        passed: true,
        tddPlans: tddPlanFiles.length,
        violations,
        table,
        rows,
        message: table,
    });
}
