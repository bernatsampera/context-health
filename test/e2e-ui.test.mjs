// E2E for the dashboard: `context-health ui`. It starts the real server on a free port, and drives the API as the page does.
// It uses a git copy of fixtures/indoeuromap, a copy of fixtures/claude-settings-home, and the fake binaries
// test/fake-claude.mjs (claude -p), test/fake-agent.mjs (claude -p for Fix) and test/fake-picker.mjs. No real model call.
//
// The ways it can fail (written before the code):
// U1  The list shows a folder that is not a project: a test artifact with a settings.json, a project that moved, the cache.
// U2  An old <name> folder is not renamed, or loses its history or its model answers. Two projects with one name share a folder.
// U3  A suggestion has a wrong path (a dash in a name), is a temp folder, a worktree, a project of the list, or is not newest first.
// U4  Add takes a folder that does not exist or that holds the report folder, makes no report, or makes a model call.
// U5  The estimate makes a call, or a run with calls makes none.
// U6  Two runs of one project at the same time. Stop does not stop the run, or leaves the project busy.
// U7  A run starts with no click: at the start of the server, or when the page opens.
// U8  Fix changes the project before Apply, leaves a worktree or a branch, or does not see the uncommitted changes.
// U9  Apply writes a file that the user did not pick, takes a path that is not in the fix, or applies half of a fix with a conflict.
// U10 Discard changes the project. A finished fix shows again.
// U11 Fix starts in a project with no git, with no reason.
// U12 The server takes a request with a foreign Host, with no token, or with a path out of its folders.
// U13 The settings form saves a bad value, or a later run loses the saved value.
//     The ignore switches take a wrong word, make a model call, or compare the score with a run that ignores other files.
// U14 A cancel in the folder dialog is an error.
// U15 The report in the dashboard shows terminal commands. The page loads a file from the network.
// U16 After a run that gives the same result, the project still shows the old sessions as new.
// Artifact: out/e2e-ui/ (one JSON file for each API answer, index.html, and the report as the dashboard shows it).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const OLD = '/Users/example/projects/indoeuromap';
const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'context-health-ui-')));
const data = path.join(work, 'data');
const artifact = path.join(repo, 'out', 'e2e-ui');
mkdirSync(artifact, { recursive: true });
mkdirSync(data, { recursive: true });

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' });
const project = path.join(work, 'a-b', 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
git(project, 'init', '-q');
git(project, 'add', '-A');
git(project, 'commit', '-q', '-m', 'start');
const twin = path.join(work, 'twin', 'indoeuromap');
mkdirSync(twin, { recursive: true });
writeFileSync(path.join(twin, 'CLAUDE.md'), '# Twin\n');
const settingsHome = path.join(work, 'claude-settings-home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), settingsHome, { recursive: true });

// Sessions for the suggestions. The folder name of Claude Code replaces each special character, so it is not a path.
const encode = folder => folder.replace(/[^A-Za-z0-9]/g, '-');
const addSession = (folder, cwd, ageHours, id = 's1') => {
  const dir = path.join(settingsHome, 'projects', encode(folder));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ type: 'summary' })}\n${JSON.stringify({ type: 'user', cwd, entrypoint: 'cli', message: { role: 'user', content: 'Hi' } })}\n`);
  const time = new Date(Date.now() - ageHours * 3600e3);
  utimesSync(file, time, time);
};
const recent = path.join(work, 'my-apps', 'fresh-app');
const older = path.join(work, 'my-apps', 'older.app');
for (const dir of [recent, older]) mkdirSync(dir, { recursive: true });
addSession(recent, recent, 1);
addSession(older, older, 5);
addSession(path.join(older, '.claude/worktrees/x'), path.join(older, '.claude/worktrees/x'), 2, 'w1');
addSession('/gone/project', '/gone/project', 0.5);
addSession(twin, twin, 48);

// U2: a report folder with the old name, its history and its model answers.
const oldFolder = path.join(data, 'indoeuromap');
mkdirSync(path.join(data, '.cache', 'indoeuromap', 'intents'), { recursive: true });
writeFileSync(path.join(data, '.cache', 'indoeuromap', 'intents', 'keep.json'), '{}');
mkdirSync(oldFolder, { recursive: true });
writeFileSync(path.join(oldFolder, 'settings.json'), JSON.stringify({ root: project, oldPaths: [OLD], config: null, sessions: '20',
  intentsModel: 'sonnet', claudeSettingsHome: settingsHome, cache: null, fixSessions: [], ignore: [] }));
writeFileSync(path.join(oldFolder, 'history.json'), JSON.stringify([{ at: '2026-11-01T10:00:00.000Z', kind: 'report', shown: 'no-data',
  score: null, label: null, headline: 'x', analysed: 0, needs: 0, fixes: 0, startLoadTokens: 1, contextTokens: 1 }]));
// U1: folders that are not projects.
for (const [name, root] of [['e2e-flow', project], ['moved-123abc', '/gone/project']]) {
  mkdirSync(path.join(data, name));
  writeFileSync(path.join(data, name, 'settings.json'), JSON.stringify({ root }));
}

const claudeLog = path.join(work, 'claude.log');
const agentLog = path.join(work, 'agent.log');
const pickerAnswer = path.join(work, 'picker.txt');
const env = { ...process.env, CONTEXT_HEALTH_HOME: data, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test', 'fake-claude.mjs'),
  CONTEXT_HEALTH_FAKE_LOG: claudeLog, CONTEXT_HEALTH_AGENT_BIN: path.join(repo, 'test', 'fake-agent.mjs'),
  CONTEXT_HEALTH_FAKE_AGENT_LOG: agentLog, CONTEXT_HEALTH_PICKER_BIN: path.join(repo, 'test', 'fake-picker.mjs'),
  CONTEXT_HEALTH_FAKE_PICKER: pickerAnswer, TMPDIR: work };
// The session folders of temp projects are temp folders too. The test allows them. One test below checks the rule itself.
env.CONTEXT_HEALTH_TEMP_PROJECTS = '1';

const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []);
const calls = () => lines(claudeLog).length;
let server;
let base;
let token;
let stopped = '';

before(async () => {
  server = spawn(process.execPath, [cli, 'ui', '--no-open', '--port', '0', '--claude-settings-home', settingsHome], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    let text = '';
    const read = chunk => {
      text += chunk;
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    };
    server.stdout.on('data', read);
    server.stderr.on('data', read);
    server.on('exit', code => { stopped = `server exit ${code}\n${text}`; reject(new Error(stopped)); });
  });
  const page = await (await fetch(base)).text();
  token = page.match(/name="token" content="([^"]+)"/)?.[1];
});
after(() => { server?.kill('SIGTERM'); });

let step = 0;
const api = async (method, url, body, { save = true } = {}) => {
  const response = await fetch(`${base}${url}`, { method, headers: { 'x-context-health-token': token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  const answer = { status: response.status, body: text ? JSON.parse(text) : null };
  if (save) {
    step += 1;
    const name = `${String(step).padStart(2, '0')}-${method}${url.replace(/-[0-9a-f]{6}(?=\/|$)/, '').replace(/[^a-z0-9]+/gi, '-')}.json`;
    writeFileSync(path.join(artifact, name), `${JSON.stringify({ method, url, body, ...answer }, null, 2).replaceAll(work, '<work>')}\n`);
  }
  return answer;
};
const projects = async (save = false) => (await api('GET', '/api/projects', undefined, { save })).body.projects;
const find = async root => (await projects()).find(item => item.root === root);
const idle = async root => {
  for (let k = 0; k < 400; k += 1) {
    const item = await find(root);
    if (item && !['running', 'stopping'].includes(item.run?.status)) return item;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`The run of ${root} did not end`);
};
const url = item => `/api/projects/${item.key}`;
const ok = async promise => { const answer = await promise; assert.ok(answer.status < 300, JSON.stringify(answer)); return answer.body; };

test('U1, U2: the list has only the project, with its history, in a name-hash folder', async () => {
  const list = await projects(true);
  assert.deepEqual(list.map(item => item.root), [project]);
  assert.match(list[0].key, /^indoeuromap-[0-9a-f]{6}$/);
  assert.ok(!existsSync(oldFolder), 'the old folder is renamed');
  assert.equal(JSON.parse(readFileSync(path.join(data, list[0].key, 'history.json'), 'utf8')).length, 1);
  assert.ok(existsSync(path.join(data, '.cache', list[0].key, 'intents', 'keep.json')), 'the model answers are kept');
});

test('U7, U15: opening the page starts no run, and the page has no network file', async () => {
  const page = await (await fetch(base)).text();
  writeFileSync(path.join(artifact, 'index.html'), page.replace(token, '<token>'));
  for (const name of ['app.js', 'app.css']) {
    const text = await (await fetch(`${base}/${name}`)).text();
    assert.ok(text.length > 1000, name);
    assert.doesNotMatch(text, /(src|href|url\()\s*[=(]?\s*["']?https?:/);
  }
  assert.doesNotMatch(page, /(src|href)="https?:/);
  assert.equal(calls(), 0);
  assert.equal((await find(project)).run, null);
  assert.ok(!existsSync(path.join(data, (await find(project)).key, 'report.html')));
});

test('U12: a foreign Host, a request with no token and a path out of the folder are refused', async () => {
  const { key } = await find(project);
  const raw = (headers, urlPath, method = 'GET') => new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: new URL(base).port, path: urlPath, method, headers }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
  assert.equal(await raw({ host: 'evil.example' }, '/'), 403);
  assert.equal(await raw({ host: 'evil.example', 'x-context-health-token': token }, '/api/projects'), 403);
  assert.equal(await raw({}, `/api/projects/${key}/run`, 'POST'), 403);
  assert.equal(await raw({}, '/api/projects'), 403);
  for (const bad of ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/p/..%2f..%2fpackage.json/report.html', '/p/e2e-flow/report.html', '/p/.cache/report.html']) {
    assert.equal(await raw({}, bad), 404, bad);
  }
  assert.equal(calls(), 0);
});

test('U3: the suggestions have the real path, newest first', async () => {
  const { suggestions } = await ok(api('GET', '/api/suggestions'));
  assert.deepEqual(suggestions.map(item => item.root), [recent, older, twin]);
  // The worktree session counts for the main folder.
  assert.equal(suggestions[1].sessions, 2);
  assert.ok(Date.parse(suggestions[0].lastAt) > Date.parse(suggestions[1].lastAt));
});

test('U3: a temp folder is not a suggestion', () => {
  const code = `import { listSuggestions } from ${JSON.stringify(path.join(repo, 'src/ui/projects.mjs'))};` +
    `console.log(listSuggestions({ claudeSettingsHome: ${JSON.stringify(settingsHome)}, dataRoot: ${JSON.stringify(data)}, added: [] }).length)`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...env, CONTEXT_HEALTH_TEMP_PROJECTS: '' } });
  assert.equal(result.stdout.trim(), '0', result.stderr);
});

test('U4: Add refuses a bad folder', async () => {
  for (const root of ['', 'relative/path', '/gone/project', path.join(project, 'CLAUDE.md'), work, '/']) {
    const answer = await api('POST', '/api/projects', { root }, { save: false });
    assert.equal(answer.status, 400, root);
    assert.ok(answer.body.error.length > 10, root);
  }
  assert.equal((await projects()).length, 1);
});

test('U2, U4: Add makes a report with no model call, and a second project of the same name gets its own folder', async () => {
  const { key } = await ok(api('POST', '/api/projects', { root: twin }));
  const added = await idle(twin);
  assert.equal(added.key, key);
  assert.equal(added.run?.status, 'done');
  assert.notEqual(added.key, (await find(project)).key);
  assert.ok(existsSync(path.join(data, added.key, 'report.html')));
  assert.equal(calls(), 0);
  const { suggestions } = await ok(api('GET', '/api/suggestions', undefined, { save: false }));
  assert.ok(!suggestions.some(item => item.root === twin), 'an added project is not a suggestion');
  assert.equal((await api('POST', '/api/projects', { root: twin }, { save: false })).status, 409);
});

test('U14: the folder dialog gives a path, and a cancel gives null', async () => {
  writeFileSync(pickerAnswer, recent);
  assert.equal((await ok(api('POST', '/api/pick'))).path, recent);
  writeFileSync(pickerAnswer, '');
  assert.equal((await ok(api('POST', '/api/pick', undefined, { save: false }))).path, null);
});

test('U5: the estimate makes no call, then a run with calls gives a score', async () => {
  const item = await find(project);
  const estimate = await ok(api('GET', `${url(item)}/estimate`));
  assert.ok(estimate.sessions > 0 && estimate.total >= estimate.sessions, JSON.stringify(estimate));
  assert.equal(estimate.model, 'sonnet');
  assert.equal(calls(), 0);
  await ok(api('POST', `${url(item)}/run`, { calls: false }));
  const free = await idle(project);
  assert.equal(calls(), 0);
  assert.equal(free.newSessions, estimate.sessions);
  await ok(api('POST', `${url(item)}/run`, { calls: true }));
  const done = await idle(project);
  assert.equal(done.run.status, 'done', JSON.stringify(done.run));
  assert.ok(calls() > 0);
  assert.ok(done.run.done > 0, 'the progress counts the calls');
  assert.deepEqual([done.activity.kind, done.activity.status, done.activity.stage, done.activity.model], ['analyse', 'done', 'finished', 'sonnet']);
  assert.equal(done.activity.done, calls(), 'the analysis counts the model processes that actually ran');
  assert.equal(done.activity.total, null, 'an estimate is not a known total');
  assert.ok(done.summary.analysed > 0);
  assert.equal(done.newSessions, 0);
  assert.ok(done.summary.grades.total > 0);
  const summary = JSON.parse(readFileSync(path.join(data, item.key, 'summary.json'), 'utf8'));
  assert.match(summary.badge.stamp, /^[0-9a-f]{64}$/);
  assert.equal(summary.badge.count, 0);
  // A fresh process must serve the saved badge without opening a transcript.
  const cold = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.readFileSync;
    let transcripts = 0;
    fs.readFileSync = function(file, ...args) {
      if (String(file).endsWith('.jsonl')) transcripts++;
      return original.call(this, file, ...args);
    };
    syncBuiltinESMExports();
    const { readProject } = await import('./src/ui/projects.mjs');
    const item = readProject(${JSON.stringify({ dataRoot: data, key: item.key })});
    console.log(JSON.stringify({ transcripts, pending: item.newSessions }));
  `;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', cold], { cwd: repo, encoding: 'utf8' })), { transcripts: 0, pending: 0 });
});

