// Run the dashboard across two processes. Check that a pending refactor survives
// a restart and that stale reviews, duplicate saves and existing folder changes
// cannot overwrite the parent or attach its results to the child.
// The folder map can lose recorded activity, mistake a result for an open,
// expose output from outside the project, or show live evidence for a saved version.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { projectKey } from '../src/data-folder.mjs';

const repo = path.resolve(import.meta.dirname, '..');

test('Refactor outside the dashboard, resume, review the exact files and compare the child', { timeout: 60000 }, async t => {
  const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'context-health-refactor-')));
  const root = path.join(work, 'handbook');
  const data = path.join(work, 'data');
  const key = projectKey(root);
  const project = path.join(data, key);
  const claudeHome = path.join(work, 'claude');
  const recordedId = '98000002-0000-0000-0000-000000000000';
  const calls = path.join(work, 'calls.jsonl');
  const originalEntry = 'Read the project guides.';
  const branchRule = 'Publish from the stable branch.';
  const changedEntry = 'For releases, read [Publishing](docs/publishing.md).';
  const edit = (file, text) => writeFileSync(path.join(root, file), text);
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(project, { recursive: true });
  edit('CLAUDE.md', originalEntry);
  edit('docs/publishing.md', branchRule);
  edit('docs/old-guide.md', 'Outdated notes.');
  edit('docs/listed.md', 'A guide visible in a directory listing.');
  edit('docs/matched.md', 'A guide found in the search.');
  const outside = path.join(work, 'private-log.md');
  const privateText = 'PRIVATE_TOOL_OUTPUT';
  writeFileSync(outside, privateText);
  const transcriptDir = path.join(claudeHome, 'projects', root.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(transcriptDir, { recursive: true });
  const transcript = [];
  const record = (type, message) => {
    const n = transcript.length;
    transcript.push({
      cwd: root, sessionId: recordedId, entrypoint: 'cli', uuid: 'record-' + n,
      timestamp: new Date(Date.UTC(2026, 0, 1, 12, 0, n)).toISOString(), type, message
    });
  };
  const tool = (name, input, content, isError = false) => {
    const id = 'tool-' + transcript.length;
    record('assistant', { id, role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id, name, input }] });
    record('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] });
  };
  record('user', { role: 'user', content: 'Prepare the handbook release' });
  tool('Bash', { command: 'ls docs' }, 'listed.md\nold-guide.md\npublishing.md');
  tool('Grep', { pattern: 'stable branch', path: path.join(root, 'docs') }, 'docs/publishing.md\ndocs/matched.md\n' + outside);
  tool('Grep', { pattern: 'draft branch', path: path.join(root, 'docs') }, 'No matches found');
  tool('Grep', { pattern: 'other branch', path: path.join(root, 'docs') }, 'Permission denied', true);
  tool('Grep', { pattern: 'archive', path: root }, 'Permission denied', true);
  tool('Read', { file_path: path.join(root, 'CLAUDE.md') }, '1\t' + originalEntry);
  tool('Read', { file_path: path.join(root, 'docs/publishing.md') }, '1\t' + branchRule);
  tool('Read', { file_path: outside }, '1\t' + privateText);
  record('user', { role: 'user', content: 'Check the release branch once more' });
  writeFileSync(path.join(transcriptDir, recordedId + '.jsonl'), transcript.map(row => JSON.stringify(row)).join('\n') + '\n');
  const harvest = spawnSync(process.execPath, [
    'bin/context-health.mjs', root, '--out', project, '--claude-settings-home', claudeHome, '--no-calls', '--no-save', '--no-open'
  ], { cwd: repo, encoding: 'utf8' });
  assert.ok([0, 2].includes(harvest.status), harvest.stderr || harvest.stdout);
  const parsedSessions = JSON.parse(readFileSync(path.join(project, 'report.json'), 'utf8')).sessions;
  assert.equal(parsedSessions.list.length, 1, 'The CLI reads the recorded transcript');
  writeFileSync(path.join(project, 'settings.json'), JSON.stringify({ root }));
  const sessions = [recordedId, 's1', 's2', 's3', 's4'].map(sessionId => ({
    sessionId, status: 'ok', intents: [{ id: 'release', goal: 'Publish a release', from: 1, to: 1 }]
  }));
  const report = {
    project: { root }, intents: { sessions },
    sessions: { list: sessions.map(s => parsedSessions.list.find(parsed => parsed.sessionId === s.sessionId) || ({
      sessionId: s.sessionId, title: 'Prepare the handbook release', startedAt: '2026-01-01T12:00:00Z',
      messages: [{ kind: 'user', n: 1, text: 'Prepare the handbook release' }], answers: [], events: []
    })), skipped: [] },
    needs: { sessions: sessions.map(s => ({
      sessionId: s.sessionId, intents: [{ intentId: 'release', needs: [{ kind: 'file', scope: 'project', path: 'docs/publishing.md' }] }]
    })) },
    groups: { list: [{ id: 'g1', label: 'Publish a release', members: sessions.map(s => ({ sessionId: s.sessionId, intentId: 'release' })) }] },
    routes: { intents: sessions.map(s => ({
      sessionId: s.sessionId, needs: Array.from({ length: 4 }, () => ({ path: 'docs/publishing.md', state: 'search' }))
    })) },
    health: { v1: { method: 'v3', shown: 'score', proof: { status: 'pass' } } }
  };
  writeFileSync(path.join(project, 'report.json'), JSON.stringify(report));

  let server, base, token;
  const launch = async () => {
    server = spawn(process.execPath, ['bin/context-health.mjs', 'ui', '--no-open', '--port', '0'], {
      cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CONTEXT_HEALTH_HOME: data, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CONTEXT_HEALTH_FAKE_LOG: calls }
    });
    const lines = createInterface({ input: server.stdout });
    let address;
    for await (const line of lines) {
      address = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) break;
    }
    assert.ok(address, 'The local test server started');
    base = address;
    token = (await (await fetch(base)).text()).match(/name="token" content="([^"]+)"/)[1];
  };
  t.after(() => server?.kill('SIGTERM'));
  await launch();
  const request = async (method, route, body, success = true) => {
    const res = await fetch(base + '/api/projects/' + key + '/' + route, {
      method, headers: { 'content-type': 'application/json', 'x-context-health-token': token },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const reply = await res.json();
    assert.equal(res.ok, success, method + ' ' + route + ' ' + JSON.stringify(reply));
    return reply;
  };
  const state = () => request('GET', 'map-versions');
  const refactor = (action, body, success) => request('POST', 'map-refactor/' + action, body, success);
  const [parent] = (await request('POST', 'map-versions', { name: 'Original map' })).versions;
  assert.equal(parent.score, 50);
  const questions = (await request('POST', 'map-questions', { question: 'Which branch do we publish from?', expected: 'stable branch' })).questions;
  const benchmark = versionId => request('POST', 'map-benchmark', { versionId, questionId: questions[0].id });
  const beforeResult = await benchmark(parent.id);
  assert.equal(beforeResult.status, 'correct');
  const originalResults = (await state()).results;
  const paidCalls = readFileSync(calls, 'utf8');
  const start = { versionId: parent.id, revision: parent.revision };

  await refactor('start', { ...start, revision: 'no-longer-current' }, false);
  edit('docs/publishing.md', branchRule + '\nKeep the release tag.');
  const drift = await refactor('start', start);
  assert.equal(drift.refactor, null);
  assert.deepEqual(drift.changes.map(f => f.path), ['docs/publishing.md']);
  assert.equal((await state()).refactor, null);
  const accepted = await refactor('start', { ...start, acceptRevision: drift.workingRevision });
  const refactorId = accepted.refactor.id;
  assert.equal(accepted.refactor.revision, parent.revision);
  const review = () => refactor('review', { refactorId });
  const save = (workingRevision, name, success) => refactor('save', { refactorId, workingRevision, name }, success);
  const noEdits = await review();
  assert.equal(noEdits.canSave, false);
  await save(noEdits.workingRevision, 'Accidental duplicate', false);
  await request('PUT', 'map-versions', { versionId: parent.id }, false);

  const exit = once(server, 'exit');
  server.kill('SIGTERM');
  await exit;
  await launch();
  assert.equal((await state()).refactor.id, refactorId);
  edit('CLAUDE.md', changedEntry);
  renameSync(path.join(root, 'docs/old-guide.md'), path.join(root, 'docs/release-checklist.md'));
  edit('docs/release-checklist.md', 'Read the publishing guide before you tag a release.');
  const reviewed = await review();
  assert.equal(reviewed.canSave, true);
  const changed = Object.fromEntries(reviewed.changes.map(f => [f.path, f]));
  assert.deepEqual(Object.keys(changed).sort(), ['CLAUDE.md', 'docs/old-guide.md', 'docs/publishing.md', 'docs/release-checklist.md']);
  assert.deepEqual([changed['CLAUDE.md'].before, changed['CLAUDE.md'].after], [originalEntry, changedEntry]);
  assert.equal(changed['docs/old-guide.md'].kind, 'removed');
  assert.equal(changed['docs/old-guide.md'].after, null);
  assert.equal(changed['docs/release-checklist.md'].kind, 'added');
  assert.equal(changed['docs/release-checklist.md'].before, null);
  assert.equal(changed['docs/publishing.md'].presentAtStart, true);

  edit('docs/release-checklist.md', 'Read the guide, then tag the release.');
  await save(reviewed.workingRevision, 'Handbook by task', false);
  const final = await review();
  await save(final.workingRevision, parent.name, false);
  assert.equal((await state()).versions.length, 1);
  const saved = await save(final.workingRevision, 'Handbook by task');
  const child = saved.versions.find(v => v.id === saved.createdVersionId);
  assert.ok(child);
  assert.equal(child.parentId, parent.id);
  assert.equal(child.parentRevision, parent.revision);
  assert.equal(child.revision, final.workingRevision);
  assert.equal(child.score, 0);
  assert.equal(child.shown, 'no-sessions');
  assert.equal(child.grades.missed, 0);
  assert.equal(child.scoreScope, parent.scoreScope);
  assert.equal(saved.refactor, null);
  assert.deepEqual(saved.versions.find(v => v.id === parent.id), parent);
  assert.deepEqual(saved.results, originalResults);
  assert.deepEqual(saved.questions, questions);
  const document = async versionId => (await fetch(base + '/p/' + key + '/maps/' + versionId + '?file=CLAUDE.md')).text();
  assert.ok((await document(parent.id)).includes(originalEntry));
  assert.ok((await document(child.id)).includes(changedEntry));
  const retry = await save(final.workingRevision, 'Handbook by task');
  assert.equal(retry.createdVersionId, child.id);
  await save(final.workingRevision, 'Second click', false);
  await request('PUT', 'map-versions', { versionId: parent.id }, false);
  await request('PUT', 'map-versions', { versionId: child.id }, false);
  assert.equal((await state()).versions.length, 2);
  assert.equal(readFileSync(calls, 'utf8'), paidCalls, 'Refactoring in the dashboard never started the model');
  const afterResult = await benchmark(child.id);
  assert.deepEqual([beforeResult.status, afterResult.status, beforeResult.lookups, afterResult.lookups], ['correct', 'correct', 2, 1]);
  const next = await refactor('start', { versionId: child.id, revision: child.revision });
  await refactor('cancel', { refactorId: next.refactor.id });
  const comparison = await state();
  assert.equal(comparison.refactor, null);
  assert.equal(comparison.versions.length, 2);
  assert.deepEqual(comparison.results.map(r => r.versionId), [parent.id, child.id]);

  // Replace the working files and the project's last report. The two saved
  // reports must still show their own navigation and the original session evidence.
  edit('CLAUDE.md', 'See a [later guide](docs/afterwards.md).');
  edit('docs/afterwards.md', 'Written after both versions were saved.');
  writeFileSync(path.join(project, 'report.json'), JSON.stringify({ ...report, sessions: { list: [], skipped: [] } }));
  const reportUrl = (v, query = '') => base + '/p/' + key + '/maps/' + v.id + '/report.html' + query;
  const loadReport = async (version, query) => {
    const response = await fetch(reportUrl(version, query));
    const html = await response.text();
    assert.equal(response.status, 200, html.slice(0, 300));
    assert.match(response.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.ok(html.includes(version.name));
    assert.match(html, /id="health"/);
    assert.match(html, /id="switch"/);
    assert.match(html, /id="mapcard"/);
    const data = JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.health.v1.score, version.score);
    assert.equal(data.sessions.length, 5, 'Sessions were frozen before the project report changed');
    assert.ok(data.groups.some(g => g.label === 'Publish a release'));
    assert.ok(!data.map.nodes.some(n => n.id === 'docs/afterwards.md'));
    return { html, data };
  };
  const [oldReport, newReport] = await Promise.all([loadReport(parent, '?view=explorer'), loadReport(child, '?view=full')]);
  assert.match(oldReport.html, /id="explorer-embed"/);
  assert.doesNotMatch(newReport.html, /id="explorer-embed"/);
  const exploration = oldReport.data.sessions.find(s => s.id === recordedId).exploration;
  assert.ok(exploration.opened.includes('docs/publishing.md'));
  assert.ok(!exploration.opened.includes('docs/listed.md'));
  assert.ok(!exploration.opened.includes('docs/matched.md'));
  const lookups = exploration.lookups.filter(event => event.target === 'docs');
  assert.ok(lookups.some(event => event.operation === 'list' && event.resultPaths.includes('docs/listed.md')));
  assert.ok(lookups.some(event => event.operation === 'search' && event.resultPaths.includes('docs/matched.md')));
  assert.equal(lookups.filter(event => event.outcome === 'empty').length, 1, 'A failed search cannot be counted as a search with no matches');
  assert.deepEqual(newReport.data.sessions.find(s => s.id === recordedId).exploration, exploration);
  for (const { html } of [oldReport, newReport]) {
    assert.ok(!html.includes('private-log.md'));
    assert.ok(!html.includes(privateText));
    assert.ok(!html.includes('Permission denied'));
  }
  for (const [view, present, absent] of [
    [oldReport, 'docs/old-guide.md', 'docs/release-checklist.md'],
    [newReport, 'docs/release-checklist.md', 'docs/old-guide.md']
  ]) {
    const dom = new JSDOM(view.html, { runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      const doc = dom.window.document;
      dom.window.eval(doc.querySelector('#page-data + script').textContent);
      assert.ok(doc.querySelector(`#map g[data-id="${present}"]`), 'The saved file appears on the graph when it opens');
      assert.equal(doc.querySelector(`#map g[data-id="${absent}"]`), null);
      const node = id => doc.querySelector(`#map g[data-id="${id}"]`);
      assert.equal(node('folder:docs').dataset.kind, 'folder');
      assert.equal(doc.querySelector('.lookup-line, .reference-line'), null, 'Lines stay hidden until selection');
      const openedFiles = doc.querySelector('#opened-files');
      const exploredFolders = doc.querySelector('#explored-folders');
      openedFiles.click();
      assert.ok(node('docs/publishing.md') && node('CLAUDE.md'), 'The version overview uses all its recorded sessions');
      assert.equal(node('docs/matched.md'), null);
      doc.querySelector('#list button[data-s="s1"]').click();
      assert.equal(doc.querySelector('#map [data-kind="file"]'), null, 'A new session never inherits prior reads');
      assert.match(doc.querySelector('#map-status').textContent, /recorded/i);
      doc.querySelector('#list .back').click();
      doc.querySelector(`#list button[data-s="${recordedId}"]`).click();
      assert.equal(openedFiles.getAttribute('aria-pressed'), 'true');
      exploredFolders.click();
      assert.ok(node('docs/publishing.md') && node('folder:docs'));
      assert.equal(node('docs/listed.md'), null);
      openedFiles.click();
      assert.equal(doc.querySelector('#map [data-kind="file"]'), null);
      assert.ok(node('folder:docs'));
      assert.equal(node('folder:.'), null, 'A file read or failed search does not qualify its parent folder');
      exploredFolders.click();
      assert.ok(node('docs/listed.md'), 'Releasing both toggles restores the version map');
      assert.match(node('folder:docs').dataset.activity, /listed/);
      assert.match(node('folder:docs').dataset.activity, /searched/);
      assert.equal(node('folder:docs').dataset.emptySearches, '1');
      assert.equal(node('docs/publishing.md').dataset.activity, 'opened');
      assert.equal(node('docs/listed.md').dataset.activity, 'listed');
      assert.equal(node('docs/matched.md').dataset.activity, 'matched');
      assert.equal(doc.querySelector('.lookup-line, .reference-line'), null, 'Session selection highlights activity without drawing lines');
      node('docs/publishing.md').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.ok(doc.querySelector('.lookup-line[data-from="folder:docs"][data-to="docs/publishing.md"]'));
      const reference = doc.querySelector('.reference-line[data-from="CLAUDE.md"][data-to="docs/publishing.md"]');
      assert.equal(Boolean(reference), view === newReport, 'A reference comes from the selected version files');
      doc.querySelector('#switch [data-v="intents"]').click();
      assert.ok(doc.querySelector('#list').textContent.includes('Publish a release'));
      assert.equal(doc.querySelector('button[data-report-action]'), null);
    } finally { dom.window.close(); }
  }
  const guide = 'docs/publishing.md';
  const direct = d => d.map.edges.some(e => e.from === 'CLAUDE.md' && e.to === guide);
  assert.equal(direct(oldReport.data), false);
  assert.equal(direct(newReport.data), true);
  assert.equal((await fetch(reportUrl(parent, '?revision=' + child.revision))).status, 409);
  assert.equal((await fetch(reportUrl({ id: 'missing-version' }))).status, 404);
  const again = await loadReport(child, '?view=explorer');
  assert.deepEqual(again.data, newReport.data);

  const artifact = path.join(repo, 'out/e2e-context-refactor');
  mkdirSync(artifact, { recursive: true });
  writeFileSync(path.join(artifact, 'starting-report.html'), oldReport.html);
  writeFileSync(path.join(artifact, 'refactored-report.html'), newReport.html);
  writeFileSync(path.join(artifact, 'comparison.json'), JSON.stringify({
    source: 'Temporary handbook and offline model fixture', parent, child, questions,
    reviewedFiles: final.changes, exploration, beforeResult, afterResult
  }, null, 2));
});
