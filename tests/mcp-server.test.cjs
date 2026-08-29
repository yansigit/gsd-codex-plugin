'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHandler, runServer } = require('../plugin/gsd-mcp-server.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-codex-mcp-'));
}

function upstream() {
  return {
    handleMessage(request) {
      if (request.method === 'tools/list') {
        return { jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'gsd_invoke_command' }] } };
      }
      if (request.method === 'resources/list') {
        return { jsonrpc: '2.0', id: request.id, result: { resources: [{ uri: 'gsd://references/example.md' }] } };
      }
      return { jsonrpc: '2.0', id: request.id, result: { delegated: request.method } };
    },
  };
}

function request(handler, method, params = undefined) {
  return handler({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) });
}

function validPlanning() {
  return {
    schema_version: 1,
    milestone: {},
    active: {},
    progress: {},
    phases: [],
    requirements: [],
    diagnostics: [],
  };
}

function validWorkbench() {
  return { results: [], summary: {} };
}

test('adds Codex tools while retaining the upstream tool surface', () => {
  const response = request(createHandler({ upstream: upstream() }), 'tools/list');
  const tools = response.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    'gsd_invoke_command',
    'gsd_control_center',
    'gsd_uat_workbench',
    'gsd_record_uat_result',
  ]);
  assert.equal(tools[1]._meta.ui.resourceUri, 'ui://gsd/control-center-v1.html');
  assert.equal(tools[2]._meta.ui.resourceUri, 'ui://gsd/uat-workbench-v1.html');
});

