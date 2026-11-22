// E2E for step 10, part D (the health score, the improvement prompt and the page): run the real command on git copies
// of fixtures/indoeuromap, each with its own settings home and the sessions that this file writes, and a copy of the
// fake claude binary. No real model call.
// The ways it can fail are in the step 10 failure list (R, C, F, T, the health side of S, L3, G) and in the list
// of worker D (D1 to D15). Each test names its cases. The expected numbers are worked out by hand in the comments.
//
// The memory folder of a project has the project root in its name, and the root of this test is a new temporary folder
// on each run. So the fake answers of this file hold the word MEMORY_DIR in the place of the memory folder. This file
// copies test/fake-claude.mjs and fixtures/fake-claude/ into the temporary folder and puts the real folder in.
// Artifact: out/e2e-step-10-d/report.json and report.html (the main run), health-cases.md (each run in one table), and
// 2 more pages for the browser check of T7: thin-data.html (both data lines) and root-item.html (the root item).
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
const fixture = path.join(repo, 'fixtures', 'indoeuromap');
const repoSettings = path.join(repo, 'fixtures', 'claude-settings-home');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-indoeuromap';
const ID = n => `8900000${n}-0000-0000-0000-000000000000`;
// The data/research files are git-ignored, also in this repo, so a git copy of the repo can miss them. Each project copy gets them.
const RESEARCH_FILES = ['europe-expansion-2026-10-20', 'growth-metrics-2026-10-21', 'wave-1-finish-2026-10-20'].map(name => `data/research/${name}/README.md`);
const COMMANDS = ['.claude/commands/brief.md', '.claude/commands/frontend-design-system.md'];
const CITY = 'second-iteration/decisions/city.md';
const INDEX = 'second-iteration/decisions/index.md';
const METHOD = 'pipeline/METHOD.md';
const TIKTOK = 'first-iteration/docs/tiktok-first-post-2026-09-27.md';
const CALLS = 'work/model-calls';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const append = (file, text) => writeFileSync(file, `${readFileSync(file, 'utf8')}${text}`);
const lineOf = (file, part) => readFileSync(file, 'utf8').split('\n').findIndex(line => line.includes(part)) + 1;
const fixtureText = rel => readFileSync(path.join(fixture, rel), 'utf8');

// A hash of each file of a folder (not the git data), to prove that a run changes nothing.
function snapshot(dir) {
  const hash = createHash('sha256');
  const walk = rel => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      if (entry.name === '.git') continue;
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else hash.update(child).update(readFileSync(path.join(dir, child)));
    }
  };
  walk('');
  return hash.digest('hex');
}

// ---------- the projects ----------

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step10d-'));
// A git copy of the fixture. `leave` names the files that the copy does not get. `change` edits the copy before git sees it.
function makeProject(name, { leave = [], change = () => {} } = {}) {
  const dir = path.join(work, name, 'indoeuromap');
  cpSync(fixture, dir, { recursive: true, filter: source => !leave.includes(path.relative(fixture, source)) });
  for (const rel of RESEARCH_FILES) if (!existsSync(path.join(dir, rel))) write(path.join(dir, rel), `# ${rel.split('/')[2]}\n\nLocal research record.\n`);
  change(dir);
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  return dir;
}
const ORPHAN = 'notes/orphan.md';
const orphan = dir => write(path.join(dir, ORPHAN), '# Orphan\n\nNo file links to this note.\n');

// M: the main project. It has a CLAUDE.md. The texts of the new files are invented.
// - work/ is git-ignored. work/model-calls/index.md links changes.md and bench.md, and no file links the index (F4, F7).
// - notes/now.md (CLAUDE.md links it) and guides/deploy.md (CLAUDE.md links only its folder) name work/model-calls as
//   plain text (F10, D2). notes/now.md also names work/extra, the folder of 2 files with no link (D1).
// - notes/chain: a.md links b.md, b.md links c.md, no file links a.md (F5). notes/cycle: x.md and y.md link each other (F6).
// - notes/orphan.md: no file links it (F3). second-iteration/plan.md names the folder notes/ as plain text, but it is
//   2 steps from the start: too far to be the place for the link (D16).
const M = makeProject('main', { change: dir => {
  append(path.join(dir, '.gitignore'), '\n# Local notes, not in git\nwork/\n');
  write(path.join(dir, CALLS, 'index.md'), '# Model calls\n\n- [changes](changes.md): what changed in each run\n- [bench](bench.md): the bench numbers\n');
  write(path.join(dir, CALLS, 'changes.md'), '# Changes\n\nRun 2 uses the smaller model.\n');
  write(path.join(dir, CALLS, 'bench.md'), '# Bench\n\nRun 2 takes 40 seconds.\n');
  write(path.join(dir, 'work/extra/p.md'), '# P\n\nA local note.\n');
  write(path.join(dir, 'work/extra/q.md'), '# Q\n\nA second local note.\n');
  append(path.join(dir, 'CLAUDE.md'), '\nThe open work is in [notes/now.md](notes/now.md).\nThe how-to guides are in [guides/](guides/).\n');
  write(path.join(dir, 'notes/now.md'), '# Now\n\n- The city page title is open.\n- Track the model calls in `work/model-calls/` (local, not in git).\n- More local notes are in work/extra (not in git).\n');
  write(path.join(dir, 'guides/deploy.md'), '# Deploy\n\nRun the build first. The model call notes are in work/model-calls (not in git).\n');
  write(path.join(dir, 'guides/release.md'), '# Release\n\nWrite the release note.\n');
  append(path.join(dir, 'second-iteration/plan.md'), '\nThe loose notes are in notes/ (no index).\n');
  write(path.join(dir, 'notes/chain/a.md'), '# A\n\nSee [b](b.md).\n');
  write(path.join(dir, 'notes/chain/b.md'), '# B\n\nSee [c](c.md).\n');
  write(path.join(dir, 'notes/chain/c.md'), '# C\n\nThe last note of the chain.\n');
  write(path.join(dir, 'notes/cycle/x.md'), '# X\n\nSee [y](y.md).\n');
  write(path.join(dir, 'notes/cycle/y.md'), '# Y\n\nSee [x](x.md).\n');
  orphan(dir);
} });
// N: no CLAUDE.md, so AGENTS.md is the start file (F8). No project commands: their bodies give most files a long route.
const N = makeProject('agents', { leave: ['CLAUDE.md', ...COMMANDS], change: orphan });
// BARE: no CLAUDE.md and no AGENTS.md (R1).
const BARE = makeProject('bare', { leave: ['CLAUDE.md', 'AGENTS.md', ...COMMANDS], change: orphan });
// BIG: one file that is larger than the input limit of the duplicate check (L3). Lines of 3 words are not sentences.
const BIG_FILE = 'notes/big-log.md';
const BIG = makeProject('big', { change: dir => {
  let text = '# Big log\n\n';
  for (let n = 1; text.length < 250000; n += 1) text += `log line ${String(n).padStart(6, '0')}\n`;
  write(path.join(dir, BIG_FILE), text);
} });
const projects = { M, N, BARE, BIG };

// ---------- the settings homes and their sessions ----------

const userClaude = readFileSync(path.join(repoSettings, 'CLAUDE.md'), 'utf8');
// A settings home with the fixture skills and commands, and no session of the fixture.
function makeHome(name, settingsJson = null) {
  const dir = path.join(work, 'homes', name);
  cpSync(repoSettings, dir, { recursive: true, filter: source => path.relative(repoSettings, source).split(path.sep)[0] !== 'projects' });
  mkdirSync(path.join(dir, 'projects', MAIN), { recursive: true });
  if (settingsJson) writeFileSync(path.join(dir, 'settings.json'), `${JSON.stringify(settingsJson, null, 2)}\n`);
  return dir;
}
// The start load of a session record: the user file, and the project instruction file when there is one.
const startOf = (project, rel, user = userClaude) => [{ path: `${HOME}/.claude/CLAUDE.md`, content: user, type: 'User' },
  ...(rel ? [{ path: `${OLD}/${rel}`, content: readFileSync(path.join(project, rel), 'utf8'), type: 'Project' }] : [])];
const abs = rel => `${OLD}/${rel}`;

// Items: { user }, { agent }, { read: full path, text }, { grep: pattern, files: [full paths] }, { write: full path, text }.
// `entrypoint: 'sdk-cli'` on each record makes a headless file. No item with `user` makes a file with no user message.
function writeSession(home, sessionId, start, startFiles, items, entrypoint = 'cli') {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint };
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
// A read of a project file with its text of today.
const readOf = (project, rel) => ({ read: abs(rel), text: readFileSync(path.join(project, rel), 'utf8') });
const day = n => `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`;

