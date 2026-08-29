'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  throw new Error(message);
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveUatPath(projectPath, filePath) {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) fail('project_path must be an absolute directory');
  if (typeof filePath !== 'string' || !filePath.trim()) fail('file_path is required');
  if (filePath.split(/[\\/]+/).includes('..')) fail('file_path must not contain traversal');

  const project = fs.realpathSync(projectPath);
  if (!fs.statSync(project).isDirectory()) fail('project_path must be a directory');
  const planning = path.join(project, '.planning');
  if (!fs.existsSync(planning) || !fs.statSync(planning).isDirectory()) fail('project has no .planning directory');
  const planningReal = fs.realpathSync(planning);
  if (!inside(project, planningReal)) fail('project .planning directory must not resolve outside the project');
  const candidate = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(project, filePath);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) fail(`UAT file not found: ${filePath}`);
  const resolved = fs.realpathSync(candidate);
  if (!inside(planningReal, resolved)) fail('UAT file must be inside the project .planning directory');
  return { project, resolved };
}

function structuralHeadings(content) {
  const headings = [];
  const lines = content.split('\n');
  let offset = 0;
  let fence = null;
  for (const line of lines) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      const marker = delimiter[1][0];
      if (!fence) fence = { marker, length: delimiter[1].length };
      else if (marker === fence.marker && delimiter[1].length >= fence.length && /^\s*$/.test(delimiter[2])) fence = null;
    } else if (!fence) {
      const match = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
      if (match) headings.push({ level: match[1].length, text: match[2], offset, lineEnd: offset + line.length + 1 });
    }
    offset += line.length + 1;
  }
  return headings;
}

function section(content, title) {
  const headings = structuralHeadings(content);
  const index = headings.findIndex((heading) => heading.level === 2 && heading.text.toLowerCase() === title.toLowerCase());
  if (index === -1) fail(`UAT file is missing a ${title} section`);
  const heading = headings[index];
  const next = headings.slice(index + 1).find((item) => item.level <= 2);
  return { bodyStart: Math.min(heading.lineEnd, content.length), bodyEnd: next?.offset ?? content.length };
}

function stripFencedLines(content, allowIndented = true) {
  const lines = content.split('\n');
  let fence = null;
  return lines.map((line) => {
    const pattern = allowIndented ? /^ {0,3}(`{3,}|~{3,})/ : /^(`{3,}|~{3,})/;
    const delimiter = line.match(pattern);
    if (delimiter) {
      const marker = delimiter[1][0];
      if (!fence) fence = { marker, length: delimiter[1].length };
      else if (marker === fence.marker && delimiter[1].length >= fence.length && /^\s*$/.test(line.slice(delimiter[0].length))) fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

function field(block, name) {
  const clean = stripFencedLines(block);
  const inline = clean.match(new RegExp(`^${name}:\\s*(.*)$`, 'mi'));
  if (!inline) return null;
  const value = inline[1].trim();
  if (value !== '|') return value;
  const rest = clean.slice(inline.index + inline[0].length + 1).split('\n');
  const lines = [];
  for (const line of rest) {
    if (!/^\s+/.test(line)) break;
    lines.push(line.replace(/^ {2}/, ''));
  }
  return lines.join('\n').trim();
}

function resultField(block) {
  const lines = block.split('\n');
  let offset = 0;
  let fence = null;
  let found = null;
  for (const line of lines) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      const marker = delimiter[1][0];
      if (!fence) fence = { marker, length: delimiter[1].length };
      else if (marker === fence.marker && delimiter[1].length >= fence.length && /^\s*$/.test(line.slice(delimiter[0].length))) fence = null;
    } else if (!fence) {
      const match = line.match(/^result:\s*\[?([\w-]+)\]?\s*$/i);
      if (match) {
        if (found) fail('UAT test has multiple result fields');
        found = { result: match[1].toLowerCase(), start: offset, end: offset + line.length };
      }
    }
    offset += line.length + 1;
  }
  return found;
}

function parseTests(content) {
  const tests = section(content, 'Tests');
  const body = content.slice(tests.bodyStart, tests.bodyEnd);
  const headings = structuralHeadings(body).filter((heading) => heading.level === 3 && /^\d+\.(?:\s+|$)/.test(heading.text));
  const records = headings.map((heading, index) => {
    const match = heading.text.match(/^(\d+)\.(?:\s+(.*)|$)/);
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number < 1) fail('UAT test number must be a safe positive integer');
    const start = tests.bodyStart + heading.offset;
    const end = index + 1 < headings.length ? tests.bodyStart + headings[index + 1].offset : tests.bodyEnd;
    const block = content.slice(start, end);
    const result = resultField(block);
    const expected = field(block, 'expected');
    if (!result || !expected) fail(`UAT test ${number} is malformed`);
    return {
      number,
      name: (match[2] || '').trim(),
      expected,
      reason: field(block, 'reason'),
      result: result.result,
      resultStart: start + result.start,
      resultEnd: start + result.end,
    };
  });
  if (records.length === 0) fail('UAT file has no parseable tests');
  if (new Set(records.map(({ number }) => number)).size !== records.length) fail('UAT file has duplicate test numbers');
  return records;
}

function currentTestNumber(content) {
  const current = section(content, 'Current Test');
  const body = stripFencedLines(content.slice(current.bodyStart, current.bodyEnd));
  if (/\[testing complete\]/i.test(body)) return null;
  const match = body.match(/^number:\s*(\d+)\s*$/m);
  if (!match) fail('Current Test section is malformed');
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number < 1) fail('Current Test section is malformed');
  return number;
}

