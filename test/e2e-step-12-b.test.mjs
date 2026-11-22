// E2E for step 12, part B (the page of the v1 score): run the real command on a git copy of fixtures/indoeuromap with
// one commit, its own settings homes, the sessions that this file writes, and a copy of the fake claude binary with
// the answers that this file writes. No real model call. Each check compares report.html with report.json of the
// same run: the page must show what `health.v1` and `fixes` say.
// The ways it can fail are in the step 12 failure list (G1 to G14). G14 and the clicks of G4 are a browser check
// by hand. A small fixture gives no passed proof, so the states `score` and `not-proven` also come from the
// report.json of the main run with `shown`, `reason`, `headline` and `proof` set by hand, through `render()`.
// Artifact: out/e2e-step-12-b/: report.json and report.html (the main run), score.html, not-proven.html, thin.html,
// no-data.html, no-v1.html, and states.md (the state of each page).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { render } from '../src/render.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fixture = path.join(repo, 'fixtures', 'indoeuromap');
const repoSettings = path.join(repo, 'fixtures', 'claude-settings-home');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-indoeuromap';
const ID = n => `120000${String(n).padStart(2, '0')}-0000-0000-0000-00000000000b`;
const RESEARCH_FILES = ['europe-expansion-2026-10-20', 'growth-metrics-2026-10-21', 'wave-1-finish-2026-10-20'].map(name => `data/research/${name}/README.md`);
const METHOD = 'pipeline/METHOD.md';
const ORPHAN = 'notes/orphan.md';
const NOW = 'notes/now.md';
const AMP = 'guides/r&d.md';
const DEPLOY = 'guides/deploy.md';
const SKILL = '.claude/skills/geo-audit/SKILL.md';
const KEYS = ['find', 'close', 'told', 'lean'];
const STATE = { 'not-proven': 'Score not proven', thin: 'Not enough data', 'no-data': 'No data' };

const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const append = (file, text) => writeFileSync(file, `${readFileSync(file, 'utf8')}${text}`);

