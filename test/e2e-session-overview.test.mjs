// E2E for the overview of a session on the page: its title, what was asked, what was done, and the files that changed.
// It runs the real command on a git copy of fixtures/indoeuromap, with one more session in a copy of fixtures/claude-settings-home
// and the fake binary test/fake-claude.mjs. No real model call.
//
// The ways it can fail (written before the code):
// O1 Intents are before Sessions, or the page starts with the intents.
// O2 The title is missing, is an old title, or is the first message with its paste and image marks. A title of the user loses.
// O3 A step shows the answer of another step, the text of a subagent, a tool output, or raw Markdown marks.
// O4 A session with no intents has no overview.
// O5 A temp file counts as a changed file, or a file that changed 2 times shows 2 times.
// O6 The new data changes the model input, so the cached answers do not count and each session costs again.
// O7 A title or an answer with HTML breaks the page.
// O8 A step names the wrong group, or the steps are not in the order of the session.
// O9 An en dash or em dash of an answer comes to the page.
// O10 A box of the map with a count (the skill and command list too) lists no session or intent, or a box with no count lists one.
// Artifact: out/e2e-session-overview/report.html and sessions.json (the overview data).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { assertReportExit } from './report-html.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'context-health-overview-')));
const artifact = path.join(repo, 'out', 'e2e-session-overview');
mkdirSync(artifact, { recursive: true });
const project = path.join(work, 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
execFileSync('git', ['-C', project, 'init', '-q']);
execFileSync('git', ['-C', project, 'add', '-A']);
const home = path.join(work, 'home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), home, { recursive: true });

// A session of 2 user messages that the fake claude does not know, so it has no intents.
const X = 'aaaaaaaa-0000-0000-0000-000000000000';
let tick = 0;
const at = () => { tick += 1; return `2026-11-21T10:00:${String(tick).padStart(2, '0')}.000Z`; };
const base = { isSidechain: false, cwd: project, sessionId: X, entrypoint: 'cli' };
const user = text => ({ ...base, type: 'user', uuid: `u${tick}`, timestamp: at(), message: { role: 'user', content: text }, promptSource: 'typed', origin: { kind: 'human' } });
const agent = (content, extra = {}) => ({ ...base, ...extra, type: 'assistant', uuid: `a${tick}`, timestamp: at(), message: { id: `m${tick}`, role: 'assistant', model: 'claude-test', content } });
const edit = (id, file) => [agent([{ type: 'tool_use', id, name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }]),
  { ...base, type: 'user', uuid: `r${id}`, timestamp: at(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'tool-output-marker' }] } }];
