// E2E for step 4 (intents): run the real command on a git copy of fixtures/indoeuromap, with a copy of
// fixtures/claude-settings-home plus 5 sessions that this file writes, and the fake claude binary test/fake-claude.mjs.
// No real model call. The ways it can fail (I1 to I16) are in the step 4 failure list. Each test names its cases.
// Artifact: out/e2e-intents/report.json and report.html (same content on every run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withoutRunFolders } from './report-html.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fake = path.join(repo, 'test', 'fake-claude.mjs');
const prompt = readFileSync(path.join(repo, 'src', 'prompts', 'intents-v2.md'), 'utf8');
const OLD = '/Users/example/projects/indoeuromap';
const MAIN = '-Users-example-projects-indoeuromap';
const id = digit => `${digit.repeat(8)}-0000-0000-0000-000000000000`;
const [A, B, C, D] = ['1', '2', '3', '4'].map(id);
const G9 = '90000009-0000-0000-0000-000000000000';
const GL = '90000001-0000-0000-0000-000000000000';
const GT = '90000002-0000-0000-0000-000000000000';
const GB = '90000003-0000-0000-0000-000000000000';
const GE = '90000004-0000-0000-0000-000000000000';

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-intents-'));
const project = path.join(work, 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
git('init', '-q');
git('add', '-A');
const statusBefore = git('status', '--porcelain', '--untracked-files=all', '--ignored');

// The settings home copy: the fixture sessions plus 5 written here (newer than all fixture sessions).
const settings = path.join(work, 'claude-settings-home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), settings, { recursive: true });
const sessionDir = path.join(settings, 'projects', MAIN);

function writeSession(sessionId, start, items) {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [];
  for (const item of items) {
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    if (item.tool != null) {
      const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
      records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test',
        content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: 'echo done' } }], usage } }));
      records.push(rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content: item.tool }] } }));
    }
    if (item.side != null) records.push(rec({ type: 'user', isSidechain: true, message: { role: 'user', content: item.side } }));
  }
  writeFileSync(path.join(sessionDir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

const longAgent = `agent-long-text ${'y'.repeat(1000)}`;
writeSession(G9, '2026-11-16T10:00:00.000Z', [
  { user: 'Plan the area pages for Madrid, Barcelona and Valencia.' }, { agent: 'I plan the pages with the old layout.' },
  { user: 'No, we use LayoutV2 for all pages.\n<system-reminder>marker-reminder-k2</system-reminder>' }, { agent: longAgent },
  { tool: 'marker-tool-k3' },
  { user: 'Good. Now the first page.' }, { agent: 'Which page first?' },
  { user: 'Build the Madrid area page.' }, { side: 'marker-side-k4' }, { agent: 'Built.' },
  { user: 'Add the district list.' }, { agent: 'Added.' },
  { user: 'Make the map darker.' }, { agent: 'Done.' },
  { user: 'Add a legend.' }, { agent: 'Done.' },
  { user: 'It is broken on my phone.' }, { agent: 'Fixed.' },
  { user: 'Thanks, that works.' }
]);
writeSession(GL, '2026-11-15T10:00:00.000Z', Array.from({ length: 300 }, (_, k) =>
  ({ user: k === 149 ? `long-start ${'L'.repeat(50000 - 20)} long-end` : `Small step ${k + 1}.`, agent: 'ok' })));
writeSession(GT, '2026-11-14T10:00:00.000Z', Array.from({ length: 150 }, (_, k) => ({ user: `T${k + 1} `.padEnd(2000, 't'), agent: 'ok' })));
writeSession(GB, '2026-11-13T10:00:00.000Z', [{ user: 'First message of GB.' }, { agent: 'ok' }, { user: 'Second message of GB.' }]);
writeSession(GE, '2026-11-12T10:00:00.000Z', [{ user: 'First message of GE.' }, { agent: 'ok' }, { user: 'Second message of GE.' }]);

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const cacheA = path.join(work, 'cache-a');
const cacheB = path.join(work, 'cache-b');
// Only the intents calls. Step 5 adds needs-check calls for sessions with a missing-context correction.
const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  .filter(call => call.stdin.startsWith('context-health intents '));
const sessionOf = call => call.stdin.split('\n', 1)[0].split(' ').at(-1);

function run({ out, cache = cacheA, intents = true, sessions = null, bin = fake }) {
  const args = [cli, project, '--claude-settings-home', settings, '--old-path', OLD, '--out', out, '--cache', cache, '--no-open', '--verbose', '--ignore', 'none', '--no-save'];
  if (intents) args.push('--intents');
  if (sessions) args.push('--sessions', String(sessions));
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: bin, CONTEXT_HEALTH_FAKE_LOG: log } });
  const json = existsSync(path.join(out, 'report.json')) ? readFileSync(path.join(out, 'report.json'), 'utf8') : null;
  const html = existsSync(path.join(out, 'report.html')) ? readFileSync(path.join(out, 'report.html'), 'utf8') : null;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json, html, report: json && JSON.parse(json) };
}
const byId = report => Object.fromEntries(report.intents.sessions.map(entry => [entry.sessionId, entry]));
// The JSON that the step 8 page embeds.
const pageData = page => JSON.parse(page.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);