test('U16: the badge counts eligible sessions, including an updated session', async () => {
  const { key } = await find(twin);
  await new Promise(resolve => setTimeout(resolve, 20));
  addSession(twin, twin, 0, 'headless');
  const head = path.join(settingsHome, 'projects', encode(twin), 'headless.jsonl');
  writeFileSync(head, readFileSync(head, 'utf8').replace('"cli"', '"sdk-cli"'));
  assert.equal((await find(twin)).newSessions, 0, 'a claude -p session does not count');
  addSession(twin, twin, 0, 'fresh');
  assert.equal((await find(twin)).newSessions, 0, 'a single message is ineligible');
  const file = path.join(settingsHome, 'projects', encode(twin), 'fresh.jsonl');
  const extra = JSON.stringify({ type: 'user', cwd: twin, entrypoint: 'cli', message: { role: 'user', content: 'A follow-up question' } });
  writeFileSync(file, readFileSync(file, 'utf8') + extra + '\n');
  const estimate = await ok(api('GET', `/api/projects/${key}/estimate`));
  assert.equal(estimate.sessions, 1);
  assert.equal((await find(twin)).newSessions, estimate.sessions, 'an existing session became eligible');
  await ok(api('POST', `/api/projects/${key}/run`, { calls: false }));
  assert.equal((await idle(twin)).newSessions, 1, 'a free scan does not analyse the session');
  await ok(api('POST', `/api/projects/${key}/run`, { calls: true }));
  const partial = await idle(twin);
  assert.equal(partial.run.status, 'partial');
  assert.equal(partial.summary.analysis.failures[0].sessionId, 'fresh');
  assert.equal(partial.summary.analysis.failures[0].retryable, true);
  assert.equal(partial.newSessions, 1);
});

