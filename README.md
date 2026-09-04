# GSD Core for Codex

A community-maintained Codex plugin distribution of [GSD Core](https://github.com/open-gsd/gsd-core).

It packages GSD's skills and compiled runtime for Git marketplace installs, adds a project Control Center, and provides guarded pass/issue recording for pending UAT checks. It is not maintained or endorsed by the OpenGSD maintainers.

## Install

```bash
codex plugin marketplace add yansigit/gsd-codex-plugin --ref main
codex plugin add gsd-codex-plugin@gsd-codex-community
```

The plugin is local: its MCP server runs with Node.js and only operates on project paths supplied to its tools. State-changing MCP calls additionally require the project to be inside a workspace root supplied by the client or `GSD_ALLOWED_ROOTS`; read-only status tools remain available without that authorization. No npm or bunx installation is required at runtime.

GSD agent definitions are bundled with the plugin and delegated through Codex's sub-agent tool when available; workflows retain their inline fallback otherwise. The plugin does not require a second global GSD install or write agent roles into `~/.codex/agents`.

### Limitations and isolation

- **Hooks limitation**: Plugin installation does not register the vendored GSD lifecycle hooks. The runtime adapter therefore applies protected-branch, write-boundary, base-check, and prompt-injection requirements directly instead of claiming those hooks ran.
- **Sub-agent isolation**: Generic Codex sub-agents share the current working directory. The adapter disables GSD's worktree-isolation path unless the active host delegation API explicitly provides worktree isolation, batches work to the host's child capacity, and avoids parallel edits to overlapping files.

### Updating and marketplace flow

To update an existing installation to the latest published release:

```bash
codex plugin add gsd-codex-plugin@gsd-codex-community
```

Wrapper-only releases receive a distinct wrapper build version (e.g. `wrapper.2`), ensuring Codex detects the release and provisions a fresh cache entry. Always start a new thread after updating so Codex loads the latest skills and MCP tools.

## Updating upstream

`npm run sync` rebuilds the vendored distribution from `open-gsd/gsd-core@next`. Generated runtime directories are replaced wholesale, so upstream history is never merged or rebased into this repository.

The scheduled workflow publishes an update only when its tests pass. A breaking upstream change leaves the last working revision untouched.

## Ownership and licenses

The Codex wrapper is maintained here under the MIT License. Vendored GSD Core files retain their upstream MIT license and attribution in `UPSTREAM-LICENSE` and `upstream.lock.json`.