// P0: no --intents, empty cache, --sessions 6.
const p0 = run({ out: path.join(work, 'p0'), intents: false, sessions: 6 });
const p0Calls = calls().length;
// P1 and P2: --intents two times with the same cache.
const p1 = run({ out: path.join(work, 'run-1') });
const p1Calls = calls();
const p1Cache = readdirSync(path.join(cacheA, 'intents')).sort();
const artifact = path.join(repo, 'out', 'e2e-intents');
mkdirSync(artifact, { recursive: true });
const p2 = run({ out: artifact });
const p2Calls = calls().slice(p1Calls.length);
// P3: no --intents, the same cache.
const p3Before = calls().length;
const p3 = run({ out: path.join(work, 'p3'), intents: false });
const p3Calls = calls().length - p3Before;
// P4: no claude binary, empty cache.
const p4Before = calls().length;
const p4 = run({ out: path.join(work, 'p4'), cache: cacheB, bin: path.join(work, 'no-such-claude') });
const p4Calls = calls().length - p4Before;
// P5: a cache folder inside the project.
const p5 = run({ out: path.join(work, 'p5'), cache: path.join(project, '.cache') });
const statusAfter = git('status', '--porcelain', '--untracked-files=all', '--ignored');
// P6: one more user message in session B.
appendFileSync(path.join(sessionDir, `${B}.jsonl`), `${JSON.stringify({ isSidechain: false, userType: 'external', cwd: OLD, sessionId: B,
  version: '2.1.300', gitBranch: 'main', entrypoint: 'cli', type: 'user', uuid: 'b-extra-1', timestamp: '2026-11-09T12:00:00.000Z',
  message: { role: 'user', content: 'One more question about the rule.' }, promptSource: 'typed', origin: { kind: 'human' } })}\n`);
const p6Before = calls().length;
const p6 = run({ out: path.join(work, 'p6') });
const p6Calls = calls().slice(p6Before);

const s1 = byId(p1.report);
const count = (list, sessionId) => list.filter(call => sessionOf(call) === sessionId).length;

