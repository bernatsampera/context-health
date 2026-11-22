// E2E for step 10, part A (worktree paths, the start load, the map): run the real command on git copies of
// fixtures/indoeuromap, with copies of fixtures/claude-settings-home that hold the sessions and the memory files this
// file writes, and the fake claude binary test/fake-claude.mjs. No real model call.
// The ways it can fail are in the step 10 failure list (W, M, A, the map data of R and F, G) and in the list of
// worker A (W14 to W19, M15 to M19, A8 to A14, E1 to E3, N1 to N3, V1, V2). Each test names its cases.
// Artifact: out/e2e-step-10-a/report.json and report.html (the main run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fake = path.join(repo, 'test', 'fake-claude.mjs');
const fixture = path.join(repo, 'fixtures', 'indoeuromap');
const repoSettings = path.join(repo, 'fixtures', 'claude-settings-home');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-indoeuromap';
const WT_OLD = `${MAIN}--worktrees-fix-city`;
const WT1 = `${MAIN}--claude-worktrees-w1`;
const WT2 = `${MAIN}--claude-worktrees-w2`;
const W1 = `${OLD}/.claude/worktrees/w1`;
const W2 = `${OLD}/.claude/worktrees/w2`;
const AGENT_WT = `${OLD}/.claude/worktrees/agent-a1`;
const S = n => `9200000${n}-0000-0000-0000-000000000000`;
const [S1, S2, S3, S4] = [1, 2, 3, 4].map(S);
const D = '44444444-0000-0000-0000-000000000000';
const RESEARCH = 'data/research/growth-metrics-2026-10-21/README.md';
// The data/research files are git-ignored, also in this repo, so a git copy of the repo can miss them. Each project copy gets them.
const RESEARCH_FILES = ['data/research/europe-expansion-2026-10-20/README.md', RESEARCH, 'data/research/wave-1-finish-2026-10-20/README.md'];
const FALLBACK = 'AGENTS.md (no CLAUDE.md in the project folder or above it)';
const BOTH = 'AGENTS.md (setting: CLAUDE.md and AGENTS.md)';
const MEMORY_VIA = 'auto memory index (the first 200 lines or 25 KB)';

