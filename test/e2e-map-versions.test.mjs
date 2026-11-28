// Exercise the dashboard API on two versions of a temporary project.
// Failure cases: a refresh creates a version, the runner sees live files instead
// of the saved map, stale answers survive edits, or a comparison pays twice.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const repo = path.resolve(import.meta.dirname, '..');

test('Compare saved maps using the same questions, then revise one version', { timeout: 45000 }, async t => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-versions-'));
  const root = path.join(work, 'handbook');
  const claudeHome = path.join(work, 'claude');
  const log = path.join(work, 'calls.jsonl');
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(claudeHome);
  const guide = path.join(root, 'docs/publishing.md');
  writeFileSync(guide, 'Publish from the stable branch.');
  writeFileSync(path.join(root, 'CLAUDE.md'), 'Read the project guides.');
  const server = spawn(process.execPath, ['bin/context-health.mjs', 'ui', '--no-open', '--port', '0', '--claude-settings-home', claudeHome], {
    cwd: repo, env: { ...process.env, CONTEXT_HEALTH_HOME: path.join(work, 'data'),
      CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CONTEXT_HEALTH_FAKE_LOG: log }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => server.kill('SIGTERM'));
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: server.stdout });
  let base;
  for await (const line of lines) {
    base = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (base) break;
  }
  assert.ok(base, stderr);
  const shell = await (await fetch(base)).text();
  const token = shell.match(/name="token" content="([^"]+)"/)[1];
  const api = async (method, url, body) => {
    const response = await fetch(base + '/api' + url, { method, headers: { 'x-context-health-token': token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  const project = await api('POST', '/projects', { root });
  const endpoint = '/projects/' + project.key;
  while ((await api('GET', '/projects')).projects[0]?.run?.status === 'running') await delay(20);
  const state = () => api('GET', endpoint + '/map-versions');
  const version = name => api('POST', endpoint + '/map-versions', { name });
  const edit = versionId => api('PUT', endpoint + '/map-versions', { versionId });
  const run = (v, q) => api('POST', endpoint + '/map-benchmark', { versionId: v.id, questionId: q.id });
  assert.equal((await state()).versions.length, 0);

  const [original] = (await version('Original')).versions;
  const [question] = (await api('POST', endpoint + '/map-questions', {
    question: 'Which branch do we publish from?', expected: 'stable branch'
  })).questions;
  writeFileSync(path.join(root, 'CLAUDE.md'), 'For releases, read [Publishing](docs/publishing.md).');
  assert.equal((await state()).versions.length, 1);
  const [, revised] = (await version('Linked guides')).versions;
  writeFileSync(guide, 'Publish from the preview branch.');
  const before = await run(original, question);
  const after = await run(revised, question);
  assert.deepEqual([before.status, after.status], ['correct', 'correct']);
  assert.deepEqual([before.lookups, after.lookups], [2, 1]);
  for (const result of [before, after]) {
    assert.equal(result.source, 'docs/publishing.md');
    assert.ok(result.elapsedMs > 0);
    assert.equal(result.resolvedModel, 'fixture-sonnet');
  }
  const calls = readFileSync(log, 'utf8');
  assert.equal(await run(revised, question).then(r => r.elapsedMs), after.elapsedMs);
  assert.equal(readFileSync(log, 'utf8'), calls, 'reopening a completed result makes no calls');
  for (const record of calls.trim().split('\n').map(JSON.parse)) {
    const prompt = JSON.parse(record.stdin);
    assert.ok(!Object.hasOwn(prompt, 'expected'));
    assert.ok(!record.stdin.includes('preview branch'), 'only the saved documents may be used');
  }
  const mapUrl = base + '/p/' + project.key + '/maps/' + revised.id;
  assert.match(await (await fetch(mapUrl)).text(), /Starting files/);
  const savedDoc = await (await fetch(mapUrl + '?file=docs%2Fpublishing.md')).text();
  assert.match(savedDoc, /stable branch/);
  assert.doesNotMatch(savedDoc, /preview branch/);
  const comparison = await state();
  const versionReport = mapUrl + '/report.html';
  const reportNodes = async url => {
    const response = await fetch(url);
    const html = await response.text();
    assert.equal(response.status, 200, html.slice(0, 200));
    return JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]).map.nodes;
  };
  assert.ok(!(await reportNodes(versionReport)).some(n => n.id === 'docs/checklist.md'));
  writeFileSync(path.join(root, 'docs/checklist.md'), 'Confirm the branch before shipping.');
  writeFileSync(path.join(root, 'CLAUDE.md'), 'Read [Publishing](docs/publishing.md) and the [checklist](docs/checklist.md).');
  const updated = await edit(revised.id);
  assert.equal(updated.versions.length, 2);
  assert.deepEqual(updated.results.map(r => r.versionId), [original.id]);
  assert.equal((await fetch(versionReport + '?revision=' + revised.revision)).status, 409);
  assert.ok((await reportNodes(versionReport)).some(n => n.id === 'docs/checklist.md' && n.steps === 1));
  const changed = await run(revised, question);
  assert.equal(changed.status, 'incorrect');
  assert.match(changed.answer, /preview branch/);
  assert.equal((await edit(revised.id)).results.length, 2, 'unchanged version retains results');
  const corrected = await api('PUT', endpoint + '/map-questions', {
    questionId: question.id, question: question.question, expected: 'preview branch'
  });
  assert.deepEqual(corrected.results, []);
  assert.equal((await run(original, question)).status, 'incorrect');
  assert.equal((await run(revised, question)).status, 'correct');
  const callsBeforeRetry = readFileSync(log, 'utf8').length;
  const rerun = await api('POST', endpoint + '/map-benchmark', { versionId: original.id, questionId: question.id, rerun: true });
  assert.equal(rerun.status, 'incorrect');
  assert.ok(readFileSync(log, 'utf8').length > callsBeforeRetry, 'an explicit rerun measures a fresh answer');
  const removed = await api('DELETE', endpoint + '/map-questions', { questionId: question.id });
  assert.equal(removed.questions.length, 0);
  assert.equal(removed.results.length, 0, 'removing the shared question clears results for every version');
  assert.equal(removed.versions.length, 2);

  const artifacts = path.join(repo, 'out', 'e2e-map-versions');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(path.join(artifacts, 'comparison.json'), JSON.stringify({ runner: 'Offline Claude fixture', comparison, revisedResult: changed }, null, 2));
  writeFileSync(path.join(artifacts, 'saved-guide.html'), savedDoc);
});
