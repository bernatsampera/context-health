// The dashboard server. It listens on 127.0.0.1 only. A request with another Host is refused (DNS rebinding),
// and each API request needs the token of the page, so another web site cannot start a run that costs money.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { moveOldFolders, projectKey, readJson } from '../data-folder.mjs';
import { buildFixes, selectFindings } from '../fixes.mjs';
import { EXPLORER_MARKER, render } from '../render.mjs';
import { GIT_REASONS, discardFix, fixConflicts, readyFix } from '../fix-worktree.mjs';
import { listProjects, listSuggestions, newProject, readProject, refuse, saveSettings } from './projects.mjs';
import { Runs } from './runs.mjs';
import {
  addQuestion, addQuestions, mapState, readSnapshot, readVersionReportKey, recordResult, removeQuestion, updateQuestion
} from './map-versions.mjs';
import { runBenchmark } from './map-benchmark.mjs';
import { benchmarkIntents, generateBenchmarkQuestions } from './map-questions.mjs';
import { savedMapPage } from './saved-map-page.mjs';

const PAGE = new URL('./page/', import.meta.url);
const ASSETS = { '/app.js': 'text/javascript', '/app.css': 'text/css', '/workspace.css': 'text/css', '/map-versions.js': 'text/javascript' };
const DEFAULT_PORT = 4747;
// In the dashboard, the report has no header and no terminal commands: the bar above it has the buttons.
const EMBED = '<style id="embed">#copy-md-btn, .wrap > header, .fixcmd, .cmdbox, .standalone-only { display: none !important; } ' +
  '.dashboard-only { display: inline-flex !important; } html { padding-top: 0 !important; } body { background: #fff; } .wrap { padding-top: 28px; }</style>';
const EXPLORER = '<style id="explorer-embed">.wrap > :not(.grid), .grid .promptbox { display: none !important; } .wrap { padding:0!important;max-width:none; } body { background:#f6f7f3; } body:not(.full) .grid .mapbox { max-height:510px; } .grid #list { max-height:510px; } @media(max-width:760px) { body:not(.full) .grid .mapbox {max-height:320px;} .grid #list {max-height:400px;} }</style>';

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); Object.assign(this, { status, extra }); }
}

// The folder dialog of the system. Returns a path, or null on a cancel.
function pick() {
  const custom = process.env.CONTEXT_HEALTH_PICKER_BIN;
  const [bin, args] = custom ? [custom, []]
    : process.platform === 'darwin' ? ['osascript', ['-e', 'activate', '-e', 'POSIX path of (choose folder with prompt "Choose a project folder")']]
      : ['zenity', ['--file-selection', '--directory']];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', () => reject(new HttpError(500, `The folder dialog needs ${bin}.`)));
    child.on('close', code => {
      const value = out.trim();
      resolve(code === 0 && value ? (value.length > 1 ? value.replace(/\/$/, '') : value) : null);
    });
  });
}

async function readBody(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 1e6) throw new HttpError(413, 'The request is too large.');
  }
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object') return value;
  } catch { /* below */ }
  throw new HttpError(400, 'The request is not JSON.');
}