const write = (id, records) => {
  const dir = path.join(home, 'projects', project.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
};
write(X, [
  user('<pasted_content id="41c1">\n[Image #4] Make the map \u2014 faster'),
  { type: 'ai-title', aiTitle: 'An old title', sessionId: X },
  agent([{ type: 'text', text: 'I look at it first.' }]),
  ...edit('e1', path.join(project, 'frontend/DESIGN.md')),
  ...edit('e2', path.join(project, 'frontend/DESIGN.md')),
  ...edit('e3', '/private/tmp/scratch/notes.md'),
  agent([{ type: 'text', text: 'subagent-marker' }], { isSidechain: true }),
  agent([{ type: 'text', text: '## Done\n\nThe **map** loads [faster](http://x) \u2014 see `DESIGN.md`.\n\n```js\ncode-marker\n```\n<script>alert(1)</script>' }]),
  user('Thanks, now commit it'),
  { type: 'ai-title', aiTitle: 'Faster </script> map', sessionId: X },
  agent([{ type: 'text', text: 'Committed.' }])
]);
const Y = 'bbbbbbbb-0000-0000-0000-000000000000';
write(Y, [{ ...user('<pasted_content id="bffa">\nfix the colors [Image #2] please\n</pasted_content>'), sessionId: Y, timestamp: '2026-11-20T23:00:00.000Z' }]);
const Z = 'cccccccc-0000-0000-0000-000000000000';
write(Z, [{ ...user('hello'), sessionId: Z, timestamp: '2026-11-20T22:00:00.000Z' }, { type: 'custom-title', customTitle: 'My name', sessionId: Z }, { type: 'ai-title', aiTitle: 'Model name', sessionId: Z }]);

const log = path.join(work, 'claude.log');
const cache = path.join(work, 'cache');
function run(name, exit = 0) {
  const out = path.join(work, name);
  const result = spawnSync(process.execPath, [path.join(repo, 'bin', 'context-health.mjs'), project, '--claude-settings-home', home, '--old-path', '/Users/example/projects/indoeuromap',
    '--intents', '--no-open', '--ignore', 'none', '--no-save', '--out', out, '--cache', cache],
  { env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test', 'fake-claude.mjs'), CONTEXT_HEALTH_FAKE_LOG: log }, encoding: 'utf8' });
  const html = readFileSync(path.join(out, 'report.html'), 'utf8');
  const report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'));
  assertReportExit(result, report, exit);
  return { html, report,
    data: JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]) };
}
const { html, report, data } = run('one');
writeFileSync(path.join(artifact, 'report.html'), html.replaceAll(work, '<work>'));
writeFileSync(path.join(artifact, 'sessions.json'), `${JSON.stringify(data.sessions.map(({ id, title, start, end, asked, steps, edited }) => ({ id, title, start, end, asked, steps, edited })), null, 2).replaceAll(work, '<work>')}\n`);
const get = id => data.sessions.find(item => item.id === id);

test('O1: Sessions come first and are the first view', () => {
  assert.ok(html.indexOf('data-v="sessions"') < html.indexOf('data-v="intents"'));
  assert.match(html, /data-v="sessions" aria-pressed="true"/);
  assert.match(html, /state = \{ view: 'sessions'/);
});

test('O2: the title is the newest one, the title of the user wins, and the fallback is a clean first message', () => {
  assert.equal(get(X).title, 'Faster </script> map');
  assert.equal(get(Z).title, 'My name');
  assert.equal(get(Y).title, 'fix the colors please');
  for (const session of data.sessions) assert.ok(session.title && !/pasted_content|\[Image/.test(session.title), session.id);
});

test('O3, O4, O9: a session with no intents shows each message and the answer to it, as plain text', () => {
  const session = get(X);
  assert.equal(session.intentCount, 0);
  assert.deepEqual(session.steps.map(step => step.goal), ['Make the map - faster', 'Thanks, now commit it']);
  assert.equal(session.steps[1].did, 'Committed.');
  assert.match(session.steps[0].did, /^Done[.:]? The map loads faster - see DESIGN\.md\./);
  const text = JSON.stringify(session);
  for (const marker of ['subagent-marker', 'tool-output-marker', 'code-marker', '**', '```', '\u2014', 'I look at it first']) assert.ok(!text.includes(marker), marker);
  assert.equal(session.asked, 2);
  assert.equal(session.start, '2026-11-21T10:00:01.000Z');
});

test('O5: the changed files are in the list one time, with no temp file', () => {
  assert.deepEqual(get(X).edited, ['frontend/DESIGN.md']);
});

test('O3, O8: the steps of an analysed session are its intents, in order, with their answer and group', () => {
  const analysed = data.sessions.filter(item => item.intentCount);
  assert.ok(analysed.length >= 2);
  let grouped = 0;
  for (const session of analysed) {
    const entry = report.intents.sessions.find(item => item.sessionId === session.id);
    assert.deepEqual(session.steps.map(step => step.goal), entry.intents.map(intent => intent.goal.replace(/[\u2013\u2014]/g, '-')));
    session.steps.forEach((step, k) => {
      const group = report.groups.list.find(item => item.members.some(member => member.sessionId === session.id && member.intentId === entry.intents[k].id));
      assert.equal(step.group, group?.id ?? null);
      if (group) grouped += 1;
      const { from, to } = entry.intents[k];
      const answers = report.sessions.list.find(item => item.sessionId === session.id).answers.filter(item => item.message >= from && item.message <= to);
      assert.equal(Boolean(step.did), answers.length > 0, `${session.id} ${k}`);
    });
  }
  assert.ok(grouped > 0);
});

test('O7: HTML in a title or an answer does not close the script', () => {
  assert.equal(html.split('</script>').length, html.split('<script').length);
  assert.ok(!html.includes('<script>alert(1)'));
});

test('O10: the sessions and intents of each box agree with its count', () => {
  let used = 0;
  for (const node of data.map.nodes) {
    assert.equal(node.usedBy.sessions.length > 0, node.intents > 0, `${node.id}: sessions`);
    assert.equal(node.usedBy.groups.length > 0, node.intents > 0, `${node.id}: intents`);
    for (const id of node.usedBy.sessions) assert.ok(get(id), id);
    for (const id of node.usedBy.groups) assert.ok(data.groups.some(group => group.id === id), id);
    if (node.intents) used += 1;
  }
  assert.ok(used > 3);
  // Each session of the skill list loaded a skill from it, and no other session did.
  const list = data.map.nodes.find(node => node.id === ':skill-list');
  assert.ok(list.intents > 0);
  assert.deepEqual(list.usedBy.sessions, data.sessions.filter(item => item.edges.some(edge => edge.kind === 'trigger')).map(item => item.id));
});

test('the report searches files, filters evidence sessions, and highlights opens', () => {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  try {
    const { document, Event, KeyboardEvent } = dom.window;
    dom.window.eval(document.querySelector('#page-data + script').textContent);
    const map = document.getElementById('map');
    const list = document.getElementById('list');
    const search = document.getElementById('file-search');
    const file = data.map.nodes.find(node => node.lane === 'none' && node.intents === 0 && node.path && /^[\w./-]+$/.test(node.path) &&
      data.sessions.every(session => !session.exploration.opened.includes(node.path) &&
        !session.exploration.lookups.some(lookup => lookup.target === node.path || lookup.resultPaths.includes(node.path))));
    assert.ok(file, 'The fixture includes a file with no evidence of use');
    const fileNode = () => map.querySelector('g[data-id="' + file.id + '"]');
    assert.ok(fileNode(), 'The folder map shows unused files');
    search.value = file.path.toUpperCase();
    search.dispatchEvent(new Event('input'));
    assert.equal(map.querySelectorAll('g[data-kind="file"]').length, 1);
    assert.equal(fileNode().getAttribute('tabindex'), '0');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    assert.match(list.textContent, /No sessions with activity here/);

    const session = data.sessions.find(item => item.exploration.opened.some(path => data.map.nodes.some(node => node.id === path)));
    assert.ok(session, 'The fixture includes a session that opened files shown on the map');
    const finding = document.createElement('button');
    finding.dataset.findingSessions = JSON.stringify([X, session.id]);
    finding.dataset.findingFile = file.id;
    document.body.append(finding);
    finding.click();
    assert.equal(search.value, '');
    assert.ok(fileNode(), 'The finding keeps its file visible');
    assert.equal(list.querySelectorAll('button.sess').length, 2);
    list.querySelector('button[data-s="' + session.id + '"]').click();
    assert.ok(list.querySelector('.over'));
    assert.equal(list.querySelector('.sess'), null);
    assert.ok(map.querySelector('g[data-activity="opened"]'));
    assert.equal(document.activeElement, list.querySelector('.back'));
  } finally {
    dom.window.close();
  }
});

test('O6: the cached answers still count, and no answer text goes to the model as new input', () => {
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(line => JSON.parse(line).stdin.startsWith('context-health intents'));
  const known = calls.filter(line => !line.includes(X)).length;
  run('two', 2);
  const again = readFileSync(log, 'utf8').trim().split('\n').filter(line => JSON.parse(line).stdin.startsWith('context-health intents') && !line.includes(X)).length;
  assert.equal(again, known);
  assert.ok(existsSync(cache));
});
