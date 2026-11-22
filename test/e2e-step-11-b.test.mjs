// E2E for step 11, part B (the five counts and the page): run the real command on a git copy of fixtures/indoeuromap
// with its own settings home, the sessions that this file writes, and a copy of the fake claude binary with the
// answers that this file writes. No real model call. The A/B runs use fixtures/context-ab/apply.mjs.
// The ways it can fail are in the step 11 failure list ("Change 2": NC1 to NC14, PG1 to PG10) and in the list of
// worker B (B1 to B4). Each test names its cases. The expected numbers are worked out by hand in the comments.
// Artifact: out/e2e-step-11-b/report.json and report.html (the main run), no-data.html (a page with no data), and
// counts-cases.md (the 5 lines of each run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fixture = path.join(repo, 'fixtures', 'indoeuromap');
const repoSettings = path.join(repo, 'fixtures', 'claude-settings-home');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-indoeuromap';
const ID = n => `820000${String(n).padStart(2, '0')}-0000-0000-0000-000000000000`;
const RESEARCH_FILES = ['europe-expansion-2026-10-20', 'growth-metrics-2026-10-21', 'wave-1-finish-2026-10-20'].map(name => `data/research/${name}/README.md`);
const METHOD = 'pipeline/METHOD.md';
const ORPHAN = 'notes/orphan.md';
const NOW = 'notes/now.md';
const AMP = 'guides/r&d.md';
const DEPLOY = 'guides/deploy.md';
const SKILL_NONE = '.claude/skills/city-batch/SKILL.md';
const SKILL_SEARCH = '.claude/skills/geo-audit/SKILL.md';
const USER_SKILL = '~/.claude/skills/frontend-design/SKILL.md';
const USER_NOTES = '~/.claude/plugins/demo/skills/review/user-notes.md';
const SCRATCH = Array.from({ length: 12 }, (_, k) => `scratch/n${String(k + 1).padStart(2, '0')}.md`);

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const append = (file, text) => writeFileSync(file, `${readFileSync(file, 'utf8')}${text}`);
const lineOf = (file, part) => readFileSync(file, 'utf8').split('\n').findIndex(line => line.includes(part)) + 1;

// ---------- the project ----------

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step11b-'));
// M: a git copy of the fixture. The texts of the new files are invented.
// - notes/orphan.md: no file links it (line a). It holds the fact "The review window is 9 days.".
// - notes/now.md: CLAUDE.md links it. guides/deploy.md and guides/r&d.md: CLAUDE.md links only their folder.
// - CLAUDE.md gets a long last paragraph, so the start load is above 999 tokens (NC12).
// - scratch/: 12 notes that no context file names, and that the config file does not include: their reads are dropped.
const M = path.join(work, 'main', 'indoeuromap');
cpSync(fixture, M, { recursive: true });
for (const rel of RESEARCH_FILES) if (!existsSync(path.join(M, rel))) write(path.join(M, rel), `# ${rel.split('/')[2]}\n\nLocal research record.\n`);
append(path.join(M, 'CLAUDE.md'), `\nThe open work is in [notes/now.md](notes/now.md).\nThe how-to guides are in [guides/](guides/).\n\n${'The team writes one short note for each run. '.repeat(160)}\n`);
write(path.join(M, NOW), '# Now\n\n- The city page title is open.\n- The batch size is 40 cities for each run.\n');
write(path.join(M, AMP), '# R&D\n\nThe research notes of the team.\n');
write(path.join(M, DEPLOY), '# Deploy\n\nRun the build first.\n');
write(path.join(M, ORPHAN), '# Orphan\n\nNo file links to this note.\nThe review window is 9 days.\n');
for (const rel of SCRATCH) write(path.join(M, rel), `# ${rel}\n\nA scratch note.\n`);
execFileSync('git', ['-C', M, 'init', '-q']);
execFileSync('git', ['-C', M, 'add', '-A']);
// The config file keeps the lost files as context files (with the rule alone, a file that no file names is out).
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
const mStart = [{ path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
  { path: abs('CLAUDE.md'), content: readFileSync(path.join(M, 'CLAUDE.md'), 'utf8'), type: 'Project' }];

// Items: { user }, { agent }, { read: full path, text }, { grep: pattern, files: [full paths] }.
// `entrypoint: 'sdk-cli'` on each record makes a headless file. No item with `user` makes a file with no user message.
function writeSession(home, sessionId, start, items, entrypoint = 'cli') {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: mStart } })];
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

