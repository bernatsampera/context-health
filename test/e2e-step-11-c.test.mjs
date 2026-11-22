// E2E for step 11, part C (the fixes and the improvement prompt): run the real command on small git projects that this
// file writes into a temporary folder, each with its own settings home, the sessions that this file writes, and a copy
// of the fake claude binary with the answers of this file. No real model call.
// The ways it can fail are in the step 11 failure list (FX1 to FX16) and in the list of worker C (FX17 to FX21).
// Each test names its cases. The expected numbers are worked out by hand in the comments.
// Artifact: out/e2e-step-11-c/report.json, report.html and prompt.txt (the main run), and fixes-by-run.md.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const repoSettings = path.join(repo, 'fixtures', 'claude-settings-home');
const OLD = '/Users/example/projects/demo';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-demo';
const ID = n => `83${String(n).padStart(6, '0')}-0000-0000-0000-000000000000`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step11c-'));

// ---------- the projects ----------

// A git project with the files of `files` (path: text).
function makeProject(name, files) {
  const dir = path.join(work, name, 'demo');
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  return dir;
}
const COPY = 'Never push to the main branch without a review.';
const CLAUDE_MD = ['# Demo project', '', 'The build takes 5 minutes.', 'Read the [index of the documents](docs/index.md) first.',
  'The guides are in [docs/guides/](docs/guides/).', 'The API note of x: [x](docs/api/x.md).', 'The API note of y: [y](docs/api/y.md).',
  'The API note of z: [z](docs/api/z.md).', 'More lists: [the extra list](extra/list.md).', ''].join('\n');
const INDEX_MD = ['# Index', '', 'The build takes 8 minutes.', '- [p](deep/p.md): the deep note', COPY, 'The owner reads each release note before it goes out.', ''].join('\n');
const lostNames = ['a', 'b', 'c', 'd'];
const guideNames = ['g1', 'g2', 'g3', 'g4', 'g5'];
const SKILL = '.claude/skills/build/SKILL.md';
// P: the main project. Each cause of the failure list has its files here.
// - docs/lost/: 4 files that no file links (one folder, 4 gaps). docs/solo/one.md: 1 file that no file links.
// - docs/chain/a.md links b.md, and no file links a.md. docs/saved/rule.md: no file links it.
// - CLAUDE.md links the folder docs/guides/ (5 files), the 3 files of docs/api/ by name, docs/index.md and extra/list.md.
// - docs/index.md links docs/deep/p.md, and p.md links q.md (3 steps).
// - extra/list.md is a linked file (not a named file). It links extra/item.md.
// - tests/t.md is not a context file.
const P = makeProject('main', {
  'CLAUDE.md': CLAUDE_MD,
  'docs/index.md': INDEX_MD,
  'docs/deep/p.md': '# P\n\nThe deep note. See [q](q.md).\n',
  'docs/deep/q.md': '# Q\n\nThe last note of the deep folder.\n',
  ...Object.fromEntries(guideNames.map((name, k) => [`docs/guides/${name}.md`, `# Guide ${name}\n\nGuide number ${k + 1} of the demo.\n${k === 0 ? `${COPY}\n` : ''}`])),
  'docs/api/x.md': '# X\n\nThe cache lives for 20 days.\n',
  'docs/api/y.md': '# Y\n\nA token is valid for one hour.\n',
  'docs/api/z.md': '# Z\n\nEach token lasts one hour.\n',
  'extra/list.md': '# Extra list\n\n- [item](item.md)\n\nThe cache lives for 10 days.\n',
  'extra/item.md': '# Item\n\nThe one item of the extra list.\n',
  ...Object.fromEntries(lostNames.map(name => [`docs/lost/${name}.md`, `# Lost ${name}\n\nNo file links the note ${name}.\n`])),
  'docs/solo/one.md': '# One\n\nNo file links this note.\n',
  'docs/chain/a.md': '# A\n\nSee [b](b.md).\n',
  'docs/chain/b.md': '# B\n\nThe last note of the chain.\n',
  'docs/saved/rule.md': '# Rule\n\nAsk the owner before a release.\n',
  [SKILL]: '---\nname: build\ndescription: Build the demo.\n---\n\n# Build\n\nRun the build script.\n',
  'tests/t.md': '# T\n\nA note of the tests.\n'
});
// BARE: no CLAUDE.md and no AGENTS.md. 3 files in docs/root/ and 17 files in docs/many/. No file links them.
const manyNames = Array.from({ length: 17 }, (_, k) => `m${String(k + 1).padStart(2, '0')}`);
const BARE = makeProject('bare', {
  ...Object.fromEntries(['r1', 'r2', 'r3'].map(name => [`docs/root/${name}.md`, `# ${name}\n\nThe root note ${name}.\n`])),
  ...Object.fromEntries(manyNames.map(name => [`docs/many/${name}.md`, `# ${name}\n\nThe note ${name} of many.\n`]))
});

