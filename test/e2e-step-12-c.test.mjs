// E2E for step 12, part C (typed fact kinds, and the question of each fix): run the real command on small git projects
// that this file writes into a temporary folder, each with its own settings home, the sessions that this file writes,
// and a copy of the fake claude binary with the answers of this file. No real model call.
// The ways it can fail are in the step 12 failure list (T1 to T8, X1 to X6). Each test names its cases.
// The expected numbers are worked out by hand in the comments.
// Artifact: out/e2e-step-12-c/report.json, report.html, prompt.txt and facts.md (each typed fact, its kind, where it went).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const ID = n => `84${String(n).padStart(6, '0')}-0000-0000-0000-000000000000`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step12c-'));
const V3 = readFileSync(path.join(repo, 'src', 'prompts', 'needs-check-v3.md'), 'utf8');
const V2 = readFileSync(path.join(repo, 'src', 'prompts', 'needs-check-v2.md'), 'utf8');

// ---------- the projects ----------

function makeProject(name, files) {
  const dir = path.join(work, name, 'demo');
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  return dir;
}
const CLAUDE_MD = ['# Demo project', '', 'The build takes 5 minutes.', 'Read the [index of the documents](docs/index.md) first.',
  'The guides are in [docs/guides/](docs/guides/).', 'The API note of x: [x](docs/api/x.md).', 'More lists: [the extra list](extra/list.md).', ''].join('\n');
const INDEX_MD = ['# Index', '', 'The build takes 8 minutes.', '- [p](deep/p.md): the deep note', 'The owner reads each release note before it goes out.', ''].join('\n');
const SKILL = '.claude/skills/build/SKILL.md';
// P: one file for each place of a fix.
// - docs/lost/a.md: no file links it (no-route). docs/guides/g1.md: behind a folder link of CLAUDE.md.
// - docs/api/x.md: CLAUDE.md links it by name. The skill body: behind a trigger.
// - extra/list.md is a linked file (not a named file). It links extra/item.md.
// - docs/index.md links docs/deep/p.md, and p.md links q.md: the linker of q.md is 2 steps from the start (far).
// - docs/saved/rule.md and docs/saved/task.md: no file links them. Each holds one typed fact.
const P = makeProject('main', {
  'CLAUDE.md': CLAUDE_MD,
  'docs/index.md': INDEX_MD,
  'docs/deep/p.md': '# P\n\nThe deep note. See [q](q.md).\n',
  'docs/deep/q.md': '# Q\n\nThe last note of the deep folder.\n',
  'docs/guides/g1.md': '# Guide g1\n\nThe first guide of the demo.\n',
  'docs/api/x.md': '# X\n\nThe cache lives for 20 days.\n',
  'extra/list.md': '# Extra list\n\n- [item](item.md)\n',
  'extra/item.md': '# Item\n\nThe one item of the extra list.\n',
  'docs/lost/a.md': '# Lost a\n\nNo file links the note a.\n',
  'docs/saved/rule.md': '# Rule\n\nAsk the owner before a release.\n',
  'docs/saved/task.md': '# Task\n\nUse the short heading for the note of this week.\n',
  [SKILL]: '---\nname: build\ndescription: Build the demo.\n---\n\n# Build\n\nRun the build script.\n'
});
// BARE: no CLAUDE.md and no AGENTS.md. One file that no file links.
const BARE = makeProject('bare', { 'docs/root/r1.md': '# r1\n\nThe root note r1.\n' });

// ---------- the settings homes and their sessions ----------

const userClaude = readFileSync(path.join(repoSettings, 'CLAUDE.md'), 'utf8');
function makeHome(name) {
  const dir = path.join(work, 'homes', name);
  cpSync(repoSettings, dir, { recursive: true, filter: source => path.relative(repoSettings, source).split(path.sep)[0] !== 'projects' });
  mkdirSync(path.join(dir, 'projects', MAIN), { recursive: true });
  return dir;
}
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

// The fake binary and its answers, in the temporary folder.
const fakeRoot = path.join(work, 'fake');
const fake = path.join(fakeRoot, 'test', 'fake-claude.mjs');
mkdirSync(path.dirname(fake), { recursive: true });
copyFileSync(path.join(repo, 'test', 'fake-claude.mjs'), fake);
chmodSync(fake, 0o755);
const fakeAnswers = path.join(fakeRoot, 'fixtures', 'fake-claude');
mkdirSync(fakeAnswers, { recursive: true });
const answer = (name, result) => writeFileSync(path.join(fakeAnswers, name), `${JSON.stringify({ total_cost_usd: 0.01, result }, null, 2)}\n`);