// ----- HM: the home of the main run. 7 sessions, 1 headless file, 1 file with no user message, a memory folder. -----
const HM = makeHome('main');
const FOLDER = M.replace(/[^A-Za-z0-9]/g, '-');
const MEMORY = `~/.claude/projects/${FOLDER}/memory`;
const LEGEND = `${MEMORY}/legend.md`;
const memAbs = name => `${HOME}/.claude/projects/${FOLDER}/memory/${name}`;
const memoryFiles = { 'MEMORY.md': '# Memory index\n\n- [Legend](legend.md): the colours of the legend\n', 'legend.md': 'The legend uses blue and orange.\n' };
for (const [name, text] of Object.entries(memoryFiles)) write(path.join(HM, 'projects', FOLDER, 'memory', name), text);
const userNotesText = '# User notes\n\nA note that is not in the project.\n';
write(path.join(HM, 'plugins', 'demo', 'skills', 'review', 'user-notes.md'), userNotesText);
const userSkillText = readFileSync(path.join(repoSettings, 'skills', 'frontend-design', 'SKILL.md'), 'utf8');
const legendRead = { read: memAbs('legend.md'), text: memoryFiles['legend.md'] };

// S1: the orphan by a search (NC2: no route, so line a only). Then 4 reads with nothing that named the path (NC3): a
// skill body (the skill list names it), a memory file (the index links it), CLAUDE.md (in the start load), and
// AGENTS.md then METHOD.md by links.
writeSession(HM, ID(1), day(21), [
  { user: 'Fix the title of the Berlin city page.' },
  ...searchOf('Orphan', ORPHAN), readOf(SKILL_NONE), legendRead, readOf('CLAUDE.md'), readOf('AGENTS.md'), readOf(METHOD), ...done]);
// S2: 5 files with a route, each found by a search (NC2, NC3, NC4): METHOD.md (AGENTS.md names it), the same memory
// file, a skill body (a trigger), guides/deploy.md and guides/r&d.md (a folder link). The orphan with no name.
writeSession(HM, ID(2), day(20), [
  { user: 'Check the method.' },
  ...searchOf('method', METHOD), readOf(ORPHAN), { grep: 'legend', files: [memAbs('legend.md')] }, legendRead,
  ...searchOf('audit', SKILL_SEARCH), ...searchOf('build', DEPLOY), ...searchOf('research', AMP), ...done]);
// S3: the user gives the path of the orphan. A user skill (1 step, NC14), a user file with no route (NC14), and the
// 12 scratch notes (dropped reads, B2).
writeSession(HM, ID(3), day(19), [
  { user: `Read ${ORPHAN} and the user notes.` },
  readOf(ORPHAN), { read: `${HOME}/.claude/skills/frontend-design/SKILL.md`, text: userSkillText },
  { read: `${HOME}/.claude/plugins/demo/skills/review/user-notes.md`, text: userNotesText },
  ...SCRATCH.map(readOf), ...done]);
// S4: 2 intents. The first reads AGENTS.md and the orphan. The second reads AGENTS.md again: it is in the context (NC3).
writeSession(HM, ID(4), day(18), [
  { user: 'Read the rules.' }, readOf('AGENTS.md'), readOf(ORPHAN), { agent: 'Done.' },
  { user: 'Now check the rules for the batch.' }, readOf('AGENTS.md'), { agent: 'Done.' }]);
// S5 and S6: the told facts (NC5, PG5). A: "Never ship on a Friday" in 2 intents, in no file. B: the batch size, now in
// notes/now.md (a route). C: the review window, now in notes/orphan.md (no route). D: a fact with a script element.
const FACT = {
  A: { text: 'Never ship on a Friday', quote: 'Never ship on a Friday.' },
  B: { text: 'The batch size is 40 cities for each run', quote: 'The batch size is 40 cities for each run.' },
  C: { text: 'The review window is 9 days', quote: 'The review window is 9 days.' },
  D: { text: 'No page uses <script>alert(1)</script>', quote: 'Use <script>alert(1)</script> in no page.' }
};
writeSession(HM, ID(5), day(17), [
  { user: 'Set the batch for the next run.' }, { agent: 'The batch is 20 cities.' },
  { user: FACT.B.quote }, { agent: 'Ok. The review window is 5 days.' },
  { user: FACT.C.quote }, { agent: 'Ok. I ship it on Friday.' },
  { user: FACT.A.quote }, { agent: 'Ok. I add a script element.' },
  { user: FACT.D.quote }, { agent: 'Ok.' }]);
writeSession(HM, ID(6), day(16), [
  { user: 'Draft the launch post.' }, { agent: 'The post goes out on Friday.' }, { user: FACT.A.quote }, { agent: 'Ok.' }]);
// S7: the fake binary has no answer for it, so it is not analysed (NC7).
writeSession(HM, ID(7), day(15), [{ user: 'Read the plan.' }, readOf('second-iteration/plan.md'), ...done]);
writeSession(HM, ID(8), day(10), [{ user: 'A headless run.' }, { agent: 'Done.' }], 'sdk-cli');
writeSession(HM, ID(9), day(9), [{ agent: 'No user message here.' }]);

// ----- HE: one analysed session that reads no file (NC8, no-needs). -----
const HE = makeHome('no-needs');
writeSession(HE, ID(11), day(21), [{ user: 'Say hello.' }, { agent: 'Hello.' }, { user: 'Thanks.' }]);

