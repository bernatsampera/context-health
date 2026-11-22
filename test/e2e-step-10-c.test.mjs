// E2E for step 10, worker C (fault 8, the data): a "told by you" fact is checked against the context files of today.
// It runs the real command on a git copy of fixtures/indoeuromap, with a copy of fixtures/claude-settings-home, a memory
// folder for the project and 6 sessions that this file writes, and the fake claude binary. No real model call.
// The ways it can fail (S1 to S26, G1, G2, G4) are in the step 10 failure list. Each test names its cases.
//
// The memory folder of a project has the project root in its name, and the root of this test is a new temporary folder
// on each run. So the fake answers of this test hold the word MEMORY_DIR in the place of the memory folder. This file
// copies test/fake-claude.mjs and fixtures/fake-claude/ into the temporary folder and puts the real folder in.
// Artifact: out/e2e-step-10-c/report.json, report.html and files-now.md (the "Files now" list of each check).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-indoeuromap';
const B = '22222222-0000-0000-0000-000000000000';
const [T1, T2, T3, T4, T5, T6] = [1, 2, 3, 4, 5, 6].map(n => `9300000${n}-0000-0000-0000-000000000000`);
const NAMES = { [T1]: 'T1', [T2]: 'T2', [T3]: 'T3', [T4]: 'T4', [T5]: 'T5', [T6]: 'T6', [B]: 'B' };
const INPUT_LIMIT = 240000;
const FILES_NOW_LIMIT = 60000;