// ----- HM: the home of the main run. 5 sessions, and a memory folder for M. -----
const HM = makeHome('main');
const FOLDER = M.replace(/[^A-Za-z0-9]/g, '-');
const MEMORY = `~/.claude/projects/${FOLDER}/memory`; // the report form
const mem = name => `${MEMORY}/${name}`;
// The path of a memory file in a session record. The fake home is the home of an other machine: the tool maps it to ~/.claude/.
const memAbs = name => `${HOME}/.claude/projects/${FOLDER}/memory/${name}`;
const memoryFiles = {
  // The last line names work/model-calls as plain text (D3): a memory file is not the place for a link to a project file.
  'MEMORY.md': '# Memory index\n\n- [Saved rule](saved-rule.md): ask before a decision file changes\n- [Legend](legend.md): the colours of the legend\n- The model call notes are in work/model-calls.\n',
  'saved-rule.md': 'Ask the user before you change a decision file.\n',
  'legend.md': 'The legend uses blue and orange.\n',
  // No line of the index links this file (S6, D10).
  'loose-note.md': 'Each export goes to the folder exports/.\n'
};
for (const [name, text] of Object.entries(memoryFiles)) write(path.join(HM, 'projects', FOLDER, 'memory', name), text);
// F9: a file in ~/.claude/ that the map does not know.
// Step 11: a file of ~/.claude/ is a need only in a folder skills, commands, agents or rules, or in the memory of the
// project. So the notes file moved from ~/.claude/notes/ (now a dropped read, `user-other`) into the folder of a
// skill of a plugin. Claude Code does not list that skill here, so the map has no route to the file, as before.
const USER_NOTES = '~/.claude/plugins/demo/skills/review/user-notes.md';
write(path.join(HM, 'plugins', 'demo', 'skills', 'review', 'user-notes.md'), '# User notes\n\nA note that is not in the project.\n');
const mStart = startOf(M, 'CLAUDE.md');
// S1: the model call notes. Nothing names the index. The index names changes.md and bench.md. Nothing names the 2 extra notes.
writeSession(HM, ID(1), day(21), mStart, [
  { user: 'Check the model call notes.' },
  readOf(M, `${CALLS}/index.md`), readOf(M, `${CALLS}/changes.md`), readOf(M, `${CALLS}/bench.md`),
  readOf(M, 'work/extra/p.md'), readOf(M, 'work/extra/q.md'),
  { agent: 'Done.' }, { user: 'Thanks.' }
]);
// S2: the user gives the path of changes.md. Nothing names the last file of the chain and a file of the cycle.
writeSession(HM, ID(2), day(20), mStart, [
  { user: `Read ${CALLS}/changes.md, then the chain and the cycle notes.` },
  readOf(M, `${CALLS}/changes.md`), readOf(M, 'notes/chain/c.md'), readOf(M, 'notes/cycle/y.md'),
  { agent: 'Done.' }, { user: 'Thanks.' }
]);
// S3: city.md by a search (3 steps on the map, F2). guides/deploy.md with nothing that named it (CLAUDE.md links only
// its folder, F1). The orphan, a file in ~/.claude/ (F9), and the old orphan of the fixture (AGENTS.md names its top folder).
writeSession(HM, ID(3), day(19), mStart, [
  { user: 'Fix the title of the Berlin city page.' },
  { grep: 'Berlin', files: [abs(CITY)] },
  readOf(M, CITY), readOf(M, 'guides/deploy.md'), readOf(M, ORPHAN),
  { read: `${HOME}/.claude/plugins/demo/skills/review/user-notes.md`, text: '# User notes\n\nA note that is not in the project.\n' },
  { read: abs(TIKTOK), text: 'A short text of the post.\n' },
  { agent: 'Done.' }, { user: 'Thanks.' }
]);
// S4: AGENTS.md (CLAUDE.md names it), METHOD.md (AGENTS.md names it, 2 steps), a memory file that the index links
// (nothing in the record names it, D5), and a memory file with no link (D10).
writeSession(HM, ID(4), day(18), mStart, [
  { user: 'Check the method and the memory notes.' },
  readOf(M, 'AGENTS.md'), readOf(M, METHOD),
  { read: memAbs('legend.md'), text: memoryFiles['legend.md'] }, { read: memAbs('loose-note.md'), text: memoryFiles['loose-note.md'] },
  { agent: 'Done.' }, { user: 'Thanks.' }
]);
// S7: 5 facts that the user had to tell (the fake answers 89000007). The session had older texts of city.md and of the
// user file, so the agent did not have the facts. Today: c1 is in a memory file that the index links (S1, S7), c2 in a
// memory file with no link (S6), c3 in city.md, 3 steps away (D7), c4 in ~/.claude/CLAUDE.md, a start file that is not
// on the map (D6), c5 in no file.
writeSession(HM, ID(7), day(17), startOf(M, 'CLAUDE.md', '# Global instructions\n\n- Write short sentences.\n'), [
  { user: 'Change the city decision and export the data.' },
  { read: abs(CITY), text: '# City pages\n\nAn older text of the city decision.\n' },
  { agent: 'I changed the city decision.' },
  { user: 'Ask me before you change a decision file.' },
  { write: memAbs('saved-rule.md'), text: 'A draft of the rule.' },
  { agent: 'Saved. I exported the data to the root folder.' },
  { user: 'Put each export in exports/.' },
  { write: memAbs('loose-note.md'), text: 'A draft of the note.' },
  { agent: 'Saved. All cities get a sample summary.' },
  { user: 'Only five cities have a sample summary.' },
  { write: abs(CITY), text: 'A draft of the city decision.' },
  { agent: 'Changed. I deleted the old export.' },
  { user: 'Never delete a file, use the Trash.' },
  { agent: 'Ok. The release note is out.' },
  { user: 'I read each release note first.' },
  { agent: 'Ok.' }
]);

// ----- The thin data homes (T1 to T6). Each session reads files that have a route in M. -----
const T_FILES = ['AGENTS.md', METHOD, 'llms.txt', 'second-iteration/plan.md', 'README.md'];
// `reads[k]` = how many files session k + 1 reads. Each read is one need.
function thinHome(name, reads) {
  const home = makeHome(name);
  reads.forEach((count, k) => writeSession(home, ID(k + 1), day(21 - k), mStart, [
    { user: `Task ${k + 1}.` }, ...T_FILES.slice(0, count).map(rel => readOf(M, rel)), { agent: 'Done.' }, { user: 'Thanks.' }]));
  return home;
}
const HT20 = thinHome('thin-5-20', [4, 4, 4, 4, 4]);      // 5 sessions, 20 needs: not thin
const HT19 = thinHome('thin-5-19', [4, 4, 4, 4, 3]);      // 5 sessions, 19 needs: thin
const HT4 = thinHome('thin-4-20', [5, 5, 5, 5]);          // 4 sessions, 20 needs: thin
// T3: HT19 also has 2 headless files and 1 file with no user message.
writeSession(HT19, '89000091-0000-0000-0000-000000000000', day(10), mStart, [{ user: 'A headless run.' }, { agent: 'Done.' }], 'sdk-cli');
writeSession(HT19, '89000092-0000-0000-0000-000000000000', day(9), mStart, [{ user: 'A second headless run.' }, { agent: 'Done.' }], 'sdk-cli');
writeSession(HT19, '89000093-0000-0000-0000-000000000000', day(8), mStart, [{ agent: 'No user message here.' }]);

// ----- HN: AGENTS.md is the start file. HNOFF: the same project, and the setting turns AGENTS.md off (the run of A4). -----
const HN = makeHome('agents');
const nStart = startOf(N, 'AGENTS.md');
const toldSession = (home, startFiles) => writeSession(home, ID(6), day(19), startFiles, [
  { user: 'Draft the launch post.' }, { agent: 'Here is the post, with the price.' }, { user: 'No price in a launch post.' }, { agent: 'Ok.' }]);
