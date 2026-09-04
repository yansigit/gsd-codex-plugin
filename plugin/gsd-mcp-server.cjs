#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { fileURLToPath } = require('node:url');

const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const PARSE_ERROR = -32700;
const UI_MIME_TYPE = 'text/html;profile=mcp-app';

const UI_RESOURCES = [
  {
    uri: 'ui://gsd/control-center-v1.html',
    file: 'control-center.html',
    name: 'gsd-control-center',
    title: 'GSD Control Center',
    description: 'GSD planning overview.',
    mimeType: UI_MIME_TYPE,
    _meta: { 'ui.prefersBorder': true },
  },
  {
    uri: 'ui://gsd/uat-workbench-v1.html',
    file: 'uat-workbench.html',
    name: 'gsd-uat-workbench',
    title: 'GSD UAT Workbench',
    description: 'Review and record GSD UAT results.',
    mimeType: UI_MIME_TYPE,
    _meta: { 'ui.prefersBorder': true },
  },
];

const CODEX_TOOLS = [
  {
    name: 'gsd_control_center',
    description: 'Read the selected project planning snapshot for the GSD Control Center.',
    _meta: {
      ui: { resourceUri: UI_RESOURCES[0].uri },
      'ui/resourceUri': UI_RESOURCES[0].uri,
    },
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Absolute project directory.' } },
      required: ['project_path'],
    },
  },
  {
    name: 'gsd_uat_workbench',
    description: 'Read outstanding UAT, verification, and deferred items for the selected project.',
    _meta: {
      ui: { resourceUri: UI_RESOURCES[1].uri },
      'ui/resourceUri': UI_RESOURCES[1].uri,
    },
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Absolute project directory.' } },
      required: ['project_path'],
    },
  },
  {
    name: 'gsd_record_uat_result',
    description: 'Record a pass or issue for one pending UAT test, then refresh the workbench.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Absolute project directory.' },
        file_path: { type: 'string', description: 'UAT file path returned by the workbench.' },
        test_number: { type: 'integer', minimum: 1 },
        result: { type: 'string', enum: ['pass', 'issue'] },
        note: { type: 'string' },
      },
      required: ['project_path', 'file_path', 'test_number', 'result'],
    },
  },
];