// ---------- the fake binary and its answers ----------

const fakeRoot = path.join(work, 'fake');
const fake = path.join(fakeRoot, 'test', 'fake-claude.mjs');
mkdirSync(path.dirname(fake), { recursive: true });
copyFileSync(path.join(repo, 'test', 'fake-claude.mjs'), fake);
chmodSync(fake, 0o755);
const answer = (name, result) => write(path.join(fakeRoot, 'fixtures', 'fake-claude', name), `${JSON.stringify({ total_cost_usd: 0.01, result }, null, 2)}\n`);
const intent = (start, goal, corrections = []) => ({ start, goal, corrections: corrections.map(([message, fact]) => ({ message, ...fact, cause: 'missing-context' })) });
answer(`${ID(1)}.intents.json`, { intents: [intent(1, 'Fix the title of the Berlin city page')] });
answer(`${ID(2)}.intents.json`, { intents: [intent(1, 'Check the method')] });
answer(`${ID(3)}.intents.json`, { intents: [intent(1, 'Read the orphan note and the user notes')] });
answer(`${ID(4)}.intents.json`, { intents: [intent(1, 'Read the rules'), intent(2, 'Check the rules for the batch')] });
answer(`${ID(5)}.intents.json`, { intents: [intent(1, 'Set the batch for the next run', [[2, FACT.B], [3, FACT.C], [4, FACT.A], [5, FACT.D]])] });
answer(`${ID(6)}.intents.json`, { intents: [intent(1, 'Draft the launch post', [[2, FACT.A]])] });
answer(`${ID(11)}.intents.json`, { intents: [intent(1, 'Say hello')] });
const check = (correction, now = null) => ({ correction, found: false, path: null, quote: null, now });
answer(`${ID(5)}.needs-check.json`, { checks: [check('c1', { path: NOW, quote: 'The batch size is 40 cities for each run.' }),
  check('c2', { path: ORPHAN, quote: 'The review window is 9 days.' }), check('c3'), check('c4')] });
answer(`${ID(6)}.needs-check.json`, { checks: [check('c1')] });

// ---------- the runs ----------

