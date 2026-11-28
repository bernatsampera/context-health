// Exercise the dashboard from an existing v1 database. A review must use the
// saved files, stale or mixed selections must create nothing, and a child must
// retain its own text, score and benchmark runs when the project changes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { projectKey } from '../src/data-folder.mjs';

test('Investigate a saved map, choose its fix and benchmark the child independently', { timeout: 45000 }, async (t) => {
  const repo = path.resolve(import.meta.dirname, '..');
  const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-child-'));
  const root = path.join(work, 'handbook'),
    home = path.join(work, 'data');
  const key = projectKey(root),
    dir = path.join(home, key),
    guide = 'docs/publishing.md';
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(path.join(dir, 'map-versions'), { recursive: true });
  const originalText = 'Read the project guides.';
  const snapshot = JSON.stringify({
    files: [
      { path: 'CLAUDE.md', text: originalText },
      { path: guide, text: 'Publish from the stable branch.' }
    ],
    entries: ['CLAUDE.md'],
    links: []
  });
  const revision = createHash('sha256').update(snapshot).digest('hex');
  writeFileSync(path.join(root, 'CLAUDE.md'), originalText);
  writeFileSync(path.join(root, guide), 'Publish from the preview branch.');
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ root }));
  const sessions = Array.from({ length: 5 }, (_, i) => ({ sessionId: 's' + i, status: 'ok', intents: [{ id: 'i1' }] }));
  const model = {
    project: { root },
    startLoad: [{ path: 'CLAUDE.md', scope: 'project', what: 'instructions', tokens: 6 }],
    later: [],
    intents: { sessions },
    sessions: { list: sessions.map((s) => ({ sessionId: s.sessionId, events: [], messages: [] })), skipped: [] },
    routes: {
      intents: sessions.map(() => ({
        needs: Array.from({ length: 4 }, () => ({ path: guide, state: 'search', route: [{ how: 'search' }] }))
      }))
    },
    needs: { sessions: [] },
    health: { v1: { method: 'v3', shown: 'score', proof: { status: 'pass' } } }
  };
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(model));
  const db = new DatabaseSync(path.join(dir, 'map-versions/versions.sqlite'));
  db.exec(`CREATE TABLE versions(id TEXT PRIMARY KEY,name TEXT,nameKey TEXT UNIQUE,createdAt TEXT,updatedAt TEXT,revision TEXT,fileCount INTEGER,snapshot TEXT);
    CREATE TABLE questions(id TEXT PRIMARY KEY,question TEXT,questionKey TEXT UNIQUE,expected TEXT);
    CREATE TABLE results(versionId TEXT REFERENCES versions(id),questionId TEXT REFERENCES questions(id),data TEXT,PRIMARY KEY(versionId,questionId));
    PRAGMA user_version=1;`);
  db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)').run(
    'original',
    'Original',
    'original',
    '2026-01-01',
    '2026-01-01',
    revision,
    2,
    snapshot
  );
  db.close();
  const server = spawn(process.execPath, ['bin/context-health.mjs', 'ui', '--no-open', '--port', '0'], {
    cwd: repo,
    env: { ...process.env, CONTEXT_HEALTH_HOME: home, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => server.kill('SIGTERM'));
  let base;
  for await (const line of createInterface({ input: server.stdout })) {
    base = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (base) break;
  }
  assert.ok(base);
  const token = (await (await fetch(base)).text()).match(/name="token" content="([^"]+)"/)[1];
  const request = async (method, route, body, success = true) => {
    const response = await fetch(base + '/api/projects/' + key + '/' + route, {
      method,
      headers: { 'content-type': 'application/json', 'x-context-health-token': token },
      body: body && JSON.stringify(body)
    });
    const answer = await response.json();
    assert.equal(response.ok, success, JSON.stringify(answer));
    return answer;
  };
  const baseline = (await request('GET', 'map-versions')).versions[0];
  assert.equal(baseline.score, 50, 'existing map gets its calculated score on first open');
  assert.equal(baseline.revision, revision, 'legacy migration retains saved bytes');
  const inspect = (id, includeProposals) => request('POST', 'map-investigate', { versionId: id, includeProposals });
  const first = await inspect('original', false);
  assert.ok(first.struggles.some((s) => s.source === guide));
  assert.equal(first.proposals.length, 0);
  assert.equal(first.score, 50);
  const evidence = await inspect('original', true);
  const proposal = evidence.proposals.find((p) => p.after.includes(guide));
  assert.ok(proposal);
  const create = (ids, valid = true, rev = revision) =>
    request('POST', 'map-child', { name: 'Linked guides', versionId: 'original', revision: rev, proposalIds: ids }, valid);
  await create([proposal.id, 'stale edit'], false);
  await create([proposal.id], false, 'wrong revision');
  assert.equal((await request('GET', 'map-versions')).versions.length, 1);
  const made = await create([proposal.id]),
    child = made.versions.find((v) => v.id === made.createdVersionId);
  assert.equal(child.parentId, 'original');
  assert.equal(child.appliedFixes[0].after, proposal.after);
  assert.equal(child.score, 0);
  assert.equal(child.shown, 'no-sessions');
  assert.equal(child.grades.missed, 0);
  assert.equal((await inspect(child.id, true)).proposals.length, 0);
  assert.equal(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), originalText);
  const savedText = async (id) => await (await fetch(base + '/p/' + key + '/maps/' + id + '?file=CLAUDE.md')).text();
  assert.doesNotMatch(await savedText('original'), /docs\/publishing.md/);
  assert.match(await savedText(child.id), /docs\/publishing.md/);
  for (const version of [baseline, child]) {
    const response = await fetch(base + '/p/' + key + '/maps/' + version.id + '/report.html');
    const html = await response.text();
    assert.equal(response.status, 200, html.slice(0, 200));
    const page = JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
    assert.equal(page.health.v1.score, version.score);
    assert.equal(page.map.edges.some(e => e.from === 'CLAUDE.md' && e.to === guide), version.id === child.id);
  }
  const {
    questions: [question]
  } = await request('POST', 'map-questions', { question: 'Which branch do we publish from?', expected: 'stable branch' });
  const run = (id) => request('POST', 'map-benchmark', { versionId: id, questionId: question.id });
  const before = await run('original'),
    after = await run(child.id);
  assert.deepEqual([before.status, after.status, before.lookups, after.lookups], ['correct', 'correct', 2, 1]);
  const captured = await request('POST', 'map-versions', { name: 'Project files' });
  assert.equal(captured.versions.at(-1).score, 50, 'fresh capture binds reports written with a symlinked project path');
  const recaptured = await request('PUT', 'map-versions', { versionId: child.id });
  const replaced = recaptured.versions.find((v) => v.id === child.id);
  assert.equal(replaced.parentId, 'original');
  assert.deepEqual(replaced.appliedFixes, []);
  assert.deepEqual(
    recaptured.results.map((r) => r.versionId),
    ['original']
  );
  assert.equal(replaced.score, 50);
  const pending = { ...model, routes: { intents: [] }, intents: { sessions: [] } };
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(pending));
  const unanalysed = (await request('POST', 'map-versions', { name: 'Awaiting analysis' })).versions.at(-1);
  assert.equal(unanalysed.score, null);
  assert.notEqual(unanalysed.shown, 'no-sessions');
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ ...pending, sessions: { list: [], skipped: [] } }));
  const empty = (await request('POST', 'map-versions', { name: 'No sessions yet' })).versions.at(-1);
  assert.equal(empty.score, 0);
  assert.equal(empty.shown, 'no-sessions');
  assert.ok(empty.scoreScope);
  assert.equal((await inspect(empty.id, false)).shown, 'no-sessions');
  const emptyReport = await fetch(base + '/p/' + key + '/maps/' + empty.id + '/report.html');
  assert.equal(emptyReport.status, 200);
  assert.match(await emptyReport.text(), /No sessions run on this version/);
  const artifact = path.join(repo, 'out', 'e2e-version-proposals');
  mkdirSync(artifact, { recursive: true });
  writeFileSync(
    path.join(artifact, 'comparison.json'),
    JSON.stringify({ source: 'Controlled E2E report and model', evidence, child, before, after, empty, unanalysed }, null, 2)
  );
});