export async function startUi({ dataRoot, binPath, home, claudeSettingsHome, customHome, port, open }) {
  moveOldFolders(dataRoot);
  const token = randomBytes(24).toString('hex');
  const listeners = new Set();
  // Public events are invalidations. Project names, questions, errors and
  // other details are available only through the authenticated JSON routes.
  const notify = () => { for (const response of listeners) response.write('data: {"type":"activity"}\n\n'); };
  const latest = new Map();
  const versionNames = new Map();
  const workers = new Set();
  const runs = new Runs({ binPath, dataRoot, onChange(key, run) {
    latest.set(key, { id: run.id, kind: run.kind, status: run.status,
      stage: run.finishedAt ? 'finished' : run.activeCalls ? 'model' : 'processing',
      startedAt: run.startedAt, finishedAt: run.finishedAt, model: run.model, activeCalls: run.activeCalls,
      done: run.completedCalls, total: null, unit: ['analyse','fix'].includes(run.kind) ? 'calls' : null,
      canStop: run.status === 'running', error: run.error });
    notify();
  } });
  const benchmarks = new Map();
  const intentCache = new Map();
  let recentReport;
  const savedReports = new Map();
  const renderingReports = new Map();
  let picking = false;
  let hosts = new Set();

  const withRun = item => ({ ...item, run: runs.get(item.key), activity: latest.get(item.key) ?? null });
  const project = key => {
    const item = /^[^/\\]+$/.test(key) && !key.startsWith('.') ? readProject({ dataRoot, key, claudeSettingsHome }) : null;
    if (!item) throw new HttpError(404, 'There is no such project.');
    return item;
  };
  const free = key => {
    if (['running', 'stopping'].includes(latest.get(key)?.status)) throw new HttpError(409, 'A run is in progress for this project. Wait for it to finish.');
  };
  const bad = task => { try { return task(); } catch (error) { throw error instanceof HttpError ? error : new HttpError(400, error.message); } };
  const storage = item => ({ dir: path.join(dataRoot, item.key), root: item.root });
  function begin(item, kind, details) {
    free(item.key);
    const job = { id: randomUUID(), kind, status: 'running', stage: 'preparing', startedAt: new Date().toISOString(),
      finishedAt: null, model: null, activeCalls: 0, done: 0, total: null, unit: null, canStop: false, error: null, ...details };
    latest.set(item.key, job);
    notify();
    return job;
  }
  function change(job, fields) {
    if (!job.finishedAt) { Object.assign(job, fields); notify(); }
  }
  function finish(job, status, error = null) {
    change(job, { status, stage: 'finished', canStop: false, activeCalls: 0, error, finishedAt: new Date().toISOString() });
  }
  function modelActivity(job, active) {
    change(job, { stage: active ? 'model' : 'processing', activeCalls: active ? 1 : 0,
      done: job.done + (!active && job.unit === 'calls' ? 1 : 0) });
  }
  async function mapWorker(kind, options, onReady) {
    const operation = new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./map-worker.mjs', import.meta.url), { workerData: { kind, options } });
      if (onReady) worker.once('online', onReady);
      worker.once('message', message => message.error
        ? reject(new HttpError(message.status || (kind === 'version-report' ? 500 : 400), message.error))
        : resolve(message.value));
      worker.once('error', reject);
      worker.once('exit', () => reject(new Error('The local map operation ended before returning a result.')));
    });
    workers.add(operation);
    try { return await operation; }
    finally { workers.delete(operation); }
  }
  async function localMapJob(item, kind, options) {
    const existingId = typeof options.versionId === 'string' && options.versionId.length <= 100 ? options.versionId : null;
    const name = typeof options.name === 'string' ? options.name.trim().slice(0, 80) : null;
    const job = begin(item, kind, { versionId: kind === 'child' ? null : existingId,
      versionName: name || versionNames.get(item.key)?.get(existingId) || null });
    try {
      const value = await mapWorker(kind, options, () => change(job, { stage: 'processing' }));
      if (kind === 'child' || kind === 'refactor-save') job.versionId = value.createdVersionId;
      if (value.refactor && (kind === 'refactor-start' || kind === 'refactor-review')) {
        job.versionId = value.refactor.versionId;
        job.versionName = value.refactor.versionName;
      }
      if (kind === 'capture') job.versionId = value.versions.find(version => version.name === name)?.id ?? null;
      finish(job, 'done');
      return value;
    } catch (error) {
      finish(job, 'failed', error.message);
      throw error;
    }
  }

  async function savedReport(item, versionId, requestedRevision) {
    const options = { ...storage(item), versionId };
    const saved = readVersionReportKey(options);
    if (!saved) throw new HttpError(404, 'This map version could not be found.');
    if (requestedRevision && requestedRevision !== saved.revision)
      throw new HttpError(409, 'This version was updated. Open it again to see the new report.');
    const cacheId = key => JSON.stringify([item.key, versionId, key]);
    if (saved.key && savedReports.has(cacheId(saved.key))) return savedReports.get(cacheId(saved.key));
    const requestKey = cacheId(saved.key || saved.revision);
    if (renderingReports.has(requestKey)) return renderingReports.get(requestKey);
    // The explorer and full report share the same calculations. Viewing either
    // one is independent of benchmark runs, including runs in another tab.
    const operation = mapWorker('version-report', { ...options, revision: saved.revision }).then(({ html, cacheKey }) => {
      if (cacheKey) {
        savedReports.set(cacheId(cacheKey), html);
        if (savedReports.size > 2) savedReports.delete(savedReports.keys().next().value);
      }
      return html;
    });
    renderingReports.set(requestKey, operation);
    try { return await operation; }
    finally { renderingReports.delete(requestKey); }
  }
  // Keep only intent labels and their document paths in memory. A report can be several MB.
  function intentsFor(item) {
    const file = path.join(dataRoot, item.key, 'report.json');
    const stat = statSync(file, { throwIfNoEntry: false, bigint: true });
    if (!stat) return [];
    const stamp = [stat.ino, stat.size, stat.ctimeNs].join(':');
    const previous = intentCache.get(item.key);
    if (previous?.stamp === stamp) return previous.intents;
    const report = readJson(file, null);
    if (!report) return [];
    const intents = benchmarkIntents(report);
    intentCache.set(item.key, { stamp, intents });
    return intents;
  }
  function versionState(item, saved = mapState(storage(item))) {
    versionNames.set(item.key, new Map(saved.versions.map(version => [version.id, version.name])));
    return { ...saved, intents: intentsFor(item).map(({ id, label }) => ({ id, label })),
      running: benchmarks.get(item.key)?.pair ?? null, activity: latest.get(item.key) ?? null };
  }
  function chosenIntent(item, id) {
    if (id == null || id === '') return { intentId: null, intentLabel: null };
    const found = intentsFor(item).find(intent => intent.id === id);
    if (!found) throw new HttpError(400, 'Choose an intent from the current report.');
    return { intentId: found.id, intentLabel: found.label };
  }

  // ---------- the API ----------

  const api = {
    'GET /activity': () => ({ activities: Object.fromEntries(latest) }),
    'GET /projects/:key': item => withRun(item),
    'GET /projects/:key/map-versions': item => versionState(item),
    'POST /projects/:key/map-versions': async (item, body) =>
      versionState(item, await localMapJob(item, 'capture', { ...storage(item), name: body.name })),
    'PUT /projects/:key/map-versions': async (item, body) =>
      versionState(item, await localMapJob(item, 'update', { ...storage(item), versionId: body.versionId })),
    'POST /projects/:key/map-investigate': (item, body) =>
      localMapJob(item, 'investigate', { ...storage(item), versionId: body.versionId, includeProposals: body.includeProposals === true }),
    'POST /projects/:key/map-child': async (item, body) => {
      const { versionId, revision, name, proposalIds } = body;
      return versionState(item, await localMapJob(item, 'child', { ...storage(item), versionId, revision, name, proposalIds }));
    },
    'POST /projects/:key/map-refactor/start': (item, body) => {
      const { versionId, revision, acceptRevision } = body;
      return localMapJob(item, 'refactor-start', { ...storage(item), versionId, revision, acceptRevision });
    },
    'POST /projects/:key/map-refactor/review': (item, body) =>
      localMapJob(item, 'refactor-review', { ...storage(item), refactorId: body.refactorId }),
    'POST /projects/:key/map-refactor/save': async (item, body) => {
      const { refactorId, workingRevision, name } = body;
      return versionState(item, await localMapJob(item, 'refactor-save', { ...storage(item), refactorId, workingRevision, name }));
    },
    'POST /projects/:key/map-refactor/cancel': async (item, body) =>
      versionState(item, await localMapJob(item, 'refactor-cancel', { ...storage(item), refactorId: body.refactorId })),
    'POST /projects/:key/map-questions': (item, body) => {
      free(item.key);
      return versionState(item, bad(() => addQuestion({ ...storage(item), question: body.question, expected: body.expected, ...chosenIntent(item, body.intentId) })));
    },
    'PUT /projects/:key/map-questions': (item, body) => {
      free(item.key);
      const options = storage(item);
      const { questionId, question, expected, intentId } = body;
      let intent = {};
      if (intentId !== undefined) {
        const old = mapState(options).questions.find(q => q.id === questionId);
        if (intentId !== old?.intentId) intent = chosenIntent(item, intentId);
      }
      return versionState(item, bad(() => updateQuestion({ ...options, questionId, question, expected, ...intent })));
    },
    'DELETE /projects/:key/map-questions': (item, body) => {
      free(item.key);
      return versionState(item, bad(() => removeQuestion({ ...storage(item), questionId: body.questionId })));
    },
    'POST /projects/:key/map-questions/generate': async (item, body) => {
      free(item.key);
      const { versionId, intentIds } = body;
      if (!Array.isArray(intentIds) || !intentIds.length) throw new HttpError(400, 'Choose at least one intent.');
      const selected = new Set(intentIds);
      const intents = intentsFor(item).filter(intent => selected.has(intent.id));
      if (intents.length !== selected.size) throw new HttpError(400, 'An intent has changed. Choose intents from the current report.');
      const options = storage(item);
      const snapshot = bad(() => readSnapshot({ ...options, versionId }));
      const savedMaps = mapState(options);
      const existingQuestions = savedMaps.questions;
      const controller = new AbortController();
      const job = begin(item, 'generate', { versionId, versionName: savedMaps.versions.find(v => v.id === versionId)?.name,
        model: item.settings.intentsModel, canStop: true, total: intents.length, unit: 'intents' });
      benchmarks.set(item.key, { controller, job, pair: { kind: 'generate', versionId } });
      let saved;
      try {
        const questions = await generateBenchmarkQuestions({
          snapshot, intents, existingQuestions, model: item.settings.intentsModel, signal: controller.signal,
          onProgress: done => change(job, { done }), onModel: active => modelActivity(job, active)
        });
        controller.signal.throwIfAborted();
        change(job, { stage: 'saving' });
        saved = bad(() => addQuestions({ ...options, questions, versionId, revision: snapshot.revision }));
        finish(job, 'done');
      } catch (error) {
        finish(job, controller.signal.aborted ? 'stopped' : 'failed', controller.signal.aborted ? null : error.message);
        if (controller.signal.aborted) throw new HttpError(409, 'Question generation stopped.');
        throw error;
      } finally {
        benchmarks.delete(item.key);
      }
      return versionState(item, saved);
    },
    'POST /projects/:key/map-benchmark': async (item, body) => {
      const { versionId, questionId } = body;
      const state = versionState(item);
      const question = state.questions.find(q => q.id === questionId);
      if (!question || !state.versions.some(v => v.id === versionId)) throw new HttpError(400, 'Choose a saved version and a question.');
      const previous = state.results.find(r => r.versionId === versionId && r.questionId === questionId);
      if (previous && previous.status !== 'error' && body.rerun !== true) return previous;
      free(item.key);
      const snapshot = bad(() => readSnapshot({ ...storage(item), versionId }));
      const controller = new AbortController();
      const pair = { versionId, questionId };
      const job = begin(item, 'benchmark', { ...pair, question: question.question, versionName: state.versions.find(v => v.id === versionId).name,
        model: 'sonnet', unit: 'calls', canStop: true });
      benchmarks.set(item.key, { controller, pair, job });
      try {
        const measured = await runBenchmark({ snapshot, question, model: 'sonnet', signal: controller.signal, onModel: active => modelActivity(job, active) });
        const result = { ...measured, ...pair, measuredAt: new Date().toISOString() };
        // A failed retry should leave the last completed measurement available.
        if (result.status !== 'error' || !previous || previous.status === 'error') {
          change(job, { stage: 'saving' });
          bad(() => recordResult({ ...storage(item), result, revision: snapshot.revision, questionRevision: question.revision }));
        }
        if (measured.resolvedModel) job.model = measured.resolvedModel;
        finish(job, controller.signal.aborted ? 'stopped' : measured.status === 'error' ? 'failed' : 'done', controller.signal.aborted ? null : measured.error ?? null);
        return result;
      } catch (error) {
        finish(job, controller.signal.aborted ? 'stopped' : 'failed', controller.signal.aborted ? null : error.message);
        throw error;
      } finally {
        benchmarks.delete(item.key);
      }
    },
    'GET /projects': () => ({ home, projects: listProjects({ dataRoot, claudeSettingsHome }).map(withRun) }),
    'GET /suggestions': () => ({ suggestions: listSuggestions({ claudeSettingsHome, dataRoot,
      added: listProjects({ dataRoot, claudeSettingsHome }).map(item => item.root) }) }),
    'POST /pick': async () => {
      if (picking) throw new HttpError(409, 'The folder dialog is open already.');
      picking = true;
      try { return { path: await pick() }; } finally { picking = false; }
    },
    'POST /projects': (_, body) => {
      const root = typeof body.root === 'string' && path.isAbsolute(body.root) ? path.resolve(body.root) : body.root;
      const why = refuse({ root, dataRoot });
      if (why) throw new HttpError(400, why);
      if (existsSync(path.join(dataRoot, projectKey(root), 'settings.json'))) throw new HttpError(409, 'This project is in the list already.');
      const key = newProject({ dataRoot, root, customHome });
      runs.start(key, 'refresh', [root, '--no-calls']);
      return { key };
    },
    'GET /projects/:key/estimate': async item => runs.json([item.root, '--estimate']),
    'POST /projects/:key/run': (item, body) => {
      free(item.key);
      if (body.calls !== true) return { run: runs.start(item.key, 'refresh', [item.root, '--no-calls']) };
      return { run: runs.start(item.key, 'analyse', [item.root, '--yes'], Number.isInteger(body.total) ? body.total : 0, item.settings.intentsModel) };
    },
    'POST /projects/:key/stop': (item, body) => {
      const job = latest.get(item.key);
      if (body.activityId != null && body.activityId !== job?.id) throw new HttpError(409, 'This activity has changed. Refresh its status.');
      const active = benchmarks.get(item.key);
      if (active) {
        change(active.job, { status: 'stopping', canStop: false });
        active.controller.abort();
        return {};
      }
      if (job?.status === 'running' && !job.canStop) throw new HttpError(409, 'This local map operation is finishing.');
      if (!runs.stop(item.key)) throw new HttpError(409, 'This project has no run.');
      return {};
    },
    'PUT /projects/:key/settings': (item, body) => {
      free(item.key);
      bad(() => saveSettings({ dataRoot, key: item.key, changes: body }));
      return {};
    },
    'POST /projects/:key/fix': (item, body) => {
      free(item.key);
      if (item.git !== 'ok') throw new HttpError(400, GIT_REASONS[item.git]);
      if (item.fix) throw new HttpError(409, 'Review or discard the current draft first.');
      if (!item.summary?.fixes) throw new HttpError(400, 'The report has no fixes.');
      const args = ['fix', item.root, '--headless'];
      if (body.finding !== undefined) {
        const model = readJson(path.join(dataRoot, item.key, 'report.json'), null);
        if (!model?.fixes) throw new HttpError(400, 'Run the report again to choose a finding.');
        bad(() => selectFindings(model, body.finding, body.fingerprint));
        args.push('--finding', body.finding);
        if (body.fingerprint) args.push('--fingerprint', body.fingerprint);
      }
      return { run: runs.start(item.key, 'fix', args) };
    },
    'GET /projects/:key/fix': item => {
      const fix = readyFix(path.join(dataRoot, item.key));
      if (!fix) throw new HttpError(404, 'There is no fix to review.');
      const { baseline, ...review } = fix;
      return review;
    },
    'POST /projects/:key/fix/apply': (item, body) => {
      free(item.key);
      const files = Array.isArray(body.files) ? body.files.filter(file => typeof file === 'string') : [];
      if (body.id && body.id !== readyFix(path.join(dataRoot, item.key))?.id) throw new HttpError(409, 'The draft changed. Open the latest review.');
      const conflicts = bad(() => fixConflicts({ root: item.root, outDir: path.join(dataRoot, item.key), files }));
      if (conflicts.length) throw new HttpError(409, 'Some files changed after the fix.', { conflicts });
      return { run: runs.start(item.key, 'apply', ['fix', item.root, '--apply', ...files.flatMap(file => [`--file=${file}`])]) };
    },
    'POST /projects/:key/fix/discard': (item, body) => {
      if (body.id && body.id !== readyFix(path.join(dataRoot, item.key))?.id) throw new HttpError(409, 'The draft changed. Open the latest review.');
      free(item.key);
      discardFix(path.join(dataRoot, item.key));
      return {};
    }
  };

  async function handleApi(request, response, pathname) {
    if (request.headers['x-context-health-token'] !== token) throw new HttpError(403, 'Open the page again.');
    const parts = pathname.slice('/api'.length).split('/');
    const key = parts[1] === 'projects' && parts[2] ? decodeURIComponent(parts[2]) : null;
    if (key) parts[2] = ':key';
    const route = api[`${request.method} ${parts.join('/')}`];
    if (!route) throw new HttpError(404, 'Not found.');
    const item = key ? project(key) : null;
    const answer = await route(item, request.method === 'GET' ? {} : await readBody(request));
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(answer));
  }

  // ---------- the pages ----------

  const reply = (response, type, text, headers = {}, status = 200) => {
    response.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    response.end(text);
  };

  function reportPage(response, html, view, embed) {
    const explorer = view === 'explorer' && html.includes('<div class="grid">') ? EXPLORER : '';
    const page = embed ? html.replace('</head>', () => EMBED + explorer + '\n</head>') : html;
    return reply(response, 'text/html', page, {
      'content-security-policy': "sandbox allow-scripts; frame-ancestors 'self'",
      'referrer-policy': 'no-referrer'
    });
  }

  async function handle(request, response) {
    const host = request.headers.host || '';
    if (!hosts.has(host)) throw new HttpError(403, 'Wrong host.');
    const { pathname, searchParams } = new URL(request.url, `http://${host}`);
    if (pathname === '/api/events') {
      // EventSource cannot send the token. The events only say that a run changed, and another site cannot read them.
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      response.write(': ready\n\n');
      listeners.add(response);
      request.on('close', () => listeners.delete(response));
      return;
    }
    if (pathname.startsWith('/api/')) return handleApi(request, response, pathname);
    if (request.method !== 'GET') throw new HttpError(404, 'Not found.');
    if (pathname === '/') {
      const page = readFileSync(new URL('index.html', PAGE), 'utf8').replace('{{token}}', token);
      return reply(response, 'text/html', page, { 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" });
    }
    if (ASSETS[pathname]) return reply(response, ASSETS[pathname], readFileSync(new URL(pathname.slice(1), PAGE), 'utf8'));
    const versionReport = pathname.match(/^\/p\/([^/]+)\/maps\/([^/]+)\/report\.html$/);
    if (versionReport) {
      try {
        const item = project(decodeURIComponent(versionReport[1]));
        const html = await savedReport(item, decodeURIComponent(versionReport[2]), searchParams.get('revision'));
        const view = searchParams.get('view');
        return reportPage(response, html, view, view === 'explorer' || view === 'full');
      } catch (error) {
        const status = error.status || 500;
        const title = status === 404 ? 'Saved version unavailable' : status === 409 ? 'This version has changed' : 'Could not load the saved report';
        const detail = String(error.message).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        return reply(response, 'text/html', '<!doctype html><html lang="en"><meta charset="utf-8"><title>' + title +
          '</title><main><h2>' + title + '</h2><p>' + detail + '</p></main></html>', {
          'content-security-policy': "default-src 'none'; sandbox; frame-ancestors 'self'",
          'referrer-policy': 'no-referrer'
        }, status);
      }
    }
    const saved = pathname.match(/^\/p\/([^/]+)\/maps\/([^/]+)$/);
    if (saved) {
      const item = project(decodeURIComponent(saved[1]));
      const versionId = decodeURIComponent(saved[2]);
      const version = mapState({ dir: storage(item).dir }).versions.find(v => v.id === versionId);
      if (!version) throw new HttpError(404, 'This map version could not be found.');
      const snapshot = readSnapshot({ ...storage(item), versionId });
      return reply(response, 'text/html', savedMapPage({ item, version, snapshot, searchParams }), {
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer'
      });
    }
    const match = pathname.match(/^\/p\/([^/]+)\/report\.html$/);
    if (match) {
      const item = project(decodeURIComponent(match[1]));
      const file = path.join(dataRoot, item.key, 'report.html');
      if (!existsSync(file)) throw new HttpError(404, 'No report yet.');
      // The report holds text of sessions. In the sandbox it cannot read the token or call the API.
      const modelFile = path.join(dataRoot, item.key, 'report.json');
      const stamp = [file, ...[file, modelFile].map(name => {
        const stat = statSync(name, { bigint: true, throwIfNoEntry: false });
        return stat && [stat.ino, stat.size, stat.ctimeNs].join(':');
      })].join('|');
      let html = recentReport?.stamp === stamp ? recentReport.html : null;
      if (html == null) {
        html = readFileSync(file, 'utf8');
        if (!html.includes(EXPLORER_MARKER)) {
          const model = readJson(modelFile, null);
          if (model?.health?.v1 && model.routes?.map) {
            try {
              const all = buildFixes(model);
              const byText = new Map([...all.list, ...all.smaller].map(fix => [fix.text, fix]));
              for (const fix of [...model.fixes?.list || [], ...model.fixes?.smaller || []]) {
                const current = byText.get(fix.text);
                if (current) Object.assign(fix, { sessionIds: current.sessionIds, rule: current.rule, fingerprint: current.fingerprint });
              }
              const trend = html.match(/<p class="state trend" id="trend"[^>]*>[\s\S]*?<\/p>/)?.[0];
              html = render(model);
              if (trend) html = html.replace('<div class="grid">', () => trend + '<div class="grid">');
            } catch { /* Preserve interactive controls from reports whose data format predates this reader. */ }
          }
          if (!html.includes(EXPLORER_MARKER)) {
            const styles = readFileSync(new URL('../page/page.css', import.meta.url), 'utf8');
            html = html.replace('</head>', () => '<style>' + styles + '</style></head>');
          }
        }
        recentReport = { stamp, html };
      }
      const view = searchParams.get('view');
      return reportPage(response, html, view, view !== 'standalone');
    }
    throw new HttpError(404, 'Not found.');
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch(error => {
      const status = error instanceof HttpError ? error.status : error instanceof URIError ? 404 : 500;
      if (response.headersSent) return response.end();
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error.message, ...(error.extra || {}) }));
    });
  });

  // ---------- start and stop ----------

  const first = port == null ? DEFAULT_PORT : Number(port);
  if (!Number.isInteger(first) || first < 0 || first > 65535) { console.error(`--port needs a port number: ${port}`); process.exit(1); }
  // With no --port, a used port is not an error: the next free port is taken.
  const listen = at => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(at, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  for (let k = 0; ; k += 1) {
    try { await listen(first + k); break; } catch (error) {
      if (error.code !== 'EADDRINUSE' || port != null || k === 20) { console.error(`The dashboard did not start: ${error.message}`); process.exit(1); }
    }
  }
  const { port: used } = server.address();
  hosts = new Set([`127.0.0.1:${used}`, `localhost:${used}`]);
  const address = `http://127.0.0.1:${used}`;
  console.log(`context-health: ${address} (Ctrl-C stops it)`);

  const stop = async () => {
    server.close();
    for (const response of listeners) response.end();
    for (const { controller } of benchmarks.values()) controller.abort();
    runs.stopAll();
    await Promise.allSettled(workers);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (open) spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [address], { stdio: 'ignore' });
}