test('I7, I13, I14: no --intents makes no call, the selection takes the 6 newest', () => {
  assert.equal(p0.status, 0, p0.stderr);
  assert.equal(p0Calls, 0);
  const report = p0.report;
  assert.deepEqual(Object.keys(report).slice(Object.keys(report).indexOf('sessions'), Object.keys(report).indexOf('sessions') + 2), ['sessions', 'intents']);
  const intents = report.intents;
  assert.deepEqual([intents.promptVersion, intents.model, intents.limit], ['intents-v2', 'sonnet', 6]);
  assert.deepEqual(intents.sessions.map(entry => [entry.sessionId, entry.status]), [
    [G9, 'not-analysed'], [GL, 'not-analysed'], [GT, 'too-long'], [GB, 'not-analysed'], [GE, 'not-analysed'],
    [D, 'single-message'], [C, 'not-analysed'], [B, 'not-selected'], [A, 'single-message']
  ]);
  assert.deepEqual(intents.sessions.map(entry => entry.sessionId), report.sessions.list.map(session => session.sessionId));
  assert.deepEqual(intents.totals, { sessions: 9, ok: 0, singleMessage: 2, notSelected: 1, notAnalysed: 5, failed: 0, tooLong: 1 });
  const b = byId(report)[B];
  assert.deepEqual(b, { sessionId: B, status: 'not-selected', reason: 'not in the newest 6 sessions with 2 or more user messages',
    messages: 2, costUsd: null, intents: [], notes: [] });
  assert.equal(byId(report)[C].reason, 'not analysed: run with --intents');
  assert.match(p0.stdout, /5 sessions are not analysed\. Run with --intents/);
  // Step 8 page: one Sessions row per session with its step 4 status, and the line to run --intents.
  const data0 = pageData(p0.html);
  assert.deepEqual(data0.sessions.map(item => [item.id, item.status]), intents.sessions.map(entry => [entry.sessionId, entry.status]));
  assert.match(p0.html, /data-state="not-analysed"><p>.*5 sessions ready to analyse/);
  assert.match(p0.html, /data-report-action="analyse">Analyse 5 sessions/);
});

test('I8: one-message sessions get no call', () => {
  for (const sessionId of [A, D]) {
    assert.equal(count(p1Calls, sessionId), 0);
    assert.deepEqual(s1[sessionId], { sessionId, status: 'single-message', reason: 'fewer than 2 user messages',
      messages: 1, costUsd: null, intents: [], notes: [] });
  }
});

test('I1, I5, I6: the code builds the ranges and checks the answer', () => {
  assert.deepEqual(s1[G9], {
    sessionId: G9, status: 'ok', reason: null, messages: 9, costUsd: 0.0444,
    intents: [
      { id: 'i1', goal: 'Plan the area pages', from: 1, to: 3, corrections: [
        { id: 'c1', message: 2, text: 'Area pages use LayoutV2', quote: 'we use LayoutV2 for all pages', cause: 'missing-context' }] },
      { id: 'i2', goal: 'Build the area page for Madrid', from: 4, to: 9, corrections: [
        { id: 'c2', message: 6, text: 'The user wants a darker map', quote: 'make the map darker', cause: 'changed-mind' },
        { id: 'c3', message: 8, text: 'The page broke on phones', quote: 'it is broken on my phone', cause: 'unclear' }] }
    ],
    notes: [
      'Dropped start 99: no such message',
      'Dropped start 4: a second intent starts there',
      'Changed cause "bug" to unclear at message 8',
      'Moved correction at message 6 to i2: the answer had it under the intent that starts at 1',
      'Dropped correction at message 50: no such message'
    ]
  });
  assert.deepEqual(s1[B].intents, [{ id: 'i1', goal: 'Know how the profile rule picks the groups of a city profile', from: 1, to: 2,
    corrections: [{ id: 'c1', message: 2, text: 'The current profile rule is in second-iteration/direction.md, not in pipeline/METHOD.md',
      quote: 'The current rule is in second-iteration/direction.md', cause: 'missing-context' }] }]);
  assert.deepEqual(s1[C].intents.map(intent => [intent.id, intent.from, intent.to, intent.corrections.map(item => `${item.id} ${item.message} ${item.cause}`)]),
    [['i1', 1, 5, ['c1 4 agent-error', 'c2 5 unclear']], ['i2', 6, 6, []]]);
  assert.deepEqual([s1[GL].status, s1[GL].messages, s1[GL].intents.map(intent => [intent.from, intent.to])], ['ok', 300, [[1, 300]]]);
  for (const entry of p1.report.intents.sessions.filter(item => item.status === 'ok')) {
    let next = 1;
    for (const intent of entry.intents) {
      assert.equal(intent.from, next, entry.sessionId);
      assert.ok(intent.to >= intent.from);
      next = intent.to + 1;
      for (const item of intent.corrections) assert.ok(item.message >= intent.from && item.message <= intent.to);
    }
    assert.equal(next, entry.messages + 1, entry.sessionId);
  }
});

