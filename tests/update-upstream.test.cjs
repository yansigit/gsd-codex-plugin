'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.resolve(__dirname, '..', 'tools', 'update-upstream.cjs');
const { transformSkill, transformWorkflow, transformAgent } = require(SCRIPT);

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(repo, ...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function makeUpstream(root, broken = false) {
  const repo = path.join(root, broken ? 'broken-upstream' : 'upstream');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '-b', 'next');
  git(repo, 'config', 'user.name', 'Updater Test');
  git(repo, 'config', 'user.email', 'updater@example.com');
  const pkg = {
    name: 'fixture-gsd',
    version: broken ? '9.9.1' : '9.9.0',
    scripts: {
      'build:lib': broken ? 'node missing-build-script.cjs' : 'node build.cjs',
      'gen:plugin-skills': 'node generate-skills.cjs',
    },
  };
  write(path.join(repo, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  write(path.join(repo, 'LICENSE'), 'fixture license\n');
  write(path.join(repo, 'package-lock.json'), `${JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version: pkg.version } } }, null, 2)}\n`);
  write(path.join(repo, 'build.cjs'), "require('node:fs').mkdirSync('gsd-core/bin/lib',{recursive:true});require('node:fs').writeFileSync('gsd-core/bin/lib/cli-exit.cjs','module.exports = {};\\n');\n");
  write(path.join(repo, 'generate-skills.cjs'), "require('node:fs').writeFileSync('skills/gsd-test/SKILL.md', require('node:fs').readFileSync('skill-source.md'));\n");
  write(path.join(repo, 'skill-source.md'), '---\nname: gsd-test\ndescription: test\n---\n\n@~/.claude/gsd-core/workflows/test.md\nRead $HOME/.claude/agents/gsd-test.md.\n_GSD_RUNTIME_ROOT=x; gsd_run() { bad; }\n');
  write(path.join(repo, 'gsd-core', 'workflows', 'test.md'), 'fixture workflow\n');
  write(path.join(repo, 'agents', 'gsd-test.md'), 'fixture agent\n');
  write(path.join(repo, 'skills', 'gsd-test', 'SKILL.md'), 'stale generated skill\n');
  for (const dir of ['bin', 'commands', 'hooks', 'scripts']) write(path.join(repo, dir, 'fixture.txt'), `${dir}\n`);
  fs.chmodSync(path.join(repo, 'scripts', 'fixture.txt'), 0o755);
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'fixture');
  return repo;
}

function makePlugin(root) {
  const plugin = path.join(root, 'plugin');
  write(path.join(plugin, 'tools', 'update-upstream.cjs'), fs.readFileSync(SCRIPT));
  write(path.join(plugin, 'tools', 'prune-legacy-commands.cjs'), fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'prune-legacy-commands.cjs')));
  write(path.join(plugin, 'package.json'), '{"version":"0.1.0"}\n');
  write(path.join(plugin, '.codex-plugin', 'plugin.json'), '{"name":"gsd-codex-plugin","version":"0.1.0"}\n');
  for (const dir of ['gsd-core', 'agents', 'skills', 'bin', 'commands', 'hooks', 'scripts']) write(path.join(plugin, dir, 'old.txt'), `old ${dir}\n`);
  write(path.join(plugin, 'upstream.lock.json'), '{"old":true}\n');
  write(path.join(plugin, 'upstream-modes.txt'), 'old-mode\n');
  return plugin;
}

