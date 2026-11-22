// E2E for step 12, part A (the score of method v1 and its proof from the git history): run the real command on small
// projects that this file writes into a temporary folder, each with its own settings home, the sessions that this file
// writes, and a copy of the fake claude binary with the answers of this file. No real model call.
// The ways it can fail are in the step 12 failure list (S1 to S19, P1 to P14, R1, R2). Each test names its cases.
// The expected numbers are worked out by hand in the comments.
// Artifact: out/e2e-step-12-a/report.json and report.html (the main run), and proof.md (one row for each run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const OLD = '/Users/example/projects/demo';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-demo';
const ID = n => `8a${String(n).padStart(6, '0')}-0000-0000-0000-000000000000`;
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step12a-'));

// ---------- the projects ----------

// A text with an exact number of characters. The tokens of a file are its characters / 4, rounded up.
const sized = chars => `${'lorem '.repeat(Math.ceil(chars / 6)).slice(0, chars - 1)}\n`;
const V1 = ['# Demo project', '', 'Read the [index](docs/index.md) first.',
  'The near notes: [n1](docs/near/n1.md), [n2](docs/near/n2.md), [n3](docs/near/n3.md).',
  'The guides are in [docs/guides/](docs/guides/).', '@docs/rules.md', ''].join('\n');
// The branch `wt-branch`: commit 1 plus a link to the lost note c.
const VW = `${V1}The lost note c: [c](docs/lost/c.md).\n`;
// Commit 2, the better context. Line 5 is the folder link. Line 6 names g1 and g2, so only g3 is behind the folder link.
const V2 = ['# Demo project', '', 'Read the [index](docs/index.md) first.',
  'The near notes: [n1](docs/near/n1.md), [n2](docs/near/n2.md), [n3](docs/near/n3.md).',
  'The guides are in [docs/guides/](docs/guides/).', 'The main guides: [g1](docs/guides/g1.md) and [g2](docs/guides/g2.md).',
  'The lost notes: [a](docs/lost/a.md) and [b](docs/lost/b.md).', 'The deep note: [p](docs/deep/p.md).',
  'The release rule: [rule](docs/saved/rule.md).', 'The late note: [late](docs/new/late.md).', '@docs/rules.md', '@docs/extra.md', ''].join('\n');
const NO_LINKS = '# Demo project\n\nAn older text with no link.\n';
const BUILD = '.claude/skills/build/SKILL.md';
// The files of commit 1.
// - Served: n1, n2, n3 and docs/index.md (a link by name, 1 step), docs/rules.md (an @ import, 0 steps), the build skill
//   (a trigger, 1 step).
// - Slow: g1, g2, g3 (only the folder link), docs/deep/p.md (2 steps: CLAUDE.md > index > p), q.md (3 steps).
// - Missed: docs/lost/a, b, c, docs/saved/rule.md and docs/saved/orphan.md (no file links them).
const FILES_1 = {
  'CLAUDE.md': V1,
  'docs/index.md': '# Index\n\n- [p](deep/p.md): the deep note\n',
  'docs/deep/p.md': '# P\n\nThe deep note. See [q](q.md).\n',
  'docs/deep/q.md': '# Q\n\nThe last note of the deep folder.\n',
  ...Object.fromEntries(['n1', 'n2', 'n3'].map(name => [`docs/near/${name}.md`, `# Near ${name}\n\nThe near note ${name}.\n`])),
  ...Object.fromEntries(['g1', 'g2', 'g3'].map(name => [`docs/guides/${name}.md`, `# Guide ${name}\n\nThe guide ${name} of the demo.\n`])),
  ...Object.fromEntries(['a', 'b', 'c'].map(name => [`docs/lost/${name}.md`, `# Lost ${name}\n\nThe lost note ${name}.\n`])),
  'docs/rules.md': '# Rules\n\nRun the tests before each commit.\n',
  'docs/saved/rule.md': '# Rule\n\nAsk the owner before a release.\n',
  'docs/saved/orphan.md': '# Orphan\n\nEach note has the name of its writer.\n',
  [BUILD]: '---\nname: build\ndescription: Build the demo.\n---\n\n# Build\n\nRun the build script.\n',
  '.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Deploy the demo.\n---\n\n# Deploy\n\nRun the deploy script.\n',
  'tests/t.md': '# T\n\nA note of the tests.\n',
  'src/app.js': 'console.log("demo");\n'
};
// Commit 2 changes CLAUDE.md and adds 2 files. docs/extra.md is an @ import of 20,000 characters = 5,000 tokens.
// Today: g1, g2, a, b, p, rule.md and late.md are Served. g3 (folder link) and q.md (2 steps) are Slow. c and orphan.md are Missed.
const FILES_2 = { 'CLAUDE.md': V2, 'docs/new/late.md': '# Late\n\nA note that commit 2 adds.\n', 'docs/extra.md': sized(20000) };

