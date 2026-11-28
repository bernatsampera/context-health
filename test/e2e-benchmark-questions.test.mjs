// Failure cases for the whole flow: generation leaks unrelated session data,
// accepts invented evidence, repeats a question, runs it without asking, or
// credits an answer whose source was never read. Keep the server response as proof.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const repo = path.resolve(import.meta.dirname, '..');

test('Generate sourced questions for recorded intents, then inspect the answers and their citations', { timeout: 45000 }, async t => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-questions-'));
  const root = path.join(work, 'handbook');
  const data = path.join(work, 'data');
  const claudeHome = path.join(work, 'claude');
  const calls = path.join(work, 'calls.jsonl');
  const control = path.join(work, 'fixture-settings.json');
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(claudeHome);
  writeFileSync(path.join(root, 'CLAUDE.md'), 'For shipping changes see [the release guide](docs/publishing.md).');
  writeFileSync(path.join(root, 'docs/publishing.md'), 'Publish from the stable branch.');
  writeFileSync(path.join(root, 'docs/support.md'), 'Contact the help desk by phone.');
  const child = spawn(process.execPath, ['bin/context-health.mjs', 'ui', '--no-open', '--port', '0', '--claude-settings-home', claudeHome], {
    cwd: repo, env: { ...process.env, CONTEXT_HEALTH_HOME: data, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
      CONTEXT_HEALTH_FAKE_LOG: calls, CONTEXT_HEALTH_FAKE_CONTROL: control }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill('SIGTERM'));
  let base;
  for await (const line of createInterface({ input: child.stdout })) {
    base = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (base) break;
  }
  assert.ok(base);
  const token = (await (await fetch(base)).text()).match(/name="token" content="([^"]+)"/)[1];
  async function api(method, route, body, expectedStatus = 200) {
    const response = await fetch(base + '/api' + route, {
      method, headers: { 'x-context-health-token': token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(payload));
    return payload;
  }
  const { key } = await api('POST', '/projects', { root });
  const prefix = '/projects/' + key;
  while ((await api('GET', '/projects')).projects[0].run?.status === 'running') await delay(15);
  // The project report comes from the CLI. Supply controlled historical intents
  // at the report boundary so the test does not need a user's Claude archive.
  const reportFile = path.join(data, key, 'report.json');
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  report.groups = { list: [
    { id: 'g1', label: 'Ship a release', members: [{ sessionId: 'sample', intentId: 'i1' }] },
    { id: 'g2', label: 'Answer support requests', members: [{ sessionId: 'sample', intentId: 'i2' }] }
  ] };
  report.needs = { sessions: [{ sessionId: 'sample', intents: [
    { intentId: 'i1', needs: [{ kind: 'file', scope: 'project', path: 'docs/publishing.md' }] },
    { intentId: 'i2', needs: [{ kind: 'file', scope: 'project', path: 'docs/support.md' }] }
  ] }] };
  report.sessions.privateTestMarker = 'private session text never needed for generation';
  writeFileSync(reportFile, JSON.stringify(report));
  // A passive subscriber only learns to refetch. Details need the local token.
  const subscribe = async () => {
    const abort = new AbortController();
    const stream = await fetch(base + '/api/events', { signal: abort.signal });
    const reader = stream.body.getReader();
    await reader.read(); // initial ready comment
    t.after(() => abort.abort());
    return { abort, reader };
  };
  const observer = await subscribe();
  const latest = async () => (await api('GET', '/activity')).activities[key];
  assert.equal((await fetch(base + '/api/activity')).status, 403);
  assert.equal((await fetch(base + '/api' + prefix)).status, 403);
  const creating = api('POST', prefix + '/map-versions', { name: 'Original' });
  const eventText = new TextDecoder().decode((await observer.reader.read()).value);
  assert.ok(eventText.includes('data: '));
  for (const line of eventText.split('\n').filter(line => line.startsWith('data: '))) {
    assert.deepEqual(JSON.parse(line.slice(6)), { type: 'activity' });
  }
  const local = await latest();
  assert.equal(local.kind, 'capture');
  assert.equal(local.canStop, false);
  assert.equal(local.model, null);
  const created = await creating;
  assert.equal(created.activity.id, local.id);
  assert.equal(created.activity.status, 'done');
  assert.equal(created.activity.stage, 'finished');
  const [version] = created.versions;
  const { id: intentId } = created.intents.find(intent => intent.label === 'Ship a release');
  // The same selected intent must follow its evidence when its rank changes.
  report.groups.list.reverse().forEach((group, index) => { group.id = 'g' + (index + 1); });
  for (const label of ['Route a support request', 'Follow up on a request', 'Escalate a support request']) {
    report.groups.list.push({ id: 'g' + (report.groups.list.length + 1), label, members: [{ sessionId: 'sample', intentId: 'i2' }] });
  }
  writeFileSync(reportFile, JSON.stringify(report));
  const workspace = () => api('GET', prefix + '/map-versions');
  const allIntents = (await workspace()).intents.map(intent => intent.id);
  const generate = (intentIds, expectedStatus) => api('POST', prefix + '/map-questions/generate', { versionId: version.id, intentIds }, expectedStatus);
  const delayedIntent = allIntents.at(-1);
  writeFileSync(control, JSON.stringify({ pauseIntent: delayedIntent }));
  const pending = generate(allIntents, 409);
  // The final intent has its own batch. Seeing its call proves a valid candidate
  // was already returned by the first batch when the user pressed Stop.
  function reachedLastBatch() {
    if (!existsSync(calls)) return false;
    return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).some(line => {
      const batch = JSON.parse(JSON.parse(line).stdin).intents;
      return batch?.length === 1 && batch[0].id === delayedIntent;
    });
  }
  const waitUntil = Date.now() + 6000;
  while (!reachedLastBatch() && Date.now() < waitUntil) await delay(10);
  assert.ok(reachedLastBatch(), 'the fixture reached the last batch');
  const paused = await workspace();
  assert.equal(paused.running.kind, 'generate');
  assert.equal(paused.activity.stage, 'model');
  assert.equal(paused.activity.model, 'sonnet');
  assert.equal(paused.activity.activeCalls, 1);
  assert.equal(paused.activity.unit, 'intents');
  assert.equal(paused.activity.done, 4);
  assert.equal(paused.activity.total, 5);
  assert.equal(paused.activity.canStop, true);
  // A newly opened project, another tab looking at all projects and a
  // reconnecting observer receive the same in-flight job without starting it.
  observer.abort.abort();
  const second = await subscribe();
  assert.deepEqual((await api('GET', prefix)).activity, paused.activity);
  assert.deepEqual((await api('GET', '/projects')).projects.find(p => p.key === key).activity, paused.activity);
  assert.deepEqual(await latest(), paused.activity);
  assert.deepEqual(paused.questions, []);
  const conflict = await api('POST', prefix + '/map-questions', { question: 'Conflicting write?', expected: 'no' }, 409);
  assert.match(conflict.error, /run is in progress/i);
  await api('POST', prefix + '/stop', { activityId: local.id }, 409);
  assert.equal((await latest()).status, 'running');
  await api('POST', prefix + '/stop', { activityId: paused.activity.id });
  const stopped = await pending;
  assert.match(stopped.error, /stopped/i);
  const rolledBack = await workspace();
  assert.equal(rolledBack.running, null);
  assert.equal(rolledBack.activity.id, paused.activity.id);
  assert.equal(rolledBack.activity.status, 'stopped');
  assert.equal(rolledBack.activity.stage, 'finished');
  const stoppedEvent = new TextDecoder().decode((await second.reader.read()).value);
  assert.doesNotMatch(stoppedEvent, /Original|release|handbook|question|error|sonnet|intent-/);
  assert.deepEqual(rolledBack.questions, []);
  writeFileSync(control, '{}');
  const state = await generate(allIntents);
  assert.equal(state.addedCount, 1);
  assert.equal(state.results.length, 0);
  const [question] = state.questions;
  assert.equal(question.intentId, intentId);
  assert.equal(question.intentLabel, 'Ship a release');
  assert.equal(question.source, 'docs/publishing.md');
  assert.equal(question.expected, 'stable branch');
  assert.equal((await generate([intentId])).addedCount, 0);
  const lastRequest = JSON.parse(readFileSync(calls, 'utf8').trim().split('\n').at(-1)).stdin;
  assert.doesNotMatch(lastRequest, /private session text|Contact the help desk/);
  const run = questionId => api('POST', prefix + '/map-benchmark', { versionId: version.id, questionId });
  const proven = await run(question.id);
  const gradedJob = await latest();
  assert.equal(gradedJob.kind, 'benchmark');
  assert.equal(gradedJob.question, question.question);
  assert.equal(gradedJob.versionId, version.id);
  assert.equal(gradedJob.versionName, version.name);
  assert.equal(gradedJob.model, 'fixture-sonnet');
  assert.equal(gradedJob.done, 2);
  assert.equal(gradedJob.total, null);
  assert.equal(gradedJob.unit, 'calls');
  assert.equal(proven.status, 'correct');
  assert.deepEqual([proven.evidence.phraseMatched, proven.evidence.quoteMatched, proven.evidence.sourceRead], [true, true, true]);
  assert.equal(proven.evidence.excerpt.text, 'Publish from the stable branch.');
  assert.equal(proven.evidence.excerpt.path, question.source);
  writeFileSync(control, JSON.stringify({ failBenchmark: true }));
  const failedRerun = await api('POST', prefix + '/map-benchmark', { versionId: version.id, questionId: question.id, rerun: true });
  assert.equal(failedRerun.status, 'error');
  assert.equal((await latest()).status, 'failed');
  const retained = await run(question.id);
  assert.equal(retained.status, 'correct');
  assert.equal(retained.measuredAt, proven.measuredAt);
  assert.deepEqual(retained.evidence, proven.evidence);
  writeFileSync(control, '{}');
  const manualState = await api('POST', prefix + '/map-questions', { question: 'Fixture: cite an unread source', expected: 'stable branch' });
  const invented = await run(manualState.questions.at(-1).id);
  assert.equal(invented.status, 'incorrect');
  assert.deepEqual([invented.evidence.phraseMatched, invented.evidence.quoteMatched, invented.evidence.sourceRead], [true, false, false]);
  assert.equal(invented.evidence.excerpt, null);
  const artifact = path.join(repo, 'out', 'e2e-benchmark-questions');
  mkdirSync(artifact, { recursive: true });
  writeFileSync(path.join(artifact, 'evidence.json'), JSON.stringify({ engine: 'Offline Claude fixture', question, proven, invented,
    activity: { local, inProgress: paused.activity, stopped: rolledBack.activity, finished: gradedJob },
    recovery: { conflict: conflict.error, stopped: stopped.error, questionsAfterStop: rolledBack.questions.length,
      questionsAddedOnRetry: state.addedCount, failedRerun: failedRerun.error, retainedMeasurement: retained.measuredAt } }, null, 2));
});