test('transformSkill makes runtime and legacy agent paths plugin-relative', () => {
  const transformed = transformSkill('---\nname: x\n---\n@~/.claude/gsd-core/a.md\n@$HOME/.codex/agents/a.md\n_GSD_RUNTIME_ROOT=x; gsd_run() { bad; }\n');
  assert.match(transformed, /<plugin_runtime>/);
  assert.match(transformed, /@\{\{GSD_PLUGIN_ROOT\}\}\/gsd-core\/a\.md/);
  assert.match(transformed, /@\{\{GSD_PLUGIN_ROOT\}\}\/agents\/a\.md/);
  assert.match(transformed, /GSD_TOOLS="\{\{GSD_PLUGIN_ROOT\}\}\/gsd-core\/bin\/gsd-tools\.cjs"/);
  assert.match(transformed, /Plugin-bundled `agents\/\*\.md` files are the agent definitions/);
  assert.match(transformed, /GSD_AGENTS_DIR="\{\{GSD_PLUGIN_ROOT\}\}\/agents" node/);
  assert.match(transformed, /global Codex agents directory is empty/);
  assert.match(transformed, /host's general delegation tool/);
  assert.doesNotMatch(transformed, /_GSD_RUNTIME_ROOT=/);
  assert.doesNotMatch(transformed, /^\+-/m);
});

test('transformSkill refreshes an existing plugin runtime adapter', () => {
  const transformed = transformSkill('---\nname: x\n---\n\n<plugin_runtime>\nstale adapter\n</plugin_runtime>\n');
  assert.doesNotMatch(transformed, /stale adapter/);
  assert.match(transformed, /Plugin-bundled `agents\/\*\.md` files are the agent definitions/);
  assert.equal((transformed.match(/<plugin_runtime>/g) || []).length, 1);
});

test('transformSkill is idempotent and updates every runtime helper', () => {
  const source = '---\nname: x\n---\n_GSD_RUNTIME_ROOT=one; gsd_run() { bad; }\n_GSD_RUNTIME_ROOT=two; gsd_run() { bad; }\n';
  const once = transformSkill(source);
  assert.equal((once.match(/gsd_run\(\) \{ GSD_AGENTS_DIR=/g) || []).length, 2);
  assert.equal(transformSkill(once), once);
});

test('bundled agents satisfy the upstream Codex availability check', () => {
  const output = execFileSync(process.execPath, [path.resolve(__dirname, '..', 'gsd-core', 'bin', 'gsd-tools.cjs'), 'validate', 'agents'], {
    encoding: 'utf8',
    env: { ...process.env, GSD_RUNTIME: 'codex', GSD_AGENTS_DIR: path.resolve(__dirname, '..', 'agents') },
  });
  const status = JSON.parse(output);
  assert.equal(status.agents_found, true);
  assert.deepEqual(status.missing, []);
});
test('committed generated corpus resolves legacy paths and launchers include GSD_AGENTS_DIR', () => {
  const targetDirs = [
    path.resolve(__dirname, '..', 'skills'),
    path.resolve(__dirname, '..', 'agents'),
    path.resolve(__dirname, '..', 'gsd-core', 'workflows'),
  ];
  for (const dir of targetDirs) {
    const pending = [dir];
    while (pending.length) {
      const cur = pending.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, entry.name);
        if (entry.isDirectory()) pending.push(full);
        else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.sh'))) {
          const content = fs.readFileSync(full, 'utf8');
          const body = content.replace(/<plugin_runtime>[\s\S]*?<\/plugin_runtime>/, '');
          assert.doesNotMatch(body, /(?:\$HOME|~)\/(?:\.claude|\.codex)\/(?:gsd-core|agents)/, `legacy path found in ${path.relative(path.resolve(__dirname, '..'), full)}`);
          if (content.includes('gsd_run()')) {
            assert.match(content, /gsd_run\(\)\s*\{\s*GSD_AGENTS_DIR=/, `launcher missing GSD_AGENTS_DIR in ${path.relative(path.resolve(__dirname, '..'), full)}`);
          }
        }
      }
    }
  }
});