// ---------- the project copy ----------

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step-10-c-'));
const project = path.join(work, 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
git('init', '-q');
git('add', '-A');

// ---------- the settings home copy, with the memory folder of the project ----------

const settings = path.join(work, 'claude-settings-home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), settings, { recursive: true });
// The tool names the memory folder after the root as it is on the command line: each character that is not a letter or a digit is `-`.
const FOLDER = project.replace(/[^A-Za-z0-9]/g, '-');
const MEMORY = `~/.claude/projects/${FOLDER}/memory`; // the report form
const memoryDir = path.join(settings, 'projects', FOLDER, 'memory');
mkdirSync(memoryDir, { recursive: true });
const filler = (first, size, last = '') => {
  const line = 'This filler line makes the file long.\n';
  return `${first}\n${line.repeat(Math.ceil(size / line.length))}`.slice(0, size - last.length - 1) + `${last}\n`;
};
// 1,000 words that no other file has, so the long file of S25 has a size of more than 1,000 words.
const manyWords = Array.from({ length: 1000 }, (_, index) => `fw${String(index).padStart(4, '0')}x`).join(' ');
const memoryFiles = {
  'MEMORY.md': '# Memory index\n\n- [Decision edits](decision-edits-ask-first.md): how to change a decision file\n- [Legend colours](legend-colours.md): the colours of the map legend\n',
  // T1 writes this file after its correction. The text on disk is the text of today.
  'decision-edits-ask-first.md': '---\nname: decision-edits-ask-first\ndescription: ask before a decision file changes\n---\n\nShow each change of a decision file to the user first. Write the file only after the user says yes.\n\n**Why:** the user reads each decision before it is final.\n',
  // T2: a memory file that the index links, and a memory file that the index does not link (S6).
  'legend-colours.md': '---\nname: legend-colours\n---\n\nThe map legend uses the Okabe-Ito colours. Do not put red next to green.\n',
  'export-folder-note.md': 'Each parquet export goes to the folder exports/, with the date at the start.\n',
  // T4, correction c1: 5 to 2 shared words. Files 4, 5 and 6 are equal, so the path decides. The last file shares 1 word.
  'wm-quorblix-1.md': 'Quorblix zantic vembrel tarnoq plish.\n',
  'wm-quorblix-2.md': 'Quorblix zantic vembrel tarnoq.\n',
  'wm-quorblix-3.md': 'Quorblix zantic vembrel.\n',
  'wm-quorblix-4.md': 'Quorblix zantic.\n',
  'wm-quorblix-5.md': 'Quorblix zantic.\n',
  'wm-quorblix-6.md': 'Quorblix zantic.\n',
  'wm-quorblix-one-word.md': 'Quorblix alone, with the and for but not.\n',
  // T4, correction c2: the long file shares 3 words, the short file 2 of them. The short file must come first (S25).
  'wm-glimfar-short.md': 'Glimfar dustwel.\n',
  'wm-glimfar-long.md': `Glimfar dustwel krellin.\n\n${manyWords}\n`,
  // T4, correction c3: the stub shares 2 words, the full file 3. The full file must come first (S26).
  'wm-brimwok-stub.md': 'Brimwok sarnel.\n',
  'wm-brimwok-full.md': 'Brimwok sarnel tuvlin. The full note gives the reason, the date, the owner and the next step of this rule.\n',
  // T5 and T6: the limit. Files of 13,000 characters are cut to 12,000 plus the cut line.
  'limit-written-1.md': filler('Brantholt sevrik, written file 1. head-marker-h1', 13000, 'tail-marker-t1'),
  'limit-written-2.md': filler('Brantholt sevrik, written file 2.', 13000),
  'limit-written-3.md': filler('Brantholt sevrik, written file 3.', 7000),
  'limit-written-4.md': 'A short note with no shared word.\n',
  'limit-match-1.md': filler('Brantholt sevrik, match file 1.', 13000),
  'limit-match-2.md': filler('Brantholt sevrik, match file 2.', 11900),
  'limit-match-3.md': filler('Brantholt sevrik, match file 3.', 13000),
  'limit-match-4.md': 'Brantholt sevrik, match file 4.\n',
  'limit-match-5.md': 'Brantholt sevrik, match file 5.\n'
};
// The middle of limit-written-1.md (characters 10,000 to 11,000) is in the cut part.
memoryFiles['limit-written-1.md'] = `${memoryFiles['limit-written-1.md'].slice(0, 10400)}middle-marker-m1${memoryFiles['limit-written-1.md'].slice(10416)}`;
for (const [name, text] of Object.entries(memoryFiles)) writeFileSync(path.join(memoryDir, name), text);
const mem = name => `${MEMORY}/${name}`;
// The path of a memory file in a fake session: the fake home is the home of another machine, so the tool maps it to ~/.claude/.
const memAbs = name => `${HOME}/.claude/projects/${FOLDER}/memory/${name}`;

// ---------- the sessions ----------

const sessionDir = path.join(settings, 'projects', MAIN);
const fileText = rel => readFileSync(path.join(project, rel), 'utf8');
const userClaude = readFileSync(path.join(settings, 'CLAUDE.md'), 'utf8');
const OLD_CLAUDE = '# Project instructions\n\nRead [AGENTS.md](AGENTS.md) first.\n';

// Items: { user }, { agent }, { read: abs, text }, { write: abs, text }. `claude` is the text of the project CLAUDE.md in the start load.
function writeSession(sessionId, start, items, claude = fileText('CLAUDE.md')) {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: [
    { path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
    { path: `${OLD}/CLAUDE.md`, content: claude, type: 'Project' }] } })];
  const tool = (name, input, content, toolUseResult) => {
    const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
    records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test',
      content: [{ type: 'tool_use', id: toolId, name, input }], usage } }));
    records.push(rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content }] }, toolUseResult }));
  };
  for (const item of items) {
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    if (item.read != null) {
      const lines = item.text.split('\n').length;
      tool('Read', { file_path: item.read }, item.text, { type: 'text', file: { filePath: item.read, content: item.text, numLines: lines, startLine: 1, totalLines: lines } });
    }
    if (item.write != null) {
      tool('Write', { file_path: item.write, content: item.text }, `File created successfully at: ${item.write}`, { type: 'create', filePath: item.write, content: item.text });
    }
  }
  writeFileSync(path.join(sessionDir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}
const abs = rel => `${OLD}/${rel}`;
const CITY = 'second-iteration/decisions/city.md';
const SYNC = 'pipeline/steps/info/8_sync_frontend.md';

// T1: the session saves the fact in a memory file after the correction (S1). The text of the Write call is not the text of today (S22).
// It also writes 2 files that are not on disk now (S16) and a code file (not a need path).
writeSession(T1, '2026-11-20T10:00:00.000Z', [
  { user: 'Change the city decision to the top 5 groups.' },
  { read: abs(CITY), text: fileText(CITY) },
  { agent: 'I changed the city decision. agent-marker-a1' },
  { user: 'No. Show me each change of a decision file first. Write it only after I say yes.' },
  { write: memAbs('decision-edits-ask-first.md'), text: 'session-write-marker-w1 An older draft of the memory text.' },
  { write: memAbs('gone-note.md'), text: 'gone-marker-g1 This memory file is not on disk now.' },
  { write: abs('second-iteration/decisions/gone-draft.md'), text: 'gone-marker-g2 This draft is not on disk now.' },
  { write: abs('pipeline/cli.py'), text: 'code-marker-c1 = 1' },
  { agent: 'Saved to memory.' },
  { user: 'Good. Now make the legend bigger. user-marker-u3' },
  { agent: 'Done.' }
]);
// T2: 4 facts that are in a file of today that the session did not write: a memory file that the index links, the start
// file CLAUDE.md (the session had an older text of it), a context file 5 steps from the start, a memory file with no link (S3, S6).
writeSession(T2, '2026-11-19T10:00:00.000Z', [
  { user: 'Build the area page.' }, { agent: 'I use red and green for the legend.' },
  { user: 'Use the Okabe-Ito colours for the legend.' }, { agent: 'Ok. I add a test.' },
  { user: 'Do not write tests here.' }, { agent: 'Ok. Madrid gets one zone.' },
  { user: 'A city of 400,000 people or more needs two zones.' }, { agent: 'Ok. I export to the root folder.' },
  { user: 'Put the parquet exports in exports/ with the date.' }, { agent: 'Done.' }
], OLD_CLAUDE);
// T3: 12 corrections for the bad answers (S2, S17, S18). Their words are in no file, so they have no word match.
const T3_WORDS = ['klimp dravon vextil', 'ombrat feshil yuntar', 'pradlo wenshi kurvat', 'zelfin hadrox mipsel', 'torvik benshal ruxom', 'larquen dosvit phambo',
  'winsor jeltak vupren', 'gostrel naxim yorbet', 'fenwar tiblox quesma', 'hulmer zadrik opsen', 'crevat sumbil doxen', 'yaltro pemvik gusdan'];
writeSession(T3, '2026-11-18T10:00:00.000Z', [{ user: 'Sort the klimp list.' }, { agent: 'Sorted.' },
  ...T3_WORDS.flatMap(words => [{ user: `No: ${words}.` }, { agent: 'Ok.' }])]);
// T4: 3 corrections for the word match (S15, S21, S23, S25, S26).
writeSession(T4, '2026-11-17T10:00:00.000Z', [{ user: 'Check the quorblix notes.' }, { agent: 'Checked.' },
  { user: 'Quorblix zantic vembrel tarnoq plish.' }, { agent: 'Ok.' },
  { user: 'Glimfar dustwel krellin.' }, { agent: 'Ok.' },
  { user: 'Brimwok sarnel tuvlin.' }, { agent: 'Ok.' }]);
// T5: the limit (S4, S19, S24). The session writes 4 memory files after the correction. 5 more files match the words.
writeSession(T5, '2026-11-16T10:00:00.000Z', [{ user: 'Write the brantholt notes.' }, { agent: 'Written.' },
  { user: 'No: brantholt sevrik.' },
  ...[1, 2, 3, 4].map(n => ({ write: memAbs(`limit-written-${n}.md`), text: `session text of written file ${n}` })),
  { agent: 'Saved.' }]);
// T6: the agent had 19 texts of 12,000 characters before the correction, so the rest of the input leaves about 10,000 characters (S13).
const FILLER_READS = Array.from({ length: 19 }, (_, index) => `notes/filler-${String(index + 1).padStart(2, '0')}.md`);
writeSession(T6, '2026-11-15T10:00:00.000Z', [{ user: 'Read the filler notes.' },
  ...FILLER_READS.map((rel, index) => ({ read: abs(rel), text: filler(`Filler note ${index + 1}.`, 12000) })),
  { agent: 'Read.' }, { user: 'No: sevrik brantholt again.' }, { agent: 'Ok.' }]);

// A second settings home for S8: the same content, but the memory file of T1 has a new text without the saved sentence.
const settingsB = path.join(work, 'claude-settings-home-b');
cpSync(settings, settingsB, { recursive: true });
writeFileSync(path.join(settingsB, 'projects', FOLDER, 'memory', 'decision-edits-ask-first.md'), 'The user changed the mind: the agent can write a decision file at once.\n');

// ---------- the fake binary, with the memory folder of this run in its answers ----------

const fakeRoot = path.join(work, 'fake');
const fake = path.join(fakeRoot, 'test', 'fake-claude.mjs');
mkdirSync(path.dirname(fake), { recursive: true });
copyFileSync(path.join(repo, 'test', 'fake-claude.mjs'), fake);
chmodSync(fake, 0o755);
mkdirSync(path.join(fakeRoot, 'fixtures', 'fake-claude'), { recursive: true });
for (const name of readdirSync(path.join(repo, 'fixtures', 'fake-claude'))) {
  writeFileSync(path.join(fakeRoot, 'fixtures', 'fake-claude', name),
    readFileSync(path.join(repo, 'fixtures', 'fake-claude', name), 'utf8').replaceAll('MEMORY_DIR', MEMORY));
}

// ---------- the runs ----------

// All files of a folder with the hash of their content, without the git data.
function snapshot(dir) {
  const lines = [];
  const walk = sub => {
    for (const entry of readdirSync(path.join(dir, sub), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === '.git') continue;
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else lines.push(`${rel} ${createHash('sha256').update(readFileSync(path.join(dir, rel))).digest('hex')}`);
    }
  };
  walk('');
  return lines.join('\n');
}
const before = { project: snapshot(project), settings: snapshot(settings), settingsB: snapshot(settingsB),
  status: git('status', '--porcelain', '--untracked-files=all', '--ignored') };

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const head = call => call.stdin.split('\n', 1)[0];
const sessionOf = call => head(call).split(' ').at(-1);
const allCalls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const checkCalls = list => list.filter(call => head(call).startsWith('context-health needs-check '));
const cacheA = path.join(work, 'cache-a');

function run({ out, cache = cacheA, home = settings, intents = true, env = {} }) {
  const from = allCalls().length;
  const args = [cli, project, '--claude-settings-home', home, '--old-path', OLD, '--out', out, '--cache', cache, '--no-open', '--no-save'];
  if (intents) args.push('--intents');
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log, ...env } });
  const json = existsSync(path.join(out, 'report.json')) ? readFileSync(path.join(out, 'report.json'), 'utf8') : null;
  const html = existsSync(path.join(out, 'report.html')) ? readFileSync(path.join(out, 'report.html'), 'utf8') : null;
  const calls = allCalls().slice(from);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json, html, report: json && JSON.parse(json), calls, checks: checkCalls(calls) };
}

