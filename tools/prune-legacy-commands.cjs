#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function pruneLegacyCommands(root = ROOT) {
  const skillsDir = path.join(root, 'skills');
  const commandsDir = path.join(root, 'commands');
  if (!fs.existsSync(commandsDir) || !fs.existsSync(skillsDir)) return 0;
  let pruned = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        if (fs.readdirSync(full).length === 0) {
          fs.rmdirSync(full);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stem = path.basename(entry.name, '.md');
        const hasNativeSkill = fs.existsSync(path.join(skillsDir, `gsd-${stem}`, 'SKILL.md')) ||
                               fs.existsSync(path.join(skillsDir, stem, 'SKILL.md'));
        if (hasNativeSkill) {
          fs.unlinkSync(full);
          pruned++;
        }
      }
    }
  };
  walk(commandsDir);
  return pruned;
}

if (require.main === module) {
  const count = pruneLegacyCommands();
  if (count > 0) {
    process.stdout.write(`Pruned ${count} legacy command(s) superseded by native skills\n`);
  }
}

module.exports = { pruneLegacyCommands };
