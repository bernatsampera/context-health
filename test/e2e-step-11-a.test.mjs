// E2E for step 11, part A (only real context files count): run the real command on git copies of
// fixtures/indoeuromap that hold the case files this file writes, with a copy of fixtures/claude-settings-home that
// holds the sessions and the memory files of this file, and a copy of the fake claude binary. No real model call.
// The ways it can fail are in the step 11 failure list (CF1 to CF29, CG1 to CG10, DR1 to DR8) and in the list of
// worker A (CF30 to CF42, CG11, CG12, DR9, DR10). Each test names its cases.
// Artifact: out/e2e-step-11-a/report.json and report.html (the main run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
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
const W1 = `${OLD}/.claude/worktrees/w1`;
const S = n => `8100000${n}-0000-0000-0000-000000000000`;
const [S1, S2, S3] = [1, 2, 3].map(S);
// The data/research files are git-ignored, also in this repo, so a git copy of the repo can miss them. Each project copy gets them.
const RESEARCH_FILES = ['europe-expansion-2026-10-20', 'growth-metrics-2026-10-21', 'wave-1-finish-2026-10-20'].map(name => `data/research/${name}/README.md`);
// A sentence of AGENTS.md of the fixture. `tests/copy.md` holds it word for word (CF27).
const COPY_SENTENCE = 'Do not commit, push, or deploy unless the owner asks for that action.';

const enc = folder => folder.replace(/[^A-Za-z0-9]/g, '-');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const append = (file, text) => writeFileSync(file, `${readFileSync(file, 'utf8')}${text}`);

// A hash of each file of a folder (not the git data), to prove that a run changes nothing. A symbolic link counts by its target.
function snapshot(dir) {
  const hash = createHash('sha256');
  const walk = rel => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      if (entry.name === '.git') continue;
      const child = path.join(rel, entry.name);
      if (entry.isSymbolicLink()) hash.update(child).update(readlinkSync(path.join(dir, child)));
      else if (entry.isDirectory()) walk(child);
      else hash.update(child).update(readFileSync(path.join(dir, child)));
    }
  };
  walk('');
  return hash.digest('hex');
}

// ---------- the projects ----------

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step11a-'));
const gitIn = dir => (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
// A copy of the fixture. `leave` names the root files that the copy does not get. `change` edits the copy before git sees it.
// `exclude` is the text of .git/info/exclude. `force` names the files that `git add -f` adds.
function makeProject(dir, { leave = [], change = () => {}, git = true, exclude = '', force = [] } = {}) {
  cpSync(fixture, dir, { recursive: true, filter: source => !leave.includes(path.relative(fixture, source)) });
  for (const rel of RESEARCH_FILES) if (!existsSync(path.join(dir, rel))) write(path.join(dir, rel), `# ${rel.split('/')[2]}\n\nLocal research record.\n`);
  change(dir);
  if (git) {
    gitIn(dir)('init', '-q');
    if (exclude) append(path.join(dir, '.git/info/exclude'), exclude);
    gitIn(dir)('add', '-A');
    for (const rel of force) gitIn(dir)('add', '-f', rel);
  }
  return dir;
}

// The case files of step 11. Each line names its case. `expectIn` and `expectOut` below give the result for each file.
function addCases(dir) {
  const w = (rel, text = `# ${rel}\n\nA note with the path ${rel}.\n`) => write(path.join(dir, rel), text);
  // CF3, CF8, CF4: 5 ignored places. `forced/index.md` is added with `git add -f`.
  append(path.join(dir, '.gitignore'), '\n# Step 11 cases\nwork/\nCLAUDE.local.md\n.claude/skills/local-skill/\nprivate/\nforced/\n');
  append(path.join(dir, 'CLAUDE.md'), [
    '', '## Step 11 cases', '',
    '- The notes start at [note a](notes/a.md). The second chain starts at [x2](notes/x2.md).',        // CF14, CF17
    '- The test notes are in [the test folder](tests/README.md). The local notes are in [work](work/linked.md).', // CF15, CF18
    '- The prompt templates are in [prompts](src/prompts/).',                                            // CF16
    '- A plain path does not count in a code folder: src/prompts/plain.md',                             // CF12
    '', '@private/rules.md', '@src/prompts/imported.md', ''                                              // CF8, CF12
  ].join('\n'));
  // CF13, CF35: a plain path and a Markdown link in AGENTS.md. The plain path to the prompt does not count.
  append(path.join(dir, 'AGENTS.md'), '\nThe plain note is notes/plain.md, and the linked note is [here](notes/link.md). A plain path to a prompt: src/prompts/linked.md\n');
  // CF1: test folders, at the root and deep in the tree. CF33: a folder name in upper case.
  w('tests/t.md', '# Test notes\n\nThe real notes are in docs/a.md. See [c](../notes/c.md).\n'); // DR6, CF14
  for (const rel of ['test/t.md', 'pkg/__tests__/t.md', 'e2e/t.md', 'fixtures/p/a.md', 'deep/a/b/tests/c/t.md', 'TestData/t.md', '__snapshots__/s.md', 'tests/w.md']) w(rel);
  // CF2: output folders.
  for (const rel of ['artifacts/run.md', 'dist/readme.md', 'out/report.md', 'coverage/c.md', 'build/b.md', 'tmp/t.md']) w(rel);
  // CF3, CF15: files that git ignores. A session reads the 3 first. CLAUDE.md links `work/linked.md`.
  for (const rel of ['work/notes.md', 'local/l.md', 'work/linked.md']) w(rel);
  w('forced/index.md'); // CF4
  // CF6: instruction files in a test folder, a fixture folder and a plain folder. CF9: a README with no link.
  for (const rel of ['tests/CLAUDE.md', 'fixtures/p/AGENTS.md', 'sub/CLAUDE.md', 'sub/AGENTS.md', 'sub/README.md', 'CONTRIBUTING.md']) w(rel);
  // CF7: the files of .claude/. Only the skill, the command, the agent and the rules count.
  w('.claude/notes.md');
  w('.claude/plans/p.md');
  w('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews a change.\n---\n\nReview the change.\n');
  w('.claude/rules/style.md', '# Style\n\nUse short sentences.\n');
  w('.claude/rules/cond.md', '---\npaths: src/**\n---\n\n# Source rule\n\nKeep each source file small.\n');
  // CF8, CF36: files that Claude Code loads by itself and that git ignores.
  w('CLAUDE.local.md', '# Local instructions\n\nThe local note is [here](notes/local.md).\n');
  w('.claude/skills/local-skill/SKILL.md', '---\nname: local-skill\ndescription: A skill that git ignores.\n---\n\nDo the local work.\n');
  w('private/rules.md', '# Private rules\n\nUse the private key.\n');
  w('notes/local.md');
  // CF10, CF23: docs folders. CF18: `docs/deep.md` has its only link in a test file.
  w('docs/a.md', '# Doc a\n\nThe prompt is [linked](../src/prompts/linked.md). The plain note is [plain](../notes/plain.md).\n'); // CF12, CF35
  for (const rel of ['docs/a.mdx', 'dev/now/b.md', 'packages/x/docs/c.md', 'src/docs/d.md', 'docs/deep.md', 'docs/old/o1.md', 'docs/old/o2.md', 'Doc/a.md']) w(rel);
  w('docs/review.md', '# Review\n\nThe review window is 9 days for each change.\n'); // CF26
  // CF11: index files.
  for (const rel of ['src/api/index.md', 'src/llms.txt', 'tests/index.md']) w(rel);
  // CF12: prompt templates in a code folder: no link, a plain path, a Markdown link, an @ import.
  for (const rel of ['src/prompts/p.md', 'src/prompts/plain.md', 'src/prompts/linked.md', 'src/prompts/imported.md']) w(rel);
  w('src/main.py', 'print("main")\n'); // CG10
  // CF13: documents in a plain folder. CF14, CF21: chains of links. CF17: 2 pairs of files that link each other.
  for (const rel of ['notes/none.md', 'notes/plain.md', 'notes/link.md', 'notes/b.md', 'notes/c.md', 'notes/m.md', 'aaa/earlier.md']) w(rel);
  w('notes/a.md', '# Note a\n\nNext: [b](b.md). Early: [early](../alpha/early.md).\n');
  w('alpha/early.md', '# Early\n\nSee [earlier](../aaa/earlier.md).\n');
  w('notes/x.md', '# x\n\n[y](y.md)\n');
  w('notes/y.md', '# y\n\n[x](x.md)\n');
  w('notes/x2.md', '# x2\n\n[y2](y2.md)\n');
  w('notes/y2.md', '# y2\n\n[x2](x2.md)\n');
  // CF15, CF18: a test file that CLAUDE.md links. Its link gives no route.
  w('tests/README.md', '# Tests\n\nThe deep doc is [deep](../docs/deep.md).\n');
  // DR7, CF26, CF27: test files with a fact, with the words of a correction, and with a copy of a sentence.
  w('tests/facts.md', '# Facts\n\nThe batch size is 40 cities for each run.\n');
  w('tests/notes.md', '# Notes\n\nThe review window is 9 days.\n');
  w('tests/written.md', '# Written\n\nThe review window is 9 days, as the user said.\n');
  w('tests/copy.md', `# Copy\n\n${COPY_SENTENCE}\n`);
  // CF30: a skill with the name of an output folder, and one with the name of a test folder.
  w('.claude/skills/build/SKILL.md', '---\nname: build\ndescription: Builds the site.\n---\n\nRead [the notes](notes.md).\n');
  w('.claude/skills/build/notes.md');
  w('.claude/skills/build/tests/t.md');
  w('.agents/skills/e2e/SKILL.md', '---\nname: e2e\ndescription: Runs the end to end check.\n---\n\nRun it.\n');
  // CF38, CF39: a skill folder that is a symbolic link to a folder of the project.
  w('.agents/skills/linked/SKILL.md', '---\nname: linked\ndescription: A skill behind a symbolic link.\n---\n\nRead [the commands](references/commands.md) before each run of the linked skill.\n');
  w('.agents/skills/linked/references/commands.md', '# Commands\n\nRun the linked skill with the flag for a dry run first.\n');
  symlinkSync('../../.agents/skills/linked', path.join(dir, '.claude/skills/linked'));
  // CF40: config files in a fixture folder and in a plain folder.
  w('fixtures/p/.mcp.json', '{ "mcpServers": {} }\n');
  w('sub/.mcp.json', '{ "mcpServers": {} }\n');
  // CG5, CG11: files for the globs. No file names them.
  for (const rel of ['glob-root.md', 'ga/a.md', 'ga/sub/c.md', 'gb/a.md', 'gb/sub/c.md', 'gb/sub/deep/d.md', 'gc/a.md', 'gc/ab.md', 'gd/x.md', 'gd/deep/y.md']) w(rel);
}

const P = makeProject(path.join(work, 'p', 'indoeuromap'), { change: addCases, exclude: '\n# Step 11 cases\nlocal/\n', force: ['forced/index.md'] });
const CLAUDE_P = readFileSync(path.join(P, 'CLAUDE.md'), 'utf8');

// N: no CLAUDE.md. AGENTS.md has an @ line to a prompt. A nested AGENTS.md in a plain folder and in a fixture folder.
// The root README has a name in lower case (CF23).
const N = makeProject(path.join(work, 'n', 'indoeuromap'), { leave: ['CLAUDE.md', 'README.md'], change: dir => {
  write(path.join(dir, 'readme.md'), readFileSync(path.join(fixture, 'README.md'), 'utf8'));
  append(path.join(dir, 'AGENTS.md'), '\n@src/prompts/agents-import.md\n');
  write(path.join(dir, 'src/prompts/agents-import.md'), '# A prompt\n');
  write(path.join(dir, 'sub2/AGENTS.md'), '# Sub rules\n');
  write(path.join(dir, 'fixtures/p/AGENTS.md'), '# Fixture rules\n');
  write(path.join(dir, 'docs/a.mdx'), '# An mdx doc\n');
} });

// No git: the tool walks the folder (CF5).
const NOGIT = makeProject(path.join(work, 'nogit', 'indoeuromap'), { git: false, change: dir => {
  write(path.join(dir, 'node_modules/x/README.md'), '# A package\n');
  write(path.join(dir, '.claude/worktrees/w1/docs/copy.md'), '# A worktree copy\n');
  write(path.join(dir, 'work/notes.md'), '# Notes\n');
  write(path.join(dir, 'tests/t.md'), '# Test notes\n');
} });

// ---------- the settings homes ----------

// The fixture settings home without its sessions: this file writes its own.
const settings = path.join(work, 'settings');
cpSync(repoSettings, settings, { recursive: true, filter: source => path.relative(repoSettings, source).split(path.sep)[0] !== 'projects' });
const userClaude = readFileSync(path.join(settings, 'CLAUDE.md'), 'utf8');
write(path.join(settings, 'plans/p.md'), '# A plan\n\nA plan file of the user.\n'); // CF19
write(path.join(settings, 'projects', '-Users-example-projects-other', 'memory', 'x.md'), '# A memory of another project\n'); // CF19

// The memory folder of P. `a.md` links a project file that no project file names (CF34).
const encP = enc(P);
const MEM = `~/.claude/projects/${encP}/memory`;
const memDir = path.join(settings, 'projects', encP, 'memory');
const memoryFiles = {
  'MEMORY.md': '# Memory index\n\n- [Alpha](a.md) - a linked memory\n',
  'a.md': '# Alpha\n\nThe memory note is [m](notes/m.md).\n'
};
for (const [name, text] of Object.entries(memoryFiles)) write(path.join(memDir, name), text);
// The path of a file of the settings home in a fake session: the fake home is the home of another machine, so the tool maps it to ~/.claude/.
const homeAbs = rel => `${HOME}/.claude/${rel}`;

// ---------- the sessions ----------

// Items: { cwd }, { user }, { agent }, { instructions: [...] }, { read: file path as the agent gave it, text },
// { edit: path }, { nested: path, text }.
function writeSession(folder, sessionId, start, cwd, items) {
  const dir = path.join(settings, 'projects', folder);
  mkdirSync(dir, { recursive: true });
  let k = 0;
  let now = cwd;
  const rec = extra => { k += 1; return { isSidechain: false, userType: 'external', cwd: now, sessionId, version: '2.1.300', gitBranch: 'main',
    entrypoint: 'cli', uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [];
  const tool = (name, input, content, toolUseResult) => {
    const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
    records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: toolId, name, input }], usage } }));
    records.push(rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content }] }, toolUseResult }));
  };
  for (const item of items) {
    if (item.cwd) now = item.cwd;
    if (item.instructions) records.push(rec({ type: 'attachment', attachment: { type: 'instructions', files: item.instructions } }));
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    if (item.nested != null) records.push(rec({ type: 'attachment', attachment: { type: 'nested_memory', path: item.nested, content: { path: item.nested, content: item.text } } }));
    if (item.read != null) {
      const count = item.text.split('\n').length;
      tool('Read', { file_path: item.read }, item.text, { type: 'text', file: { filePath: item.read, content: item.text, numLines: count, startLine: 1, totalLines: count } });
    }
    if (item.edit != null) tool('Edit', { file_path: item.edit, old_string: 'a', new_string: 'b' }, 'The file has been updated.', { filePath: item.edit });
  }
  writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}