test('U15: the report in the dashboard has no terminal command and runs in a sandbox', async () => {
  const { key } = await find(project);
  const response = await fetch(`${base}/p/${key}/report.html`);
  const page = await response.text();
  writeFileSync(path.join(artifact, 'report-in-dashboard.html'), page.replaceAll(work, '<work>'));
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  assert.match(page, /<style id="embed">[^<]*\.fixcmd[^<]*display: ?none/);
  const explorer = await fetch(`${base}/p/${key}/report.html?view=explorer`);
  const embedded = await explorer.text();
  assert.match(explorer.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.match(embedded, /<style id="explorer-embed">/);
  assert.match(embedded, /id="mapcard"/);
  assert.match(embedded, /aria-label="Sessions and intents"/);
  assert.doesNotMatch(page, /id="explorer-embed"/);
  assert.doesNotMatch(readFileSync(path.join(data, key, 'report.html'), 'utf8'), /id="embed"/);
});

test('U13: the settings form saves good values only', async () => {
  const item = await find(project);
  for (const bad of [{ sessions: 0 }, { sessions: 'x' }, { intentsModel: '--help' }, { oldPaths: ['relative'] }, { config: null }, { root: '/' }, { ignore: 'user' }, { ignore: ['everything'] }]) {
    assert.equal((await api('PUT', `${url(item)}/settings`, bad, { save: false })).status, 400, JSON.stringify(bad));
  }
  await ok(api('PUT', `${url(item)}/settings`, { sessions: 12, intentsModel: 'sonnet' }));
  await ok(api('POST', `${url(item)}/run`, { calls: false }));
  const after = await idle(project);
  assert.equal(after.settings.sessions, 12);
  assert.equal(after.settings.claudeSettingsHome, undefined, 'the page does not need it');
  const saved = JSON.parse(readFileSync(path.join(data, item.key, 'settings.json'), 'utf8'));
  assert.equal(saved.sessions, '12');
  assert.equal(saved.claudeSettingsHome, settingsHome);
  assert.deepEqual(saved.oldPaths, [OLD], 'a terminal option that is saved stays');
  const previousPath = '/previous/folder/that/moved';
  await ok(api('PUT', `${url(item)}/settings`, { oldPaths: [OLD, previousPath] }));
  assert.deepEqual((await find(project)).settings.oldPaths, [OLD, previousPath]);
  await ok(api('PUT', `${url(item)}/settings`, { oldPaths: [OLD] }));
});

test('U13: the ignore switches change the report with no model call', async () => {
  const item = await find(project);
  const made = calls();
  assert.deepEqual(item.settings.ignore, []);
  assert.deepEqual((await find(twin)).settings.ignore, ['user', 'skills'], 'the default of a new project');
  const report = () => JSON.parse(readFileSync(path.join(data, item.key, 'report.json'), 'utf8'));
  assert.ok(report().startLoad.some(entry => entry.path.startsWith('~/')));
  await ok(api('PUT', `${url(item)}/settings`, { ignore: ['skills', 'user'] }));
  await ok(api('POST', `${url(item)}/run`, { calls: false }));
  const ignored = await idle(project);
  assert.deepEqual(ignored.settings.ignore, ['user', 'skills']);
  assert.ok(!report().startLoad.some(entry => entry.path.startsWith('~/') || /skill/.test(entry.what)));
  assert.equal(ignored.delta, null, 'no change of the score from a run with other files');
  await ok(api('PUT', `${url(item)}/settings`, { ignore: [] }));
  await ok(api('POST', `${url(item)}/run`, { calls: false }));
  assert.equal((await idle(project)).summary.score, item.summary.score);
  assert.equal(calls(), made);
});

test('U11: Fix in a project with no git is refused with a reason', async () => {
  const item = await find(twin);
  assert.equal(item.git, 'no-git');
  const answer = await api('POST', `${url(item)}/fix`);
  assert.equal(answer.status, 400);
  assert.match(answer.body.error, /git/);
});

test('U6: one run at a time, and Stop frees the project', async () => {
  const item = await find(project);
  writeFileSync(path.join(work, 'agent-sleep'), '1');
  await ok(api('POST', `${url(item)}/fix`));
  for (let k = 0; k < 400 && !lines(agentLog).length; k += 1) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(lines(agentLog).length, 1, 'the agent started');
  const fixing = (await ok(api('GET', '/api/activity', undefined, { save: false }))).activities[item.key];
  assert.deepEqual([fixing.kind, fixing.stage, fixing.activeCalls, fixing.canStop], ['fix', 'model', 1, true]);
  assert.equal((await api('POST', `${url(item)}/run`, { calls: false })).status, 409);
  assert.equal((await api('POST', `${url(item)}/fix`, undefined, { save: false })).status, 409);
  assert.equal((await api('PUT', `${url(item)}/settings`, { sessions: 3 }, { save: false })).status, 409);
  await ok(api('POST', `${url(item)}/stop`));
  const after = await idle(project);
  assert.equal(after.run.status, 'stopped');
  assert.equal(after.activity.id, fixing.id);
  assert.equal(after.activity.status, 'stopped');
  assert.equal(git(project, 'worktree', 'list').trim().split('\n').length, 1, 'no worktree is left');
  assert.equal(after.fix, null);
});

test('U8: Fix edits a copy with the uncommitted changes, and the project does not change', async () => {
  const item = await find(project);
  writeFileSync(path.join(work, 'agent-sleep'), '');
  appendFileSync(path.join(project, 'CLAUDE.md'), '\nUncommitted line.\n');
  writeFileSync(path.join(project, 'untracked.md'), '# Untracked\n');
  const status = git(project, 'status', '--porcelain');
  const head = git(project, 'rev-parse', 'HEAD');
  await ok(api('POST', `${url(item)}/fix`));
  const after = await idle(project);
  assert.equal(after.run.status, 'done', JSON.stringify(after.run));
  const agent = JSON.parse(lines(agentLog).at(-1));
  assert.ok(agent.argv.includes('-p') && agent.argv.includes('--no-session-persistence'));
  assert.notEqual(agent.cwd, project);
  assert.ok(!agent.cwd.startsWith(`${project}/`) && !agent.cwd.startsWith(`${data}/`) && !agent.cwd.startsWith(`${repo}/`), agent.cwd);
  assert.match(agent.claudeMd, /Uncommitted line/);
  assert.equal(agent.untracked, true);
  assert.match(agent.stdin, /What to improve/);
  assert.equal(git(project, 'status', '--porcelain'), status);
  assert.equal(git(project, 'rev-parse', 'HEAD'), head);
  assert.equal(git(project, 'worktree', 'list').trim().split('\n').length, 1);
  assert.doesNotMatch(readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), /Fake fix/);
  const fix = await ok(api('GET', `${url(item)}/fix`));
  assert.deepEqual(fix.files.map(file => file.path), ['CLAUDE.md', 'README.md', 'docs/new note.md']);
  assert.doesNotMatch(fix.files[0].patch, /^\+Uncommitted line/m);
  assert.equal(after.fix.files, 3);
});