const DATE_1 = '2026-11-05T12:00:00Z';
const DATE_W = '2026-11-08T12:00:00Z';
const DATE_2 = '2026-11-15T12:00:00Z';
const gitEnv = date => ({ ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
const git = (dir, args, date = DATE_1) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: gitEnv(date) }).trim();
const writeFiles = (dir, files) => { for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text); };
const commit = (dir, message, date) => { git(dir, ['add', '-A'], date); git(dir, ['commit', '-q', '-m', message], date); return git(dir, ['rev-parse', 'HEAD']); };
// A git project. `upTo` 1: only commit 1. `upTo` 2: commit 1, the branch `wt-branch` with 1 commit, then commit 2 on main.
function makeRepo(name, upTo) {
  const dir = path.join(work, name, 'demo');
  writeFiles(dir, FILES_1);
  git(dir, ['init', '-q', '-b', 'main']);
  const shas = { c1: commit(dir, 'Commit 1: the first context', DATE_1) };
  if (upTo === 1) return { dir, shas };
  git(dir, ['checkout', '-q', '-b', 'wt-branch']);
  write(path.join(dir, 'CLAUDE.md'), VW);
  shas.w = commit(dir, 'Link the lost note c', DATE_W);
  git(dir, ['checkout', '-q', 'main']);
  writeFiles(dir, FILES_2);
  shas.c2 = commit(dir, 'Commit 2: a better context', DATE_2);
  return { dir, shas };
}
function makePlain(name, files) {
  const dir = path.join(work, name, 'demo');
  writeFiles(dir, files);
  return dir;
}
const R2 = makeRepo('main', 2);
const R1 = makeRepo('first', 1);
// The files of commit 2 with no git (P4).
const PLAIN = makePlain('plain', { ...FILES_1, ...FILES_2 });
// The penalty edges (S9): one @ import that no intent uses is the only unused start item.
const LINKED = '# Demo\n\nThe near note: [n1](docs/near/n1.md).\n@docs/big.md\n';
const edge = (name, chars, claude = LINKED) => makePlain(name, { 'CLAUDE.md': claude, 'docs/near/n1.md': '# Near n1\n\nThe near note n1.\n', 'docs/big.md': sized(chars) });
const P3999 = edge('p3999', 15996);
const P4000 = edge('p4000', 16000);
const P30000 = edge('p30000', 120000, '# Demo\n\n@docs/big.md\n');

// ---------- the settings homes and their sessions ----------