writeSession(HN, ID(1), day(21), nStart, [
  { user: 'Change the city page.' },
  readOf(N, METHOD), readOf(N, INDEX), readOf(N, CITY), readOf(N, ORPHAN),
  { agent: 'Done.' }, { user: 'Thanks.' }
]);
writeSession(HN, ID(2), day(20), nStart, [
  { user: 'Fix the title of the Berlin city page.' },
  { grep: 'Berlin', files: [abs(CITY)] }, readOf(N, CITY), readOf(N, METHOD),
  { agent: 'Done.' }, { user: 'Thanks.' }
]);
toldSession(HN, nStart);
const HNOFF = makeHome('agents-off', { pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md' } } } });
const offStart = startOf(N, null);
writeSession(HNOFF, ID(1), day(21), offStart, [
  { user: 'Change the city page.' },
  readOf(N, 'AGENTS.md'), readOf(N, METHOD), readOf(N, INDEX), readOf(N, CITY), readOf(N, ORPHAN),
  { agent: 'Done.' }, { user: 'Thanks.' }
]);
writeSession(HNOFF, ID(2), day(20), offStart, [
  { user: 'Check the method.' }, readOf(N, 'AGENTS.md'), readOf(N, METHOD), { agent: 'Done.' }, { user: 'Thanks.' }]);
toldSession(HNOFF, offStart);

// ----- HB: the home of BARE. README.md links CONTRIBUTING? No: README.md names the files below. -----
const HB = makeHome('bare');
const bareStart = startOf(BARE, null);
writeSession(HB, ID(1), day(21), bareStart, [
  { user: 'What is this project?' },
  { grep: 'IndoEuroMap', files: [abs('README.md')] }, readOf(BARE, 'README.md'), readOf(BARE, 'llms.txt'), readOf(BARE, ORPHAN),
  { agent: 'Done.' }, { user: 'Thanks.' }
]);
writeSession(HB, ID(2), day(20), bareStart, [{ user: 'Read the README.' }, readOf(BARE, 'README.md'), { agent: 'Done.' }, { user: 'Thanks.' }]);

// ----- HBIG: 2 sessions. Both read AGENTS.md, one reads the big file. -----
const HBIG = makeHome('big');
const bigStart = startOf(BIG, 'CLAUDE.md');
writeSession(HBIG, ID(1), day(21), bigStart, [{ user: 'Read the big log.' }, readOf(BIG, 'AGENTS.md'), { read: abs(BIG_FILE), text: '# Big log\n\nlog line 000001\n' }, { agent: 'Done.' }, { user: 'Thanks.' }]);
writeSession(HBIG, ID(2), day(20), bigStart, [{ user: 'Read the rules.' }, readOf(BIG, 'AGENTS.md'), { agent: 'Done.' }, { user: 'Thanks.' }]);
const homes = { HM, HT20, HT19, HT4, HN, HNOFF, HB, HBIG };

// ---------- the fake binary, with the memory folder of this run in its answers ----------

const fakeRoot = path.join(work, 'fake');
const fake = path.join(fakeRoot, 'test', 'fake-claude.mjs');
mkdirSync(path.dirname(fake), { recursive: true });
copyFileSync(path.join(repo, 'test', 'fake-claude.mjs'), fake);
chmodSync(fake, 0o755);
const fakeAnswers = path.join(fakeRoot, 'fixtures', 'fake-claude');
mkdirSync(fakeAnswers, { recursive: true });
for (const name of readdirSync(path.join(repo, 'fixtures', 'fake-claude'))) {
  writeFileSync(path.join(fakeAnswers, name), readFileSync(path.join(repo, 'fixtures', 'fake-claude', name), 'utf8').replaceAll('MEMORY_DIR', MEMORY));
}

// ---------- the runs ----------

const statusOf = dir => execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=all', '--ignored'], { encoding: 'utf8' });
const before = {
  status: Object.fromEntries(Object.entries(projects).map(([name, dir]) => [name, statusOf(dir)])),
  files: Object.fromEntries(Object.entries({ ...projects, ...homes, repoSettings }).map(([name, dir]) => [name, snapshot(dir)]))
};
const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const all = [];
const twice = [];
// Step 11: only real context files count. The lost files of this test are files that no context file names
// (notes/orphan.md, the chain, the cycle, notes/big-log.md), files behind a folder link (guides/), and files that git
// ignores (work/). With the rule alone they are not context files, and their reads are dropped. This file checks the
// why and the fix of a lost file, so each run passes a config file that includes these folders (`why: "config"`).
// It also keeps the files of data/, so the list of files of the duplicate check is the list of step 10.
const CONFIG = path.join(work, 'config', 'context-files.json');
write(CONFIG, `${JSON.stringify({ include: ['notes/**', 'guides/**', 'work/**', 'data/**'] }, null, 2)}\n`);
// One run of the real command. With `again`, a second run with the same cache: both reports must be the same.
function run(name, project, home, { old = true, intents = true, extra = [], again = false, out2 = null, cache = name } = {}) {
  const once = out => {
    const args = [cli, project, '--claude-settings-home', home, '--out', out, '--cache', path.join(work, 'cache', cache), '--no-open', '--no-save', '--config', CONFIG, ...extra];
    if (old) args.push('--old-path', OLD);
    if (intents) args.push('--intents');
    const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    return { json: readFileSync(path.join(out, 'report.json'), 'utf8'), html: readFileSync(path.join(out, 'report.html'), 'utf8') };
  };
  const first = once(path.join(work, 'out', `${name}-1`));
  if (again) {
    if (out2) mkdirSync(out2, { recursive: true });
    twice.push({ name, first, second: once(out2 || path.join(work, 'out', `${name}-2`)) });
  }
  const result = { name, ...first, report: JSON.parse(first.json) };
  all.push(result);
  return result;
}
const artifact = path.join(repo, 'out', 'e2e-step-10-d');
const main = run('main', M, HM, { again: true, out2: artifact });
const agents = run('agents', N, HN, { again: true });
const agentsOff = run('agents-off', N, HNOFF, { again: true });
const bare = run('bare', BARE, HB, { again: true });
const thin20 = run('thin-5-20', M, HT20, { again: true });
const thin2of5 = run('thin-2-of-5', M, HT20, { extra: ['--sessions', '2'] });
const thin19 = run('thin-5-19', M, HT19);
const thin4 = run('thin-4-20', M, HT4);
const notAnalysed = run('not-analysed', M, HT19, { intents: false });
const noSessions = run('no-sessions', M, HT19, { old: false, intents: false });
// L3: the first run of BIG finds no answer for the duplicate check, so the check fails. Its call gives the run id (a
// hash of the file paths). This file then writes an answer with no fact for that id, and runs again.
const bigFailed = run('big-no-answer', BIG, HBIG, { cache: 'big' });
const bigRunId = calls().map(call => call.stdin.split('\n', 1)[0]).filter(head => head.startsWith('context-health duplicates ')).at(-1).split(' ').at(-1);
writeFileSync(path.join(fakeAnswers, `${bigRunId}.duplicates.json`), `${JSON.stringify({ total_cost_usd: 0.02, result: { facts: [] } })}\n`);
const big = run('big', BIG, HBIG, { cache: 'big', again: true });
const after = {
  status: Object.fromEntries(Object.entries(projects).map(([name, dir]) => [name, statusOf(dir)])),
  files: Object.fromEntries(Object.entries({ ...projects, ...homes, repoSettings }).map(([name, dir]) => [name, snapshot(dir)]))
};

// ---------- helpers for the checks ----------

const R = main.report;
const H = R.health;
const partsOf = report => { const h = report.health; return [h.score, h.parts.found.score, h.parts.close.score, h.parts.oneSource.score]; };
const answersOf = report => ['found', 'close', 'oneSource'].map(key => report.health.parts[key].answer);
const lostOf = (report, rel) => {
  const found = report.health.parts.found.lost.filter(item => item.path === rel);
  assert.equal(found.length, 1, `${rel} is in the lost list one time`);
  return found[0];
};
const fileOf = (report, rel) => report.map.files.find(file => file.path === rel);
const sectionOf = (report, n) => {
  const text = report.prompt.text;
  const from = text.indexOf(`## ${n}. `);
  const to = n === 6 ? text.length : text.indexOf(`## ${n + 1}. `);
  return text.slice(from, to);
};
const fixesOf = report => sectionOf(report, 5).split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));
// Step 11: section 5 of the prompt prints `fixes.list`. This is each fix of report.json: the list, then the smaller items.
const allFixes = report => [...report.fixes.list, ...report.fixes.smaller];
// Step 12: one question row of the page (find, close, told, lean): its count of items and its detail. The pattern needs a
// closed button and a hidden detail. test/e2e-step-12-b.test.mjs checks the markup of the rows.
const row = (page, key) => {
  const m = page.match(new RegExp(`<div class="qrow" data-q="${key}" data-n="(\\d+)">\\s*<button type="button" class="hq" aria-expanded="false" aria-controls="hd-${key}">[\\s\\S]*?</button>\\s*<div class="hd" id="hd-${key}" hidden>([\\s\\S]*?)</div>\\s*</div>\\s*(?:<div class="qrow"|</div>\\s*</section>)`));
  assert.ok(m, key);
  return { n: m[1], detail: m[2] };
};
const ROWS = ['find', 'close', 'told', 'lean'];
const dataLines = page => [...page.matchAll(/<p class="hdata[^"]*"[^>]*>([^<]*)<\/p>/g)].map(match => match[1]);
// The texts of health that a person reads: each why and each fix.
const textsOf = report => {
  const { found, close, oneSource } = report.health.parts;
  return [...found.lost.flatMap(item => [item.why, item.fix]), ...found.told.map(item => item.fix), ...(found.root ? [found.root.why, found.root.fix] : []),
    ...close.far.map(item => item.fix), ...[...oneSource.facts, ...oneSource.otherFacts].map(item => item.fix), oneSource.note, report.health.data.note, report.health.data.skippedNote].filter(Boolean);
};

const noDash = value => !/[\u2013\u2014]/.test(value);
const NOW = 'notes/now.md';
const LOOSE = mem('loose-note.md');
const MEMORY_FIX = rel => `Add a line with a link to ${rel} to the memory index (MEMORY.md in the memory folder of the project), in its first 200 lines.`;

// The start load reads the instruction files of each folder above a project. A stray file above the temp folder
// would change each result here, so say it first.
test('the runs work, and the folders above the temp folder have no instruction file', () => {
  assert.ok(!work.startsWith(`${os.homedir()}${path.sep}`), 'the temp folder is not under the home folder');
  for (let dir = work; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/CLAUDE.md', '.claude/AGENTS.md']) {
      assert.ok(!existsSync(path.join(dir, name)), `${path.join(dir, name)} changes the start load of each test project`);
    }
  }
  // Each session that this file writes for a run with --intents is analysed.
  for (const [r, ok] of [[main, 5], [agents, 3], [agentsOff, 3], [bare, 2], [thin20, 5], [thin2of5, 2], [thin19, 5], [thin4, 4], [notAnalysed, 0], [noSessions, 0], [big, 2]]) {
    assert.equal(r.report.intents.totals.ok, ok, r.name);
  }
  // The start file of each project.
  const startOfRun = r => r.report.startLoad.filter(item => item.scope === 'project' && item.what === 'instructions').map(item => item.path);
  assert.deepEqual([main, agents, agentsOff, bare].map(startOfRun), [['CLAUDE.md'], ['AGENTS.md'], [], []]);
});