const startOf = () => ({ instructions: [{ path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
  { path: `${OLD}/CLAUDE.md`, content: CLAUDE_P, type: 'Project' }] });
// A read of a project file with the text that is on disk now. A file that is not on disk gets a short text.
const readOf = (rel, root = OLD) => ({ read: `${root}/${rel}`, text: existsSync(path.join(P, rel)) ? readFileSync(path.join(P, rel), 'utf8') : `# ${rel}\n` });

// S1: 3 intents. The first reads files of each class. The second reads a prompt again. The third reads only a test file.
writeSession(MAIN, S1, '2026-11-22T10:00:00.000Z', OLD, [
  startOf(),
  { user: 'Check the notes and the test notes.' },
  readOf('tests/t.md'),                                   // a test file (DR1). Its text names docs/a.md (DR6)
  readOf('docs/a.md'),                                    // a need. The agent knew it from tests/t.md (DR6)
  readOf('src/prompts/p.md'),                             // a prompt in a code folder (DR1)
  readOf('src/prompts/p.md'),                             // a second read in the same intent (DR9)
  readOf('work/notes.md'),                                // in .gitignore (CF3)
  readOf('local/l.md'),                                   // in .git/info/exclude (CF3)
  readOf('tests/README.md'),                              // CLAUDE.md links it, and it stays out (CF15)
  readOf('work/linked.md'),                               // CLAUDE.md links it, and git ignores it (CF15)
  readOf('.mcp.json'),                                    // config files (CF20)
  readOf('.claude/settings.json'),
  readOf('CLAUDE.local.md'),                              // Claude Code loads these 3, and git ignores them (CF8)
  readOf('.claude/skills/local-skill/SKILL.md'),
  readOf('private/rules.md'),
  { nested: `${OLD}/tests/CLAUDE.md`, text: readFileSync(path.join(P, 'tests/CLAUDE.md'), 'utf8') }, // a load from a test folder (DR4)
  { nested: `${OLD}/sub/CLAUDE.md`, text: readFileSync(path.join(P, 'sub/CLAUDE.md'), 'utf8') },     // a load from a plain folder
  { read: homeAbs('plans/p.md'), text: '# A plan\n\nA plan file of the user.\n' },                    // CF19
  { read: homeAbs('projects/-Users-example-projects-other/memory/x.md'), text: '# A memory of another project\n' },
  { read: homeAbs('skills/unslop/SKILL.md'), text: readFileSync(path.join(settings, 'skills/unslop/SKILL.md'), 'utf8') },
  { read: homeAbs(`projects/${encP}/memory/a.md`), text: memoryFiles['a.md'] },
  readOf('tests/w.md', W1),                               // a worktree path of a test file (CF24)
  readOf('dev/now/b.md', W1),                             // a worktree path of a context file (CF24)
  readOf('notes/gone.md'),                                // not on disk now (CF31)
  readOf('tests/gone.md'),                                // not on disk now, in a test folder (CF31)
  readOf('src/main.py'),                                  // a code file
  readOf('TestData/t.md'),                                // a folder name in upper case (CF33)
  readOf('.claude/skills/linked/references/commands.md'), // a file of a skill behind a symbolic link (CF38)
  { agent: 'Done.' },
  { user: 'Now fix the prompt.' },
  readOf('src/prompts/p.md'),                             // the same prompt in a second intent (DR9)
  readOf('notes/none.md'),                                // no context file names it
  { agent: 'Fixed.' },
  { user: 'Read the test notes again.' },
  readOf('tests/t.md'),                                   // the only read of this intent (DR8)
  { agent: 'Read.' }
]);
// S2: 2 missing-context corrections. The agent read the fact of the first in a test file (DR7). The words of the
// second are in test files and in docs/review.md (CF26). The session writes a test file and a context file after it.
writeSession(MAIN, S2, '2026-11-22T11:00:00.000Z', OLD, [
  startOf(),
  { user: 'Set the batch size for the next run.' },
  readOf('tests/facts.md'),
  { agent: 'I set the batch size to 10.' },
  { user: 'No. The batch size is 40 cities for each run.' },
  { agent: 'Ok, 40.' },
  { user: 'And the review window is 9 days. Keep that in mind.' },
  { edit: `${OLD}/tests/written.md` },
  { edit: `${OLD}/docs/review.md` },
  { agent: 'Saved.' }
]);
// S3: one user message, so it is not analysed (DR5).
writeSession(MAIN, S3, '2026-11-22T12:00:00.000Z', OLD, [
  startOf(),
  { user: 'Look at the test notes.' },
  readOf('tests/t.md'),
  readOf('src/prompts/plain.md'),
  { agent: 'Done.' }
]);

// A settings home with the memory turned off (CF34). It keeps the sessions.
const settingsOff = path.join(work, 'settings-off');
cpSync(settings, settingsOff, { recursive: true });
writeFileSync(path.join(settingsOff, 'settings.json'), `${JSON.stringify({ autoMemoryEnabled: false }, null, 2)}\n`);
// A settings home where AGENTS.md does not load, so a project with no CLAUDE.md has no start file (CF25).
const settingsClaudeMd = path.join(work, 'settings-claude-md');
cpSync(repoSettings, settingsClaudeMd, { recursive: true });
writeFileSync(path.join(settingsClaudeMd, 'settings.json'),
  `${JSON.stringify({ pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md' } } } }, null, 2)}\n`);

// ---------- the fake binary, with one answer that this file writes ----------

const fakeRoot = path.join(work, 'fake');
const fake = path.join(fakeRoot, 'test', 'fake-claude.mjs');
mkdirSync(path.dirname(fake), { recursive: true });
copyFileSync(path.join(repo, 'test', 'fake-claude.mjs'), fake);
chmodSync(fake, 0o755);
const fakeAnswers = path.join(fakeRoot, 'fixtures', 'fake-claude');
cpSync(path.join(repo, 'fixtures', 'fake-claude'), fakeAnswers, { recursive: true });
// The id of the duplicates call is a hash of the file paths. A memory path holds the temp folder of this run, so the
// id is new on each run. The first run gives the id (its call fails), then this file writes the answer.
const DUPLICATES_ANSWER = { total_cost_usd: 0.02, result: { facts: [
  { what: 'The line limit of status.md', same: true, places: [
    { path: 'AGENTS.md', quote: 'Then replace `second-iteration/status.md` (60 lines maximum).', value: '60 lines' },
    { path: 'second-iteration/direction.md', quote: '60 lines maximum. Replace it, do not append.', value: '60 lines' }
  ] }
] } };

// ---------- the config files ----------

const configDir = path.join(work, 'config');
const configFile = (name, value) => { const file = path.join(configDir, `${name}.json`); write(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); return file; };
const CONFIGS = {
  empty: configFile('empty', {}),
  // CG3, CG6, CG10, CF37: include globs, and one file in both lists.
  include: configFile('include', { include: ['notes/**', 'work/**', 'src/**', 'tests/**'], exclude: ['notes/a.md'] }),
  // CG4, CG8, CF32, CF37: exclude globs. CLAUDE.md is a start load file.
  exclude: configFile('exclude', { exclude: ['docs/old/**', 'CLAUDE.md', 'notes/a.md', '.mcp.json', 'sub/CLAUDE.md'] }),
  // CG5: one glob for each form.
  globs: configFile('globs', { include: ['*.md', 'ga/*', 'gb/**', 'gc/?.md'] }),
  all: configFile('all', { include: ['**/*.md'] }),
  // CG11: `./` and `/` at the start, `/` at the end, and `**/` for a file at the root.
  forms: configFile('forms', { include: ['./gc/ab.md', '/ga/sub/*.md', 'gd/', '**/glob-root.md'] })
};
// CG1, CG2, CG12: config files that the command refuses.
write(path.join(P, 'cfg.json'), '{}\n');
gitIn(P)('add', '-A');
const BAD_CONFIGS = [
  { name: 'in the project', file: path.join(P, 'cfg.json'), message: /^The config file must be outside the project: / },
  { name: 'missing', file: path.join(configDir, 'missing.json'), message: /^Cannot read the config file: / },
  { name: 'a folder', file: configDir, message: /^Cannot read the config file: / },
  { name: 'not JSON', file: configFile('bad-json', '{'), message: /^The config file is not JSON: / },
  { name: 'a list', file: configFile('bad-list', '[]'), message: /^The config file must be a JSON object with the keys "include" and "exclude": / },
  { name: 'include is a text', file: configFile('bad-shape', { include: 'docs' }), message: /^"include" in the config file must be a list of globs: / },
  { name: 'a number in a list', file: configFile('bad-entry', { include: [1] }), message: /^"include" in the config file must be a list of globs: / },
  { name: 'an empty glob', file: configFile('bad-empty', { exclude: [''] }), message: /^"exclude" in the config file must be a list of globs: / },
  { name: 'an unknown key', file: configFile('bad-key', { includes: [] }), message: /^Unknown key "includes" in the config file \(the keys are "include" and "exclude"\): / }
];

// ---------- the runs ----------

const projects = { P, N };
const statusOf = dir => gitIn(dir)('status', '--porcelain', '--untracked-files=all', '--ignored');
const before = {
  status: Object.fromEntries(Object.entries(projects).map(([name, dir]) => [name, statusOf(dir)])),
  files: Object.fromEntries(Object.entries({ ...projects, NOGIT }).map(([name, dir]) => [name, snapshot(dir)])),
  homes: Object.fromEntries(Object.entries({ settings, settingsOff, settingsClaudeMd, repoSettings }).map(([name, dir]) => [name, snapshot(dir)]))
};

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const twice = [];
// One run of the real command. With `again`, a second run with the same cache: both reports must be the same.
// `cache` names the cache folder: the config runs use the cache of the main run, so they make no call.
function run(name, root, { home = repoSettings, old = false, intents = false, again = false, out2 = null, config = null, cache = name } = {}) {
  const once = out => {
    const args = [cli, root, '--claude-settings-home', home, '--out', out, '--cache', path.join(work, 'cache', cache), '--no-open', '--no-save'];
    if (old) args.push('--old-path', OLD);
    if (intents) args.push('--intents');
    if (config) args.push('--config', config);
    const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    return { json: readFileSync(path.join(out, 'report.json'), 'utf8'), html: readFileSync(path.join(out, 'report.html'), 'utf8'), stdout: result.stdout };
  };
  const first = once(path.join(work, 'out', `${name}-1`));
  if (again) {
    if (out2) mkdirSync(out2, { recursive: true });
    const second = once(out2 || path.join(work, 'out', `${name}-2`));
    twice.push({ name, first, second });
  }
  return { ...first, report: JSON.parse(first.json) };
}
// The first run finds the id of the duplicates call. No answer is there yet, so the call fails and nothing is cached for it.
const pre = run('pre', P, { home: settings, old: true, intents: true, cache: 'main' });
const duplicateIds = [...new Set(calls().map(call => call.stdin.split('\n', 1)[0].match(/^context-health duplicates \S+ session (run-[0-9a-f]{12})$/)?.[1]).filter(Boolean))];
if (duplicateIds.length === 1) writeFileSync(path.join(fakeAnswers, `${duplicateIds[0]}.duplicates.json`), `${JSON.stringify(DUPLICATES_ANSWER, null, 2)}\n`);
const artifact = path.join(repo, 'out', 'e2e-step-11-a');
const main = run('main', P, { home: settings, old: true, intents: true, again: true, out2: artifact });
const off = run('off', P, { home: settingsOff, old: true, cache: 'main' });
const withConfig = Object.fromEntries(Object.entries(CONFIGS).map(([name, file]) => [name, run(`config-${name}`, P, { home: settings, old: true, config: file, cache: 'main', again: name === 'include' })]));
const noClaude = run('noclaude', N, { again: true });
const noStart = run('nostart', N, { home: settingsClaudeMd, again: true });
const noGit = run('nogit', NOGIT, { again: true });
// The runs that the command must refuse: [status, stderr, report written].
const refused = BAD_CONFIGS.map(item => {
  const out = path.join(work, 'out', `bad-${item.name.replace(/[^a-z]+/g, '-')}`);
  const result = spawnSync('node', [cli, P, '--claude-settings-home', settings, '--old-path', OLD, '--out', out, '--cache', path.join(work, 'cache', 'bad'), '--no-open', '--no-save', '--config', item.file],
    { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake } });
  return { ...item, status: result.status, stderr: result.stderr, written: existsSync(path.join(out, 'report.json')) || existsSync(path.join(out, 'report.html')) };
});

