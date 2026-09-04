---
name: gsd-profile-user
description: "Generate developer behavioral profile and create Claude-discoverable artifacts"
argument-hint: "[--questionnaire] [--refresh]"
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
Generate a developer behavioral profile from session analysis (or questionnaire) and produce artifacts (USER-PROFILE.md, `gsd-dev-preferences` skill config, CLAUDE.md section) that personalize Claude's responses.

Routes to the profile-user workflow which orchestrates the full flow: consent gate, session analysis or questionnaire fallback, profile generation, result display, and artifact selection.
</objective>

<execution_context>
@{{GSD_PLUGIN_ROOT}}/gsd-core/workflows/profile-user.md
@{{GSD_PLUGIN_ROOT}}/gsd-core/references/ui-brand.md
</execution_context>

<context>
Flags from $ARGUMENTS:
- `--questionnaire` -- Skip session analysis entirely, use questionnaire-only path
- `--refresh` -- Rebuild profile even when one exists, backup old profile, show dimension diff
</context>

<process>
Execute the profile-user workflow end-to-end.

The workflow handles all logic including:
1. Initialization and existing profile detection
2. Consent gate before session analysis
3. Session scanning and data sufficiency checks
4. Session analysis (profiler agent) or questionnaire fallback
5. Cross-project split resolution
6. Profile writing to USER-PROFILE.md
7. Result display with report card and highlights
8. Artifact selection (dev-preferences, CLAUDE.md sections)
9. Sequential artifact generation
10. Summary with refresh diff (if applicable)
</process>