test('U9: Apply refuses other paths, and a conflict applies nothing', async () => {
  const item = await find(project);
  for (const files of [[], ['../evil'], ['Makefile'], 'CLAUDE.md']) {
    assert.equal((await api('POST', `${url(item)}/fix/apply`, { files }, { save: false })).status, 400, JSON.stringify(files));
  }
  const readme = path.join(project, 'README.md');
  const before = readFileSync(readme, 'utf8');
  const claude = readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
  writeFileSync(readme, 'Other text.\n');
  const answer = await api('POST', `${url(item)}/fix/apply`, { files: ['CLAUDE.md', 'README.md'] });
  assert.equal(answer.status, 409);
  assert.deepEqual(answer.body.conflicts, ['README.md']);
  assert.equal(readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), claude, 'nothing is applied');
  writeFileSync(readme, before);
});

test('U9, U10: Apply writes the picked files, then the report runs again', async () => {
  const item = await find(project);
  const agents = lines(agentLog).length;
  const made = calls();
  await ok(api('POST', `${url(item)}/fix/apply`, { files: ['CLAUDE.md', 'docs/new note.md'] }));
  const after = await idle(project);
  assert.equal(after.run.status, 'done', JSON.stringify(after.run));
  assert.match(readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), /Uncommitted line\.\n[\s\S]*Fake fix/);
  assert.ok(existsSync(path.join(project, 'docs', 'new note.md')));
  assert.doesNotMatch(readFileSync(path.join(project, 'README.md'), 'utf8'), /Fake fix/);
  assert.equal(after.fix, null, 'the fix does not show again');
  assert.equal((await api('GET', `${url(item)}/fix`, undefined, { save: false })).status, 404);
  const history = JSON.parse(readFileSync(path.join(data, item.key, 'history.json'), 'utf8'));
  assert.equal(history.at(-1).kind, 'after-fix');
  const { fixOutcome } = JSON.parse(readFileSync(path.join(data, item.key, 'report.json')));
  assert.deepEqual(fixOutcome.files, ['CLAUDE.md', 'docs/new note.md']);
  assert.ok(fixOutcome.after.startTokens > fixOutcome.before.startTokens);
  assert.ok(fixOutcome.after.reachable > fixOutcome.before.reachable);
  assert.ok(fixOutcome.routes.some(route => route.before === null && route.after === 1));
  assert.equal(fixOutcome.before.reachable + fixOutcome.before.unreachable, fixOutcome.after.reachable + fixOutcome.after.unreachable);
  assert.equal(fixOutcome.later.sessions, 0);
  writeFileSync(path.join(artifact, 'applied-fix.json'), JSON.stringify(fixOutcome, null, 2));
  assert.equal(lines(agentLog).length, agents);
  assert.equal(calls(), made, 'Apply makes no model call');
});