// ---------- what the rule must give for the case files of P ----------

// The context files: path -> why. `linkedFrom` is checked for each linked file.
const expectIn = {
  // Check 6: the allow list.
  'CLAUDE.md': 'instructions', 'AGENTS.md': 'instructions', 'frontend/CLAUDE.md': 'instructions',
  'sub/CLAUDE.md': 'instructions', 'sub/AGENTS.md': 'instructions',                                  // CF6
  '.claude/agents/reviewer.md': 'claude-folder', '.claude/rules/style.md': 'claude-folder', '.claude/rules/cond.md': 'claude-folder', // CF7
  '.claude/skills/city-batch/SKILL.md': 'claude-folder', '.claude/commands/brief.md': 'claude-folder',
  '.claude/skills/build/SKILL.md': 'claude-folder', '.claude/skills/build/notes.md': 'claude-folder', '.agents/skills/e2e/SKILL.md': 'claude-folder', // CF30
  '.agents/skills/linked/SKILL.md': 'claude-folder', '.agents/skills/linked/references/commands.md': 'claude-folder',
  'README.md': 'root-doc', 'CONTRIBUTING.md': 'root-doc',                                            // CF9
  'docs/a.md': 'docs-folder', 'dev/now/b.md': 'docs-folder', 'packages/x/docs/c.md': 'docs-folder', // CF10
  'docs/a.mdx': 'docs-folder', 'Doc/a.md': 'docs-folder', 'docs/deep.md': 'docs-folder',            // CF23, CF33, CF18
  'docs/old/o1.md': 'docs-folder', 'docs/old/o2.md': 'docs-folder', 'docs/review.md': 'docs-folder',
  'src/api/index.md': 'index', 'src/llms.txt': 'index', 'forced/index.md': 'index',                  // CF11, CF4
  // Check 3: Claude Code loads the file by itself. Git ignores the first 5 (CF8, CF38).
  'CLAUDE.local.md': 'instructions', '.claude/skills/local-skill/SKILL.md': 'claude-folder', 'private/rules.md': 'start-load',
  '.claude/skills/linked/SKILL.md': 'claude-folder', '.claude/skills/linked/references/commands.md': 'claude-folder',
  'src/prompts/imported.md': 'start-load',                                                           // CF12
  '.mcp.json': 'start-load', '.claude/settings.json': 'start-load', 'sub/.mcp.json': 'start-load',  // CF20, CF32, CF40
  // Check 7: a context file names the file.
  'src/prompts/linked.md': 'linked',                                                                 // CF12
  'notes/plain.md': 'linked', 'notes/link.md': 'linked',                                             // CF13
  'notes/a.md': 'linked', 'notes/b.md': 'linked',                                                    // CF14
  'notes/x2.md': 'linked', 'notes/y2.md': 'linked',                                                  // CF17
  'alpha/early.md': 'linked', 'aaa/earlier.md': 'linked',                                            // CF21
  'notes/local.md': 'linked', 'notes/m.md': 'linked'                                                 // CF36, CF34
};
const expectLinker = {
  'src/prompts/linked.md': 'docs/a.md', 'notes/plain.md': 'AGENTS.md', 'notes/link.md': 'AGENTS.md', 'notes/a.md': 'CLAUDE.md',
  'notes/b.md': 'notes/a.md', 'notes/x2.md': 'CLAUDE.md', 'notes/y2.md': 'notes/x2.md', 'alpha/early.md': 'notes/a.md',
  'aaa/earlier.md': 'alpha/early.md', 'notes/local.md': 'CLAUDE.local.md', 'notes/m.md': `${MEM}/a.md`
};
// The candidates that are out: path -> reason. This is each file of `contextRules.excluded` of the main run.
const expectOut = {
  // CF1, CF33, CF6, CF11, CF30, CF40: test folders.
  'tests/t.md': 'test', 'test/t.md': 'test', 'pkg/__tests__/t.md': 'test', 'e2e/t.md': 'test', 'fixtures/p/a.md': 'test',
  'deep/a/b/tests/c/t.md': 'test', 'TestData/t.md': 'test', '__snapshots__/s.md': 'test', 'tests/w.md': 'test',
  'tests/CLAUDE.md': 'test', 'fixtures/p/AGENTS.md': 'test', 'tests/index.md': 'test', 'tests/README.md': 'test',
  'tests/facts.md': 'test', 'tests/notes.md': 'test', 'tests/written.md': 'test', 'tests/copy.md': 'test',
  '.claude/skills/build/tests/t.md': 'test', 'fixtures/p/.mcp.json': 'test',
  // CF2: output folders.
  'artifacts/run.md': 'output', 'dist/readme.md': 'output', 'out/report.md': 'output', 'coverage/c.md': 'output', 'build/b.md': 'output', 'tmp/t.md': 'output',
  // CF3, CF15: git ignores the file. The 3 research files are files of the fixture that a context file links.
  'work/notes.md': 'ignored', 'local/l.md': 'ignored', 'work/linked.md': 'ignored',
  ...Object.fromEntries(RESEARCH_FILES.map(rel => [rel, 'ignored'])),
  // CF10, CF12: a code folder, and no link that counts.
  'src/docs/d.md': 'code-folder', 'src/prompts/p.md': 'code-folder', 'src/prompts/plain.md': 'code-folder',
  // CF7, CF9, CF13, CF14, CF17: no context file names the file. The 2 `data/` files are files of the fixture.
  '.claude/notes.md': 'not-linked', '.claude/plans/p.md': 'not-linked', 'sub/README.md': 'not-linked',
  'notes/none.md': 'not-linked', 'notes/c.md': 'not-linked', 'notes/x.md': 'not-linked', 'notes/y.md': 'not-linked',
  'glob-root.md': 'not-linked', 'ga/a.md': 'not-linked', 'ga/sub/c.md': 'not-linked', 'gb/a.md': 'not-linked', 'gb/sub/c.md': 'not-linked',
  'gb/sub/deep/d.md': 'not-linked', 'gc/a.md': 'not-linked', 'gc/ab.md': 'not-linked', 'gd/x.md': 'not-linked', 'gd/deep/y.md': 'not-linked',
  'data/_index.data.md': 'not-linked', 'data/spain/madrid/_index.madrid.md': 'not-linked'
};