test('G4: the keys of health, in their order', () => {
  // Step 11: the new key `fixes` is between `health` and `prompt`.
  assert.deepEqual(Object.keys(R).slice(-8), ['needs', 'groups', 'duplicates', 'routes', 'health', 'fixes', 'prompt', 'score']);
  for (const r of all) {
    const h = r.report.health;
    assert.deepEqual(Object.keys(h), ['method', 'weights', 'score', 'label', 'reason', 'parts', 'data', 'counts', 'v1'], r.name);
    // Step 11: the old keys stay, and `counts` is a new key. Step 12: `v1` is the new last key.
    assert.deepEqual(Object.keys(r.report.fixes), ['limit', 'total', 'list', 'smaller', 'left'], r.name);
    for (const fix of allFixes(r.report)) assert.deepEqual(Object.keys(fix), ['id', 'kind', 'needs', 'files', 'target', 'line', 'text', 'question']); // step 12: `question`
    assert.deepEqual(Object.keys(h.parts), ['found', 'close', 'oneSource']);
    assert.deepEqual(Object.keys(h.parts.found), ['score', 'counted', 'reached', 'answer', 'lost', 'told', 'root', 'saved']);
    assert.deepEqual(Object.keys(h.parts.close), ['score', 'counted', 'oneStep', 'answer', 'far', 'noRoute']);
    assert.deepEqual(Object.keys(h.parts.oneSource), ['score', 'counted', 'answer', 'checked', 'note', 'facts', 'otherFacts', 'coverage']);
    assert.deepEqual(Object.keys(h.parts.oneSource.coverage), ['checked', 'total', 'needed', 'neededChecked']);
    assert.deepEqual(Object.keys(h.data), ['sessions', 'analysed', 'needs', 'thin', 'limits', 'skipped', 'note', 'skippedNote']);
    assert.deepEqual(Object.keys(h.data.skipped), ['total', 'headless', 'noUserMessage']);
    assert.deepEqual(h.data.limits, { sessions: 5, needs: 20 });
    for (const item of h.parts.found.lost) assert.deepEqual(Object.keys(item), ['path', 'uses', 'cost', 'why', 'fix', 'gap', 'underRoot']);
    for (const item of h.parts.found.told) assert.deepEqual(Object.keys(item), ['text', 'quote', 'uses', 'cost', 'fix', 'savedPath']);
    for (const item of h.parts.found.saved) assert.deepEqual(Object.keys(item), ['text', 'quote', 'uses', 'path', 'steps', 'savedQuote']);
    for (const item of h.parts.close.far) assert.deepEqual(Object.keys(item), ['path', 'uses', 'steps', 'route', 'cost', 'fix']);
    if (h.parts.found.root) {
      assert.deepEqual(Object.keys(h.parts.found.root), ['path', 'imports', 'uses', 'files', 'why', 'fix']);
      for (const item of h.parts.found.root.files) assert.deepEqual(Object.keys(item), ['path', 'uses', 'steps']);
    }
  }
});

// ---------- fault 8, the health side: a told fact that a file holds now ----------

test('S1, S6, S7, D6, D7: Found and Close of the main run, worked out by hand', () => {
  // File needs: S1 5 (index, changes, bench, p, q), S2 3 (changes, c, y), S3 5 (city, deploy, orphan, user notes, tiktok),
  // S4 4 (AGENTS, METHOD, legend, loose-note), S7 1 (city) = 18. Told facts: 5 (S7). Counted: 23.
  // With a route: city 2 times (3 steps), guides/deploy.md (1 step), AGENTS.md (1), METHOD.md (2), legend.md (1) = 6 file needs.
  // The told facts that a file with a route holds now count for that file (S7): c1 in saved-rule.md (the index links
  // it, 1 step), c3 in city.md (3 steps), c4 in ~/.claude/CLAUDE.md (a start file, 0 steps) = 3. Reached: 9 of 23 = 39.13.
  // c2 is in loose-note.md, a memory file with no link (S6), and c5 is in no file: both count 0.
  // Close: city 3 x 0.25 + deploy 1 + AGENTS 1 + METHOD 0.5 + legend 1 + c1 1 + c4 1 = 6.25, / 23 = 27.17.
  const { found, close } = H.parts;
  assert.deepEqual([found.score, found.counted, found.reached, found.answer], [39, 23, 9, '11 files lost, 2 facts told by you']);
  assert.deepEqual([close.score, close.counted, close.oneStep, close.noRoute, close.answer], [27, 23, 5, 14, '2 files far, 14 needs have no route']);
  // S1: worker C gives the place of each fact. The agent did not have it then, so the need is still `missing`.
  const facts = R.needs.sessions.find(entry => entry.sessionId === ID(7)).intents.flatMap(intent => intent.needs).filter(need => need.kind === 'missing');
  assert.deepEqual(facts.map(need => need.savedPath), [mem('saved-rule.md'), LOOSE, CITY, '~/.claude/CLAUDE.md', null]);
  assert.deepEqual(found.saved, [
    { text: 'Ask the user before a decision file changes', quote: 'Ask me before you change a decision file', uses: 1, path: mem('saved-rule.md'), steps: 1,
      savedQuote: 'Ask the user before you change a decision file.' },
    { text: 'Five cities have a sample summary', quote: 'Only five cities have a sample summary', uses: 1, path: CITY, steps: 3,
      savedQuote: 'Five cities have a sample summary: Berlin, Madrid, Hamburg, Milan, Barcelona.' },
    // D6: ~/.claude/CLAUDE.md is in the start load and not on the map. It has 0 steps.
    { text: 'Move files to the Trash, do not delete them', quote: 'Never delete a file, use the Trash', uses: 1, path: '~/.claude/CLAUDE.md', steps: 0,
      savedQuote: 'Do not delete files. Move them to the Trash.' }
  ]);
  assert.equal(fileOf(R, '~/.claude/CLAUDE.md'), undefined);
  assert.ok(R.startLoad.some(item => item.path === '~/.claude/CLAUDE.md' && item.what === 'instructions'));
  // S6: the fact is in a file with no route. The item says where it is, and the fix says where the link goes.
  assert.deepEqual(found.told, [
    { text: 'Each export goes to the folder exports/', quote: 'Put each export in exports/', uses: 1, cost: 1,
      fix: `The fact is in ${LOOSE} now, but that file has no route from the start. ${MEMORY_FIX(LOOSE)}`, savedPath: LOOSE },
    { text: 'The owner reads each release note before it goes out', quote: 'I read each release note first', uses: 1, cost: 1,
      fix: 'Write this fact in the file the agent reads for this task.', savedPath: null }
  ]);
  assert.equal(fileOf(R, LOOSE).reach, 'none');
  // D7: the fact in city.md is a use of that far file, so Close does not say "Yes".
  assert.deepEqual(close.far.map(item => [item.path, item.uses, item.steps, item.cost]), [[CITY, 3, 3, 2.25], [METHOD, 1, 2, 0.5]]);
  assert.deepEqual(close.far[0].route, ['CLAUDE.md', 'AGENTS.md', INDEX, CITY]);
});

// ---------- fault 6: each why and each fix comes from the map ----------

