---
name: gsd-review-backlog
description: "Review and promote backlog items to active milestone"
allowed-tools:
  - Read
  - Write
  - Bash
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
Review all 999.x backlog items and optionally promote them into the active
milestone sequence or remove stale entries.
</objective>

<process>

1. **List backlog items:**
   ```bash
   _BACKLOG=( .planning/phases/999* )
   if [ -e "${_BACKLOG[0]}" ]; then ls -d "${_BACKLOG[@]}"; else echo "No backlog items found"; fi
   ```

2. **Read ROADMAP.md** and extract all 999.x phase entries:
   ```bash
   cat .planning/ROADMAP.md
   ```
   Show each backlog item with its description, any accumulated context (CONTEXT.md, RESEARCH.md), and creation date.

3. **Present the list to the user** via AskUserQuestion:
   - For each backlog item, show: phase number, description, accumulated artifacts
   - Options per item: **Promote** (move to active), **Keep** (leave in backlog), **Remove** (delete)

4. **For items to PROMOTE:**
   - Find the next sequential phase number in the active milestone
   - Rename the directory from `999.x-slug` to `{new_num}-slug`:
     ```bash
     NEW_NUM=$(gsd-tools query phase.add "${DESCRIPTION}" --raw)
     ```
   - Move accumulated artifacts to the new phase directory
   - Update ROADMAP.md: move the entry from `## Backlog` section to the active phase list
   - Remove `(BACKLOG)` marker
   - Add appropriate `**Depends on:**` field

5. **For items to REMOVE:**
   - Delete the phase directory
   - Remove the entry from ROADMAP.md `## Backlog` section

6. **Commit changes:**
   ```bash
   gsd-tools query commit "docs: review backlog — promoted N, removed M" --files .planning/ROADMAP.md
   ```

7. **Report summary:**
   ```
   ## 📋 Backlog Review Complete

   Promoted: {list of promoted items with new phase numbers}
   Kept: {list of items remaining in backlog}
   Removed: {list of deleted items}
   ```

</process>
