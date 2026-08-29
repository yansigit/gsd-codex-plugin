"use strict";
/**
 * Manifest-backed init subcommand router.
 * Keeps gsd-tools.cjs thin while preserving existing command semantics.
 *
 * Phase 6: all init.* subcommands have SDK equivalents and are dispatched
 * via executeForCjs (the sync bridge). CJS fallback retained when:
 * - GSD_WORKSTREAM is active (workstream-scoped requests fall through to CJS).
 * - SDK is unavailable (build not present).
 *
 * CJS-only subcommands: none.
 * SDK-only (unsupported in CJS router): none.
 *
 * ADR-457 build-at-publish: the hand-written bin/lib/init-command-router.cjs
 * collapsed to a TypeScript source of truth. Behaviour is preserved byte-for-behaviour
 * from the prior hand-written .cjs; only types are added.
 */
const command_aliases_cjs_1 = require("./command-aliases.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cjsCommandRouterAdapter = require("./cjs-command-router-adapter.cjs");
const { routeCjsCommandFamily } = cjsCommandRouterAdapter;
const command_arg_projection_cjs_1 = require("./command-arg-projection.cjs");
// ─── Implementation ───────────────────────────────────────────────────────────
function routeInitCommand({ init, args, cwd, raw, error }) {
    routeCjsCommandFamily({
        args,
        subcommands: command_aliases_cjs_1.INIT_SUBCOMMANDS,
        unsupported: {},
        error,
        unknownMessage: (_subcommand, available) => `Unknown init workflow: ${_subcommand}\nAvailable: ${available.join(', ')}`,
        handlers: {
            // #2932/#2992: `parseNamedArgs` never yields `undefined` for an absent
            // flag (value-flags default to `null`, booleanFlags default to `false`);
            // `buildSectionManifestField`'s flags-Set builder (src/init.cts) is the
            // single source of truth for flag ABSENCE and gates on value truthiness,
            // so `namedArgs` is passed through here uncoerced.
            'execute-phase': () => {
                // `wave` is an optionalValueFlags entry, not a booleanFlags entry:
                // `--wave N` is a documented, shipped form (commands/gsd/execute-phase.md:4,48)
                // whose value is consumed by the workflow layer
                // (gsd-core/workflows/execute-phase.md:84), not by this CLI seam — see
                // NamedArgSpec.optionalValueFlags in command-arg-projection.cts.
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['validate', 'tdd'], optionalValueFlags: ['wave'], positionals: 3 }, error);
                init.cmdInitExecutePhase(cwd, args[2], raw, {
                    validate: namedArgs['validate'],
                    tdd: namedArgs['tdd'],
                    wave: namedArgs['wave'],
                });
            },
            'plan-phase': () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, {
                    valueFlags: ['granularity', 'prd', 'ingest', 'research-phase'],
                    booleanFlags: ['validate', 'tdd', 'reviews', 'chunked'],
                    positionals: 3,
                }, error);
                init.cmdInitPlanPhase(cwd, args[2], raw, {
                    validate: namedArgs['validate'],
                    tdd: namedArgs['tdd'],
                    granularity: namedArgs['granularity'],
                    prd: namedArgs['prd'],
                    ingest: namedArgs['ingest'],
                    'research-phase': namedArgs['research-phase'],
                    reviews: namedArgs['reviews'],
                    chunked: namedArgs['chunked'],
                });
            },
            'new-project': () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['auto'], positionals: 2 }, error);
                init.cmdInitNewProject(cwd, raw, { auto: namedArgs['auto'] });
            },
            'new-milestone': () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['reset-phase-numbers'], positionals: 2 }, error);
                init.cmdInitNewMilestone(cwd, raw, {
                    'reset-phase-numbers': namedArgs['reset-phase-numbers'],
                });
            },
            onboard: () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['fast', 'text'], positionals: 2 }, error);
                init.cmdInitOnboard(cwd, raw, { fast: namedArgs['fast'], text: namedArgs['text'] });
            },
            quick: () => {
                // #3180 Decision 4a / L2 (ADR-3473 §8.4): `positionals: 'rest'` because
                // everything after `init quick` is a free-text description — strict
                // undeclared-flag rejection would break
                // `/gsd-quick add a --dry-run option`, which works today.
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['discuss', 'research', 'validate', 'full'], positionals: 'rest' }, error);
                // #2994: `args.slice(2)` is the free-text description, but section-manifest
                // gating (buildSectionManifestField, src/init.cts) now requires forwarding
                // --discuss/--research/--validate/--full alongside it — a plain `.join(' ')`
                // would otherwise fold those recognized flag tokens straight into the
                // description text. Strip them before joining so the description stays
                // exactly what it was before this workflow started forwarding flags.
                const quickFlagTokens = new Set(['--discuss', '--research', '--validate', '--full']);
                const description = args
                    .slice(2)
                    .filter((token) => !quickFlagTokens.has(token))
                    .join(' ');
                init.cmdInitQuick(cwd, description, raw, {
                    discuss: namedArgs['discuss'],
                    research: namedArgs['research'],
                    validate: namedArgs['validate'],
                    full: namedArgs['full'],
                });
            },
            'ingest-docs': () => init.cmdInitIngestDocs(cwd, raw),
            resume: () => init.cmdInitResume(cwd, raw),
            // ADR-3473 §8.4 / #3358 gap: these handlers read args[2] positionally
            // without ever calling parseNamedArgsOrExit, so an unrecognized flag or
            // stray positional was silently dropped instead of rejected. No flags
            // are declared because none are documented for these subcommands
            // (docs/CLI-TOOLS.md); `--ws` seen in shipped workflows targets the
            // separate `query init.verify-work` seam and is stripped before
            // reaching `init verify-work` (gsd-core/workflows/verify-work.md:42-45).
            'verify-work': () => {
                (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { positionals: 3 }, error);
                init.cmdInitVerifyWork(cwd, args[2], raw);
            },
            'phase-op': () => {
                (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { positionals: 3 }, error);
                init.cmdInitPhaseOp(cwd, args[2], raw);
            },
            'code-review': () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['fix'], positionals: 3 }, error);
                init.cmdInitCodeReview(cwd, args[2], raw, { fix: namedArgs['fix'] });
            },
            review: () => {
                (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { positionals: 3 }, error);
                init.cmdInitReview(cwd, args[2], raw, {});
            },
            'discuss-phase-assumptions': () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['auto'], positionals: 3 }, error);
                init.cmdInitDiscussPhaseAssumptions(cwd, args[2], raw, { auto: namedArgs['auto'] });
            },
            todos: () => {
                (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { positionals: 3 }, error);
                init.cmdInitTodos(cwd, args[2], raw);
            },
            'milestone-op': () => init.cmdInitMilestoneOp(cwd, raw),
            'map-codebase': () => init.cmdInitMapCodebase(cwd, raw),
            progress: () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['forensic'], positionals: 2 }, error);
                init.cmdInitProgress(cwd, raw, { forensic: namedArgs['forensic'] });
            },
            // Keep manager on CJS for now so runtime-specific command rendering
            // (e.g. $gsd-* for codex) stays consistent with runtime-slash helpers.
            manager: () => init.cmdInitManager(cwd, raw),
            'complete-milestone': () => init.cmdInitCompleteMilestone(cwd, raw),
            autonomous: () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['converge', 'cross-ai'], positionals: 2 }, error);
                init.cmdInitAutonomous(cwd, raw, {
                    converge: namedArgs['converge'],
                    'cross-ai': namedArgs['cross-ai'],
                });
            },
            'docs-update': () => init.cmdInitDocsUpdate(cwd, raw, {}),
            update: () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['next', 'rc'], positionals: 2 }, error);
                init.cmdInitUpdate(cwd, raw, { next: namedArgs['next'], rc: namedArgs['rc'] });
            },
            transition: () => init.cmdInitTransition(cwd, raw, {}),
            debug: () => {
                const namedArgs = (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { booleanFlags: ['diagnose'], positionals: 2 }, error);
                init.cmdInitDebug(cwd, raw, { diagnose: namedArgs['diagnose'] });
            },
            'new-workspace': () => init.cmdInitNewWorkspace(cwd, raw),
            'list-workspaces': () => init.cmdInitListWorkspaces(cwd, raw),
            'remove-workspace': () => {
                (0, command_arg_projection_cjs_1.parseNamedArgsOrExit)(args, { positionals: 3 }, error);
                init.cmdInitRemoveWorkspace(cwd, args[2], raw);
            },
        },
    });
}
module.exports = {
    routeInitCommand,
};