const enc = folder => folder.replace(/[^A-Za-z0-9]/g, '-');
const tok = text => Math.ceil(text.length / 4);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fixtureText = rel => readFileSync(path.join(fixture, rel), 'utf8');
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const append = (file, text) => writeFileSync(file, `${readFileSync(file, 'utf8')}${text}`);
const lineOf = (file, part) => readFileSync(file, 'utf8').split('\n').findIndex(line => line.includes(part)) + 1;

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

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-step10a-'));
const gitIn = dir => (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
// A copy of the fixture. `leave` names the root files that the copy does not get. `change` edits the copy before git sees it.
function makeProject(dir, { leave = [], change = () => {}, git = true } = {}) {
  cpSync(fixture, dir, { recursive: true, filter: source => !leave.includes(path.relative(fixture, source)) });
  for (const rel of RESEARCH_FILES) if (!existsSync(path.join(dir, rel))) write(path.join(dir, rel), `# ${rel.split('/')[2]}\n\nLocal research record.\n`);
  change(dir);
  if (git) { gitIn(dir)('init', '-q'); gitIn(dir)('add', '-A'); }
  return dir;
}

// P: the main project. Its path has a space, "_" and "." (M2). It has a real git worktree in .claude/worktrees/w1,
// a git-ignored folder work/ with context files, and 2 lines that name that folder as plain text.
const P = path.join(work, 'my proj_1.x', 'indoeuromap');
mkdirSync(path.dirname(P), { recursive: true });
makeProject(P, { change: dir => {
  append(path.join(dir, '.gitignore'), '\n# Local notes, not in git\nwork/\n');
  write(path.join(dir, 'work/model-calls/index.md'),
    '# Model calls\n\n- [changes](changes.md)\n- [bench](bench.md)\n- [measures](measures.md)\n- The raw runs are in [runs](runs/).\n');
  for (const name of ['changes', 'bench', 'measures']) write(path.join(dir, `work/model-calls/${name}.md`), `# ${name}\n\nNotes about ${name}.\n`);
  write(path.join(dir, 'work/model-calls/runs/r1.md'), '# Run 1\n');
  write(path.join(dir, 'work/model-calls/run.py'), 'print("run")\n');
  // N1 to N3: plain text that names folders. `work/model-calls` holds files with no route. `second-iteration/decisions` does not.
  append(path.join(dir, 'second-iteration/plan.md'), '\nThe model call notes are in work/model-calls (not in git).\n');
  append(path.join(dir, 'second-iteration/status.md'),
    '\nSee `work/model-calls/` and work/model-calls for the notes. The decision files are in second-iteration/decisions and the folder work is local.\n');
} });
const gitP = gitIn(P);
gitP('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'fixture');
gitP('worktree', 'add', '-q', '.claude/worktrees/w1', '-b', 'w1');
write(path.join(P, '.claude/worktrees/w1/second-iteration/only-in-worktree.md'), '# Only in the worktree\n');
const listedP = gitP('ls-files', '-z').split('\0').filter(Boolean).sort();

// N: no CLAUDE.md. The folder above it has an AGENTS.md. A nested AGENTS.md in pipeline/ (no CLAUDE.md there) and in
// frontend/ (a CLAUDE.md is there). The root AGENTS.md has an @ line.
// N has no project commands: their bodies name plan.md, status.md and frontend/llms.txt, so with them almost each file
// has a route (a long one) also with no start file.
const ABOVE_N = path.join(work, 'noclaude', 'above');
const N = path.join(ABOVE_N, 'indoeuromap');
mkdirSync(ABOVE_N, { recursive: true });
const ABOVE_TEXT = '# Shared rules\n\nUse short sentences.\n';
const DOT_CLAUDE_TEXT = '# More rules\n\nKeep each answer short.\n';
write(path.join(ABOVE_N, 'AGENTS.md'), ABOVE_TEXT);
write(path.join(ABOVE_N, '.claude', 'AGENTS.md'), DOT_CLAUDE_TEXT); // A15
makeProject(N, { leave: ['CLAUDE.md', '.claude/commands/brief.md', '.claude/commands/frontend-design-system.md'], change: dir => {
  append(path.join(dir, 'AGENTS.md'), '\n@README.md\n');
  write(path.join(dir, 'pipeline/AGENTS.md'), '# Pipeline rules\n\nRead [METHOD.md](METHOD.md) first. The root rules are in [CLAUDE.md](../CLAUDE.md).\n');
  write(path.join(dir, 'frontend/AGENTS.md'), '# Frontend agents\n\nUse the design file.\n');
  write(path.join(dir, '.claude/AGENTS.md'), DOT_CLAUDE_TEXT); // A15
} });

const PLAIN = makeProject(path.join(work, 'plain', 'indoeuromap'));
const CLAUDE_TEXT = '# Project instructions\n\nNo tests in this project.\n';
const A3A = makeProject(path.join(work, 'a3a', 'indoeuromap'), { leave: ['CLAUDE.md'], change: dir => write(path.join(dir, '.claude/CLAUDE.md'), CLAUDE_TEXT) });
const A3B = makeProject(path.join(work, 'a3b', 'indoeuromap'), { leave: ['CLAUDE.md'], change: dir => write(path.join(dir, 'CLAUDE.local.md'), CLAUDE_TEXT) });
write(path.join(work, 'a3c', 'above', 'CLAUDE.md'), CLAUDE_TEXT);
const A3C = makeProject(path.join(work, 'a3c', 'above', 'indoeuromap'), { leave: ['CLAUDE.md'] });
write(path.join(work, 'a3d', 'above', '.claude', 'CLAUDE.md'), CLAUDE_TEXT);
const A3D = makeProject(path.join(work, 'a3d', 'above', 'indoeuromap'), { leave: ['CLAUDE.md'] });
const A8 = makeProject(path.join(work, 'a8', 'indoeuromap'), { change: dir => {
  append(path.join(dir, 'CLAUDE.md'), '\n@AGENTS.md\n');
  write(path.join(dir, 'frontend/AGENTS.md'), '# Frontend agents\n\nUse the design file.\n'); // A16
} });
const BARE = makeProject(path.join(work, 'bare', 'indoeuromap'), { leave: ['CLAUDE.md', 'AGENTS.md'] });
// No git: the tool walks the folder. Worktree copies are in both worktree places.
const NOGIT = makeProject(path.join(work, 'nogit', 'indoeuromap'), { git: false, change: dir => {
  write(path.join(dir, '.claude/worktrees/w1/copy.md'), '# A worktree copy\n');
  write(path.join(dir, '.worktrees/w0/copy.md'), '# A worktree copy\n');
  write(path.join(dir, 'docs/worktrees/x/a.md'), '# Not a worktree\n');
  write(path.join(dir, '.claude/worktrees.md'), '# Not a worktree\n');
} });

// ---------- the settings homes ----------

const settings = path.join(work, 'settings');
cpSync(repoSettings, settings, { recursive: true });
const userClaude = readFileSync(path.join(settings, 'CLAUDE.md'), 'utf8');

// The memory folder of P.
const encP = enc(P);
const MEM = `~/.claude/projects/${encP}/memory`;
const memDir = path.join(settings, 'projects', encP, 'memory');
const filler = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => `- filler line ${from + k}`);
const indexLines = [
  '# Memory index',
  '',
  '- [Alpha](a.md) - a linked memory',
  '- [Beta](./b.md) - a link with a dot',
  '- [Gamma](sub/c.md) - a file in a subfolder',
  '- See [[d]] for the wiki form.',
  '- [Gone](missing.md) - a missing file',
  '- [[nope]] is a missing name.',
  '- [Outside](../other/x.md) and [notes](notes.txt) are not map files.',
  '- `[Code](in-code.md)` is in a code span.',
  '- [[decide-first]] is a name in the front matter.',
  '- [[feedback-keep-short]] is a file name with other marks.',
  '- [[short-rows]] is the end of a name.',
  '- [[twin]] is the end of 2 names.',
  ...filler(15, 249),
  '- [Late](late.md) - after the loaded part',
  ...filler(251, 260)
];
assert.equal(indexLines.length, 260);
assert.equal(indexLines[249], '- [Late](late.md) - after the loaded part');
const indexText = `${indexLines.join('\n')}\n`;
const loadedIndex = indexLines.slice(0, 200).join('\n');
const memoryFiles = {
  'MEMORY.md': indexText,
  'a.md': '# Alpha\n\nThe plan is [plan](second-iteration/plan.md). The archive log is first-iteration/docs/NOW.md.\n',
  'b.md': '# Beta\n',
  'sub/c.md': '# Gamma\n\nSee [[d]] and [beta](../b.md).\n',
  'd.md': '# Delta\n',
  'late.md': '# Late\n',
  'orphan.md': '# Orphan\n\nNo file links to this memory.\n',
  'in-code.md': '# In code\n',
  'feedback_decide_first.md': '---\nname: decide-first\ndescription: decide, then tell\n---\n\nDecide first.\n',
  'feedback_keep_short.md': '---\nname: keep it short\n---\n\nKeep it short.\n',
  'feedback_short_rows.md': '---\nname: feedback-short-rows\n---\n\nShort rows.\n',
  'feedback_twin.md': '# Twin 1\n',
  'project_twin.md': '# Twin 2\n',
  'notes.txt': 'Not a Markdown file.\n'
};
for (const [name, text] of Object.entries(memoryFiles)) write(path.join(memDir, name), text);
const memPath = name => `${MEM}/${name}`;
// M8: the memory of the --old-path folder and of another project. M14: the folder of the real path of P (macOS: /private/var).
write(path.join(settings, 'projects', MAIN, 'memory', 'MEMORY.md'), '# Old place\n\n- [old](old.md)\n');
write(path.join(settings, 'projects', MAIN, 'memory', 'old.md'), '# Old\n');
write(path.join(settings, 'projects', '-Users-example-projects-other', 'memory', 'MEMORY.md'), '# Other project\n');
const encReal = enc(realpathSync(P));
const REAL_INDEX = '# Index of the repository root\n\n- [Root note](root-note.md)\n';
if (encReal !== encP) {
  write(path.join(settings, 'projects', encReal, 'memory', 'MEMORY.md'), REAL_INDEX);
  write(path.join(settings, 'projects', encReal, 'memory', 'root-note.md'), '# Root note\n');
}
const realIndexText = encReal === encP ? indexText : REAL_INDEX;
// M3: N has memory files and no index. M4: PLAIN has an index above 25 KB.
write(path.join(settings, 'projects', enc(N), 'memory', 'x.md'), '# A memory with no index\n');
const KB_INDEX = `# Index\n- [Early](early.md)\n${Array.from({ length: 6 }, () => 'x'.repeat(5000)).join('\n')}\n- [Deep](deep.md)\n`;
write(path.join(settings, 'projects', enc(PLAIN), 'memory', 'MEMORY.md'), KB_INDEX);
write(path.join(settings, 'projects', enc(PLAIN), 'memory', 'early.md'), '# Early\n');
write(path.join(settings, 'projects', enc(PLAIN), 'memory', 'deep.md'), '# Deep\n');

// ---------- the sessions ----------

// Items: { cwd }, { user }, { agent }, { instructions: [...] }, { read: file path as the agent gave it, text },
// { miss: path }, { edit: path }, { grep: pattern, path, files: [full paths] }, { bash: command, out },
// { nested: path, text }, { mention: path, text }, { dir: path }, { task: agentId, cwd, items: [...] }.
function writeSession(folder, sessionId, start, cwd, items) {
  const dir = path.join(settings, 'projects', folder);
  mkdirSync(dir, { recursive: true });
  let k = 0;
  let now = cwd;
  const rec = extra => { k += 1; return { isSidechain: false, userType: 'external', cwd: now, sessionId, version: '2.1.300', gitBranch: 'main',
    entrypoint: 'cli', uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [];
  const tool = (list, extra, name, input, content, toolUseResult, isError = false) => {
    const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
    list.push(rec({ ...extra, type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: toolId, name, input }], usage } }));
    list.push(rec({ ...extra, type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content, ...(isError ? { is_error: true } : {}) }] }, toolUseResult }));
    return toolId;
  };
  const toolItem = (list, extra, item) => {
    if (item.cwd) now = item.cwd;
    if (item.read != null) {
      const count = item.text.split('\n').length;
      // A subagent record has no structured result: the text has line numbers.
      if (extra.isSidechain) tool(list, extra, 'Read', { file_path: item.read }, item.text.split('\n').map((line, n) => `${String(n + 1).padStart(6)}\t${line}`).join('\n'));
      else tool(list, extra, 'Read', { file_path: item.read }, item.text, { type: 'text', file: { filePath: item.read, content: item.text, numLines: count, startLine: 1, totalLines: count } });
    }
    if (item.miss != null) tool(list, extra, 'Read', { file_path: item.miss }, 'File does not exist.', 'Error: File does not exist.', true);
    if (item.edit != null) tool(list, extra, 'Edit', { file_path: item.edit, old_string: 'a', new_string: 'b' }, 'The file has been updated.', { filePath: item.edit });
    if (item.grep != null) tool(list, extra, 'Grep', { pattern: item.grep, path: item.path, output_mode: 'files_with_matches' },
      `Found ${item.files.length} files\n${item.files.join('\n')}`, extra.isSidechain ? undefined : { mode: 'files_with_matches', filenames: item.files, numFiles: item.files.length });
    if (item.bash != null) tool(list, extra, 'Bash', { command: item.bash, description: 'Run a command' }, item.out,
      { stdout: item.out, stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
  };
  for (const item of items) {
    if (item.instructions) records.push(rec({ type: 'attachment', attachment: { type: 'instructions', files: item.instructions } }));
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    if (item.nested != null) records.push(rec({ type: 'attachment', attachment: { type: 'nested_memory', path: item.nested, content: { path: item.nested, content: item.text } } }));
    if (item.mention != null) records.push(rec({ type: 'attachment', attachment: { type: 'file', filename: item.mention, content: { type: 'text', file: { filePath: item.mention, content: item.text } } } }));
    if (item.dir != null) records.push(rec({ type: 'attachment', attachment: { type: 'directory', path: item.dir, content: 'a.md\n' } }));
    if (item.task != null) {
      const sub = [];
      const back = now;
      now = item.cwd;
      sub.push(rec({ isSidechain: true, agentId: item.task, type: 'user', message: { role: 'user', content: 'Find the entry.' } }));
      for (const inner of item.items) toolItem(sub, { isSidechain: true, agentId: item.task }, inner);
      now = back;
      const toolId = tool(records, {}, 'Agent', { description: `Helper ${item.task}`, prompt: 'Find the entry.', subagent_type: 'general-purpose' }, 'Done.', { agentId: item.task });
      const subDir = path.join(dir, sessionId, 'subagents');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(path.join(subDir, `agent-${item.task}.jsonl`), `${sub.map(record => JSON.stringify(record)).join('\n')}\n`);
      writeFileSync(path.join(subDir, `agent-${item.task}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: `Helper ${item.task}`, toolUseId: toolId }));
      continue;
    }
    toolItem(records, {}, item);
  }
  writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}
const startOf = root => ({ instructions: [{ path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
  { path: `${root}/CLAUDE.md`, content: fixtureText('CLAUDE.md'), type: 'Project' }] });
const readOf = (root, rel) => ({ read: `${root}/${rel}`, text: fixtureText(rel) });
const DECISIONS = 'area.md\ncity.md\ncompare.md\nhome.md\nindex.md\nmethod-and-data-rules.md\npipeline-and-coverage.md\n';

// S1: a session of the worktree folder. Each path is in .claude/worktrees/w1.
writeSession(WT1, S1, '2026-11-22T10:00:00.000Z', W1, [
  startOf(W1),                                                    // W7: the start load names the worktree copy of CLAUDE.md
  { user: 'Check the direction in the worktree. Then see .claude/worktrees/w1/second-iteration/metrics.md.' },
  readOf(W1, 'CLAUDE.md'),                                        // 0: a start file
  readOf(W1, 'AGENTS.md'),                                        // 1: CLAUDE.md names it (W13)
  readOf(W1, 'second-iteration/plan.md'),                         // 2: AGENTS.md names it (W9)
  readOf(W1, 'second-iteration/direction.md'),                    // 3: plan.md names it (W1, W9)
  readOf(W1, 'second-iteration/metrics.md'),                      // 4: the user message names it with the worktree part (W15)
  { grep: 'Window', path: `${W1}/second-iteration`, files: [`${W1}/second-iteration/plan.md`, `${W1}/second-iteration/status.md`] }, // 5 (W6)
  { bash: `ls ${W1}/second-iteration/decisions`, out: DECISIONS }, // 6 (W6)
  { bash: `ls ${W1}`, out: 'AGENTS.md\nCLAUDE.md\nREADME.md\n' },  // 7: the worktree folder alone is "." (W3)
  { bash: `ls ${W1}/second-iteration/direction.md ${W1}/second-iteration/status.md`,                      // 8 (W18)
    out: `${W1}/second-iteration/direction.md\n${W1}/second-iteration/status.md\nls: .claude/worktrees/w1/none.md: No such file or directory\n` },
  { cwd: `${W1}/docs`, read: 'notes.md', text: '# Notes\n' },      // 9: a relative path from a folder of the worktree (W4)
  { cwd: W1, read: `${OLD}/docs/worktrees/x/a.md`, text: '# A\n' }, // 10: not a worktree (W3)
  { read: `${OLD}/.claude/worktrees.md`, text: '# W\n' },          // 11: not a worktree (W3)
  { read: `${W1}/second-iteration/only-in-worktree.md`, text: '# Only in the worktree\n' }, // 12: not on disk in the main folder (W8)
  readOf(OLD, 'second-iteration/decisions/index.md'),              // 13: the main folder
  readOf(W1, 'second-iteration/decisions/index.md'),               // 14: the worktree copy of the same file (W10)
  { edit: `${W1}/second-iteration/status.md` },                    // 15
  { miss: `${W1}/second-iteration/nope.md` },                      // 16
  { nested: `${W1}/frontend/CLAUDE.md`, text: fixtureText('frontend/CLAUDE.md') }, // 17
  { bash: 'cd .claude/worktrees/w1 && cat second-iteration/outreach/index.md', out: fixtureText('second-iteration/outreach/index.md') }, // 18 (W17)
  { agent: 'Done.' },
  { user: 'Now the city decision and the outreach folder.' },
  { mention: `${W1}/second-iteration/decisions/city.md`, text: fixtureText('second-iteration/decisions/city.md') }, // 19
  { dir: `${W1}/second-iteration/outreach` },
  { agent: 'Ok.' }
]);
// S2: a main folder session. Its subagent works in its own worktree .claude/worktrees/agent-a1 (W11).
writeSession(MAIN, S2, '2026-11-22T11:00:00.000Z', OLD, [
  startOf(OLD),
  { user: 'Find the pipeline entry with a helper.' },
  { task: 'a1', cwd: AGENT_WT, items: [
    { grep: 'run_city', path: `${AGENT_WT}/pipeline`, files: [`${AGENT_WT}/pipeline/cli.py`] },
    readOf(AGENT_WT, 'pipeline/README.md'),
    { cwd: `${AGENT_WT}/pipeline`, read: 'llms.txt', text: fixtureText('pipeline/llms.txt') }
  ] },
  { agent: 'Found.' }
]);
// S3: the folder of worktree w2, but the session starts in the main folder and goes into the worktree later (W14).
writeSession(WT2, S3, '2026-11-22T12:00:00.000Z', OLD, [
  startOf(OLD),
  { user: 'Start in the main folder, then work in the worktree.' },
  readOf(OLD, 'AGENTS.md'),
  { cwd: W2, ...readOf(W2, 'llms.txt') },
  { agent: 'Done.' }
]);
// S4: a main folder session that reads memory files and git-ignored files.
writeSession(MAIN, S4, '2026-11-22T13:00:00.000Z', OLD, [
  startOf(OLD),
  { user: 'What do the memory notes say about the plan?' },
  { read: path.join(memDir, 'MEMORY.md'), text: indexText },                    // 0: the index (M11)
  { read: path.join(memDir, 'a.md'), text: memoryFiles['a.md'] },               // 1: the index links it (M5, M11)
  { read: path.join(memDir, 'orphan.md'), text: memoryFiles['orphan.md'] },     // 2: no link to it (M6)
  { read: `${OLD}/work/model-calls/index.md`, text: readFileSync(path.join(P, 'work/model-calls/index.md'), 'utf8') }, // 3: git-ignored (F7)
  { read: `${OLD}/work/model-calls/changes.md`, text: '# changes\n\nNotes about changes.\n' },                          // 4
  { read: `${OLD}/work/model-calls/runs/r1.md`, text: '# Run 1\n' },             // 5
  { read: `${OLD}/work/model-calls/run.py`, text: 'print("run")\n' },            // 6: a code file (E1)
  { read: `${OLD}/work/model-calls/not-on-disk.md`, text: '# Gone\n' },          // 7: not on disk (E1)
  { read: `${HOME}/notes/outside.md`, text: '# Outside\n' },                     // 8: outside the project (E1)
  { read: `${OLD}/${RESEARCH}`, text: '# growth-metrics-2026-10-21\n\nLocal research record.\n' }, // 9: git-ignored and linked (E3)
  { agent: 'Done.' },
  { user: 'Thanks.' }
]);

// Settings homes with a settings.json. `off` keeps the sessions and the memory of the main home.
function settingsWith(name, json, from = repoSettings) {
  const dir = path.join(work, name);
  cpSync(from, dir, { recursive: true });
  writeFileSync(path.join(dir, 'settings.json'), typeof json === 'string' ? json : `${JSON.stringify(json, null, 2)}\n`);
  return dir;
}
const plugin = (id, value) => ({ pluginConfigs: { [id]: { options: { instructionFiles: value } } } });
const settingsOff = settingsWith('settings-off', { autoMemoryEnabled: false }, settings);
const settingsClaudeMd = settingsWith('settings-claude-md', plugin('cc-plugin-agents-md@builtin', 'claude-md'));
const settingsManaged = settingsWith('settings-managed', plugin('agents-md@builtin', 'managed-only'));
const settingsBoth = settingsWith('settings-both', plugin('cc-plugin-agents-md@builtin', 'claude-md-and-agents-md'));
const settingsBad = settingsWith('settings-bad', '{ "pluginConfigs": not JSON');
const settingsUnknown = settingsWith('settings-unknown', plugin('cc-plugin-agents-md@builtin', 'something-new'));

// ---------- the runs ----------

const projects = { P, N, PLAIN, A3A, A3B, A3C, A3D, A8, BARE };
const statusOf = dir => gitIn(dir)('status', '--porcelain', '--untracked-files=all', '--ignored');
const before = {
  status: Object.fromEntries(Object.entries(projects).map(([name, dir]) => [name, statusOf(dir)])),
  files: Object.fromEntries(Object.entries({ ...projects, NOGIT }).map(([name, dir]) => [name, snapshot(dir)])),
  homes: Object.fromEntries(Object.entries({ settings, settingsOff, settingsClaudeMd, settingsManaged, settingsBoth, settingsBad, settingsUnknown, repoSettings })
    .map(([name, dir]) => [name, snapshot(dir)]))
};

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const twice = [];
// Step 11: a file that git ignores is not a context file, so the files of work/ would be out. The checks of the
// folder mentions (F10, N1 to N3) and of the links of work/ (F7) need them as context files with no route. So the
// runs `main` and `off` pass a config file that includes work/ (`why: "config"`). The run `main-no-config` shows the
// result with no config file.
const WORK_CONFIG = path.join(work, 'config', 'work.json');
write(WORK_CONFIG, `${JSON.stringify({ include: ['work/**'] }, null, 2)}\n`);
// One run of the real command. With `again`, a second run with the same cache: both reports must be the same.
function run(name, root, { home = repoSettings, old = false, intents = false, again = false, out2 = null, config = null } = {}) {
  const once = out => {
    const args = [cli, root, '--claude-settings-home', home, '--out', out, '--cache', path.join(work, 'cache', name), '--no-open', '--no-save'];
    if (old) args.push('--old-path', OLD);
    if (intents) args.push('--intents');
    if (config) args.push('--config', config);
    const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    return { json: readFileSync(path.join(out, 'report.json'), 'utf8'), html: readFileSync(path.join(out, 'report.html'), 'utf8') };
  };
  const first = once(path.join(work, 'out', `${name}-1`));
  if (again) {
    if (out2) mkdirSync(out2, { recursive: true });
    const second = once(out2 || path.join(work, 'out', `${name}-2`));
    twice.push({ name, first, second });
  }
  return { ...first, report: JSON.parse(first.json) };
}
const artifact = path.join(repo, 'out', 'e2e-step-10-a');
const main = run('main', P, { home: settings, old: true, intents: true, again: true, out2: artifact, config: WORK_CONFIG });
const off = run('off', P, { home: settingsOff, old: true, again: true, config: WORK_CONFIG });
const mainNoConfig = run('main-no-config', P, { home: settings, old: true });
const sub = run('sub', path.join(P, 'frontend'), { home: settings });
const inWorktree = run('in-worktree', path.join(P, '.claude/worktrees/w1'), { home: settings });
const noClaude = run('noclaude', N, { home: settings, again: true });
const noClaudeOff = run('noclaude-claude-md', N, { home: settingsClaudeMd, again: true });
const noClaudeManaged = run('noclaude-managed', N, { home: settingsManaged });
const noClaudeBad = run('noclaude-bad', N, { home: settingsBad });
const noClaudeUnknown = run('noclaude-unknown', N, { home: settingsUnknown });
const plain = run('plain', PLAIN);
const plainKb = run('plain-kb', PLAIN, { home: settings });
const plainBoth = run('plain-both', PLAIN, { home: settingsBoth });
const a8 = run('a8-both', A8, { home: settingsBoth });
const a3 = { a: run('a3a', A3A), b: run('a3b', A3B), c: run('a3c', A3C), d: run('a3d', A3D) };
const bare = run('bare', BARE, { again: true });
const noGit = run('nogit', NOGIT, { again: true });

// ---------- helpers for the checks ----------

const R = main.report;
const sessionOf = (report, id) => report.sessions.list.find(session => session.sessionId === id);
const fileOf = (report, rel) => {
  const found = report.map.files.filter(entry => entry.path === rel);
  assert.equal(found.length, 1, `${rel} is in map.files one time`);
  return found[0];
};
const onMap = (report, rel) => report.map.files.some(entry => entry.path === rel);
const routeOf = (report, rel) => fileOf(report, rel).route.map(step => step.path).join(' > ');
const startText = report => report.startLoad.filter(item => ['instructions', 'import', 'rule', 'memory'].includes(item.what))
  .map(item => `${item.scope} | ${item.what} | ${item.path}`);
const known = (kind, { path: rel = null, message = null, event = null } = {}) => ({ kind, path: rel, message, event });
const needsOf = (report, id) => report.needs.sessions.find(entry => entry.sessionId === id).intents.flatMap(intent => intent.needs);
const needOf = (report, id, rel) => {
  const found = needsOf(report, id).filter(need => need.path === rel);
  assert.equal(found.length, 1, `one need for ${rel}`);
  return found[0];
};
const pageData = html => JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
// The fixture start load items that are not instruction files (the same list as in test/e2e.test.mjs).
const LISTINGS = [
  'user skill description frontend-design', 'user skill description unslop',
  'project skill description city-batch', 'project skill description geo-audit',
  'project skill description programmatic-seo', 'project skill description website-structure',
  'user command description create-commit', 'project command description brief',
  'project command description frontend-design-system',
  'project MCP server diversity-map-data', 'project MCP server diversity-map-jobs'
];
const LISTINGS_N = LISTINGS.filter(item => !item.startsWith('project command description '));
const startKeys = report => report.startLoad.map(item => `${item.scope} ${item.what} ${item.name || item.path}`);

// The start load reads the instruction files of each folder above a project. A stray file above the temp folder
// would change each result here, so say it first. (The home folder has an AGENTS.md on some machines: a test project
// must not be under it.)
test('the folders above the temp folder have no instruction file', () => {
  assert.ok(!work.startsWith(`${os.homedir()}${path.sep}`), 'the temp folder is not under the home folder');
  for (let dir = work; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/CLAUDE.md', '.claude/AGENTS.md']) {
      assert.ok(!existsSync(path.join(dir, name)), `${path.join(dir, name)} changes the start load of each test project`);
    }
  }
});

// ---------- fault 1: worktree paths ----------

test('W1, W3, W4, W7, W9, W10, W15, W17: each path of a worktree session is the path in the main folder', () => {
  const s = sessionOf(R, S1);
  assert.deepEqual(s.startLoad.map(item => [item.path, item.type]), [['~/.claude/CLAUDE.md', 'User'], ['CLAUDE.md', 'Project']]);
  assert.deepEqual(s.events.map(event => `${event.i} ${event.kind} ${event.how || event.tool} ${event.path}`), [
    '0 read Read CLAUDE.md',
    '1 read Read AGENTS.md',
    '2 read Read second-iteration/plan.md',
    '3 read Read second-iteration/direction.md',
    '4 read Read second-iteration/metrics.md',
    '5 search Grep null',
    '6 search Bash null',
    '7 search Bash null',
    '8 search Bash null',
    '9 read Read docs/notes.md',
    '10 read Read docs/worktrees/x/a.md',
    '11 read Read .claude/worktrees.md',
    '12 read Read second-iteration/only-in-worktree.md',
    '13 read Read second-iteration/decisions/index.md',
    '14 read Read second-iteration/decisions/index.md',
    '15 edit Edit second-iteration/status.md',
    '16 miss Read second-iteration/nope.md',
    '17 load nested frontend/CLAUDE.md',
    '18 read Bash second-iteration/outreach/index.md',
    '19 load mention second-iteration/decisions/city.md'
  ]);
  const ev = s.events;
  // W7: the start load file of the worktree is the start load file of the project.
  assert.deepEqual(ev[0].knownFrom, known('start', { path: 'CLAUDE.md' }));
  assert.deepEqual(ev[1].knownFrom, known('start', { path: 'CLAUDE.md' }));
  // W9: the source of knownFrom has its main path.
  assert.deepEqual(ev[2].knownFrom, known('file', { path: 'AGENTS.md' }));
  assert.deepEqual(ev[3].knownFrom, known('file', { path: 'second-iteration/plan.md' }));
  // W15: the user message names the file with a relative path that has the worktree part.
  assert.deepEqual(ev[4].knownFrom, known('user', { message: 1 }));
  for (const i of [0, 1, 2, 3, 4, 13, 14, 15, 18, 19]) assert.equal(ev[i].inProject, true, `event ${i} is a project file`);
  for (const i of [9, 10, 11, 12, 16]) assert.equal(ev[i].inProject, false, `event ${i} is not in the file list`);
  // W10: the worktree copy is the same file as the main file.
  assert.equal(ev[13].repeat, false);
  assert.equal(ev[14].repeat, true);
  assert.equal(s.totals.filesRead, new Set(ev.filter(event => event.kind === 'read').map(event => event.path)).size);
  assert.equal(s.totals.filesRead, 11);
  assert.deepEqual(s.messages[1].mentions, ['second-iteration/decisions/city.md', 'second-iteration/outreach']);
});

test('W6, W18: the search targets and the search results of a worktree have main paths', () => {
  const [grep, lsFolder, lsRoot, lsFiles] = sessionOf(R, S1).events.slice(5, 9);
  assert.deepEqual([grep.query, grep.target, grep.resultPaths], ['Window', 'second-iteration', ['second-iteration/plan.md', 'second-iteration/status.md']]);
  assert.equal(lsFolder.target, 'second-iteration/decisions');
  assert.deepEqual(lsFolder.resultPaths, DECISIONS.trim().split('\n').map(name => `second-iteration/decisions/${name}`));
  // W3: the worktree folder alone is the project root.
  assert.equal(lsRoot.target, '.');
  assert.deepEqual(lsRoot.resultPaths, ['AGENTS.md', 'CLAUDE.md', 'README.md']);
  // W18: full paths in the output of ls. The line of the error message is not a name.
  assert.deepEqual(lsFiles.resultPaths, ['second-iteration/direction.md', 'second-iteration/status.md']);
});

test('W2, W5, W14, W16: each worktree folder has its worktree name, and the old form stays', () => {
  assert.deepEqual(R.sessions.folders, [
    { name: MAIN, root: OLD, worktree: null, files: 7 },
    { name: WT1, root: W1, worktree: 'w1', files: 1 },
    { name: WT2, root: W2, worktree: 'w2', files: 1 },
    { name: WT_OLD, root: `${OLD}/.worktrees/fix-city`, worktree: 'fix-city', files: 1 },
    // The session folder of P itself: it holds the memory folder and no session file.
    { name: encP, root: P, worktree: null, files: 0 }
  ]);
  assert.deepEqual([sessionOf(R, S1).worktree, sessionOf(R, S1).folder], ['w1', WT1]);
  // W14: the session starts in the main folder. The folder name and a later cwd give the worktree.
  const s3 = sessionOf(R, S3);
  assert.deepEqual([s3.worktree, s3.folder], ['w2', WT2]);
  assert.deepEqual(s3.events.map(event => event.path), ['AGENTS.md', 'llms.txt']);
  assert.deepEqual(s3.events[1].knownFrom, known('file', { path: 'AGENTS.md' }));
  // W2: fixture session D (.worktrees/fix-city) is the same as in test/e2e-sessions.test.mjs.
  const d = sessionOf(R, D);
  assert.equal(d.worktree, 'fix-city');
  assert.deepEqual(d.startLoad.map(item => item.path), ['~/.claude/CLAUDE.md', 'CLAUDE.md']);
  assert.deepEqual(d.events.map(event => [event.i, event.kind, event.path, event.inProject]), [[0, 'read', 'AGENTS.md', true]]);
  assert.deepEqual(d.events[0].knownFrom, known('start', { path: 'CLAUDE.md' }));
});

test('W11: a subagent that works in its own worktree has main paths', () => {
  const s = sessionOf(R, S2);
  assert.equal(s.worktree, null);
  assert.deepEqual(s.events.map(event => `${event.i} ${event.thread} ${event.parentEvent} ${event.kind} ${event.path}`), [
    '0 agent:a1 0 search null',
    '1 agent:a1 0 read pipeline/README.md',
    '2 agent:a1 0 read pipeline/llms.txt'
  ]);
  assert.deepEqual([s.events[0].target, s.events[0].resultPaths], ['pipeline', ['pipeline/cli.py']]);
  assert.equal(s.events[1].inProject, true);
  // The README of the subagent worktree names llms.txt from its own folder.
  assert.deepEqual(s.events[2].knownFrom, known('file', { path: 'pipeline/README.md' }));
});

test('W7, W8, W10, W13: the needs of worktree reads are the needs of the main files', () => {
  const needs = needsOf(R, S1);
  assert.deepEqual(needs.map(need => `${need.path} ${need.state}`), [
    'CLAUDE.md in_context',
    'AGENTS.md path',
    'second-iteration/plan.md path',
    'second-iteration/direction.md path',
    'second-iteration/metrics.md path',
    'docs/notes.md gone',
    'docs/worktrees/x/a.md gone',
    '.claude/worktrees.md gone',
    'second-iteration/only-in-worktree.md gone',
    'second-iteration/decisions/index.md path',
    'frontend/CLAUDE.md path',
    'second-iteration/outreach/index.md path'
  ]);
  // W13: the need has the map route of the main file.
  assert.deepEqual(needOf(R, S1, 'AGENTS.md').map, { reach: 'path', steps: 1, pathTokens: 0, via: 'link' });
  assert.equal(needOf(R, S1, 'AGENTS.md').exists, true);
  // W10: 2 reads (the main file and the worktree copy), one need.
  assert.equal(needOf(R, S1, 'second-iteration/decisions/index.md').reads, 2);
  // W8: the file is only in the worktree, so the need is gone and it is not a lost file.
  const only = needOf(R, S1, 'second-iteration/only-in-worktree.md');
  assert.deepEqual([only.exists, only.map, only.state], [false, null, 'gone']);
  assert.ok(existsSync(path.join(P, '.claude/worktrees/w1/second-iteration/only-in-worktree.md')), 'the file is on disk in the worktree');
  const routed = R.routes.intents.find(intent => intent.sessionId === S1).needs;
  assert.ok(!routed.some(need => need.state === 'gone'));
  assert.ok(routed.every(need => need.steps != null), 'each worktree need that is not gone has a route');
  const lost = JSON.stringify(R.health.parts.found.lost);
  for (const need of needs) assert.ok(!lost.includes(JSON.stringify(need.path)), `${need.path} is not a lost file`);
});

test('W1, L6: no path in the report holds a worktree part', () => {
  // The folder list shows the worktree folder (W5), and message texts are the words of the user. Every other text is checked.
  const skip = new Set(['.sessions.folders[].root', '.sessions.list[].messages[].text']);
  const hits = [];
  const walk = (value, where) => {
    if (typeof value === 'string') { if (/\.claude\/worktrees\/|\.worktrees\//.test(value) && !skip.has(where)) hits.push(`${where}: ${value}`); return; }
    if (Array.isArray(value)) { for (const item of value) walk(item, `${where}[]`); return; }
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, `${where}.${key}`);
  };
  walk(R, '');
  assert.deepEqual(hits, []);
});

test('W12, W19: the file list has no worktree copy, with git and without git', () => {
  // W19: P has a real git worktree in .claude/worktrees/w1. git does not list its files.
  assert.ok(statSync(path.join(P, '.claude/worktrees/w1/AGENTS.md')).isFile());
  assert.equal(R.listing.method, 'git');
  assert.deepEqual(R.map.files.filter(file => !file.ignored && !file.path.startsWith('~/')).map(file => file.path), listedP);
  assert.ok(!R.map.files.some(file => /worktrees\//.test(file.path)));
  // W12: without git the walk leaves out both worktree places. A folder that only looks like one stays.
  const report = noGit.report;
  assert.equal(report.listing.method, 'walk');
  const context = report.contextFiles.map(file => file.path);
  assert.ok(!context.some(rel => rel.startsWith('.claude/worktrees/') || rel.startsWith('.worktrees/')));
  // Step 11: .claude/worktrees.md is in the file list, but it is not a context file now: it is not a skill, a command,
  // an agent or a rule, and no context file names it (`not-linked`). docs/worktrees/x/a.md is in a docs folder.
  assert.ok(context.includes('docs/worktrees/x/a.md') && !context.includes('.claude/worktrees.md'));
  assert.deepEqual(report.map.files.filter(file => file.path === '.claude/worktrees.md').map(file => [file.kind, file.why]), [['excluded', 'not-linked']]);
  assert.ok(!report.map.files.some(file => file.path.startsWith('.claude/worktrees/') || file.path.startsWith('.worktrees/')));
  assert.equal(report.listing.files, report.map.files.filter(file => !file.ignored && !file.path.startsWith('~/')).length);
});

// ---------- fault 3: the memory ----------

test('M1, M2, M4, M17, M18: the memory index is one start item, with the tokens of its loaded part', () => {
  // M2: the folder name is the root path with "-" for each character that is not a letter or a digit.
  assert.ok(/ /.test(P) && /_/.test(P) && /\./.test(P));
  assert.ok(/^[A-Za-z0-9-]+$/.test(encP));
  const items = R.startLoad.filter(item => item.what === 'memory');
  assert.deepEqual(items, [{ scope: 'project', what: 'memory', path: memPath('MEMORY.md'), tokens: tok(loadedIndex), via: MEMORY_VIA }]);
  // M4: 260 lines, 200 load.
  assert.ok(tok(loadedIndex) < tok(indexText));
  // After the project instruction files, before the listings.
  assert.deepEqual(startKeys(R), ['user instructions ~/.claude/CLAUDE.md', 'project instructions CLAUDE.md', `project memory ${memPath('MEMORY.md')}`, ...LISTINGS]);
  // The totals count it. The same project with the memory off has the same start load without it.
  assert.equal(R.totals.startLoadItems, R.startLoad.length);
  assert.equal(R.totals.startLoadTokens, R.startLoad.reduce((sum, item) => sum + (item.tokens || 0), 0));
  assert.equal(R.totals.startLoadItems, off.report.totals.startLoadItems + 1);
  assert.equal(R.totals.startLoadTokens, off.report.totals.startLoadTokens + tok(loadedIndex));
  // M17: the memory files are not project context files.
  assert.deepEqual(R.contextFiles, off.report.contextFiles);
  assert.ok(!R.contextFiles.some(file => file.path.startsWith('~/')));
  assert.equal(R.totals.contextFiles, off.report.totals.contextFiles);
  // M18: the map file of the index has the tokens of the full file.
  const index = fileOf(R, memPath('MEMORY.md'));
  assert.deepEqual([index.context, index.kind, index.tokens, index.ignored, index.reach, index.steps, index.via], [true, 'memory index', tok(indexText), false, 'start', 0, 'start']);
  assert.deepEqual(index.route, [{ path: memPath('MEMORY.md'), via: 'start', line: null }]);
});

test('M5, M6, M7, M15, M16, M19: the memory files are on the map, and each link form of the index is an edge', () => {
  const memory = R.map.files.filter(file => file.kind === 'memory' || file.kind === 'memory index');
  assert.deepEqual(memory.map(file => file.path), Object.keys(memoryFiles).filter(name => name.endsWith('.md')).map(memPath).sort());
  for (const file of memory) assert.deepEqual([file.context, file.ignored], [true, false], file.path);
  // M5, M7: [t](a.md), ./b.md, a subfolder, [[d]].
  for (const [name, line] of [['a.md', 3], ['b.md', 4], ['sub/c.md', 5], ['d.md', 6]]) {
    const file = fileOf(R, memPath(name));
    assert.deepEqual([file.reach, file.steps, file.via, file.pathTokens], ['path', 1, 'link', 0], name);
    assert.deepEqual(file.route, [{ path: memPath('MEMORY.md'), via: 'start', line: null }, { path: memPath(name), via: 'link', line }], name);
  }
  // M19: [[name]] by the front matter name, by the file name with other marks, by the end of the name.
  for (const [name, line] of [['feedback_decide_first.md', 11], ['feedback_keep_short.md', 12], ['feedback_short_rows.md', 13]]) {
    assert.deepEqual(fileOf(R, memPath(name)).route.at(-1), { path: memPath(name), via: 'link', line }, name);
  }
  // A link in a file of a subfolder: [[d]] is in the memory folder, ../b.md is from the folder of the file.
  assert.deepEqual(fileOf(R, memPath('d.md')).linkedFrom, [{ path: memPath('MEMORY.md'), via: 'link', line: 6 }, { path: memPath('sub/c.md'), via: 'link', line: 3 }]);
  assert.ok(fileOf(R, memPath('b.md')).linkedFrom.some(edge => edge.path === memPath('sub/c.md') && edge.via === 'link'));
  // M6: no link, a link after the loaded part (M4), a link in a code span, 2 files for one name: no route.
  for (const name of ['orphan.md', 'late.md', 'in-code.md', 'feedback_twin.md', 'project_twin.md']) {
    const file = fileOf(R, memPath(name));
    assert.deepEqual([file.reach, file.steps, file.via, file.route, file.linkedFrom], ['none', null, null, [], []], name);
  }
  // M7: a link to a missing memory file is a broken link. M16: a file that is not Markdown and a path outside are not.
  const fixtureBroken = plain.report.map.broken;
  assert.equal(fixtureBroken.length, 3);
  assert.deepEqual(R.map.broken, [
    ...fixtureBroken,
    { source: memPath('MEMORY.md'), line: 7, target: memPath('missing.md'), raw: 'missing.md' },
    { source: memPath('MEMORY.md'), line: 8, target: memPath('nope.md'), raw: '[[nope]]' },
    { source: memPath('MEMORY.md'), line: 14, target: memPath('twin.md'), raw: '[[twin]]' }
  ]);
  assert.ok(!onMap(R, memPath('notes.txt')) && !R.map.files.some(file => file.path.includes('/other/')));
  // M15: a memory file is a source. A path from the project root is an edge to the project file.
  assert.ok(fileOf(R, 'second-iteration/plan.md').linkedFrom.some(edge => edge.path === memPath('a.md') && edge.via === 'link' && edge.line === 3));
  const now = fileOf(R, 'first-iteration/docs/NOW.md');
  assert.equal(fileOf(plain.report, 'first-iteration/docs/NOW.md').steps, 3);
  assert.deepEqual([now.steps, now.via, now.pathTokens], [2, 'mention', tok(memoryFiles['a.md'])]);
  assert.equal(routeOf(R, 'first-iteration/docs/NOW.md'), `${memPath('MEMORY.md')} > ${memPath('a.md')} > first-iteration/docs/NOW.md`);
  // The totals count the memory files.
  assert.equal(R.map.totals.start, 2);
  assert.equal(R.map.totals.files, R.map.files.length);
});

test('M5, M6, M11: a read of the index is in context, a linked memory file has a path, a memory file with no link is lost', () => {
  const s = sessionOf(R, S4);
  assert.deepEqual(s.events.slice(0, 3).map(event => [event.path, event.inProject]), [[memPath('MEMORY.md'), false], [memPath('a.md'), false], [memPath('orphan.md'), false]]);
  assert.deepEqual(s.events[1].knownFrom, known('file', { path: memPath('MEMORY.md') }));
  const index = needOf(R, S4, memPath('MEMORY.md'));
  assert.deepEqual([index.scope, index.fileKind, index.exists, index.state], ['user', 'memory index', true, 'in_context']);
  const linked = needOf(R, S4, memPath('a.md'));
  assert.deepEqual([linked.fileKind, linked.exists, linked.state], ['memory', true, 'path']);
  assert.deepEqual(linked.map, { reach: 'path', steps: 1, pathTokens: 0, via: 'link' });
  const orphan = needOf(R, S4, memPath('orphan.md'));
  assert.deepEqual([orphan.map.reach, orphan.state], ['none', 'no_path']);
  // The routes and the lost list.
  const routed = R.routes.intents.find(intent => intent.sessionId === S4).needs;
  const routeNeed = rel => routed.find(need => need.path === rel);
  assert.deepEqual(routeNeed(memPath('MEMORY.md')).route, [{ path: memPath('MEMORY.md'), how: 'start' }]);
  assert.deepEqual(routeNeed(memPath('a.md')).route, [{ path: memPath('MEMORY.md'), how: 'start' }, { path: memPath('a.md'), how: 'link' }]);
  assert.deepEqual([routeNeed(memPath('a.md')).steps, routeNeed(memPath('a.md')).direct], [1, true]);
  assert.equal(routeNeed(memPath('orphan.md')).steps, null);
  const lost = JSON.stringify(R.health.parts.found.lost);
  assert.ok(lost.includes(JSON.stringify(memPath('orphan.md'))), 'the memory file with no link is lost');
  assert.ok(!lost.includes(JSON.stringify(memPath('a.md'))) && !lost.includes(JSON.stringify(memPath('MEMORY.md'))));
});

test('M12: the page map has the index in the start column and a linked memory file 1 step away', () => {
  const node = rel => R.routes.map.nodes.find(item => item.id === rel);
  assert.deepEqual(R.routes.map.nodes.filter(item => item.lane === 'start').map(item => item.id),
    ['~/.claude/CLAUDE.md', 'CLAUDE.md', memPath('MEMORY.md'), ':skill-list']);
  const index = node(memPath('MEMORY.md'));
  assert.deepEqual([index.lane, index.column, index.steps, index.tokens], ['start', 0, 0, tok(loadedIndex)]);
  const linked = node(memPath('a.md'));
  assert.deepEqual([linked.lane, linked.column, linked.steps], ['steps', 1, 1]);
  assert.deepEqual([node(memPath('orphan.md')).lane, node(memPath('orphan.md')).column], ['none', null]);
  assert.ok(R.routes.map.edges.some(edge => edge.from === memPath('MEMORY.md') && edge.to === memPath('a.md') && edge.onMap && edge.intents === 1));
  // The page data: the copy path is the path in the settings home of the run.
  const data = pageData(main.html);
  const box = rel => data.map.nodes.find(item => item.id === rel);
  assert.equal(box(memPath('MEMORY.md')).abs, path.join(memDir, 'MEMORY.md'));
  assert.equal(box(memPath('a.md')).abs, path.join(memDir, 'a.md'));
  assert.deepEqual([box(memPath('MEMORY.md')).lane, box(memPath('MEMORY.md')).column], ['start', 0]);
  assert.deepEqual([box(memPath('a.md')).lane, box(memPath('a.md')).column, box(memPath('a.md')).route], ['steps', 1, [memPath('MEMORY.md'), memPath('a.md')]]);
});

test('M3, M8, M9, M13, M14: only the memory folder of the project counts', () => {
  // M8, M9: the memory of the --old-path folder, of another project and of the real home is not read.
  const all = main.json;
  assert.ok(!all.includes(`projects/${MAIN}/memory`) && !all.includes('projects/-Users-example-projects-other/memory'));
  for (const text of all.match(/~\/\.claude\/projects\/[^"\\ ]*/g) || []) assert.ok(text.startsWith(`${MEM}/`), text);
  // M13: "autoMemoryEnabled": false. No memory item and no memory file on the map.
  assert.ok(!off.report.startLoad.some(item => item.what === 'memory'));
  assert.ok(!off.report.map.files.some(file => file.path.includes('/memory/')));
  assert.equal(off.report.map.totals.start, 1);
  assert.equal(fileOf(off.report, 'first-iteration/docs/NOW.md').steps, 3);
  // M3: no memory folder at all (the fixture settings home), and memory files with no index.
  assert.ok(!plain.report.startLoad.some(item => item.what === 'memory'));
  assert.ok(!plain.report.map.files.some(file => file.path.startsWith('~/.claude/projects/')));
  assert.ok(!noClaude.report.startLoad.some(item => item.what === 'memory'));
  const alone = fileOf(noClaude.report, `~/.claude/projects/${enc(N)}/memory/x.md`);
  assert.deepEqual([alone.kind, alone.context, alone.reach, alone.steps], ['memory', true, 'none', null]);
  // M14: a root that is a subfolder, or a git worktree, has the memory of the repository root.
  for (const report of [sub.report, inWorktree.report]) {
    const item = report.startLoad.filter(entry => entry.what === 'memory');
    assert.deepEqual(item, [{ scope: 'project', what: 'memory', path: `~/.claude/projects/${encReal}/memory/MEMORY.md`,
      tokens: tok(realIndexText.split('\n').slice(0, 200).join('\n')), via: MEMORY_VIA }]);
  }
  assert.equal(sub.report.project.root, path.join(P, 'frontend'));
});

test('M4: an index above 25 KB loads only its first 25 KB', () => {
  const dir = `~/.claude/projects/${enc(PLAIN)}/memory`;
  assert.ok(Buffer.byteLength(KB_INDEX) > 25000 && KB_INDEX.split('\n').length < 200);
  const item = plainKb.report.startLoad.find(entry => entry.what === 'memory');
  assert.deepEqual([item.path, item.tokens], [`${dir}/MEMORY.md`, 6250]);
  assert.deepEqual([fileOf(plainKb.report, `${dir}/early.md`).steps, fileOf(plainKb.report, `${dir}/deep.md`).reach], [1, 'none']);
  assert.equal(fileOf(plainKb.report, `${dir}/MEMORY.md`).tokens, tok(KB_INDEX));
});

// ---------- AGENTS.md in the start load ----------

const ONE_STEP = ['second-iteration/status.md', 'second-iteration/plan.md', 'second-iteration/decisions/index.md', 'pipeline/METHOD.md', 'llms.txt',
  'second-iteration/decisions/pipeline-and-coverage.md', 'pipeline/city-factory/README.md'];

test('A1, A6, A7, A9, A11, A13, A15: with no CLAUDE.md, AGENTS.md is a start file', () => {
  const report = noClaude.report;
  const agentsText = readFileSync(path.join(N, 'AGENTS.md'), 'utf8');
  // A11: the user file of the settings home does not stop the fallback. A6: the AGENTS.md of the folder above loads too.
  // A15: the .claude/AGENTS.md of each folder loads after its AGENTS.md.
  assert.deepEqual(report.startLoad.slice(0, 5), [
    { scope: 'user', what: 'instructions', path: '~/.claude/CLAUDE.md', tokens: tok(userClaude), via: 'user instructions' },
    { scope: 'parent folder', what: 'instructions', path: path.join(ABOVE_N, 'AGENTS.md'), tokens: tok(ABOVE_TEXT), via: FALLBACK },
    { scope: 'parent folder', what: 'instructions', path: path.join(ABOVE_N, '.claude', 'AGENTS.md'), tokens: tok(DOT_CLAUDE_TEXT), via: FALLBACK },
    { scope: 'project', what: 'instructions', path: 'AGENTS.md', tokens: tok(agentsText), via: FALLBACK },
    { scope: 'project', what: 'instructions', path: '.claude/AGENTS.md', tokens: tok(DOT_CLAUDE_TEXT), via: FALLBACK }
  ]);
  assert.deepEqual(startKeys(report).slice(5), LISTINGS_N);
  // A9: the @ line of AGENTS.md is not an import.
  assert.ok(agentsText.includes('@README.md') && !report.startLoad.some(item => item.what === 'import'));
  assert.notEqual(fileOf(report, 'README.md').reach, 'start');
  // A1: on the map AGENTS.md is the start file, and the files it links are 1 step away.
  const agents = fileOf(report, 'AGENTS.md');
  assert.deepEqual([agents.reach, agents.steps, agents.via, agents.route], ['start', 0, 'start', [{ path: 'AGENTS.md', via: 'start', line: null }]]);
  for (const rel of ONE_STEP) {
    assert.deepEqual([fileOf(report, rel).steps, routeOf(report, rel)], [1, `AGENTS.md > ${rel}`], rel);
    assert.equal(fileOf(plain.report, rel).steps, 2, `${rel} is 2 steps away in the fixture as it is`);
  }
  // A6: the file of the folder above is not a file of the map.
  assert.deepEqual(report.map.files.filter(file => file.reach === 'start').map(file => file.path), ['.claude/AGENTS.md', 'AGENTS.md']);
  assert.ok(!report.map.files.some(file => file.path.startsWith('/')));
  // A7: a nested AGENTS.md loads with the first file of its folder. A13: not when the folder has a CLAUDE.md.
  assert.deepEqual(report.later.filter(item => /^nested/.test(item.what)).map(item => `${item.what} | ${item.path} | ${item.trigger}`), [
    'nested instructions | frontend/CLAUDE.md | the agent reads a file in frontend/',
    'nested import | frontend/DESIGN.md | the agent reads a file in frontend/ (@ import in frontend/CLAUDE.md)',
    'nested instructions | pipeline/AGENTS.md | the agent reads a file in pipeline/'
  ]);
  const nested = report.later.find(item => item.path === 'pipeline/AGENTS.md');
  assert.deepEqual(nested, { scope: 'project', what: 'nested instructions', path: 'pipeline/AGENTS.md',
    tokens: tok(readFileSync(path.join(N, 'pipeline/AGENTS.md'), 'utf8')), trigger: 'the agent reads a file in pipeline/' });
  const auto = fileOf(report, 'pipeline/AGENTS.md');
  const others = report.map.files.filter(file => file.path.startsWith('pipeline/') && file.path !== 'pipeline/AGENTS.md' && file.steps != null);
  assert.deepEqual([auto.via, auto.steps], ['auto', Math.min(...others.map(file => file.steps))]);
  assert.equal(auto.steps, 1);
  assert.ok(auto.route.at(-2).path.startsWith('pipeline/'), 'the file before it on the route is a file of pipeline/');
  assert.deepEqual(auto.route.at(-1), { path: 'pipeline/AGENTS.md', via: 'auto', line: null });
  const frontend = fileOf(report, 'frontend/AGENTS.md');
  assert.ok(frontend.via !== 'auto' && !frontend.linkedFrom.length && frontend.reach === 'none');
  assert.equal(fileOf(report, 'frontend/CLAUDE.md').via, 'auto');
});

test('A2: with a CLAUDE.md, AGENTS.md is not a start file and the fixture start load does not change', () => {
  assert.deepEqual(startKeys(plain.report), ['user instructions ~/.claude/CLAUDE.md', 'project instructions CLAUDE.md', ...LISTINGS]);
  assert.deepEqual(plain.report.map.files.filter(file => file.reach === 'start').map(file => file.path), ['CLAUDE.md']);
  assert.deepEqual([fileOf(plain.report, 'AGENTS.md').reach, fileOf(plain.report, 'AGENTS.md').steps], ['path', 1]);
  assert.deepEqual(plain.report.later.filter(item => /^nested/.test(item.what)).map(item => item.path), ['frontend/CLAUDE.md', 'frontend/DESIGN.md']);
});

test('A3, A10: a .claude/CLAUDE.md, a CLAUDE.local.md, or a CLAUDE.md in a folder above stops the fallback', () => {
  const instructions = report => report.startLoad.filter(item => item.what === 'instructions').map(item => `${item.scope} | ${item.path} | ${item.via}`);
  const user = 'user | ~/.claude/CLAUDE.md | user instructions';
  assert.deepEqual(instructions(a3.a.report), [user, 'project | .claude/CLAUDE.md | project instructions']);
  assert.deepEqual(instructions(a3.b.report), [user, 'project | CLAUDE.local.md | project instructions']);
  assert.deepEqual(instructions(a3.c.report), [user, `parent folder | ${path.join(work, 'a3c', 'above', 'CLAUDE.md')} | CLAUDE.md in a parent folder`]);
  // A10: the file that stops the fallback is in the start load.
  assert.deepEqual(instructions(a3.d.report), [user, `parent folder | ${path.join(work, 'a3d', 'above', '.claude', 'CLAUDE.md')} | CLAUDE.md in a parent folder`]);
  for (const [name, item] of Object.entries(a3)) {
    assert.ok(!item.report.startLoad.some(entry => entry.path === 'AGENTS.md'), `a3${name}: AGENTS.md is not a start item`);
    assert.notEqual(fileOf(item.report, 'AGENTS.md').reach, 'start', `a3${name}`);
  }
  // The project of a3a and a3b has its own start file. The project of a3c and a3d has none.
  assert.deepEqual([a3.a.report.map.virtualStart, a3.b.report.map.virtualStart], [null, null]);
  for (const item of [a3.c, a3.d]) assert.deepEqual([item.report.map.virtualStart.path, item.report.map.virtualStart.imports], ['CLAUDE.md', ['AGENTS.md']]);
});

test('A4, A12, A14: the setting instructionFiles of settings.json', () => {
  // A4: "claude-md" turns the fallback off, also for the folder above. A14: the old plugin id and "managed-only" do the same.
  for (const item of [noClaudeOff, noClaudeManaged]) {
    assert.deepEqual(startKeys(item.report), ['user instructions ~/.claude/CLAUDE.md', ...LISTINGS_N]);
    assert.ok(!item.report.later.some(entry => entry.path.endsWith('AGENTS.md')), 'no nested AGENTS.md loads');
    assert.notEqual(fileOf(item.report, 'pipeline/AGENTS.md').via, 'auto');
  }
  assert.deepEqual(noClaudeManaged.report.map, noClaudeOff.report.map);
  assert.deepEqual(noClaudeManaged.report.startLoad, noClaudeOff.report.startLoad);
  // A12: a settings file that is not JSON, and an unknown value: the default.
  for (const item of [noClaudeBad, noClaudeUnknown]) {
    assert.deepEqual(startKeys(item.report), ['user instructions ~/.claude/CLAUDE.md', `parent folder instructions ${path.join(ABOVE_N, 'AGENTS.md')}`,
      `parent folder instructions ${path.join(ABOVE_N, '.claude', 'AGENTS.md')}`, 'project instructions AGENTS.md', 'project instructions .claude/AGENTS.md', ...LISTINGS_N]);
    assert.equal(item.report.map.virtualStart, null);
  }
});

test('A5, A8, A16: the setting that loads CLAUDE.md and AGENTS.md', () => {
  // A5: both are start items.
  assert.deepEqual(plainBoth.report.startLoad.slice(0, 3), [
    { scope: 'user', what: 'instructions', path: '~/.claude/CLAUDE.md', tokens: tok(userClaude), via: 'user instructions' },
    { scope: 'project', what: 'instructions', path: 'CLAUDE.md', tokens: tok(fixtureText('CLAUDE.md')), via: 'project instructions' },
    { scope: 'project', what: 'instructions', path: 'AGENTS.md', tokens: tok(fixtureText('AGENTS.md')), via: BOTH }
  ]);
  assert.deepEqual(startKeys(plainBoth.report).slice(3), LISTINGS);
  assert.deepEqual(plainBoth.report.map.files.filter(file => file.reach === 'start').map(file => file.path), ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(fileOf(plainBoth.report, 'pipeline/METHOD.md').steps, 1);
  assert.equal(plainBoth.report.map.virtualStart, null);
  // A8: a CLAUDE.md that imports AGENTS.md. One item for AGENTS.md.
  const agents = a8.report.startLoad.filter(item => item.path === 'AGENTS.md');
  assert.deepEqual(agents.map(item => [item.what, item.via]), [['import', '@ import in CLAUDE.md']]);
  // A16: with this setting a nested AGENTS.md loads also when its folder has a CLAUDE.md.
  assert.deepEqual(a8.report.later.filter(item => item.what === 'nested instructions').map(item => item.path), ['frontend/AGENTS.md', 'frontend/CLAUDE.md']);
  assert.deepEqual([fileOf(a8.report, 'frontend/AGENTS.md').via, fileOf(a8.report, 'frontend/CLAUDE.md').via], ['auto', 'auto']);
});

// ---------- the map: files from the sessions, folder mentions, the virtual start file ----------

test('F7, E1, E2, E3: a git-ignored file that the config includes and that a session read is on the map, and its links are edges', () => {
  // Step 11: git ignores work/, so its files are context files only because the config of this run includes them.
  // F7: the index file of the git-ignored folder. No file links to it, so it has no route.
  const index = fileOf(R, 'work/model-calls/index.md');
  assert.deepEqual([index.context, index.kind, index.why, index.ignored, index.reach, index.linkedFrom], [true, 'doc', 'config', true, 'none', []]);
  assert.equal(index.tokens, tok(readFileSync(path.join(P, 'work/model-calls/index.md'), 'utf8')));
  // Its links are edges. bench.md and measures.md are on the map only by these links.
  for (const [name, line] of [['changes', 3], ['bench', 4], ['measures', 5]]) {
    const file = fileOf(R, `work/model-calls/${name}.md`);
    assert.deepEqual([file.ignored, file.reach, file.linkedFrom], [true, 'none', [{ path: 'work/model-calls/index.md', via: 'link', line }]], name);
  }
  // A folder link of the index is an edge to the file of that folder that a session read.
  assert.deepEqual(fileOf(R, 'work/model-calls/runs/r1.md').linkedFrom, [{ path: 'work/model-calls/index.md', via: 'folder', line: 6 }]);
  // The needs of the session have the map entry.
  const need = needOf(R, S4, 'work/model-calls/index.md');
  assert.deepEqual([need.fileKind, need.exists, need.ignored, need.map.reach, need.state], ['doc', true, true, 'none', 'no_path']);
  assert.deepEqual([needOf(R, S4, 'work/model-calls/changes.md').knownFrom, needOf(R, S4, 'work/model-calls/changes.md').state],
    [known('file', { path: 'work/model-calls/index.md' }), 'no_path']);
  // E1: no map file for a code file, a file that is not on disk, or a file outside the project.
  assert.ok(sessionOf(R, S4).events.some(event => event.path === 'work/model-calls/run.py') && !onMap(R, 'work/model-calls/run.py'));
  assert.ok(!onMap(R, 'work/model-calls/not-on-disk.md') && !onMap(R, '~/notes/outside.md'));
  assert.equal(needOf(R, S4, 'work/model-calls/not-on-disk.md').state, 'gone');
  // E3: a git-ignored file that a session read and that a listed file links is one map file, with its route.
  // Step 11: it is not a context file (the config does not include it), so a read of it is a dropped read.
  assert.deepEqual([fileOf(R, RESEARCH).ignored, fileOf(R, RESEARCH).steps, fileOf(R, RESEARCH).context, fileOf(R, RESEARCH).why], [true, 3, false, 'ignored']);
  assert.deepEqual(R.needs.dropped.list, [{ path: RESEARCH, reason: 'ignored', needs: 1, reads: 1 }]);
  // The git-ignored files of the map: the files of work/ that a session read or that the index links, and the research file.
  assert.deepEqual(R.map.files.filter(file => file.ignored).map(file => file.path), [...RESEARCH_FILES, 'work/model-calls/bench.md',
    'work/model-calls/changes.md', 'work/model-calls/index.md', 'work/model-calls/measures.md', 'work/model-calls/runs/r1.md']);
  // E2: the file list does not count them. The run with no sessions of the same files has no work/ file on the map.
  // Step 11: `contextFiles` has the 5 files of work/ now (before: none), because the config includes them.
  const workFiles = ['bench.md', 'changes.md', 'index.md', 'measures.md', 'runs/r1.md'].map(name => `work/model-calls/${name}`);
  assert.deepEqual(R.contextFiles.filter(file => file.path.startsWith('work/')).map(file => [file.path, file.why]), workFiles.map(rel => [rel, 'config']));
  assert.equal(R.listing.files, listedP.length);
  assert.ok(!sub.report.map.files.some(file => file.path.startsWith('work/')));
  // Step 11, with no config file: a file that git ignores and that a session read is not a context file and not a map
  // file (step 10 put it on the map). Its read is a dropped read. The files that only the index links are not seen.
  const plainRun = mainNoConfig.report;
  assert.ok(!plainRun.map.files.some(file => file.path.startsWith('work/')) && !plainRun.contextFiles.some(file => file.path.startsWith('work/')));
  assert.deepEqual(plainRun.contextRules.excluded.filter(file => file.path.startsWith('work/')),
    ['changes.md', 'index.md', 'runs/r1.md'].map(name => ({ path: `work/model-calls/${name}`, reason: 'ignored' })));
  assert.deepEqual(plainRun.map.folderMentions.filter(item => item.folder.startsWith('work')), []);
  assert.equal(plainRun.totals.contextFiles, R.totals.contextFiles - workFiles.length);
});

test('F10, N1, N2, N3: map.folderMentions lists the plain text that names a folder with a file that has no route', () => {
  const mentions = R.map.folderMentions;
  const planLine = lineOf(path.join(P, 'second-iteration/plan.md'), 'work/model-calls (not in git)');
  const statusLine = lineOf(path.join(P, 'second-iteration/status.md'), 'work/model-calls for the notes');
  // F10: the 2 lines that name the folder (with and without "/" at the end). N3: one entry for a line that names it 2 times.
  assert.deepEqual(mentions.filter(item => item.folder.startsWith('work')), [
    { folder: 'work/model-calls', source: 'second-iteration/plan.md', line: planLine },
    { folder: 'work/model-calls', source: 'second-iteration/status.md', line: statusLine }
  ]);
  // The 2 sources are on a route, so the fix can name the file and the line.
  assert.deepEqual([fileOf(R, 'second-iteration/plan.md').reach, fileOf(R, 'second-iteration/status.md').reach], ['path', 'path']);
  // N1: a folder link (runs/ in the index) is not a mention. A bare folder name ("work") is not. A file path is not.
  assert.ok(!mentions.some(item => item.folder === 'work/model-calls/runs' || item.folder === 'work'));
  const noRoute = R.map.files.filter(file => file.reach === 'none').map(file => file.path);
  const paths = new Set(R.map.files.map(file => file.path));
  for (const item of mentions) {
    assert.deepEqual(Object.keys(item), ['folder', 'source', 'line']);
    assert.ok(statSync(path.join(P, item.folder)).isDirectory(), `${item.folder} is a folder`);
    assert.ok(paths.has(item.source), `${item.source} is a map file`);
    assert.ok(noRoute.some(rel => rel.startsWith(`${item.folder}/`)), `${item.folder} holds a file with no route`);
    const line = readFileSync(path.join(P, item.source), 'utf8').split('\n')[item.line - 1];
    const fromSource = path.posix.relative(path.posix.dirname(item.source), item.folder);
    assert.ok(line.includes(item.folder) || (fromSource && line.includes(fromSource)), `${item.source}:${item.line} names ${item.folder}`);
  }
  // N2: each file of second-iteration/decisions has a route, so the folder is not in the list.
  assert.ok(!mentions.some(item => item.folder === 'second-iteration/decisions'));
  // Sorted, and no entry 2 times.
  const keys = mentions.map(item => `${item.folder}\u0000${item.source}\u0000${String(item.line).padStart(6, '0')}`);
  assert.deepEqual(keys, [...new Set(keys)].sort());
  // The fixture as it is: the mentions of the folders that hold a file with no route.
  assert.deepEqual([...new Set(plain.report.map.folderMentions.map(item => item.folder))], ['data', 'first-iteration', 'first-iteration/docs', 'frontend', 'frontend/src']);
});

test('R3, R5, R7, V1, V2: map.virtualStart comes from a second run of the map, and the real map does not change', () => {
  // R7: a project with a start file of its own.
  for (const item of [main, off, plain, plainBoth, noClaude, a8]) assert.equal(item.report.map.virtualStart, null);
  // The run of A4: AGENTS.md is there but does not load.
  const map = noClaudeOff.report.map;
  const virtual = map.virtualStart;
  assert.deepEqual(Object.keys(virtual), ['path', 'imports', 'reached']);
  assert.deepEqual([virtual.path, virtual.imports], ['CLAUDE.md', ['AGENTS.md']]);
  assert.deepEqual(virtual.reached.find(item => item.path === 'AGENTS.md'), { path: 'AGENTS.md', steps: 0 });
  assert.deepEqual(virtual.reached.map(item => item.path), virtual.reached.map(item => item.path).sort());
  for (const item of virtual.reached) assert.deepEqual(Object.keys(item), ['path', 'steps']);
  // R3: the steps come from a map that starts at the virtual file. Compare with the map that starts at AGENTS.md
  // (the run of A1 on the same project): no file is farther. One file is nearer: AGENTS.md has the line @README.md,
  // and an @ line works in a file that CLAUDE.md imports, so README.md loads at the start with the new file.
  const real = new Map(map.files.map(file => [file.path, file]));
  const withStart = new Map(noClaude.report.map.files.map(file => [file.path, file]));
  for (const item of virtual.reached) {
    assert.equal(real.get(item.path).reach, 'none', `${item.path} has no route on the real map`);
    assert.ok(Number.isInteger(item.steps) && item.steps <= withStart.get(item.path).steps, item.path);
  }
  assert.deepEqual(virtual.reached.find(item => item.path === 'README.md'), { path: 'README.md', steps: 0 });
  assert.equal(withStart.get('README.md').steps, 2);
  // The files that AGENTS.md links are 1 step away. A file that has a route on the real map (a skill body names it) is not in the list.
  const lostLinks = ONE_STEP.filter(rel => real.get(rel).reach === 'none');
  assert.ok(lostLinks.length >= 5 && lostLinks.includes('pipeline/METHOD.md'), lostLinks.join(', '));
  for (const rel of lostLinks) assert.ok(virtual.reached.some(item => item.path === rel && item.steps === 1), rel);
  for (const rel of ONE_STEP.filter(item => !lostLinks.includes(item))) assert.ok(!virtual.reached.some(item => item.path === rel), rel);
  // Each file that a start at AGENTS.md brings in is in the list. Two files are not: the nested AGENTS.md does not load
  // with this setting, and the new CLAUDE.md does not import .claude/AGENTS.md.
  const notByImport = ['pipeline/AGENTS.md', '.claude/AGENTS.md'];
  const expected = noClaude.report.map.files.filter(file => file.reach !== 'none' && real.get(file.path)?.reach === 'none' && !notByImport.includes(file.path))
    .map(file => file.path);
  for (const rel of notByImport) assert.equal(real.get(rel).reach, 'none', rel);
  assert.deepEqual(virtual.reached.map(item => item.path), expected);
  assert.ok(expected.length >= 40, `${expected.length} files`);
  // R5, V2: the virtual file is not a map file, and the totals are the totals of the real map.
  assert.ok(!real.has('CLAUDE.md') && !virtual.reached.some(item => item.path === 'CLAUDE.md'));
  assert.equal(map.totals.start, 0);
  assert.equal(map.totals.files, map.files.length);
  assert.equal(map.totals.none, map.files.filter(file => file.reach === 'none').length);
  assert.equal(real.get('AGENTS.md').reach, 'none');
  // V1: the link to the missing CLAUDE.md is still a broken link, and the folder mentions are from the real map.
  const brokenLine = lineOf(path.join(N, 'pipeline/AGENTS.md'), '../CLAUDE.md');
  assert.ok(map.broken.some(item => item.source === 'pipeline/AGENTS.md' && item.line === brokenLine && item.target === 'CLAUDE.md' && item.raw === '../CLAUDE.md'));
  assert.deepEqual(map.broken, noClaude.report.map.broken);
  assert.equal(map.totals.brokenLinks, map.broken.length);
  const noRoute = map.files.filter(file => file.reach === 'none').map(file => file.path);
  for (const item of map.folderMentions) assert.ok(noRoute.some(rel => rel.startsWith(`${item.folder}/`)), item.folder);
  // No AGENTS.md and no CLAUDE.md: the new file has nothing to import, so it brings in no file.
  assert.deepEqual(bare.report.map.virtualStart, { path: 'CLAUDE.md', imports: [], reached: [] });
  assert.ok(!bare.report.startLoad.some(item => item.scope === 'project' && item.what === 'instructions'));
});

// ---------- all faults ----------

test('G1: two runs give the same report and the same page', () => {
  assert.deepEqual(twice.map(item => item.name), ['main', 'off', 'noclaude', 'noclaude-claude-md', 'bare', 'nogit']);
  for (const { name, first, second } of twice) {
    assert.equal(first.json, second.json, `${name}: report.json`);
    assert.equal(first.html, second.html, `${name}: report.html`);
  }
});

test('G2, R8, M10: no run writes into a project or into a settings home', () => {
  for (const [name, dir] of Object.entries(projects)) assert.equal(statusOf(dir), before.status[name], `git status of ${name}`);
  for (const [name, dir] of Object.entries({ ...projects, NOGIT })) assert.equal(snapshot(dir), before.files[name], `files of ${name}`);
  const homes = { settings, settingsOff, settingsClaudeMd, settingsManaged, settingsBoth, settingsBad, settingsUnknown, repoSettings };
  for (const [name, dir] of Object.entries(homes)) assert.equal(snapshot(dir), before.homes[name], `files of ${name}`);
  // R8: no CLAUDE.md is written into a project that has none.
  for (const dir of [N, A3C, A3D, BARE]) assert.ok(!existsSync(path.join(dir, 'CLAUDE.md')));
});

test('G4: the key order of the report, with the 2 new keys of map', () => {
  const keys = Object.keys(R);
  assert.deepEqual(keys.slice(0, keys.indexOf('sessions') + 1),
    // Step 11: the new key `contextRules` is after `contextFiles`.
    ['project', 'claudeSettingsHome', 'tokenMethod', 'listing', 'totals', 'startLoad', 'later', 'contextFiles', 'contextRules', 'map', 'sessions']);
  // Step 11: the new key `fixes` is after `health`.
  assert.deepEqual(keys.slice(keys.indexOf('sessions') + 1), ['intents', 'needs', 'groups', 'duplicates', 'routes', 'health', 'fixes', 'prompt', 'score']);
  for (const item of [main, plain, noClaudeOff]) {
    assert.deepEqual(Object.keys(item.report.map), ['rules', 'totals', 'files', 'broken', 'folderMentions', 'virtualStart']);
    assert.deepEqual(Object.keys(item.report.map.totals), ['files', 'contextFiles', 'start', 'byPath', 'none', 'noneContext', 'brokenLinks', 'maxSteps', 'bySteps']);
    for (const file of item.report.map.files) {
      // Step 11: the new key `why` is after `kind`.
      assert.deepEqual(Object.keys(file), ['path', 'context', 'kind', 'why', 'tokens', 'ignored', 'reach', 'steps', 'pathTokens', 'via', 'route', 'linkedFrom'], file.path);
    }
  }
  assert.deepEqual(Object.keys(R.startLoad.find(item => item.what === 'memory')), ['scope', 'what', 'path', 'tokens', 'via']);
  assert.deepEqual(Object.keys(noClaude.report.startLoad.find(item => item.path === 'AGENTS.md')), ['scope', 'what', 'path', 'tokens', 'via']);
  assert.deepEqual(Object.keys(R.sessions.folders[1]), ['name', 'root', 'worktree', 'files']);
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});