test('raw workflow launchers receive GSD_AGENTS_DIR while preserving launcher structure', () => {
  const rawSnippet = '_GSD_SHIM_NAME="gsd-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}"; if _gsd_at "${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.claude/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.codex/gsd-core/bin/${_GSD_SHIM_NAME}"; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif unset -f gsd_run; _G="$(command -v gsd_run)"; then GSD_TOOLS="$_G"; gsd_run() { "$GSD_TOOLS" "$@"; }; elif _gsd_at "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/gsd-core/bin/${_GSD_SHIM_NAME}"; then gsd_run() { node "$GSD_TOOLS" "$@"; }; else echo "ERROR" >&2; exit 1; fi;';
  const transformed = transformWorkflow(rawSnippet);
  assert.doesNotMatch(transformed, /(?:\$HOME|~)\/(?:\.claude|\.codex)\/gsd-core/);
  const matches = transformed.match(/gsd_run\(\)\s*\{\s*GSD_AGENTS_DIR="\{\{GSD_PLUGIN_ROOT\}\}\/agents"/g) || [];
  assert.equal(matches.length, 3);
});

test('agent paths resolve plugin-relative across skills, workflows, and agents', () => {
  const text = '@~/.claude/agents/gsd-executor.md\n@$HOME/.codex/agents/gsd-planner.md\nRead ~/.claude/agents/gsd-verifier.md';
  for (const fn of [transformSkill, transformWorkflow, transformAgent]) {
    const res = fn(text);
    assert.match(res, /@\{\{GSD_PLUGIN_ROOT\}\}\/agents\/gsd-executor\.md/);
    assert.match(res, /@\{\{GSD_PLUGIN_ROOT\}\}\/agents\/gsd-planner\.md/);
    assert.match(res, /Read \{\{GSD_PLUGIN_ROOT\}\}\/agents\/gsd-verifier\.md/);
    assert.doesNotMatch(res, /(?:\$HOME|~)\/(?:\.claude|\.codex)\/agents/);
  }
});

test('injected adapter instructions cover lifecycle, capacity batching, tool vocabulary, and isolation', () => {
  const transformed = transformSkill('---\nname: test\n---\nbody\n');
  assert.match(transformed, /Track every returned agent id/);
  assert.match(transformed, /use three when unknown/);
  assert.match(transformed, /Never expect or read `async_launched\.outputFile`/);
  assert.match(transformed, /otherwise show a numbered plain-text choice/);
  assert.match(transformed, /dispatch-isolation --raw --force-isolation none/);
  assert.match(transformed, /Never run parallel agents that may edit overlapping files/);
  assert.match(transformed, /Plugin manifests do not activate the vendored GSD hooks/);
});

test('transformations are idempotent on skills, workflows, and agents', () => {
  const skillSource = '---\nname: x\n---\n@~/.claude/gsd-core/w.md\n@~/.claude/agents/a.md\n_GSD_RUNTIME_ROOT=one; gsd_run() { bad; }\n';
  const onceSkill = transformSkill(skillSource);
  assert.equal(transformSkill(onceSkill), onceSkill);

  const workflowSource = 'Workflow text\n@~/.claude/gsd-core/w.md\n@$HOME/.codex/agents/a.md\ngsd_run() { node "$GSD_TOOLS" "$@"; }\n';
  const onceWorkflow = transformWorkflow(workflowSource);
  assert.equal(transformWorkflow(onceWorkflow), onceWorkflow);

  const agentSource = 'Agent text\n@~/.claude/gsd-core/ref.md\ngsd_run() { "$GSD_TOOLS" "$@"; }\n';
  const onceAgent = transformAgent(agentSource);
  assert.equal(transformAgent(onceAgent), onceAgent);
});

test('sync builds upstream, replaces generated trees, and records the exact revision', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-updater-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = makeUpstream(root);
  const plugin = makePlugin(root);
  execFileSync(process.execPath, [path.join(plugin, 'tools', 'update-upstream.cjs'), '--repo', upstream, '--ref', 'next'], { cwd: plugin, stdio: 'pipe' });

  assert.equal(fs.existsSync(path.join(plugin, 'gsd-core', 'old.txt')), false);
  assert.equal(fs.existsSync(path.join(plugin, 'gsd-core', 'bin', 'lib', 'cli-exit.cjs')), true);
  assert.equal(fs.readFileSync(path.join(plugin, 'agents', 'gsd-test.md'), 'utf8'), 'fixture agent\n');
  for (const dir of ['bin', 'commands', 'hooks', 'scripts']) assert.equal(fs.readFileSync(path.join(plugin, dir, 'fixture.txt'), 'utf8'), `${dir}\n`);
  assert.equal(fs.readFileSync(path.join(plugin, 'UPSTREAM-LICENSE'), 'utf8'), 'fixture license\n');
  assert.equal(fs.readFileSync(path.join(plugin, 'upstream-modes.txt'), 'utf8'), 'scripts/fixture.txt\n');
  const skill = fs.readFileSync(path.join(plugin, 'skills', 'gsd-test', 'SKILL.md'), 'utf8');
  assert.match(skill, /\{\{GSD_PLUGIN_ROOT\}\}\/gsd-core\/workflows\/test\.md/);
  assert.match(skill, /\{\{GSD_PLUGIN_ROOT\}\}\/agents\/gsd-test\.md/);
  const lock = JSON.parse(fs.readFileSync(path.join(plugin, 'upstream.lock.json'), 'utf8'));
  assert.deepEqual(lock, { repo: upstream, ref: 'next', commit: git(upstream, 'rev-parse', 'HEAD'), version: '9.9.0' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(plugin, 'package.json'))).version, `9.9.0+gsd.${lock.commit.slice(0, 12)}.wrapper.2`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(plugin, '.codex-plugin', 'plugin.json'))).version, `9.9.0+gsd.${lock.commit.slice(0, 12)}.wrapper.2`);
});

test('a failed upstream build leaves every generated file unchanged', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-updater-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = makeUpstream(root, true);
  const plugin = makePlugin(root);
  const result = spawnSync(process.execPath, [path.join(plugin, 'tools', 'update-upstream.cjs'), '--repo', upstream, '--ref', 'next'], { cwd: plugin, encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  for (const dir of ['gsd-core', 'agents', 'skills', 'bin', 'commands', 'hooks', 'scripts']) {
    assert.equal(fs.readFileSync(path.join(plugin, dir, 'old.txt'), 'utf8'), `old ${dir}\n`);
  }
  assert.equal(fs.readFileSync(path.join(plugin, 'upstream.lock.json'), 'utf8'), '{"old":true}\n');
  assert.equal(fs.readFileSync(path.join(plugin, 'upstream-modes.txt'), 'utf8'), 'old-mode\n');
});