test('I4: bad answers fail after 2 calls, are not cached, and do not stop the report', () => {
  assert.equal(p1.status, 0, p1.stderr);
  assert.deepEqual([s1[GB].status, s1[GB].reason, s1[GB].costUsd, s1[GB].intents], ['failed', 'bad answer: not JSON', null, []]);
  assert.deepEqual([s1[GE].status, s1[GE].reason], ['failed', 'claude exited with code 1']);
  assert.equal(count(p1Calls, GB), 2);
  assert.equal(count(p1Calls, GE), 2);
  assert.deepEqual(p1.report.intents.totals, { sessions: 9, ok: 4, singleMessage: 2, notSelected: 0, notAnalysed: 0, failed: 2, tooLong: 1 });
  const files = p1Cache;
  assert.deepEqual(files.map(name => name.split('.')[0]), [B, C, GL, G9].sort());
  for (const name of files) assert.match(name, /^[0-9a-f-]{36}\.[0-9a-f]{64}\.json$/);
});

test('I2: a second run uses the cache and gives the same report', () => {
  assert.equal(p1Calls.length, 4 + 2 + 2, 'G9, GL, B, C once, GB and GE twice');
  assert.deepEqual(p2Calls.map(sessionOf).sort(), [GB, GB, GE, GE].sort());
  assert.equal(p2.json, p1.json);
  assert.equal(withoutRunFolders(p2.html), withoutRunFolders(p1.html));
  assert.equal(p3Calls, 0);
  const s3 = byId(p3.report);
  for (const sessionId of [G9, GL, B, C]) assert.deepEqual(s3[sessionId], s1[sessionId]);
  assert.deepEqual([s3[GB].status, s3[GE].status], ['not-analysed', 'not-analysed']);
});

test('I3: a changed session gets exactly 1 new call', () => {
  assert.equal(p6.status, 0, p6.stderr);
  assert.equal(count(p6Calls, B), 1);
  for (const sessionId of [G9, GL, C]) assert.equal(count(p6Calls, sessionId), 0);
  const b = byId(p6.report)[B];
  assert.deepEqual([b.status, b.messages, b.intents.map(intent => [intent.from, intent.to])], ['ok', 3, [[1, 3]]]);
  assert.equal(readdirSync(path.join(cacheA, 'intents')).filter(name => name.startsWith(B)).length, 2, 'a new key, the old file stays');
});

test('I9: no system text, tool output or subagent text goes to the model', () => {
  const stdinOf = sessionId => p1Calls.find(call => sessionOf(call) === sessionId).stdin;
  const g9 = stdinOf(G9);
  for (const marker of ['marker-reminder-k2', 'marker-tool-k3', 'marker-side-k4']) assert.ok(!g9.includes(marker), marker);
  assert.ok(g9.includes('No, we use LayoutV2 for all pages.'));
  assert.ok(g9.includes('## Message 9 (user)\n'));
  assert.ok(!stdinOf(B).includes('private-marker-x9q4'));
  const c = stdinOf(C);
  assert.ok(c.includes('## Message 4 (denied)\n') && c.includes('Do not build yet. Check the layout file first.'));
  assert.ok(!c.includes('Find where one city step runs') && !c.includes('The entry point is pipeline/cli.py'));
  // I17: "Agent before" is the agent text since the last message only. In C the agent wrote one text before message 2,
  // and no text before messages 3 to 6.
  assert.equal(c.split('Agent before: I read the layout first.').length - 1, 1);
  assert.ok(c.includes('## Message 3 (answer)\nAgent tools before: AskUserQuestion x1\n'));
});