// ---------- helpers for the checks ----------

const R = main.report;
const fileOf = (report, rel) => {
  const found = report.map.files.filter(entry => entry.path === rel);
  assert.equal(found.length, 1, `${rel} is in map.files one time`);
  return found[0];
};
const onMap = (report, rel) => report.map.files.some(entry => entry.path === rel);
const contextOf = (report, rel) => report.contextFiles.find(file => file.path === rel) || null;
const whyOf = (report, rel) => contextOf(report, rel)?.why ?? null;
const reasonOf = (report, rel) => report.contextRules.excluded.find(file => file.path === rel)?.reason ?? null;
const needsOf = (report, id) => report.needs.sessions.find(entry => entry.sessionId === id).intents.flatMap(intent => intent.needs);
const intentOf = (report, id, intentId) => report.needs.sessions.find(entry => entry.sessionId === id).intents.find(intent => intent.intentId === intentId);
const droppedOf = (report, rel) => report.needs.dropped.list.find(item => item.path === rel) || null;
const pageData = html => JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);
// The stdin of the calls of one task for one session id (or run id).
const inputsOf = (task, id) => calls().map(call => call.stdin).filter(stdin => new RegExp(`^context-health ${task} \\S+ session ${id}$`).test(stdin.split('\n', 1)[0]));

// The start load reads the instruction files of each folder above a project. A stray file above the temp folder
// would change each result here, so say it first.
test('the folders above the temp folder have no instruction file', () => {
  assert.ok(!work.startsWith(`${os.homedir()}${path.sep}`), 'the temp folder is not under the home folder');
  for (let dir = work; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/CLAUDE.md', '.claude/AGENTS.md']) {
      assert.ok(!existsSync(path.join(dir, name)), `${path.join(dir, name)} changes the start load of each test project`);
    }
  }
});

// ---------- the allow list and the folders that are always out ----------

test('CF1, CF2, CF33: a Markdown file in a test folder or in an output folder is out, at the root and deep in the tree', () => {
  for (const [rel, reason] of Object.entries(expectOut).filter(([, why]) => why === 'test' || why === 'output')) {
    assert.equal(reasonOf(R, rel), reason, rel);
    assert.equal(contextOf(R, rel), null, `${rel} is not in contextFiles`);
    const file = fileOf(R, rel);
    assert.deepEqual([file.context, file.kind, file.why], [false, 'excluded', reason], rel);
  }
  // CF33: the folder name compares in lower case.
  assert.equal(reasonOf(R, 'TestData/t.md'), 'test');
  assert.equal(whyOf(R, 'Doc/a.md'), 'docs-folder');
});

test('CF3, CF4: a file that git ignores is out and not on the map, also when a session read it. A tracked file counts', () => {
  // `work/` is in .gitignore, `local/` is in .git/info/exclude. Session S1 read both files.
  for (const rel of ['work/notes.md', 'local/l.md']) {
    assert.equal(reasonOf(R, rel), 'ignored', rel);
    assert.ok(!onMap(R, rel), `${rel} is not a map file (step 10 put it on the map)`);
    assert.equal(contextOf(R, rel), null);
    assert.deepEqual([droppedOf(R, rel).reason, droppedOf(R, rel).needs], ['ignored', 1], rel);
  }
  // CF4: `forced/` is in .gitignore, but `git add -f` added the file, so git lists it.
  assert.ok(gitIn(P)('ls-files').split('\n').includes('forced/index.md'));
  assert.deepEqual([whyOf(R, 'forced/index.md'), fileOf(R, 'forced/index.md').ignored], ['index', false]);
});

test('CF5: with no git no file is ignored, and node_modules and the worktree folders are not read', () => {
  const report = noGit.report;
  assert.equal(report.listing.method, 'walk');
  assert.ok(!report.contextRules.excluded.some(file => file.reason === 'ignored'));
  assert.equal(report.contextRules.counts.byReason.ignored, undefined);
  assert.ok(!report.map.files.some(file => file.ignored));
  for (const part of ['node_modules/', '.claude/worktrees/']) {
    assert.ok(!report.map.files.some(file => file.path.includes(part)), part);
    assert.ok(!report.contextRules.excluded.some(file => file.path.includes(part)), part);
  }
  // The files that git ignores in the other projects are plain files here: the rule decides by the path and the links.
  assert.equal(reasonOf(report, 'work/notes.md'), 'not-linked');
  assert.equal(reasonOf(report, 'tests/t.md'), 'test');
  // The research files are in `data/`, and a context file links each: they are in.
  for (const rel of RESEARCH_FILES) assert.equal(whyOf(report, rel), 'linked', rel);
});

test('CF6: an instruction file in a test or fixture folder is out and not in `later`', () => {
  assert.deepEqual([reasonOf(R, 'tests/CLAUDE.md'), reasonOf(R, 'fixtures/p/AGENTS.md')], ['test', 'test']);
  assert.deepEqual([whyOf(R, 'sub/CLAUDE.md'), whyOf(R, 'sub/AGENTS.md')], ['instructions', 'instructions']);
  const nested = report => report.later.filter(item => item.what === 'nested instructions').map(item => item.path);
  // P has a CLAUDE.md, so a nested AGENTS.md does not load.
  assert.deepEqual(nested(R), ['frontend/CLAUDE.md', 'sub/CLAUDE.md']);
  // N has no CLAUDE.md, so AGENTS.md files load: the one in a plain folder is in `later`, the one in a fixture folder is not.
  assert.deepEqual(nested(noClaude.report), ['frontend/CLAUDE.md', 'sub2/AGENTS.md']);
  assert.equal(reasonOf(noClaude.report, 'fixtures/p/AGENTS.md'), 'test');
  // The file stays a map file, as a file that is out.
  assert.deepEqual([fileOf(R, 'tests/CLAUDE.md').context, fileOf(R, 'tests/CLAUDE.md').kind, fileOf(R, 'tests/CLAUDE.md').why], [false, 'excluded', 'test']);
});

test('CF7: of the files of .claude/, only the skills, the commands, the agents and the rules count', () => {
  for (const rel of ['.claude/agents/reviewer.md', '.claude/rules/style.md', '.claude/rules/cond.md', '.claude/skills/city-batch/SKILL.md', '.claude/commands/brief.md']) {
    assert.equal(whyOf(R, rel), 'claude-folder', rel);
  }
  assert.deepEqual([reasonOf(R, '.claude/notes.md'), reasonOf(R, '.claude/plans/p.md')], ['not-linked', 'not-linked']);
});

test('CF8, CF36: a file that Claude Code loads by itself is a context file, also when git ignores it', () => {
  const ignored = gitIn(P)('status', '--porcelain', '--ignored').split('\n').filter(line => line.startsWith('!! ')).map(line => line.slice(3));
  for (const part of ['CLAUDE.local.md', '.claude/skills/local-skill/', 'private/']) assert.ok(ignored.includes(part), `git ignores ${part}`);
  const local = fileOf(R, 'CLAUDE.local.md');
  assert.deepEqual([local.context, local.kind, local.why, local.ignored, local.reach], [true, 'instructions', 'instructions', true, 'start']);
  const skill = fileOf(R, '.claude/skills/local-skill/SKILL.md');
  assert.deepEqual([skill.context, skill.kind, skill.why, skill.ignored, skill.steps, skill.via], [true, 'skill', 'claude-folder', true, 1, 'trigger']);
  const imported = fileOf(R, 'private/rules.md');
  assert.deepEqual([imported.context, imported.kind, imported.why, imported.ignored, imported.reach, imported.via], [true, 'doc', 'start-load', true, 'start', 'import']);
  // A read of each is a need.
  const needs = needsOf(R, S1);
  assert.deepEqual(['CLAUDE.local.md', '.claude/skills/local-skill/SKILL.md', 'private/rules.md'].map(rel => needs.find(need => need.path === rel)?.state),
    ['in_context', 'path', 'in_context']);
  for (const rel of ['CLAUDE.local.md', '.claude/skills/local-skill/SKILL.md', 'private/rules.md']) assert.equal(droppedOf(R, rel), null, rel);
  // CF36: the links of an ignored start file are edges, so the file it names is in, 1 step away.
  const note = fileOf(R, 'notes/local.md');
  assert.deepEqual([note.why, note.steps, note.linkedFrom.map(item => item.path)], ['linked', 1, ['CLAUDE.local.md']]);
});