let nextId = 0;
// One session. `blocks`: one for each intent: { goal, reads, told }.
// - `reads`: project paths that the agent reads with nothing that names them, or `{ grep: path }` for a file that a search gave.
// - `told`: the facts that the user types in the intent: { text, quote, kind, had, now }.
//   `kind`: the kind of the fake answer. The key is left out of the answer when the fact has no `kind` key.
//   `had`: { path, quote } gives `found: true`. `now`: { path, quote } is the place of today.
function session(home, project, blocks, { startFile = 'CLAUDE.md', startText = null } = {}) {
  nextId += 1;
  const id = ID(nextId);
  const items = [];
  const intents = [];
  const checks = [];
  let message = 0;
  for (const block of blocks) {
    message += 1;
    items.push({ user: `${block.goal}.` });
    const intent = { start: message, goal: block.goal, corrections: [] };
    for (const item of block.reads || []) {
      const rel = item.grep ?? item;
      if (item.grep) items.push({ grep: path.basename(rel, '.md'), files: [abs(rel)] });
      items.push({ read: abs(rel), text: readFileSync(path.join(project, rel), 'utf8') });
    }
    items.push({ agent: 'Done.' });
    for (const fact of block.told || []) {
      message += 1;
      items.push({ user: `${fact.quote}.` });
      if (fact.now) items.push({ write: abs(fact.now.path), text: 'A draft.' });
      items.push({ agent: 'Ok.' });
      intent.corrections.push({ message, text: fact.text, quote: fact.quote, cause: 'missing-context' });
      checks.push({ correction: `c${checks.length + 1}`, found: Boolean(fact.had), path: fact.had?.path ?? null, quote: fact.had?.quote ?? null,
        now: fact.now ? { path: fact.now.path, quote: fact.now.quote } : null, ...('kind' in fact ? { kind: fact.kind } : {}) });
    }
    intents.push(intent);
  }
  if (!checks.length) items.push({ user: 'Thanks.' });
  writeSession(home, id, day(22 - nextId), startOf(project, startFile, startText), items);
  answer(`${id}.intents.json`, { intents });
  if (checks.length) answer(`${id}.needs-check.json`, { checks });
  return id;
}
const OLDER = { startText: '# Demo project\n\nAn older text with no link.\n' };

// The typed facts. Each text is in no file of the project, but for the facts with `had` or `now`.
const RULE_A = { text: 'No price in a release note', quote: 'No price in a release note', kind: 'rule' };
const RULE_SAVED = { text: 'The owner reads each release note', quote: 'I read each release note first', kind: 'rule',
  now: { path: 'docs/index.md', quote: 'The owner reads each release note before it goes out.' } };
const RULE_NO_ROUTE = { text: 'Ask the owner before a release', quote: 'Ask me before a release', kind: 'rule', now: { path: 'docs/saved/rule.md', quote: 'Ask the owner before a release.' } };
const RULE_C = { text: 'Each note has the name of its writer', quote: 'Put the name of the writer in each note', kind: 'rule' };
const NO_KIND = { text: 'Write the date in each note', quote: 'Write the date in each note' };
const BAD_KIND = { text: 'Dates use the form year month day', quote: 'Dates are year month day here', kind: 'maybe' };
const NUM_KIND = { text: 'A note has 200 words at most', quote: 'Keep a note below 200 words', kind: 7 };
const UPPER_KIND = { text: 'Links in a note are full links', quote: 'Use full links in a note', kind: 'TASK' };
const TASK_A = { text: 'Make the heading of this note blue', quote: 'Make this heading blue', kind: 'task' };
const TASK_SAVED = { text: 'Use the short heading for the note of this week', quote: 'Take the short heading this week', kind: 'task',
  now: { path: 'docs/saved/task.md', quote: 'Use the short heading for the note of this week.' } };
const TASK_BAD_QUOTE = { text: 'Remove the old draft folder', quote: 'Remove the old draft folder now', kind: 'task', had: { path: 'CLAUDE.md', quote: 'These words are not in the file.' } };
const TASK_B = { text: 'Leave the second page for later', quote: 'Do only the first page now', kind: 'task' };
const TASK_C = { text: 'Rename the export button to Save', quote: 'Call that button Save', kind: 'task' };
// The agent had this fact. The answer says `task`, but a fact that the agent had stays a `had` need (T5).
const HAD_TASK = { text: 'The build takes 5 minutes', quote: 'The build is 5 minutes, as the file says', kind: 'task', had: { path: 'CLAUDE.md', quote: 'The build takes 5 minutes.' } };
const HAD_RULE = { text: 'Read the index of the documents first', quote: 'Read the index first, as the file says', kind: 'rule',
  had: { path: 'CLAUDE.md', quote: 'Read the [index of the documents](docs/index.md) first.' } };
const TASKS = [TASK_A, TASK_SAVED, TASK_BAD_QUOTE, TASK_B, TASK_C];

