// E2E for the page (step 7, rebuilt in step 8 from the ui v4 sketch): run the real command on a git copy of
// fixtures/indoeuromap, with a copy of fixtures/claude-settings-home plus 2 sessions that this file writes, and the fake
// claude binary test/fake-claude.mjs. No real model call. No browser: the checks read the static HTML and the JSON
// that the page embeds. The ways it can fail are V1 to V15 in the step 8 failure list (P11 and P20 of step 7 stay).
// The clicks were checked once in a headless Chrome, see the build notes (step 8).
// Artifact: out/e2e-page/report.json and report.html (same content on every run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fake = path.join(repo, 'test', 'fake-claude.mjs');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-indoeuromap';
const id = digit => `${digit.repeat(8)}-0000-0000-0000-000000000000`;
const [A, B, C, D] = ['1', '2', '3', '4'].map(id);
const P1 = '97000001-0000-0000-0000-000000000000';
const P2 = '97000002-0000-0000-0000-000000000000';
const RESEARCH = 'data/research/growth-metrics-2026-10-21/README.md';
const LONG_MARKER = 'long-tail-marker-z3';

// One copy of the fixture project and settings home. Two copies in two folders check the absolute paths (V6).
function setup(work) {
  const project = path.join(work, 'indoeuromap');
  cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
  // The data/research files are git-ignored, also in this repo, so a git copy of the repo can miss them.
  if (!existsSync(path.join(project, RESEARCH))) {
    mkdirSync(path.dirname(path.join(project, RESEARCH)), { recursive: true });
    writeFileSync(path.join(project, RESEARCH), '# growth-metrics-2026-10-21\n\nLocal research record.\n');
  }
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  const settings = path.join(work, 'claude-settings-home');
  cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), settings, { recursive: true });
  const sessionDir = path.join(settings, 'projects', MAIN);
  const userClaude = readFileSync(path.join(settings, 'CLAUDE.md'), 'utf8');
  const projectClaude = readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
  // Items: { user } or { agent }. No tool calls: the page cases need only the texts.
  const writeSession = (sessionId, start, items) => {
    const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
    let k = 0;
    const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
    const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
    const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: [
      { path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
      { path: `${OLD}/CLAUDE.md`, content: projectClaude, type: 'Project' }] } })];
    for (const item of items) {
      if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
      if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    }
    writeFileSync(path.join(sessionDir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
  };
  // P1: HTML and a closing script tag in the user messages. The fake answers (fixtures/fake-claude/97000001-...) have HTML
  // in the goal and the quote, and an em dash in the goal.
  writeSession(P1, '2026-11-20T10:00:00.000Z', [
    { user: 'Fix the <script>alert(1)</script> tag on the home page. </details> "quote" & more \u2014 now.' },
    { agent: 'Done.' },
    { user: 'No, the home page text is plain, no <b>HTML</b>.' },
    { agent: 'Ok.' },
    { user: 'Thanks.' }
  ]);
  // P2: a first message of 5,000 characters. No fake answer, so the intents call fails.
  writeSession(P2, '2026-11-19T10:00:00.000Z', [
    { user: `Start of the long message. ${'a'.repeat(4000)} ${LONG_MARKER} `.padEnd(5000, 'b') },
    { agent: 'ok' },
    { user: 'Second message.' }
  ]);
  return { project, settings };
}

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-page-'));
const { project, settings } = setup(work);
const work2 = mkdtempSync(path.join(os.tmpdir(), 'context-health-page2-'));
const copy2 = setup(work2);
const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const cacheA = path.join(work, 'cache-a');

