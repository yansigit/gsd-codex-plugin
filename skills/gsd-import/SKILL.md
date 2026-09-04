---
name: gsd-import
description: "Ingest external plans with conflict detection against project decisions before writing anything."
argument-hint: "--from <filepath> | --from-gsd2"
allowed-tools:
  - Read
  - Write
  - Edit
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
Import external plan files into the GSD planning system with conflict detection against PROJECT.md decisions.

- **--from**: Import an external plan file, detect conflicts, write as GSD PLAN.md, validate via gsd-plan-checker.
- **--from-gsd2**: Reverse-migrate a GSD-2 project (`.gsd/` directory) back to GSD v1 (`.planning/`) format. Runs `gsd_run from-gsd2`. Pass `--path <dir>` to migrate a project at a different path.
</objective>

<execution_context>
@{{GSD_PLUGIN_ROOT}}/gsd-core/workflows/import.md
@{{GSD_PLUGIN_ROOT}}/gsd-core/references/ui-brand.md
@{{GSD_PLUGIN_ROOT}}/gsd-core/references/gate-prompts.md
@{{GSD_PLUGIN_ROOT}}/gsd-core/references/doc-conflict-engine.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
If `--from-gsd2` is in $ARGUMENTS:
Run the reverse-migration (append `--path <dir>` if provided):
```bash
GSD_TOOLS="{{GSD_PLUGIN_ROOT}}/gsd-core/bin/gsd-tools.cjs"; gsd_run() { GSD_AGENTS_DIR="{{GSD_PLUGIN_ROOT}}/agents" node "$GSD_TOOLS" "$@"; }
gsd_run from-gsd2
```
Present the migration result to the user.
Stop here (do not run the standard import workflow).

Otherwise, execute the import workflow end-to-end.
</process>
