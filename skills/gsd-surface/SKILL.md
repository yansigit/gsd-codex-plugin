---
name: gsd-surface
description: "Toggle which skills are surfaced — apply a profile, list, or disable a cluster without reinstall"
argument-hint: "[list|status|profile <name>|disable <cluster>|enable <cluster>|reset]"
allowed-tools:
  - Read
  - Write
  - Bash
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
Manage the runtime skill surface without reinstall. Reads/writes `~/.claude/.gsd-surface.json`
(sibling to `~/.claude/.gsd-profile`) and re-stages the active skills directory in place.
Skill dirs live at `~/.claude/skills/gsd-*/`.

Sub-commands: list · status · profile · disable · enable · reset
</objective>

## Sub-command routing

Parse the first token of $ARGUMENTS:

| Token | Action |
|---|---|
| `list` | Show enabled + disabled clusters and skills |
| `status` | Alias for `list` plus token cost summary |
| `profile <name>` | Write `baseProfile` and re-stage |
| `profile <n1>,<n2>` | Composed profiles (comma-separated, no spaces) |
| `disable <cluster>` | Add cluster to `disabledClusters`, re-stage |
| `enable <cluster>` | Remove cluster from `disabledClusters`, re-stage |
| `reset` | Delete `.gsd-surface.json`, return to install-time profile |
| *(none)* | Treat as `list` |

---

## list / status

Load the capability registry and call `listSurface(runtimeConfigDir, manifest, CLUSTERS, registry)` from
the engine module at `${runtimeConfigDir}/gsd-core/bin/lib/surface.cjs`. The registry is loaded via:
```js
const registry = require(runtimeConfigDir + '/gsd-core/bin/lib/capability-registry.cjs');
```
Display:

```
Enabled (N skills, ~T tokens):
  core_loop:   new-project  discuss-phase  plan-phase  execute-phase  help  update
  audit_review: …
  …

Disabled:
  utility:  health  stats  settings  …

Token cost: ~T (budget cap ~500 tokens for 200k context @ 1%)
```

For `status` also append:

```
Base profile:   standard  (from .gsd-surface.json)
Install profile: standard  (from .gsd-profile)
```

---

## profile \<name\>

1. Read current surface: `readSurface(runtimeConfigDir)` → if null, seed from `readActiveProfile(runtimeConfigDir)`.
2. Set `surfaceState.baseProfile = name`.
3. `writeSurface(runtimeConfigDir, surfaceState)`.
4. Resolve and re-apply:
   ```js
   const registry = require(runtimeConfigDir + '/gsd-core/bin/lib/capability-registry.cjs');
   const layout = resolveRuntimeArtifactLayout(runtime, runtimeConfigDir, scope);
   applySurface(runtimeConfigDir, layout, manifest, CLUSTERS, registry);
   ```
5. Confirm: "Surface updated to profile `<name>`. N skills enabled."

---

## disable \<cluster\>

Valid cluster names: `core_loop`, `audit_review`, `milestone`, `research_ideate`,
`workspace_state`, `docs`, `ui`, `ai_eval`, `ns_meta`, `utility`.

1. Validate cluster name against `Object.keys(CLUSTERS)`.
2. Read or initialize surface state.
3. Add cluster to `surfaceState.disabledClusters` (deduplicate).
4. `writeSurface` → resolve layout → `applySurface`:
   ```js
   const registry = require(runtimeConfigDir + '/gsd-core/bin/lib/capability-registry.cjs');
   const layout = resolveRuntimeArtifactLayout(runtime, runtimeConfigDir, scope);
   applySurface(runtimeConfigDir, layout, manifest, CLUSTERS, registry);
   ```
5. Confirm: "Disabled cluster `<cluster>`. N skills removed from surface."

---

## enable \<cluster\>

1. Read surface state; if null, nothing to enable — print "No surface delta active."
2. Remove cluster from `surfaceState.disabledClusters`.
3. `writeSurface` → resolve layout → `applySurface`:
   ```js
   const registry = require(runtimeConfigDir + '/gsd-core/bin/lib/capability-registry.cjs');
   const layout = resolveRuntimeArtifactLayout(runtime, runtimeConfigDir, scope);
   applySurface(runtimeConfigDir, layout, manifest, CLUSTERS, registry);
   ```
4. Confirm: "Enabled cluster `<cluster>`. N skills added back to surface."

---

## reset

1. Check if `.gsd-surface.json` exists.
2. Delete it.
3. Re-apply using only `readActiveProfile(runtimeConfigDir)` (install-time profile).
4. Confirm: "Surface reset to install-time profile `<name>`."

---

## runtimeConfigDir resolution

The `runtimeConfigDir` for `applySurface` is the **base Claude config directory**
(`~/.claude`), NOT the skills sub-directory (`~/.claude/skills`).

This matches `installRuntimeArtifacts` and `uninstallRuntimeArtifacts`, which also
receive `~/.claude` as `configDir`. The skill dirs themselves live at
`~/.claude/skills/gsd-*/` because the `claude global` layout has `destSubpath =
'skills'` — they are derived from `configDir`, not the root for it.

```bash
# Claude Code — global install
RUNTIME_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SCOPE="global"

# Artifact destinations are derived from runtime layout
# via resolveRuntimeArtifactLayout(runtime, RUNTIME_CONFIG_DIR, SCOPE)
# then applySurface(RUNTIME_CONFIG_DIR, layout, manifest, CLUSTERS)
```

Surface state is stored at `${RUNTIME_CONFIG_DIR}/.gsd-surface.json`
(i.e. `~/.claude/.gsd-surface.json`).

All paths can be overridden by reading the `CLAUDE_CONFIG_DIR` env var if set.

---

## Error handling

- Unknown cluster name → list valid cluster names, exit without writing.
- Unknown profile name → list known profiles (`core`, `standard`, `full`), exit.
- Missing `surface.cjs` → prompt: "Reinstall the GSD Core plugin."

<execution_context>
Surface state file: `~/.claude/.gsd-surface.json`
Install profile marker: `~/.claude/.gsd-profile`
Skill dirs: `~/.claude/skills/gsd-*/`
Engine module: `{{GSD_PLUGIN_ROOT}}/gsd-core/bin/lib/surface.cjs`
Cluster definitions: `{{GSD_PLUGIN_ROOT}}/gsd-core/bin/lib/clusters.cjs`
</execution_context>