const USER = '# User rules\n\nWrite short sentences.\n';
function makeHome(name) {
  const dir = path.join(work, 'homes', name);
  write(path.join(dir, 'CLAUDE.md'), USER);
  mkdirSync(path.join(dir, 'projects', MAIN), { recursive: true });
  return dir;
}
const startOf = (text, cwd) => [{ path: `${HOME}/.claude/CLAUDE.md`, content: USER, type: 'User' }, { path: `${cwd}/CLAUDE.md`, content: text, type: 'Project' }];
// Items: { user }, { agent }, { read: full path, text }, { grep: pattern, files }, { write: full path, text }, { skill: folder, text }.
// `cwd`: the folder of the session. A worktree session has its own session folder.
function writeSession(home, sessionId, start, gitBranch, cwd, startFiles, items) {
  const base = { isSidechain: false, userType: 'external', cwd, sessionId, version: '2.1.300', gitBranch, entrypoint: 'cli' };
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
      tool('Grep', { pattern: item.grep, path: cwd, output_mode: 'files_with_matches' }, `Found ${item.files.length} files\n${item.files.join('\n')}`,
        { mode: 'files_with_matches', filenames: item.files, numFiles: item.files.length });
    }
    if (item.write != null) tool('Write', { file_path: item.write, content: item.text }, `File created successfully at: ${item.write}`, { type: 'create', filePath: item.write, content: item.text });
    // The harness loads a skill body with a meta message.
    if (item.skill != null) records.push(rec({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: ${item.skill}\n\n${item.text}` }] } }));
  }
  const folder = path.join(home, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

// The fake binary and its answers, in the temporary folder. Each session has one intent.
const fakeRoot = path.join(work, 'fake');
const fake = path.join(fakeRoot, 'test', 'fake-claude.mjs');
mkdirSync(path.dirname(fake), { recursive: true });
copyFileSync(path.join(repo, 'test', 'fake-claude.mjs'), fake);
chmodSync(fake, 0o755);
const fakeAnswers = path.join(fakeRoot, 'fixtures', 'fake-claude');
mkdirSync(fakeAnswers, { recursive: true });
const answer = (name, result) => writeFileSync(path.join(fakeAnswers, name), `${JSON.stringify({ total_cost_usd: 0.01, result }, null, 2)}\n`);

const ALL = { ...FILES_1, ...FILES_2 };
let nextId = 0;
// One session with one intent. `at`: the start time. `reads`: a project path that the agent reads with nothing that
// names it (except the start text or an earlier read), `{ grep: path }` for a file that a search gave, or
// `{ skill: path }` for a skill body that the harness loads. `told`: facts that the user types.
// `worktree`: the session runs in the worktree folder `.claude/worktrees/<name>/` of the project.
function session(home, at, goal, reads, { start = V1, branch = 'main', told = [], worktree = null } = {}) {
  nextId += 1;
  const id = ID(nextId);
  const cwd = worktree ? `${OLD}/.claude/worktrees/${worktree}` : OLD;
  const abs = rel => `${cwd}/${rel}`;
  const items = [{ user: `${goal}.` }];
  for (const item of reads) {
    const rel = item.grep ?? item.skill ?? item;
    if (item.skill) { items.push({ skill: abs(path.posix.dirname(rel)), text: ALL[rel] }); continue; }
    if (item.grep) items.push({ grep: path.basename(rel, '.md'), files: [abs(rel)] });
    items.push({ read: abs(rel), text: ALL[rel] });
  }
  items.push({ agent: 'Done.' });
  for (const fact of told) {
    items.push({ user: `${fact.quote}.` });
    if (fact.now) items.push({ write: abs(fact.now.path), text: 'A draft.' });
    items.push({ agent: 'Ok.' });
  }
  if (!told.length) items.push({ user: 'Thanks.' });
  writeSession(home, id, at, branch, cwd, startOf(start, cwd), items);
  answer(`${id}.intents.json`, { intents: [{ start: 1, goal, corrections: told.map((fact, k) => ({ message: k + 2, text: fact.text, quote: fact.quote, cause: 'missing-context' })) }] });
  if (told.length) {
    answer(`${id}.needs-check.json`, { checks: told.map((fact, k) => ({ correction: `c${k + 1}`, found: false, path: null, quote: null,
      now: fact.now ? { path: fact.now.path, quote: fact.now.quote } : null, kind: fact.kind })) });
  }
  return id;
}
const at = (day, hour = 10) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const near = name => `docs/near/${name}.md`;
const guide = name => `docs/guides/${name}.md`;
const lost = name => `docs/lost/${name}.md`;
const INDEX = 'docs/index.md';
const P = 'docs/deep/p.md';
const Q = 'docs/deep/q.md';
// R: a rule that docs/saved/rule.md holds (a route only from commit 2). O: a rule in a file with no route.
// M: a rule that no file holds. T: a request for one task, so it is not a need.
const FACT_R = { text: 'Ask the owner before a release', quote: 'Ask me before a release', kind: 'rule', now: { path: 'docs/saved/rule.md', quote: 'Ask the owner before a release.' } };
const FACT_O = { text: 'Each note has the name of its writer', quote: 'Put the name of the writer in each note', kind: 'rule', now: { path: 'docs/saved/orphan.md', quote: 'Each note has the name of its writer.' } };
const FACT_M = { text: 'No price in a release note', quote: 'No price in a release note', kind: 'rule' };
const FACT_T = { text: 'Use the blue logo in this note', quote: 'Use the blue logo this time', kind: 'task' };

// ----- HM: the main home, 17 sessions. The comment of each gives: the grades on the map of the commit of the session
// (for the proof) / the grades of today, on the map of commit 2 (for the score). -----
const HM = makeHome('main');
const S = {};
// Before commit 1: left out of the proof (P3). Today: n1 Served.
S.s0 = session(HM, at(1), 'Read the first near note', [near('n1')]);
// Between the commits: the map of commit 1 (P1). The start text of the session is the text of commit 1.
S.s1 = session(HM, at(6, 9), 'Read the near notes', [near('n1'), near('n2'), near('n3')]); // 3 Served / 3 Served
S.s2 = session(HM, at(6, 11), 'Read 2 near notes and the index', [near('n1'), near('n2'), INDEX]); // 3 Served / 3 Served
S.s3 = session(HM, at(7, 9), 'Read the deep note', [near('n1'), INDEX, P]); // 2 Served, p Slow / 3 Served
S.s4 = session(HM, at(7, 11), 'Find each guide', ['g1', 'g2', 'g3'].map(name => ({ grep: guide(name) }))); // 3 Slow, 3 searched / g1, g2 Served, g3 Slow
S.s5 = session(HM, at(8, 9), 'Read the lost notes', ['a', 'b', 'c'].map(lost)); // 3 Missed, 3 searched / a, b Served, c Missed
// 2 Missed, 2 searched, and 1 typed rule: 0.5 for each need / a, b Served, and the rule R is Served (rule.md has a route).
S.s6 = session(HM, at(8, 14), 'Find 2 lost notes', [{ grep: lost('a') }, { grep: lost('b') }], { told: [FACT_R] });
S.s7 = session(HM, at(9, 9), 'Read the rules', [near('n2'), near('n3'), 'docs/rules.md']); // 3 Served / 3 Served
S.s8 = session(HM, at(9, 11), 'Build the demo', [{ skill: BUILD }, near('n1')]); // 2 Served / 2 Served
// c Missed, g3 Slow, late.md Missed (it was not in commit 1, P12): 3 searched. tests/t.md is not a context file (S5).
// Today: c Missed, g3 Slow, late.md Served.
S.s9 = session(HM, at(10, 9), 'Find the loose notes', [{ grep: lost('c') }, { grep: guide('g3') }, 'tests/t.md', 'docs/new/late.md']);
// No file need: the 2 rules are left out of the rates (P13). The task fact T is not a need (S8). Today: M and O Missed.
S.s10 = session(HM, at(10, 11), 'Draft the release note', [], { told: [FACT_M, FACT_O, FACT_T] });
S.s11 = session(HM, at(11, 9), 'Read the deep notes', [INDEX, P, Q]); // index Served, p and q Slow / index, p Served, q Slow
// q Slow and searched, n3 Served, and 1 typed rule: 0.5 for each need / q Slow, n3 Served, M Missed.
S.s12 = session(HM, at(11, 11), 'Find the last deep note', [{ grep: Q }, near('n3')], { told: [FACT_M] });
// After commit 2: the map of commit 2. The start text is the text of commit 2.
S.s13 = session(HM, at(16, 9), 'Read the linked notes', [lost('a'), lost('b'), guide('g1')], { start: V2 }); // 3 Served / 3 Served
S.s14 = session(HM, at(16, 11), 'Find the note c', [{ grep: lost('c') }, P], { start: V2 }); // c Missed and searched, p Served / the same
// The branch of the session is gone: the default branch, so commit 1 (P5). n1 Served / n1 Served.
S.s15 = session(HM, at(10, 13), 'Read a near note on a branch', [near('n1')], { branch: 'feature/gone' });
// A worktree session. Its branch exists: its own commit, where CLAUDE.md links c (P6). c Served / c Missed.
S.s16 = session(HM, at(10, 15), 'Read the note c in a worktree', [lost('c')], { branch: 'wt-branch', start: VW, worktree: 'wt' });

// ----- HT: thin data (S15). 4 needs in 2 sessions. -----
const HT = makeHome('thin');
session(HT, at(6), 'Read the near notes', [near('n1'), near('n2'), near('n3')]);
session(HT, at(7), 'Find the note c', [{ grep: lost('c') }]);
// ----- HF: enough data for a score, not enough for the proof (P7). 5 sessions with 4 Served needs each. -----
const HF = makeHome('few');
for (let k = 0; k < 5; k += 1) session(HF, at(6 + k), `Read the near notes, time ${k + 1}`, [near('n1'), near('n2'), near('n3'), INDEX]);
// ----- HX: the proof fails (P8). 4 sessions search for the 3 near notes (Served on the map of commit 1): 12 Served needs,
// 12 searched. 5 sessions read index, p and q by links: 5 Served needs and 10 Slow needs, 0 searched. -----
const HX = makeHome('fail');
for (let k = 0; k < 4; k += 1) session(HX, at(6 + k), `Find the near notes, time ${k + 1}`, ['n1', 'n2', 'n3'].map(name => ({ grep: near(name) })), { start: NO_LINKS });
for (let k = 0; k < 5; k += 1) session(HX, at(10 + k, 12), `Read the deep notes, time ${k + 1}`, [INDEX, P, Q]);
// ----- HE: no session (S14). HP: one session with one need, for the penalty edges (S9). -----
const HE = makeHome('empty');
const HP = makeHome('penalty');
session(HP, at(6), 'Read the near note', [near('n1')], { start: LINKED });

// ---------- the runs ----------

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const artifact = path.join(repo, 'out', 'e2e-step-12-a');
const cacheOf = name => path.join(work, 'cache', name);
const all = [];
function run(name, project, home, { cache = name, out = null } = {}) {
  const dir = out || path.join(work, 'out', name);
  const args = [cli, project, '--claude-settings-home', home, '--out', dir, '--cache', cacheOf(cache), '--no-open', '--no-save', '--old-path', OLD, '--sessions', '40', '--intents'];
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  const json = readFileSync(path.join(dir, 'report.json'), 'utf8');
  const item = { name, stdout: result.stdout, json, report: JSON.parse(json), v1: JSON.parse(json).health.v1 };
  all.push(item);
  return item;
}
// Each file of a folder, without `.git`, with its size and its change time.
function tree(dir) {
  const out = [];
  const walk = rel => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (child === '.git') continue;
      if (entry.isDirectory()) walk(child);
      else { const stat = statSync(path.join(dir, child)); out.push(`${child} ${stat.size} ${stat.mtimeMs}`); }
    }
  };
  walk('');
  return out.sort();
}
const stateOf = dir => ({ status: git(dir, ['status', '--porcelain']), head: git(dir, ['rev-parse', 'HEAD']), refs: git(dir, ['for-each-ref']),
  stash: git(dir, ['stash', 'list']), worktrees: git(dir, ['worktree', 'list']).split('\n').length, files: tree(dir) });
const before = { main: stateOf(R2.dir), first: stateOf(R1.dir) };

const main = run('main', R2.dir, HM);
const historyDir = path.join(cacheOf('main'), 'history');
const historyBefore = tree(historyDir);
// The same cache again (R1, P11), then a new cache.
const again = run('main-again', R2.dir, HM, { cache: 'main', out: artifact });
const fresh = run('main-fresh', R2.dir, HM);
const first = run('first', R1.dir, HM);
const plain = run('plain', PLAIN, HM);
const thin = run('thin', R2.dir, HT);
const few = run('few', R2.dir, HF);
const fail = run('fail', R2.dir, HX);
const empty = run('empty', R2.dir, HE);
const p3999 = run('p3999', P3999, HP);
const p4000 = run('p4000', P4000, HP);
const p30000 = run('p30000', P30000, HP);
const after = { main: stateOf(R2.dir), first: stateOf(R1.dir) };

// The artifact: one row for each run. It has no path of the temporary folder.
const rate = value => (value == null ? 'none' : String(value));
write(path.join(artifact, 'proof.md'), `# The v1 score and its proof for each run of test/e2e-step-12-a.test.mjs\n\n` +
  `Commits of the fixture: commit 1 ${R2.shas.c1.slice(0, 7)} (${DATE_1}), wt-branch ${R2.shas.w.slice(0, 7)} (${DATE_W}), commit 2 ${R2.shas.c2.slice(0, 7)} (${DATE_2}).\n\n` +
  `| run | score | label | shown | served | slow | missed | penalty | proof | sessions used | Served needs (search rate) | other needs (search rate) | text |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${all.map(({ name, v1 }) =>
    `| ${name} | ${v1.score ?? ''} | ${v1.label ?? ''} | ${v1.shown} | ${v1.grades.served} | ${v1.grades.slow} | ${v1.grades.missed} | ${v1.penalty.points} | ${v1.proof.status} | ${v1.proof.sessions.used} | ` +
    `${v1.proof.grades.served.needs} (${rate(v1.proof.grades.served.searchRate)}) | ${v1.proof.grades.other.needs} (${rate(v1.proof.grades.other.searchRate)}) | ${v1.proof.text} |`).join('\n')}\n\n` +
  `## The commit of each session of the main run\n\n| session | commit | branch | fallback |\n|---|---|---|---|\n${main.v1.proof.commits.map(item =>
    `| ${item.sessionId.slice(0, 8)} | ${item.commit} | ${item.branch} | ${item.fallback} |`).join('\n')}\n`);

// ---------- helpers ----------

const V = main.v1;
const q = (v1, key) => v1.questions.find(item => item.key === key);
const itemOf = (v1, key, label) => q(v1, key).items.find(item => item.label === label);
const startItem = (v1, rel, what) => v1.penalty.items.find(item => item.path === rel && item.what === what);

// ---------- the checks ----------

// The needs of today (the map of commit 2), from the comments of the sessions:
// - Served 31: s0 1, s1 3, s2 3, s3 3, s4 2, s5 2, s6 3 (a, b and the rule R), s7 3, s8 2, s9 1, s11 2, s12 1, s13 3, s14 1, s15 1.
// - Slow 4: g3 in s4 and s9, q in s11 and s12.
// - Missed 7: c in s5, s9, s14 and s16, the rule M in s10 and s12, the rule O in s10.
// - 42 needs: 38 file needs and 4 typed rules. The task fact T and the read of tests/t.md do not count.
// raw = 100 x (31 + 0.5 x 4) / 42 = 78.57. Unused start items: docs/extra.md (5,000 tokens) and the description of the
// skill deploy ("deploy: Deploy the demo.", 24 characters = 6 tokens) = 5,006 tokens. Penalty = floor((5,006 - 3,000) / 1,000) = 2.
// score = round(78.57 - 2) = 77, mixed.
test('S1 to S8, S13, S18, R2: the grades and the score of the main run', () => {
  assert.equal(V.method, 'v1');
  assert.ok(V.rules.length > 100 && !/[\u2013\u2014]/.test(JSON.stringify(V)), 'the rules are there, and no text has a dash');
  assert.deepEqual(V.grades, { served: 31, slow: 4, missed: 7, total: 42 });
  assert.equal(V.grades.served + V.grades.slow + V.grades.missed, V.grades.total);
  // S3: a Slow need counts 0.5. S13: a whole number from 0 to 100.
  assert.equal(V.raw, 78.6);
  assert.equal(V.score, 77);
  assert.equal(V.label, 'mixed');
  assert.deepEqual(V.base, { analysed: 17, total: 17, needs: 42, text: 'from 17 of 17 sessions, 42 needs' });
  // S5: the read of tests/t.md is a dropped read, not a need.
  assert.equal(main.report.needs.dropped.list.some(item => item.path === 'tests/t.md'), true);
  // S8: the task fact is not a need. It is in `facts.task`.
  assert.deepEqual(V.facts.task, [{ text: FACT_T.text, quote: FACT_T.quote, sessionId: S.s10, intentId: 'i1' }]);
  // S6, S7: the rule R takes the grade of docs/saved/rule.md (Served). The rule O is in a file with no route: Missed.
  assert.deepEqual(V.facts.rule, [
    { text: FACT_M.text, quote: FACT_M.quote, uses: 2, savedPath: null, grade: 'missed' },
    { text: FACT_R.text, quote: FACT_R.quote, uses: 1, savedPath: 'docs/saved/rule.md', grade: 'served' },
    { text: FACT_O.text, quote: FACT_O.quote, uses: 1, savedPath: 'docs/saved/orphan.md', grade: 'missed' }]);
});

test('S1, S2, S4, S18, S20: the 4 questions hold each Missed and each Slow file, with the file and the line to change', () => {
  assert.deepEqual(V.questions.map(item => item.key), ['find', 'close', 'told', 'lean']);
  for (const item of V.questions) {
    assert.equal(item.n, item.items.length, item.key);
    for (const entry of item.items) {
      assert.ok(typeof entry.label === 'string' && typeof entry.count === 'string' && ['file', 'fact', 'start-item'].includes(entry.kind), `${item.key} ${entry.label}`);
      assert.ok('text' in entry && 'path' in entry, `${item.key} ${entry.label}`);
    }
  }
  // Question 1. S4: c is a need of 4 intents, so it counts 4 times. Then the rule M (2 needs) and the rule O (1 need).
  const find = q(V, 'find');
  assert.equal(find.answer, '1 file and 2 facts missed');
  assert.deepEqual(find.items.map(item => [item.label, item.count, item.kind]), [[lost('c'), '4 needs', 'file'], [FACT_M.text, '2 needs', 'fact'], [FACT_O.text, '1 need', 'fact']]);
  assert.equal(find.items[0].text, 'No file links to it. Link docs/lost/c.md from CLAUDE.md, with one line that says when to read it.');
  assert.deepEqual([find.items[0].target, find.items[0].line], ['CLAUDE.md', null]);
  assert.ok(find.items[2].text.startsWith('The fact is in docs/saved/orphan.md now, but that file has no route from the start.'));
  // Question 2. S1: g3 is 1 step away by a folder link only, so it is Slow. q is 2 steps away. Both have 2 needs.
  // The change for g3 is on line 5 of CLAUDE.md, the line of the folder link. The change for q is a link from CLAUDE.md.
  const close = q(V, 'close');
  assert.equal(close.answer, '2 files slow');
  assert.deepEqual(close.items.map(item => [item.label, item.count, item.target, item.line]), [[Q, '2 needs', 'CLAUDE.md', null], [guide('g3'), '2 needs', 'CLAUDE.md', 5]]);
  assert.equal(close.items[0].text, 'It is 2 steps from the start (CLAUDE.md > docs/deep/p.md > docs/deep/q.md). Link docs/deep/q.md from CLAUDE.md, with one line that says when to read it.');
  assert.equal(close.items[1].text, 'CLAUDE.md (line 5) links only the folder of this file. In CLAUDE.md (line 5), name the file: add a link to docs/guides/g3.md, with one line that says when to read it.');
  // S20: g1 and g2 are in the folder of the folder link of line 5, and line 6 names them. The map keeps the folder
  // route for them (the same number of steps, and line 5 comes first). They are Served, because a start file names them.
  assert.equal(main.report.map.files.find(file => file.path === guide('g1')).via, 'folder');
  // S2: docs/rules.md (an @ import) and the build skill (a trigger) are Served. So no list of question 1 or 2 has them.
  const listed = [...find.items, ...close.items].map(item => item.label);
  for (const rel of [guide('g1'), guide('g2'), 'docs/rules.md', BUILD, P, near('n1')]) assert.ok(!listed.includes(rel), rel);
  const mapFile = rel => main.report.map.files.find(file => file.path === rel);
  assert.deepEqual([mapFile('docs/rules.md').steps, mapFile(BUILD).steps, mapFile(BUILD).via], [0, 1, 'trigger']);
  // Question 3: each typed rule. The saved rule says where it is.
  const told = q(V, 'told');
  assert.equal(told.answer, '3 rules typed, 1 already saved');
  assert.deepEqual(told.items.map(item => [item.label, item.count, item.saved, item.savedPath]),
    [[FACT_M.text, '2 times', false, null], [FACT_R.text, '1 time', true, 'docs/saved/rule.md'], [FACT_O.text, '1 time', false, 'docs/saved/orphan.md']]);
  assert.equal(itemOf(V, 'told', FACT_R.text).text, 'It is already saved in docs/saved/rule.md.');
  assert.ok(!JSON.stringify(V.questions).includes(FACT_T.text), 'no question shows the task fact');
});

test('S9 to S12: the start load penalty of the main run, and what counts as used', () => {
  const p = V.penalty;
  assert.deepEqual([p.max, p.freeTokens, p.perTokens], [15, 3000, 1000]);
  assert.equal(p.unusedTokens, 5006);
  assert.equal(p.points, 2);
  assert.equal(p.startTokens, main.report.totals.startLoadTokens);
  assert.equal(p.usedTokens, p.startTokens - 5006);
  // S10: no session read CLAUDE.md with a tool, and it is used. S11: the import that no intent needed is not used.
  // docs/rules.md is an import that s7 needed. S12: s8 loaded the body of the skill build. No session loaded deploy.
  assert.equal(startItem(V, 'CLAUDE.md', 'instructions').used, true);
  assert.equal(startItem(V, '~/.claude/CLAUDE.md', 'instructions').used, true);
  assert.equal(startItem(V, 'docs/rules.md', 'import').used, true);
  assert.equal(startItem(V, 'docs/extra.md', 'import').used, false);
  assert.equal(startItem(V, BUILD, 'skill description').used, true);
  assert.equal(startItem(V, '.claude/skills/deploy/SKILL.md', 'skill description').used, false);
  const lean = q(V, 'lean');
  assert.equal(lean.answer, `${p.startTokens.toLocaleString('en-US')} tokens, 5,006 not used, 2 points off`);
  assert.deepEqual(lean.items.map(item => [item.label, item.count, item.kind, item.tokens]),
    [['docs/extra.md', '5,000 tokens', 'start-item', 5000], ['.claude/skills/deploy/SKILL.md', '6 tokens', 'start-item', 6]]);
  assert.equal(lean.lines[0], `Start load: ${p.startTokens.toLocaleString('en-US')} tokens.`);
  assert.equal(lean.lines.length, 3);
});

// One need and one session. The @ import docs/big.md is the only unused start item.
// - 15,996 characters = 3,999 tokens: 0 points. n1 is Served: raw 100, score 100.
// - 16,000 characters = 4,000 tokens: 1 point. Score 99.
// - 120,000 characters = 30,000 tokens: floor(27,000 / 1,000) = 27, the limit is 15. CLAUDE.md does not link n1 here:
//   Missed, raw 0, and 0 - 15 is clamped to 0 (S13).
test('S9, S13, S15: the penalty edges, the clamp, and thin data', () => {
  for (const [item, unused, points, score, label] of [[p3999, 3999, 0, 100, 'good'], [p4000, 4000, 1, 99, 'good'], [p30000, 30000, 15, 0, 'poor']]) {
    assert.deepEqual([item.v1.penalty.unusedTokens, item.v1.penalty.points, item.v1.score, item.v1.label], [unused, points, score, label], item.name);
    assert.equal(item.v1.shown, 'thin', item.name);
    assert.ok(Number.isInteger(item.v1.score) && item.v1.score >= 0 && item.v1.score <= 100, item.name);
  }
  assert.deepEqual(p30000.v1.grades, { served: 0, slow: 0, missed: 1, total: 1 });
  // S15: 2 sessions and 4 needs (3 Served, c Missed). raw 75. Unused: docs/extra.md 5,000, the 2 skill descriptions 6 + 6,
  // docs/rules.md (42 characters = 11 tokens) = 5,023 tokens, 2 points. The score 73 stays in report.json, and no number shows.
  assert.deepEqual(thin.v1.grades, { served: 3, slow: 0, missed: 1, total: 4 });
  assert.deepEqual([thin.v1.penalty.unusedTokens, thin.v1.penalty.points, thin.v1.score, thin.v1.shown], [5023, 2, 73, 'thin']);
  assert.equal(thin.v1.reason, 'Only 2 analysed sessions and 4 needs (5 sessions and 20 needs are necessary).');
  assert.equal(thin.v1.headline, `Not enough data (method v1). ${thin.v1.reason}`);
  assert.match(thin.stdout, /^score v1: Not enough data \(method v1\)\. /m);
});

test('S14: no session gives no score, with a reason', () => {
  const v1 = empty.v1;
  assert.deepEqual([v1.score, v1.label, v1.raw, v1.shown], [null, null, null, 'no-data']);
  assert.equal(v1.reason, 'The tool found no session of this project.');
  assert.equal(v1.headline, `No data (method v1). ${v1.reason}`);
  assert.deepEqual(v1.questions.map(item => [item.key, item.answer, item.n]), [['find', null, 0], ['close', null, 0], ['told', null, 0], ['lean', null, 0]]);
  assert.equal(v1.proof.status, 'no-data');
});

test('S16: the score, the parts and the counts of steps 9 and 11 stay, and they agree with v1', () => {
  const health = main.report.health;
  assert.deepEqual(Object.keys(health), ['method', 'weights', 'score', 'label', 'reason', 'parts', 'data', 'counts', 'v1']);
  assert.ok(Number.isInteger(health.score));
  assert.deepEqual(Object.keys(health.parts), ['found', 'close', 'oneSource']);
  // The same needs: 42 counted, and 35 of them have a route (31 Served and 4 Slow).
  assert.deepEqual([health.parts.found.counted, health.parts.found.reached], [42, 35]);
  // The one needed file with no route is c. 3 typed rules, 1 saved.
  assert.deepEqual(health.counts.noRoute.items, [{ path: lost('c'), uses: 4 }]);
  assert.deepEqual([health.counts.told.facts, health.counts.told.saved], [3, 1]);
  assert.equal(health.data.needs, 42);
});

// The same 17 sessions on the fixture that stays at commit 1 (no link to a, b, c, p or rule.md, the 3 guides behind the
// folder link, no late.md and no extra.md):
// - Served 17: s0 1, s1 3, s2 3, s3 2, s7 3, s8 2, s11 1, s12 1, s15 1.
// - Slow 10: p in s3, the 3 guides of s4, g3 in s9, p and q in s11, q in s12, g1 in s13, p in s14.
// - Missed 14: s5 3, s6 3 (a, b and the rule R), c in s9, s10 2, M in s12, a and b in s13, c in s14, c in s16.
// - 41 needs: docs/new/late.md is not on disk, so its read is gone. raw = 100 x (17 + 5) / 41 = 53.66.
// - Unused: the description of deploy, 6 tokens: 0 points. Score 54. Commit 2 gives 77.
test('S17: the context fix of commit 2 moves the score on the same sessions', () => {
  assert.deepEqual(first.v1.grades, { served: 17, slow: 10, missed: 14, total: 41 });
  assert.deepEqual([first.v1.raw, first.v1.penalty.points, first.v1.score], [53.7, 0, 54]);
  assert.ok(V.score > first.v1.score);
});

// The proof of the main run. The grade of each need on the map of the commit of its session (see the comments of the sessions):
// - Served 21: s1 3, s2 3, s3 2, s7 3, s8 2, s11 1, s12 1, s13 3, s14 1, s15 1, s16 1. 0 searched. Typed rules: 0.5 (s12). 0.5 / 21 = 0.024.
// - Slow 8: p in s3, s4 3, g3 in s9, p and q in s11, q in s12. Searched 5 (s4 3, s9 1, s12 1): 0.625. Typed rules: 0.5 (s12): 0.063.
// - Missed 8: s5 3, s6 2, c and late.md in s9, c in s14. Searched 8: 1. Typed rules: 1 (s6): 0.125.
// - Missed has fewer than 10 needs, so "other" is Slow and Missed: 16 needs, 13 searched = 0.8125 (0.813), 1.5 rules = 0.09375 (0.094).
// Pass: 21 >= 10, 16 >= 10, 0 < 0.813, 0.024 <= 0.094.
test('P1, P3, P5, P6, P10, P12, P13: the proof of the main run uses the map of the commit of each session', () => {
  const proof = V.proof;
  assert.equal(proof.status, 'pass');
  assert.deepEqual(proof.limits, { served: 10, other: 10 });
  assert.equal(proof.compare, 'slow+missed');
  assert.deepEqual(proof.grades, {
    served: { needs: 21, searched: 0, searchRate: 0, typedFacts: 0.5, typedFactRate: 0.024, ways: { search: 0, user: 0, none: 0 } },
    slow: { needs: 8, searched: 5, searchRate: 0.625, typedFacts: 0.5, typedFactRate: 0.063, ways: { search: 5, user: 0, none: 0 } },
    missed: { needs: 8, searched: 8, searchRate: 1, typedFacts: 1, typedFactRate: 0.125, ways: { search: 4, user: 0, none: 4 } },
    other: { needs: 16, searched: 13, searchRate: 0.813, typedFacts: 1.5, typedFactRate: 0.094, ways: { search: 9, user: 0, none: 4 } } });
  assert.deepEqual(proof.checks, { enough: true, searchRate: true, typedFactRate: true });
  assert.equal(proof.text, 'Proven on 16 sessions: the agent searched for 0% of the Served needs and for 81% of the Slow and Missed needs. ' +
    'You typed 0.024 rules for each Served need and 0.094 for each Slow and Missed need.');
  // P3: the session before the first commit is left out. P13: the 2 rules of s10 have no file need to go to.
  assert.deepEqual(proof.sessions, { used: 16, leftOut: [{ sessionId: S.s0, reason: 'no-commit-before', text: 'The project has no commit before the start of this session.' }] });
  assert.equal(proof.factsLeftOut, 2);
  // P1: a session between the commits has commit 1, a session after commit 2 has commit 2.
  const commitOf = id => proof.commits.find(item => item.sessionId === id);
  const short = sha => sha.slice(0, 7);
  assert.equal(proof.commits.length, 16);
  for (const id of [S.s1, S.s5, S.s9, S.s12]) assert.deepEqual(commitOf(id), { sessionId: id, commit: short(R2.shas.c1), branch: 'main', fallback: false });
  for (const id of [S.s13, S.s14]) assert.deepEqual(commitOf(id), { sessionId: id, commit: short(R2.shas.c2), branch: 'main', fallback: false });
  // P5: the branch is gone, so the default branch, and the proof says so. P6: the session uses its own branch.
  assert.deepEqual(commitOf(S.s15), { sessionId: S.s15, commit: short(R2.shas.c1), branch: 'main', fallback: true });
  assert.deepEqual(commitOf(S.s16), { sessionId: S.s16, commit: short(R2.shas.w), branch: 'wt-branch', fallback: false });
  const s16 = main.report.sessions.list.find(item => item.sessionId === S.s16);
  assert.deepEqual([s16.worktree, s16.gitBranch], ['wt', 'wt-branch']);
  // P10: the note about the files that are not in git.
  assert.equal(proof.notes[0], 'Memory files and the files of ~/.claude are not in git. The proof uses their state of today.');
  // The page shows the number.
  assert.deepEqual([V.shown, V.reason, V.headline], ['score', null, '77 mixed (method v1)']);
});

test('P4, P14: a project with no git gives the same score, and the score is not proven', () => {
  const v1 = plain.v1;
  assert.equal(v1.proof.status, 'not-enough');
  assert.equal(v1.proof.sessions.used, 0);
  assert.equal(v1.proof.sessions.leftOut.length, 17);
  assert.ok(v1.proof.sessions.leftOut.every(item => item.reason === 'no-git'));
  assert.deepEqual(v1.proof.commits, []);
  // P9: a grade with no need has no rate.
  assert.deepEqual(v1.proof.grades.served, { needs: 0, searched: 0, searchRate: null, typedFacts: 0, typedFactRate: null, ways: { search: 0, user: 0, none: 0 } });
  // P14: the proof changes only `shown`, `reason` and `headline`.
  const { proof: _a, shown: _b, reason: _c, headline: _d, ...rest } = v1;
  const { proof: _e, shown: _f, reason: _g, headline: _h, ...mainRest } = V;
  assert.deepEqual(rest, mainRest);
  assert.equal(v1.shown, 'not-proven');
  assert.ok(v1.reason.startsWith('The project is not a git repository'));
  assert.equal(v1.headline, `Score not proven (method v1). ${v1.reason}`);
});

// 5 sessions, each with n1, n2, n3 and the index: 20 Served needs on the map of commit 1, and no other need.
// Today: 20 Served needs, raw 100, 2 points off (the same 5,023 unused tokens as the thin run), score 98.
test('P7, P9: not enough needs for the proof gives "not-enough", with the numbers', () => {
  const v1 = few.v1;
  assert.deepEqual([v1.score, v1.label, v1.shown], [98, 'good', 'not-proven']);
  assert.equal(v1.proof.status, 'not-enough');
  assert.deepEqual(v1.proof.checks, { enough: false, searchRate: null, typedFactRate: null });
  assert.deepEqual([v1.proof.grades.served.needs, v1.proof.grades.other.needs, v1.proof.grades.other.searchRate, v1.proof.grades.missed.typedFactRate], [20, 0, null, null]);
  assert.equal(v1.reason, '5 sessions with a commit give 20 Served needs and 0 Slow and Missed needs (10 of each are necessary).');
  assert.equal(v1.proof.text, `Score not proven: ${v1.reason}`);
  assert.equal(v1.headline, `Score not proven (method v1). ${v1.reason}`);
});

// On the map of commit 1: Served 17 (12 searched near notes, and the index 5 times): 12 / 17 = 0.706.
// Slow 10 (p and q, 5 times each), 0 searched. 0.706 is not below 0, so the proof fails.
test('P8: the agent searched more for the Served needs, so the proof fails', () => {
  const v1 = fail.v1;
  assert.equal(v1.proof.status, 'fail');
  assert.deepEqual([v1.proof.grades.served.needs, v1.proof.grades.served.searched, v1.proof.grades.served.searchRate], [17, 12, 0.706]);
  assert.deepEqual([v1.proof.grades.other.needs, v1.proof.grades.other.searched, v1.proof.grades.other.searchRate], [10, 0, 0]);
  assert.deepEqual(v1.proof.checks, { enough: true, searchRate: false, typedFactRate: true });
  assert.equal(v1.shown, 'not-proven');
  assert.equal(v1.reason, 'The agent searched for 71% of the Served needs and for 0% of the Slow and Missed needs. The rate of the Served needs must be lower.');
  assert.ok(Number.isInteger(v1.score), 'the score stays in report.json');
});

test('P2: the tool does not change the project', () => {
  assert.deepEqual(after.main, before.main);
  assert.deepEqual(after.first, before.first);
  assert.equal(before.main.status, '');
  assert.equal(before.main.head, R2.shas.c2);
  assert.equal(before.main.worktrees, 1);
});

test('P11: the old files go only into <cache>/history/<commit>/, and a second run does not read them from git again', () => {
  assert.deepEqual(readdirSync(historyDir).sort(), [R2.shas.c1, R2.shas.c2, R2.shas.w].sort());
  for (const sha of Object.values(R2.shas)) {
    const files = JSON.parse(readFileSync(path.join(historyDir, sha, 'files.json'), 'utf8'));
    assert.equal(files.commit, sha);
    // Each file of the commit is in the list. Only the context files are on disk.
    assert.ok(files.files.includes('src/app.js') && files.files.includes('CLAUDE.md'));
    assert.ok(existsSync(path.join(historyDir, sha, 'tree', 'CLAUDE.md')) && existsSync(path.join(historyDir, sha, 'tree', BUILD)));
    assert.ok(!existsSync(path.join(historyDir, sha, 'tree', 'src', 'app.js')));
  }
  assert.equal(readFileSync(path.join(historyDir, R2.shas.c1, 'tree', 'CLAUDE.md'), 'utf8'), V1);
  assert.equal(readFileSync(path.join(historyDir, R2.shas.w, 'tree', 'CLAUDE.md'), 'utf8'), VW);
  assert.ok(!existsSync(path.join(historyDir, R2.shas.c1, 'tree', 'docs', 'new', 'late.md')));
  // The second run on the same cache wrote no file of the history again.
  assert.deepEqual(tree(historyDir), historyBefore);
  assert.match(main.stdout, /3 commits \(3 read from git\)$/m);
  assert.match(again.stdout, /3 commits \(0 read from git\)$/m);
});

test('S19, R1, R2: the command prints the v1 line, and each run of the same input gives the same report.json', () => {
  assert.match(main.stdout, /^score v1: 77 mixed \(method v1\)\. proof: pass, 16 of 17 sessions, 3 commits \(3 read from git\)$/m);
  assert.equal(again.json, main.json, 'the same cache');
  assert.equal(fresh.json, main.json, 'a new cache');
  // No folder of the cache and no time of the run is in the report.
  for (const item of all) {
    assert.ok(!item.json.includes(path.join(work, 'cache')) && !item.json.includes('/history/'), item.name);
    assert.equal(item.v1.method, 'v1', item.name);
    assert.ok(item.v1.headline.includes('(method v1)'), item.name);
    assert.deepEqual(Object.keys(item.v1), ['method', 'rules', 'score', 'label', 'shown', 'reason', 'headline', 'base', 'grades', 'raw', 'penalty', 'questions', 'facts', 'proof'], item.name);
    assert.deepEqual(Object.keys(item.v1.proof), ['status', 'text', 'limits', 'compare', 'sessions', 'grades', 'checks', 'factsLeftOut', 'commits', 'notes'], item.name);
    assert.equal(item.v1.grades.served + item.v1.grades.slow + item.v1.grades.missed, item.v1.grades.total, item.name);
    assert.equal(item.v1.questions.length, 4, item.name);
  }
});