test('F3, F4, F5, F6, F7, F9, F10, D1, D2, D3, D10, D15, D16: each lost file gets its why and its fix from the map', () => {
  const callsFix = `In ${NOW} (line 4), make the folder name a link to ${CALLS}/index.md.`;
  const link = rel => `Link ${rel} from CLAUDE.md, with one line that says when to read it.`;
  const noLink = 'No file links to it.';
  // The order: the uses of the group (high first), the gap path, the uses of the file (high first), the path.
  assert.deepEqual(H.parts.found.lost.map(item => [item.path, item.uses, item.gap, item.why, item.fix]), [
    // F4: no file links the index, and the index links changes.md and bench.md. One group, 4 uses, and one fix: link the index.
    // F10, D2: notes/now.md (a link names it) and guides/deploy.md (only a folder link reaches it) name the folder at 1 step.
    [`${CALLS}/changes.md`, 2, `${CALLS}/index.md`, `No file on a route links to it. ${CALLS}/index.md links it, but that file has no route. You had to give the path 1 time.`, callsFix],
    [`${CALLS}/bench.md`, 1, `${CALLS}/index.md`, `No file on a route links to it. ${CALLS}/index.md links it, but that file has no route.`, callsFix],
    [`${CALLS}/index.md`, 1, `${CALLS}/index.md`, noLink, callsFix],
    // D1: AGENTS.md names the top folder `first-iteration/`, not the folder of the file: the link goes next to the name.
    [TIKTOK, 1, TIKTOK, noLink, `In AGENTS.md (line 12), add a link to ${TIKTOK} next to the folder name first-iteration.`],
    // F5: b.md links c.md, a.md links b.md, no file links a.md. The file to link is a.md.
    ['notes/chain/c.md', 1, 'notes/chain/a.md', 'No file on a route links to it. notes/chain/b.md links it, but that file has no route. The chain of links starts at notes/chain/a.md.', link('notes/chain/a.md')],
    // F6: x.md and y.md link each other. The walk stops, and the file to link is the first by path.
    ['notes/cycle/y.md', 1, 'notes/cycle/x.md', 'No file on a route links to it. notes/cycle/x.md links it, but that file has no route.', link('notes/cycle/x.md')],
    // F3: no link, and no file names its folder: the fix names the start file.
    [ORPHAN, 1, ORPHAN, noLink, link(ORPHAN)],
    // D1: 2 files with no link in one folder that notes/now.md names. The folder name cannot be the link to both.
    ['work/extra/p.md', 1, 'work/extra/p.md', noLink, `In ${NOW} (line 5), add a link to work/extra/p.md next to the folder name work/extra.`],
    ['work/extra/q.md', 1, 'work/extra/q.md', noLink, `In ${NOW} (line 5), add a link to work/extra/q.md next to the folder name work/extra.`],
    // F9: a file in ~/.claude/ that the map does not know.
    [USER_NOTES, 1, USER_NOTES, 'It is outside the project, so the map has no route to it.',
      `Name the full path of ${USER_NOTES} in CLAUDE.md, with one line that says when to read it. The map does not count a link to a file outside the project.`],
    // D10: a memory file with no link from the index.
    [LOOSE, 1, LOOSE, noLink, MEMORY_FIX(LOOSE)]
  ]);
  assert.ok(H.parts.found.lost.every(item => item.cost === item.uses && item.underRoot === false));
  // The lines that the fixes name.
  assert.equal(lineOf(path.join(M, NOW), 'work/model-calls'), 4);
  assert.equal(lineOf(path.join(M, NOW), 'work/extra'), 5);
  assert.equal(lineOf(path.join(M, 'AGENTS.md'), '`first-iteration/` is the archive'), 12);
  // F7: git ignores the index, a session read it, and its links are edges of the map.
  const index = fileOf(R, `${CALLS}/index.md`);
  assert.deepEqual([index.ignored, index.reach, index.linkedFrom], [true, 'none', []]);
  assert.deepEqual(fileOf(R, `${CALLS}/bench.md`).linkedFrom.map(item => item.path), [`${CALLS}/index.md`]);
  // D2, D3: 3 files with a route name the folder: the memory index (0 steps), guides/deploy.md and notes/now.md (1 step).
  assert.deepEqual(R.map.folderMentions.filter(item => item.folder === CALLS).map(item => [item.source, item.line, fileOf(R, item.source).steps, fileOf(R, item.source).via]),
    [['guides/deploy.md', 3, 1, 'folder'], [NOW, 4, 1, 'link'], [mem('MEMORY.md'), 5, 0, 'start']]);
  // D16: plan.md names the folder notes/, where 3 of the gaps are. It is 2 steps from the start, so the fixes name CLAUDE.md.
  const PLAN = 'second-iteration/plan.md';
  assert.deepEqual(R.map.folderMentions.filter(item => item.folder === 'notes').map(item => [item.source, item.line, fileOf(R, item.source).steps]),
    [[PLAN, lineOf(path.join(M, PLAN), 'The loose notes are in notes/'), 2]]);
  assert.ok(!H.parts.found.lost.some(item => item.fix.includes(PLAN)));
  // D15: each fix names the file to link by its path, so it has a meaning in the prompt too.
  for (const item of H.parts.found.lost) assert.ok(item.fix.includes(item.gap) && !/^(Link|Name) it /.test(item.fix), item.fix);
});

test('F1, F2, F11, D5, D12: the fixes of the main prompt come from the real routes', () => {
  const fixes = fixesOf(R);
  const guideLine = lineOf(path.join(M, 'CLAUDE.md'), '[guides/](guides/)');
  assert.equal(guideLine, 8);
  assert.deepEqual(fileOf(R, 'guides/deploy.md').route.map(step => [step.path, step.via, step.line]), [['CLAUDE.md', 'start', null], ['guides/deploy.md', 'folder', 8]]);
  // index.md links city.md (line 7), and index.md is 2 steps from the start: the agent does not read it first.
  assert.equal(lineOf(path.join(M, INDEX), '[city.md](city.md)'), 7);
  assert.deepEqual(fileOf(R, CITY).route.map(step => step.path), ['CLAUDE.md', 'AGENTS.md', INDEX, CITY]);
  assert.equal(fileOf(R, INDEX).steps, 2);
  // Step 11: section 5 prints `fixes.list`: one fix for each root cause, 10 at most. The order: the needs (high first),
  // the kind (root, no-route, told, searched), the target, the first file.
  assert.deepEqual(fixes, R.fixes.list.map(fix => fix.text));
  assert.deepEqual(R.fixes.list.map(fix => [fix.id, fix.kind, fix.needs, fix.files, fix.target, fix.line, fix.text]), [
    ['x1', 'no-route', 4, [`${CALLS}/changes.md`, `${CALLS}/bench.md`, `${CALLS}/index.md`], NOW, 4,
      `In ${NOW} (line 4), make the folder name a link to ${CALLS}/index.md. It gives a route to 3 needed files (4 needs): ${CALLS}/changes.md (2 needs), ${CALLS}/bench.md (1 need), ${CALLS}/index.md (1 need).`],
    // F2: 3 steps away, found by a search (S3) and read with nothing that named it (S7). Step 11: a far file gets no
    // "Shorten the route" fix. The agent searched, so the file has a `searched` fix. Its linker (index.md) is 2 steps
    // from the start, so it is not the place for the fix: the fix is a link from the start file.
    ['x2', 'searched', 2, [CITY], 'CLAUDE.md', null, `Link this file from CLAUDE.md, or from an index file that it links by name, with one line that says when to read it: ${CITY} (2 times). ` +
      'Today only a file that the agent does not read first names it (a file 2 or more steps from the start, or a file that only a folder link reaches). The agent got it with no link 2 times (a search, a path from the user, or a read with nothing that named the file).'],
    ['x3', 'no-route', 1, [TIKTOK], 'AGENTS.md', 12, `In AGENTS.md (line 12), add a link to ${TIKTOK} next to the folder name first-iteration. 1 intent needed it. No file links to it.`],
    ['x4', 'no-route', 1, ['notes/chain/c.md'], 'CLAUDE.md', null, 'Link notes/chain/a.md from CLAUDE.md, with one line that says when to read it. It gives a route to 1 needed file (1 need): notes/chain/c.md (1 need).'],
    ['x5', 'no-route', 1, ['notes/cycle/y.md'], 'CLAUDE.md', null, 'Link notes/cycle/x.md from CLAUDE.md, with one line that says when to read it. It gives a route to 1 needed file (1 need): notes/cycle/y.md (1 need).'],
    ['x6', 'no-route', 1, [ORPHAN], 'CLAUDE.md', null, `Link ${ORPHAN} from CLAUDE.md, with one line that says when to read it. 1 intent needed it. No file links to it.`],
    ['x7', 'no-route', 1, [USER_NOTES], 'CLAUDE.md', null,
      `Name the full path of ${USER_NOTES} in CLAUDE.md, with one line that says when to read it. The map does not count a link to a file outside the project. 1 intent needed it. It is outside the project, so the map has no route to it.`],
    ['x8', 'no-route', 1, ['work/extra/p.md'], NOW, 5, `In ${NOW} (line 5), add a link to work/extra/p.md next to the folder name work/extra. 1 intent needed it. No file links to it.`],
    ['x9', 'no-route', 1, ['work/extra/q.md'], NOW, 5, `In ${NOW} (line 5), add a link to work/extra/q.md next to the folder name work/extra. 1 intent needed it. No file links to it.`],
    ['x10', 'no-route', 1, [LOOSE], mem('MEMORY.md'), null, `${MEMORY_FIX(LOOSE)} 1 intent needed it. No file links to it.`]
  ]);
  // The smaller items are not in the prompt: it gives their count, with no number.
  assert.ok(sectionOf(R, 5).includes(`\n10. ${MEMORY_FIX(LOOSE)} 1 intent needed it. No file links to it.\nAnd ${R.fixes.smaller.length} smaller items.\n`));
  const smaller = R.fixes.smaller.map(fix => [fix.kind, fix.needs, fix.files, fix.target, fix.line, fix.text]);
  // The told fact that no file holds. The told facts come after the files with no route of the same needs.
  assert.deepEqual(smaller[0], ['told', 1, [], 'CLAUDE.md', null, 'Add this fact to CLAUDE.md, or to a file that it links: "The owner reads each release note before it goes out". The user typed it 1 time.']);
  // F1: 1 step away, and CLAUDE.md links only its folder. Not "Link it from CLAUDE.md". Step 11: the fix is a `searched` fix.
  assert.deepEqual(smaller.at(-1), ['searched', 1, ['guides/deploy.md'], 'CLAUDE.md', 8,
    'CLAUDE.md (line 8) links only the folder guides/, so no link names the files in it. Name this file there, or link an index of the folder, and say when to read it: guides/deploy.md (1 time). The agent got it with no link 1 time (a search, a path from the user, or a read with nothing that named the file).']);
  assert.ok(!allFixes(R).some(fix => fix.text.startsWith('Link guides/deploy.md from ')));
  // S6: the smaller items also have a told fix for the fact in loose-note.md. Its change is the change of fix 10 (the
  // link to loose-note.md in the memory index). This test does not check that fix: it is 2 fixes for one root cause.
  // Step 11: the copies have no fix. The report gives their count.
  assert.deepEqual(R.fixes.left, { copies: H.parts.oneSource.facts.filter(fact => !fact.differ).length, notNamed: 0 });
  // D5: the index links legend.md, and the session record does not hold the index. Step 11: section 4 has no list of
  // the reads with nothing that named the file. The memory index names legend.md at the start, so the read is not a
  // search: the file is not in line b, not in section 4, and it has no fix.
  const problems = sectionOf(R, 4);
  assert.ok(!problems.includes('legend.md'));
  assert.ok(!H.counts.searched.items.some(item => item.path === mem('legend.md')));
  assert.ok(!allFixes(R).some(fix => fix.text.includes('legend.md')));
  // Step 11: the list of the searched files, with the place of the link.
  assert.ok(problems.includes(['Needed files with a route that the agent searched:',
    `- ${CITY}: needed by 2 intents, searched 2 times. ${INDEX} (line 7) links it. The link text must say when to read it.`,
    '- guides/deploy.md: needed by 1 intent, searched 1 time. CLAUDE.md (line 8) links only its folder. The link must name the file and say when to read it.'].join('\n')));
  assert.deepEqual(H.counts.searched.items.map(item => [item.path, item.uses, item.searched, item.ways]),
    [[CITY, 2, 2, { search: 1, user: 0, none: 1 }], ['guides/deploy.md', 1, 1, { search: 0, user: 0, none: 1 }]]);
  // Section 4: the why of health for a file with no path, the told facts that are still a gap, and the saved facts.
  assert.ok(problems.includes(`- ${ORPHAN}: needed by 1 intent. No file links to it.`));
  assert.ok(problems.includes(`- ${CALLS}/bench.md: needed by 1 intent. No file on a route links to it. ${CALLS}/index.md links it, but that file has no route.`));
  assert.ok(problems.includes(`- "Each export goes to the folder exports/" (1 time). The user said: "Put each export in exports/" It is in ${LOOSE} now, a file with no route.`));
  assert.ok(problems.includes('- "The owner reads each release note before it goes out" (1 time). The user said: "I read each release note first"'));
  assert.ok(problems.includes(['Facts that the user typed, and that a context file holds now (no change needed):',
    `- "Ask the user before a decision file changes": in ${mem('saved-rule.md')} (1 step from the start).`,
    `- "Five cities have a sample summary": in ${CITY} (3 steps from the start).`,
    '- "Move files to the Trash, do not delete them": in ~/.claude/CLAUDE.md (in the start load).'].join('\n')));
  assert.ok(!problems.includes('"Ask the user before a decision file changes" (1 time)'), 'a saved fact is not in the list of gaps');
  // F11, step 11: in each run, the prompt prints the fix list, each lost file is in one fix, and that fix starts with the fix of health.
  for (const r of all) {
    const list = allFixes(r.report);
    const { found } = r.report.health.parts;
    assert.deepEqual(fixesOf(r.report), r.report.fixes.list.map(fix => fix.text), r.name);
    assert.deepEqual([r.report.fixes.limit, r.report.fixes.total, r.report.fixes.list.length <= 10], [10, list.length, true], r.name);
    assert.deepEqual(list.map(fix => fix.id), list.map((fix, k) => `x${k + 1}`), r.name);
    for (const item of found.lost) {
      const own = list.filter(fix => fix.files.includes(item.path));
      assert.equal(own.length, 1, `${r.name}: ${item.path}`);
      if (item.underRoot) assert.equal(own[0].kind, 'root', `${r.name}: ${item.path}`);
      else assert.ok(own[0].kind === 'no-route' && own[0].text.startsWith(item.fix), `${r.name}: ${item.path}`);
    }
    if (found.root) assert.ok(list[0].kind === 'root' && list[0].text.startsWith(`${found.root.fix} ${found.root.why}`), r.name);
    // Step 11: no fix for a far file (the old "Shorten the route"), and no fix for a copy (the old "Keep ... only in").
    for (const fix of list) assert.ok(!fix.text.startsWith('Shorten the route to ') && !/^Keep .* only in /.test(fix.text), `${r.name}: ${fix.text}`);
  }
});