// ----- HM: the main home -----
const HM = makeHome('main');
// S1: 12 typed facts in one intent.
const S1 = session(HM, P, [{ goal: 'Draft the release note', told: [RULE_A, TASK_A, NO_KIND, BAD_KIND, HAD_TASK, TASK_SAVED, TASK_BAD_QUOTE, RULE_SAVED, NUM_KIND, RULE_NO_ROUTE, UPPER_KIND, HAD_RULE] }]);
// S2: the same rule and the same task a second time.
const S2 = session(HM, P, [{ goal: 'Draft the next note', told: [RULE_A, TASK_A] }]);
// S3: 2 intents. The first has a task fact and a rule, the second only a task fact.
const S3 = session(HM, P, [{ goal: 'Write the first page', told: [TASK_B, RULE_C] }, { goal: 'Change the export page', told: [TASK_C] }]);
// The places of the fixes.
session(HM, P, [{ goal: 'Read the lost note and the index', reads: ['docs/lost/a.md', 'docs/index.md'] }]);
session(HM, P, [{ goal: 'Find the first guide', reads: [{ grep: 'docs/guides/g1.md' }] }]);
session(HM, P, [{ goal: 'Find the API note', reads: [{ grep: 'docs/api/x.md' }] }], OLDER);
session(HM, P, [{ goal: 'Find the last deep note, the item and the build skill', reads: [{ grep: 'docs/deep/q.md' }, { grep: 'extra/item.md' }, { grep: SKILL }] }]);
// ----- HB: the root item -----
const HB = makeHome('bare');
session(HB, BARE, [{ goal: 'Read the root note', reads: ['docs/root/r1.md'] }], { startFile: null });

// ---------- the runs ----------

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const callsNow = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const head = call => call.stdin.split('\n', 1)[0];
const isCheck = call => head(call).startsWith('context-health needs-check ');
const sessionOf = call => head(call).split(' ').at(-1);
function run(name, project, home, { intents = true, cache = name, out = path.join(work, 'out', name) } = {}) {
  const before = callsNow().length;
  mkdirSync(out, { recursive: true });
  const args = [cli, project, '--claude-settings-home', home, '--out', out, '--cache', path.join(work, 'cache', cache), '--no-open', '--no-save', '--old-path', OLD];
  if (intents) args.push('--intents');
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  const json = readFileSync(path.join(out, 'report.json'), 'utf8');
  return { name, json, report: JSON.parse(json), stdout: result.stdout, calls: callsNow().slice(before) };
}
const artifact = path.join(repo, 'out', 'e2e-step-12-c');
// The run id of the duplicate check is a hash of the file paths, and the run id of the group call is a hash of the
// intents. A first run gives them, then this file writes the answers. So the run r1 has no failed call.
const probe = run('probe', P, HM);
const groupsId = probe.calls.map(head).filter(line => line.startsWith('context-health intent-groups ')).at(-1).split(' ').at(-1);
answer(`${groupsId}.intent-groups.json`, { groups: [{ label: 'Write and change the notes', members: [1, 2, 3, 4] }, { label: 'Read and find the notes', members: [5, 6, 7, 8] }] });
const runId = probe.calls.map(head).filter(line => line.startsWith('context-health duplicates ')).at(-1).split(' ').at(-1);
answer(`${runId}.duplicates.json`, { facts: [
  { what: 'How long the build takes', same: false, places: [
    { path: 'CLAUDE.md', quote: 'The build takes 5 minutes.', value: '5 minutes' }, { path: 'docs/index.md', quote: 'The build takes 8 minutes.', value: '8 minutes' }] }
] });
// r1: the main run, with model calls and a new cache. r2: the same cache, no `--intents`.
const r1 = run('main', P, HM, { out: artifact });
const r2 = run('main-again', P, HM, { intents: false, cache: 'main' });
// r3: a cache with the intents of r1 and, in place of each v3 check file, a file as the v2 tool wrote it: the name has
// the v2 key (the v2 prompt, and the input with `needs-check-v2` in its first line). No `--intents`.
const cacheMain = path.join(work, 'cache', 'main');
const cacheOld = path.join(work, 'cache', 'old-v2');
cpSync(cacheMain, cacheOld, { recursive: true, filter: source => path.relative(cacheMain, source).split(path.sep)[0] !== 'needs' });
const keyOf = (prompt, input) => sha256(`${prompt}\nsonnet\n${input}`);
const oldFiles = [];
for (const call of r1.calls.filter(isCheck)) {
  const sessionId = sessionOf(call);
  const input = call.stdin.replace('needs-check-v3', 'needs-check-v2');
  const key = keyOf(V2, input);
  const checks = JSON.parse(readFileSync(path.join(fakeAnswers, `${sessionId}.needs-check.json`), 'utf8')).result.checks;
  write(path.join(cacheOld, 'needs', `${sessionId}.${key}.json`), `${JSON.stringify({ promptVersion: 'needs-check-v2', model: 'sonnet', sessionId, key, costUsd: 0.01,
    result: JSON.stringify({ checks }) }, null, 2)}\n`);
  oldFiles.push({ sessionId, key, v3Key: keyOf(V3, call.stdin) });
}
const r3 = run('old-cache', P, HM, { intents: false, cache: 'old-v2' });
const bare = run('bare', BARE, HB);

