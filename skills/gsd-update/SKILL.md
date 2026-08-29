---
name: gsd-update
description: "Update GSD to latest version with changelog display"
argument-hint: "[--sync | --reapply | --next | --rc]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<plugin_runtime>
- Resolve `{{GSD_PLUGIN_ROOT}}` from this skill's absolute `SKILL.md` path by ascending from `<plugin>/skills/<skill>/SKILL.md` to `<plugin>`. Verify `.codex-plugin/plugin.json` exists there.
- Substitute that absolute path for every literal `{{GSD_PLUGIN_ROOT}}`; it is a skill placeholder, not an environment variable.
- Apply this recursively to loaded files: legacy `~/.claude/gsd-core` and `~/.codex/gsd-core` paths resolve to `{{GSD_PLUGIN_ROOT}}/gsd-core`, while legacy `~/.claude/agents` and `~/.codex/agents` paths resolve to `{{GSD_PLUGIN_ROOT}}/agents`.
- Run GSD commands as `node "{{GSD_PLUGIN_ROOT}}/gsd-core/bin/gsd-tools.cjs"`. Never use a project copy, PATH, or a global installation.
</plugin_runtime>


<objective>
Check for GSD updates, install if available, and display what changed.

Routes to the update workflow which handles:
- Version detection (local vs global installation)
- npm version checking
- Changelog fetching and display
- User confirmation with clean install warning
- Update execution and cache clearing
- Restart reminder
</objective>

<execution_context>
@{{GSD_PLUGIN_ROOT}}/gsd-core/workflows/update.md
</execution_context>

<flags>
- **--sync**: Sync managed GSD skills across runtime roots so multi-runtime users stay aligned after an update. Runs the sync-skills workflow (--from, --to, --dry-run, --apply flags supported).
- **--reapply**: Reapply local modifications after a GSD update. Uses three-way comparison (pristine baseline, user-modified backup, newly installed version) to merge user customizations back. Runs the reapply-patches workflow.
- **--next** (alias **--rc**): Target the `@next` RC dist-tag instead of `@latest` so you can install or refresh a release candidate (e.g. `1.4.0-rc.1`) through the normal update flow — scope/runtime detection, changelog preview, custom-file backup, and cache clearing all still apply. Omitting it keeps targeting `@latest` (no change). See ADR #660 for the RC channel.
- **(no flag)**: Standard update — check for new version, show changelog, install.
</flags>

<process>
Parse the first token of $ARGUMENTS:
- If it is `--sync`: strip the flag, execute the sync-skills workflow (passing remaining args for --from/--to/--dry-run/--apply).
- If it is `--reapply`: strip the flag, execute the reapply-patches workflow.
- Otherwise (including `--next` / `--rc`): execute the update workflow end-to-end, passing `$ARGUMENTS` through so the workflow's parse_update_channel step can select the release channel.

</process>

<execution_context_extended>
@{{GSD_PLUGIN_ROOT}}/gsd-core/workflows/sync-skills.md
@{{GSD_PLUGIN_ROOT}}/gsd-core/workflows/reapply-patches.md
</execution_context_extended>