test('F8, R7, D12: with AGENTS.md as the start file, each text names AGENTS.md', () => {
  // N has no CLAUDE.md, so Claude Code reads AGENTS.md. 6 file needs: METHOD.md 2 (1 step), index.md 1 (1 step),
  // city.md 2 (2 steps), the orphan 1 (no route). 1 told fact. Found: 5 of 7 = 71.43. Close: 3 + 2 x 0.5 = 4, / 7 = 57.14.
  const { found, close } = agents.report.health.parts;
  assert.deepEqual([found.score, close.score, found.answer, close.answer], [71, 57, '1 file lost, 1 fact told by you', '1 file far, 2 needs have no route']);
  assert.deepEqual([agents.report.map.virtualStart, found.root], [null, null]);
  assert.deepEqual([R.map.virtualStart, H.parts.found.root], [null, null], 'R7: the fixture with its CLAUDE.md has no root item');
  assert.deepEqual(found.lost.map(item => [item.path, item.why, item.fix]),
    [[ORPHAN, 'No file links to it.', `Link ${ORPHAN} from AGENTS.md, with one line that says when to read it.`]]);
  assert.deepEqual(close.far.map(item => [item.path, item.uses, item.steps, item.route, item.fix]),
    [[CITY, 2, 2, ['AGENTS.md', INDEX, CITY], 'Link it from AGENTS.md, so it is 1 step from the start.']]);
  // Step 11: a far file gets no "Shorten the route" fix. city.md has a fix because the agent found it by a search
  // (session 2). Here its linker (index.md) is 1 step from the start, so the fix is the text of the link that is there.
  // The order: no-route, told, searched (1 need each).
  assert.equal(lineOf(path.join(N, INDEX), '[city.md](city.md)'), 7);
  assert.equal(fileOf(agents.report, INDEX).steps, 1);
  assert.deepEqual(fixesOf(agents.report), [
    `Link ${ORPHAN} from AGENTS.md, with one line that says when to read it. 1 intent needed it. No file links to it.`,
    'Add this fact to AGENTS.md, or to a file that it links: "A launch post has no price in it". The user typed it 1 time.',
    `In ${INDEX} (line 7), make the link text of ${CITY} say what the file holds and when to read it. The agent got it with no link 1 time (a search, a path from the user, or a read with nothing that named the file).`
  ]);
  assert.deepEqual(agents.report.fixes.list.map(fix => [fix.kind, fix.target, fix.line]), [['no-route', 'AGENTS.md', null], ['told', 'AGENTS.md', null], ['searched', INDEX, 7]]);
  assert.ok(sectionOf(agents.report, 6).includes('Keep AGENTS.md small:'));
  // No text of health, and no fix of the prompt, names CLAUDE.md: the project has none.
  for (const value of [...textsOf(agents.report), sectionOf(agents.report, 5), sectionOf(agents.report, 6)]) assert.ok(!value.includes('CLAUDE.md'), value);
  assert.equal(agents.report.routes.map.searchFrom, 'AGENTS.md');
});

// ---------- fault 4: the root item ----------

test('R2, R3, R4, R5, R6, R9: AGENTS.md does not load, so the first fix is a CLAUDE.md that imports it', () => {
  const report = agentsOff.report;
  const { found, close } = report.health.parts;
  const virtual = report.map.virtualStart;
  assert.deepEqual([virtual.path, virtual.imports], ['CLAUDE.md', ['AGENTS.md']]);
  // R5: the numbers come from the real map, where no project file loads at the start. 7 file needs and 1 told fact, none reached.
  assert.equal(fileOf(report, 'CLAUDE.md'), undefined);
  assert.equal(report.map.totals.start, 0);
  assert.deepEqual([found.score, found.counted, found.reached, close.score], [0, 8, 0, 0]);
  // R2, R4, R9: the root item. Its files by uses (high first), then by path. Its uses are the sum.
  assert.deepEqual(found.root, {
    path: 'CLAUDE.md', imports: ['AGENTS.md'], uses: 6,
    files: [{ path: 'AGENTS.md', uses: 2, steps: 0 }, { path: METHOD, uses: 2, steps: 1 }, { path: CITY, uses: 1, steps: 2 }, { path: INDEX, uses: 1, steps: 1 }],
    why: 'No project instruction file loads at the start: the project has no CLAUDE.md, and Claude Code does not load AGENTS.md here.',
    fix: 'Create CLAUDE.md with the line `@AGENTS.md`.'
  });
  // R3: each file under the root item is in map.virtualStart.reached, with its steps there.
  const reached = new Map(virtual.reached.map(item => [item.path, item.steps]));
  for (const file of found.root.files) assert.equal(reached.get(file.path), file.steps, file.path);
  assert.ok(!reached.has(ORPHAN));
  // A file under the root item has a short fix that points to it. R6: the orphan keeps its own fix.
  assert.deepEqual(found.lost.map(item => [item.path, item.underRoot, item.fix]), [
    ['AGENTS.md', true, 'The new CLAUDE.md loads it at the start. See the first fix.'],
    [METHOD, true, 'The new CLAUDE.md gives it a route of 1 step. See the first fix.'],
    [INDEX, true, 'The new CLAUDE.md gives it a route of 1 step. See the first fix.'],
    [ORPHAN, false, `Link ${ORPHAN} from the new CLAUDE.md, with one line that says when to read it.`],
    // F6: area.md and city.md link each other. The file to link is the first of the 2 by path.
    [CITY, true, 'The new CLAUDE.md gives it a route of 2 steps. See the first fix.']
  ]);
  assert.equal(lostOf(report, CITY).gap, 'second-iteration/decisions/area.md');
  // R4: fix 1 of the prompt. Then the orphan, then the told fact. Each names the new file as new.
  assert.deepEqual(fixesOf(report), [
    'Create CLAUDE.md with the line `@AGENTS.md`. No project instruction file loads at the start: the project has no CLAUDE.md, and Claude Code does not load AGENTS.md here. ' +
      `It covers 4 needed files with no route (6 needs): AGENTS.md (2 needs), ${METHOD} (2 needs), ${CITY} (1 need), ${INDEX} (1 need).`,
    `Link ${ORPHAN} from the new CLAUDE.md, with one line that says when to read it. 1 intent needed it. No file links to it.`,
    'Add this fact to the new CLAUDE.md, or to a file that it links: "A launch post has no price in it". The user typed it 1 time.'
  ]);
  // Step 11: the root fix covers the 4 files under the root item, so they have no fix of their own.
  assert.deepEqual(report.fixes.list.map(fix => [fix.kind, fix.needs, fix.files, fix.target]), [
    ['root', 6, ['AGENTS.md', METHOD, CITY, INDEX], 'CLAUDE.md'], ['no-route', 1, [ORPHAN], 'CLAUDE.md'], ['told', 1, [], 'CLAUDE.md']]);
  assert.ok(sectionOf(report, 6).includes('Keep the new CLAUDE.md small:'));
  // Step 12: the page shows the items of health.v1, not the old Found detail (test/e2e-step-12-b.test.mjs). The root fix
  // is under question find. The texts of the counts stay in report.json.
  assert.ok(row(agentsOff.html, 'find').detail.includes(`<li data-fix="${report.fixes.list[0].id}" data-kind="root">`));
  const counts = report.health.counts;
  assert.deepEqual([counts.noRoute.text, counts.noRoute.base, counts.told.text],
    ['5 needed files have no route', 'of 5 needed files', '1 fact you had to type (0 already saved)']);
});

