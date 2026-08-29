'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.resolve(__dirname, '..', 'tools', 'update-upstream.cjs');
const { transformSkill } = require(SCRIPT);

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
  assert.doesNotMatch(transformed, /_GSD_RUNTIME_ROOT=/);
  assert.doesNotMatch(transformed, /^\+-/m);
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
  assert.equal(JSON.parse(fs.readFileSync(path.join(plugin, 'package.json'))).version, `9.9.0+gsd.${lock.commit.slice(0, 12)}.wrapper.1`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(plugin, '.codex-plugin', 'plugin.json'))).version, `9.9.0+gsd.${lock.commit.slice(0, 12)}.wrapper.1`);
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