function run({ out, cache = cacheA, intents = true, oldPath = true, tz = 'UTC', where = { project, settings } }) {
  const args = [cli, where.project, '--claude-settings-home', where.settings, '--out', out, '--cache', cache, '--no-open', '--no-save'];
  if (oldPath) args.push('--old-path', OLD);
  if (intents) args.push('--intents');
  const result = spawnSync('node', args, { encoding: 'utf8',
    env: { ...process.env, TZ: tz, CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
  const json = existsSync(path.join(out, 'report.json')) ? readFileSync(path.join(out, 'report.json'), 'utf8') : null;
  const html = existsSync(path.join(out, 'report.html')) ? readFileSync(path.join(out, 'report.html'), 'utf8') : null;
  return { status: result.status, stderr: result.stderr, json, html, report: json && JSON.parse(json) };
}

// R1: --intents, UTC. R2: the same in Asia/Tokyo (the artifact). R3: no --intents, an empty cache (not analysed).
// R4: no --old-path (no sessions). R5: --intents on the second copy, with the same cache.
const r1 = run({ out: path.join(work, 'run-1') });
const artifact = path.join(repo, 'out', 'e2e-page');
mkdirSync(artifact, { recursive: true });
const r2 = run({ out: artifact, tz: 'Asia/Tokyo' });
const r3 = run({ out: path.join(work, 'run-3'), cache: path.join(work, 'cache-empty'), intents: false });
const r4 = run({ out: path.join(work, 'run-4'), intents: false, oldPath: false });
const r5 = run({ out: path.join(work2, 'run-5'), where: copy2 });

const html = r1.html;
const report = r1.report;
const DATA_RE = /<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/;
const dataOf = page => JSON.parse(page.match(DATA_RE)[1]);
const data = dataOf(html);
const snippet = readFileSync(path.join(repo, 'src', 'page', 'copy-markdown.html'), 'utf8');
// Step 12: the health block is the v1 score and its 4 questions (test/e2e-step-12-b.test.mjs checks the markup).
// One row: its key, its count of items, and its detail. The pattern needs a closed button and a hidden detail, so a
// row that is open fails here.
const KEYS = ['find', 'close', 'told', 'lean'];
const COUNT_KEYS = ['noRoute', 'searched', 'told', 'startLoad', 'sessions'];
const healthOf = page => {
  const at = page.indexOf('<section class="health" id="health"');
  assert.ok(at >= 0, 'the page has the health section');
  return page.slice(at, page.indexOf('</section>', at));
};
const textOf = part => part.replace(/<[^>]*>/g, ' ');
const rowsOf = page => healthOf(page).split('<div class="qrow" ').slice(1).map(part => {
  const m = part.match(/^data-q="(\w+)" data-n="(\d+)">\s*<button type="button" class="hq" aria-expanded="false" aria-controls="hd-(\w+)">[\s\S]*?<\/button>\s*<div class="hd" id="hd-(\w+)" hidden>/);
  assert.ok(m, `a row has a closed button and a hidden detail: ${part.slice(0, 120)}`);
  return { key: m[1], n: m[2], controls: m[3], id: m[4], detail: part.slice(m[0].length) };
});

test('the runs work', () => {
  for (const r of [r1, r2, r3, r4, r5]) assert.equal(r.status, 0, r.stderr);
  assert.equal(report.intents.sessions.find(entry => entry.sessionId === P1).status, 'ok');
  assert.equal(report.intents.sessions.find(entry => entry.sessionId === P2).status, 'failed');
  assert.equal(report.groups.status, 'ok');
});

test('V1, H1, H3, P1, P4: the 5 rows of counts, each detail closed, and the pages with no data', () => {
  // Step 9 (the step 9 failure list). B, C and P1 are ok. File needs: C i1 3, C i2 2, B i1 4 = 9. Missing: B c1, P1 c1 = 2.
  // Found: 8 of 11 have a map route (the tiktok orphan has none) = 72.73, shown 73.
  // Close: frontend/CLAUDE.md 2 steps 0.5, DESIGN.md 2x 0.5, city-batch skill 1, unslop 1, METHOD.md 0.5, compare.md 3 steps 0.25,
  //   tiktok 0, direction.md 3 steps 0.25 = 4.5, and the 2 missing needs 0: 4.5 / 11 = 40.91, shown 41.
  // One source: copies (0.5) in DESIGN.md (2 needs), direction.md (1), the city-batch skill (1): 9 - 2 = 7 of 9 = 77.78, shown 78.
  // Total: 0.5 x 72.73 + 0.3 x 40.91 + 0.2 x 77.78 = 64.19, shown 64, mixed.
  const h = report.health;
  assert.deepEqual([h.score, h.label, h.parts.found.score, h.parts.close.score, h.parts.oneSource.score], [64, 'mixed', 73, 41, 78]);
  // Step 12: the page shows the v1 score (health.v1) and its 4 questions. The step 9 score stays in report.json only.
  const v1 = h.v1;
  assert.ok(html.includes(`<section class="health" id="health" data-shown="${v1.shown}" data-method="v1" aria-label="Context score">`));
  for (const old of ['data-health', 'data-label', 'class="hrow"', 'data-part', 'class="crow"', 'data-count=', 'class="hl ', 'class="ans ']) assert.ok(!html.includes(old), old);
  // The 5 rows, in order, with the text of health.counts. Each button is closed and each detail is hidden (the row parser checks it).
  // The needed files: frontend/CLAUDE.md, DESIGN.md, the city-batch skill, unslop, METHOD.md, compare.md, the tiktok orphan, direction.md: 8.
  // a: the orphan has no route: 1. b: METHOD.md and compare.md (search), direction.md (the user gave the path): 3.
  // c: B c1 and P1 c1: 2. e: 6 sessions read (B, C, P1 analysed; A and D have one message, P2 failed), 2 files skipped: 8.
  const c = h.counts;
  const list = rowsOf(html);
  assert.deepEqual(list.map(item => item.key), KEYS);
  for (const item of list) assert.deepEqual([item.controls, item.id], [item.key, item.key]);
  assert.deepEqual(list.map(item => Number(item.n)), v1.questions.map(q => q.items.length));
  // Step 12: the texts of health.counts are not on the page any more. They stay in report.json.
  assert.deepEqual(COUNT_KEYS.map(key => c[key].text), ['1 needed file has no route', '3 needed files have a route, but the agent searched',
    '2 facts you had to type (0 already saved)', 'Start load: 698 tokens', 'From 3 of 8 sessions (1 headless skipped, 1 with no user message, 3 not analysed)']);
  assert.deepEqual([c.noRoute.files, c.searched.files, c.told.facts], [1, 3, 2]);
  assert.deepEqual([c.noRoute.base, c.searched.base], ['of 8 needed files', 'of 8 needed files']);
  // Step 11: the page does not show the Close and One source questions any more. Their data stays in report.json.
  // Step 10, C3: Close also counts the needs with no route: the tiktok orphan (1 need) and the 2 told facts.
  assert.equal(h.parts.close.noRoute, 3);
  assert.equal(h.parts.oneSource.facts.filter(fact => !fact.differ).length, 4, '4 facts copied');
  // H3. Step 12: the file with no route is an item of question find.
  assert.ok(list[0].detail.includes('<code>first-iteration/docs/tiktok-first-post-2026-09-27.md</code>'));
  assert.deepEqual(c.searched.items.map(item => item.path), ['pipeline/METHOD.md', 'second-iteration/decisions/compare.md', 'second-iteration/direction.md']);
  // H12: the far file needed once is last. Step 11: the page does not show the far files any more. report.json keeps them.
  assert.deepEqual(h.parts.close.far.map(item => [item.path, item.uses, item.steps]), [
    ['frontend/DESIGN.md', 2, 2], ['second-iteration/decisions/compare.md', 1, 3], ['second-iteration/direction.md', 1, 3],
    ['frontend/CLAUDE.md', 1, 2], ['pipeline/METHOD.md', 1, 2]]);
  // Step 12: each fix of report.fixes is on the page one time, under its question (so the order is by question).
  const fixes = report.fixes;
  assert.ok(fixes.list.length > 0);
  assert.ok(html.includes(`<section class="fixes" id="fixes" data-fixes="${fixes.list.length}" data-smaller="${fixes.smaller.length}"`));
  assert.deepEqual([...html.matchAll(/<li data-fix="(x\d+)" data-kind="([\w-]+)">/g)].map(m => [m[1], m[2]]).sort(), [...fixes.list, ...fixes.smaller].map(fix => [fix.id, fix.kind]).sort());
  // P4: the old metrics are not on the page. They stay in report.json.
  assert.ok(!html.includes('data-metric=') && !html.includes('Direct reach') && !html.includes('Told by user</div>'));
  assert.deepEqual(report.routes.metrics, { directReach: { percent: 45, direct: 5, counted: 11 }, averageRoute: { steps: 2, needs: 8 }, toldByUser: { count: 2 } });
  // H1: no analysed intent, and no sessions: rows a, b and c say "no data", and one line gives the reason. No 0, no NaN.
  for (const [r, reason] of [[r3, 'not-analysed'], [r4, 'no-sessions']]) {
    const counts = r.report.health.counts;
    assert.deepEqual([r.report.health.score, counts.reason], [null, reason]);
    // Step 12: the number area says "No data" with one reason line. The questions find, close and told have no list.
    assert.ok(r.html.includes('<section class="health" id="health" data-shown="no-data" data-method="v1"'), reason);
    const rows = rowsOf(r.html);
    assert.deepEqual(rows.map(item => item.key), KEYS, reason);
    for (const key of ['noRoute', 'searched', 'told']) {
      assert.match(counts[key].text, /: no data$/);
      assert.ok(!/\d/.test(counts[key].text), `${key} shows no number`);
    }
    for (const item of rows.slice(0, 3)) {
      assert.equal(item.n, '0', item.key);
      assert.ok(!item.detail.includes('<li'), `${item.key} has no list`);
    }
    assert.ok(!healthOf(r.html).includes('class="hscore"'), reason);
    assert.equal(r.html.split('<p class="hreason"').length, 2, 'one reason line');
    assert.ok(r.html.includes('<p class="nofix">No fix from this data.</p>'), reason);
    assert.deepEqual([r.report.fixes.total, r.report.fixes.list, r.report.fixes.smaller], [0, [], []]);
  }
  // The number shows in each state with a score. A thin or not proven state adds a note with its reason under the number.
  assert.ok(html.includes('class="hscore"'), 'the number shows');
  assert.equal(html.includes('class="hreason hnote"'), v1.shown !== 'score', 'the note is there only when the state is not "score"');
  assert.ok(!html.includes('NaN') && !r3.html.includes('NaN') && !r4.html.includes('NaN'));
});

test('V2: session text cannot break the page or add a script', () => {
  for (const r of [r1, r3]) {
    const page = r.html;
    assert.equal(page.match(/<script/g).length, 3, 'data, page script, Copy markdown');
    const raw = page.match(DATA_RE)[1];
    assert.ok(!/[<>&]/.test(raw), 'the embedded JSON has no < > &');
    assert.ok(!page.includes('<script>alert') && !page.includes('<img') && !page.includes('<b>HTML</b>'));
    const p1 = dataOf(page).sessions.find(item => item.id === P1);
    assert.equal(p1.first, 'Fix the <script>alert(1)</script> tag on the home page. </details> "quote" & more - now.');
  }
  const label = data.groups.map(group => group.label);
  assert.ok(label.includes('Fix the <img src=x onerror=alert(1)> home page'), label.join(' | '));
  const p1Problems = data.sessions.find(item => item.id === P1).problems;
  assert.deepEqual(p1Problems.map(item => [item.kind, item.quote]), [['missing', '</details><script>alert(2)</script> no HTML']]);
});

test('V3: the embedded data is the data of report.json', () => {
  const routes = report.routes;
  assert.deepEqual(data.map.edges, routes.map.edges);
  assert.deepEqual(data.map.nodes.map(node => [node.id, node.lane, node.column, node.row, node.intents, node.groups]),
    routes.map.nodes.map(node => [node.id, node.lane, node.column, node.row, node.intents, node.groups]));
  assert.deepEqual(data.groups.map(group => [group.id, group.label, group.count]), report.groups.list.map(group => [group.id, group.label.replace(/[\u2013\u2014]/g, '-'), group.count]), 'the same, with a plain hyphen for a dash');
  for (const group of data.groups) {
    const entry = routes.byGroup.find(item => item.groupId === group.id);
    assert.deepEqual([group.sessions, group.weak, group.told, group.files, group.edges, group.problems],
      [entry.sessions, entry.weak, entry.told, entry.files, entry.edges, entry.problems], group.id);
  }
  assert.deepEqual(data.sessions.map(item => item.id), report.sessions.list.map(session => session.sessionId), 'newest first');
  for (const item of data.sessions) {
    const entry = routes.bySession.find(row => row.sessionId === item.id);
    assert.deepEqual([item.groups, item.files, item.edges, item.problems, item.intentCount], [entry.groups, entry.files, entry.edges, entry.problems, entry.intents.length]);
  }
  assert.equal(data.prompt, report.prompt.text);
  // The METHOD.md tooltip route comes from the map.
  assert.deepEqual(data.map.nodes.find(node => node.id === 'pipeline/METHOD.md').route, ['CLAUDE.md', 'AGENTS.md', 'pipeline/METHOD.md']);
  assert.deepEqual(data.map.nodes.find(node => node.id === '.claude/skills/city-batch/SKILL.md').route, [':skill-list', '.claude/skills/city-batch/SKILL.md']);
});

test('V4: the page needs no network', () => {
  for (const r of [r1, r3, r4]) {
    for (const bad of ['<link', 'src="http', 'fetch(', 'http://', 'https://']) assert.ok(!r.html.includes(bad), bad);
  }
});

test('V5: the Copy markdown button is kept byte for byte', () => {
  for (const r of [r1, r3, r4]) {
    assert.ok(r.html.includes(snippet));
    assert.equal(r.html.split('id="copy-md-btn"').length, 2);
  }
});

test('V6: the full path of a project file and of a ~/.claude/ file', () => {
  const node = (d, rel) => d.map.nodes.find(item => item.id === rel);
  assert.equal(node(data, 'CLAUDE.md').abs, `${project}/CLAUDE.md`);
  assert.equal(node(data, 'second-iteration/decisions/city.md').abs, `${project}/second-iteration/decisions/city.md`);
  assert.equal(node(data, '~/.claude/CLAUDE.md').abs, `${settings}/CLAUDE.md`);
  assert.equal(node(data, '~/.claude/skills/unslop/SKILL.md').abs, `${settings}/skills/unslop/SKILL.md`);
  assert.ok(existsSync(node(data, '~/.claude/skills/unslop/SKILL.md').abs));
  assert.equal(node(data, ':skill-list').abs, null);
  for (const item of data.map.nodes.filter(entry => entry.path && !entry.path.startsWith('~/'))) assert.ok(existsSync(item.abs), item.abs);
  // report.json keeps relative paths in the new keys. The page holds the two roots of the run, so a copy in another
  // folder gives the same page after the roots are replaced.
  const norm = (page, where) => page.replaceAll(where.project, '<project>').replaceAll(where.settings, '<settings>');
  assert.equal(norm(r5.html, copy2), norm(html, { project, settings }));
  assert.equal(norm(r5.json, copy2), norm(r1.json, { project, settings }));
});

test('V7: the 3 states', () => {
  // No sessions.
  assert.equal(r4.report.sessions.list.length, 0);
  assert.ok(r4.html.includes('data-state="no-sessions">No sessions for this project.'));
  assert.ok(r4.html.includes('add <code>--old-path &lt;old folder&gt;</code>'));
  assert.deepEqual([dataOf(r4.html).sessions, dataOf(r4.html).groups], [[], []]);
  // Sessions, but none analysed.
  assert.match(r3.html, /data-state="not-analysed">No session is analysed yet\. Run with <code>--intents<\/code> to find the intents \(one model call for each session, sonnet\)\. 4 sessions wait for it\./);
  assert.deepEqual(dataOf(r3.html).groups, []);
  assert.equal(dataOf(r3.html).sessions.length, 6);
  // Analysed.
  assert.ok(!html.includes('data-state='), 'no state line when all selected sessions are analysed or failed');
  assert.ok(data.groups.length > 0);
});

test('V8: the Intents and Sessions switch and the filter chips', () => {
  assert.ok(html.includes('<div class="switch" id="switch" role="group" aria-label="List"><button type="button" data-v="intents" aria-pressed="true">Intents</button>' +
    '<button type="button" data-v="sessions" aria-pressed="false">Sessions</button></div>'));
  assert.ok(html.includes("var FILTERS = [['all', 'All'], ['2', '2+ times'], ['weak', 'Weak links'], ['told', 'Told by user']];"));
  assert.ok(html.includes('<svg id="map"') && html.includes('id="note"') && html.includes('id="tip"'));
  assert.ok(html.includes('>Copy improvement prompt</button>') && html.includes('>Show prompt</button>'));
  // The prompt panel: hidden, with the "What to improve" section highlighted.
  assert.ok(html.includes('<section id="prompt" hidden aria-label="Improvement prompt"><p class="intro">'));
  assert.match(html, /<div class="fix"><h3>5\. What to improve<\/h3><ol><li>/);
});

test('V9: two runs in two time zones give the same files', () => {
  assert.equal(r2.json, r1.json);
  assert.equal(r2.html, r1.html);
  // Dates in UTC from the session files.
  assert.deepEqual(data.sessions.map(item => [item.date, item.when]).slice(0, 2), [['Nov 20', '2026-11-20 10:00 UTC'], ['Nov 19', '2026-11-19 10:00 UTC']]);
});

test('V10: no en dash or em dash in the page and in the prompt', () => {
  for (const r of [r1, r3, r4]) {
    assert.ok(!/[\u2013\u2014]/.test(r.html), 'page');
    assert.ok(!/[\u2013\u2014]/.test(r.report.prompt.text), 'prompt');
    assert.ok(!/\\u201[34]/.test(r.html), 'no escaped dash either');
  }
  // The goal with an em dash is a plain hyphen on the page.
  assert.ok(data.groups.some(group => group.label === 'Say thanks - quick reply'));
});

test('V11: the old parts are gone', () => {
  for (const r of [r1, r3, r4]) {
    for (const old of ['id="verdict"', 'data-project-score', 'data-score=', 'What to fix first', 'data-key=', 'Copy marks', 'localStorage',
      'class="trail"', '<h2>The context</h2>', 'Not built yet', 'Cheap', 'No missing', 'Right</button>']) {
      assert.ok(!r.html.replace(snippet, '').includes(old), old);
    }
  }
});

test('V12: light only: no dark rule outside the Copy markdown snippet', () => {
  for (const r of [r1, r4]) {
    const page = r.html.replace(snippet, '');
    assert.ok(!page.includes('prefers-color-scheme'), 'no dark rule');
    assert.ok(page.includes('color-scheme: light'));
    assert.ok(page.includes('<meta name="viewport" content="width=device-width,initial-scale=1">'));
    assert.match(page, /@media \(max-width:\s*600px\)/);
  }
});

test('V13, P11: one row per session, newest first, with its reason when it has no intents', () => {
  const rows = Object.fromEntries(data.sessions.map(item => [item.id, item]));
  assert.deepEqual([rows[A].reasonShort, rows[D].reasonShort, rows[P2].reasonShort], ['one message', 'one message', 'failed']);
  assert.deepEqual([rows[B].intentCount, rows[C].intentCount, rows[P1].intentCount], [1, 2, 2]);
  assert.deepEqual([rows[B].reasonShort, rows[C].reasonShort], [null, null]);
  assert.equal(rows[P2].status, 'failed');
  // P11: a long first message is cut. The marker after character 300 is not on the page.
  assert.ok(rows[P2].first.startsWith('Start of the long message. aaa') && rows[P2].first.endsWith('...'));
  assert.equal(rows[P2].first.length, 163);
  assert.ok(!html.includes(LONG_MARKER));
  // Not analysed rows in R3.
  const r3Rows = Object.fromEntries(dataOf(r3.html).sessions.map(item => [item.id, item.reasonShort]));
  assert.deepEqual([r3Rows[B], r3Rows[C], r3Rows[P1], r3Rows[A]], ['not analysed', 'not analysed', 'not analysed', 'one message']);
});

test('V14: the clipboard calls catch the rejection and have a fallback', () => {
  const script = readFileSync(path.join(repo, 'src', 'page', 'page.js'), 'utf8');
  assert.ok(html.includes(script), 'the page script is in the page');
  assert.ok(script.includes("navigator.clipboard.writeText(DATA.prompt).then(function () { say('Prompt copied'); }, selectPanel);"));
  assert.ok(script.includes("navigator.clipboard.writeText(abs).then(function () { say('Path copied: ' + abs); }, function () { showToCopy(abs); });"));
  assert.equal(script.match(/\} catch \(err\) \{ (selectPanel|showToCopy\(abs\))\(?\)?; \}/g).length, 2);
});

test('P20 (D4): the skipped session files are in the page data with their reason', () => {
  assert.deepEqual(data.skipped, report.sessions.skipped.map(item => ({ folder: item.folder, file: item.file, reason: item.reason })));
  assert.deepEqual(data.skipped.map(item => item.reason), ['headless', 'no-user-message']);
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});