// ---------- the settings homes and their sessions ----------

const userClaude = readFileSync(path.join(repoSettings, 'CLAUDE.md'), 'utf8');
function makeHome(name) {
  const dir = path.join(work, 'homes', name);
  cpSync(repoSettings, dir, { recursive: true, filter: source => path.relative(repoSettings, source).split(path.sep)[0] !== 'projects' });
  mkdirSync(path.join(dir, 'projects', MAIN), { recursive: true });
  return dir;
}
// `text`: the text that the start file had in the session, when it is not the text of today.
const startOf = (project, rel, text = null) => [{ path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
  ...(rel ? [{ path: `${OLD}/${rel}`, content: text ?? readFileSync(path.join(project, rel), 'utf8'), type: 'Project' }] : [])];
const abs = rel => `${OLD}/${rel}`;
// Items: { user }, { agent }, { read: full path, text }, { grep: pattern, files: [full paths] }, { write: full path, text }.
function writeSession(home, sessionId, start, startFiles, items) {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: startFiles } })];
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
    if (item.write != null) tool('Write', { file_path: item.write, content: item.text }, `File created successfully at: ${item.write}`, { type: 'create', filePath: item.write, content: item.text });
  }
  writeFileSync(path.join(home, 'projects', MAIN, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}
const day = n => `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`;

// The fake binary and its answers, in the temporary folder. Each session has one intent.
const fakeRoot = path.join(work, 'fake');
const fake = path.join(fakeRoot, 'test', 'fake-claude.mjs');
mkdirSync(path.dirname(fake), { recursive: true });
copyFileSync(path.join(repo, 'test', 'fake-claude.mjs'), fake);
chmodSync(fake, 0o755);
const fakeAnswers = path.join(fakeRoot, 'fixtures', 'fake-claude');
mkdirSync(fakeAnswers, { recursive: true });
const answer = (name, result) => writeFileSync(path.join(fakeAnswers, name), `${JSON.stringify({ total_cost_usd: 0.01, result }, null, 2)}\n`);

let nextId = 0;
// One session with one intent. `reads`: project paths that the agent reads with nothing that names them, or
// `{ grep: path }` for a file that a search gave. `told`: facts that the user types: { text, quote, now: { path, quote, draft } }.
function session(home, project, goal, reads, { startFile = 'CLAUDE.md', startText = null, told = [] } = {}) {
  nextId += 1;
  const id = ID(nextId);
  const items = [{ user: `${goal}.` }];
  for (const item of reads) {
    const rel = item.grep ?? item;
    if (item.grep) items.push({ grep: path.basename(rel, '.md'), files: [abs(rel)] });
    items.push({ read: abs(rel), text: readFileSync(path.join(project, rel), 'utf8') });
  }
  items.push({ agent: 'Done.' });
  for (const fact of told) {
    items.push({ user: `${fact.quote}.` });
    if (fact.now) items.push({ write: abs(fact.now.path), text: 'A draft.' });
    items.push({ agent: 'Ok.' });
  }
  if (!told.length) items.push({ user: 'Thanks.' });
  writeSession(home, id, day(22 - (nextId % 20)), startOf(project, startFile, startText), items);
  answer(`${id}.intents.json`, { intents: [{ start: 1, goal, corrections: told.map((fact, k) => ({ message: k + 2, text: fact.text, quote: fact.quote, cause: 'missing-context' })) }] });
  if (told.length) {
    answer(`${id}.needs-check.json`, { checks: told.map((fact, k) => ({ correction: `c${k + 1}`, found: false, path: null, quote: null,
      now: fact.now ? { path: fact.now.path, quote: fact.now.quote } : null })) });
  }
  return id;
}
// A search for a file that the start file links by name counts only when the start file of the session did not name
// it. So these sessions have an older text of CLAUDE.md, with no link.
const OLDER = { startText: '# Demo project\n\nAn older text with no link.\n' };
const lost = name => `docs/lost/${name}.md`;
const guide = name => `docs/guides/${name}.md`;
const FACT_A = { text: 'No price in a release note', quote: 'No price in a release note' };
const FACT_B = { text: 'Write the date in each note', quote: 'Write the date in each note' };
const FACT_C = { text: 'Ask the owner before a release', quote: 'Ask me before a release', now: { path: 'docs/saved/rule.md', quote: 'Ask the owner before a release.' } };
const FACT_D = { text: 'The owner reads each release note', quote: 'I read each release note first', now: { path: 'docs/index.md', quote: 'The owner reads each release note before it goes out.' } };

// ----- HM: the main home. 12 causes (the needs of each are in the comment of the order test). -----
const HM = makeHome('main');
session(HM, P, 'Read the lost notes', lostNames.map(lost));
session(HM, P, 'Read 2 lost notes and the loose notes', [lost('a'), lost('b'), 'docs/solo/one.md', 'docs/chain/b.md', 'tests/t.md']);
session(HM, P, 'Find each guide', guideNames.map(name => ({ grep: guide(name) })));
session(HM, P, 'Find the first guide', [{ grep: guide('g1') }]);
session(HM, P, 'Find the API notes', ['x', 'y', 'z'].map(name => ({ grep: `docs/api/${name}.md` })), OLDER);
session(HM, P, 'Read the index', ['docs/index.md']);
session(HM, P, 'Read the index again', ['docs/index.md']);
session(HM, P, 'Read the deep notes', ['docs/index.md', 'docs/deep/p.md', 'docs/deep/q.md']);
session(HM, P, 'Find the deep note, the item and the build skill', [{ grep: 'docs/deep/p.md' }, { grep: 'extra/item.md' }, { grep: SKILL }]);
session(HM, P, 'Draft the release note', [], { told: [FACT_A, FACT_B, FACT_C, FACT_D] });
session(HM, P, 'Draft the next note', [], { told: [FACT_B] });
// ----- HF: 3 causes. HC: each need by links. -----
const HF = makeHome('few');
session(HF, P, 'Read 2 lost notes', [lost('a'), lost('b')]);
session(HF, P, 'Find the API note x', [{ grep: 'docs/api/x.md' }], OLDER);
session(HF, P, 'Draft a note', [], { told: [FACT_A] });
const HC = makeHome('clean');
session(HC, P, 'Read the index', ['docs/index.md']);
// ----- HB: the root item with 3 lost files. HBM: 18 lost files. -----
const HB = makeHome('bare');
session(HB, BARE, 'Read the root notes', ['r1', 'r2', 'r3'].map(name => `docs/root/${name}.md`), { startFile: null });
session(HB, BARE, 'Read the first root note', ['docs/root/r1.md'], { startFile: null });
const HBM = makeHome('bare-many');
session(HBM, BARE, 'Read many notes', ['docs/root/r1.md', ...manyNames.map(name => `docs/many/${name}.md`)], { startFile: null });

// ---------- the runs ----------

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const all = [];
function run(name, project, home, { intents = true, out = null } = {}) {
  const once = (dir, cache) => {
    const args = [cli, project, '--claude-settings-home', home, '--out', dir, '--cache', path.join(work, 'cache', cache), '--no-open', '--no-save', '--old-path', OLD];
    if (intents) args.push('--intents');
    const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    return { json: readFileSync(path.join(dir, 'report.json'), 'utf8'), html: readFileSync(path.join(dir, 'report.html'), 'utf8') };
  };
  const first = once(path.join(work, 'out', `${name}-1`), `${name}-1`);
  if (out) mkdirSync(out, { recursive: true });
  // A second run with a new cache: both reports must be the same (FX3).
  const second = once(out || path.join(work, 'out', `${name}-2`), `${name}-2`);
  const result = { name, ...first, second, report: JSON.parse(first.json) };
  all.push(result);
  return result;
}
const artifact = path.join(repo, 'out', 'e2e-step-11-c');
// The runs of P before the answer of the duplicate check is there: its call fails, and only exact copies count.
const few = run('few', P, HF);
const clean = run('clean', P, HC);
const noIntents = run('no-intents', P, HM, { intents: false });
// The answer of the duplicate check of P. The run id is a hash of the file paths, and the call of the run `few` gives it.
const runId = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).stdin.split('\n', 1)[0])
  .filter(head => head.startsWith('context-health duplicates ')).at(-1).split(' ').at(-1);