// ---------- helpers ----------

const R = r1.report;
const KINDS = ['root', 'no-route', 'told', 'searched', 'one-source'];
const fixesOf = report => [...report.fixes.list, ...report.fixes.smaller];
const entryOf = (report, sessionId) => report.needs.sessions.find(entry => entry.sessionId === sessionId);
const toldOf = (report, sessionId) => entryOf(report, sessionId).intents.flatMap(intent => intent.needs).filter(need => need.kind !== 'file');
const sectionOf = (report, n) => {
  const text = report.prompt.text;
  const from = text.indexOf(`## ${n}. `);
  const to = n === 6 ? text.length : text.indexOf(`## ${n + 1}. `);
  return text.slice(from, to);
};
const one = (report, test2) => {
  const hits = fixesOf(report).filter(test2);
  assert.equal(hits.length, 1, `one fix, got ${hits.length}: ${hits.map(fix => fix.text).join(' | ')}`);
  return hits[0];
};
const NEED_KEYS = ['id', 'kind', 'path', 'correctionId', 'message', 'text', 'quote', 'checkResult', 'sourceQuote', 'savedPath', 'savedQuote'];
const TASK_KEYS = ['correctionId', 'message', 'text', 'quote', 'checkResult', 'savedPath', 'savedQuote', 'factKind'];

// The artifact: the prompt, and one row for each typed fact of the main run.
write(path.join(artifact, 'prompt.txt'), R.prompt.text);
{
  const facts = [S1, S2, S3].flatMap(sessionId => {
    const answers = JSON.parse(readFileSync(path.join(fakeAnswers, `${sessionId}.needs-check.json`), 'utf8')).result.checks;
    return entryOf(R, sessionId).intents.flatMap(intent => [
      ...intent.needs.filter(need => need.kind !== 'file').map(need => ({ need, where: `need ${need.id} (${need.kind})` })),
      ...intent.taskFacts.map(need => ({ need, where: 'intent.taskFacts and needs.taskFacts' }))
    ].map(({ need, where }) => {
      const given = answers.find(check => check.correction === need.correctionId);
      const fix = fixesOf(R).find(item => item.kind === 'told' && item.text.includes(need.text));
      const saved = R.health.parts.found.saved.some(item => item.text === need.text);
      return { sessionId, intentId: intent.intentId, need, where, given: 'kind' in given ? JSON.stringify(given.kind) : '(no key)',
        fix: fix ? `${fix.id} (question ${fix.question})` : saved ? 'none: a file with a route holds it' : 'none' };
    })).sort((a, b) => a.need.message - b.need.message);
  });
  write(path.join(artifact, 'facts.md'), '# The typed facts of the main run of test/e2e-step-12-c.test.mjs\n\n' +
    `needs-check prompt: ${R.needs.promptVersion}. Task facts: ${R.needs.taskFacts.count}. ${R.health.counts.told.text}.\n\n` +
    '| session | intent | correction | fact | kind in the answer | check | factKind | where it went | fix |\n|---|---|---|---|---|---|---|---|---|\n' +
    `${facts.map(row => `| ${row.sessionId.slice(0, 8)} | ${row.intentId} | ${row.need.correctionId} | ${row.need.text} | ${row.given} | ${row.need.checkResult} | ` +
      `${'factKind' in row.need ? row.need.factKind : '(no key)'} | ${row.where} | ${row.fix} |`).join('\n')}\n\n` +
    '## The fixes and their questions\n\n| id | kind | question | needs | target | text |\n|---|---|---|---|---|---|\n' +
    `${fixesOf(R).map(fix => `| ${fix.id} | ${fix.kind} | ${fix.question} | ${fix.needs} | ${fix.target} | ${fix.text.replaceAll('|', '\\|')} |`).join('\n')}\n`);
}

// ---------- the checks: typed facts ----------