test('R1, R8: with no CLAUDE.md and no AGENTS.md, the first fix is a new CLAUDE.md, and no text names it as a file that is there', () => {
  const report = bare.report;
  const { found } = report.health.parts;
  assert.deepEqual(report.map.virtualStart, { path: 'CLAUDE.md', imports: [], reached: [] });
  // The lost project files are under the root item: each of their fixes needs the new file. README.md and llms.txt link each other.
  assert.deepEqual(found.root, {
    path: 'CLAUDE.md', imports: [], uses: 4,
    files: [{ path: 'README.md', uses: 2, steps: null }, { path: 'llms.txt', uses: 1, steps: null }, { path: ORPHAN, uses: 1, steps: null }],
    why: 'No project instruction file loads at the start: the project has no CLAUDE.md and no AGENTS.md.',
    fix: 'Create CLAUDE.md. Link each lost file from it, with one line that says when to read it.'
  });
  assert.deepEqual(found.lost.map(item => [item.path, item.underRoot, item.gap, item.fix]), [
    ['README.md', true, 'README.md', 'Link it from the new CLAUDE.md. See the first fix.'],
    ['llms.txt', true, 'README.md', 'Link README.md from the new CLAUDE.md. See the first fix.'],
    [ORPHAN, true, ORPHAN, 'Link it from the new CLAUDE.md. See the first fix.']
  ]);
  const fixes = fixesOf(report);
  // Step 11: one root fix covers the 3 lost files. It is the only fix.
  assert.deepEqual(fixes, ['Create CLAUDE.md. Link each lost file from it, with one line that says when to read it. No project instruction file loads at the start: the project has no CLAUDE.md and no AGENTS.md. ' +
    `It covers 3 needed files with no route (4 needs): README.md (2 needs), llms.txt (1 need), ${ORPHAN} (1 need).`]);
  assert.deepEqual(report.fixes.list.map(fix => [fix.kind, fix.needs, fix.files, fix.target]), [['root', 4, ['README.md', 'llms.txt', ORPHAN], 'CLAUDE.md']]);
  assert.ok(!fixes.slice(1).some(fix => fix.includes(ORPHAN) || fix.startsWith('Link ')), 'the root item covers each lost file');
  // R1: each text that names CLAUDE.md says that the file is new, or that the project has none. The copy fixes name other files.
  for (const r of [bare, agentsOff]) {
    const values = [...textsOf(r.report), ...fixesOf(r.report), sectionOf(r.report, 6)];
    for (const value of values) {
      const rest = value.replace(/the new CLAUDE\.md/gi, '').replaceAll('Create CLAUDE.md', '').replaceAll('has no CLAUDE.md', '');
      assert.ok(!rest.includes('CLAUDE.md'), value);
    }
    assert.ok(values.some(value => value.includes('the new CLAUDE.md')));
  }
  // Step 12: the page shows the root fix under question find (the old detail of row a is gone).
  assert.ok(row(bare.html, 'find').detail.includes('data-kind="root"'));
  // R8: the tool does not write the file.
  for (const dir of [BARE, N]) assert.ok(!existsSync(path.join(dir, 'CLAUDE.md')));
});

// ---------- fault 5: the Close answer ----------

test('C1, C2, C3, C4, C5, C6: the Close answer counts the far files and the needs with no route', () => {
  const closeOf = r => r.report.health.parts.close;
  // C1, C2: lost needs and no far file. Not "Yes".
  assert.deepEqual([closeOf(agentsOff).answer, closeOf(agentsOff).noRoute, closeOf(agentsOff).far.length, closeOf(agentsOff).score], ['8 needs have no route', 8, 0, 0]);
  assert.deepEqual([closeOf(bare).answer, closeOf(bare).noRoute], ['4 needs have no route', 4]);
  // C3: far files first, then the needs with no route.
  assert.equal(closeOf(main).answer, '2 files far, 14 needs have no route');
  assert.equal(closeOf(agents).answer, '1 file far, 2 needs have no route');
  // C4: BIG has 3 needs: AGENTS.md 2 times (1 step), and the big file with no route. Found and Close: 2 of 3 = 66.67.
  assert.deepEqual([closeOf(big).answer, closeOf(big).noRoute, closeOf(big).score, big.report.health.parts.found.score], ['1 need has no route', 1, 67, 67]);
  // Only far files: 5 sessions read AGENTS.md (1 step) and 3 files 2 steps away. Close: (5 + 15 x 0.5) / 20 = 62.5.
  assert.deepEqual([closeOf(thin20).answer, closeOf(thin20).noRoute, closeOf(thin20).score, thin20.report.health.parts.found.answer], ['3 files far', 0, 63, 'Yes']);
  // C5. Step 11: the page does not show the Close detail any more (the far files, the note about the needs with no
  // route). The Close answer stays in report.json (above).
  for (const r of [main, big, thin20]) assert.ok(!r.html.includes('data-part="close"') && !r.html.includes('so they count 0 here'), r.name);
  // C6: in each run, a part says "Yes" only at 100, and each part below 100 gives a count.
  let yes = 0;
  for (const r of all) {
    for (const [key, part] of Object.entries(r.report.health.parts)) {
      if (part.score == null) { assert.equal(part.answer, null); continue; }
      assert.equal(part.answer === 'Yes', part.score === 100, `${r.name} ${key}: ${part.answer} at ${part.score}`);
      yes += part.answer === 'Yes' ? 1 : 0;
    }
  }
  assert.ok(yes >= 5, 'some parts are at 100');
});

// ---------- fault 7: thin data ----------

