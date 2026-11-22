// E2E for step 10, faults 2 and 9 (the duplicate check): run the real command with the fake claude binary
// test/fake-claude.mjs. No real model call. The ways it can fail are in the step 10 failure list (X1 to X10,
// L1 to L6, G1, G2, G4) and in the worker B list (X11 to X24, L7 to L15). Each test names its cases.
//
// Part X (fault 2, "disagree" is almost always false): a git copy of fixtures/indoeuromap plus 3 files in step10/.
//   The files hold invented sentences: each quote of the fake answer fixtures/fake-claude/run-e242eab1c417.duplicates.json
//   is one list item of its file. The table X_CASES gives the verdict of the fake model and the result that the code
//   must give. The project has no sessions, so only the duplicate check calls the model.
// Part L (fault 9, the input limit): a copy of fixtures/context-ab/bad with more context text than the input limit,
//   the 6 recorded sessions of fixtures/context-ab/claude-home, and one more session (94000001) that reads a file
//   through a worktree path. The needed files go in by uses for each character, so one large file does not push
//   out the small needed files. Fake answer: fixtures/fake-claude/run-49c1c35d7a09.duplicates.json.
//
// Artifact: out/e2e-step-10-b/guard-and-order.md (each X case with its result, and the input order of part L), and the
// reports in out/e2e-step-10-b/x/ and out/e2e-step-10-b/l/. Same content on every run.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fake = path.join(repo, 'test', 'fake-claude.mjs');
const answers = path.join(repo, 'fixtures', 'fake-claude');
const artifact = path.join(repo, 'out', 'e2e-step-10-b');
mkdirSync(artifact, { recursive: true });
const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step-10-b-'));
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const LIMIT = 240000;
// Git-ignored in this repo too, so a git copy of the repo can miss them. Each project copy gets all 3.
const RESEARCH = ['wave-1-finish-2026-10-20', 'europe-expansion-2026-10-20', 'growth-metrics-2026-10-21'].map(name => `data/research/${name}/README.md`);

const sha256 = text => createHash('sha256').update(text).digest('hex');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const answerOf = run => JSON.parse(readFileSync(path.join(answers, `${run}.duplicates.json`), 'utf8'));

function snapshot(dir) {
  const hash = createHash('sha256');
  const walk = rel => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else hash.update(child).update(readFileSync(path.join(dir, child)));
    }
  };
  walk('');
  return hash.digest('hex');
}