test('I10: a long message is cut, a too long session gets no call', () => {
  const gl = p1Calls.find(call => sessionOf(call) === GL).stdin;
  assert.ok(gl.length < 240000, `${gl.length}`);
  assert.ok(gl.includes('long-start') && gl.includes('long-end') && gl.includes('[cut: 48,000 characters]'));
  assert.ok(!gl.includes('L'.repeat(1600)));
  const g9 = p1Calls.find(call => sessionOf(call) === G9).stdin;
  assert.ok(g9.includes(`${'y'.repeat(384)} [cut]`) && !g9.includes('y'.repeat(385)));
  assert.equal(count(p1Calls, GT), 0);
  assert.equal(s1[GT].status, 'too-long');
  assert.match(s1[GT].reason, /^the model input has [\d,]+ characters, the limit is 240,000$/);
});

test('I11: each call has the safe flags, a temp folder and the header line', () => {
  const tmp = realpathSync(os.tmpdir());
  const cwds = new Set();
  for (const call of [...p1Calls, ...p2Calls, ...p6Calls]) {
    assert.deepEqual(call.argv, ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--no-session-persistence',
      '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config', '--system-prompt', prompt]);
    assert.ok(call.cwd.startsWith(`${tmp}/`), call.cwd);
    assert.ok(!call.cwd.startsWith(realpathSync(work)), 'not the project, not the cache');
    cwds.add(call.cwd);
    assert.match(call.stdin.split('\n', 1)[0], /^context-health intents intents-v2 session [0-9a-f-]{36}$/);
  }
  assert.equal(cwds.size, p1Calls.length + p2Calls.length + p6Calls.length, 'a new folder for each call');
  // I18 (D3): the prompt has the rule for the cut into intents.
  assert.ok(prompt.includes('- A new question or a new topic starts a new intent.'));
  assert.equal(statusAfter, statusBefore);
});

test('I12: no claude binary gives failed sessions and a report', () => {
  assert.equal(p4.status, 2, p4.stderr);
  assert.match(p4.stderr, /Install Claude Code or add the claude executable to PATH/);
  assert.ok(p4.html && p4.report.analysis.failures.some(failure => failure.retryable));
  assert.equal(p4Calls, 0);
  const s4 = byId(p4.report);
  for (const sessionId of [G9, GL, GB, GE, C, B]) assert.deepEqual([s4[sessionId].status, s4[sessionId].reason], ['failed', 'claude not found']);
  assert.equal(s4[GT].status, 'too-long');
  assert.ok(!existsSync(path.join(cacheB, 'intents')) || readdirSync(path.join(cacheB, 'intents')).length === 0);
});

test('I16: a cache folder in the project stops the command', () => {
  assert.equal(p5.status, 1);
  assert.match(p5.stderr, /cache folder must be outside the project/);
  assert.equal(p5.json, null);
  assert.ok(!existsSync(path.join(project, '.cache')));
});

test('I15: the page shows the intents', () => {
  // Step 8 page: each session row has its status and its number of intents, and each intent is in exactly one group.
  const data = pageData(p1.html);
  const groups = p1.report.groups;
  for (const entry of p1.report.intents.sessions) {
    const row = data.sessions.find(item => item.id === entry.sessionId);
    assert.deepEqual([row.status, row.intentCount], [entry.status, entry.intents.length], entry.sessionId);
    for (const intent of entry.intents) {
      const holders = groups.list.filter(group => group.members.some(m => m.sessionId === entry.sessionId && m.intentId === intent.id));
      assert.equal(holders.length, 1, `${entry.sessionId} ${intent.id}`);
      assert.ok(row.groups.includes(holders[0].id));
    }
  }
  // This test has no fake groups answer, so the groups call fails and each intent is its own group, with its goal as label.
  assert.equal(groups.status, 'failed');
  assert.ok(data.groups.some(group => group.label === 'Build the area page for Madrid' && group.count === 1));
  // The missing-context correction is a "told by you" problem of its session, with the words of the user.
  const told = data.sessions.flatMap(item => item.problems).filter(item => item.kind === 'missing' && item.text.startsWith('Area pages use LayoutV2'));
  assert.equal(told.length, 1, 'the missing-context correction is shown as missing');
  assert.ok(told[0].quote.includes('we use LayoutV2 for all pages'));
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});
