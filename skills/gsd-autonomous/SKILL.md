---
name: gsd-autonomous
description: "Run all remaining phases autonomously — discuss→plan→execute per phase"
argument-hint: "[--from N] [--to N] [--only N] [--interactive] [--converge]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---

<plugin_runtime>
- Resolve `{{GSD_PLUGIN_ROOT}}` from this skill's absolute `SKILL.md` path by ascending from `<plugin>/skills/<skill>/SKILL.md` to `<plugin>`. Verify `.codex-plugin/plugin.json` exists there.
- Substitute that absolute path for every literal `{{GSD_PLUGIN_ROOT}}`; it is a skill placeholder, not an environment variable.
- Apply this recursively to loaded files: legacy `~/.claude/gsd-core` and `~/.codex/gsd-core` paths resolve to `{{GSD_PLUGIN_ROOT}}/gsd-core`, while legacy `~/.claude/agents` and `~/.codex/agents` paths resolve to `{{GSD_PLUGIN_ROOT}}/agents`.
- Run GSD commands as `GSD_AGENTS_DIR="{{GSD_PLUGIN_ROOT}}/agents" node "{{GSD_PLUGIN_ROOT}}/gsd-core/bin/gsd-tools.cjs"`. Prefix every direct or workflow-copied `gsd-tools` invocation with that same `GSD_AGENTS_DIR` value. Never use a project copy, PATH, or a global installation.
- Plugin-bundled `agents/*.md` files are the agent definitions for this runtime. Translate each `Agent(subagent_type="gsd-...", prompt=...)` call to the host's general delegation tool (for example `spawn_agent`), preserving the prompt. Track every returned agent id. Launch no more than the host's remaining child capacity at once (use three when unknown), wait for those ids with the host's agent wait primitive, and use each agent's returned final message as its result before starting the next batch. Never expect or read `async_launched.outputFile`.
- Map `AskUserQuestion` to the host's interactive questioning tool when available; otherwise show a numbered plain-text choice and wait for the user's reply. Map abstract tools (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`) to host equivalents.
- Generic delegated agents share the current working directory. Before such dispatches, record `none` with `gsd_run query dispatch-isolation --raw --force-isolation none` and omit all worktree/isolation arguments. Use an isolation argument only when the actual delegation API explicitly supports it. Never run parallel agents that may edit overlapping files in a shared directory.
- Plugin manifests do not activate the vendored GSD hooks. Enforce the workflow's protected-branch, write-boundary, base-check, and prompt-injection checks directly; never claim a hook ran.
- A matching plugin-bundled agent file makes that role available even if the global Codex agents directory is empty. Do not warn, run a global installer, skip the agent, or choose an inline/sequential fallback because global agents are absent. Fall back only when the host has no sub-agent delegation tool or the bundled agent file is absent. Include the resolved absolute plugin root and these adapter rules in the child prompt, and require the child to read `{{GSD_PLUGIN_ROOT}}/agents/<subagent_type>.md` before starting. The child must resolve that file's legacy paths through this plugin and translate abstract tool names to host equivalents.
- If the workflow's requested model is unavailable on the host, omit the model override and inherit the current model.
- These plugin adapter rules override contrary named-agent installation, output-file, isolation, hook, and fallback instructions in recursively loaded upstream workflow files.
</plugin_runtime>

<objective>
Execute all remaining milestone phases autonomously. For each phase: discuss → plan → execute. Pauses only for user decisions (grey area acceptance, blockers, validation requests).

Uses ROADMAP.md phase discovery and Skill() flat invocations for each phase command. After all phases complete: milestone audit → complete → cleanup.

**Creates/Updates:**
- `.planning/STATE.md` — updated after each phase
- `.planning/ROADMAP.md` — progress updated after each phase
- Phase artifacts — CONTEXT.md, PLANs, SUMMARYs per phase

**After:** Milestone is complete and cleaned up.
</objective>

<execution_context>
@{{GSD_PLUGIN_ROOT}}/gsd-core/workflows/autonomous.md
@{{GSD_PLUGIN_ROOT}}/gsd-core/references/ui-brand.md
</execution_context>

<context>
Optional flags:
- `--from N` — start from phase N instead of the first incomplete phase.
- `--to N` — stop after phase N completes (halt instead of advancing to next phase).
- `--only N` — execute only phase N (single-phase mode).
- `--interactive` — run discuss inline with questions (not auto-answered), then dispatch plan→execute as background agents. Keeps the main context lean while preserving user input on decisions.
- `--converge` — run each phase's planning step through `gsd-plan-review-convergence` instead of plain `gsd-plan-phase`. Requires `workflow.plan_review_convergence=true`.
- `--cross-ai` — compatibility alias for `--converge`.

When `--converge` or `--cross-ai` is set, reviewer selector flags supported by `gsd-plan-review-convergence` may be passed through: `--codex`, `--gemini`, `--claude`, `--opencode`, `--ollama`, `--lm-studio`, `--llama-cpp`, `--all`, and `--max-cycles N`.

Project context, phase list, and state are resolved inside the workflow using init commands (`gsd-tools query init.milestone-op`, `gsd-tools query roadmap.analyze`). No upfront context loading needed.
</context>

<process>
Execute end-to-end.
Preserve all workflow gates (phase discovery, per-phase execution, blocker handling, progress display).
</process>