test('T1, T2, T3, T4, T5, T6, D17: the thin data line and the skipped files line', () => {
  const dataOf = r => r.report.health.data;
  const short = r => { const d = dataOf(r); return [d.sessions, d.analysed, d.needs, d.thin]; };
  // T2: thin below 5 analysed sessions or below 20 counted needs. T5: 5 sessions and 20 needs are not thin.
  assert.deepEqual(short(thin20), [5, 5, 20, false]);
  assert.deepEqual(short(thin19), [5, 5, 19, true]);
  assert.deepEqual(short(thin4), [4, 4, 20, true]);
  assert.deepEqual(short(main), [5, 5, 23, false]);
  // T1, T6: --sessions 2 analyses 2 of the 5 sessions that were read. The line gives both numbers.
  assert.deepEqual(short(thin2of5), [5, 2, 8, true]);
  assert.equal(dataOf(thin2of5).note, 'Thin data: 2 analysed sessions of 5 read and 8 needs. The counts can change a lot with more sessions.');
  assert.equal(dataOf(thin19).note, 'Thin data: 5 analysed sessions and 19 needs. The counts can change a lot with more sessions.');
  assert.equal(dataOf(thin4).note, 'Thin data: 4 analysed sessions and 20 needs. The counts can change a lot with more sessions.');
  // T3: 2 headless files and 1 file with no user message.
  assert.deepEqual(dataOf(thin19).skipped, { total: 3, headless: 2, noUserMessage: 1 });
  assert.deepEqual(thin19.report.sessions.skipped.map(item => item.reason), ['headless', 'headless', 'no-user-message']);
  assert.equal(dataOf(thin19).skippedNote, '3 session files were not read: 2 headless (run through the SDK), 1 with no user message.');
  // T4: no score: no thin line. The skipped line stays.
  assert.deepEqual([notAnalysed.report.health.score, notAnalysed.report.health.reason, short(notAnalysed), dataOf(notAnalysed).note], [null, 'not-analysed', [5, 0, 0, false], null]);
  assert.equal(dataOf(notAnalysed).skippedNote, dataOf(thin19).skippedNote);
  assert.deepEqual([noSessions.report.health.reason, short(noSessions), dataOf(noSessions).note, dataOf(noSessions).skippedNote], ['no-sessions', [0, 0, 0, false], null, null]);
  // T5: nothing skipped and not thin: no line, and no empty element.
  assert.deepEqual([dataOf(thin20).note, dataOf(thin20).skippedNote, dataOf(thin20).skipped], [null, null, { total: 0, headless: 0, noUserMessage: 0 }]);
  // Step 12: the page has no thin data line. The number area gives the state and the reason of health.v1
  // (test/e2e-step-12-b.test.mjs), and a closed part of the number area has the counts of the skipped files.
  for (const r of all) {
    assert.ok(!r.html.includes('data-skipped=') && !r.html.includes('class="hdata'), r.name);
    assert.deepEqual(dataLines(r.html), [], r.name);
    assert.ok(r.html.includes(`<section class="health" id="health" data-shown="${r.report.health.v1.shown}" data-method="v1"`), r.name);
  }
  // T3: the counts of the skipped files, in report.json and in the base detail of the page.
  assert.equal(thin19.report.health.counts.sessions.text, 'From 5 of 8 sessions (2 headless skipped, 1 with no user message)');
  assert.ok(thin19.html.includes('<details class="hother" id="base-detail"><summary>Sessions and dropped reads</summary><ul class="hlist hsess"><li data-sessions="analysed"><b>5</b><span>analysed: the score comes from these sessions</span></li>' +
    '<li data-sessions="headless"><b>2</b><span>headless (run through the SDK): the tool does not read them</span></li>' +
    '<li data-sessions="noUserMessage"><b>1</b><span>with no user message: the tool does not read them</span></li></ul>'));
  const sessionsOf = r => { const s = r.report.health.counts.sessions; return [s.analysed, s.total, s.read, s.notAnalysed, s.headless, s.noUserMessage, s.other]; };
  assert.deepEqual([thin19, thin20, thin2of5, notAnalysed, noSessions].map(sessionsOf), [[5, 8, 5, 0, 2, 1, 0], [5, 5, 5, 0, 0, 0, 0], [2, 5, 5, 3, 0, 0, 0], [0, 8, 5, 5, 2, 1, 0], [0, 0, 0, 0, 0, 0, 0]]);
  // T4: no data: the number area says "No data" with one reason line. The texts of the counts stay in report.json.
  assert.ok(notAnalysed.html.includes('<section class="health" id="health" data-shown="no-data" data-method="v1"'));
  assert.equal(notAnalysed.html.split('<p class="hreason"').length, 2);
  assert.equal(notAnalysed.report.health.counts.sessions.text, 'From 0 of 8 sessions (2 headless skipped, 1 with no user message, 5 not analysed)');
  assert.equal(notAnalysed.report.health.counts.noRoute.text, 'Needed files with no route: no data');
  assert.equal(row(notAnalysed.html, 'find').n, '0');
  // D17: the Sessions list of the page shows the same skipped line one time. The page data holds it.
  const pageData = JSON.parse(thin19.html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(pageData.health.data, dataOf(thin19));
  assert.equal(pageData.skipped.length, 3);
  assert.ok(thin19.html.includes("esc(DATA.health.data.skippedNote) + '</div>';"));
  // The prompt has the same 2 lines in section 1.
  assert.ok(sectionOf(thin19.report, 1).includes(`- ${dataOf(thin19).note}\n- ${dataOf(thin19).skippedNote}\n`));
  assert.ok(!sectionOf(thin20.report, 1).includes('Thin data') && !sectionOf(thin20.report, 1).includes('not read'));
  assert.ok(sectionOf(thin2of5.report, 1).includes('- Sessions: 5 read, 2 analysed.'));
});

// ---------- fault 9, the page line: how much the duplicate check read ----------

test('L3: the One source detail says how many files and how many needed files the model check read', () => {
  // The big file (250,000 characters) does not fit in the input of 240,000 characters. It is 1 of the 2 needed files.
  const part = big.report.health.parts.oneSource;
  const check = big.report.duplicates.check;
  assert.deepEqual([check.status, check.total - check.checked, check.needed, check.neededChecked], ['ok', 1, 2, 1]);
  assert.deepEqual(part.coverage, { checked: check.checked, total: check.total, needed: 2, neededChecked: 1 });
  const line = `The model check read ${check.checked} of ${check.total} files, and 1 of 2 needed files. The other files do not fit in one model call, so only their exact copies are checked.`;
  assert.deepEqual([part.checked, part.note], ['full', line]);
  // Step 11: the page does not show the One source detail any more. The note stays in report.json (above).
  // The page data still holds it, as a part of `health`.
  assert.ok(!big.html.includes('<p class="hnote">') && !big.html.includes('id="hd-oneSource"'));
  assert.ok(sectionOf(big.report, 4).includes(`Facts with different values in two or more instruction files (the model check read ${check.checked} of ${check.total} files):`));
  // The first run of BIG had no answer: the check failed, and the old note for exact copies stays.
  const failed = bigFailed.report.health.parts.oneSource;
  assert.deepEqual([bigFailed.report.duplicates.check.status, failed.checked, failed.note, failed.coverage.checked, failed.coverage.neededChecked],
    ['failed', 'exact-only', 'Only exact copies are checked. Run with --intents for the full check.', 0, 0]);
  assert.ok(sectionOf(bigFailed.report, 4).includes('Facts with different values in two or more instruction files (only exact copies checked, so no different value can show):'));
});

// ---------- the page ----------

test('D8, D14, P1: the Found detail: the groups, the told facts, and a closed part with the saved facts', () => {
  // Step 12: the page shows the items of health.v1 in place of the old Found detail (test/e2e-step-12-b.test.mjs has the
  // checks of the markup). The texts of the counts stay in report.json.
  const counts = main.report.health.counts;
  assert.deepEqual([counts.noRoute.files, counts.noRoute.text, counts.noRoute.base], [11, '11 needed files have no route', 'of 16 needed files']);
  assert.deepEqual([counts.told.facts, counts.told.text], [5, '5 facts you had to type (3 already saved)']);
  assert.ok(!main.html.includes('class="hsum"><b>Found'));
  // D8, P1: in each run, each detail is closed at rest, and no closed part is open.
  for (const r of all.filter(item => item.report.health.score != null)) {
    assert.ok(!/<details[^>]* open/.test(r.html), r.name);
    // Step 12: 4 questions, each with one closed detail.
    assert.deepEqual(r.html.match(/<div class="hd" id="hd-\w+" hidden>/g), ROWS.map(key => `<div class="hd" id="hd-${key}" hidden>`), r.name);
  }
});

test('G1, G2, G3, F12: the same files on each run, no change in the projects and the homes, no dash, no network', () => {
  // G1: two runs give the same bytes.
  assert.deepEqual(twice.map(item => item.name), ['main', 'agents', 'agents-off', 'bare', 'thin-5-20', 'big']);
  for (const item of twice) {
    assert.equal(item.second.json, item.first.json, `${item.name}: report.json`);
    assert.equal(item.second.html, item.first.html, `${item.name}: report.html`);
  }
  // G2: the tool writes nothing into a project or a settings home.
  assert.deepEqual(after, before);
  for (const r of all) {
    // G3, F12: no en dash and no em dash in the page, the prompt and each text of health.
    assert.ok(noDash(r.html) && noDash(r.report.prompt.text) && !/\\u201[34]/.test(r.html), r.name);
    for (const value of textsOf(r.report)) assert.ok(noDash(value), value);
    // The page rules of steps 8 and 9: 3 script elements, no network.
    assert.equal(r.html.match(/<script/g).length, 3, r.name);
    for (const bad of ['<link', 'src="http', 'fetch(', 'http://', 'https://']) assert.ok(!r.html.includes(bad), `${r.name}: ${bad}`);
    // No temporary path in health or in the prompt. A memory path holds the name of the project folder, not its place.
    const text = JSON.stringify({ health: r.report.health, prompt: r.report.prompt });
    assert.ok(!text.includes(work) && !text.includes(os.tmpdir()), r.name);
  }
});

test('Artifact: the health of each run', () => {
  const rows = all.map(r => {
    const h = r.report.health;
    const fix = fixesOf(r.report)[0] || '';
    return `| ${r.name} | ${h.score ?? 'none'} | ${h.parts.found.score ?? '-'} | ${h.parts.close.score ?? '-'} | ${h.parts.oneSource.score ?? '-'} | ${h.parts.found.answer ?? '-'} | ${h.parts.close.answer ?? '-'} | ` +
      `${[h.data.note, h.data.skippedNote].filter(Boolean).join(' ') || '-'} | ${fix.replaceAll(MEMORY, '<memory>').replaceAll('|', '/')} |`;
  });
  const table = ['# Step 10, worker D: the health of each run', '',
    'Each row is one run of the command on a project copy of this test. The memory folder of the run is `<memory>`.', '',
    '| Run | Score | Found | Close | One source | Can the agent find each file it needs? | Are the needed files close to the start? | Data lines | Fix 1 of the prompt |',
    '|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
  assert.ok(!table.includes(work) && !table.includes(os.homedir()));
  writeFileSync(path.join(artifact, 'health-cases.md'), table);
  // The pages for the browser check at 400 pixels (T7). They hold the temporary paths of this run, as each page does.
  writeFileSync(path.join(artifact, 'thin-data.html'), thin19.html);
  writeFileSync(path.join(artifact, 'root-item.html'), agentsOff.html);
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
  console.log(`Artifact: ${path.join(artifact, 'health-cases.md')}`);
});
