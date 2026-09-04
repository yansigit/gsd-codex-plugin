---
name: gsd-graphify
description: "Build, query, and inspect the project knowledge graph in .planning/graphs/"
argument-hint: "[build|query <term>|status|diff]"
allowed-tools:
  - Read
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


**STOP -- DO NOT READ THIS FILE. You are already reading it. This prompt was injected into your context by Claude Code's command system. Using the Read tool on this file wastes tokens. Begin executing Step 0 immediately.**

**CJS-only (graphify):** `graphify` subcommands are not registered on `gsd-tools query`. Use the `gsd_run` launcher shim (defined in each bash block below) or invoke the binary directly: `node <runtime-home>/gsd-core/bin/gsd-tools.cjs graphify …` where `<runtime-home>` is your runtime's config directory (e.g. `~/.claude`, `~/.hermes`, `~/.cursor`). See `docs/CLI-TOOLS.md` for details. Other tooling may still use `gsd-tools query` where a handler exists.

## Step 0 -- Banner

**Before ANY tool calls**, display this banner:

```
GSD > GRAPHIFY
```

Then proceed to Step 1.

## Step 1 -- Config Gate

Check if graphify is enabled by reading `.planning/config.json` directly using the Read tool.

**DO NOT use the gsd-tools config get-value command** -- it hard-exits on missing keys.

1. Read `.planning/config.json` using the Read tool
2. If the file does not exist: display the disabled message below and **STOP**
3. Parse the JSON content. Check if `config.graphify && config.graphify.enabled === true`
4. If `graphify.enabled` is NOT explicitly `true`: display the disabled message below and **STOP**
5. If `graphify.enabled` is `true`: proceed to Step 2

**Disabled message:**

```
GSD > GRAPHIFY

Knowledge graph is disabled. To activate:

  node <runtime-home>/gsd-core/bin/gsd-tools.cjs config-set graphify.enabled true

Then run /gsd-graphify build to create the initial graph.
```

---

## Step 2 -- Parse Argument

Parse `$ARGUMENTS` to determine the operation mode:

| Argument | Action |
|----------|--------|
| `build` | Run inline build (Step 3) |
| `query <term>` | Run inline query (Step 2a) |
| `status` | Run inline status check (Step 2b) |
| `diff` | Run inline diff check (Step 2c) |
| No argument or unknown | Show usage message |

**Usage message** (shown when no argument or unrecognized argument):

```
GSD > GRAPHIFY

Usage: /gsd-graphify <mode>

Modes:
  build           Build or rebuild the knowledge graph
  query <term>    Search the graph for a term
  status          Show graph freshness and statistics
  diff            Show changes since last build
```

### Step 2a -- Query

Run:

```bash
GSD_TOOLS="{{GSD_PLUGIN_ROOT}}/gsd-core/bin/gsd-tools.cjs"; gsd_run() { GSD_AGENTS_DIR="{{GSD_PLUGIN_ROOT}}/agents" node "$GSD_TOOLS" "$@"; }
gsd_run graphify query <term>
```

Parse the JSON output and display results:
- If the output contains `"disabled": true`, display the disabled message from Step 1 and **STOP**
- If the output contains `"error"` field, display the error message and **STOP**
- If no nodes found, display: `No graph matches for '<term>'. Try /gsd-graphify build to create or rebuild the graph.`
- Otherwise, display matched nodes grouped by type, with edge relationships and confidence tiers (EXTRACTED/INFERRED/AMBIGUOUS)

**STOP** after displaying results. Do not spawn an agent.

### Step 2b -- Status

Run:

```bash
GSD_TOOLS="{{GSD_PLUGIN_ROOT}}/gsd-core/bin/gsd-tools.cjs"; gsd_run() { GSD_AGENTS_DIR="{{GSD_PLUGIN_ROOT}}/agents" node "$GSD_TOOLS" "$@"; }
gsd_run graphify status
```

Parse the JSON output and display:
- If `exists: false`, display the message field
- Otherwise show last build time, node/edge/hyperedge counts, and STALE or FRESH indicator
- If `built_at_commit` is non-null, also display a `Source commit:` line:
  - `commit_stale === false` (rebuilt at HEAD): `Source commit: <built_at_commit> (current)`
  - `commit_stale === true` (graph behind HEAD): `Source commit: <built_at_commit> (<commits_behind> commits behind HEAD)`
  - `commit_stale === null` (unreachable commit / no git): `Source commit: <built_at_commit> (freshness unknown)`
- If `built_at_commit` is null (pre-graphify-v0.7 graph), omit the source-commit line entirely — do not render "Source commit: unknown"

The mtime-based STALE/FRESH flag and the commit-based `commit_stale` measure
different things and can disagree (e.g., a CI-built graph rebuilt minutes ago
against an old checkout reads as FRESH on mtime but `commit_stale: true`).
Surface both so the agent can choose.