const runs = [];
function run(name, home, { old = true, intents = true, out = path.join(work, 'out', name) } = {}) {
  mkdirSync(out, { recursive: true });
  const args = [cli, M, '--claude-settings-home', home, '--out', out, '--cache', path.join(work, 'cache', name), '--no-open', '--no-save', '--config', CONFIG];
  if (old) args.push('--old-path', OLD);
  if (intents) args.push('--intents');
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake } });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  const entry = { name, stdout: result.stdout, json: readFileSync(path.join(out, 'report.json'), 'utf8'), html: readFileSync(path.join(out, 'report.html'), 'utf8') };
  entry.report = JSON.parse(entry.json);
  runs.push(entry);
  return entry;
}
const artifact = path.join(repo, 'out', 'e2e-step-11-b');
const main = run('main', HM, { out: artifact });
const notAnalysed = run('not-analysed', HM, { intents: false });
const noSessions = run('no-sessions', HM, { old: false, intents: false });
const noNeeds = run('no-needs', HE);
// NC10: the A/B fixture, the same 6 sessions on each version.
function ab(version) {
  const out = path.join(work, 'out', `ab-${version}`);
  const result = spawnSync('node', [path.join(repo, 'fixtures', 'context-ab', 'apply.mjs'), version, '--out', out], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  assert.equal(result.status, 0, `ab ${version}: ${result.stderr}`);
  const entry = { name: `ab-${version}`, stdout: result.stdout, json: readFileSync(path.join(out, 'report.json'), 'utf8'), html: readFileSync(path.join(out, 'report.html'), 'utf8') };
  entry.report = JSON.parse(entry.json);
  runs.push(entry);
  return entry;
}
const abBad = ab('bad');
const abBetter = ab('better');
const abC1 = ab('C1');

// ---------- helpers for the checks ----------

const R = main.report;
const C = R.health.counts;
const unesc = text => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
// The text of a piece of HTML, as a person reads it.
const textOf = html => unesc(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const sectionOf = (page, cls) => {
  const from = page.indexOf(`<section class="${cls}"`);
  assert.ok(from > 0, `the page has the section ${cls}`);
  return page.slice(from, page.indexOf('</section>', from));
};
// The 5 rows of the page: the key, the button, the detail, and what comes after the detail.
const rowsOf = page => sectionOf(page, 'health').split('<div class="crow" ').slice(1).map(part => {
  const head = part.match(/^data-count="(\w+)" data-n="(\d*)">\s*(<button type="button" class="hq" aria-expanded="(\w+)" aria-controls="hd-(\w+)">([\s\S]*?)<\/button>)\s*<div class="hd" id="hd-(\w+)"( hidden)?>/);
  assert.ok(head, `a row has a button and a detail: ${part.slice(0, 120)}`);
  const rest = part.slice(head[0].length);
  return { key: head[1], n: head[2], expanded: head[4], controls: head[5], button: head[6], id: head[7], hidden: Boolean(head[8]), detail: rest.split('<p class="hdata')[0], all: part };
});
const rowOf = (page, key) => rowsOf(page).find(row => row.key === key);
const pageDataOf = page => JSON.parse(page.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
const num = n => n.toLocaleString('en-US');
const KEYS = ['noRoute', 'searched', 'told', 'startLoad', 'sessions'];
const searchedItem = rel => {
  const found = C.searched.items.filter(item => item.path === rel);
  assert.equal(found.length, 1, `${rel} is in line b one time`);
  return found[0];
};

test('the runs work, and the folders above the temp folder have no instruction file', () => {
  assert.ok(!work.startsWith(`${os.homedir()}${path.sep}`), 'the temp folder is not under the home folder');
  for (let dir = work; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/CLAUDE.md', '.claude/AGENTS.md']) {
      assert.ok(!existsSync(path.join(dir, name)), `${path.join(dir, name)} changes the start load of each test project`);
    }
  }
  const status = Object.fromEntries(R.intents.sessions.map(entry => [entry.sessionId, entry.status]));
  for (const n of [1, 2, 3, 4, 5, 6]) assert.equal(status[ID(n)], 'ok', `session ${n} is analysed`);
  assert.notEqual(status[ID(7)], 'ok', 'session 7 has no answer');
  assert.equal(C.reason, null);
});

// ---------- the counts (the numbers come from src/health.mjs and src/found.mjs; the page shows them) ----------

test('NC1, NC2, NC13: line a counts each file one time, and it agrees with the old Found', () => {
  // The orphan: 4 intents need it (S1 by a search, S2 with no name, S3 from the user, S4). It is 1 file of line a.
  // The user notes: 1 intent. So line a has 2 files and 5 needs.
  assert.deepEqual(C.noRoute.items, [{ path: ORPHAN, uses: 4 }, { path: USER_NOTES, uses: 1 }]);
  assert.equal(C.noRoute.files, 2);
  assert.equal(C.noRoute.needs, 5);
  assert.equal(C.noRoute.text, '2 needed files have no route');
  // M: the distinct needed files. Each file of the 2 lists is one of them, and no file is in both lists.
  const needed = new Set(R.routes.intents.flatMap(item => item.needs.map(need => need.path)));
  assert.equal(C.needs.files, needed.size);
  assert.equal(C.noRoute.of, needed.size);
  assert.equal(C.searched.of, needed.size);
  assert.equal(C.noRoute.base, `of ${needed.size} needed files`);
  const a = C.noRoute.items.map(item => item.path);
  const b = C.searched.items.map(item => item.path);
  assert.equal(new Set([...a, ...b]).size, a.length + b.length, 'no file is in line a and in line b, or 2 times in one line');
  assert.ok(!b.includes(ORPHAN), 'a file with no route that the agent found by search is in line a only');
  // NC13
  assert.deepEqual([...a].sort(cmp), R.health.parts.found.lost.map(item => item.path).sort(cmp));
});

test('NC2, NC3: line b has only the files that the agent searched for', () => {
  // S2 found 5 files with a route by a search. Each is in line b one time.
  assert.deepEqual(C.searched.items.map(item => item.path).sort(cmp), [SKILL_SEARCH, DEPLOY, AMP, METHOD, LEGEND].sort(cmp));
  assert.equal(C.searched.files, 5);
  assert.equal(C.searched.text, '5 needed files have a route, but the agent searched');
  // METHOD.md: S1 by links, S2 by a search. The memory file: S1 with no name (the index links it), S2 by a search.
  for (const rel of [METHOD, LEGEND]) {
    const item = searchedItem(rel);
    assert.equal(item.uses, 2, rel);
    assert.equal(item.searched, 1, rel);
    assert.deepEqual(item.ways, { search: 1, user: 0, none: 0 }, rel);
  }
  // NC3: none of these is in line b: a skill body with no name, a start load file, a repeat read, a user skill.
  for (const rel of [SKILL_NONE, 'CLAUDE.md', 'AGENTS.md', USER_SKILL]) assert.ok(!C.searched.items.some(item => item.path === rel), rel);
});

test('NC4: each item of line b says where the link is', () => {
  const claude = path.join(M, 'CLAUDE.md');
  // A link in a named file: AGENTS.md links METHOD.md.
  const method = searchedItem(METHOD);
  const line = lineOf(path.join(M, 'AGENTS.md'), METHOD);
  assert.deepEqual(method.linker, { path: 'AGENTS.md', line, via: 'link', named: true });
  assert.equal(method.why, `AGENTS.md (line ${line}) links it. The link text must say when to read it.`);
  // A folder link names only the folder.
  for (const rel of [DEPLOY, AMP]) {
    const item = searchedItem(rel);
    assert.equal(item.linker.via, 'folder');
    assert.equal(item.why, `CLAUDE.md (line ${lineOf(claude, '[guides/]')}) links only its folder. The link must name the file and say when to read it.`);
  }
  // A trigger names the description.
  const skill = searchedItem(SKILL_SEARCH);
  assert.equal(skill.linker.via, 'trigger');
  assert.match(skill.why, /trigger\. The description of its skill, command or agent must say when to use it\.$/);
  // The memory index links the memory file.
  assert.match(searchedItem(LEGEND).why, /MEMORY\.md \(line 3\) links it\. The link text must say when to read it\.$/);
});

test('NC5: line c counts distinct facts, and a saved fact needs a route', () => {
  // 4 facts: A (2 intents), B (saved in notes/now.md, a route), C (in notes/orphan.md, no route), D.
  assert.equal(C.told.facts, 4);
  assert.equal(C.told.saved, 1);
  assert.equal(C.told.text, '4 facts you had to type (1 already saved)');
  const found = R.health.parts.found;
  assert.deepEqual(found.saved.map(item => [item.text, item.path]), [[FACT.B.text, NOW]]);
  assert.deepEqual(found.told.map(item => [item.text, item.uses]).sort((a, b) => cmp(a[0], b[0])),
    [[FACT.A.text, 2], [FACT.D.text, 1], [FACT.C.text, 1]].sort((a, b) => cmp(a[0], b[0])));
  assert.equal(found.told.find(item => item.text === FACT.C.text).savedPath, ORPHAN);
});

test('NC6, NC12: line d is the start load, with its 3 biggest items', () => {
  for (const { report } of runs) {
    const c = report.health.counts.startLoad;
    assert.equal(c.tokens, report.totals.startLoadTokens);
    assert.equal(c.text, `Start load: ${num(c.tokens)} tokens`);
    const top = report.startLoad.filter(item => item.tokens != null).sort((a, b) => b.tokens - a.tokens || cmp(a.path, b.path)).slice(0, 3);
    assert.deepEqual(c.top.map(item => [item.path, item.tokens]), top.map(item => [item.path, item.tokens]));
    assert.ok(c.top.every(item => typeof item.tokens === 'number'));
  }
  // The main project has 2 MCP servers with no token count, and a start load above 999 tokens.
  assert.ok(R.startLoad.some(item => item.tokens == null));
  assert.match(C.startLoad.text, /^Start load: \d,\d{3} tokens$/);
});

test('NC7: line e adds up', () => {
  // 7 session files are read (6 analysed, 1 with no answer), 1 is headless, 1 has no user message.
  // `other` counts the skipped files with another reason: this fixture has none.
  assert.deepEqual(Object.keys(C.sessions), ['analysed', 'total', 'read', 'notAnalysed', 'headless', 'noUserMessage', 'other', 'text']);
  assert.deepEqual({ ...C.sessions, text: undefined }, { analysed: 6, total: 9, read: 7, notAnalysed: 1, headless: 1, noUserMessage: 1, other: 0, text: undefined });
  assert.equal(C.sessions.text, 'From 6 of 9 sessions (1 headless skipped, 1 with no user message, 1 not analysed)');
  for (const { report } of runs) {
    const s = report.health.counts.sessions;
    assert.equal(s.total, report.sessions.list.length + report.sessions.skipped.length);
    assert.equal(s.analysed + s.notAnalysed + s.headless + s.noUserMessage + s.other, s.total);
    const known = report.sessions.skipped.filter(item => item.reason === 'headless' || item.reason === 'no-user-message').length;
    assert.equal(s.other, report.sessions.skipped.length - known, 'other is each skipped file with another reason');
  }
});

test('NC8, B4: no data', () => {
  for (const [entry, reason] of [[noSessions, 'no-sessions'], [notAnalysed, 'not-analysed'], [noNeeds, 'no-needs']]) {
    const c = entry.report.health.counts;
    assert.equal(c.reason, reason);
    assert.deepEqual([c.noRoute.files, c.searched.files, c.told.facts, c.told.saved, c.needs.files], [null, null, null, null, null], reason);
    assert.equal(typeof c.startLoad.tokens, 'number');
    assert.equal(typeof c.sessions.total, 'number');
    for (const key of ['noRoute', 'searched', 'told']) assert.match(c[key].text, /: no data$/);
    // Step 12: the page says "No data" in the number area, with one reason line (test/e2e-step-12-b.test.mjs).
    assert.ok(sectionOf(entry.html, 'health').includes('data-shown="no-data"'), reason);
    assert.equal(entry.html.split('<p class="hreason"').length, 2, reason);
  }
  assert.equal(noSessions.report.health.counts.sessions.text, 'From 0 of 0 sessions');
});

test('NC9: the old keys of health keep their shape, and counts comes after them (step 12: then v1)', () => {
  for (const { report } of runs) {
    assert.deepEqual(Object.keys(report.health), ['method', 'weights', 'score', 'label', 'reason', 'parts', 'data', 'counts', 'v1']);
    assert.deepEqual(Object.keys(report.health.parts), ['found', 'close', 'oneSource']);
    assert.deepEqual(Object.keys(report.health.counts), ['reason', 'needs', 'noRoute', 'searched', 'told', 'startLoad', 'sessions']);
  }
  assert.equal(typeof R.health.score, 'number');
  assert.ok(['good', 'mixed', 'poor'].includes(R.health.label));
  assert.deepEqual(Object.keys(R.health.data), ['sessions', 'analysed', 'needs', 'thin', 'limits', 'skipped', 'note', 'skippedNote']);
  assert.equal(noSessions.report.health.score, null);
  assert.equal(noSessions.report.health.reason, 'no-sessions');
});

test('NC10, NC12: the counts move when the context changes', () => {
  const [bad, better, c1] = [abBad, abBetter, abC1].map(entry => entry.report.health.counts);
  assert.equal(bad.noRoute.files, 1);
  assert.equal(better.noRoute.files, 0);
  assert.ok(better.searched.files <= bad.searched.files + 1, 'the file that gets a route moves to line b: the sessions are recordings');
  assert.ok(c1.startLoad.tokens > bad.startLoad.tokens);
  // NC12: one file and no file.
  assert.equal(bad.noRoute.text, '1 needed file has no route');
  assert.equal(better.noRoute.text, '0 needed files have no route');
  assert.deepEqual([bad.noRoute.base, better.noRoute.base], ['of 6 needed files', 'of 6 needed files']);
});

test('NC11: the command prints the 5 counts, and no score', () => {
  for (const { stdout, name } of [main, noSessions, notAnalysed, noNeeds]) {
    const lines = stdout.split('\n');
    assert.equal(lines.filter(line => line.startsWith('counts:')).length, 1, name);
    assert.ok(!lines.some(line => /^(score|health):/.test(line)), name);
  }
  const line = main.stdout.split('\n').find(item => item.startsWith('counts:'));
  for (const part of ['2 of 11 needed files with no route', '5 with a route but searched', '4 facts typed (1 saved)', `start load ${num(C.startLoad.tokens)} tokens`, '6 of 9 sessions']) {
    assert.ok(line.includes(part), `${line} has "${part}"`);
  }
});

test('NC14: a needed file outside the project', () => {
  // The user skill is 1 step from the start (the skill list). It is not in line a and not in line b.
  assert.ok(R.routes.intents.some(item => item.needs.some(need => need.path === USER_SKILL)), 'the user skill is a need');
  assert.ok(![...C.noRoute.items, ...C.searched.items].some(item => item.path === USER_SKILL));
  // The user file with no route is in line a, and its text says that it is outside the project.
  const lost = R.health.parts.found.lost.find(item => item.path === USER_NOTES);
  assert.match(`${lost.why} ${lost.fix}`, /outside the project/);
});

// ---------- the page ----------

// Step 12: the 5 rows are not on the page any more. The page shows the v1 score and its 4 questions:
// test/e2e-step-12-b.test.mjs has the checks of that markup. The checks of report.json stay here.
test('PG1: the score part is at the top, and the base of each count stays in report.json', () => {
  for (const { html, report, name } of runs) {
    const c = report.health.counts;
    assert.ok(html.indexOf('<section class="health"') < html.indexOf('<div class="grid">'), 'the score part is above the map');
    assert.ok(html.indexOf('<section class="health"') < html.indexOf('<section class="fixes"'), 'the smaller fixes are below the score part');
    assert.ok(!html.includes('class="crow"'), name);
    if (c.reason == null) for (const key of ['noRoute', 'searched']) assert.match(c[key].base, /^of \d+ needed files?$/);
  }
  // 11 distinct needed files: the orphan, the user notes, 5 searched files, 2 skill bodies, CLAUDE.md and AGENTS.md.
  assert.deepEqual([C.noRoute.text, C.noRoute.base], ['2 needed files have no route', 'of 11 needed files']);
});

test('PG1: thin data', () => {
  // The A/B fixture has 6 analysed sessions and 19 needs (fewer than 20): the data is thin.
  const data = abBad.report.health.data;
  assert.equal(data.thin, true);
  assert.equal(R.health.data.thin, false);
  // Step 12: the page has no thin data line of its own. The number area gives the state and the reason of health.v1.
  for (const { html, report, name } of runs) {
    assert.ok(!html.includes('data-thin'), name);
    assert.ok(sectionOf(html, 'health').includes(`data-shown="${report.health.v1.shown}"`), name);
  }
});

test('PG2: no markup of the step 9 score', () => {
  // Step 12: the number and its word are on the page again (health.v1). The markup of the step 9 score is not.
  for (const { html, name } of runs) {
    for (const old of ['data-health', 'data-label', 'data-part-score', 'No score yet']) assert.ok(!html.includes(old), `${name}: ${old}`);
  }
});

test('PG3, B1: each row is a closed button, and a detail has a max height', () => {
  for (const { html, name } of runs) {
    // Step 12: 4 questions, each a closed button with a hidden detail.
    assert.equal((html.match(/class="hq"/g) || []).length, 4, name);
    assert.equal((html.match(/<button type="button" class="hq" aria-expanded="false" aria-controls="hd-\w+">/g) || []).length, 4, name);
    assert.equal((html.match(/<div class="hd" id="hd-\w+" hidden>/g) || []).length, 4, name);
  }
  // The script: a click on a row closes each row, then opens the row when it was closed.
  const script = main.html;
  assert.match(script, /health\.querySelectorAll\('\.hq'\)\.forEach\(function \(b\) \{\s*b\.setAttribute\('aria-expanded', 'false'\);\s*document\.getElementById\(b\.getAttribute\('aria-controls'\)\)\.hidden = true;/);
  assert.match(script, /if \(!open\) \{ q\.setAttribute\('aria-expanded', 'true'\); document\.getElementById\(q\.getAttribute\('aria-controls'\)\)\.hidden = false; \}/);
  // B1: a long detail scrolls inside its own box.
  assert.match(main.html, /\.hd \{[^}]*max-height: \d+px; overflow-y: auto;[^}]*\}/);
  assert.match(main.html, /\.hd\[hidden\] \{ display: none; \}/);
});

// Step 12: the details of rows a, b, c and d are not on the page any more (PG4 a to d). The items of the 4 questions come
// from health.v1: test/e2e-step-12-b.test.mjs checks them.

test('PG4 e, B2: the session reasons and the dropped reads', () => {
  // Step 12: the detail of the old row e is a closed part of the number area.
  const baseOf = page => page.match(/<details class="hother" id="base-detail"><summary>[^<]*<\/summary>([\s\S]*?)<\/details>/)[1];
  const detail = baseOf(main.html);
  const reasons = Object.fromEntries([...detail.matchAll(/<li data-sessions="(\w+)"><b>([\d,]+)<\/b>/g)].map(match => [match[1], Number(match[2])]));
  assert.deepEqual(reasons, { analysed: 6, notAnalysed: 1, headless: 1, noUserMessage: 1 });
  // The 12 scratch notes: no context file names them, so their reads are dropped.
  const dropped = R.needs.dropped;
  assert.equal(dropped.byReason['not-linked'].files, 12);
  assert.ok(detail.includes(`data-dropped="${dropped.reads}"`));
  const blocks = [...detail.matchAll(/<li class="hi" data-reason="([^"]*)"><div class="what">([^<]*)<\/div><ul class="hsub">([\s\S]*?)<\/ul><\/li>/g)];
  assert.deepEqual(blocks.map(match => match[1]), Object.keys(dropped.byReason));
  for (const match of blocks) {
    const count = dropped.byReason[match[1]];
    assert.ok(match[2].endsWith(`: ${count.reads} read${count.reads === 1 ? '' : 's'} of ${count.files} file${count.files === 1 ? '' : 's'}`), match[2]);
    const files = [...match[3].matchAll(/<li><code>([^<]*)<\/code>/g)].map(item => unesc(item[1]));
    assert.equal(files.length, Math.min(count.files, 10), 'B2: 10 files at most for each reason');
    for (const rel of files) assert.ok(dropped.list.some(item => item.path === rel && item.reason === match[1]), rel);
    assert.equal(match[3].includes('and '), count.files > 10);
  }
  const notLinked = blocks.find(match => match[1] === 'not-linked');
  assert.ok(notLinked[2].startsWith('No context file names it: '));
  assert.ok(notLinked[3].includes('<span class="m more">and 2 more</span>'));
  // No dropped read: one line says so.
  assert.ok(textOf(baseOf(abBad.html)).endsWith('No read was dropped.'));
});

test('PG5: text from a session or a path does not break the page', () => {
  const body = main.html.slice(main.html.indexOf('<body>'), main.html.indexOf('<script type="application/json"'));
  assert.ok(!body.includes('<script>alert'), 'the told fact makes no script element');
  assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!main.html.slice(main.html.indexOf('id="page-data"')).includes('<script>alert'), 'the page data has no script element');
  assert.ok(!body.includes('r&d.md'), 'the file name with & is escaped');
  assert.ok(body.includes('guides/r&amp;d.md'));
  // 4 script elements: the page data, the page script, and the 2 of the Copy markdown snippet at most.
  const expected = 2 + (readFileSync(path.join(repo, 'src', 'page', 'copy-markdown.html'), 'utf8').match(/<script/g) || []).length;
  assert.equal((main.html.match(/<script/g) || []).length, expected);
  assert.ok(pageDataOf(main.html).health.parts.found.told.some(item => item.quote === FACT.D.quote));
});

test('PG6: the fixes of the page are the fixes of report.fixes', () => {
  // Step 12: each fix of the list is under its question in the score part, with its number. The smaller items are in the fixes part.
  const li = /<li data-fix="([^"]*)" data-kind="([^"]*)"><div class="ft">([\s\S]*?)<\/div>(?:<div class="m">([^<]*)<\/div>)?<\/li>/g;
  for (const { html, report, name } of runs) {
    const f = report.fixes;
    const section = sectionOf(html, 'fixes');
    assert.ok(f.list.length <= f.limit, name);
    assert.ok(section.includes(`data-fixes="${f.list.length}" data-smaller="${f.smaller.length}"`), name);
    const split = section.indexOf('<details');
    const byId = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const list = [...sectionOf(html, 'health').matchAll(li)].sort((a, b) => byId([a[1]], [b[1]]));
    const want = [...f.list].sort((a, b) => byId([a.id], [b.id]));
    assert.deepEqual(list.map(match => [match[1], match[2], textOf(match[3].replace(/<b class="fn">\d+\.<\/b>/, '').replace(/<\/?code>/g, ""))]), want.map(fix => [fix.id, fix.kind, fix.text.replace(/`/g, '').replace(/\s+/g, ' ').trim()]), name);
    list.forEach((match, k) => { if (typeof want[k].needs === 'number') assert.ok(match[4].startsWith(`Covers ${num(want[k].needs)} need`), name); });
    for (const match of list) assert.ok(match[3].startsWith(`<b class="fn">${f.list.findIndex(fix => fix.id === match[1]) + 1}.</b> `), 'each fix of the list has its number');
    if (f.smaller.length) {
      const more = section.slice(split);
      assert.ok(more.startsWith(`<details class="hother" id="fix-smaller"><summary>${f.smaller.length} smaller item${f.smaller.length === 1 ? '' : 's'}</summary>`), name);
      assert.deepEqual([...more.matchAll(li)].map(match => match[1]), f.smaller.map(fix => fix.id), name);
    } else assert.equal(split, -1, name);
    assert.equal(section.includes('<p class="nofix">No fix from this data.</p>'), !f.list.length && !f.smaller.length, name);
  }
  // A run with no data has no fix.
  assert.ok(sectionOf(noSessions.html, 'fixes').includes('No fix from this data.'));
});

test('PG8, PG9: the Copy markdown snippet, no network, no dash', () => {
  const snippet = readFileSync(path.join(repo, 'src', 'page', 'copy-markdown.html'), 'utf8');
  for (const { html, name } of runs) {
    assert.ok(html.endsWith(`${snippet}</body>\n</html>\n`), `${name}: the snippet is the last thing in the body`);
    assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//.test(html), `${name}: no http source`);
    assert.ok(!/@import|url\(\s*["']?http/.test(html), name);
    assert.ok(!/[\u2013\u2014]/.test(html), `${name}: no en dash and no em dash`);
    assert.ok(html.includes('color-scheme: light'), name);
  }
});

test('PG10, B3: the page data holds health, fixes and the dropped reads', () => {
  for (const { html, report, name } of runs) {
    const data = pageDataOf(html);
    assert.deepEqual(data.health, report.health, name);
    assert.deepEqual(data.fixes, report.fixes, name);
    assert.deepEqual([data.dropped.needs, data.dropped.reads, data.dropped.files], [report.needs.dropped.needs, report.needs.dropped.reads, report.needs.dropped.files], name);
    assert.deepEqual(data.dropped.reasons.map(item => [item.reason, item.reads, item.files]), Object.entries(report.needs.dropped.byReason).map(([reason, count]) => [reason, count.reads, count.files]), name);
  }
  const reason = pageDataOf(main.html).dropped.reasons.find(item => item.reason === 'not-linked');
  assert.equal(reason.top.length, 10);
  assert.equal(reason.more, 2);
});

test('the artifact: the main page, a page with no data, and the 5 lines of each run', () => {
  writeFileSync(path.join(artifact, 'no-data.html'), noSessions.html);
  const lines = ['# Step 11, part B: the 5 lines of each run', '', '| Run | a | b | c | d | e | Fixes |', '|---|---|---|---|---|---|---|',
    ...runs.map(({ name, report }) => {
      const c = report.health.counts;
      return `| ${name} | ${[c.noRoute.text, c.searched.text, c.told.text, c.startLoad.text, c.sessions.text].join(' | ')} | ${report.fixes.list.length} + ${report.fixes.smaller.length} |`;
    }), ''];
  writeFileSync(path.join(artifact, 'counts-cases.md'), lines.join('\n'));
  assert.ok(existsSync(path.join(artifact, 'report.html')));
  assert.ok(existsSync(path.join(artifact, 'report.json')));
});