test('CF9, CF10, CF11, CF23: the root documents, the docs folders and the index files', () => {
  assert.deepEqual([whyOf(R, 'README.md'), whyOf(R, 'CONTRIBUTING.md'), reasonOf(R, 'sub/README.md')], ['root-doc', 'root-doc', 'not-linked']);
  assert.deepEqual(['docs/a.md', 'dev/now/b.md', 'packages/x/docs/c.md'].map(rel => whyOf(R, rel)), ['docs-folder', 'docs-folder', 'docs-folder']);
  assert.equal(reasonOf(R, 'src/docs/d.md'), 'code-folder', 'a docs folder below a code folder does not count');
  assert.deepEqual([whyOf(R, 'src/api/index.md'), whyOf(R, 'src/llms.txt'), reasonOf(R, 'tests/index.md')], ['index', 'index', 'test']);
  // CF23: an .mdx file, and a root README with a name in lower case.
  assert.deepEqual([whyOf(R, 'docs/a.mdx'), contextOf(R, 'docs/a.mdx').kind], ['docs-folder', 'doc']);
  assert.ok(gitIn(N)('ls-files').split('\n').includes('readme.md'));
  assert.deepEqual([whyOf(noClaude.report, 'readme.md'), whyOf(noClaude.report, 'docs/a.mdx')], ['root-doc', 'docs-folder']);
});

test('CF12, CF13, CF16, CF35: in a code folder only a Markdown link or an @ import counts, in a plain folder a plain path counts too', () => {
  // CF12: no link, a plain path in CLAUDE.md, a Markdown link in docs/a.md, an @ import in CLAUDE.md.
  assert.equal(reasonOf(R, 'src/prompts/p.md'), 'code-folder');
  assert.equal(reasonOf(R, 'src/prompts/plain.md'), 'code-folder');
  assert.ok(fileOf(R, 'src/prompts/plain.md').linkedFrom.some(item => item.path === 'CLAUDE.md' && item.via === 'mention'), 'the plain path is still an edge of the map');
  assert.deepEqual([whyOf(R, 'src/prompts/linked.md'), contextOf(R, 'src/prompts/linked.md').linkedFrom], ['linked', 'docs/a.md']);
  const imported = fileOf(R, 'src/prompts/imported.md');
  assert.deepEqual([imported.why, imported.reach, imported.steps], ['start-load', 'start', 0]);
  assert.ok(R.startLoad.some(item => item.what === 'import' && item.path === 'src/prompts/imported.md'));
  // CF13: no name, a plain path in AGENTS.md, a Markdown link in AGENTS.md.
  assert.equal(reasonOf(R, 'notes/none.md'), 'not-linked');
  assert.deepEqual([whyOf(R, 'notes/plain.md'), whyOf(R, 'notes/link.md')], ['linked', 'linked']);
  assert.ok(fileOf(R, 'notes/plain.md').linkedFrom.some(item => item.path === 'AGENTS.md' && item.via === 'mention'));
  // CF16: the folder link gives each file of src/prompts/ a route, but it brings no file in.
  const folder = fileOf(R, 'src/prompts/p.md');
  assert.deepEqual([folder.context, folder.via, folder.linkedFrom.map(item => `${item.path} ${item.via}`)], [false, 'folder', ['CLAUDE.md folder']]);
  // CF35: `linkedFrom` is the first context file by path that names the file in a way that counts for it.
  assert.equal(contextOf(R, 'notes/plain.md').linkedFrom, 'AGENTS.md', 'AGENTS.md (a plain path) comes before docs/a.md (a link)');
  assert.ok(fileOf(R, 'src/prompts/linked.md').linkedFrom.some(item => item.path === 'AGENTS.md' && item.via === 'mention'));
  assert.equal(contextOf(R, 'src/prompts/linked.md').linkedFrom, 'docs/a.md', 'the plain path in AGENTS.md does not count for a file in a code folder');
});

test('CF14, CF15, CF17, CF18: the link rule repeats, and a file that is out is not a source of links and does not come back', () => {
  // CF14: CLAUDE.md > notes/a.md > notes/b.md. tests/t.md links notes/c.md, and a test file is not a source.
  assert.deepEqual(['notes/a.md', 'notes/b.md'].map(rel => [whyOf(R, rel), fileOf(R, rel).steps]), [['linked', 1], ['linked', 2]]);
  assert.equal(reasonOf(R, 'notes/c.md'), 'not-linked');
  assert.deepEqual(fileOf(R, 'notes/c.md').linkedFrom, []);
  // CF15: CLAUDE.md links a test file and an ignored file. Both stay out, and both are map files with a route.
  const test1 = fileOf(R, 'tests/README.md');
  assert.deepEqual([test1.context, test1.kind, test1.why, test1.ignored, test1.steps], [false, 'excluded', 'test', false, 1]);
  const linked = fileOf(R, 'work/linked.md');
  assert.deepEqual([linked.context, linked.kind, linked.why, linked.ignored, linked.steps], [false, 'excluded', 'ignored', true, 1]);
  assert.deepEqual([droppedOf(R, 'tests/README.md').reason, droppedOf(R, 'work/linked.md').reason], ['test', 'ignored']);
  // CF17: 2 files that link each other, with no named file above them, are out. With one link from CLAUDE.md, both are in.
  assert.deepEqual([reasonOf(R, 'notes/x.md'), reasonOf(R, 'notes/y.md')], ['not-linked', 'not-linked']);
  assert.deepEqual([whyOf(R, 'notes/x2.md'), whyOf(R, 'notes/y2.md')], ['linked', 'linked']);
  assert.deepEqual([fileOf(R, 'notes/x2.md').steps, fileOf(R, 'notes/y2.md').steps], [1, 2]);
  // CF18: the only link to docs/deep.md is in tests/README.md. The file is a context file with no route.
  const deep = fileOf(R, 'docs/deep.md');
  assert.deepEqual([deep.context, deep.why, deep.reach, deep.steps, deep.linkedFrom], [true, 'docs-folder', 'none', null, []]);
  assert.ok(!R.map.files.some(file => file.linkedFrom.some(item => expectOut[item.path])), 'no edge starts at a file that is out');
});

test('CF19: of the files of ~/.claude/, only the skills, commands, agents, rules and the memory of the project can be needs', () => {
  const other = '~/.claude/projects/-Users-example-projects-other/memory/x.md';
  assert.deepEqual([droppedOf(R, '~/.claude/plans/p.md'), droppedOf(R, other)],
    [{ path: '~/.claude/plans/p.md', reason: 'user-other', needs: 1, reads: 1 }, { path: other, reason: 'user-other', needs: 1, reads: 1 }]);
  const needs = needsOf(R, S1);
  assert.ok(!needs.some(need => need.path === '~/.claude/plans/p.md' || need.path === other));
  const skill = needs.find(need => need.path === '~/.claude/skills/unslop/SKILL.md');
  assert.deepEqual([skill.scope, skill.fileKind, skill.state], ['user', 'skill body', 'path']);
  const memory = needs.find(need => need.path === `${MEM}/a.md`);
  assert.deepEqual([memory.scope, memory.fileKind, memory.map.steps], ['user', 'memory', 1]);
  // The map class of a file outside the project.
  assert.deepEqual([fileOf(R, `${MEM}/a.md`).why, fileOf(R, `${MEM}/MEMORY.md`).why, fileOf(R, '~/.claude/skills/unslop/SKILL.md').why], ['memory', 'memory', 'user']);
});

test('CF20, CF32, CF40: the config files are context files, and a read of one is not a need and not a dropped read', () => {
  for (const rel of ['.mcp.json', '.claude/settings.json']) {
    assert.deepEqual(contextOf(R, rel), { path: rel, kind: 'config', tokens: fileOf(R, rel).tokens, why: 'start-load' }, rel);
    assert.ok(!needsOf(R, S1).some(need => need.path === rel), `${rel} is not a need`);
    assert.equal(droppedOf(R, rel), null, `${rel} is not a dropped read`);
  }
  // CF40: a .mcp.json in a plain folder stays a config file. One in a fixture folder is out.
  assert.deepEqual([whyOf(R, 'sub/.mcp.json'), contextOf(R, 'sub/.mcp.json').kind, reasonOf(R, 'fixtures/p/.mcp.json')], ['start-load', 'config', 'test']);
  // The 2 reads are code reads of the intent, as in step 10.
  assert.equal(intentOf(R, S1, 'i1').otherReads.codeFiles, 3, '.mcp.json, .claude/settings.json and src/main.py');
  // CF32: an exclude glob takes a config file out. A read of it is still not a need and not a dropped read.
  const report = withConfig.exclude.report;
  assert.deepEqual([reasonOf(report, '.mcp.json'), fileOf(report, '.mcp.json').kind], ['config-exclude', 'excluded']);
  assert.equal(droppedOf(report, '.mcp.json'), null);
  assert.ok(!needsOf(report, S1).some(need => need.path === '.mcp.json'));
});

test('CF21, CF22: the same result on each run, sorted by path, and the totals agree', () => {
  // CF21: aaa/earlier.md and alpha/early.md come before their linker notes/a.md in path order.
  assert.deepEqual([whyOf(R, 'aaa/earlier.md'), whyOf(R, 'alpha/early.md')], ['linked', 'linked']);
  assert.deepEqual([fileOf(R, 'alpha/early.md').steps, fileOf(R, 'aaa/earlier.md').steps], [2, 3]);
  for (const item of [main, off, noClaude, noStart, noGit, ...Object.values(withConfig)]) {
    const report = item.report;
    const paths = report.contextFiles.map(file => file.path);
    assert.deepEqual(paths, [...paths].sort(cmp));
    const out = report.contextRules.excluded.map(file => file.path);
    assert.deepEqual(out, [...out].sort(cmp));
    // CF22
    const counts = report.contextRules.counts;
    assert.equal(report.totals.contextFiles, report.contextFiles.length);
    assert.equal(report.totals.contextTokens, sum(report.contextFiles, 'tokens'));
    assert.deepEqual([counts.context, counts.excluded, counts.candidates], [report.contextFiles.length, out.length, report.contextFiles.length + out.length]);
    assert.equal(Object.values(counts.byWhy).reduce((total, n) => total + n, 0), counts.context);
    assert.equal(Object.values(counts.byReason).reduce((total, n) => total + n, 0), counts.excluded);
    for (const [why, n] of Object.entries(counts.byWhy)) assert.equal(n, report.contextFiles.filter(file => file.why === why).length, why);
    for (const [reason, n] of Object.entries(counts.byReason)) assert.equal(n, report.contextRules.excluded.filter(file => file.reason === reason).length, reason);
    // The context files are the project files of the map with `context: true`. No path is in both lists.
    assert.deepEqual(paths, report.map.files.filter(file => file.context && !file.path.startsWith('~/')).map(file => file.path));
    assert.ok(!paths.some(rel => out.includes(rel)));
    // Each map file that is out is in the list, with the same reason.
    for (const file of report.map.files.filter(entry => entry.kind === 'excluded')) assert.equal(reasonOf(report, file.path), file.why, file.path);
  }
});

