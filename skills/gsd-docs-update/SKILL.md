---
name: gsd-docs-update
description: "Generate or update project documentation verified against the codebase"
argument-hint: "[--force] [--verify-only]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
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
Generate and update up to 9 documentation files for the current project. Each doc type is written by a gsd-doc-writer subagent that explores the codebase directly — no hallucinated paths, phantom endpoints, or stale signatures.

Flag handling rule:
- The optional flags documented below are available behaviors, not implied active behaviors
- A flag is active only when its literal token appears in `$ARGUMENTS`
- If a documented flag is absent from `$ARGUMENTS`, treat it as inactive
- `--force`: skip preservation prompts, regenerate all docs regardless of existing content or GSD markers
- `--verify-only`: check existing docs for accuracy against codebase, no generation (full verification requires Phase 4 verifier)
- If `--force` and `--verify-only` both appear in `$ARGUMENTS`, `--force` takes precedence
</objective>

<execution_context>
@{{GSD_PLUGIN_ROOT}}/gsd-core/workflows/docs-update.md
</execution_context>

<context>
Arguments: $ARGUMENTS

**Available optional flags (documentation only — not automatically active):**
- `--force` — Regenerate all docs. Overwrites hand-written and GSD docs alike. No preservation prompts.
- `--verify-only` — Check existing docs for accuracy against the codebase. No files are written. Reports VERIFY marker count. Full codebase fact-checking requires the gsd-doc-verifier agent (Phase 4).

**Active flags must be derived from `$ARGUMENTS`:**
- `--force` is active only if the literal `--force` token is present in `$ARGUMENTS`
- `--verify-only` is active only if the literal `--verify-only` token is present in `$ARGUMENTS`
- If neither token appears, run the standard full-phase generation flow
- Do not infer that a flag is active just because it is documented in this prompt
</context>

<process>
Execute end-to-end.
Preserve all workflow gates (preservation_check, flag handling, wave execution, monorepo dispatch, commit, reporting).
</process>
