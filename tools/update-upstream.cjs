#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pruneLegacyCommands } = require('./prune-legacy-commands.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPO = 'https://github.com/open-gsd/gsd-core.git';
const DEFAULT_REF = 'next';
const PLUGIN_ROOT = '{{GSD_PLUGIN_ROOT}}';
const WRAPPER_VERSION = 2;
const GENERATED_DIRS = ['gsd-core', 'agents', 'skills', 'bin', 'commands', 'hooks', 'scripts'];
const GENERATED_FILES = ['UPSTREAM-LICENSE', 'upstream-modes.txt', 'upstream.lock.json'];

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', timeout: 10 * 60 * 1000 });
}

function output(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
}

function parseArgs(args) {
  const options = { repo: DEFAULT_REPO, ref: DEFAULT_REF, regenerate: false };
  for (let i = 0; i < args.length; i += 1) {
    const name = args[i];
    if (name === '--regenerate') {
      options.regenerate = true;
      continue;
    }
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
  const end = content.startsWith('---\n') ? content.indexOf('\n---', 4) : -1;
  if (end < 0) return content;
  const insertAt = end + 4;
  const instructions = `<plugin_runtime>\n- Resolve \`${PLUGIN_ROOT}\` from this skill's absolute \`SKILL.md\` path by ascending from \`<plugin>/skills/<skill>/SKILL.md\` to \`<plugin>\`. Verify \`.codex-plugin/plugin.json\` exists there.\n- Substitute that absolute path for every literal \`${PLUGIN_ROOT}\`; it is a skill placeholder, not an environment variable.\n- Apply this recursively to loaded files: legacy \`~/.claude/gsd-core\` and \`~/.codex/gsd-core\` paths resolve to \`${PLUGIN_ROOT}/gsd-core\`, while legacy \`~/.claude/agents\` and \`~/.codex/agents\` paths resolve to \`${PLUGIN_ROOT}/agents\`.\n- Run GSD commands as \`GSD_AGENTS_DIR="${PLUGIN_ROOT}/agents" node "${PLUGIN_ROOT}/gsd-core/bin/gsd-tools.cjs"\`. Prefix every direct or workflow-copied \`gsd-tools\` invocation with that same \`GSD_AGENTS_DIR\` value. Never use a project copy, PATH, or a global installation.\n- Plugin-bundled \`agents/*.md\` files are the agent definitions for this runtime. Translate each \`Agent(subagent_type="gsd-...", prompt=...)\` call to the host's general delegation tool (for example \`spawn_agent\`), preserving the prompt. Track every returned agent id. Launch no more than the host's remaining child capacity at once (use three when unknown), wait for those ids with the host's agent wait primitive, and use each agent's returned final message as its result before starting the next batch. Never expect or read \`async_launched.outputFile\`.\n- Map \`AskUserQuestion\` to the host's interactive questioning tool when available; otherwise show a numbered plain-text choice and wait for the user's reply. Map abstract tools (\`Read\`, \`Write\`, \`Edit\`, \`Bash\`, \`Grep\`, \`Glob\`) to host equivalents.\n- Generic delegated agents share the current working directory. Before such dispatches, record \`none\` with \`gsd_run query dispatch-isolation --raw --force-isolation none\` and omit all worktree/isolation arguments. Use an isolation argument only when the actual delegation API explicitly supports it. Never run parallel agents that may edit overlapping files in a shared directory.\n- Plugin manifests do not activate the vendored GSD hooks. Enforce the workflow's protected-branch, write-boundary, base-check, and prompt-injection checks directly; never claim a hook ran.\n- A matching plugin-bundled agent file makes that role available even if the global Codex agents directory is empty. Do not warn, run a global installer, skip the agent, or choose an inline/sequential fallback because global agents are absent. Fall back only when the host has no sub-agent delegation tool or the bundled agent file is absent. Include the resolved absolute plugin root and these adapter rules in the child prompt, and require the child to read \`${PLUGIN_ROOT}/agents/<subagent_type>.md\` before starting. The child must resolve that file's legacy paths through this plugin and translate abstract tool names to host equivalents.\n- If the workflow's requested model is unavailable on the host, omit the model override and inherit the current model.\n- These plugin adapter rules override contrary named-agent installation, output-file, isolation, hook, and fallback instructions in recursively loaded upstream workflow files.\n</plugin_runtime>`;
  if (content.includes('<plugin_runtime>')) {
    return content.replace(/<plugin_runtime>[\s\S]*?<\/plugin_runtime>/, instructions);
  }
  return content.slice(0, insertAt) + `\n\n${instructions}` + content.slice(insertAt);
}

function transformRawLaunchers(content) {
  return content
    .replace(/gsd_run\(\)\s*\{\s*(?:GSD_AGENTS_DIR="[^"]+"\s+)?node\s+"\$GSD_TOOLS"\s+"\$@";\s*\}/g,
      `gsd_run() { GSD_AGENTS_DIR="${PLUGIN_ROOT}/agents" node "$GSD_TOOLS" "$@"; }`)
    .replace(/gsd_run\(\)\s*\{\s*(?:GSD_AGENTS_DIR="[^"]+"\s+)?"\$GSD_TOOLS"\s+"\$@";\s*\}/g,
      `gsd_run() { GSD_AGENTS_DIR="${PLUGIN_ROOT}/agents" "$GSD_TOOLS" "$@"; }`);
}

function transformMarkdown(content, isSkill = false) {
  let transformed = content
    .replace(/(?:\$HOME|~)\/\.(?:claude|codex)\/gsd-core/g, `${PLUGIN_ROOT}/gsd-core`)
    .replace(/(?:\$HOME|~)\/\.(?:claude|codex)\/agents/g, `${PLUGIN_ROOT}/agents`);

  transformed = transformed.split('\n').map((line) => {
    if (isSkill && (line.includes('_GSD_RUNTIME_ROOT=') || line.includes(`GSD_TOOLS="${PLUGIN_ROOT}/gsd-core/bin/gsd-tools.cjs"`)) && line.includes('gsd_run()')) {
      return `GSD_TOOLS="${PLUGIN_ROOT}/gsd-core/bin/gsd-tools.cjs"; gsd_run() { GSD_AGENTS_DIR="${PLUGIN_ROOT}/agents" node "$GSD_TOOLS" "$@"; }`;
    }
    if (line.includes('Verify `gsd-tools` is on PATH via `command -v gsd-tools`')) {
      return `  1. Verify \`${PLUGIN_ROOT}/gsd-core/bin/gsd-tools.cjs\` exists; if absent, report a broken GSD Core plugin installation and stop.`;
    }
    return line;
  }).join('\n')
    .replace(/Run `npm i -g @opengsd\/gsd-core` to reinstall GSD\./g, 'Reinstall the GSD Core plugin.')
    .replace(/Install GSD via 'npm i -g @opengsd\/gsd-core'/g, 'Reinstall the GSD Core plugin');

  transformed = transformRawLaunchers(transformed);
  return isSkill ? injectRuntimeInstructions(transformed) : transformed;
}

function transformSkill(content) {
  return transformMarkdown(content, true);
}

function transformWorkflow(content) {
  return transformMarkdown(content, false);
}

function transformAgent(content) {
  return transformMarkdown(content, false);
}

function transformTree(dir, transformer) {
  if (!fs.existsSync(dir)) return;
  const pending = [dir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.sh'))) {
        const original = fs.readFileSync(file, 'utf8');
        const transformed = transformer(original);
        if (transformed !== original) {
          fs.writeFileSync(file, transformed);
        }
      }
    }
  }
}

function transformBundledFiles(root) {
  transformTree(path.join(root, 'skills'), transformSkill);
  transformTree(path.join(root, 'gsd-core', 'workflows'), transformWorkflow);
  transformTree(path.join(root, 'agents'), transformAgent);
  transformTree(path.join(root, 'commands'), transformWorkflow);
}

function transformSkills(skillsDir) {
  transformTree(skillsDir, transformSkill);
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
  // Keep staging on the repository filesystem so renames remain atomic when
  // the sandbox grants write access only to the workspace.
  const staging = fs.mkdtempSync(path.join(ROOT, '.sync-'));
  const backup = path.join(staging, 'backup');
  const next = path.join(staging, 'next');
  fs.mkdirSync(backup);
  fs.mkdirSync(next);
  try {
    for (const dir of GENERATED_DIRS) fs.cpSync(path.join(checkout, dir), path.join(next, dir), { recursive: true });
    fs.copyFileSync(path.join(checkout, 'LICENSE'), path.join(next, 'UPSTREAM-LICENSE'));
    transformBundledFiles(next);
    pruneLegacyCommands(next);
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
  const { repo, ref, regenerate } = parseArgs(args);
  if (regenerate) {
    transformBundledFiles(ROOT);
    pruneLegacyCommands(ROOT);
    process.stdout.write('Regenerated bundled skills, workflows, and agents\n');
    return;
  }
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

module.exports = { injectRuntimeInstructions, parseArgs, syncPluginVersion, transformSkill, transformWorkflow, transformAgent, transformMarkdown, transformBundledFiles };