test('CF1 to CF18, CF22: the rule gives each case file of P its class, and no other candidate is out', () => {
  for (const [rel, why] of Object.entries(expectIn)) assert.equal(whyOf(R, rel), why, rel);
  for (const [rel, linker] of Object.entries(expectLinker)) assert.equal(contextOf(R, rel).linkedFrom, linker, rel);
  for (const file of R.contextFiles) assert.equal('linkedFrom' in file, file.why === 'linked', file.path);
  assert.deepEqual(Object.fromEntries(R.contextRules.excluded.map(file => [file.path, file.reason])),
    Object.fromEntries(Object.entries(expectOut).sort((a, b) => cmp(a[0], b[0]))));
  // The key order and the order of the counts.
  assert.deepEqual(Object.keys(R.contextRules), ['config', 'counts', 'excluded']);
  assert.deepEqual(Object.keys(R.contextRules.counts), ['candidates', 'context', 'excluded', 'byWhy', 'byReason']);
  assert.deepEqual(Object.keys(R.contextRules.counts.byWhy), ['start-load', 'instructions', 'claude-folder', 'root-doc', 'docs-folder', 'index', 'linked']);
  assert.deepEqual(Object.keys(R.contextRules.counts.byReason), ['ignored', 'test', 'output', 'code-folder', 'not-linked']);
  assert.deepEqual(Object.keys(contextOf(R, 'README.md')), ['path', 'kind', 'tokens', 'why']);
  assert.deepEqual(Object.keys(contextOf(R, 'notes/a.md')), ['path', 'kind', 'tokens', 'why', 'linkedFrom']);
});

test('CF24: a read in a worktree is checked with its main path', () => {
  assert.deepEqual(droppedOf(R, 'tests/w.md'), { path: 'tests/w.md', reason: 'test', needs: 1, reads: 1 });
  const need = needsOf(R, S1).find(item => item.path === 'dev/now/b.md');
  assert.deepEqual([need.fileKind, need.exists, need.map.reach], ['doc', true, 'none']);
  assert.ok(!JSON.stringify(R.needs).includes('worktrees/'));
});

test('CF25: the second run of the map, with the virtual CLAUDE.md, does not change the set of context files', () => {
  const report = noStart.report;
  assert.ok(!report.startLoad.some(item => item.scope === 'project' && item.what === 'instructions'));
  // On the second map the virtual CLAUDE.md imports AGENTS.md, so the @ line of AGENTS.md is an import of the prompt.
  assert.deepEqual(report.map.virtualStart.imports, ['AGENTS.md']);
  assert.ok(report.map.virtualStart.reached.some(item => item.path === 'src/prompts/agents-import.md' && item.steps === 0));
  // The real run has no such import, so the prompt is out.
  const prompt = fileOf(report, 'src/prompts/agents-import.md');
  assert.deepEqual([prompt.context, prompt.kind, prompt.why, prompt.reach], [false, 'excluded', 'code-folder', 'none']);
  assert.equal(contextOf(report, 'src/prompts/agents-import.md'), null);
  assert.ok(!onMap(report, 'CLAUDE.md') && contextOf(report, 'CLAUDE.md') == null);
  // The same project where AGENTS.md loads: the same context files.
  assert.deepEqual(report.contextFiles, noClaude.report.contextFiles);
  assert.deepEqual(report.contextRules, noClaude.report.contextRules);
});