// Step 11: only real context files count. The guard files of part X (step10/), the filler file of part L
// (aaa-filler/), the 2 index files of data/ and the 3 research files (git ignores them) would be out, and
// second-iteration/direction.md of part L too (no file links it in context-ab/bad). This file checks the duplicate
// check, not the rule. So each run passes a config file that includes these folders: the list of files is the list
// of step 10, and the run ids of the fake answers (a hash of the file paths) do not change.
const configs = new Map();
// A project copy with the 3 research files, then `change(project)`, then a git repository. `include`: the globs of its config file.
function makeProject(name, source, change, include) {
  const project = path.join(work, name, 'indoeuromap');
  mkdirSync(path.join(work, name), { recursive: true });
  writeFileSync(path.join(work, name, 'context-files.json'), `${JSON.stringify({ include }, null, 2)}\n`);
  configs.set(project, path.join(work, name, 'context-files.json'));
  cpSync(source, project, { recursive: true });
  for (const rel of RESEARCH) {
    if (existsSync(path.join(project, rel))) continue;
    mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    writeFileSync(path.join(project, rel), `# ${rel.split('/')[2]}\n\nLocal research record.\n`);
  }
  change(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  execFileSync('git', ['-C', project, 'add', '-A']);
  return project;
}
const gitStatus = project => execFileSync('git', ['-C', project, 'status', '--porcelain', '--untracked-files=all', '--ignored'], { encoding: 'utf8' });

// One run of the real command. `name` is the out folder in the artifact folder.
function runTool({ name, project, settings, cache, log, intents = true, oldPath = false }) {
  const out = path.join(artifact, name);
  const args = [cli, project, '--claude-settings-home', settings, '--cache', cache, '--out', out, '--no-open', '--no-save', '--config', configs.get(project)];
  if (oldPath) args.push('--old-path', OLD);
  if (intents) args.push('--intents');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
  assert.equal(result.status, 0, result.stderr);
  const json = readFileSync(path.join(out, 'report.json'), 'utf8');
  return { json, html: readFileSync(path.join(out, 'report.html'), 'utf8'), report: JSON.parse(json), stdout: result.stdout };
}
const newLog = name => { const log = path.join(work, `${name}.jsonl`); writeFileSync(log, ''); return log; };
const newCache = name => mkdtempSync(path.join(work, `cache-${name}-`));
const dupCalls = log => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  .filter(call => call.stdin.startsWith('context-health duplicates '));
const pathsIn = stdin => [...stdin.matchAll(/^### FILE (.+)$/gm)].map(match => match[1]);
const runIdOf = paths => `run-${sha256([...paths].sort(cmp).join('\n')).slice(0, 12)}`;

// ---------- part X: the code guard ----------

const X_RUN = 'run-e242eab1c417';
const [GA, GB, GC] = ['a', 'b', 'c'].map(letter => `step10/guard-${letter}.md`);
// [failure ids, what, the value of each place, `same` of the fake model, `differ` that the code must give].
// The quotes are in the fake answer. Each value pair follows a pair of the real trial, with invented names.
const X_CASES = [
  // X1: the same value in other words. No number, literal or name differs, so the word of the model alone is not enough (X3).
  ['X1', 'The message count for the ready mark', ['100 messages', '100 new messages'], false, false],
  ['X1', 'The range of the repeat option', ['1 to 3', '3 or less'], false, false],
  ['X1', 'The recoveries in one turn', ['one recovery', 'at most one'], false, false],
  ['X1, X12', 'The first end date that the checker accepts', ['before 2090', 'before 2090-01-01'], false, false],
  ['X1', 'When an agent can commit', ['only when asked', 'only when told'], false, false],
  ['X1', 'The tool has no dependencies', ['no dependencies', 'no npm dependencies'], false, false],
  ['X1', 'No long dashes in a text', ['no em dashes', 'no long dashes'], false, false],
  ['X1', 'The default of the index mode', ['code default, claude off switch', 'code default, claude switches back'], false, false],
  ['X1, X6', 'The address of the home server', ['casa.example.org', 'casa.example.org to 4321'], false, false],
  ['X1', 'The scope of the plugin install', ['scope local', 'each project, scope local', 'per project, scope local'], false, false],
  ['X1', 'Where the remove command deletes a folder', ['only under books dir', 'only under ~/example-books'], false, false],
  ['X1, X14', 'A second run replaces the first', ['replaces the first run', 'replaces the earlier run'], false, false],
  ['X1', 'The capture switch is off by default', ['off by default', 'off is the default'], false, false],
  // X2: real disagreements. X15: each quote of the capture mode case also names the value of the other place.
  ['X2', 'The line limit of the journal', ['60 lines', '80 lines'], false, true],
  ['X2', 'The Node version of the toolchain', ['Node 24.22.1', 'Node 24.21.0'], false, true],
  ['X2, X11, X15', 'The default of the capture mode', ['default steps', 'default two-calls'], false, true],
  ['X6', 'The public variables of the dev file', ['five variables', 'six variables'], false, true],
  // X4: the numbers differ, but the model says that the values are the same. Both must agree.
  ['X4', 'How long a token is valid', ['30 days', '4 weeks'], true, false],
  ['X6', 'The count of the settings', ['five settings', '5 settings'], false, false],
  // X7: 3 places, one with another number.
  ['X7', 'The groups that a page shows', ['top 8', 'top 8', 'top 10'], false, true],
  ['X12', 'The tries of a download', ['1 to 3 tries', '1-3 tries'], false, false],
  ['X13', 'The Node line of the server', ['Node 24', 'Node 24.22.1'], false, false],
  ['X13', 'The wait between two tries', ['1 second', '1.5 seconds'], false, true],
  ['X14', 'Which run the report keeps', ['the 1st run', 'the 2nd run'], false, false],
  ['X16', 'What the agent says before a deploy', ['ask the owner first', 'tell the owner first'], false, false],
  ['X19', 'The time limit of a call', ['60s', '60 seconds'], false, false],
  ['X20', 'The row limit of an export', ['10,000 rows', '10000 rows'], false, false],
  ['X21', 'The address of the status page', ['status.example.org', 'https://status.example.org:8443'], false, false],
  ['X22', 'The file with the release notes', ['notes.md', 'docs/notes.md'], false, false],
  ['X24', 'The groups of a short list', ['top-8 groups', 'top 8 groups'], false, false],
  ['X23', 'The mode of the night runs', ['fast', 'full'], false, true]
];
const xAnswer = answerOf(X_RUN);
const xProject = makeProject('x', path.join(repo, 'fixtures', 'indoeuromap'), project => {
  const lines = new Map();
  for (const fact of xAnswer.result.facts) for (const place of fact.places) lines.set(place.path, [...(lines.get(place.path) || []), `- ${place.quote}`]);
  mkdirSync(path.join(project, 'step10'), { recursive: true });
  for (const [rel, list] of lines) writeFileSync(path.join(project, rel), `# Guard cases\n\n${list.join('\n')}\n`);
}, ['step10/**', 'data/**']);
const xSettings = path.join(work, 'x', 'claude-settings-home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), xSettings, { recursive: true });
const xBefore = [gitStatus(xProject), snapshot(xSettings)];
const xCache = newCache('x');
const xLog = newLog('x');
const x1 = runTool({ name: 'x', project: xProject, settings: xSettings, cache: xCache, log: xLog });
const x2 = runTool({ name: 'x', project: xProject, settings: xSettings, cache: xCache, log: xLog });
const xAfter = [gitStatus(xProject), snapshot(xSettings)];
const xFacts = new Map(x1.report.duplicates.facts.filter(fact => fact.source === 'model').map(fact => [fact.what, fact]));
const noteOf = (k, what) => `Fact ${k + 1} (${what.length > 50 ? `${what.slice(0, 47).trimEnd()}...` : what}): the model says that the places do not agree, but they show no different number, literal or name, so it is a copy`;

test('The fake answer of part X is the table of this file, and each quote is in its file', () => {
  assert.deepEqual(xAnswer.result.facts.map(fact => [fact.what, fact.places.map(place => place.value), fact.same]), X_CASES.map(row => [row[1], row[2], row[3]]));
  assert.deepEqual([...new Set(xAnswer.result.facts.flatMap(fact => fact.places.map(place => place.path)))].sort(cmp), [GA, GB, GC]);
  assert.equal(x1.report.duplicates.check.status, 'ok');
  // No quote was dropped: each model fact keeps all its places.
  assert.ok(!x1.report.duplicates.notes.some(note => note.includes('the quote is not in')), x1.report.duplicates.notes.join('\n'));
  for (const [, what, values] of X_CASES) assert.deepEqual(xFacts.get(what)?.places.map(place => place.value), values, what);
});

test('X1, X6, X12, X14, X16, X19 to X22, X24: the same value in other words, or with more detail, is a copy', () => {
  const copies = X_CASES.filter(row => row[3] === false && row[4] === false);
  assert.equal(copies.length, 23);
  for (const [ids, what] of copies) assert.equal(xFacts.get(what).differ, false, `${ids}: ${what}`);
});

test('X2, X6, X7, X11, X13, X15, X23: a real disagreement stays', () => {
  const real = X_CASES.filter(row => row[4]);
  assert.deepEqual(real.map(row => row[1]), ['The line limit of the journal', 'The Node version of the toolchain', 'The default of the capture mode',
    'The public variables of the dev file', 'The groups that a page shows', 'The wait between two tries', 'The mode of the night runs']);
  for (const [ids, what] of real) assert.equal(xFacts.get(what).differ, true, `${ids}: ${what}`);
  // X7: the fact with 3 places keeps all 3, and one different pair is enough.
  assert.deepEqual(xFacts.get('The groups that a page shows').places.map(place => place.path), [GA, GB, GC]);
  // The facts that disagree come first in the list.
  const differ = x1.report.duplicates.facts.map(fact => fact.differ);
  assert.deepEqual(differ, [...differ].sort((a, b) => b - a));
  assert.equal(differ.filter(Boolean).length, 7);
});

test('X3, X4: the model and the code must agree, and a note says when the code does not follow the model', () => {
  const notes = x1.report.duplicates.notes;
  X_CASES.forEach(([ids, what, , same, differ], k) => {
    // X3: `same: false` with no concrete difference gives one note. X4: `same: true` gives a copy with no note.
    assert.equal(notes.filter(note => note === noteOf(k, what)).length, same === false && !differ ? 1 : 0, `${ids}: ${what}`);
  });
  assert.equal(notes.length, 23);
  const token = xFacts.get('How long a token is valid');
  assert.deepEqual([token.differ, token.places.map(place => place.value)], [false, ['30 days', '4 weeks']]);
});

test('G4: the keys of duplicates keep their order, with needed and neededChecked at the end of check', () => {
  const d = x1.report.duplicates;
  assert.deepEqual(Object.keys(d), ['promptVersion', 'model', 'files', 'exact', 'check', 'facts', 'notes']);
  assert.deepEqual(Object.keys(d.check), ['status', 'reason', 'costUsd', 'checked', 'total', 'needed', 'neededChecked']);
  for (const fact of d.facts) {
    assert.deepEqual(Object.keys(fact), ['id', 'what', 'differ', 'source', 'places']);
    for (const place of fact.places) assert.deepEqual(Object.keys(place), ['path', 'quote', 'value']);
  }
  assert.deepEqual(d.facts.map(fact => fact.id), d.facts.map((_fact, k) => `f${k + 1}`));
  const keys = Object.keys(x1.report);
  assert.deepEqual(keys.slice(keys.indexOf('groups'), keys.indexOf('groups') + 3), ['groups', 'duplicates', 'routes']);
  assert.equal(d.promptVersion, 'duplicates-v2');
  // No session: no file is needed. All files fit, so no note names the limit.
  assert.deepEqual(d.check, { status: 'ok', reason: null, costUsd: 0.0204, checked: d.files, total: d.files, needed: 0, neededChecked: 0 });
  assert.ok(!d.notes.some(note => note.includes('input limit')));
});

test('G1, G2 (part X): two runs give the same bytes, and the project and the settings home do not change', () => {
  assert.equal(x2.json, x1.json);
  assert.equal(x2.html, x1.html);
  assert.equal(dupCalls(xLog).length, 1, 'run 2 uses the cache');
  assert.deepEqual(xAfter, xBefore);
  assert.match(dupCalls(xLog)[0].stdin.split('\n')[0], new RegExp(`^context-health duplicates duplicates-v2 session ${X_RUN}$`));
});

test('X9: an old duplicates-v1 answer in the cache is not used', () => {
  // The cache key holds the prompt text, the model name and the input.
  const stdin = dupCalls(xLog)[0].stdin;
  const prompt = name => readFileSync(path.join(repo, 'src', 'prompts', `${name}.md`), 'utf8');
  const keyV2 = sha256(`${prompt('duplicates-v2')}\nsonnet\n${stdin}`);
  assert.deepEqual(readdirSync(path.join(xCache, 'duplicates')), [`${keyV2}.json`]);
  // (a) The file that step 9 wrote for the same files: its key comes from the v1 prompt and the v1 first line.
  const v1Result = JSON.stringify({ facts: xAnswer.result.facts.map(({ same: _same, ...fact }) => fact) });
  const v1File = key => JSON.stringify({ promptVersion: 'duplicates-v1', model: 'sonnet', key, costUsd: 0.5, result: v1Result });
  const keyV1 = sha256(`${prompt('duplicates-v1')}\nsonnet\n${stdin.replace('duplicates duplicates-v2 session', 'duplicates duplicates-v1 session')}`);
  assert.notEqual(keyV1, keyV2);
  const cacheA = newCache('x9a');
  mkdirSync(path.join(cacheA, 'duplicates'));
  writeFileSync(path.join(cacheA, 'duplicates', `${keyV1}.json`), v1File(keyV1));
  const logA = newLog('x9a');
  const a = runTool({ name: 'x9-v1-key', project: xProject, settings: xSettings, cache: cacheA, log: logA, intents: false });
  assert.deepEqual([a.report.duplicates.check.status, a.report.duplicates.check.checked, dupCalls(logA).length], ['not-analysed', 0, 0]);
  assert.ok(a.report.duplicates.facts.every(fact => fact.source === 'exact'));
  // (b) A v1 answer (no `same`) under the v2 key is a bad cache file: it counts as a miss.
  const cacheB = newCache('x9b');
  mkdirSync(path.join(cacheB, 'duplicates'));
  writeFileSync(path.join(cacheB, 'duplicates', `${keyV2}.json`), v1File(keyV2));
  const logB = newLog('x9b');
  const b = runTool({ name: 'x9-v2-key', project: xProject, settings: xSettings, cache: cacheB, log: logB, intents: false });
  assert.equal(b.report.duplicates.check.status, 'not-analysed');
  // With --intents the same cache gives one new call, and the answer of the call replaces the bad file.
  const c = runTool({ name: 'x9-v2-key', project: xProject, settings: xSettings, cache: cacheB, log: logB });
  assert.deepEqual([c.report.duplicates.check.status, c.report.duplicates.check.costUsd, dupCalls(logB).length], ['ok', 0.0204, 1]);
  assert.equal(JSON.stringify(c.report.duplicates), JSON.stringify(x1.report.duplicates));
});

test('X5, X17: an answer with no verdict is a bad answer: one more try, then failed', () => {
  // One more file gives another run id, so the fake binary gives another answer. This test changes the X project.
  const cases = [['step10/extra-1.md', 'run-34f0d3c17d44', 'x5-no-same'], ['step10/extra-2.md', 'run-52750cae75ed', 'x17-same-as-text']];
  for (const [rel, run, name] of cases) {
    writeFileSync(path.join(xProject, rel), '# Extra\n\nA note that gives the project another list of files.\n');
    execFileSync('git', ['-C', xProject, 'add', '-A']);
    const log = newLog(name);
    const { report } = runTool({ name, project: xProject, settings: xSettings, cache: newCache(name), log });
    assert.equal(dupCalls(log).length, 2, `${name}: one more try`);
    assert.match(dupCalls(log)[0].stdin.split('\n')[0], new RegExp(` session ${run}$`));
    const fact = answerOf(run).result.facts[0];
    assert.ok(name === 'x5-no-same' ? !('same' in fact) : fact.same === 'false', name);
    assert.deepEqual(report.duplicates.check, { status: 'failed', reason: 'bad answer: fact 1 has no same (true or false)', costUsd: null,
      checked: 0, total: report.duplicates.files, needed: 0, neededChecked: 0 });
    assert.ok(report.duplicates.facts.every(fact => fact.source === 'exact'));
  }
});

// ---------- part L: the input limit ----------

const L_RUN = 'run-49c1c35d7a09';
const SESSION_W = '94000001-0000-0000-0000-000000000000';
const METHOD = 'pipeline/METHOD.md';
const RULES = 'second-iteration/decisions/method-and-data-rules.md';
const INDEX = 'second-iteration/decisions/index.md';
const DIRECTION = 'second-iteration/direction.md';
const COMPARE = 'second-iteration/decisions/compare.md';
const PLAN = 'second-iteration/plan.md';
const FILLER = 'aaa-filler/big.md';
// Lines of 3 words: they are not sentences for the exact check.
const filler = (tag, length) => {
  let text = '';
  for (let n = 1; text.length < length; n += 1) text += `filler ${tag} ${String(n).padStart(6, '0')}\n`;
  return `${text.slice(0, length - 1)}x`;
};
// The characters of a file in the input: its block is a line with the path, then the text with no space at its end.
const blockOf = (rel, text) => `\n### FILE ${rel}\n${text.trimEnd()}\n`.length;
const lProject = makeProject('l', path.join(repo, 'fixtures', 'context-ab', 'bad'), project => {
  const read = rel => readFileSync(path.join(project, rel), 'utf8');
  // Add filler lines, so the text of the file (with no space at its end) has `size` characters.
  const resize = (rel, tag, size) => {
    const old = read(rel).trimEnd();
    writeFileSync(path.join(project, rel), `${old}\n\n${filler(tag, size - old.length - 2)}\n`);
    assert.equal(read(rel).trimEnd().length, size);
  };
  // L13: a needed file with 4 uses that is a little smaller than the limit. With "more uses first" it went in after
  // AGENTS.md (6 uses), and then no other needed file did fit.
  resize(METHOD, 'method', LIMIT - 300 - blockOf('AGENTS.md', read('AGENTS.md')) - blockOf(METHOD, ''));
  // L2: a needed file (1 use) that is larger than the limit by itself.
  resize(RULES, 'rules', LIMIT + 5000);
  // L14: direction.md (3 uses) and compare.md (2 uses) get the same uses for each character: 3k and 2k characters.
  const k = Math.ceil(Math.max((read(DIRECTION).trimEnd().length + 3) / 3, (read(COMPARE).trimEnd().length + 3) / 2));
  resize(DIRECTION, 'direction', 3 * k);
  resize(COMPARE, 'compare', 2 * k);
  // L1: a large file that no intent read and that no file links. Its path comes early in path order.
  mkdirSync(path.join(project, 'aaa-filler'), { recursive: true });
  writeFileSync(path.join(project, FILLER), `# Filler\n\n${filler('big', 120000)}\n`);
}, [...JSON.parse(readFileSync(path.join(repo, 'fixtures', 'context-ab', 'context-files.json'), 'utf8')).include, 'aaa-filler/**']);
const lSettings = path.join(work, 'l', 'claude-home');
cpSync(path.join(repo, 'fixtures', 'context-ab', 'claude-home'), lSettings, { recursive: true });
{
  // L6: one more session. It reads plan.md through a worktree path, so plan.md is a needed file with 1 use.
  const text = readFileSync(path.join(lProject, PLAN), 'utf8');
  const file = `${OLD}/.claude/worktrees/w1/${PLAN}`;
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId: SESSION_W, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${SESSION_W.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse('2026-11-16T09:00:00.000Z') + k * 1000).toISOString(), ...extra }; };
  const records = [
    rec({ type: 'attachment', attachment: { type: 'instructions', files: [
      { path: `${HOME}/.claude/CLAUDE.md`, content: readFileSync(path.join(lSettings, 'CLAUDE.md'), 'utf8'), type: 'User' },
      { path: `${OLD}/CLAUDE.md`, content: readFileSync(path.join(lProject, 'CLAUDE.md'), 'utf8'), type: 'Project' }] } }),
    rec({ type: 'user', message: { role: 'user', content: 'What is the next step of the plan? Work in the worktree w1.' }, promptSource: 'typed', origin: { kind: 'human' } }),
    rec({ type: 'assistant', message: { id: 'msg_2', role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: 'toolu_94000001_2', name: 'Read', input: { file_path: file } }], usage } }),
    rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_94000001_2', type: 'tool_result', content: text }] },
      toolUseResult: { type: 'text', file: { filePath: file, content: text, numLines: text.split('\n').length, startLine: 1, totalLines: text.split('\n').length } } }),
    rec({ type: 'assistant', message: { id: 'msg_4', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'The next step is the comparison page.' }], usage } }),
    rec({ type: 'user', message: { role: 'user', content: 'Good. Start it.' }, promptSource: 'typed', origin: { kind: 'human' } }),
    rec({ type: 'assistant', message: { id: 'msg_6', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'Done.' }], usage } })];
  writeFileSync(path.join(lSettings, 'projects', '-Users-example-projects-indoeuromap', `${SESSION_W}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}
const lBefore = [gitStatus(lProject), snapshot(lSettings)];
const lCache = newCache('l');
const lLog = newLog('l');
const l1 = runTool({ name: 'l', project: lProject, settings: lSettings, cache: lCache, log: lLog, oldPath: true });
const l2 = runTool({ name: 'l', project: lProject, settings: lSettings, cache: lCache, log: lLog, oldPath: true });
const lAfter = [gitStatus(lProject), snapshot(lSettings)];
const lStdin = dupCalls(lLog)[0].stdin;
const lOrder = pathsIn(lStdin);
const LEFT_OUT = [METHOD, RULES, FILLER];
// The uses of each file, from the needs of the report: the file needs that are not gone.
const usesOf = report => {
  const uses = new Map();
  for (const entry of report.needs.sessions) {
    for (const intent of entry.intents) for (const need of intent.needs) if (need.kind === 'file' && need.state !== 'gone') uses.set(need.path, (uses.get(need.path) || 0) + 1);
  }
  return uses;
};
// The text of a file of part L. A `~/.claude/` path is in the settings home of the run.
const textOf = rel => readFileSync(rel.startsWith('~/.claude/') ? path.join(lSettings, rel.slice('~/.claude/'.length)) : path.join(lProject, rel), 'utf8');
// The characters of the text of a file that go into the input, and the characters of its block.
const sizeOf = rel => textOf(rel).trimEnd().length;
const blockIn = rel => blockOf(rel, textOf(rel));
// The order of the contract, worked out again here from the report. The needed files: more uses for each character
// first (compared with whole numbers), then more uses, then path. Then the others by map steps (no route last), then path.
function contractOrder(report, paths) {
  const uses = usesOf(report);
  const steps = new Map(report.map.files.map(file => [file.path, file.steps]));
  const far = rel => steps.get(rel) ?? Infinity;
  const needed = paths.filter(rel => uses.has(rel)).map(rel => ({ rel, uses: uses.get(rel), size: sizeOf(rel) }))
    .sort((a, b) => b.uses * a.size - a.uses * b.size || b.uses - a.uses || cmp(a.rel, b.rel)).map(item => item.rel);
  // The files with no use: the files of the project first, then the files outside it (`~/` paths). In each group by map steps, then path.
  const outside = rel => (rel.startsWith('~/') || rel.startsWith('/') ? 1 : 0);
  const others = paths.filter(rel => !uses.has(rel)).sort((a, b) => outside(a) - outside(b) || (far(a) === far(b) ? 0 : far(a) - far(b)) || cmp(a, b));
  return [...needed, ...others];
}
// The files of an order that fit in the limit, one after the other, after the first lines of the input.
function fill(order) {
  let length = lStdin.split('\n### FILE ')[0].length;
  return order.filter(rel => {
    if (length + blockIn(rel) > LIMIT) return false;
    length += blockIn(rel);
    return true;
  });
}

test('L1, L7, L12, L14: the needed files go in first, by uses for each character, then the others by map steps', () => {
  // The uses: 19 needs of the 6 recorded sessions, and plan.md from session 94000001.
  const uses = usesOf(l1.report);
  assert.deepEqual([...uses].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])), [['AGENTS.md', 6], [METHOD, 4], [INDEX, 3], [DIRECTION, 3], [COMPARE, 2], [RULES, 1], [PLAN, 1]]);
  // Uses for each 1,000 characters, high first: index.md (3 uses, short), AGENTS.md (6 uses), direction.md and
  // compare.md (a tie), plan.md (1 use). Then METHOD.md (4 uses, very large) and the rules file: both are left out.
  const density = rel => (1000 * uses.get(rel)) / sizeOf(rel);
  assert.ok(density(INDEX) > density('AGENTS.md') && density('AGENTS.md') > density(DIRECTION) && density(COMPARE) > density(PLAN)
    && density(PLAN) > density(METHOD) && density(METHOD) > density(RULES));
  // L14: direction.md (3 uses) and compare.md (2 uses) have the same uses for each character. More uses first, also
  // when the other path comes first in path order.
  assert.equal(2 * sizeOf(DIRECTION), 3 * sizeOf(COMPARE));
  assert.ok(cmp(COMPARE, DIRECTION) < 0);
  assert.deepEqual(lOrder.slice(0, 5), [INDEX, 'AGENTS.md', DIRECTION, COMPARE, PLAN]);
  // Then the files that no intent read: the start file (0 steps), then 1 step in path order, and so on.
  assert.deepEqual(lOrder.slice(5, 9), ['CLAUDE.md', '.claude/commands/brief.md', '.claude/commands/frontend-design-system.md', '.claude/skills/city-batch/SKILL.md']);
  const stepsOf = new Map(l1.report.map.files.map(file => [file.path, file.steps]));
  // The files of the project come before the files outside it (`~/.claude/` skills and commands). In each group: fewer steps first.
  const rest = lOrder.slice(5);
  const firstOutside = rest.findIndex(rel => rel.startsWith('~/'));
  assert.ok(firstOutside > 0 && rest.slice(firstOutside).every(rel => rel.startsWith('~/')), 'project files first, then the files outside the project');
  const others = rest.slice(0, firstOutside).map(rel => stepsOf.get(rel) ?? Infinity);
  assert.deepEqual(others, [...others].sort((a, b) => (a === b ? 0 : a - b)), 'fewer steps first, no route last');
  assert.ok(others.includes(Infinity) && others[0] === 0);
  const outsideSteps = rest.slice(firstOutside).map(rel => stepsOf.get(rel) ?? Infinity);
  assert.deepEqual(outsideSteps, [...outsideSteps].sort((a, b) => (a === b ? 0 : a - b)));
  // The full order is the order of the contract.
  assert.deepEqual(lOrder, contractOrder(l1.report, [...lOrder, ...LEFT_OUT]).filter(rel => !LEFT_OUT.includes(rel)));
  // A needed file that is far from the start (compare.md, 3 steps) is before a file at 0 steps that no intent read.
  assert.ok(stepsOf.get(COMPARE) === 3 && lOrder.indexOf(COMPARE) < lOrder.indexOf('CLAUDE.md'));
});

test('L1, L2, L13: a file that does not fit is left out, and the files after it go in', () => {
  assert.ok(lStdin.length <= LIMIT, `${lStdin.length} characters`);
  for (const rel of LEFT_OUT) assert.ok(!lOrder.includes(rel), rel);
  const uses = usesOf(l1.report);
  const needs = list => list.reduce((sum, rel) => sum + uses.get(rel), 0);
  const needed = [...uses.keys()];
  // L13: METHOD.md (4 uses) fits in the limit by itself. With "more uses first" it went in after AGENTS.md, and the
  // 5 other needed files did not fit: 2 needed files, 10 of the 20 needs.
  const byUses = fill([...needed].sort((a, b) => uses.get(b) - uses.get(a) || cmp(a, b)));
  assert.deepEqual([byUses, needs(byUses), needs(needed)], [['AGENTS.md', METHOD], 10, 20]);
  // With uses for each character, the 5 small needed files go in first, and METHOD.md does not fit after them:
  // 5 needed files, 15 of the 20 needs.
  const inInput = lOrder.filter(rel => uses.has(rel));
  assert.deepEqual([inInput, needs(inInput)], [[INDEX, 'AGENTS.md', DIRECTION, COMPARE, PLAN], 15]);
  assert.deepEqual(fill(contractOrder(l1.report, [...lOrder, ...LEFT_OUT])), lOrder);
  // L2: the rules file (1 use) is larger than the limit by itself. It is the last needed file. The files after it go in.
  assert.ok(sizeOf(RULES) > LIMIT);
  const order = contractOrder(l1.report, [...lOrder, ...LEFT_OUT]);
  assert.deepEqual(order.slice(5, 8), [METHOD, RULES, 'CLAUDE.md']);
  assert.ok(lOrder.includes('CLAUDE.md'));
  // L1: the filler file has no route and no use. It is left out, and the 3 small files with no route after it go in.
  const stepsOf = new Map(l1.report.map.files.map(file => [file.path, file.steps]));
  assert.equal(stepsOf.get(FILLER), null);
  assert.deepEqual(lOrder.filter(rel => !rel.startsWith('~/')).slice(-3), ['data/_index.data.md', 'data/spain/madrid/_index.madrid.md', 'first-iteration/docs/tiktok-first-post-2026-09-27.md']);
  // The files outside the project that no intent read (the user command and the user skills) come last.
  assert.deepEqual(lOrder.slice(-3), ['~/.claude/commands/create-commit.md', '~/.claude/skills/frontend-design/SKILL.md', '~/.claude/skills/unslop/SKILL.md']);
  // L9: the count line names the files in the input.
  assert.equal(lStdin.split('\n')[1], `Files: ${lOrder.length}`);
});

test('L3, L8: check names the needed files of the list and the needed files in the input, and a note gives both counts', () => {
  const d = l1.report.duplicates;
  const total = lOrder.length + LEFT_OUT.length;
  assert.deepEqual(d.check, { status: 'ok', reason: null, costUsd: 0.0187, checked: total - 3, total, needed: 7, neededChecked: 5 });
  assert.equal(d.files, total);
  assert.equal(d.notes[0], `The model check read ${total - 3} of ${total} files, 5 of 7 needed files: the others do not fit in the input limit of 240,000 characters`);
  assert.equal(d.notes.filter(note => note.includes('input limit')).length, 1);
  // The fake answer names only files of the input. Its 2 facts are kept: one disagreement, one copy.
  assert.deepEqual(d.facts.filter(fact => fact.source === 'model').map(fact => [fact.what, fact.differ, fact.places.length]),
    [['The line limit of status.md', true, 4], ['Show the city batch before run_batch', false, 3]]);
});

test('L11: the exact check still reads the files that are left out of the model input', () => {
  const exact = l1.report.duplicates.facts.filter(fact => fact.source === 'exact');
  const records = exact.find(fact => fact.places[0].quote === 'A profile needs 200 classified records.');
  assert.deepEqual(records?.places.map(place => place.path), [METHOD, DIRECTION]);
  // No filler line is a fact.
  assert.ok(!l1.report.duplicates.facts.some(fact => fact.places.some(place => place.quote.startsWith('filler '))));
});

test('L6: a read through a worktree path counts for the main file, and no worktree path is in the input', () => {
  assert.ok(!lStdin.includes('.claude/worktrees/'));
  assert.ok(!JSON.stringify(l1.report.duplicates).includes('.claude/worktrees/'));
  assert.equal(usesOf(l1.report).get(PLAN), 1);
  // Each needed file is a file of the map, so `needed` holds main paths only.
  const onMap = new Set(l1.report.map.files.map(file => file.path));
  assert.equal([...usesOf(l1.report).keys()].filter(rel => onMap.has(rel)).length, l1.report.duplicates.check.needed);
});

test('L4: the run id is the hash of the sorted paths, also when the order of the input changes', () => {
  assert.equal(lStdin.split('\n')[0], `context-health duplicates duplicates-v2 session ${L_RUN}`);
  assert.equal(runIdOf([...lOrder, ...LEFT_OUT]), L_RUN);
  // The same files with no session (no --old-path): no file is needed, so the order is by map steps only.
  const log = newLog('l-no-sessions');
  const { report } = runTool({ name: 'l-no-sessions', project: lProject, settings: lSettings, cache: newCache('l-no-sessions'), log });
  assert.equal(report.sessions.list.length, 0);
  const stdin = dupCalls(log)[0].stdin;
  assert.equal(stdin.split('\n')[0], lStdin.split('\n')[0]);
  const order = pathsIn(stdin);
  assert.notDeepEqual(order, lOrder);
  assert.equal(order[0], 'CLAUDE.md');
  // The same files are in the input (the 3 large files still do not fit), in another order: the same paths, the same id.
  assert.deepEqual([...order].sort(cmp), [...lOrder].sort(cmp));
  assert.deepEqual(order, contractOrder(report, [...order, ...LEFT_OUT]).filter(rel => !LEFT_OUT.includes(rel)));
  // plan.md is not a needed file here, so it comes after the files at 0 and 1 step.
  assert.ok(order.indexOf(PLAN) > order.indexOf('.claude/skills/city-batch/SKILL.md'));
  const total = order.length + 3;
  assert.deepEqual(report.duplicates.check, { status: 'ok', reason: null, costUsd: 0.0187, checked: total - 3, total, needed: 0, neededChecked: 0 });
  assert.equal(report.duplicates.notes[0], `The model check read ${total - 3} of ${total} files, 0 of 0 needed files: the others do not fit in the input limit of 240,000 characters`);
});

test('L5, G1, G2 (part L): the same input and the same reports on each run, and no change in the project', () => {
  assert.equal(l2.json, l1.json);
  assert.equal(l2.html, l1.html);
  assert.equal(dupCalls(lLog).length, 1, 'run 2 uses the cache');
  // A run with a new cache calls the model again: the input is the same, byte for byte, and so are the reports.
  const log = newLog('l-again');
  const l3 = runTool({ name: 'l-again', project: lProject, settings: lSettings, cache: newCache('l-again'), log, oldPath: true });
  assert.equal(dupCalls(log).length, 1);
  assert.equal(dupCalls(log)[0].stdin, lStdin);
  assert.equal(l3.json, l1.json);
  assert.equal(l3.html, l1.html);
  assert.deepEqual(lAfter, lBefore);
  assert.deepEqual([gitStatus(lProject), snapshot(lSettings)], lBefore);
});

test('L10: without --intents the model check reads no file, and no note names the limit', () => {
  const log = newLog('l-no-intents');
  const { report, stdout } = runTool({ name: 'l-no-intents', project: lProject, settings: lSettings, cache: newCache('l-no-intents'), log, oldPath: true, intents: false });
  assert.equal(dupCalls(log).length, 0);
  // No intents without the cache, so no file is needed here. The total stays.
  assert.deepEqual(report.duplicates.check, { status: 'not-analysed', reason: 'not analysed: run with --intents', costUsd: null,
    checked: 0, total: l1.report.duplicates.check.total, needed: 0, neededChecked: 0 });
  assert.deepEqual(report.duplicates.notes, []);
  // The command line says how many files a model check would read.
  assert.match(stdout, /duplicates: exact copies only\. Run with --intents to check facts with different words or values \(1 model call, \d+ of \d+ files, 0 of 0 needed files\)\./);
  // With the cache of run 1 (the intents and the duplicates answer), the same command gives the full result of run 1.
  const cached = runTool({ name: 'l-no-intents', project: lProject, settings: lSettings, cache: lCache, log, oldPath: true, intents: false });
  assert.equal(dupCalls(log).length, 0);
  assert.equal(JSON.stringify(cached.report.duplicates), JSON.stringify(l1.report.duplicates));
});

test('Artifact: each guard case with its result, and the input order of part L', () => {
  const rows = X_CASES.map(([ids, what, values, same]) => {
    const fact = xFacts.get(what);
    return `| ${ids} | ${what} | ${values.map(value => `"${value}"`).join(' and ')} | ${same ? 'same' : 'not the same'} | ${fact.differ ? 'disagree' : 'copy'} |`;
  });
  const uses = usesOf(l1.report);
  const steps = new Map(l1.report.map.files.map(file => [file.path, file.steps]));
  const order = contractOrder(l1.report, [...lOrder, ...LEFT_OUT]);
  // The characters are given for the needed files only: they are a part of their order.
  const lines = order.map((rel, k) => `| ${k + 1} | ${rel} | ${uses.get(rel) || 0} | ${uses.has(rel) ? sizeOf(rel).toLocaleString('en-US') : ''} | ${steps.get(rel) ?? 'no route'} | ${lOrder.includes(rel) ? 'yes' : 'no: it does not fit'} |`);
  const c = l1.report.duplicates.check;
  const text = ['# Step 10, worker B: the code guard and the input order', '',
    '## The code guard (part X)', '',
    'A fact disagrees only when the model says "not the same" and the code finds a different number, literal or name.', '',
    '| Failure ids | Fact | Values | Model | Result |', '|---|---|---|---|---|', ...rows, '',
    '## The input order (part L)', '',
    `The model check read ${c.checked} of ${c.total} files, ${c.neededChecked} of ${c.needed} needed files. The input has ${lStdin.length.toLocaleString('en-US')} characters. The limit is 240,000.`, '',
    'The needed files come first: more uses for each character first, then more uses, then the path. Then the other files: fewer map steps first.', '',
    '| # | File | Uses | Characters | Map steps | In the input |', '|---|---|---|---|---|---|', ...lines, ''].join('\n');
  assert.ok(!text.includes(os.tmpdir()) && !text.includes(os.homedir()) && !/[\u2013\u2014]/.test(text));
  writeFileSync(path.join(artifact, 'guard-and-order.md'), text);
  console.log(`Artifact: ${path.join(artifact, 'guard-and-order.md')}`);
});