// ---------- the project: a git copy of the fixture with one commit before the sessions ----------

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step12b-'));
// notes/orphan.md: no file links it (Missed). notes/now.md: CLAUDE.md links it (Served). guides/: CLAUDE.md links only
// the folder (Slow). The texts of the new files are invented.
const M = path.join(work, 'main', 'indoeuromap');
cpSync(fixture, M, { recursive: true });
for (const rel of RESEARCH_FILES) if (!existsSync(path.join(M, rel))) write(path.join(M, rel), `# ${rel.split('/')[2]}\n\nLocal research record.\n`);
append(path.join(M, 'CLAUDE.md'), '\nThe open work is in [notes/now.md](notes/now.md).\nThe how-to guides are in [guides/](guides/).\n');
write(path.join(M, NOW), '# Now\n\n- The city page title is open.\n- The batch size is 40 cities for each run.\n');
write(path.join(M, AMP), '# R&D\n\nThe research notes of the team.\n');
write(path.join(M, DEPLOY), '# Deploy\n\nRun the build first.\n');
write(path.join(M, ORPHAN), '# Orphan\n\nNo file links to this note.\nThe review window is 9 days.\n');
const git = (...args) => execFileSync('git', ['-C', M, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
  { env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-01T00:00:00Z' } });
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-q', '-m', 'The first version');
const CONFIG = path.join(work, 'config', 'context-files.json');
write(CONFIG, `${JSON.stringify({ include: ['notes/**', 'guides/**'] }, null, 2)}\n`);

// ---------- the settings homes and their sessions ----------

const userClaude = readFileSync(path.join(repoSettings, 'CLAUDE.md'), 'utf8');
function makeHome(name) {
  const dir = path.join(work, 'homes', name);
  cpSync(repoSettings, dir, { recursive: true, filter: source => path.relative(repoSettings, source).split(path.sep)[0] !== 'projects' });
  mkdirSync(path.join(dir, 'projects', MAIN), { recursive: true });
  return dir;
}
const abs = rel => `${OLD}/${rel}`;
const start = [{ path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
  { path: abs('CLAUDE.md'), content: readFileSync(path.join(M, 'CLAUDE.md'), 'utf8'), type: 'Project' }];

// Items: { user }, { agent }, { read: full path, text }, { grep: pattern, files: [full paths] }.
function writeSession(home, sessionId, startedAt, items, entrypoint = 'cli') {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(startedAt) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: start } })];
  const tool = (name, input, content, toolUseResult) => {
    const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
    records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: toolId, name, input }], usage } }));
    records.push(rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content }] }, toolUseResult }));
  };
  for (const item of items) {
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    if (item.read != null) {
      const lines = item.text.split('\n').length;
      tool('Read', { file_path: item.read }, item.text, { type: 'text', file: { filePath: item.read, content: item.text, numLines: lines, startLine: 1, totalLines: lines } });
    }
    if (item.grep != null) {
      tool('Grep', { pattern: item.grep, path: OLD, output_mode: 'files_with_matches' }, `Found ${item.files.length} files\n${item.files.join('\n')}`,
        { mode: 'files_with_matches', filenames: item.files, numFiles: item.files.length });
    }
  }
  writeFileSync(path.join(home, 'projects', MAIN, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}
const readOf = rel => ({ read: abs(rel), text: readFileSync(path.join(M, rel), 'utf8') });
const searchOf = (pattern, rel) => [{ grep: pattern, files: [abs(rel)] }, readOf(rel)];
const day = n => `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`;
const done = [{ agent: 'Done.' }, { user: 'Thanks.' }];
// The typed facts. A: in no file. B: now in notes/now.md (a route). C: now in notes/orphan.md (no route). D: a fact
// with a script element. T: a request for one task (not a rule).
const FACT = {
  A: { text: 'Never ship on a Friday', quote: 'Never ship on a Friday.' },
  B: { text: 'The batch size is 40 cities for each run', quote: 'The batch size is 40 cities for each run.' },
  C: { text: 'The review window is 9 days', quote: 'The review window is 9 days.' },
  D: { text: 'No page uses <script>alert(1)</script>', quote: 'Use <script>alert(1)</script> in no page.' },
  T: { text: 'This post gets the draft title of today', quote: 'Use the draft title of today for this post.' }
};
// The 6 sessions that the fake binary can analyse. Session 7 has no answer. 8 is headless.
const SESSIONS = {
  1: [{ user: 'Fix the title of the Berlin city page.' }, ...searchOf('Orphan', ORPHAN), readOf('CLAUDE.md'), readOf('AGENTS.md'), readOf(METHOD), readOf(NOW), ...done],
  2: [{ user: 'Check the method.' }, ...searchOf('method', METHOD), readOf(ORPHAN), ...searchOf('audit', SKILL), ...searchOf('build', DEPLOY), ...searchOf('research', AMP), ...done],
  3: [{ user: `Read ${ORPHAN} and the open work.` }, readOf(ORPHAN), readOf(NOW), readOf(DEPLOY), ...done],
  4: [{ user: 'Read the rules.' }, readOf('AGENTS.md'), readOf(ORPHAN), readOf(METHOD), { agent: 'Done.' },
    { user: 'Now check the rules for the batch.' }, readOf(NOW), ...searchOf('research', AMP), { agent: 'Done.' }],
  5: [{ user: 'Set the batch for the next run.' }, readOf(NOW), { agent: 'The batch is 20 cities.' },
    { user: FACT.B.quote }, { agent: 'Ok. The review window is 5 days.' },
    { user: FACT.C.quote }, { agent: 'Ok. I ship it on Friday.' },
    { user: FACT.A.quote }, { agent: 'Ok. I add a script element.' },
    { user: FACT.D.quote }, { agent: 'Ok.' }],
  6: [{ user: 'Draft the launch post.' }, readOf(METHOD), readOf(DEPLOY), { agent: 'The post goes out on Friday.' }, { user: FACT.A.quote }, { agent: 'Ok. Which title?' },
    { user: FACT.T.quote }, { agent: 'Ok.' }]
};
const HM = makeHome('main');
for (const n of [1, 2, 3, 4, 5, 6]) writeSession(HM, ID(n), day(22 - n), SESSIONS[n]);
writeSession(HM, ID(7), day(15), [{ user: 'Read the plan.' }, readOf('second-iteration/plan.md'), ...done]);
writeSession(HM, ID(8), day(10), [{ user: 'A headless run.' }, { agent: 'Done.' }], 'sdk-cli');
// HT: 2 analysed sessions (thin data). HE: one analysed session that reads no file (no data).
const HT = makeHome('thin');
for (const n of [1, 5]) writeSession(HT, ID(n), day(22 - n), SESSIONS[n]);
const HE = makeHome('no-needs');
writeSession(HE, ID(11), day(21), [{ user: 'Say hello.' }, { agent: 'Hello.' }, { user: 'Thanks.' }]);

// ---------- the fake binary and its answers ----------

const fakeRoot = path.join(work, 'fake');
const fake = path.join(fakeRoot, 'test', 'fake-claude.mjs');
mkdirSync(path.dirname(fake), { recursive: true });
copyFileSync(path.join(repo, 'test', 'fake-claude.mjs'), fake);
chmodSync(fake, 0o755);
const answer = (name, result) => write(path.join(fakeRoot, 'fixtures', 'fake-claude', name), `${JSON.stringify({ total_cost_usd: 0.01, result }, null, 2)}\n`);
const intent = (from, goal, corrections = []) => ({ start: from, goal, corrections: corrections.map(([message, fact]) => ({ message, ...fact, cause: 'missing-context' })) });
answer(`${ID(1)}.intents.json`, { intents: [intent(1, 'Fix the title of the Berlin city page')] });
answer(`${ID(2)}.intents.json`, { intents: [intent(1, 'Check the method')] });
answer(`${ID(3)}.intents.json`, { intents: [intent(1, 'Read the orphan note and the open work')] });
answer(`${ID(4)}.intents.json`, { intents: [intent(1, 'Read the rules'), intent(2, 'Check the rules for the batch')] });
answer(`${ID(5)}.intents.json`, { intents: [intent(1, 'Set the batch for the next run', [[2, FACT.B], [3, FACT.C], [4, FACT.A], [5, FACT.D]])] });
answer(`${ID(6)}.intents.json`, { intents: [intent(1, 'Draft the launch post', [[2, FACT.A], [3, FACT.T]])] });
answer(`${ID(11)}.intents.json`, { intents: [intent(1, 'Say hello')] });
const check = (correction, kind, now = null) => ({ correction, found: false, path: null, quote: null, now, kind });
answer(`${ID(5)}.needs-check.json`, { checks: [check('c1', 'rule', { path: NOW, quote: 'The batch size is 40 cities for each run.' }),
  check('c2', 'rule', { path: ORPHAN, quote: 'The review window is 9 days.' }), check('c3', 'rule'), check('c4', 'rule')] });
answer(`${ID(6)}.needs-check.json`, { checks: [check('c1', 'rule'), check('c2', 'task')] });

// ---------- the runs ----------

const artifact = path.join(repo, 'out', 'e2e-step-12-b');
function run(name, home, out = path.join(work, 'out', name)) {
  mkdirSync(out, { recursive: true });
  const args = [cli, M, '--claude-settings-home', home, '--out', out, '--cache', path.join(work, 'cache', name), '--no-open', '--no-save', '--config', CONFIG, '--old-path', OLD, '--intents'];
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake } });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  const json = readFileSync(path.join(out, 'report.json'), 'utf8');
  return { name, json, html: readFileSync(path.join(out, 'report.html'), 'utf8'), report: JSON.parse(json) };
}
const main = run('main', HM, artifact);
const thin = run('thin', HT);
const noData = run('no-data', HE);
// A page from the report.json of the main run, with a change by hand. The page code is the real one.
function variant(name, change) {
  const report = JSON.parse(main.json);
  change(report);
  return { name, report, html: render(report) };
}
const proofOf = (v1, status, text) => ({ ...(v1.proof || {}), status, text });
const score = variant('score', r => {
  const v1 = r.health.v1;
  Object.assign(v1, { shown: 'score', reason: null, headline: `${v1.score} ${v1.label} (method v1)`,
    proof: proofOf(v1, 'pass', 'Set by the test: the agent searched for less of the Served needs than of the other needs.') });
});
const notProven = variant('not-proven', r => {
  const v1 = r.health.v1;
  const reason = 'Set by the test: the proof has 6 Served needs, and it needs 10 or more.';
  Object.assign(v1, { shown: 'not-proven', reason, headline: `Score not proven (method v1). ${reason}`, proof: proofOf(v1, 'not-enough', 'Set by the test: 6 Served needs, 12 other needs.') });
});
// G12: a report of an older version: no `health.v1`, and no `question` on a fix.
const noV1 = variant('no-v1', r => {
  delete r.health.v1;
  for (const fix of [...r.fixes.list, ...r.fixes.smaller]) delete fix.question;
});
const pages = [main, thin, noData, score, notProven, noV1];
for (const page of pages.slice(1)) writeFileSync(path.join(artifact, `${page.name}.html`), page.html);