**STOP** after displaying status. Do not spawn an agent.

### Step 2c -- Diff

Run:

```bash
GSD_TOOLS="{{GSD_PLUGIN_ROOT}}/gsd-core/bin/gsd-tools.cjs"; gsd_run() { GSD_AGENTS_DIR="{{GSD_PLUGIN_ROOT}}/agents" node "$GSD_TOOLS" "$@"; }
gsd_run graphify diff
```

Parse the JSON output and display:
- If `no_baseline: true`, display the message field
- Otherwise show node and edge change counts (added/removed/changed)

If no snapshot exists, suggest running `build` twice (first to create, second to generate a diff baseline).

**STOP** after displaying diff. Do not spawn an agent.

---

## Step 3 -- Build (Inline)

Run the pre-flight check first:

```bash
GSD_TOOLS="{{GSD_PLUGIN_ROOT}}/gsd-core/bin/gsd-tools.cjs"; gsd_run() { GSD_AGENTS_DIR="{{GSD_PLUGIN_ROOT}}/agents" node "$GSD_TOOLS" "$@"; }
gsd_run graphify build
```

Parse the JSON output:
- If `disabled: true`: display the disabled message from Step 1 and **STOP**
- If `error`: display the error message and **STOP**
- If `action: "spawn_agent"`: pre-flight passed -- proceed with the inline build below

(The `spawn_agent` action name is historical. The skill now performs the build inline because graphify v0.7+ split the build into a fast AST-extraction phase and a separate clustering + report-write phase. Sub-agent isolation kept the cached extraction phase alive but SIGTERM'd the post-extraction phase when the agent exited, leaving the cache populated but no `graph.json` artifacts written. The CLI still emits the `spawn_agent` signal so external callers and tests keep working.)

Display:

```text
GSD > Building knowledge graph...
```

Run the build, copy artifacts, write the diff snapshot, and report the summary in a single foreground Bash call so the whole pipeline survives to completion. Use a `timeout` of `600000` ms (10 minutes), which covers the `graphify.build_timeout` ceiling (default 300 s) with margin:

```bash
GSD_TOOLS="{{GSD_PLUGIN_ROOT}}/gsd-core/bin/gsd-tools.cjs"; gsd_run() { GSD_AGENTS_DIR="{{GSD_PLUGIN_ROOT}}/agents" node "$GSD_TOOLS" "$@"; }
graphify update . \
  && cp graphify-out/graph.json .planning/graphs/graph.json \
  && { [ -f graphify-out/graph.html ] && cp graphify-out/graph.html .planning/graphs/graph.html || true; } \
  && cp graphify-out/GRAPH_REPORT.md .planning/graphs/GRAPH_REPORT.md \
  && gsd_run graphify build snapshot \
  && gsd_run graphify status
```

Do NOT pass `run_in_background: true`. Typical builds complete in 15-60 seconds and the entire chain must run foreground.

If the chain fails (non-zero exit):
- Display: `## GRAPHIFY BUILD FAILED` followed by the captured stderr
- Do NOT delete `.planning/graphs/` -- the prior valid graph remains available
- **STOP**

If the chain succeeds:
- Parse the trailing `graphify status` JSON
- Display: `## GRAPHIFY BUILD COMPLETE` with the node, edge, and hyperedge counts

---

## MVP-Mode Node Rendering

**MVP-mode rendering.** When a phase has `**Mode:** mvp` in ROADMAP.md (resolved via `gsd-tools query roadmap.get-phase --pick mode`), render its graph node with two distinct visual signals:

1. **Distinct fill color.** Use `#22c55e` (green) for MVP-mode phase nodes. Standard phases keep the default fill color. Two-channel signaling (color + label) handles color-blind and grayscale renders.
2. **`MVP` label suffix.** Append ` (MVP)` to the node's label text. Example: a phase originally labeled `Phase 1: User Auth` renders as `Phase 1: User Auth (MVP)`.

Both signals fire together — never just one. Per PRD Q5 decision, the goal is unambiguous visual distinction in any render context.

When the phase mode is null/absent, render with the standard color and label — no behavioral change for non-MVP phases.

---

## Anti-Patterns

1. DO NOT spawn an agent for any operation -- build, query, status, and diff all run inline. Sub-agent isolation terminates background bash when the agent exits, which previously truncated graphify builds mid-write and left only the cache populated (#3166).
2. DO NOT pass `run_in_background: true` for the build chain -- the operation is fast and must complete in the foreground.
3. DO NOT modify graph files directly -- always go through `graphify update .` and the snapshot CLI.
4. DO NOT skip the config gate check.
5. DO NOT use `gsd-tools config get-value` for the config gate -- it exits on missing keys.
