#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPO = 'https://github.com/open-gsd/gsd-core.git';
const DEFAULT_REF = 'next';
const PLUGIN_ROOT = '{{GSD_PLUGIN_ROOT}}';
const WRAPPER_VERSION = 1;
const GENERATED_DIRS = ['gsd-core', 'agents', 'skills', 'bin', 'commands', 'hooks', 'scripts'];
const GENERATED_FILES = ['UPSTREAM-LICENSE', 'upstream-modes.txt', 'upstream.lock.json'];

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', timeout: 10 * 60 * 1000 });
}

function output(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
}

function parseArgs(args) {
  const options = { repo: DEFAULT_REPO, ref: DEFAULT_REF };
  for (let i = 0; i < args.length; i += 1) {
    const name = args[i];
    if (name !== '--repo' && name !== '--ref') {
      throw new Error(`unknown argument: ${name}`);
    }
    const value = args[++i];
    if (!value) throw new Error(`missing value for ${name}`);
    options[name.slice(2)] = value;
  }
  return options;
}

function injectRuntimeInstructions(content) {
  if (content.includes('<plugin_runtime>')) return content;
  const end = content.startsWith('---\n') ? content.indexOf('\n---', 4) : -1;
  if (end < 0) return content;
  const insertAt = end + 4;
  const instructions = `\n\n<plugin_runtime>\n- Resolve \`${PLUGIN_ROOT}\` from this skill's absolute \`SKILL.md\` path by ascending from \`<plugin>/skills/<skill>/SKILL.md\` to \`<plugin>\`. Verify \`.codex-plugin/plugin.json\` exists there.\n- Substitute that absolute path for every literal \`${PLUGIN_ROOT}\`; it is a skill placeholder, not an environment variable.\n- Apply this recursively to loaded files: legacy \`~/.claude/gsd-core\` and \`~/.codex/gsd-core\` paths resolve to \`${PLUGIN_ROOT}/gsd-core\`, while legacy \`~/.claude/agents\` and \`~/.codex/agents\` paths resolve to \`${PLUGIN_ROOT}/agents\`.\n- Run GSD commands as \`node "${PLUGIN_ROOT}/gsd-core/bin/gsd-tools.cjs"\`. Never use a project copy, PATH, or a global installation.\n</plugin_runtime>`;
  return content.slice(0, insertAt) + instructions + content.slice(insertAt);
}

function transformSkill(content) {
  let transformed = content
    .replace(/(?:\$HOME|~)\/\.(?:claude|codex)\/gsd-core/g, `${PLUGIN_ROOT}/gsd-core`)
    .replace(/(?:\$HOME|~)\/\.(?:claude|codex)\/agents/g, `${PLUGIN_ROOT}/agents`);

  transformed = transformed.split('\n').map((line) => {
    if (line.includes('_GSD_RUNTIME_ROOT=') && line.includes('gsd_run()')) {
      return `GSD_TOOLS="${PLUGIN_ROOT}/gsd-core/bin/gsd-tools.cjs"; gsd_run() { node "$GSD_TOOLS" "$@"; }`;
    }
    if (line.includes('Verify `gsd-tools` is on PATH via `command -v gsd-tools`')) {
      return `  1. Verify \`${PLUGIN_ROOT}/gsd-core/bin/gsd-tools.cjs\` exists; if absent, report a broken GSD Core plugin installation and stop.`;
    }
    return line;
  }).join('\n')
    .replace(/Run `npm i -g @opengsd\/gsd-core` to reinstall GSD\./g, 'Reinstall the GSD Core plugin.')
    .replace(/Install GSD via 'npm i -g @opengsd\/gsd-core'/g, 'Reinstall the GSD Core plugin');

  return injectRuntimeInstructions(transformed);
}

function transformSkills(skillsDir) {
  const pending = [skillsDir];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && entry.name === 'SKILL.md') {
        fs.writeFileSync(file, transformSkill(fs.readFileSync(file, 'utf8')));
      }
    }
  }
}