function frontmatterField(content, name) {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) fail(`UAT file is missing frontmatter ${name}`);
  const fieldMatch = match[1].match(new RegExp(`^${name}:\\s*(.*?)\\s*$`, 'm'));
  if (!fieldMatch) fail(`UAT file is missing frontmatter ${name}`);
  return fieldMatch[1];
}

function replaceFrontmatterField(content, name, value) {
  frontmatterField(content, name);
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const body = frontmatter[1].replace(new RegExp(`^${name}:.*$`, 'm'), `${name}: ${value}`);
  return content.slice(0, frontmatter.index) + `---\n${body}\n---\n` + content.slice(frontmatter.index + frontmatter[0].length);
}

function replaceSection(content, title, body) {
  const target = section(content, title);
  return content.slice(0, target.bodyStart) + `\n${body}\n\n` + content.slice(target.bodyEnd).replace(/^\n+/, '');
}

function meaningfulReason(reason) {
  if (reason == null) return false;
  const value = reason.trim();
  if (!value || /^(?:null|~)(?:\s*#.*)?$/i.test(value) || /^#/.test(value)) return false;
  if ((value.startsWith('"') && value.includes('"')) || (value.startsWith("'") && value.includes("'"))) {
    const quoted = value.match(/^("(?:\\.|[^"\\])*"|'(?:''|[^'])*')(?:\s*#.*)?$/);
    if (!quoted) return false;
    try {
      const decoded = quoted[1][0] === '"' ? JSON.parse(quoted[1]) : quoted[1].slice(1, -1).replace(/''/g, "'");
      return decoded.trim() !== '' && !/^(?:null|~)$/i.test(decoded.trim());
    } catch {
      return false;
    }
  }
  return true;
}

function inferSeverity(note) {
  if (/crash|error|exception|fails completely|unusable/i.test(note)) return 'blocker';
  if (/color|font|spacing|alignment|visual|looks off/i.test(note)) return 'cosmetic';
  if (/works but|slow|weird|minor|small issue/i.test(note)) return 'minor';
  return 'major';
}

function renderCurrent(test) {
  if (!test) return '[testing complete]';
  const expected = test.expected.includes('\n')
    ? `expected: |\n${test.expected.split('\n').map((line) => `  ${line}`).join('\n')}`
    : `expected: ${test.expected}`;
  return `number: ${test.number}\nname: ${test.name}\n${expected}\nawaiting: user response`;
}

let writeCounter = 0;
function atomicWrite(filePath, content, lineEnding) {
  const temporary = `${filePath}.tmp-${process.pid}-${++writeCounter}`;
  const mode = fs.statSync(filePath).mode & 0o7777;
  try {
    const bytes = lineEnding === '\r\n' ? content.replace(/\n/g, '\r\n') : content;
    fs.writeFileSync(temporary, bytes, { encoding: 'utf8', flag: 'wx', mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

function recordResolvedUatResult({ project, resolved, testNumber, result, cleanNote }) {
  const originalBytes = fs.readFileSync(resolved, 'utf8');
  const lineEnding = originalBytes.includes('\r\n') ? '\r\n' : '\n';
  const original = originalBytes.replace(/\r\n?/g, '\n');
  const phase = frontmatterField(original, 'phase').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(phase)) fail('UAT frontmatter phase must be a simple identifier');
  frontmatterField(original, 'status');
  frontmatterField(original, 'updated');
  if (currentTestNumber(original) !== testNumber) fail(`UAT test ${testNumber} is not the current pending test`);

  const records = parseTests(original);
  const target = records.find((test) => test.number === testNumber);
  if (!target || target.result !== 'pending') fail(`UAT test ${testNumber} is not pending`);
  section(original, 'Summary');
  const gaps = section(original, 'Gaps');

  let nextGap = 1;
  const gapPrefix = `G-${phase}-`;
  const visibleGaps = stripFencedLines(original.slice(gaps.bodyStart, gaps.bodyEnd));
  for (const entry of visibleGaps.split(/(?=^- truth:\s*)/m)) {
    if (!/^- truth:\s*\S/m.test(entry)) continue;
    const id = entry.match(/^ {2}gap_id:\s*(\S+)\s*$/m)?.[1];
    if (!id?.startsWith(gapPrefix)) continue;
    const number = Number(id.slice(gapPrefix.length));
    if (Number.isSafeInteger(number) && number >= nextGap) nextGap = number + 1;
  }

  const severity = inferSeverity(cleanNote);
  const replacement = result === 'issue'
    ? `result: issue\nreported: ${JSON.stringify(cleanNote)}\nseverity: ${severity}`
    : 'result: pass';
  const suffix = original.slice(target.resultEnd);
  let updated = original.slice(0, target.resultStart) + replacement + (suffix.startsWith('\n') ? '' : '\n') + suffix;

  const updatedRecords = parseTests(updated);
  const counts = { passed: 0, issues: 0, pending: 0, skipped: 0, blocked: 0 };
  for (const test of updatedRecords) {
    if (test.result === 'pass') counts.passed += 1;
    else if (test.result === 'issue') counts.issues += 1;
    else if (test.result === 'pending') counts.pending += 1;
    else if (test.result === 'skipped') counts.skipped += 1;
    else if (test.result === 'blocked') counts.blocked += 1;
  }
  const next = updatedRecords.find((test) => test.result === 'pending');
  const status = counts.pending || counts.blocked || updatedRecords.some((test) => test.result === 'skipped' && !meaningfulReason(test.reason))
    ? 'partial'
    : 'complete';
  updated = replaceSection(updated, 'Current Test', renderCurrent(next));
  updated = replaceSection(updated, 'Summary', [
    `total: ${updatedRecords.length}`,
    `passed: ${counts.passed}`,
    `issues: ${counts.issues}`,
    `pending: ${counts.pending}`,
    `skipped: ${counts.skipped}`,
    `blocked: ${counts.blocked}`,
  ].join('\n'));

  if (result === 'issue') {
    const gap = [
      `- truth: ${JSON.stringify(target.expected)}`,
      `  gap_id: G-${phase}-${nextGap}`,
      '  status: failed',
      `  reason: ${JSON.stringify(`User reported: ${cleanNote}`)}`,
      `  severity: ${severity}`,
      `  test: ${testNumber}`,
      '  root_cause: ""',
      '  artifacts: []',
      '  missing: []',
      '  debug_session: ""',
    ].join('\n');
    const currentGaps = section(updated, 'Gaps');
    const existing = updated.slice(currentGaps.bodyStart, currentGaps.bodyEnd).trim();
    updated = replaceSection(updated, 'Gaps', existing ? `${existing}\n\n${gap}` : gap);
  }
  updated = replaceFrontmatterField(updated, 'status', status);
  updated = replaceFrontmatterField(updated, 'updated', new Date().toISOString());
  atomicWrite(resolved, updated, lineEnding);

  return {
    recorded: true,
    file_path: path.relative(project, resolved).split(path.sep).join('/'),
    test_number: testNumber,
    result,
    ...(result === 'issue' ? { severity } : {}),
    status,
    next_test: next?.number ?? null,
  };
}

function recordUatResult({ projectPath, filePath, testNumber, result, note }) {
  if (!Number.isSafeInteger(testNumber) || testNumber < 1) fail('test_number must be a safe positive integer');
  if (result !== 'pass' && result !== 'issue') fail('result must be pass or issue');
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  if (result === 'issue' && !cleanNote) fail('note is required for issue results');

  const { project, resolved } = resolveUatPath(projectPath, filePath);
  const { withPlanningLock } = require('../gsd-core/bin/lib/planning-workspace.cjs');
  return withPlanningLock(project, () => recordResolvedUatResult({ project, resolved, testNumber, result, cleanNote }));
}

module.exports = { recordUatResult };