test('U10: Discard does not change the project', async () => {
  const item = await find(project);
  await ok(api('POST', `${url(item)}/fix`));
  await idle(project);
  const status = git(project, 'status', '--porcelain');
  const text = readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
  await ok(api('POST', `${url(item)}/fix/discard`));
  assert.equal((await find(project)).fix, null);
  assert.equal(git(project, 'status', '--porcelain'), status);
  assert.equal(readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), text);
  assert.ok(!readdirSync(path.join(settingsHome, 'projects')).some(name => /context-health-fix/.test(name)), 'no session of the fix');
});

test('A draft for one finding excludes unrelated edits and rejects a stale selection', async () => {
  const item = await find(project);
  const { fixes } = JSON.parse(readFileSync(path.join(data, item.key, 'report.json')));
  const finding = fixes.list.find(fix => fix.target === 'CLAUDE.md');
  assert.ok(finding);
  assert.equal((await api('POST', url(item) + '/fix', { finding: finding.id, fingerprint: 'stale' })).status, 400);
  await ok(api('POST', url(item) + '/fix', { finding: finding.id, fingerprint: finding.fingerprint }));
  assert.equal((await idle(project)).run.status, 'done');
  const draft = await ok(api('GET', url(item) + '/fix'));
  assert.deepEqual(draft.findings.map(fix => fix.id), [finding.id]);
  assert.ok(draft.files.every(file => file.findingIds.includes(finding.id)));
  assert.ok(!draft.files.some(file => file.path === 'docs/new note.md'));
  const prompt = JSON.parse(lines(agentLog).at(-1)).stdin;
  assert.ok(prompt.includes(finding.text));
  assert.ok(fixes.list.filter(fix => fix.id !== finding.id).every(fix => !prompt.includes(fix.text)));
  await ok(api('POST', url(item) + '/fix/discard'));
});