// ---------- helpers: the page as text ----------

const R = main.report;
const V = R.health.v1;
const unesc = text => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
const norm = text => String(text).replace(/\s+/g, ' ').trim();
// The text of a piece of HTML, as a person reads it. A text of the report: a span in backticks is a code element on the page.
const textOf = html => norm(unesc(html.replace(/<[^>]+>/g, ' ')));
const shownText = text => norm(String(text).replace(/`([^`]+)`/g, ' $1 '));
const sectionOf = (page, cls) => {
  const from = page.indexOf(`<section class="${cls}"`);
  assert.ok(from > 0, `the page has the section ${cls}`);
  return page.slice(from, page.indexOf('</section>', from));
};
const numberArea = page => sectionOf(page, 'health').split('<div class="hqs">')[0];
const classText = (html, cls) => [...html.matchAll(new RegExp(`<(\\w+) class="${cls}(?: [^"]*)?"[^>]*>([\\s\\S]*?)</\\1>`, 'g'))].map(match => textOf(match[2]));
const rowsOf = page => sectionOf(page, 'health').split('<div class="qrow" ').slice(1).map(part => {
  const head = part.match(/^data-q="(\w+)" data-n="(\d+)">\s*<button type="button" class="hq" aria-expanded="(\w+)" aria-controls="hd-(\w+)">([\s\S]*?)<\/button>\s*<div class="hd" id="hd-(\w+)"( hidden)?>/);
  assert.ok(head, `a row has a button and a detail: ${part.slice(0, 120)}`);
  const detail = part.slice(head[0].length);
  return { key: head[1], n: Number(head[2]), expanded: head[3], controls: head[4], button: head[5], id: head[6], hidden: Boolean(head[7]), detail, all: part,
    items: [...detail.matchAll(/<li class="hi[^"]*" data-item="([^"]*)">([\s\S]*?)<\/li>/g)].map(match => ({ kind: match[1], html: match[2], text: textOf(match[2]) })),
    fixes: [...detail.matchAll(/<li data-fix="([^"]+)" data-kind="([^"]+)">([\s\S]*?)<\/li>/g)].map(match => ({ id: match[1], kind: match[2], text: textOf(match[3]) })) };
});
const fixIds = html => [...html.matchAll(/<li data-fix="([^"]+)"/g)].map(match => match[1]);
const pageDataOf = page => JSON.parse(page.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
const questionOf = fix => (KEYS.includes(fix.question) ? fix.question : 'find');
const num = n => n.toLocaleString('en-US');

test('the runs give each state of the page', () => {
  assert.ok(V && typeof V === 'object', 'report.json of the main run has health.v1');
  assert.equal(typeof V.score, 'number', 'the main run has a score in report.json');
  assert.ok(['score', 'not-proven'].includes(V.shown), `the main run has enough data: ${V.shown}`);
  assert.equal(thin.report.health.v1.shown, 'thin');
  assert.equal(noData.report.health.v1.shown, 'no-data');
  assert.deepEqual([score, notProven].map(page => page.report.health.v1.shown), ['score', 'not-proven']);
  // The fixture gives each question something to show.
  const q = Object.fromEntries(V.questions.map(item => [item.key, item]));
  assert.ok(q.find.items.some(item => item.label === ORPHAN), 'the orphan is a Missed file');
  assert.ok(q.close.items.length >= 1, 'a file behind a folder link is Slow');
  assert.ok(q.told.items.some(item => item.saved === true) && q.told.items.some(item => item.saved === false), 'one typed rule is saved, one is not');
  assert.ok(q.lean.lines.length >= 1, 'question lean has its lines');
  assert.ok(R.fixes.list.length >= 2, 'the main run has fixes');
  writeFileSync(path.join(artifact, 'states.md'), ['# Step 12, part B: the state of each page', '', '| Page | From | data-shown | Headline |', '| --- | --- | --- | --- |',
    ...pages.map(page => `| ${page === main ? 'report.html' : `${page.name}.html`} | ${[main, thin, noData].includes(page) ? 'the real command' : 'report.json of the main run, changed by hand'} | ` +
      `${page.report.health.v1?.shown ?? 'no-data (no health.v1)'} | ${page.report.health.v1?.headline ?? ''} |`), ''].join('\n'));
});

test('G1, R2: with a score, the number area shows the number, the word, the method and the base', () => {
  const v1 = score.report.health.v1;
  const area = numberArea(score.html);
  assert.ok(score.html.includes('<section class="health" id="health" data-shown="score" data-method="v1"'));
  assert.deepEqual(classText(area, 'hscore'), [String(v1.score)]);
  assert.deepEqual(classText(area, 'hlabel'), [v1.label]);
  assert.deepEqual(classText(area, 'hmethod'), ['method v1']);
  assert.deepEqual(classText(area, 'hbase'), [v1.base.text]);
  assert.ok(!area.includes('class="hstate"') && !area.includes('class="hreason"'));
  // The real pages too: the state on the page is the state of report.json, and the method is there.
  for (const page of [main, thin, noData]) {
    assert.ok(page.html.includes(`<section class="health" id="health" data-shown="${page.report.health.v1.shown}" data-method="v1"`), page.name);
    assert.deepEqual(classText(numberArea(page.html), 'hmethod'), ['method v1'], page.name);
    assert.deepEqual(classText(numberArea(page.html), 'hbase'), [page.report.health.v1.base.text], page.name);
  }
});

test('G2: with no proof or thin data, the number area shows the number and a note with the state and the reason; with no data, the state and no number', () => {
  for (const page of [notProven, thin, noData, ...(V.shown === 'score' ? [] : [main])]) {
    const v1 = page.report.health.v1;
    const area = numberArea(page.html);
    assert.ok(v1.reason, `${page.name}: report.json has a reason`);
    if (typeof v1.score === 'number') {
      // The user asked for the number in each state. The state and the reason are a note under it.
      assert.deepEqual(classText(area, 'hscore'), [String(v1.score)], page.name);
      assert.ok(!area.includes('class="hstate"'), page.name);
      assert.ok(area.includes(`data-note="${v1.shown}"`), page.name);
      assert.ok(area.includes(STATE[v1.shown]), page.name);
    } else {
      assert.equal(v1.shown, 'no-data', page.name);
      assert.deepEqual(classText(area, 'hstate'), [STATE[v1.shown]], page.name);
      assert.deepEqual(classText(area, 'hreason'), [shownText(v1.reason)], page.name);
      for (const bad of ['class="hscore"', 'class="hv"', 'class="hlabel', '/ 100']) assert.ok(!area.includes(bad), `${page.name}: ${bad}`);
    }
  }
});

test('G3, G4, G5: the 4 questions are there in each state, in order, closed, each with its answer', () => {
  for (const page of pages) {
    const rows = rowsOf(page.html);
    const questions = page.report.health.v1?.questions;
    assert.deepEqual(rows.map(row => row.key), KEYS, page.name);
    for (const [k, row] of rows.entries()) {
      // G4: closed at the start, and the button names its detail.
      assert.equal(row.expanded, 'false', page.name);
      assert.equal(row.controls, row.key, page.name);
      assert.equal(row.id, row.key, page.name);
      assert.ok(row.hidden, `${page.name}: the detail of ${row.key} is closed`);
      if (!questions) { assert.deepEqual(classText(row.button, 'qa'), ['no data'], page.name); continue; }
      const q = questions[k];
      assert.equal(q.key, row.key, page.name);
      assert.deepEqual(classText(row.button, 'ask'), [q.title], page.name);
      assert.deepEqual(classText(row.button, 'qa'), [q.answer ?? 'no data'], `${page.name} ${row.key}`);
      // G5: each item of report.json is in the detail, in the same order, with its label, count and text.
      assert.equal(row.n, q.items.length, `${page.name} ${row.key}`);
      assert.equal(row.items.length, q.items.length, `${page.name} ${row.key}`);
      for (const [j, item] of q.items.entries()) {
        assert.equal(row.items[j].kind, item.kind, `${page.name} ${row.key} ${item.label}`);
        for (const part of [item.label, item.count, item.text].filter(Boolean)) assert.ok(row.items[j].text.includes(shownText(part)), `${page.name} ${row.key}: ${part}`);
      }
      const detail = textOf(row.detail);
      for (const line of q.lines) assert.ok(detail.includes(shownText(line)), `${page.name} ${row.key}: ${line}`);
    }
  }
  // G4: the page script opens one detail and closes the others (the click is a browser check by hand).
  assert.match(main.html, /health\.querySelectorAll\('\.hq'\)\.forEach\(function \(b\) \{\s*b\.setAttribute\('aria-expanded', 'false'\);/);
  // G5: the real not proven or thin pages show problems.
  for (const page of [notProven, thin]) assert.ok(rowsOf(page.html).some(row => row.items.length > 0), page.name);
});

test('G6, X1 on the page: each fix is one time under its question, and the smaller fixes are in one closed part', () => {
  for (const fix of [...R.fixes.list, ...R.fixes.smaller]) assert.ok(['find', 'close', 'told'].includes(fix.question), `fix ${fix.id} has a question in report.json`);
  for (const page of pages) {
    const fixes = page.report.fixes;
    const rows = rowsOf(page.html);
    for (const row of rows) {
      const want = fixes.list.filter(fix => questionOf(fix) === row.key);
      assert.deepEqual(row.fixes.map(fix => [fix.id, fix.kind]), want.map(fix => [fix.id, fix.kind]), `${page.name} ${row.key}`);
      for (const [k, fix] of want.entries()) assert.ok(row.fixes[k].text.includes(shownText(fix.text)), `${page.name}: the text of ${fix.id}`);
      // The fixes come after the items.
      if (want.length && row.items.length) assert.ok(row.detail.indexOf('data-fix=') > row.detail.lastIndexOf('data-item='), `${page.name} ${row.key}`);
    }
    assert.deepEqual(rows.find(row => row.key === 'lean').fixes, [], page.name);
    const part = sectionOf(page.html, 'fixes');
    assert.ok(part.startsWith(`<section class="fixes" id="fixes" data-fixes="${fixes.list.length}" data-smaller="${fixes.smaller.length}"`), page.name);
    assert.ok(page.html.indexOf('<section class="fixes"') > page.html.indexOf('<div class="hqs">'), `${page.name}: below the questions`);
    assert.deepEqual(fixIds(part), fixes.smaller.map(fix => fix.id), page.name);
    assert.equal(part.includes('<details class="hother" id="fix-smaller">'), fixes.smaller.length > 0, page.name);
    assert.ok(!/<details[^>]* open/.test(page.html), `${page.name}: each details part is closed`);
    assert.equal(part.includes('<p class="nofix">No fix from this data.</p>'), fixes.list.length + fixes.smaller.length === 0, page.name);
    // Each fix one time on the whole page (the prompt panel has no fix markup).
    assert.deepEqual(fixIds(page.html).sort(), [...fixes.list, ...fixes.smaller].map(fix => fix.id).sort(), page.name);
  }
  assert.equal(noData.report.fixes.list.length, 0, 'the no data run has no fix');
  // A page with smaller fixes: the same report with 2 fixes moved by hand.
  const moved = variant('smaller', r => { r.fixes.smaller = r.fixes.list.splice(-2); });
  const part = sectionOf(moved.html, 'fixes');
  assert.ok(part.includes('<details class="hother" id="fix-smaller"><summary>2 smaller items</summary>'));
  assert.deepEqual(fixIds(part), moved.report.fixes.smaller.map(fix => fix.id));
  assert.deepEqual(rowsOf(moved.html).flatMap(row => row.fixes.map(fix => fix.id)).sort(), moved.report.fixes.list.map(fix => fix.id).sort());
});

test('G7: question told shows each typed rule, says where a saved rule is, and shows no task fact', () => {
  const told = rowsOf(main.html).find(row => row.key === 'told');
  const items = V.questions[2].items;
  for (const [k, item] of items.entries()) {
    if (item.saved !== true) continue;
    assert.match(item.text, new RegExp(`already saved in ${item.savedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'report.json names the file of a saved rule');
    assert.ok(told.items[k].text.includes(`already saved in ${item.savedPath}`), item.label);
  }
  assert.ok(items.some(item => item.saved === true && item.savedPath === NOW), 'fact B is saved in notes/now.md');
  // The task fact is in report.json as a task fact only, and no question of the page has it.
  assert.equal(R.needs.taskFacts.count, 1);
  assert.equal(R.needs.taskFacts.list[0].text, FACT.T.text);
  const health = textOf(sectionOf(main.html, 'health'));
  for (const text of [FACT.T.text, FACT.T.quote]) assert.ok(!health.includes(text), text);
  assert.ok(textOf(told.detail).includes(FACT.A.text), 'a rule fact is there');
});

test('G8: question lean shows the tokens, the penalty lines and the unused items, the biggest first', () => {
  const lean = rowsOf(main.html).find(row => row.key === 'lean');
  const q = V.questions[3];
  const all = textOf(lean.all);
  assert.ok(all.includes(num(V.penalty.startTokens)), 'the start load tokens are in the row');
  for (const line of q.lines) assert.ok(all.includes(shownText(line)), line);
  assert.ok(lean.detail.indexOf('class="hline"') < (lean.detail.indexOf('data-item=') + 1 || Infinity), 'the lines come first');
  // The order of the page is the order of report.json, and report.json has the biggest first.
  assert.deepEqual(lean.items.map(item => item.kind), q.items.map(item => item.kind));
  for (const [k, item] of q.items.entries()) assert.ok(lean.items[k].text.includes(item.label) && lean.items[k].text.includes(item.count), item.label);
  const tokens = q.items.map(item => item.tokens).filter(n => typeof n === 'number');
  assert.deepEqual(tokens, [...tokens].sort((a, b) => b - a));
});

test('G9: question close gives the file and the line to change for each Slow file', () => {
  const close = rowsOf(main.html).find(row => row.key === 'close');
  const items = V.questions[1].items;
  assert.ok(items.some(item => item.label === DEPLOY || item.label === AMP), 'a file behind the folder link is Slow');
  for (const [k, item] of items.entries()) {
    assert.ok(item.target, `report.json has the file to change for ${item.label}`);
    assert.ok(close.items[k].text.includes(item.target), `${item.label}: the page names ${item.target}`);
    if (item.line != null) assert.ok(close.items[k].text.includes(`line ${item.line}`), `${item.label}: the page names line ${item.line}`);
  }
});

test('G10: no en dash, no em dash, no network, and each text is escaped', () => {
  // A report with HTML in each kind of text that the page writes as markup.
  const evil = '<img src=x onerror=alert(1)> \u2013 \u2014 "q" & `<b>code</b>`';
  const hostile = variant('hostile', r => {
    const v1 = r.health.v1;
    Object.assign(v1, { reason: evil, label: evil, method: 'v1', shown: 'not-proven' });
    v1.base.text = evil;
    v1.rules = evil;
    for (const q of v1.questions) { q.title = evil; q.answer = evil; q.lines = [evil]; q.items = [{ label: evil, count: evil, text: evil, path: null, kind: evil }]; }
    v1.proof = { ...proofOf(v1, evil, evil), notes: [evil], sessions: { used: 1, leftOut: [{ sessionId: 's', reason: evil, text: evil }] } };
    for (const fix of r.fixes.list) { fix.text = evil; fix.kind = evil; fix.id = `x"${fix.id}`; }
  });
  for (const page of [...pages, hostile]) {
    assert.ok(!/[\u2013\u2014]/.test(page.html), `${page.name}: a dash`);
    for (const bad of ['<link', 'src="http', 'fetch(', 'http://', 'https://', '<img', '<b>code']) assert.ok(!page.html.includes(bad), `${page.name}: ${bad}`);
  }
  assert.ok(hostile.html.includes('&lt;img src=x onerror=alert(1)&gt; - - &quot;q&quot; &amp; <code>&lt;b&gt;code&lt;/b&gt;</code>'));
  // The real run: the fact with a script element, and the file name with an ampersand.
  assert.ok(!sectionOf(main.html, 'health').includes('<script'), 'no script element in the score part');
  assert.ok(main.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'fact D is on the page as text');
  assert.ok(V.questions.some(q => q.items.some(item => item.label === AMP)) && main.html.includes('<code>guides/r&amp;d.md</code>'));
  assert.equal(main.html.split('</script>').length, 4, 'the page data, the page script and the copy script, no more');
});

test('G11: the 5 rows of step 11 are gone, and health.counts stays in report.json', () => {
  for (const page of pages) for (const bad of ['class="crow"', 'data-count=', 'hd-noRoute', 'hd-searched', 'hd-startLoad', 'hd-sessions', 'Context counts']) assert.ok(!page.html.includes(bad), `${page.name}: ${bad}`);
  assert.deepEqual(Object.keys(R.health.counts).filter(key => ['noRoute', 'searched', 'told', 'startLoad', 'sessions'].includes(key)), ['noRoute', 'searched', 'told', 'startLoad', 'sessions']);
  assert.equal(R.health.counts.noRoute.items.some(item => item.path === ORPHAN), true);
  // The base of the score stays reachable: a closed part with the sessions by reason.
  const base = main.html.match(/<details class="hother" id="base-detail"><summary>[^<]*<\/summary>([\s\S]*?)<\/details>/);
  assert.ok(base && numberArea(main.html).includes('id="base-detail"'));
  const s = R.health.counts.sessions;
  assert.ok(base[1].includes(`<li data-sessions="analysed"><b>${s.analysed}</b>`) && base[1].includes(`<li data-sessions="notAnalysed"><b>${s.notAnalysed}</b>`) && base[1].includes(`<li data-sessions="headless"><b>${s.headless}</b>`));
});

test('G12: a report with no health.v1 or with no data does not crash the page', () => {
  assert.ok(noV1.html.includes('<section class="health" id="health" data-shown="no-data" data-method="v1"'));
  assert.deepEqual(classText(numberArea(noV1.html), 'hstate'), ['No data']);
  assert.deepEqual(classText(numberArea(noV1.html), 'hreason'), ['This report has no v1 score.']);
  assert.ok(!numberArea(noV1.html).includes('class="hscore"'));
  // A fix with no question goes under "find".
  assert.deepEqual(rowsOf(noV1.html).map(row => row.fixes.length), [noV1.report.fixes.list.length, 0, 0, 0]);
  // The real run with no need: "No data" and the reason of report.json.
  const v1 = noData.report.health.v1;
  assert.equal(v1.score, null);
  assert.deepEqual(classText(numberArea(noData.html), 'hstate'), ['No data']);
  assert.deepEqual(classText(numberArea(noData.html), 'hreason'), [shownText(v1.reason)]);
  assert.ok(sectionOf(noData.html, 'fixes').includes('<p class="nofix">No fix from this data.</p>'));
  // Odd shapes do not crash: no health, no fixes, a question with no lists.
  for (const change of [r => { r.health = {}; delete r.fixes; }, r => { r.health.v1 = { shown: 'score', score: null, questions: [{ key: 'find' }, null] }; }, r => { r.health.v1.proof = null; r.health.v1.base = null; }]) {
    assert.deepEqual(rowsOf(variant('odd', change).html).map(row => row.key), KEYS);
  }
});

test('G13: the proof, the Copy markdown button, the prompt, the map and the list are on the page', () => {
  const snippet = readFileSync(path.join(repo, 'src', 'page', 'copy-markdown.html'), 'utf8');
  for (const page of pages) {
    assert.ok(page.html.endsWith(`${snippet}</body>\n</html>\n`), `${page.name}: the copy snippet is before the end of the body, not changed`);
    for (const part of ['id="copy-md-btn"', 'id="copy-prompt"', 'id="show-prompt"', '<section id="prompt" hidden', '<svg id="map"', 'id="switch"', 'id="chips"', 'id="list"', 'id="note"']) {
      assert.ok(page.html.includes(part), `${page.name}: ${part}`);
    }
  }
  // The page data holds the v1 object and the fixes of report.json.
  const data = pageDataOf(main.html);
  assert.deepEqual(data.health.v1, V);
  assert.deepEqual(data.fixes, R.fixes);
  assert.ok(textOf(main.html.match(/<section id="prompt"[\s\S]*?<\/section>/)[0]).length > 100, 'the prompt panel has the prompt');
  // The proof: one line near the number, and a closed part with the rates of each grade, the sessions left out and the notes.
  for (const page of [main, score, notProven]) {
    const v1 = page.report.health.v1;
    const area = numberArea(page.html);
    const p = v1.proof;
    assert.ok(p && p.text, `${page.name}: report.json has a proof text`);
    // The proof line shows one time: not when the reason line above it has the same sentence.
    assert.deepEqual(classText(area, 'hproof'), v1.reason && p.text.includes(v1.reason) ? [] : [p.text], page.name);
    const detail = area.match(/<details class="hother" id="proof" data-proof="([\w-]+)"><summary>[^<]*<\/summary>([\s\S]*?)<\/details>/);
    assert.ok(detail, `${page.name}: the closed proof part`);
    assert.equal(detail[1], p.status, page.name);
    const percent = rate => (typeof rate === 'number' ? `${Math.round(rate * 100)}%` : 'no data');
    for (const grade of ['served', 'slow', 'missed']) {
      const g = p.grades[grade];
      assert.ok(detail[2].includes(`<tr data-grade="${grade}"><th scope="row">${grade[0].toUpperCase()}${grade.slice(1)}</th><td>${num(g.needs)}</td><td>${percent(g.searchRate)}</td><td>${percent(g.typedFactRate)}</td></tr>`), `${page.name} ${grade}`);
    }
    const text = textOf(detail[2]);
    for (const note of p.notes) assert.ok(text.includes(note), `${page.name}: ${note}`);
    for (const left of p.sessions.leftOut) assert.ok(text.includes(left.text || left.reason), `${page.name}: ${left.reason}`);
  }
});