answer(`${runId}.duplicates.json`, { facts: [
  // Different values in 2 named files: a fix.
  { what: 'How long the build takes', same: false, places: [
    { path: 'CLAUDE.md', quote: 'The build takes 5 minutes.', value: '5 minutes' }, { path: 'docs/index.md', quote: 'The build takes 8 minutes.', value: '8 minutes' }] },
  // Different values, and one place is a linked file: no fix (FX6).
  { what: 'How long the cache lives', same: false, places: [
    { path: 'extra/list.md', quote: 'The cache lives for 10 days.', value: '10 days' }, { path: 'docs/api/x.md', quote: 'The cache lives for 20 days.', value: '20 days' }] },
  // A copy with other words: no fix (FX5).
  { what: 'How long a token is valid', same: true, places: [
    { path: 'docs/api/y.md', quote: 'A token is valid for one hour.', value: 'one hour' }, { path: 'docs/api/z.md', quote: 'Each token lasts one hour.', value: 'one hour' }] }
] });
const main = run('main', P, HM, { out: artifact });
const bare = run('bare', BARE, HB);
const bareMany = run('bare-many', BARE, HBM);

// ---------- helpers ----------

const R = main.report;
const KINDS = ['root', 'no-route', 'told', 'searched', 'one-source'];
const fixesOf = report => [...report.fixes.list, ...report.fixes.smaller];
const sectionOf = (report, n) => {
  const text = report.prompt.text;
  const from = text.indexOf(`## ${n}. `);
  const to = n === 6 ? text.length : text.indexOf(`## ${n + 1}. `);
  return text.slice(from, to);
};
const numbered = report => sectionOf(report, 5).split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));
const one = (report, test2) => {
  const hits = fixesOf(report).filter(test2);
  assert.equal(hits.length, 1, `one fix, got ${hits.length}: ${hits.map(fix => fix.text).join(' | ')}`);
  return hits[0];
};
const lineOf = (text, part) => text.split('\n').findIndex(line => line.includes(part)) + 1;