const CODEX_TOOL_NAMES = new Set(CODEX_TOOLS.map((tool) => tool.name));
const UI_BY_URI = new Map(UI_RESOURCES.map((resource) => [resource.uri, resource]));

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function okResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function structured(value) {
  return {
    structuredContent: value,
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function parseRootEntries(entries) {
  const result = [];
  if (!entries) return result;
  const list = Array.isArray(entries) ? entries : [entries];
  for (let item of list) {
    if (!item) continue;
    if (typeof item === 'object') {
      item = item.uri || item.path;
    }
    if (typeof item !== 'string') continue;
    item = item.trim();
    if (!item) continue;
    if (item.startsWith('file://')) {
      try {
        item = fileURLToPath(item);
      } catch {
        continue;
      }
    }
    if (path.isAbsolute(item)) {
      result.push(path.resolve(item));
    }
  }
  return result;
}

function getEnvRoots() {
  const val = process.env.GSD_ALLOWED_ROOTS;
  if (typeof val !== 'string' || !val.trim()) return [];
  const entries = [];
  for (const part of val.split(new RegExp(`[${path.delimiter}\n]+`))) {
    if (part.trim()) entries.push(part.trim());
  }
  return parseRootEntries(entries);
}

function checkProjectAuthorization(rawPath, projectReal, roots) {
  if (!roots || roots.length === 0) {
    return { ok: false, error: 'Unauthorized root: no authorized workspace roots configured for mutation.' };
  }
  const candLexical = path.resolve(rawPath);
  const resolvedRoots = roots.map((r) => {
    const lexical = path.resolve(r);
    try {
      return { lexical, real: fs.realpathSync(lexical) };
    } catch {
      return { lexical, real: lexical };
    }
  });

  const isLexicalAuthorized = resolvedRoots.some((r) => inside(r.lexical, candLexical) || inside(r.real, candLexical));
  const isRealAuthorized = resolvedRoots.some((r) => inside(r.real, projectReal));

  if (isLexicalAuthorized && isRealAuthorized) {
    return { ok: true, projectPath: projectReal };
  }
  if (isLexicalAuthorized && !isRealAuthorized) {
    return { ok: false, error: `Symlink escape: project_path "${rawPath}" resolves outside authorized workspace roots.` };
  }
  return { ok: false, error: `Unauthorized root: project_path "${rawPath}" is not within an authorized workspace root.` };
}

function existingProject(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
  try {
    return fs.statSync(value).isDirectory() ? fs.realpathSync(value) : null;
  } catch {
    return null;
  }
}

function dispatchJson(dispatch, family, subcommand, cwd) {
  const response = dispatch({ family, subcommand, args: [], cwd });
  if (!response || !response.ok) {
    return { error: response?.stderr || response?.stdout || `dispatch failed (exit ${response?.code ?? 'unknown'})` };
  }
  try {
    return { value: JSON.parse(response.stdout) };
  } catch {
    return { error: 'GSD command returned invalid JSON.' };
  }
}

function isPlanningSnapshot(value) {
  const record = asRecord(value);
  return record !== null
    && record.schema_version === 1
    && asRecord(record.milestone) !== null
    && asRecord(record.active) !== null
    && asRecord(record.progress) !== null
    && Array.isArray(record.phases)
    && Array.isArray(record.requirements)
    && Array.isArray(record.diagnostics);
}

function isWorkbench(value) {
  const record = asRecord(value);
  return record !== null && Array.isArray(record.results) && asRecord(record.summary) !== null;
}

function publicMutation(value, expected) {
  const mutation = asRecord(value);
  if (!mutation
    || mutation.recorded !== true
    || typeof mutation.file_path !== 'string'
    || mutation.test_number !== expected.testNumber
    || mutation.result !== expected.result
    || (mutation.status !== 'partial' && mutation.status !== 'complete')
    || !(mutation.next_test === null || (Number.isInteger(mutation.next_test) && mutation.next_test >= 1))) {
    return null;
  }
  return {
    file_path: mutation.file_path,
    test_number: mutation.test_number,
    result: mutation.result,
    status: mutation.status,
    next_test: mutation.next_test,
  };
}

function createHandler(options = {}) {
  const assetRoot = options.assetRoot || path.join(__dirname, '..', 'assets', 'mcp-apps');
  let upstream = options.upstream;
  let dispatch = options.dispatch;
  let recordUatResult = options.recordUatResult;
  const configuredRoots = new Set(
    parseRootEntries(options.allowedRoots || options.roots),
  );
  let clientRoots = new Set();
  const pendingRootsRequests = new Set();
  let rootsRequestId = 1;

  function sendRootsList(ctx) {
    const reqId = `gsd-roots-${rootsRequestId++}`;
    pendingRootsRequests.add(reqId);
    const rootsReq = { jsonrpc: '2.0', id: reqId, method: 'roots/list', params: {} };
    const emit = options.emit || ctx?.emit;
    if (typeof emit === 'function') {
      emit(rootsReq);
      return null;
    }
    return rootsReq;
  }

  function addClientRoots(params) {
    if (!params || typeof params !== 'object') return;
    const candidates = [
      params.rootUri,
      params.roots,
      params.workspaceFolders,
      params.workspaceRoot,
      params.workspaceRoots,
    ];
    for (const c of candidates) {
      for (const r of parseRootEntries(c)) {
        clientRoots.add(r);
      }
    }
  }

  function getAllowedRoots(ctx) {
    const combined = new Set([...configuredRoots, ...clientRoots]);
    for (const r of getEnvRoots()) combined.add(r);
    if (ctx && typeof ctx === 'object') {
      for (const r of parseRootEntries(ctx.allowedRoots || ctx.roots)) {
        combined.add(r);
      }
    }
    return Array.from(combined);
  }

  function getUpstream() {
    upstream ||= require('../gsd-core/bin/lib/mcp-server.cjs');
    return upstream;
  }

  function getDispatch() {
    dispatch ||= require('../gsd-core/bin/lib/shell-command-projection.cjs').dispatchGsdCommand;
    return dispatch;
  }

  function getRecorder() {
    recordUatResult ||= require('../lib/record-uat-result.cjs').recordUatResult;
    return recordUatResult;
  }

  function callCodexTool(name, args, ctx) {
    const input = asRecord(args) || {};
    const projectPath = existingProject(input.project_path);
    if (!projectPath) return toolError(`${name} requires an existing absolute "project_path" directory.`);

    if (name === 'gsd_control_center') {
      const read = dispatchJson(getDispatch(), 'planning', 'inspect', projectPath);
      if (read.error || !isPlanningSnapshot(read.value)) {
        return toolError(read.error || 'planning inspect returned an invalid schema-v1 snapshot.');
      }
      return structured({ ...read.value, project_path: projectPath });
    }

    if (name === 'gsd_uat_workbench') {
      const read = dispatchJson(getDispatch(), 'audit-uat', 'run', projectPath);
      if (read.error || !isWorkbench(read.value)) {
        return toolError(read.error || 'audit-uat returned an invalid workbench.');
      }
      return structured({ ...read.value, project_path: projectPath });
    }

    const allowedRoots = getAllowedRoots(ctx);
    const auth = checkProjectAuthorization(input.project_path, projectPath, allowedRoots);
    if (!auth.ok) {
      return toolError(auth.error);
    }

    const filePath = typeof input.file_path === 'string' ? input.file_path : null;
    const testNumber = input.test_number;
    const result = input.result;
    const note = input.note;
    if (!filePath
      || !Number.isInteger(testNumber)
      || testNumber < 1
      || (result !== 'pass' && result !== 'issue')
      || (note !== undefined && typeof note !== 'string')) {
      return toolError('gsd_record_uat_result requires string "file_path", integer "test_number", result "pass" or "issue", and optional string "note".');
    }
    if (result === 'issue' && (!note || !note.trim())) {
      return toolError('gsd_record_uat_result requires a nonblank "note" for issue results.');
    }

    let recorded;
    try {
      recorded = getRecorder()({ projectPath, filePath, testNumber, result, note });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
    const mutation = publicMutation(recorded, { testNumber, result });
    if (!mutation) return toolError('UAT result recorder returned an invalid result.');

    const refresh = dispatchJson(getDispatch(), 'audit-uat', 'run', projectPath);
    if (refresh.error || !isWorkbench(refresh.value)) {
      return structured({
        mutation,
        workbench: null,
        refresh_error: refresh.error || 'audit-uat returned an invalid workbench.',
      });
    }
    return structured({
      mutation,
      workbench: { ...refresh.value, project_path: projectPath },
    });
  }

  return function handleMessage(request, ctx = {}) {
    const method = request && typeof request === 'object' ? request.method : undefined;
    const id = request && typeof request === 'object' ? request.id : null;
    const isNotification = id === undefined || id === null;
    const params = asRecord(request?.params) || {};

    if (id !== null && pendingRootsRequests.has(id)) {
      pendingRootsRequests.delete(id);
      if (request.result && typeof request.result === 'object') {
        clientRoots = new Set(parseRootEntries(request.result.roots));
      }
      return null;
    }

    if (method === 'initialize') {
      addClientRoots(params);
      return getUpstream().handleMessage(request, ctx);
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      return sendRootsList(ctx);
    }

    if (method === 'notifications/roots/list_changed' || method === 'roots/list_changed') {
      clientRoots = new Set();
      return sendRootsList(ctx);
    }

    if (method === 'tools/list') {
      const response = getUpstream().handleMessage(request, ctx);
      const tools = response?.result?.tools;
      if (!Array.isArray(tools)) return response;
      response.result.tools = tools.filter((tool) => !CODEX_TOOL_NAMES.has(tool?.name)).concat(CODEX_TOOLS);
      return response;
    }

    if (method === 'tools/call' && CODEX_TOOL_NAMES.has(params.name)) {
      if (isNotification) return null;
      return okResponse(id, callCodexTool(params.name, params.arguments, ctx));
    }

    if (method === 'resources/list') {
      const response = getUpstream().handleMessage(request, ctx);
      const resources = response?.result?.resources;
      if (!Array.isArray(resources) || params.cursor !== undefined) return response;
      const uiUris = new Set(UI_RESOURCES.map((resource) => resource.uri));
      response.result.resources = resources.filter((resource) => !uiUris.has(resource?.uri)).concat(
        UI_RESOURCES.map(({ file: _file, ...resource }) => resource),
      );
      return response;
    }

    if (method === 'resources/read' && UI_BY_URI.has(params.uri)) {
      if (id === undefined || id === null) return null;
      const resource = UI_BY_URI.get(params.uri);
      try {
        const text = fs.readFileSync(path.join(assetRoot, resource.file), 'utf8');
        return okResponse(id, {
          contents: [{
            uri: resource.uri,
            mimeType: resource.mimeType,
            text,
            _meta: resource._meta,
          }],
        });
      } catch (error) {
        return errorResponse(id, INTERNAL_ERROR, error instanceof Error ? error.message : 'Unable to read UI resource.');
      }
    }

    return getUpstream().handleMessage(request, ctx);
  };
}

let defaultHandler;
function handleMessage(request, ctx) {
  defaultHandler ||= createHandler();
  return defaultHandler(request, ctx);
}

async function runServer({ input = process.stdin, output = process.stdout, handler = handleMessage, ctx = {} } = {}) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const emit = (msg) => {
    if (msg) output.write(`${JSON.stringify(msg)}\n`);
  };
  const serverCtx = { emit, ...ctx };
  const processLine = (line) => {
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(errorResponse(null, PARSE_ERROR, 'Parse error.'))}\n`);
      return;
    }
    try {
      const response = handler(request, serverCtx);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      output.write(`${JSON.stringify(errorResponse(null, INTERNAL_ERROR, error instanceof Error ? error.message : 'Internal error.'))}\n`);
    }
  };

  for await (const chunk of input) {
    buffer += typeof chunk === 'string' ? decoder.end() + chunk : decoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      processLine(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.end();
  processLine(buffer.replace(/\r$/, ''));
}

module.exports = { CODEX_TOOLS, UI_RESOURCES, createHandler, handleMessage, runServer };

if (require.main === module) {
  runServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
