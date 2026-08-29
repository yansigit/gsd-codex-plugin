# GSD Core for Codex

A community-maintained Codex plugin distribution of [GSD Core](https://github.com/open-gsd/gsd-core).

It packages GSD's skills and compiled runtime for Git marketplace installs, adds a project Control Center, and provides guarded pass/issue recording for pending UAT checks. It is not maintained or endorsed by the OpenGSD maintainers.

## Install

```bash
codex plugin marketplace add yansigit/gsd-codex-plugin --ref main
codex plugin add gsd-codex-plugin@gsd-codex-community
```

The plugin is local: its MCP server runs with Node.js and only operates on project paths supplied to its tools. No npm or bunx installation is required at runtime.

## Updating upstream

`npm run sync` rebuilds the vendored distribution from `open-gsd/gsd-core@next`. Generated runtime directories are replaced wholesale, so upstream history is never merged or rebased into this repository.

The scheduled workflow publishes an update only when its tests pass. A breaking upstream change leaves the last working revision untouched.

## Ownership and licenses

The Codex wrapper is maintained here under the MIT License. Vendored GSD Core files retain their upstream MIT license and attribution in `UPSTREAM-LICENSE` and `upstream.lock.json`.