// R1 and R2: --intents two times with the same cache.
const r1 = run({ out: path.join(work, 'run-1') });
const artifact = path.join(repo, 'out', 'e2e-step-10-c');
mkdirSync(artifact, { recursive: true });
const r2 = run({ out: artifact });
// R3: no --intents, a cache with the intents only.
const cacheC = path.join(work, 'cache-c');
cpSync(path.join(cacheA, 'intents'), path.join(cacheC, 'intents'), { recursive: true });
const r3 = run({ out: path.join(work, 'run-3'), cache: cacheC, intents: false });
// R4 and R5: the memory file of T1 has a new text. First no --intents, then --intents, both with the cache of R1.
const r4 = run({ out: path.join(work, 'run-4'), home: settingsB, intents: false });
const r5 = run({ out: path.join(work, 'run-5'), home: settingsB });
// R6: a new cache, another time zone and another language of the machine.
const r6 = run({ out: path.join(work, 'run-6'), cache: path.join(work, 'cache-b'), env: { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' } });
const after = { project: snapshot(project), settings: snapshot(settings), settingsB: snapshot(settingsB),
  status: git('status', '--porcelain', '--untracked-files=all', '--ignored') };

// ---------- helpers for the checks ----------

const entryOf = (report, sessionId) => report.needs.sessions.find(entry => entry.sessionId === sessionId);
const toldOf = (report, sessionId) => entryOf(report, sessionId).intents.flatMap(intent => intent.needs).filter(need => need.kind !== 'file');
const stdinOf = (result, sessionId) => result.checks.find(call => sessionOf(call) === sessionId)?.stdin;
// The parts of a check input: the v1 part, and the "Files now" part with one block for each file.
function partsOf(stdin) {
  const at = stdin.indexOf('\n\nFiles now: ');
  const part = stdin.slice(at + 2, -1);
  const blocks = part.split('\n\n## File now ').slice(1).map(block => ({ path: block.slice(0, block.indexOf('\n')), body: block.slice(block.indexOf('\n') + 1) }));
  return { base: stdin.slice(0, at), part, count: part.split('\n', 1)[0], blocks, paths: blocks.map(block => block.path) };
}
const input = Object.fromEntries([T1, T2, T3, T4, T5, T6, B].map(sessionId => [sessionId, partsOf(stdinOf(r1, sessionId))]));
// The text of today of a report path, and its cut as the contract gives it.
const diskText = rel => readFileSync(rel.startsWith('~/.claude/') ? path.join(settings, rel.slice('~/.claude/'.length)) : path.join(project, rel), 'utf8');
const cut = text => (text.length <= 12000 ? text : `${text.slice(0, 10000)}\n[cut: ${(text.length - 12000).toLocaleString('en-US')} characters]\n${text.slice(-2000)}`);
const sameLine = rel => `[the same text as under "## File ${rel}"]`;
const START_NOW = [mem('MEMORY.md'), '~/.claude/CLAUDE.md', 'CLAUDE.md'];
// Step 12: `factKind` is the last key of a missing need. A had need does not have it.
const HAD_KEYS = ['id', 'kind', 'path', 'correctionId', 'message', 'text', 'quote', 'checkResult', 'sourceQuote', 'savedPath', 'savedQuote'];
const NEED_KEYS = [...HAD_KEYS, 'factKind'];

// ---------- the checks ----------

test('G4: the prompt version, the call and the keys of a need', () => {
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r1.report.needs.promptVersion, 'needs-check-v3');
  // Step 11: the new key `dropped` is at the end of `needs`. No read of this test is a dropped read.
  // Step 12: the new key `taskFacts` is at the end. The fake answers of this test have no `kind`, so no fact is a task fact.
  assert.deepEqual(Object.keys(r1.report.needs), ['promptVersion', 'sessions', 'dropped', 'taskFacts']);
  assert.deepEqual(r1.report.needs.taskFacts, { count: 0, list: [] });
  assert.deepEqual(r1.report.needs.dropped, { needs: 0, reads: 0, files: 0, byReason: {}, list: [] });
  const prompt = readFileSync(path.join(repo, 'src', 'prompts', 'needs-check-v3.md'), 'utf8');
  assert.deepEqual(r1.checks.map(sessionOf).sort(), [T1, T2, T3, T4, T5, T6, B].sort(), 'one call for each session with a missing-context correction');
  for (const call of r1.checks) {
    assert.match(head(call), /^context-health needs-check needs-check-v3 session [0-9a-f-]{36}$/);
    assert.equal(call.argv.at(-1), prompt);
  }
  let seen = 0;
  for (const entry of r1.report.needs.sessions) {
    assert.deepEqual(Object.keys(entry), ['sessionId', 'check', 'intents']);
    assert.deepEqual(Object.keys(entry.check), ['status', 'reason', 'costUsd']);
    for (const need of entry.intents.flatMap(intent => intent.needs)) {
      if (need.kind === 'file') { assert.ok(!('savedPath' in need) && !('savedQuote' in need)); continue; }
      seen += 1;
      assert.deepEqual(Object.keys(need), need.kind === 'missing' ? NEED_KEYS : HAD_KEYS, `${entry.sessionId} ${need.id}`);
      assert.ok(['missing', 'had'].includes(need.kind));
      assert.equal(need.savedPath == null, need.savedQuote == null);
    }
  }
  assert.equal(seen, 1 + 4 + 12 + 3 + 1 + 1 + 1);
  assert.ok(!/[\u2013\u2014]/.test(prompt), 'no en dash and no em dash in the prompt');
});

test('S1, S3, S16, S22: a fact that the same session saved in a memory file has savedPath and savedQuote', () => {
  assert.deepEqual(entryOf(r1.report, T1).check, { status: 'ok', reason: null, costUsd: 0.011 });
  assert.deepEqual(toldOf(r1.report, T1), [{ id: 'n2', kind: 'missing', path: null, correctionId: 'c1', message: 2,
    text: 'Show each change of a decision file to the user first, and write it only after the user says yes', quote: 'Show me each change of a decision file first',
    checkResult: 'not-found', sourceQuote: null,
    savedPath: mem('decision-edits-ask-first.md'), savedQuote: 'Write the file only after the user says yes.', factKind: null }]);
  const { blocks, paths } = input[T1];
  // The file that the session wrote after the correction is the first file of today. Then the memory index and the start files.
  assert.deepEqual(paths.slice(0, 4), [mem('decision-edits-ask-first.md'), ...START_NOW]);
  assert.equal(blocks[0].body, memoryFiles['decision-edits-ask-first.md'], 'the text on disk, not the text of the Write call');
  // S16: the 2 written files that are not on disk now are left out. A code file is not a need path.
  for (const rel of [mem('gone-note.md'), 'second-iteration/decisions/gone-draft.md', 'pipeline/cli.py']) assert.ok(!paths.includes(rel), rel);
  assert.equal(entryOf(r1.report, T1).intents[0].needs[0].path, CITY);
});

test('S5, S14, S22: the input holds the fact, the words of the user and file texts only, and no text two times', () => {
  const stdin = stdinOf(r1, T1);
  for (const marker of ['session-write-marker-w1', 'gone-marker-g1', 'gone-marker-g2', 'code-marker-c1', 'agent-marker-a1', 'user-marker-u3', 'Saved to memory', 'top 5 groups']) {
    assert.ok(!stdin.includes(marker), marker);
  }
  // The v1 part, byte for byte: the session line, the correction, and the 3 texts that the agent had before message 2.
  assert.equal(input[T1].base, [`context-health needs-check needs-check-v3 session ${T1}`, 'Corrections: 1',
    ['## Correction c1 (message 2)', 'Fact: Show each change of a decision file to the user first, and write it only after the user says yes',
      'User words: Show me each change of a decision file first', `Files the agent had: ~/.claude/CLAUDE.md, CLAUDE.md, ${CITY}`].join('\n'),
    `## File ~/.claude/CLAUDE.md\n${userClaude}`, `## File CLAUDE.md\n${fileText('CLAUDE.md')}`, `## File ${CITY}\n${fileText(CITY)}`].join('\n\n'));
  // The "Files now" part of each call: each block is the text on disk of today (cut as in v1), or the line that points to
  // the same text in the v1 part. So no session text is in it.
  for (const [sessionId, parts] of Object.entries(input)) {
    assert.equal(parts.count, `Files now: ${parts.blocks.length}`, NAMES[sessionId]);
    assert.equal(new Set(parts.paths).size, parts.paths.length, `${NAMES[sessionId]}: no file two times`);
    assert.ok(parts.part.length <= FILES_NOW_LIMIT, `${NAMES[sessionId]}: ${parts.part.length}`);
    for (const block of parts.blocks) {
      const text = diskText(block.path);
      if (block.body === sameLine(block.path)) {
        assert.ok(parts.base.includes(`## File ${block.path}\n${cut(text)}`), `${NAMES[sessionId]} ${block.path}: the v1 part has the text of today`);
      } else {
        assert.equal(block.body, cut(text), `${NAMES[sessionId]} ${block.path}`);
        assert.ok(!parts.base.includes(`## File ${block.path}\n${cut(text)}`), `${NAMES[sessionId]} ${block.path}: the text is not in the v1 part too`);
      }
    }
  }
  // T1 had the 2 start files and city.md with the text of today: one line each. T2 had an older CLAUDE.md: its text of today goes in.
  for (const rel of ['~/.claude/CLAUDE.md', 'CLAUDE.md']) assert.equal(input[T1].blocks.find(block => block.path === rel).body, sameLine(rel));
  const city = input[T1].blocks.find(block => block.path === CITY);
  if (city) assert.equal(city.body, sameLine(CITY));
  assert.equal(input[T2].blocks.find(block => block.path === 'CLAUDE.md').body, fileText('CLAUDE.md'));
  assert.ok(input[T2].base.includes(`## File CLAUDE.md\n${OLD_CLAUDE}`));
});

test('S3, S6: a fact in a memory file, in a start file, in a far context file and in a memory file with no link', () => {
  const { paths } = input[T2];
  assert.deepEqual(paths.slice(0, 3), START_NOW, 'T2 wrote no file: the memory index and the start files come first');
  // The word matches by rank: the best match of c1, of c2, of c3 and of c4 come first. The best match of c2 is not
  // CLAUDE.md, because a start file is in the list before the word matches.
  assert.deepEqual([paths[3], paths[5], paths[6]], [mem('legend-colours.md'), SYNC, mem('export-folder-note.md')]);
  assert.ok(!START_NOW.includes(paths[4]));
  assert.ok(paths.length <= 3 + 4 * 5, 'at most 5 word matches for each correction');
  assert.ok(!memoryFiles['MEMORY.md'].includes('export-folder-note'), 'the index does not link the export note');
  assert.deepEqual(toldOf(r1.report, T2).map(need => [need.correctionId, need.kind, need.checkResult, need.savedPath, need.savedQuote]), [
    ['c1', 'missing', 'not-found', mem('legend-colours.md'), 'The map legend uses the Okabe-Ito colours.'],
    ['c2', 'missing', 'not-found', 'CLAUDE.md', 'Do not write, run, or keep tests.'],
    // The sentence is on 2 lines in the file. The check does not look at line ends.
    ['c3', 'missing', 'not-found', SYNC, 'A city with population of 400,000 or more needs two valid zones.'],
    ['c4', 'missing', 'not-found', mem('export-folder-note.md'), 'Each parquet export goes to the folder exports/, with the date at the start.']
  ]);
  assert.ok(!fileText(SYNC).includes('A city with population of 400,000'), 'the quote has a line end in the file');
  // S6, S7 (the data that the health step needs): each saved path is a path of the map, so the route of the file is known.
  // The need data does not judge the route: a fact in a memory file with no link still has savedPath, and the map says "none".
  const reachOf = rel => { const file = r1.report.map.files.find(item => item.path === rel); return file && [file.reach, file.steps]; };
  assert.deepEqual(reachOf(mem('decision-edits-ask-first.md')), ['path', 1]);
  assert.deepEqual(reachOf(mem('legend-colours.md')), ['path', 1]);
  assert.deepEqual(reachOf('CLAUDE.md'), ['start', 0]);
  assert.deepEqual(reachOf(mem('export-folder-note.md')), ['none', null]);
  assert.ok(reachOf(SYNC)[0] === 'path' && reachOf(SYNC)[1] > 1, 'a far file');
});

test('S2, S17, S18, S10: a bad `now` is not saved, the rest of the answer counts, and a had need has no saved place', () => {
  assert.deepEqual(entryOf(r1.report, T3).check, { status: 'ok', reason: null, costUsd: 0.013 });
  assert.deepEqual(input[T3].paths, START_NOW, 'the words of T3 are in no file: no word match');
  const good = 'Prove work with a real run on the data.';
  assert.deepEqual(toldOf(r1.report, T3).map(need => [need.correctionId, need.kind, need.checkResult, need.path, need.sourceQuote, need.savedPath, need.savedQuote]), [
    ['c1', 'missing', 'not-found', null, null, null, null], // S2: a path that is not in the input
    ['c2', 'missing', 'not-found', null, null, null, null], // S2: a quote that is not in the file
    ['c3', 'had', 'had', 'CLAUDE.md', 'Do not write, run, or keep tests.', null, null], // S10, S17: the agent had it, so a good `now` is not kept
    ['c4', 'missing', 'bad-quote', null, null, 'CLAUDE.md', good], // S17: a bad `found` quote and a good `now`
    ['c5', 'missing', 'not-found', null, null, null, null], // S18: a string
    ['c6', 'missing', 'not-found', null, null, null, null], // S18: a list
    ['c7', 'missing', 'not-found', null, null, null, null], // S18: a quote of 5 characters
    ['c8', 'missing', 'not-found', null, null, null, null], // S18: no quote
    ['c9', 'missing', 'not-found', null, null, null, null], // S9: no `now` key
    ['c10', 'missing', 'not-found', null, null, null, null], // `now` is null
    ['c11', 'missing', 'not-found', null, null, null, null], // S18: numbers
    ['c12', 'missing', 'not-found', null, null, '~/.claude/CLAUDE.md', 'Do not delete files. Move them to the Trash.'] // a start file in the settings home, sent as one line
  ]);
  assert.equal(input[T3].blocks.find(block => block.path === '~/.claude/CLAUDE.md').body, sameLine('~/.claude/CLAUDE.md'));
  const intent = entryOf(r1.report, T3).intents[0];
  assert.deepEqual(intent.totals, { fileNeeds: 0, missing: 11, had: 1 });
  assert.equal(r1.checks.filter(call => sessionOf(call) === T3).length, 1, 'a bad `now` does not make a second try');
});

test('S9: an answer in the old shape gives no saved fact', () => {
  for (const sessionId of [B, T6]) {
    assert.equal(entryOf(r1.report, sessionId).check.status, 'ok', NAMES[sessionId]);
    assert.deepEqual(toldOf(r1.report, sessionId).map(need => [need.kind, need.checkResult, need.savedPath, need.savedQuote]), [['missing', 'not-found', null, null]]);
  }
  assert.deepEqual(input[B].paths.slice(0, 3), START_NOW);
});

test('S15, S21, S23, S25, S26: the word match', () => {
  // The best match of each correction, then the second of each, then the others of c1 (c2 and c3 have 2 matches each).
  assert.deepEqual(input[T4].paths, [...START_NOW,
    mem('wm-quorblix-1.md'), mem('wm-glimfar-short.md'), mem('wm-brimwok-full.md'),
    mem('wm-quorblix-2.md'), mem('wm-glimfar-long.md'), mem('wm-brimwok-stub.md'),
    mem('wm-quorblix-3.md'), mem('wm-quorblix-4.md'), mem('wm-quorblix-5.md')]);
  // S23: 1 shared word is not a match. Files 4, 5 and 6 are equal: plain path order, and only 5 matches for one correction.
  for (const name of ['wm-quorblix-one-word.md', 'wm-quorblix-6.md']) assert.ok(!input[T4].paths.includes(mem(name)), name);
  // S25: the long file shares all 3 words of c2 and the short file only 2 of them, and the short file comes first.
  assert.ok(memoryFiles['wm-glimfar-long.md'].startsWith('Glimfar dustwel krellin.') && !memoryFiles['wm-glimfar-short.md'].includes('krellin'));
  // S26: the stub shares 2 words of c3 and the full file 3. The full file comes first, so a file does not win because it is a stub.
  assert.ok(memoryFiles['wm-brimwok-full.md'].includes('tuvlin') && !memoryFiles['wm-brimwok-stub.md'].includes('tuvlin'));
  // S15: a run with a new cache, another time zone and another language gives the same input for each check, byte for byte.
  assert.equal(r6.status, 0, r6.stderr);
  assert.deepEqual(r6.checks.map(sessionOf).sort(), r1.checks.map(sessionOf).sort());
  for (const call of r1.checks) assert.equal(stdinOf(r6, sessionOf(call)), call.stdin, NAMES[sessionOf(call)]);
  assert.deepEqual(r6.report.needs, r1.report.needs);
});

test('S4, S19, S24: the "Files now" part stays below its limit', () => {
  const { paths, part, blocks } = input[T5];
  // The written files come first, in the order of the writes when their match is equal. File 4 shares no word, so it is the
  // last of them. File 3 does not fit in the half of the room that the written files get: it waits, and goes in at the end.
  // Then the memory index and the start files. Then the word matches in path order: file 3 does not fit and is left out,
  // and the smaller files 4 and 5 after it go in.
  assert.deepEqual(paths, [mem('limit-written-1.md'), mem('limit-written-2.md'), mem('limit-written-4.md'), ...START_NOW,
    mem('limit-match-1.md'), mem('limit-match-2.md'), mem('limit-match-4.md'), mem('limit-match-5.md'), mem('limit-written-3.md')]);
  assert.ok(part.length <= FILES_NOW_LIMIT, String(part.length));
  const blockOf = name => blocks.find(block => block.path === mem(name));
  const sizeOf = names => names.reduce((sum, name) => sum + `## File now ${mem(name)}\n${cut(memoryFiles[name])}`.length + 2, 0);
  assert.ok(sizeOf(['limit-written-1.md', 'limit-written-2.md', 'limit-written-3.md']) > FILES_NOW_LIMIT / 2, 'the 3 long written files do not fit in half of the room');
  assert.ok(part.length + sizeOf(['limit-match-3.md']) > FILES_NOW_LIMIT, 'the match file 3 does not fit');
  // Long files are cut: the head and the tail are in, the middle is not.
  const long = blockOf('limit-written-1.md').body;
  assert.equal(long, cut(memoryFiles['limit-written-1.md']));
  assert.ok(long.includes('head-marker-h1') && long.includes('tail-marker-t1') && long.includes('\n[cut: 1,000 characters]\n') && !long.includes('middle-marker-m1'));
  assert.equal(blockOf('limit-match-2.md').body, memoryFiles['limit-match-2.md'], 'a file of 11,900 characters is not cut');
  assert.ok(!stdinOf(r1, T5).includes('session text of written file'));
  // S19: the fake answer names the match file 3 with a real quote of it. The file was not in the input, so the fact is not saved.
  assert.ok(memoryFiles['limit-match-3.md'].includes('Brantholt sevrik, match file 3.'));
  assert.deepEqual(toldOf(r1.report, T5).map(need => [need.checkResult, need.savedPath, need.savedQuote]), [['not-found', null, null]]);
  assert.equal(entryOf(r1.report, T5).check.status, 'ok');
});

test('S13: the "Files now" part gets only the room that the rest of the input leaves', () => {
  const stdin = stdinOf(r1, T6);
  const { base, part, paths } = input[T6];
  assert.ok(base.length > 228000 && stdin.length <= INPUT_LIMIT, `${base.length} ${stdin.length}`);
  assert.ok(part.length <= INPUT_LIMIT - base.length - 3 && part.length < 12000, String(part.length));
  // The 3 long match files fit in 60,000 characters, but not in the room that is left. The 2 small files go in.
  assert.deepEqual(paths, [...START_NOW, mem('limit-match-4.md'), mem('limit-match-5.md')]);
  assert.deepEqual(entryOf(r1.report, T6).check, { status: 'ok', reason: null, costUsd: 0.03 });
  assert.equal(entryOf(r1.report, T6).intents[0].needs.filter(need => need.kind === 'file').length, 19);
});

test('S8, G1: the cache, a changed memory file, and no --intents', () => {
  // Run 2: no check call, no intents call, and the same report.
  assert.equal(r2.status, 0, r2.stderr);
  assert.deepEqual(r2.checks, []);
  assert.ok(!r2.calls.some(call => head(call).startsWith('context-health intents ')));
  assert.equal(r2.json, r1.json);
  assert.equal(r2.html, r1.html);
  const cached = name => readdirSync(path.join(cacheA, 'needs')).filter(file => file.startsWith(name)).length;
  // Run 3: no --intents and no cached check. No call, each check is not analysed, and no fact is saved.
  assert.equal(r3.status, 0, r3.stderr);
  assert.deepEqual(r3.calls, []);
  for (const sessionId of [T1, T2, T3, T4, T5, T6, B]) {
    assert.deepEqual(entryOf(r3.report, sessionId).check, { status: 'not-analysed', reason: 'not analysed: run with --intents', costUsd: null }, NAMES[sessionId]);
    for (const need of toldOf(r3.report, sessionId)) {
      assert.deepEqual([need.kind, need.checkResult, need.path, need.sourceQuote, need.savedPath, need.savedQuote], ['missing', 'not-checked', null, null, null, null]);
      assert.deepEqual(Object.keys(need), NEED_KEYS);
    }
  }
  assert.match(r3.stdout, /needs: 7 sessions have a missing-context check that is not analysed/);
  // Run 4: the memory file of T1 has a new text. Only the input of T1 holds that file, so only T1 has a new cache key:
  // without --intents its old answer is not used. The other checks come from the cache.
  const holders = r1.checks.filter(call => call.stdin.includes(`## File now ${mem('decision-edits-ask-first.md')}\n`)).map(sessionOf);
  assert.deepEqual(holders, [T1]);
  assert.equal(r4.status, 0, r4.stderr);
  assert.deepEqual(r4.calls, []);
  assert.equal(entryOf(r4.report, T1).check.status, 'not-analysed');
  assert.deepEqual(toldOf(r4.report, T1).map(need => [need.checkResult, need.savedPath]), [['not-checked', null]]);
  for (const sessionId of [T2, T3, T4, T5, T6, B]) assert.deepEqual(entryOf(r4.report, sessionId), entryOf(r1.report, sessionId), NAMES[sessionId]);
  // Run 5: with --intents, one new call for T1. The answer still gives the old sentence, and the file does not have it now.
  assert.equal(r5.status, 0, r5.stderr);
  assert.deepEqual(r5.checks.map(sessionOf), [T1]);
  assert.ok(r5.checks[0].stdin.includes('The user changed the mind') && !r5.checks[0].stdin.includes('Write the file only after the user says yes.'));
  assert.equal(entryOf(r5.report, T1).check.status, 'ok');
  assert.deepEqual(toldOf(r5.report, T1).map(need => [need.checkResult, need.savedPath, need.savedQuote]), [['not-found', null, null]]);
  assert.equal(cached(T1), 2, 'one cache file for each text of the memory file');
  for (const sessionId of [T2, T3, T4, T5, T6, B]) assert.equal(cached(sessionId), 1, NAMES[sessionId]);
});

test('G2: the project and the settings home do not change', () => {
  assert.equal(after.status, before.status);
  assert.equal(after.project, before.project);
  assert.equal(after.settings, before.settings);
  assert.equal(after.settingsB, before.settingsB);
  // The artifact: the "Files now" list of each check, with a fixed name in the place of the memory folder of this run.
  const lines = ['# Step 10 C: the files of today in each check input', '', 'Made by test/e2e-step-10-c.test.mjs. `<memory>` is the memory folder of the test project.', ''];
  for (const sessionId of [T1, T2, T3, T4, T5, T6, B]) {
    const told = toldOf(r1.report, sessionId);
    lines.push(`## ${NAMES[sessionId]} (${sessionId.slice(0, 8)}): ${told.length} corrections, ${told.filter(need => need.savedPath).length} saved`, '');
    for (const need of told) lines.push(`- ${need.correctionId}: ${need.kind}, ${need.checkResult}, saved in ${need.savedPath ? need.savedPath.replace(MEMORY, '<memory>') : 'no file'}`);
    lines.push('', 'Files now:', '');
    for (const block of input[sessionId].blocks) lines.push(`- ${block.path.replace(MEMORY, '<memory>')}${block.body === sameLine(block.path) ? ' (the same text as the agent had)' : ''}`);
    lines.push('');
  }
  writeFileSync(path.join(artifact, 'files-now.md'), `${lines.join('\n')}\n`);
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
  console.log(`Artifact: ${path.join(artifact, 'files-now.md')}`);
});