write(path.join(artifact, 'prompt.txt'), R.prompt.text);
write(path.join(artifact, 'fixes-by-run.md'), `# The fixes of each run of test/e2e-step-11-c.test.mjs\n\n${all.map(item =>
  `## ${item.name}\n\n${item.report.health.counts.noRoute.text}. ${item.report.health.counts.searched.text}. Total ${item.report.fixes.total}, left out: ${JSON.stringify(item.report.fixes.left)}.\n\n` +
  `| id | kind | needs | target | line | files | text |\n|---|---|---|---|---|---|---|\n${fixesOf(item.report).map(fix =>
    `| ${fix.id} | ${fix.kind} | ${fix.needs} | ${fix.target} | ${fix.line ?? ''} | ${fix.files.length} | ${fix.text.replaceAll('|', '\\|')} |`).join('\n')}\n`).join('\n')}`);

// ---------- the checks ----------

test('FX8, FX9, FX12, FX14: the invariants of each run', () => {
  for (const { name, report } of all) {
    const fixes = report.fixes;
    const list = fixesOf(report);
    // FX14: the totals agree.
    assert.equal(fixes.limit, 10, name);
    assert.ok(fixes.list.length <= 10, name);
    assert.equal(fixes.total, list.length, name);
    assert.deepEqual(list.map(fix => fix.id), list.map((_, k) => `x${k + 1}`), name);
    if (fixes.smaller.length) assert.equal(fixes.list.length, 10, name);
    // FX8: each target is a named context file, the start file that does not exist yet, or the memory index.
    const mapFiles = new Map(report.map.files.map(file => [file.path, file]));
    const startLoad = new Set(report.startLoad.map(item => item.path));
    for (const fix of list) {
      const file = mapFiles.get(fix.target);
      const ok = file ? file.context === true && file.why !== 'linked' : startLoad.has(fix.target) || fix.target === report.map.virtualStart?.path;
      assert.ok(ok, `${name} ${fix.id}: the target ${fix.target} is a file that the agent can edit`);
      assert.ok(KINDS.includes(fix.kind), name);
      assert.ok(Number.isInteger(fix.needs) && fix.needs >= 0, name);
      assert.ok(fix.line === null || Number.isInteger(fix.line), name);
      // FX12: no dash, and the text names a file or a fact.
      assert.ok(!/[\u2013\u2014]/.test(fix.text), `${name} ${fix.id}: no dash`);
      assert.ok(fix.text.includes(fix.target) || fix.files.some(rel => fix.text.includes(rel)) || fix.text.includes('"'), `${name} ${fix.id}: the text names a file or a fact`);
      // FX5, FX7: no copy fix and no far file fix.
      assert.ok(!fix.text.startsWith('Keep "') && !fix.text.includes('only if this task comes back') && !fix.text.startsWith('Shorten the route'), `${name} ${fix.id}`);
    }
    // FX9: each file of line a and line b is in the files of one fix.
    const counts = report.health.counts;
    for (const item of [...counts.noRoute.items, ...counts.searched.items]) {
      assert.equal(list.filter(fix => fix.files.includes(item.path)).length, 1, `${name}: ${item.path} is in one fix`);
    }
    // FX3: the order is by needs, then kind, then target, then the first file.
    const sorted = [...list].sort((a, b) => b.needs - a.needs || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || cmp(a.target, b.target) || cmp(a.files[0] ?? '', b.files[0] ?? '') || cmp(a.text, b.text));
    assert.deepEqual(list.map(fix => fix.id), sorted.map(fix => fix.id), `${name}: the order`);
    // FX10: the prompt holds the text of each fix of the list, in order, and no text of a smaller item.
    assert.deepEqual(numbered(report), fixes.list.map(fix => fix.text), name);
    for (const fix of fixes.smaller) assert.ok(!report.prompt.text.includes(fix.text), name);
    assert.ok(!/[\u2013\u2014]/.test(report.prompt.text), `${name}: no dash in the prompt`);
    assert.ok(report.prompt.text.length < 30000, `${name}: the prompt is small`);
    // The key `fixes` is between `health` and `prompt`.
    const keys = Object.keys(report);
    assert.deepEqual(keys.slice(keys.indexOf('health'), keys.indexOf('health') + 3), ['health', 'fixes', 'prompt'], name);
  }
});

test('FX3: two runs give the same report', () => {
  for (const item of all) {
    assert.equal(item.second.json, item.json, `${item.name}: report.json`);
    assert.equal(item.second.html, item.html, `${item.name}: report.html`);
  }
});

// The 12 causes of the main run, with their needs:
// - docs/lost/ (4 gaps in one folder): a 2, b 2, c 1, d 1 = 6. The 5 guides behind the folder link: g1 2, the others 1 = 6.
// - x, y, z that CLAUDE.md links: 3 searches. The build fact: docs/index.md has 3 needs, CLAUDE.md has 0 = 3.
// - Fact B: typed 2 times. Then 7 causes with 1 need: the chain, the solo note, facts A and C, the skill body,
//   extra/item.md (the start file is the target), docs/deep/p.md (docs/index.md is the target).
test('FX1, FX2, FX14: 12 causes give 10 fixes and one sentence about 2 smaller items', () => {
  assert.equal(R.fixes.total, 12);
  assert.equal(R.fixes.list.length, 10);
  assert.equal(R.fixes.smaller.length, 2);
  const section = sectionOf(R, 5);
  assert.equal(numbered(R).length, 10);
  assert.equal(section.trim().split('\n').at(-1), 'And 2 smaller items.');
  // FX2: 3 causes, no sentence.
  assert.equal(few.report.fixes.total, 3);
  assert.equal(few.report.fixes.smaller.length, 0);
  assert.equal(numbered(few.report).length, 3);
  assert.ok(!sectionOf(few.report, 5).includes('smaller item'));
  assert.deepEqual(few.report.fixes.list.map(fix => [fix.kind, fix.needs]), [['no-route', 2], ['told', 1], ['searched', 1]]);
});

test('FX3: the order is by needs, then kind, then target', () => {
  assert.deepEqual(fixesOf(R).map(fix => [fix.kind, fix.needs, fix.target]), [
    ['no-route', 6, 'CLAUDE.md'],
    ['searched', 6, 'CLAUDE.md'],
    ['searched', 3, 'CLAUDE.md'],
    ['one-source', 3, 'docs/index.md'],
    ['told', 2, 'CLAUDE.md'],
    ['no-route', 1, 'CLAUDE.md'],
    ['no-route', 1, 'CLAUDE.md'],
    ['told', 1, 'CLAUDE.md'],
    ['told', 1, 'CLAUDE.md'],
    ['searched', 1, SKILL],
    ['searched', 1, 'CLAUDE.md'],
    ['searched', 1, 'docs/index.md']
  ]);
  // The 2 lost groups with 1 need: by the first file.
  assert.deepEqual(fixesOf(R).filter(fix => fix.kind === 'no-route' && fix.needs === 1).map(fix => fix.files), [['docs/chain/b.md'], ['docs/solo/one.md']]);
});

test('FX4: one fix for a folder, a folder link, a linker file and the root item', () => {
  // 4 files with no route in one folder.
  const folder = one(R, fix => fix.files.includes(lost('a')));
  assert.equal(folder.kind, 'no-route');
  assert.deepEqual(folder.files, ['a', 'b', 'c', 'd'].map(lost));
  assert.equal(folder.text, 'Write one index file in the folder docs/lost/ (for example docs/lost/index.md), and link it from CLAUDE.md. In the index, name each file and say when to read it. ' +
    'It covers 4 needed files with no route (6 needs): docs/lost/a.md (2 needs), docs/lost/b.md (2 needs), docs/lost/c.md (1 need), docs/lost/d.md (1 need).');
  // 5 searched files behind one folder link.
  const line = lineOf(CLAUDE_MD, 'docs/guides/');
  const link = one(R, fix => fix.files.includes(guide('g1')));
  assert.deepEqual([link.kind, link.target, link.line], ['searched', 'CLAUDE.md', line]);
  assert.deepEqual(link.files, guideNames.map(guide));
  assert.equal(link.text, `CLAUDE.md (line ${line}) links only the folder docs/guides/, so no link names the files in it. Name these files there, or link an index of the folder, and say when to read each: ` +
    'docs/guides/g1.md (2 times), docs/guides/g2.md (1 time), docs/guides/g3.md (1 time), docs/guides/g4.md (1 time), docs/guides/g5.md (1 time). The agent got them with no link 6 times (a search, a path from the user, or a read with nothing that named the file).');
  // 3 searched files that one file links by name: the line of each.
  const byName = one(R, fix => fix.files.includes('docs/api/x.md'));
  assert.deepEqual([byName.kind, byName.target, byName.line], ['searched', 'CLAUDE.md', null]);
  assert.deepEqual(byName.files, ['docs/api/x.md', 'docs/api/y.md', 'docs/api/z.md']);
  for (const name of ['x', 'y', 'z']) assert.ok(byName.text.includes(`docs/api/${name}.md (line ${lineOf(CLAUDE_MD, `docs/api/${name}.md`)}, 1 time)`), byName.text);
  // One searched file that a named file links: the line is in the fix.
  const deep = one(R, fix => fix.files.includes('docs/deep/p.md'));
  assert.deepEqual([deep.target, deep.line], ['docs/index.md', lineOf(INDEX_MD, 'deep/p.md')]);
  // 3 lost files under the root item.
  assert.equal(bare.report.fixes.total, 1);
  const root = bare.report.fixes.list[0];
  assert.deepEqual([root.kind, root.needs, root.target, root.line], ['root', 4, 'CLAUDE.md', null]);
  assert.deepEqual(root.files, ['docs/root/r1.md', 'docs/root/r2.md', 'docs/root/r3.md']);
  assert.ok(root.text.startsWith('Create CLAUDE.md.'), root.text);
  assert.ok(root.text.endsWith('It covers 3 needed files with no route (4 needs): docs/root/r1.md (2 needs), docs/root/r2.md (1 need), docs/root/r3.md (1 need).'), root.text);
  // A chain: the gap is the file to link, and the fix names the needed file.
  const chain = one(R, fix => fix.files.includes('docs/chain/b.md'));
  assert.equal(chain.text, 'Link docs/chain/a.md from CLAUDE.md, with one line that says when to read it. It gives a route to 1 needed file (1 need): docs/chain/b.md (1 need).');
});

test('FX5, FX6: no copy fix, and a differ fact is a fix only in named files', () => {
  const facts = R.health.parts.oneSource.facts;
  // 2 copies (the exact sentence, and the token fact of the model) and 2 facts with different values.
  assert.equal(facts.filter(fact => !fact.differ).length, 2);
  assert.equal(facts.filter(fact => fact.differ).length, 2);
  assert.deepEqual(R.fixes.left, { copies: 2, notNamed: 1 });
  const source = fixesOf(R).filter(fix => fix.kind === 'one-source');
  assert.equal(source.length, 1);
  assert.deepEqual(source[0].files, []);
  assert.equal(source[0].text, 'Make the files agree on "How long the build takes": CLAUDE.md: "The build takes 5 minutes."; docs/index.md: "The build takes 8 minutes.". ' +
    'Ask the user which value is right, keep it only in docs/index.md, and link to it from the others.');
  const text = R.prompt.text;
  assert.ok(!text.includes('token is valid') && !text.includes('Never push to the main branch') && !text.includes('Keep "'), 'no copy in the prompt');
  assert.ok(!text.includes('The cache lives'), 'no fact of a file that is not named in the prompt');
  // Before the answer of the model was there: only exact copies, so no fix for a fact.
  assert.deepEqual(few.report.fixes.left, { copies: 0, notNamed: 0 });
  assert.deepEqual(clean.report.fixes.left, { copies: 1, notNamed: 0 });
});

test('FX7: a far file found by links gets no fix', () => {
  const q = R.map.files.find(file => file.path === 'docs/deep/q.md');
  assert.equal(q.steps, 3);
  assert.ok(R.health.parts.close.far.some(item => item.path === 'docs/deep/q.md'));
  assert.ok(!fixesOf(R).some(fix => fix.files.includes('docs/deep/q.md') || fix.text.includes('docs/deep/q.md')));
  assert.ok(!R.prompt.text.includes('Shorten the route') && !R.prompt.text.includes('only if this task comes back') && !R.prompt.text.includes('Long routes'));
});

test('FX13, FX20: no fix and no intent', () => {
  assert.deepEqual(clean.report.fixes, { limit: 10, total: 0, list: [], smaller: [], left: { copies: 1, notNamed: 0 } });
  assert.ok(sectionOf(clean.report, 5).includes('No change is needed from this data: '));
  assert.ok(!sectionOf(clean.report, 5).includes('1. '));
  assert.deepEqual(noIntents.report.fixes, { limit: 10, total: 0, list: [], smaller: [], left: { copies: 0, notNamed: 0 } });
  assert.ok(sectionOf(noIntents.report, 5).includes('Run context-health with --intents first, so there is data to improve from.'));
});

test('FX15: a saved fact with a route is no fix, one with no route is', () => {
  const found = R.health.parts.found;
  assert.deepEqual(found.saved.map(item => [item.text, item.path]), [[FACT_D.text, 'docs/index.md']]);
  assert.deepEqual(found.told.map(item => [item.text, item.uses, item.savedPath]), [[FACT_B.text, 2, null], [FACT_C.text, 1, 'docs/saved/rule.md'], [FACT_A.text, 1, null]]);
  const told = fixesOf(R).filter(fix => fix.kind === 'told');
  assert.equal(told.length, 3);
  assert.ok(!fixesOf(R).some(fix => fix.text.includes(FACT_D.text)));
  const saved = one(R, fix => fix.text.includes(FACT_C.text));
  assert.deepEqual([saved.target, saved.files.length], ['CLAUDE.md', 0]);
  assert.equal(saved.text, 'The fact "Ask the owner before a release" is in docs/saved/rule.md now, but that file has no route from the start. ' +
    'Link docs/saved/rule.md from CLAUDE.md, with one line that says when to read it. The user typed it 1 time.');
  assert.equal(one(R, fix => fix.text.includes(FACT_B.text)).text, 'Add this fact to CLAUDE.md, or to a file that it links: "Write the date in each note". The user typed it 2 times.');
  assert.ok(sectionOf(R, 4).includes(`- "${FACT_D.text}": in docs/index.md (1 step from the start).`));
});

test('FX16: the fix links from the start file and names the linker', () => {
  const item = R.health.counts.searched.items.find(entry => entry.path === 'extra/item.md');
  assert.deepEqual([item.linker.path, item.linker.named], ['extra/list.md', false]);
  const fix = one(R, entry => entry.files.includes('extra/item.md'));
  assert.deepEqual([fix.kind, fix.target, fix.line], ['searched', 'CLAUDE.md', null]);
  assert.equal(fix.text, 'Link this file from CLAUDE.md, with one line that says when to read it: extra/item.md (1 time). ' +
    'extra/list.md names it today, but that file is not an instruction file, so do not change it. The agent got it with no link 1 time (a search, a path from the user, or a read with nothing that named the file).');
  assert.ok(!fixesOf(R).some(entry => entry.target === 'extra/list.md' || entry.target.startsWith('tests/')));
});

test('FX21: the fix of a trigger body edits the body', () => {
  const fix = one(R, entry => entry.files.includes(SKILL));
  assert.deepEqual([fix.kind, fix.target, fix.needs], ['searched', SKILL, 1]);
  assert.equal(fix.text, `${SKILL} loads behind a trigger. Make the description of its skill, command or agent say when to use it. The agent got it with no link 1 time (a search, a path from the user, or a read with nothing that named the file).`);
});

test('FX17, FX19: the prompt has the 5 counts and no score', () => {
  const s1 = sectionOf(R, 1);
  const counts = R.health.counts;
  assert.ok(s1.includes(`- a. ${counts.noRoute.text}, ${counts.noRoute.base}.`), s1);
  assert.ok(s1.includes(`- b. ${counts.searched.text}, ${counts.searched.base}.`));
  assert.ok(s1.includes(`- c. ${counts.told.text}.`));
  assert.ok(s1.includes(`- d. ${counts.startLoad.text}. The biggest items: ${counts.startLoad.top[0].path} (`));
  assert.ok(s1.includes(`- e. ${counts.sessions.text}.`));
  // By hand: 6 files with no route (4 lost, solo, chain b), 11 searched files (5 guides, 3 API notes, p, item, the skill), 4 facts (1 saved).
  assert.equal(counts.noRoute.files, 6);
  assert.equal(counts.searched.files, 11);
  assert.deepEqual([counts.told.facts, counts.told.saved], [4, 1]);
  for (const { name, report } of all) {
    assert.ok(!/health score|of 100|One source =/i.test(report.prompt.text), `${name}: no score in the prompt`);
    assert.ok(sectionOf(report, 6).includes('Compare the 5 counts'), name);
  }
  // FX19: the read of tests/t.md is not a need.
  assert.equal(R.needs.dropped.needs, 1);
  assert.ok(s1.includes('- 1 read of files that are not context files does not count as needs.'));
  assert.ok(!sectionOf(few.report, 1).includes('not context files'));
  // With no intent, lines a to c say that there is no data.
  assert.ok(sectionOf(noIntents.report, 1).includes('- a. Needed files with no route: no data.'));
});

test('FX18: each list of section 4 has 15 items at most', () => {
  const report = bareMany.report;
  assert.equal(report.health.counts.noRoute.files, 18);
  const s4 = sectionOf(report, 4);
  const from = s4.indexOf('Needed files with no route from the start load:');
  const list = s4.slice(from, s4.indexOf('Needed files with a route that the agent searched:')).trim().split('\n').slice(1);
  assert.equal(list.length, 16);
  assert.equal(list.at(-1), '- And 3 more.');
  // One root fix for the 18 files: the text names 5 of them.
  assert.equal(report.fixes.total, 1);
  assert.equal(report.fixes.list[0].files.length, 18);
  assert.ok(report.fixes.list[0].text.endsWith(', and 13 more.'), report.fixes.list[0].text);
  // The main run: each list of section 4 is there, and no list of copies or of long routes.
  const main4 = sectionOf(R, 4);
  for (const title of ['Needed files with no route from the start load:', 'Needed files with a route that the agent searched:', 'Facts that the user typed (not in the context):',
    'Facts that the user typed, and that a context file holds now (no change needed):', 'Facts with different values in two or more instruction files:', 'Context files that no intent used (']) {
    assert.ok(main4.includes(title), title);
  }
  assert.ok(main4.includes(`- docs/lost/a.md: needed by 2 intents. ${R.health.parts.found.lost.find(item => item.path === 'docs/lost/a.md').why}`));
  assert.ok(main4.includes(`- docs/guides/g1.md: needed by 2 intents, searched 2 times. ${R.health.counts.searched.items.find(item => item.path === 'docs/guides/g1.md').why}`));
  assert.ok(sectionOf(few.report, 4).includes('Facts with different values in two or more instruction files (only exact copies checked, so no different value can show):'));
  assert.ok(main4.includes('- How long the build takes. CLAUDE.md: "The build takes 5 minutes."; docs/index.md: "The build takes 8 minutes.".'));
});

// Added by the supervisor: the page side of FX10 and PG6 (the closed part with the smaller items needs a run with more
// than 10 causes, and only this file has one).
// Step 12: the fixes of `list` are under their question in the health section, each with its number. The section
// `fixes` holds only the closed part with the smaller items.
test('FX10, PG6: the page shows the same fixes as the prompt, 10 under the questions and the others in a closed part', () => {
  const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const item of all) {
    const fixes = item.report.fixes;
    const section = item.html.match(/<section class="fixes" id="fixes" data-fixes="(\d+)" data-smaller="(\d+)"[^>]*>([\s\S]*?)<\/section>/);
    assert.ok(section, item.name);
    assert.deepEqual([Number(section[1]), Number(section[2])], [fixes.list.length, fixes.smaller.length], item.name);
    const health = item.html.match(/<section class="health" id="health"[^>]*>([\s\S]*?)<\/section>/)[1];
    const [, smaller = ''] = section[3].split('<details class="hother" id="fix-smaller">');
    // Each fix one time: the health section has the fixes of `list`, the closed part the fixes of `smaller`.
    assert.deepEqual([...health.matchAll(/<li data-fix="([^"]+)"/g)].map(match => match[1]).sort(), fixes.list.map(fix => fix.id).sort(), item.name);
    assert.deepEqual([...smaller.matchAll(/<li data-fix="([^"]+)"/g)].map(match => match[1]), fixes.smaller.map(fix => fix.id), item.name);
    fixes.list.forEach((fix, k) => assert.ok(health.includes(`<div class="ft"><b class="fn">${k + 1}.</b> ${esc(fix.text)}</div>`), `${item.name} ${fix.id}`));
    for (const fix of fixes.smaller) assert.ok(section[3].includes(`<div class="ft">${esc(fix.text)}</div>`), `${item.name} ${fix.id}`);
    if (!fixes.total) assert.ok(section[3].includes('<p class="nofix">No fix from this data.</p>'), item.name);
  }
  const many = all.find(item => item.report.fixes.smaller.length === 2);
  assert.ok(many.html.includes('<details class="hother" id="fix-smaller"><summary>2 smaller items</summary>'));
});
