const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const COMMANDS_DIR = path.join(ROOT, 'commands');
const AGENTS_DIR = path.join(ROOT, 'agents');
const GSD_TOOLS = path.join(ROOT, 'gsd-core', 'bin', 'gsd-tools.cjs');
const { transformSkill } = require(path.join(ROOT, 'tools', 'update-upstream.cjs'));

test('commands tree contains no duplicate legacy commands where native skills exist', () => {
  if (!fs.existsSync(COMMANDS_DIR)) return;
  const findFiles = (dir) => {
    const list = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) list.push(...findFiles(full));
      else if (e.isFile() && e.name.endsWith('.md')) list.push(full);
    }
    return list;
  };
  const commandFiles = findFiles(COMMANDS_DIR);
  for (const cmdFile of commandFiles) {
    const stem = path.basename(cmdFile, '.md');
    const hasNative = fs.existsSync(path.join(SKILLS_DIR, 'gsd-' + stem, 'SKILL.md')) ||
                      fs.existsSync(path.join(SKILLS_DIR, stem, 'SKILL.md'));
    assert.equal(hasNative, false, 'duplicate legacy command found for native skill: ' + cmdFile);
  }
});

test('generated skills corpus is free of path drift and contains runtime adapters', () => {
  const skills = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')));
  assert.ok(skills.length > 50, 'expected at least 50 skills, got ' + skills.length);
  for (const entry of skills) {
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.equal(transformSkill(content), content, entry.name + ' is stale; run npm run sync');
    assert.ok(content.includes('<plugin_runtime>'), entry.name + ' missing <plugin_runtime>');
    const body = content.replace(/<plugin_runtime>[\s\S]*?<\/plugin_runtime>/, '');
    assert.doesNotMatch(body, /(?:\$HOME|~)\/(?:\.claude|\.codex)\/(?:gsd-core|agents)/, entry.name + ' contains unrewritten legacy path');
    assert.ok(!body.includes('_GSD_RUNTIME_ROOT='), entry.name + ' contains raw _GSD_RUNTIME_ROOT');
  }
});

test('runtime smoke: gsd-tools execution and bundled agents validation', () => {
  const output = execFileSync(process.execPath, [GSD_TOOLS, 'validate', 'agents'], {
    encoding: 'utf8',
    env: { ...process.env, GSD_RUNTIME: 'codex', GSD_AGENTS_DIR: AGENTS_DIR },
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.agents_found, true);
  assert.deepEqual(parsed.missing, []);
});

test('manifests are aligned and wrapper version is distinct', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(pkg.version, plugin.version);
  assert.match(pkg.version, /\.wrapper\.[2-9]\d*$/, 'expected wrapper-only version bump (wrapper.2+), got ' + pkg.version);
});