test('lists and reads both plugin-owned UI resources with MCP app metadata', () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, 'control-center.html'), '<main>control</main>');
    fs.writeFileSync(path.join(root, 'uat-workbench.html'), '<main>uat</main>');
    const handler = createHandler({ upstream: upstream(), assetRoot: root });
    const listed = request(handler, 'resources/list').result.resources;
    assert.deepEqual(listed.map((resource) => resource.uri), [
      'gsd://references/example.md',
      'ui://gsd/control-center-v1.html',
      'ui://gsd/uat-workbench-v1.html',
    ]);
    for (const resource of listed.slice(1)) {
      assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
      assert.deepEqual(resource._meta, { 'ui.prefersBorder': true });
    }
    const read = request(handler, 'resources/read', { uri: 'ui://gsd/control-center-v1.html' });
    assert.equal(read.result.contents[0].text, '<main>control</main>');
    assert.equal(read.result.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.deepEqual(read.result.contents[0]._meta, { 'ui.prefersBorder': true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('control center dispatches planning inspect in the validated project', () => {
  const project = tempDir();
  const calls = [];
  try {
    const handler = createHandler({
      upstream: upstream(),
      dispatch(input) {
        calls.push(input);
        return { ok: true, stdout: JSON.stringify(validPlanning()) };
      },
    });
    const result = request(handler, 'tools/call', {
      name: 'gsd_control_center',
      arguments: { project_path: project },
    }).result;
    assert.deepEqual(calls, [{ family: 'planning', subcommand: 'inspect', args: [], cwd: fs.realpathSync(project) }]);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.equal(result.structuredContent.project_path, fs.realpathSync(project));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('UAT workbench dispatches audit-uat run and rejects malformed CLI JSON', () => {
  const project = tempDir();
  let stdout = JSON.stringify(validWorkbench());
  try {
    const handler = createHandler({
      upstream: upstream(),
      dispatch() { return { ok: true, stdout }; },
    });
    const good = request(handler, 'tools/call', {
      name: 'gsd_uat_workbench',
      arguments: { project_path: project },
    }).result;
    assert.equal(good.structuredContent.project_path, fs.realpathSync(project));
    stdout = 'not json';
    const bad = request(handler, 'tools/call', {
      name: 'gsd_uat_workbench',
      arguments: { project_path: project },
    }).result;
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /invalid JSON/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('records a UAT result locally and returns the refreshed authoritative workbench', () => {
  const project = tempDir();
  const recordCalls = [];
  try {
    const handler = createHandler({
      upstream: upstream(),
      dispatch(input) {
        assert.equal(input.family, 'audit-uat');
        assert.equal(input.subcommand, 'run');
        return { ok: true, stdout: JSON.stringify(validWorkbench()) };
      },
      recordUatResult(input) {
        recordCalls.push(input);
        return {
          recorded: true,
          file_path: '.planning/phases/01-test/01-UAT.md',
          test_number: 2,
          result: 'issue',
          severity: 'major',
          status: 'partial',
          next_test: 3,
        };
      },
    });
    const result = request(handler, 'tools/call', {
      name: 'gsd_record_uat_result',
      arguments: {
        project_path: project,
        file_path: '.planning/phases/01-test/01-UAT.md',
        test_number: 2,
        result: 'issue',
        note: 'Button is broken',
      },
    }).result;
    assert.deepEqual(recordCalls, [{
      projectPath: fs.realpathSync(project),
      filePath: '.planning/phases/01-test/01-UAT.md',
      testNumber: 2,
      result: 'issue',
      note: 'Button is broken',
    }]);
    assert.deepEqual(result.structuredContent.mutation, {
      file_path: '.planning/phases/01-test/01-UAT.md',
      test_number: 2,
      result: 'issue',
      status: 'partial',
      next_test: 3,
    });
    assert.equal(result.structuredContent.workbench.project_path, fs.realpathSync(project));
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('rejects invalid or stale mutations without refreshing the workbench', () => {
  const project = tempDir();
  let dispatches = 0;
  let records = 0;
  try {
    const handler = createHandler({
      upstream: upstream(),
      dispatch() { dispatches += 1; return { ok: true, stdout: JSON.stringify(validWorkbench()) }; },
      recordUatResult() { records += 1; throw new Error('test is no longer pending'); },
    });
    const missingNote = request(handler, 'tools/call', {
      name: 'gsd_record_uat_result',
      arguments: { project_path: project, file_path: 'x', test_number: 1, result: 'issue' },
    }).result;
    assert.equal(missingNote.isError, true);
    assert.equal(records, 0);
    const stale = request(handler, 'tools/call', {
      name: 'gsd_record_uat_result',
      arguments: { project_path: project, file_path: 'x', test_number: 1, result: 'pass' },
    }).result;
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /no longer pending/);
    assert.equal(records, 1);
    assert.equal(dispatches, 0);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('delegates every non-plugin method to the vendored upstream server', () => {
  const handler = createHandler({ upstream: upstream() });
  assert.deepEqual(request(handler, 'prompts/list').result, { delegated: 'prompts/list' });
  assert.deepEqual(request(handler, 'resources/read', { uri: 'gsd://references/example.md' }).result, { delegated: 'resources/read' });
  assert.deepEqual(request(handler, 'tools/call', { name: 'gsd_read_state' }).result, { delegated: 'tools/call' });
});

test('stdio loop preserves upstream responses and parse errors', async () => {
  const handler = createHandler({ upstream: upstream() });
  const output = [];
  await runServer({
    input: Readable.from(['not json\n', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'prompts/list' })]),
    output: { write(value) { output.push(value); return true; } },
    handler,
  });
  const responses = output.join('').trim().split('\n').map(JSON.parse);
  assert.equal(responses[0].error.code, -32700);
  assert.deepEqual(responses[1].result, { delegated: 'prompts/list' });
});

test('vendored runtime exposes all six tools and an honest empty-project snapshot', () => {
  const project = tempDir();
  try {
    const handler = createHandler();
    assert.deepEqual(request(handler, 'tools/list').result.tools.map((tool) => tool.name), [
      'gsd_invoke_command',
      'gsd_read_state',
      'gsd_write_state',
      'gsd_control_center',
      'gsd_uat_workbench',
      'gsd_record_uat_result',
    ]);
    const snapshot = request(handler, 'tools/call', {
      name: 'gsd_control_center',
      arguments: { project_path: project },
    }).result;
    assert.equal(snapshot.isError, undefined);
    assert.equal(snapshot.structuredContent.progress.accepted_phases.percent, null);
    assert.ok(snapshot.structuredContent.diagnostics.some((item) => item.code === 'planning_root_absent'));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