test('CF26, DR7: the told fact check keeps the texts the agent had, and its "Files now" part has only context files', () => {
  const inputs = inputsOf('needs-check', S2);
  assert.equal(inputs.length, 1, 'one check call for S2, then the cache');
  const input = inputs[0];
  const [hadPart, nowPart] = [input.slice(0, input.indexOf('\nFiles now: ')), input.slice(input.indexOf('\nFiles now: '))];
  // DR7: the agent read tests/facts.md before the correction. The file is out, but its text is in "Files the agent had".
  assert.ok(hadPart.includes('Files the agent had: ~/.claude/CLAUDE.md, CLAUDE.md, tests/facts.md'));
  assert.ok(hadPart.includes('## File tests/facts.md\n# Facts\n\nThe batch size is 40 cities for each run.'));
  const [c1, c2] = needsOf(R, S2).filter(need => need.kind !== 'file');
  assert.deepEqual([c1.kind, c1.checkResult, c1.path, c1.sourceQuote], ['had', 'had', 'tests/facts.md', 'The batch size is 40 cities for each run.']);
  // CF26: the words of the second correction are in 3 test files and in docs/review.md. The session wrote one test
  // file and docs/review.md after the correction. Only the context file is a file of today.
  const now = [...nowPart.matchAll(/^## File now (.+)$/gm)].map(match => match[1]);
  assert.ok(now.includes('docs/review.md'));
  assert.equal(now[0], 'docs/review.md', 'the file that the session wrote comes first');
  for (const rel of now) assert.ok(rel.startsWith('~/') || contextOf(R, rel), `${rel} is a context file`);
  for (const rel of ['tests/notes.md', 'tests/written.md', 'tests/facts.md', 'tests/copy.md']) assert.ok(!now.includes(rel), rel);
  // The fake answer names tests/notes.md as the place of today. The file is not in the input, so the fact is not saved.
  assert.deepEqual([c2.kind, c2.checkResult, c2.savedPath, c2.savedQuote], ['missing', 'not-found', null, null]);
  for (const report of [main.report, off.report, ...Object.values(withConfig).map(item => item.report)]) {
    for (const entry of report.needs.sessions) {
      for (const need of entry.intents.flatMap(intent => intent.needs)) assert.ok(need.savedPath == null || !reasonOf(report, need.savedPath), need.savedPath);
    }
  }
});

test('CF27, CF39: the duplicate check reads no file that is out, and one file with 2 paths one time', () => {
  assert.equal(duplicateIds.length, 1, 'one run id for the duplicates call');
  assert.equal(pre.report.duplicates.check.status, 'failed', 'the first run has no answer yet');
  const inputs = inputsOf('duplicates', duplicateIds[0]);
  const input = inputs.at(-1);
  const files = [...input.matchAll(/^### FILE (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([R.duplicates.check.status, R.duplicates.check.checked, R.duplicates.check.total], ['ok', files.length, files.length]);
  // CF27: the sentence is in AGENTS.md and in tests/copy.md. The test file is not read.
  assert.ok(readFileSync(path.join(P, 'AGENTS.md'), 'utf8').includes(COPY_SENTENCE) && readFileSync(path.join(P, 'tests/copy.md'), 'utf8').includes(COPY_SENTENCE));
  for (const rel of files) assert.ok(rel.startsWith('~/') || (contextOf(R, rel) && contextOf(R, rel).kind !== 'config'), `${rel} is a context file`);
  assert.ok(!files.some(rel => expectOut[rel]));
  assert.ok(!input.includes('### FILE tests/copy.md'));
  for (const fact of R.duplicates.facts) {
    for (const place of fact.places) assert.ok(place.path.startsWith('~/') || contextOf(R, place.path), `${fact.id} ${place.path}`);
    assert.ok(!fact.places.some(place => place.quote.includes('Do not commit, push, or deploy')), 'no copy of the sentence');
  }
  assert.ok(R.duplicates.facts.some(fact => fact.source === 'model' && fact.what === 'The line limit of status.md'));
  // CF39: .agents/skills/linked/ and .claude/skills/linked/ are one folder on disk. Each file is read one time:
  // the path with a route stays (the Claude Code path, or the path with a use).
  assert.equal(lstatSync(path.join(P, '.claude/skills/linked')).isSymbolicLink(), true);
  assert.ok(files.includes('.claude/skills/linked/SKILL.md') && !files.includes('.agents/skills/linked/SKILL.md'));
  assert.ok(files.includes('.claude/skills/linked/references/commands.md') && !files.includes('.agents/skills/linked/references/commands.md'));
  assert.ok(!R.duplicates.facts.some(fact => fact.places.some(place => place.path.includes('skills/linked/'))), 'no sentence of the skill is a copy of itself');
});

test('CF28: the page map has no box for a file that is out', () => {
  const ids = pageData(main.html).map.nodes.map(node => node.id);
  for (const rel of Object.keys(expectOut)) assert.ok(!ids.includes(rel), rel);
  assert.ok(!R.routes.map.nodes.some(node => expectOut[node.id]));
  // A context file with no route is in the lane at the bottom. The config files have no box, as before.
  assert.ok(ids.includes('docs/deep.md') && ids.includes('notes/a.md'));
  assert.ok(!ids.includes('.mcp.json'));
});

test('CF30: the name of a skill is not a test or output folder', () => {
  assert.deepEqual(['.claude/skills/build/SKILL.md', '.claude/skills/build/notes.md', '.agents/skills/e2e/SKILL.md'].map(rel => whyOf(R, rel)),
    ['claude-folder', 'claude-folder', 'claude-folder']);
  assert.equal(reasonOf(R, '.claude/skills/build/tests/t.md'), 'test', 'a test folder below the skill folder is still out');
  assert.deepEqual([fileOf(R, '.claude/skills/build/SKILL.md').steps, fileOf(R, '.claude/skills/build/notes.md').steps], [1, 2]);
});

test('CF31: for a file that is not on disk now, only the path decides', () => {
  assert.ok(!existsSync(path.join(P, 'notes/gone.md')) && !existsSync(path.join(P, 'tests/gone.md')));
  const gone = needsOf(R, S1).find(need => need.path === 'notes/gone.md');
  assert.deepEqual([gone.exists, gone.map, gone.state], [false, null, 'gone']);
  assert.deepEqual(droppedOf(R, 'tests/gone.md'), { path: 'tests/gone.md', reason: 'test', needs: 1, reads: 1 });
  assert.equal(droppedOf(R, 'notes/gone.md'), null);
  // A file that is not on disk is not a candidate, so it is in no list.
  assert.ok(!reasonOf(R, 'tests/gone.md') && !contextOf(R, 'notes/gone.md') && !onMap(R, 'tests/gone.md'));
});

test('CF34: a memory file is a source of links, so the file it names is in. With the memory off the file is out', () => {
  assert.deepEqual(contextOf(R, 'notes/m.md'), { path: 'notes/m.md', kind: 'doc', tokens: fileOf(R, 'notes/m.md').tokens, why: 'linked', linkedFrom: `${MEM}/a.md` });
  assert.equal(fileOf(R, 'notes/m.md').steps, 2, 'the index, then a.md, then the note');
  assert.equal(reasonOf(off.report, 'notes/m.md'), 'not-linked');
  assert.ok(!off.report.map.files.some(file => file.path.startsWith(MEM)));
  // No other file changes with the memory.
  assert.deepEqual(off.report.contextFiles, R.contextFiles.filter(file => file.path !== 'notes/m.md'));
  assert.ok(!R.contextFiles.some(file => file.path.startsWith('~/')), 'a memory file is not a context file of the project');
});

test('CF38: a file in the folder of a skill that Claude Code loads is not ignored, also behind a symbolic link', () => {
  // Git lists the link, and no file behind it.
  const listed = gitIn(P)('ls-files').split('\n');
  assert.ok(listed.includes('.claude/skills/linked') && !listed.some(rel => rel.startsWith('.claude/skills/linked/')));
  assert.ok(R.later.some(item => item.what === 'skill body' && item.path === '.claude/skills/linked/SKILL.md'));
  const body = fileOf(R, '.claude/skills/linked/SKILL.md');
  assert.deepEqual([body.context, body.kind, body.why, body.ignored, body.steps, body.via], [true, 'skill', 'claude-folder', true, 1, 'trigger']);
  const reference = fileOf(R, '.claude/skills/linked/references/commands.md');
  assert.deepEqual([reference.context, reference.why, reference.ignored, reference.steps, reference.linkedFrom.map(item => item.path)],
    [true, 'claude-folder', true, 2, ['.claude/skills/linked/SKILL.md']]);
  const need = needsOf(R, S1).find(item => item.path === '.claude/skills/linked/references/commands.md');
  assert.deepEqual([need.exists, need.ignored, need.map.steps], [true, true, 2]);
  assert.equal(droppedOf(R, '.claude/skills/linked/references/commands.md'), null);
});

// ---------- the config file ----------

test('CG1, CG2, CG12: a config file that is in the project, is missing, or has a wrong shape stops the command', () => {
  for (const item of refused) {
    assert.equal(item.status, 1, `${item.name}: exit code`);
    assert.match(item.stderr, item.message, item.name);
    assert.equal(item.stderr.trim().split('\n').length, 1, `${item.name}: one line, no stack trace`);
    assert.ok(item.stderr.trim().endsWith(item.file), `${item.name}: the line names the file`);
    assert.equal(item.written, false, `${item.name}: no report`);
  }
  assert.deepEqual(refused.map(item => item.name), ['in the project', 'missing', 'a folder', 'not JSON', 'a list', 'include is a text', 'a number in a list', 'an empty glob', 'an unknown key']);
  // The help text names the option.
  const help = spawnSync('node', [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--config <file> +a JSON file outside the project: \{ "include": \[globs\], "exclude": \[globs\] \}\./);
});

test('CG3, CG6, CG10: include brings a file in as a named file, exclude wins, and a code file stays a code file', () => {
  const report = withConfig.include.report;
  // CG3: files with no link, and the ignored folder that a session read.
  for (const rel of ['notes/none.md', 'notes/c.md', 'notes/x.md', 'work/notes.md', 'work/linked.md', 'tests/t.md', 'src/prompts/p.md', 'src/docs/d.md']) {
    assert.deepEqual([whyOf(report, rel), fileOf(report, rel).context, fileOf(report, rel).kind], ['config', true, 'doc'], rel);
    assert.equal('linkedFrom' in contextOf(report, rel), false, `${rel} is a named file`);
  }
  assert.deepEqual([fileOf(report, 'work/notes.md').ignored, fileOf(report, 'work/linked.md').ignored, fileOf(report, 'tests/t.md').ignored], [true, true, false]);
  // The config class comes before the place and before a link.
  assert.deepEqual([whyOf(report, 'src/api/index.md'), whyOf(report, 'src/llms.txt'), whyOf(report, 'notes/plain.md'), whyOf(report, 'src/prompts/imported.md')],
    ['config', 'config', 'config', 'config']);
  // A read of an included file is a need. The session read work/notes.md, tests/t.md and src/prompts/p.md.
  const needs = needsOf(report, S1).map(need => need.path);
  for (const rel of ['work/notes.md', 'work/linked.md', 'tests/t.md', 'src/prompts/p.md', 'notes/none.md', 'tests/README.md']) {
    assert.ok(needs.includes(rel), `${rel} is a need`);
    assert.equal(droppedOf(report, rel), null, rel);
  }
  // A file of an ignored folder that no session read and no file links is not seen, as before.
  assert.equal(droppedOf(report, 'local/l.md').reason, 'ignored');
  // An included file is a source of links: tests/t.md links notes/c.md (in by the config too), tests/README.md gives docs/deep.md a route.
  assert.deepEqual([fileOf(report, 'docs/deep.md').steps, fileOf(report, 'docs/deep.md').linkedFrom.map(item => item.path)], [2, ['tests/README.md']]);
  // CG6: notes/a.md is in both lists. Exclude wins. Its link to notes/b.md is gone, but the include glob keeps notes/b.md.
  assert.deepEqual([reasonOf(report, 'notes/a.md'), fileOf(report, 'notes/a.md').kind, whyOf(report, 'notes/b.md')], ['config-exclude', 'excluded', 'config']);
  // CG10: of src/, only the Markdown files and llms.txt come in.
  assert.deepEqual([fileOf(report, 'src/main.py').context, fileOf(report, 'src/main.py').kind, fileOf(report, 'src/main.py').why], [false, 'code', null]);
  assert.ok(report.contextFiles.filter(file => file.path.startsWith('src/')).every(file => /\.md$|llms\.txt$/.test(file.path)));
  assert.ok(!report.contextRules.excluded.some(file => file.path.startsWith('src/')));
  // CF37: a nested instruction file in a test folder that the config includes is in `later` again.
  assert.equal(whyOf(report, 'tests/CLAUDE.md'), 'config');
  assert.ok(report.later.some(item => item.what === 'nested instructions' && item.path === 'tests/CLAUDE.md'));
  assert.equal(needsOf(report, S1).find(need => need.path === 'tests/CLAUDE.md').how, 'nested');
});

test('CG4, CG8, CF37: exclude takes a file out, but not a start load file. A file that only the excluded file links goes out too', () => {
  const report = withConfig.exclude.report;
  assert.deepEqual([reasonOf(report, 'docs/old/o1.md'), reasonOf(report, 'docs/old/o2.md')], ['config-exclude', 'config-exclude']);
  assert.deepEqual([fileOf(report, 'docs/old/o1.md').context, fileOf(report, 'docs/old/o1.md').kind], [false, 'excluded']);
  // CLAUDE.md is in the start load, so the glob does not take it out.
  assert.deepEqual([whyOf(report, 'CLAUDE.md'), fileOf(report, 'CLAUDE.md').reach], ['instructions', 'start']);
  // CG8: notes/a.md was the only linker of notes/b.md and of alpha/early.md. They are out, and so is the next file of the chain.
  assert.equal(reasonOf(report, 'notes/a.md'), 'config-exclude');
  assert.deepEqual(['notes/b.md', 'alpha/early.md', 'aaa/earlier.md'].map(rel => reasonOf(report, rel)), ['not-linked', 'not-linked', 'not-linked']);
  // CF37: a nested instruction file that the config excludes is not in `later`.
  assert.equal(reasonOf(report, 'sub/CLAUDE.md'), 'config-exclude');
  assert.ok(!report.later.some(item => item.path === 'sub/CLAUDE.md'));
  assert.equal(droppedOf(report, 'sub/CLAUDE.md').reason, 'config-exclude', 'the load of the session is a dropped read');
  assert.deepEqual(Object.keys(report.contextRules.counts.byReason), ['config-exclude', 'ignored', 'test', 'output', 'code-folder', 'not-linked']);
});

test('CG5, CG11: `*` and `?` stay in one folder, `**` crosses folders, and a glob starts at the project root', () => {
  const config = (report, paths) => paths.map(rel => whyOf(report, rel) === 'config');
  // CG5: `*.md`, `ga/*`, `gb/**`, `gc/?.md`.
  const globs = withConfig.globs.report;
  assert.deepEqual(config(globs, ['glob-root.md', 'README.md', 'AGENTS.md', 'CLAUDE.md']), [true, true, true, true], '*.md matches the files of the root');
  assert.deepEqual(config(globs, ['notes/none.md', 'docs/a.md', 'gd/x.md']), [false, false, false], '*.md does not cross a folder');
  assert.deepEqual(config(globs, ['ga/a.md', 'ga/sub/c.md']), [true, false], 'ga/* matches one level');
  assert.deepEqual(config(globs, ['gb/a.md', 'gb/sub/c.md', 'gb/sub/deep/d.md']), [true, true, true], 'gb/** matches each level');
  assert.deepEqual(config(globs, ['gc/a.md', 'gc/ab.md']), [true, false], '? is one character');
  // `**/*.md`: each Markdown file that the tool sees, at the root too. A start load file that the glob matches is `config`.
  const all = withConfig.all.report;
  assert.deepEqual(all.contextRules.excluded.filter(file => file.path.endsWith('.md')), []);
  assert.deepEqual(config(all, ['glob-root.md', 'tests/t.md', 'deep/a/b/tests/c/t.md', 'work/notes.md', 'src/prompts/p.md', 'docs/a.mdx', 'src/llms.txt']),
    [true, true, true, true, true, false, false]);
  assert.deepEqual(all.contextRules.excluded, [{ path: 'fixtures/p/.mcp.json', reason: 'test' }]);
  // CG11
  const forms = withConfig.forms.report;
  assert.deepEqual(config(forms, ['gc/ab.md', 'gc/a.md', 'ga/sub/c.md', 'ga/a.md', 'gd/x.md', 'gd/deep/y.md', 'glob-root.md', 'gb/a.md']),
    [true, false, true, false, true, true, true, false]);
});

test('CG7, CG9: the report names the config, and an empty config changes nothing else', () => {
  assert.equal(R.contextRules.config, null);
  assert.deepEqual([R.groups.status, R.duplicates.check.status, R.needs.sessions.find(entry => entry.sessionId === S2).check.status], ['ok', 'ok', 'ok']);
  const empty = withConfig.empty.report;
  assert.deepEqual(empty.contextRules.config, { path: CONFIGS.empty, include: [], exclude: [] });
  assert.deepEqual(withConfig.include.report.contextRules.config, { path: CONFIGS.include, include: ['notes/**', 'work/**', 'src/**', 'tests/**'], exclude: ['notes/a.md'] });
  // CG9: the same report as the main run. The main run made the model calls, so the cost of the 2 runs is the same.
  assert.deepEqual({ ...empty, contextRules: { ...empty.contextRules, config: null } }, R);
  assert.equal(withConfig.empty.html, main.html);
});

// ---------- dropped reads ----------

test('DR1, DR3, DR8, DR10: a read of a file that is out is not a need, and it is not a code read', () => {
  const [i1, i2, i3] = ['i1', 'i2', 'i3'].map(id => intentOf(R, S1, id));
  assert.deepEqual(i1.needs.map(need => `${need.id} ${need.path} ${need.state}`), [
    'n1 docs/a.md no_path',
    'n2 CLAUDE.local.md in_context',
    'n3 .claude/skills/local-skill/SKILL.md path',
    'n4 private/rules.md in_context',
    'n5 sub/CLAUDE.md path',
    'n6 ~/.claude/skills/unslop/SKILL.md path',
    `n7 ${MEM}/a.md path`,
    'n8 dev/now/b.md no_path',
    'n9 notes/gone.md gone',
    'n10 .claude/skills/linked/references/commands.md path'
  ]);
  // DR3: 10 dropped files in the first intent, 12 dropped reads (src/prompts/p.md 2 times). The code reads are the 2 config files and src/main.py.
  const tokensOf = paths => sum(R.sessions.list.find(session => session.sessionId === S1).events.filter(event => event.message === 1 && paths.includes(event.path)), 'tokens');
  const dropped1 = ['tests/t.md', 'src/prompts/p.md', 'work/notes.md', 'local/l.md', 'tests/README.md', 'work/linked.md', 'tests/CLAUDE.md',
    '~/.claude/plans/p.md', '~/.claude/projects/-Users-example-projects-other/memory/x.md', 'tests/w.md', 'tests/gone.md', 'TestData/t.md'];
  assert.deepEqual(i1.otherReads, { codeFiles: 3, codeTokens: tokensOf(['.mcp.json', '.claude/settings.json', 'src/main.py']), outsideFiles: 0, outsideTokens: 0,
    searches: 0, misses: 0, excludedFiles: dropped1.length, excludedTokens: tokensOf(dropped1) });
  assert.ok(i1.otherReads.excludedTokens > 0);
  assert.deepEqual(Object.keys(i1.otherReads), ['codeFiles', 'codeTokens', 'outsideFiles', 'outsideTokens', 'searches', 'misses', 'excludedFiles', 'excludedTokens']);
  assert.deepEqual([i2.needs.length, i2.otherReads.excludedFiles, i2.otherReads.codeFiles], [0, 2, 0]);
  // DR8: the third intent reads only tests/t.md. It has no need, and no step counts it.
  assert.deepEqual([i3.needs, i3.totals, i3.otherReads.excludedFiles], [[], { fileNeeds: 0, missing: 0, had: 0 }, 1]);
  const scored = R.score.sessions.find(entry => entry.sessionId === S1).intentScores.find(intent => intent.intentId === 'i3');
  assert.deepEqual([scored.score, scored.reason], [null, 'needs-no-context']);
  assert.deepEqual(R.routes.intents.find(intent => intent.sessionId === S1 && intent.intentId === 'i3').needs, []);
  // DR1: no need, no route, no health item and no line of the prompt names a dropped file.
  const dropped = R.needs.dropped.list.map(item => item.path);
  // A `had` need names the file where the agent had the fact. That file can be a file that is out (DR7).
  const needPaths = R.needs.sessions.flatMap(entry => entry.intents.flatMap(intent => intent.needs.filter(need => need.kind === 'file').map(need => need.path)));
  for (const rel of dropped) {
    assert.ok(!needPaths.includes(rel), `${rel} is not a file need`);
    assert.ok(!R.routes.intents.some(intent => intent.needs.some(need => need.path === rel)), `${rel} is not a route need`);
    assert.ok(!R.routes.map.nodes.some(node => node.id === rel), `${rel} is not a map node`);
    assert.ok(!JSON.stringify(R.health).includes(JSON.stringify(rel)), `${rel} is not in health`);
    assert.ok(!R.prompt.text.includes(rel), `${rel} is not in the prompt`);
    assert.ok(!JSON.stringify(R.score).includes(JSON.stringify(rel)), `${rel} is not in the score`);
  }
});

test('DR2, DR9: needs.dropped has the totals, the count for each reason and each file', () => {
  const dropped = R.needs.dropped;
  assert.deepEqual(Object.keys(R.needs), ['promptVersion', 'sessions', 'dropped', 'taskFacts']); // step 12: `taskFacts`
  assert.deepEqual(Object.keys(dropped), ['needs', 'reads', 'files', 'byReason', 'list']);
  const other = '~/.claude/projects/-Users-example-projects-other/memory/x.md';
  // Sorted by needs (high first), then reads, then path. DR9: src/prompts/p.md has 2 intents and 3 reads.
  assert.deepEqual(dropped.list, [
    { path: 'src/prompts/p.md', reason: 'code-folder', needs: 2, reads: 3 },
    { path: 'tests/t.md', reason: 'test', needs: 2, reads: 2 },
    { path: 'TestData/t.md', reason: 'test', needs: 1, reads: 1 },
    { path: 'local/l.md', reason: 'ignored', needs: 1, reads: 1 },
    { path: 'notes/none.md', reason: 'not-linked', needs: 1, reads: 1 },
    { path: 'tests/CLAUDE.md', reason: 'test', needs: 1, reads: 1 },
    { path: 'tests/README.md', reason: 'test', needs: 1, reads: 1 },
    { path: 'tests/facts.md', reason: 'test', needs: 1, reads: 1 },
    { path: 'tests/gone.md', reason: 'test', needs: 1, reads: 1 },
    { path: 'tests/w.md', reason: 'test', needs: 1, reads: 1 },
    { path: 'work/linked.md', reason: 'ignored', needs: 1, reads: 1 },
    { path: 'work/notes.md', reason: 'ignored', needs: 1, reads: 1 },
    { path: '~/.claude/plans/p.md', reason: 'user-other', needs: 1, reads: 1 },
    { path: other, reason: 'user-other', needs: 1, reads: 1 }
  ]);
  assert.deepEqual(dropped.byReason, {
    ignored: { needs: 3, reads: 3, files: 3 },
    test: { needs: 8, reads: 8, files: 7 },
    'code-folder': { needs: 2, reads: 3, files: 1 },
    'not-linked': { needs: 1, reads: 1, files: 1 },
    'user-other': { needs: 2, reads: 2, files: 2 }
  });
  assert.deepEqual([dropped.needs, dropped.reads, dropped.files], [16, 17, 14]);
  for (const key of ['needs', 'reads', 'files']) assert.equal(sum(Object.values(dropped.byReason), key), dropped[key], key);
  assert.deepEqual([sum(dropped.list, 'needs'), sum(dropped.list, 'reads'), dropped.list.length], [dropped.needs, dropped.reads, dropped.files]);
  // The sum over the intents is the same.
  const intents = R.needs.sessions.flatMap(entry => entry.intents);
  assert.equal(sum(intents.map(intent => intent.otherReads), 'excludedFiles'), dropped.needs);
});

test('DR4, DR5: a nested load from a test folder is a dropped read, and a session that is not analysed adds none', () => {
  const s1 = R.sessions.list.find(session => session.sessionId === S1);
  const loads = s1.events.filter(event => event.kind === 'load').map(event => `${event.how} ${event.path}`);
  assert.deepEqual(loads, ['nested tests/CLAUDE.md', 'nested sub/CLAUDE.md']);
  assert.deepEqual(droppedOf(R, 'tests/CLAUDE.md'), { path: 'tests/CLAUDE.md', reason: 'test', needs: 1, reads: 1 });
  const nested = needsOf(R, S1).find(need => need.path === 'sub/CLAUDE.md');
  assert.deepEqual([nested.how, nested.reads, nested.state], ['nested', 0, 'path']);
  // DR5: S3 has one user message. It read tests/t.md and src/prompts/plain.md.
  assert.equal(R.intents.sessions.find(entry => entry.sessionId === S3).status, 'single-message');
  assert.ok(R.sessions.list.find(session => session.sessionId === S3).events.some(event => event.path === 'src/prompts/plain.md'));
  assert.ok(!R.needs.sessions.some(entry => entry.sessionId === S3));
  assert.equal(droppedOf(R, 'src/prompts/plain.md'), null);
  assert.equal(droppedOf(R, 'tests/t.md').needs, 2, 'only the 2 intents of S1');
});

test('DR6: a needed file that the agent knew from a file that is out keeps its route', () => {
  const need = needsOf(R, S1).find(item => item.path === 'docs/a.md');
  assert.deepEqual(need.knownFrom, { kind: 'file', path: 'tests/t.md', message: null, event: null });
  const routed = R.routes.intents.find(intent => intent.sessionId === S1 && intent.intentId === 'i1').needs.find(item => item.path === 'docs/a.md');
  assert.deepEqual(routed.route, [{ path: 'tests/t.md', how: 'none' }, { path: 'docs/a.md', how: 'link' }]);
  // The file that is out has no box, so the page has no edge from it.
  const data = pageData(main.html);
  assert.ok(!data.map.nodes.some(node => node.id === 'tests/t.md'));
  assert.ok(!data.map.edges.some(edge => edge.from === 'tests/t.md' || edge.to === 'tests/t.md'));
});

// ---------- all cases ----------

test('CF21: two runs give the same report and the same page', () => {
  assert.deepEqual(twice.map(item => item.name), ['main', 'config-include', 'noclaude', 'nostart', 'nogit']);
  for (const { name, first, second } of twice) {
    assert.equal(first.json, second.json, `${name}: report.json`);
    assert.equal(first.html, second.html, `${name}: report.html`);
  }
  // The second run of main makes no call: each answer is in the cache.
  assert.equal(inputsOf('duplicates', duplicateIds[0]).length, 3, '2 tries of the first run, then 1 call');
  assert.equal(inputsOf('intents', S1).length, 1);
});

test('CF42: no run writes into a project or into a settings home', () => {
  for (const [name, dir] of Object.entries(projects)) assert.equal(statusOf(dir), before.status[name], `git status of ${name}`);
  for (const [name, dir] of Object.entries({ ...projects, NOGIT })) assert.equal(snapshot(dir), before.files[name], `files of ${name}`);
  for (const [name, dir] of Object.entries({ settings, settingsOff, settingsClaudeMd, repoSettings })) assert.equal(snapshot(dir), before.homes[name], `files of ${name}`);
});

test('CF41: the key order of the report: contextRules after contextFiles, why after kind', () => {
  const keys = Object.keys(R);
  assert.deepEqual(keys.slice(0, keys.indexOf('sessions') + 1),
    ['project', 'claudeSettingsHome', 'tokenMethod', 'listing', 'totals', 'startLoad', 'later', 'contextFiles', 'contextRules', 'map', 'sessions']);
  for (const item of [main, noStart, noGit]) {
    for (const file of item.report.map.files) {
      assert.deepEqual(Object.keys(file), ['path', 'context', 'kind', 'why', 'tokens', 'ignored', 'reach', 'steps', 'pathTokens', 'via', 'route', 'linkedFrom'], file.path);
      // A code file has no class. Each other file has one.
      assert.equal(file.why == null, file.kind === 'code', file.path);
      assert.equal(file.context, file.kind !== 'code' && file.kind !== 'excluded', file.path);
    }
  }
  assert.match(main.stdout, new RegExp(`${R.totals.contextFiles} context files`));
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});