test('T6, T8: the model call says needs-check-v3, and the prompt has each kind and no dash', () => {
  assert.equal(R.needs.promptVersion, 'needs-check-v3');
  const checks = r1.calls.filter(isCheck);
  assert.deepEqual(checks.map(sessionOf).sort(), [S1, S2, S3].sort(), 'one check call for each session with a correction');
  for (const call of checks) {
    assert.match(head(call), /^context-health needs-check needs-check-v3 session [0-9a-f-]{36}$/);
    assert.equal(call.argv.at(-1), V3, 'the system prompt is the v3 file');
    assert.ok(!call.stdin.includes('needs-check-v2'));
  }
  // T8: no en dash, no em dash. An example of each kind, the rule for a fact that is not clear, and the kind in the answer shape.
  assert.ok(!/[\u2013\u2014]/.test(V3), 'no en dash and no em dash in the prompt');
  assert.ok((V3.match(/^\s+- task: "[^"]+"/gm) || []).length >= 2, 'task examples');
  assert.ok((V3.match(/^\s+- rule: "[^"]+"/gm) || []).length >= 2, 'rule examples');
  assert.ok(V3.includes('When you are not sure, the kind is "rule"'));
  assert.ok(V3.includes('"kind": "rule"') && V3.includes('"kind": "task"'));
  assert.ok(V3.includes('Answer this question for each correction, also when found is true. The kind does not depend on questions 1 and 2.'));
  // The v2 file stays for the record, and the v3 text has each line of it but the lines that name the count of questions and the answer shape.
  const kept = V2.split('\n').filter(line => line.trim() && !line.includes('answer 2 questions') && !line.includes('"correction"') && !line.startsWith('- When you are not sure'));
  for (const line of kept) assert.ok(V3.includes(line), line);
});

test('T2, T3, T5: a rule stays a need, a bad kind counts as a rule, a fact that the agent had stays a had need', () => {
  // S1 by hand: 12 facts. 3 are task facts (c2, c6, c7). 2 are facts that the agent had (c5, c12). 7 are missing needs.
  assert.deepEqual(toldOf(R, S1).map(need => [need.correctionId, need.kind, need.checkResult, need.factKind, need.savedPath]), [
    ['c1', 'missing', 'not-found', 'rule', null], // T2
    ['c3', 'missing', 'not-found', null, null], // T3: no `kind` key
    ['c4', 'missing', 'not-found', null, null], // T3: the word "maybe"
    ['c5', 'had', 'had', undefined, null], // T5: the answer says `task`, the agent had the fact
    ['c8', 'missing', 'not-found', 'rule', 'docs/index.md'],
    ['c9', 'missing', 'not-found', null, null], // T3: a number
    ['c10', 'missing', 'not-found', 'rule', 'docs/saved/rule.md'],
    ['c11', 'missing', 'not-found', null, null], // T3: "TASK" is not the word `task`
    ['c12', 'had', 'had', undefined, null]
  ]);
  // The keys: `factKind` is the last key of a missing need. A had need and a file need do not have it.
  let missing = 0;
  for (const report of [R, r2.report, r3.report, bare.report]) {
    for (const need of report.needs.sessions.flatMap(entry => entry.intents.flatMap(intent => intent.needs))) {
      if (need.kind === 'missing') { missing += 1; assert.deepEqual(Object.keys(need), [...NEED_KEYS, 'factKind']); assert.ok(need.factKind === 'rule' || need.factKind === null); }
      else if (need.kind === 'had') assert.deepEqual(Object.keys(need), NEED_KEYS);
      else assert.ok(!('factKind' in need));
    }
  }
  assert.ok(missing > 0);
  const had = toldOf(R, S1).find(need => need.correctionId === 'c5');
  assert.deepEqual([had.path, had.sourceQuote, had.text], ['CLAUDE.md', 'The build takes 5 minutes.', HAD_TASK.text]);
  // The ids of the needs have no gap where a task fact was.
  assert.deepEqual(toldOf(R, S1).map(need => need.id), ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9']);
});

test('T1, T7: a task fact is only in taskFacts, and no total counts it', () => {
  const s1 = entryOf(R, S1).intents[0];
  assert.deepEqual(Object.keys(s1), ['intentId', 'from', 'to', 'needs', 'taskFacts', 'otherReads', 'totals']);
  assert.deepEqual(s1.taskFacts, [
    { correctionId: 'c2', message: 3, text: TASK_A.text, quote: TASK_A.quote, checkResult: 'not-found', savedPath: null, savedQuote: null, factKind: 'task' },
    // A task fact that a file holds keeps the place, but it is not a need of that file.
    { correctionId: 'c6', message: 7, text: TASK_SAVED.text, quote: TASK_SAVED.quote, checkResult: 'not-found', savedPath: 'docs/saved/task.md',
      savedQuote: 'Use the short heading for the note of this week.', factKind: 'task' },
    // `found: true` with a quote that is not in the file: the agent did not have it, so the kind decides.
    { correctionId: 'c7', message: 8, text: TASK_BAD_QUOTE.text, quote: TASK_BAD_QUOTE.quote, checkResult: 'bad-quote', savedPath: null, savedQuote: null, factKind: 'task' }
  ]);
  // T7: the totals of each intent. S1: 7 missing and 2 had (not 10 and 2). S2: 1 and 0. S3: 1 and 0, then 0 and 0.
  assert.deepEqual(s1.totals, { fileNeeds: 0, missing: 7, had: 2 });
  assert.deepEqual(entryOf(R, S2).intents.map(intent => [intent.totals, intent.taskFacts.map(fact => fact.correctionId)]), [[{ fileNeeds: 0, missing: 1, had: 0 }, ['c2']]]);
  assert.deepEqual(entryOf(R, S3).intents.map(intent => [intent.totals, intent.needs.map(need => need.correctionId), intent.taskFacts.map(fact => fact.correctionId)]), [
    [{ fileNeeds: 0, missing: 1, had: 0 }, ['c2'], ['c1']],
    [{ fileNeeds: 0, missing: 0, had: 0 }, [], ['c3']]
  ]);
  // `needs.taskFacts` is the last key. 6 task facts: 3 of S1, 1 of S2, 2 of S3. The order: session, intent, correction.
  assert.deepEqual(Object.keys(R.needs), ['promptVersion', 'sessions', 'dropped', 'taskFacts']);
  assert.equal(R.needs.taskFacts.count, 6);
  const expected = R.needs.sessions.flatMap(entry => entry.intents.flatMap(intent => intent.taskFacts.map(fact => (
    { sessionId: entry.sessionId, intentId: intent.intentId, correctionId: fact.correctionId, text: fact.text, quote: fact.quote }))));
  assert.deepEqual(R.needs.taskFacts.list, expected);
  assert.deepEqual(R.needs.taskFacts.list.map(fact => [fact.sessionId, fact.intentId, fact.correctionId]).sort(), [
    [S1, 'i1', 'c2'], [S1, 'i1', 'c6'], [S1, 'i1', 'c7'], [S2, 'i1', 'c2'], [S3, 'i1', 'c1'], [S3, 'i2', 'c3']].sort());
  for (const entry of R.needs.sessions) for (const intent of entry.intents) {
    assert.ok(Array.isArray(intent.taskFacts), 'taskFacts is always there');
    for (const fact of intent.taskFacts) assert.deepEqual(Object.keys(fact), TASK_KEYS);
    assert.ok(!intent.needs.some(need => need.factKind === 'task'));
  }
  // T7: the later steps. 8 typed rules (RULE_A 2 times, NO_KIND, BAD_KIND, RULE_SAVED, NUM_KIND, RULE_NO_ROUTE, UPPER_KIND,
  // RULE_C: 9 needs, 8 facts), 1 of them saved in a file with a route. With the 6 task facts, the counts are 15 and 13.
  assert.equal(R.routes.metrics.toldByUser.count, 9);
  assert.deepEqual([R.health.counts.told.facts, R.health.counts.told.saved], [8, 1]);
  assert.equal(R.health.counts.told.text, '8 facts you had to type (1 already saved)');
  assert.deepEqual(R.health.parts.found.told.map(item => [item.text, item.uses]).sort(), [
    [RULE_A.text, 2], [NO_KIND.text, 1], [BAD_KIND.text, 1], [NUM_KIND.text, 1], [RULE_NO_ROUTE.text, 1], [UPPER_KIND.text, 1], [RULE_C.text, 1]].sort());
  assert.deepEqual(R.health.parts.found.saved.map(item => [item.text, item.path]), [[RULE_SAVED.text, 'docs/index.md']]);
  assert.match(r1.stdout, /8 facts typed \(1 saved\)/);
  assert.match(r1.stdout, /told by user 9\b/);
  // T1: no text of a task fact in the routes, in the parts and counts of health, or in the questions of v1.
  const later = JSON.stringify([R.routes, R.health.parts, R.health.counts, R.health.v1?.questions ?? null, R.health.v1?.facts?.rule ?? null, R.score]);
  for (const fact of TASKS) assert.ok(!later.includes(fact.text) && !later.includes(fact.quote), fact.text);
  // A project with no typed fact: the keys are there, and the list is empty.
  assert.deepEqual(bare.report.needs.taskFacts, { count: 0, list: [] });
  assert.deepEqual(bare.report.needs.sessions.flatMap(entry => entry.intents.map(intent => intent.taskFacts)), [[]]);
});

test('T4: the cache key has the prompt version, and a v2 cache file is not a v3 answer', () => {
  // The cache files of r1: the name has the hash of the v3 prompt, the model and the input.
  const names = readdirSync(path.join(cacheMain, 'needs')).sort();
  assert.deepEqual(names, oldFiles.map(item => `${item.sessionId}.${item.v3Key}.json`).sort());
  for (const item of oldFiles) assert.notEqual(item.key, item.v3Key);
  const saved = JSON.parse(readFileSync(path.join(cacheMain, 'needs', names[0]), 'utf8'));
  assert.equal(saved.promptVersion, 'needs-check-v3');
  // r2: no `--intents`, the same cache. No call, and the same report byte for byte.
  assert.equal(r2.calls.length, 0);
  assert.equal(r2.json, r1.json);
  for (const sessionId of [S1, S2, S3]) assert.equal(entryOf(r2.report, sessionId).check.status, 'ok');
  // r3: only v2 files in the cache, no `--intents`. No call. Each check is not analysed, as before for a missing cache.
  assert.equal(r3.calls.length, 0);
  assert.deepEqual(readdirSync(path.join(cacheOld, 'needs')).sort(), oldFiles.map(item => `${item.sessionId}.${item.key}.json`).sort(), 'the tool wrote no file');
  for (const sessionId of [S1, S2, S3]) {
    assert.deepEqual(entryOf(r3.report, sessionId).check, { status: 'not-analysed', reason: 'not analysed: run with --intents', costUsd: null }, sessionId);
    for (const need of toldOf(r3.report, sessionId)) {
      assert.deepEqual([need.kind, need.checkResult, need.path, need.savedPath, need.savedQuote, need.factKind], ['missing', 'not-checked', null, null, null, null]);
    }
  }
  // With no answer, each fact counts as a rule: 12 + 2 + 3 needs, and no task fact.
  assert.deepEqual([S1, S2, S3].map(sessionId => toldOf(r3.report, sessionId).length), [12, 2, 3]);
  assert.deepEqual(r3.report.needs.taskFacts, { count: 0, list: [] });
  assert.match(r3.stdout, /needs: 3 sessions have a missing-context check that is not analysed/);
  assert.equal(r3.report.intents.sessions.filter(entry => entry.status === 'ok').length, 7, 'the intents come from the cache');
});

// ---------- the checks: the place of each fix ----------

test('X1, X4: each fix has a question as its last key, and the limit, the ids and the order of step 11 stay', () => {
  for (const { name, report } of [r1, r2, r3, bare]) {
    const fixes = report.fixes;
    const list = fixesOf(report);
    assert.deepEqual(Object.keys(fixes), ['limit', 'total', 'list', 'smaller', 'left'], name);
    for (const fix of list) {
      assert.deepEqual(Object.keys(fix), ['id', 'kind', 'needs', 'files', 'target', 'line', 'text', 'question'], `${name} ${fix.id}`);
      assert.ok(['find', 'close', 'told'].includes(fix.question), `${name} ${fix.id}: ${fix.question}`);
    }
    assert.equal(fixes.limit, 10, name);
    assert.ok(fixes.list.length <= 10, name);
    assert.equal(fixes.total, list.length, name);
    assert.deepEqual(list.map(fix => fix.id), list.map((_, k) => `x${k + 1}`), name);
    if (fixes.smaller.length) assert.equal(fixes.list.length, 10, name);
    const sorted = [...list].sort((a, b) => b.needs - a.needs || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || cmp(a.target, b.target) || cmp(a.files[0] ?? '', b.files[0] ?? '') || cmp(a.text, b.text));
    assert.deepEqual(list.map(fix => fix.id), sorted.map(fix => fix.id), `${name}: the order`);
    // The prompt has the text of each fix of the list, in order.
    const numbered = sectionOf(report, 5).split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));
    assert.deepEqual(numbered, fixes.list.map(fix => fix.text), name);
  }
  // The main run by hand: 7 told fixes (the 7 facts of `found.told`), 1 no-route, 5 searched, 1 one-source: 14.
  assert.equal(R.fixes.total, 14);
  assert.equal(R.fixes.list.length, 10);
  assert.equal(R.fixes.smaller.length, 4);
  assert.equal(sectionOf(R, 5).trim().split('\n').at(-1), 'And 4 smaller items.');
  // The first fix: RULE_A, the only cause with 2 needs.
  assert.deepEqual([R.fixes.list[0].kind, R.fixes.list[0].needs], ['told', 2]);
});

test('X2: the question of each kind of fix', () => {
  const q = test2 => one(R, test2).question;
  // find: no route, a named link whose text must say when to read the file, a trigger description, a fact with 2 values.
  const lost = one(R, fix => fix.files.includes('docs/lost/a.md'));
  assert.deepEqual([lost.kind, lost.question], ['no-route', 'find']);
  const link = one(R, fix => fix.files.includes('docs/api/x.md'));
  assert.deepEqual([link.kind, link.target, link.question], ['searched', 'CLAUDE.md', 'find']);
  assert.ok(link.text.includes('make the link text of docs/api/x.md say what the file holds and when to read it'), link.text);
  const trigger = one(R, fix => fix.files.includes(SKILL));
  assert.deepEqual([trigger.kind, trigger.target, trigger.question], ['searched', SKILL, 'find']);
  assert.ok(trigger.text.includes('loads behind a trigger'), trigger.text);
  const source = one(R, fix => fix.kind === 'one-source');
  assert.deepEqual([source.question, source.target], ['find', 'docs/index.md']);
  // close: a folder link, a linker that is not a named file, a far linker.
  const folder = one(R, fix => fix.files.includes('docs/guides/g1.md'));
  assert.deepEqual([folder.kind, folder.question], ['searched', 'close']);
  assert.ok(folder.text.includes('links only the folder docs/guides/'), folder.text);
  const other = one(R, fix => fix.files.includes('extra/item.md'));
  assert.deepEqual([other.kind, other.target, other.question], ['searched', 'CLAUDE.md', 'close']);
  assert.ok(other.text.startsWith('Link this file from CLAUDE.md') && other.text.includes('extra/list.md names it today'), other.text);
  const far = one(R, fix => fix.files.includes('docs/deep/q.md'));
  assert.deepEqual([far.kind, far.target, far.question], ['searched', 'CLAUDE.md', 'close']);
  assert.ok(far.text.startsWith('Link this file from CLAUDE.md'), far.text);
  // told: each typed rule, also the rule that a file with no route holds.
  const told = fixesOf(R).filter(fix => fix.kind === 'told');
  assert.equal(told.length, 7);
  for (const fix of told) assert.equal(fix.question, 'told', fix.id);
  assert.equal(q(fix => fix.text.includes(RULE_NO_ROUTE.text)), 'told');
  for (const fix of fixesOf(R)) if (fix.question === 'told') assert.equal(fix.kind, 'told', fix.id);
  // root: the project with no start file.
  assert.equal(bare.report.fixes.total, 1);
  assert.deepEqual([bare.report.fixes.list[0].kind, bare.report.fixes.list[0].question], ['root', 'find']);
  // Each question has a fix in the main run, in `list` or in `smaller`.
  assert.deepEqual([...new Set(fixesOf(R).map(fix => fix.question))].sort(), ['close', 'find', 'told']);
  assert.ok(R.fixes.smaller.every(fix => 'question' in fix) && R.fixes.smaller.length > 0);
});

test('X3, X6: no fix and no prompt line for a task fact', () => {
  const told = fixesOf(R).filter(fix => fix.kind === 'told');
  // One fix for each fact of `found.told`: the 7 rules. No fix for RULE_SAVED (a file with a route holds it).
  assert.deepEqual(told.map(fix => R.health.parts.found.told.find(item => fix.text.includes(item.text))?.text).sort(),
    [RULE_A, NO_KIND, BAD_KIND, NUM_KIND, RULE_NO_ROUTE, UPPER_KIND, RULE_C].map(fact => fact.text).sort());
  for (const fact of TASKS) {
    for (const fix of fixesOf(R)) assert.ok(!fix.text.includes(fact.text) && !fix.text.includes(fact.quote), `${fix.id}: ${fact.text}`);
    assert.ok(!R.prompt.text.includes(fact.text) && !R.prompt.text.includes(fact.quote), `prompt: ${fact.text}`);
  }
  // The file that holds a task fact gets no fix: it is not a need.
  assert.ok(!fixesOf(R).some(fix => fix.text.includes('docs/saved/task.md') || fix.target === 'docs/saved/task.md'));
  // The rules are in the prompt: the list of typed facts of section 4, with the count of each.
  const s4 = sectionOf(R, 4);
  assert.ok(s4.includes(`- "${RULE_A.text}" (2 times). The user said: "${RULE_A.quote}"`), s4);
  assert.ok(s4.includes(`- "${NO_KIND.text}" (1 time).`));
  assert.ok(s4.includes(`- "${RULE_SAVED.text}": in docs/index.md (1 step from the start).`));
  // r3: with no answer, each fact is a rule, so the task facts of r1 are told facts there. The data decides, not the text.
  assert.ok(r3.report.prompt.text.includes(TASK_A.text));
});

test('X5: the prompt has one line with the v1 headline when health has it, and does not crash without it', () => {
  for (const { name, report } of [r1, r2, r3, bare]) {
    const s1 = sectionOf(report, 1);
    const lines = s1.split('\n').filter(line => line.startsWith('- The score of today: '));
    const headline = report.health.v1?.headline;
    if (headline) {
      assert.equal(lines.length, 1, `${name}: one line`);
      assert.ok(lines[0].includes(headline.replace(/[\u2013\u2014]/g, '-')), `${name}: ${lines[0]}`);
      // The line is above the 5 counts.
      assert.ok(s1.indexOf(lines[0]) < s1.indexOf('The 5 counts of today:'), name);
    } else {
      assert.equal(lines.length, 0, `${name}: no line with no v1`);
    }
    assert.ok(s1.includes('The 5 counts of today:'), name);
    assert.ok(!/[\u2013\u2014]/.test(report.prompt.text), `${name}: no dash in the prompt`);
  }
});