function executablePaths(root) {
  const paths = [];
  const pending = GENERATED_DIRS.map((dir) => path.join(root, dir));
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && (fs.statSync(file).mode & 0o111)) paths.push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  return paths.sort();
}

function prepareUpstream(checkout) {
  run('npm', ['ci'], checkout);
  run('npm', ['run', 'build:lib'], checkout);
  const pkg = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8'));
  if (pkg.scripts && pkg.scripts['gen:plugin-skills']) {
    run('npm', ['run', 'gen:plugin-skills'], checkout);
  }
  for (const dir of GENERATED_DIRS) {
    if (!fs.statSync(path.join(checkout, dir), { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`upstream checkout is missing ${dir}/`);
    }
  }
  if (!fs.existsSync(path.join(checkout, 'gsd-core', 'bin', 'lib', 'cli-exit.cjs'))) {
    throw new Error('upstream build did not produce gsd-core/bin/lib/cli-exit.cjs');
  }
  return pkg;
}

function replaceGeneratedTrees(checkout, lock) {
  const staging = fs.mkdtempSync(path.join(path.dirname(ROOT), '.gsd-codex-sync-'));
  const backup = path.join(staging, 'backup');
  const next = path.join(staging, 'next');
  fs.mkdirSync(backup);
  fs.mkdirSync(next);
  try {
    for (const dir of GENERATED_DIRS) fs.cpSync(path.join(checkout, dir), path.join(next, dir), { recursive: true });
    fs.copyFileSync(path.join(checkout, 'LICENSE'), path.join(next, 'UPSTREAM-LICENSE'));
    transformSkills(path.join(next, 'skills'));
    fs.writeFileSync(path.join(next, 'upstream-modes.txt'), `${executablePaths(next).join('\n')}\n`);
    fs.writeFileSync(path.join(next, 'upstream.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);

    const moved = [];
    const installed = [];
    try {
      for (const name of [...GENERATED_DIRS, ...GENERATED_FILES]) {
        const current = path.join(ROOT, name);
        if (fs.existsSync(current)) {
          fs.renameSync(current, path.join(backup, name));
          moved.push(name);
        }
        fs.renameSync(path.join(next, name), current);
        installed.push(name);
      }
    } catch (error) {
      for (const name of installed.reverse()) {
        const current = path.join(ROOT, name);
        if (fs.existsSync(current)) fs.rmSync(current, { recursive: true, force: true });
      }
      for (const name of moved.reverse()) {
        const current = path.join(ROOT, name);
        const previous = path.join(backup, name);
        if (moved.includes(name)) fs.renameSync(previous, current);
      }
      throw error;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function syncPluginVersion(lock) {
  const version = `${lock.version.split('+')[0]}+gsd.${lock.commit.slice(0, 12)}.wrapper.${WRAPPER_VERSION}`;
  for (const relative of ['package.json', '.codex-plugin/plugin.json']) {
    const file = path.join(ROOT, relative);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.version = version;
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function main(args = process.argv.slice(2)) {
  const { repo, ref } = parseArgs(args);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-codex-upstream-'));
  const checkout = path.join(temp, 'checkout');
  try {
    fs.mkdirSync(checkout);
    run('git', ['init', '--quiet'], checkout);
    run('git', ['remote', 'add', 'origin', repo], checkout);
    run('git', ['fetch', '--quiet', '--depth=1', 'origin', ref], checkout);
    run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], checkout);
    const pkg = prepareUpstream(checkout);
    const lock = {
      repo,
      ref,
      commit: output('git', ['rev-parse', 'HEAD'], checkout),
      version: pkg.version,
    };
    replaceGeneratedTrees(checkout, lock);
    syncPluginVersion(lock);
    process.stdout.write(`Synced GSD ${lock.version} (${lock.commit.slice(0, 12)}) from ${repo}#${ref}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`update-upstream: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { injectRuntimeInstructions, parseArgs, syncPluginVersion, transformSkill };
