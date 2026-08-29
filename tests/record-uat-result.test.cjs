'use strict';

const { afterEach, beforeEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recordUatResult } = require('../lib/record-uat-result.cjs');

describe('recordUatResult', () => {
  let project;
  let file;

  function document() {
    return `---
status: testing
phase: 01-test-phase
started: 2025-01-01T00:00:00Z
updated: 2025-01-01T00:00:00Z
---

## Current Test

number: 1
name: Sign in
expected: Sign in succeeds.
awaiting: user response

## Tests

### 1. Sign in
expected: Sign in succeeds.
result: pending

### 2. Profile
expected: Profile loads.
result: pending

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
`;
  }

  function reset() {
    fs.writeFileSync(file, document());
  }

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-codex-uat-'));
    file = path.join(project, '.planning', 'phases', '01-test-phase', '01-UAT.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    reset();
  });

  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  test('records pass, updates counts, and advances Current Test atomically', () => {
    fs.chmodSync(file, 0o666);
    const result = recordUatResult({
      projectPath: project,
      filePath: '.planning/phases/01-test-phase/01-UAT.md',
      testNumber: 1,
      result: 'pass',
    });
    assert.deepEqual(result, {
      recorded: true,
      file_path: '.planning/phases/01-test-phase/01-UAT.md',
      test_number: 1,
      result: 'pass',
      status: 'partial',
      next_test: 2,
    });
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /### 1\. Sign in\nexpected: Sign in succeeds\.\nresult: pass/);
    assert.match(content, /## Current Test\n\nnumber: 2\nname: Profile\nexpected: Profile loads\.\nawaiting: user response/);
    assert.match(content, /total: 2\npassed: 1\nissues: 0\npending: 1\nskipped: 0\nblocked: 0/);
    assert.match(content, /^status: partial$/m);
    assert.match(content, /^updated: \d{4}-\d{2}-\d{2}T/m);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o666);

    const after = fs.readFileSync(file);
    assert.throws(() => recordUatResult({ projectPath: project, filePath: file, testNumber: 1, result: 'pass' }));
    assert.deepEqual(fs.readFileSync(file), after);
  });

  test('records one escaped issue and one stable severity-classified gap', () => {
    recordUatResult({ projectPath: project, filePath: file, testNumber: 1, result: 'pass' });
    const result = recordUatResult({
      projectPath: project,
      filePath: file,
      testNumber: 2,
      result: 'issue',
      note: ' Profile "crash" is unusable. ',
    });
    assert.equal(result.severity, 'blocker');
    assert.equal(result.status, 'complete');
    assert.equal(result.next_test, null);
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /reported: "Profile \\"crash\\" is unusable\."/);
    assert.equal((content.match(/^- truth:/gm) || []).length, 1);
    assert.match(content, /- truth: "Profile loads\."\n  gap_id: G-01-test-phase-1/);
    assert.match(content, /reason: "User reported: Profile \\"crash\\" is unusable\."/);
    assert.match(content, /## Current Test\n\n\[testing complete\]/);
    assert.match(content, /^status: complete$/m);
  });

  test('rejects invalid, outside, traversal, stale, and missing-note mutations byte-identically', () => {
    const outside = path.join(project, 'outside.md');
    fs.writeFileSync(outside, document());
    const attempts = [
      { projectPath: project, filePath: '../outside.md', testNumber: 1, result: 'pass' },
      { projectPath: project, filePath: outside, testNumber: 1, result: 'pass' },
      { projectPath: project, filePath: file, testNumber: 0, result: 'pass' },
      { projectPath: project, filePath: file, testNumber: 1, result: 'blocked' },
      { projectPath: project, filePath: file, testNumber: 2, result: 'pass' },
      { projectPath: project, filePath: file, testNumber: 1, result: 'issue', note: '   ' },
    ];
    for (const options of attempts) {
      const before = fs.readFileSync(file);
      assert.throws(() => recordUatResult(options));
      assert.deepEqual(fs.readFileSync(file), before);
    }
  });

  test('rejects duplicate rows and fenced or indented lookalikes', () => {
    const badDocuments = [
      document().replace('### 2. Profile', '### 1. Profile'),
      document().replace('result: pending\n\n### 2.', 'result: pending\nresult: pass\n\n### 2.'),
      document().replace('result: pending\n\n### 2.', '```md\nresult: pending\n```\n\n### 2.'),
      document().replace('### 1. Sign in', '  ### 1. Sign in'),
    ];
    for (const content of badDocuments) {
      fs.writeFileSync(file, content);
      const before = fs.readFileSync(file);
      assert.throws(() => recordUatResult({ projectPath: project, filePath: file, testNumber: 1, result: 'pass' }));
      assert.deepEqual(fs.readFileSync(file), before);
    }
  });

  test('ignores headings inside indented and mismatched fenced examples', () => {
    fs.writeFileSync(file, document().replace('## Tests\n', `## Tests

   \`\`\`\`md
### 1. Fake
expected: Fake
result: pending
   \`\`\`
### 9. Still fake after a short closer
expected: Still fake
result: pending
   \`\`\`\`
`));
    assert.equal(recordUatResult({ projectPath: project, filePath: file, testNumber: 1, result: 'pass' }).next_test, 2);
  });

  test('rejects missing rows and symlink escapes byte-identically', (t) => {
    fs.writeFileSync(file, document().replace('number: 1', 'number: 9'));
    let before = fs.readFileSync(file);
    assert.throws(() => recordUatResult({ projectPath: project, filePath: file, testNumber: 9, result: 'pass' }));
    assert.deepEqual(fs.readFileSync(file), before);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-codex-uat-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const outsideFile = path.join(outside, 'UAT.md');
    fs.writeFileSync(outsideFile, document());
    const link = path.join(path.dirname(file), 'linked-UAT.md');
    fs.symlinkSync(outsideFile, link);
    before = fs.readFileSync(outsideFile);
    assert.throws(() => recordUatResult({ projectPath: project, filePath: link, testNumber: 1, result: 'pass' }));
    assert.deepEqual(fs.readFileSync(outsideFile), before);

    fs.rmSync(path.join(project, '.planning'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(project, '.planning'));
    assert.throws(() => recordUatResult({ projectPath: project, filePath: outsideFile, testNumber: 1, result: 'pass' }));
    assert.deepEqual(fs.readFileSync(outsideFile), before);
  });

  test('uses the shared planning lock around the mutation', () => {
    const workspace = require('../gsd-core/bin/lib/planning-workspace.cjs');
    const original = workspace.withPlanningLock;
    let locked = false;
    workspace.withPlanningLock = (cwd, mutate) => {
      assert.equal(cwd, fs.realpathSync(project));
      locked = true;
      return mutate();
    };
    try {
      recordUatResult({ projectPath: project, filePath: file, testNumber: 1, result: 'pass' });
    } finally {
      workspace.withPlanningLock = original;
    }
    assert.equal(locked, true);
  });

  test('keeps blocked and unexplained skipped sessions partial, but completes explained skips', () => {
    for (const remainder of ['blocked', 'skipped', 'skipped\nreason: ""']) {
      reset();
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('result: pending\n\n## Summary', `result: ${remainder}\n\n## Summary`));
      const result = recordUatResult({ projectPath: project, filePath: file, testNumber: 1, result: 'pass' });
      assert.equal(result.status, 'partial');
      assert.equal(result.next_test, null);
    }
    reset();
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('result: pending\n\n## Summary', 'result: skipped\nreason: Covered by automation.\n\n## Summary'));
    assert.equal(recordUatResult({ projectPath: project, filePath: file, testNumber: 1, result: 'pass' }).status, 'complete');
  });

  test('allocates gap ids from canonical unfenced Gaps entries only', () => {
    fs.writeFileSync(file, document().replace('## Gaps', `## Gaps

- truth: "older"
  gap_id: G-01-test-phase-2
  status: failed

\`\`\`yaml
- truth: "example"
  gap_id: G-01-test-phase-88
\`\`\`

## Notes

gap_id: G-01-test-phase-99`));
    recordUatResult({ projectPath: project, filePath: file, testNumber: 1, result: 'issue', note: 'Something broke.' });
    assert.match(fs.readFileSync(file, 'utf8'), /gap_id: G-01-test-phase-3/);
  });
});