test('New sessions add observed use while the comparison at apply stays fixed', async () => {
  const item = await find(project);
  const report = () => JSON.parse(readFileSync(path.join(data, item.key, 'report.json')));
  const previous = report().fixOutcome;
  const dir = path.join(settingsHome, 'projects', encode(OLD));
  const old = '22222222-0000-0000-0000-000000000000';
  const id = '95000002-0000-0000-0000-000000000000';
  const records = lines(path.join(dir, old + '.jsonl')).flatMap(line => {
    try { return [JSON.parse(line.replaceAll(old, id))]; } catch { return []; }
  });
  records.forEach((record, i) => { if (record.timestamp) record.timestamp = new Date(Date.now() + i * 1000).toISOString(); });
  writeFileSync(path.join(dir, id + '.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
  await ok(api('POST', url(item) + '/run', { calls: true }));
  assert.ok(['done', 'partial'].includes((await idle(project)).run.status));
  const outcome = report().fixOutcome;
  assert.deepEqual(outcome.before, previous.before);
  assert.deepEqual(outcome.after, previous.after);
  assert.deepEqual(outcome.routes, previous.routes);
  assert.equal(outcome.later.sessions, 1);
  assert.ok(outcome.later.searched > 0);
  writeFileSync(path.join(artifact, 'later-fix.json'), JSON.stringify(outcome, null, 2));
});

test('the final list is the artifact', async () => {
  const list = await projects(true);
  assert.equal(list.length, 2);
  assert.equal(stopped, '');
});
