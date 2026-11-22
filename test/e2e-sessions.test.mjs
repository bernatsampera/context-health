// E2E for step 3 (sessions): run the real command on a git copy of fixtures/indoeuromap, with a copy of the fake sessions in
// fixtures/claude-settings-home/projects/ plus 2 sessions that this file writes (H, I), and --old-path /Users/example/projects/indoeuromap.
// The ways it can fail (S1 to S23) are in the step 3 failure list. Each test names its cases.
// Artifact: out/e2e-sessions/report.json and report.html (same content on every run).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const repoSettings = path.join(repo, 'fixtures', 'claude-settings-home');
const fixture = path.join(repo, 'fixtures', 'indoeuromap');
const OLD = '/Users/example/projects/indoeuromap';
const MAIN = '-Users-example-projects-indoeuromap';
const WT = '-Users-example-projects-indoeuromap--worktrees-fix-city';
const id = digit => `${digit.repeat(8)}-0000-0000-0000-000000000000`;

function snapshot(dir) {
  const hash = createHash('sha256');
  const walk = rel => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else hash.update(child).update(readFileSync(path.join(dir, child)));
    }
  };
  walk('');
  return hash.digest('hex');
}

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-sessions-'));
const project = path.join(work, 'indoeuromap');
cpSync(fixture, project, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
git('init', '-q');
git('add', '-A');
const statusBefore = git('status', '--porcelain', '--untracked-files=all', '--ignored');
const repoSettingsBefore = snapshot(repoSettings);

// A copy of the settings home with 2 more sessions in the main folder.
const claudeSettingsHome = path.join(work, 'claude-settings-home');
cpSync(repoSettings, claudeSettingsHome, { recursive: true });
const H = '98000001-0000-0000-0000-000000000000';
const I = '98000002-0000-0000-0000-000000000000';
const OTHER = '/Users/other/work/indoeuromap';
const fixtureText = rel => readFileSync(path.join(fixture, rel), 'utf8');
// Items: { user }, { agent }, { read: abs, text }, { bash: command, out }, { instructions: [{ path, content, type }] }, { cwd }.
function writeSession(sessionId, start, items) {
  let cwd = OLD;
  let k = 0;
  const rec = extra => { k += 1; return { isSidechain: false, userType: 'external', cwd, sessionId, version: '2.1.300', gitBranch: 'main',
    entrypoint: 'cli', uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [];
  const tool = (name, input, content, toolUseResult) => {
    const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
    records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: toolId, name, input }], usage } }));
    records.push(rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content }] }, toolUseResult }));
  };
  for (const item of items) {
    if (item.cwd) cwd = item.cwd;
    if (item.instructions) records.push(rec({ type: 'attachment', attachment: { type: 'instructions', files: item.instructions } }));
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    if (item.read != null) {
      const count = item.text.split('\n').length;
      tool('Read', { file_path: item.read }, item.text, { type: 'text', file: { filePath: item.read, content: item.text, numLines: count, startLine: 1, totalLines: count } });
    }
    if (item.bash != null) tool('Bash', { command: item.bash, description: 'Run a command' }, item.out,
      { stdout: item.out, stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
  }
  writeFileSync(path.join(claudeSettingsHome, 'projects', MAIN, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}
// H: a moved session. It started in another folder on another machine (other home), then went on in the fixture root.
// Only the first instructions attachment is the start load.
writeSession(H, '2026-11-01T09:00:00.000Z', [
  { cwd: OTHER, instructions: [{ path: '/Users/other/.claude/CLAUDE.md', content: readFileSync(path.join(repoSettings, 'CLAUDE.md'), 'utf8'), type: 'User' },
    { path: `${OTHER}/CLAUDE.md`, content: fixtureText('CLAUDE.md'), type: 'Project' }] },
  { user: 'Check the agents file.' },
  { read: `${OTHER}/AGENTS.md`, text: fixtureText('AGENTS.md') },
  { agent: 'Checked.' },
  { cwd: OLD, instructions: [{ path: `${OLD}/README.md`, content: fixtureText('README.md'), type: 'Project' }] },
  { user: 'Now the plan.' },
  { read: `${OLD}/second-iteration/plan.md`, text: fixtureText('second-iteration/plan.md') }
]);
// I: Bash reads. One cat of 2 files, then a read of a file that only the second file names.
// Then a cat with a find in the same command, then a read of a file that only the find output names.
const CITY = 'second-iteration/decisions/city.md';
const AREA = 'second-iteration/decisions/area.md';
const FIND_OUT = 'second-iteration/outreach/findings.md\nsecond-iteration/outreach/index.md\nsecond-iteration/outreach/show-hn.md\n';
writeSession(I, '2026-11-02T09:00:00.000Z', [
  { instructions: [{ path: `${OLD}/CLAUDE.md`, content: fixtureText('CLAUDE.md'), type: 'Project' }] },
  { user: 'Compare the city and area decisions.' },
  { bash: `cat ${CITY} ${AREA}`, out: `${fixtureText(CITY)}${fixtureText(AREA)}` },
  { read: `${OLD}/first-iteration/docs/NOW.md`, text: fixtureText('first-iteration/docs/NOW.md') },
  { agent: 'Compared.' },
  { user: 'Now the outreach notes.' },
  { bash: "cat .gitignore && find second-iteration/outreach -name '*.md'", out: `${fixtureText('.gitignore')}${FIND_OUT}` },
  { read: `${OLD}/second-iteration/outreach/show-hn.md`, text: fixtureText('second-iteration/outreach/show-hn.md') }
]);
const settingsBefore = snapshot(claudeSettingsHome);

const run = out => execFileSync('node', [cli, project, '--claude-settings-home', claudeSettingsHome, '--old-path', OLD,
  '--out', out, '--no-open', '--no-save'], { encoding: 'utf8' });
const firstOut = path.join(work, 'run-1');
run(firstOut);
const artifact = path.join(repo, 'out', 'e2e-sessions');
mkdirSync(artifact, { recursive: true });
run(artifact);
const json = readFileSync(path.join(artifact, 'report.json'), 'utf8');
const html = readFileSync(path.join(artifact, 'report.html'), 'utf8');
const sessions = JSON.parse(json).sessions;
const byId = Object.fromEntries(sessions.list.map(session => [session.sessionId, session]));
const [A, B, C, D] = ['1', '2', '3', '4'].map(digit => byId[id(digit)]);

// Expected tokens come from the fixture files: characters / 4, rounded up, of the text the tool returned.
const fileText = rel => readFileSync(path.join(fixture, rel), 'utf8');
const lines = (text, from = 1, count) => {
  const all = text.split('\n');
  if (all.at(-1) === '') all.pop();
  return all.slice(from - 1, count ? from - 1 + count : undefined);
};
const tok = text => Math.ceil(text.length / 4);
const readTokens = (rel, from, count) => tok(lines(fileText(rel), from, count).join('\n'));
const lineCount = rel => lines(fileText(rel)).length;
const known = (kind, { path = null, message = null, event = null } = {}) => ({ kind, path, message, event });
const brief = event => ({ i: event.i, kind: event.kind, path: event.path, thread: event.thread });

test('S1, S2, S21: only the fixture folders, no sibling, newest first', () => {
  assert.equal(sessions.tokenMethod, 'characters / 4, rounded up (estimate)');
  assert.deepEqual(sessions.oldPaths, [OLD]);
  assert.deepEqual(sessions.folders, [
    { name: MAIN, root: OLD, worktree: null, files: 7 },
    { name: WT, root: `${OLD}/.worktrees/fix-city`, worktree: 'fix-city', files: 1 }
  ]);
  assert.deepEqual(sessions.list.map(session => session.sessionId), [id('4'), id('3'), id('2'), id('1'), I, H]);
  assert.ok(!json.includes('77777777') && !json.includes('indoeuromap-old'), 'the sibling folder is not read');
});

test('S3: the worktree session has root paths and a worktree tag', () => {
  assert.equal(D.worktree, 'fix-city');
  assert.equal(D.folder, WT);
  assert.equal(D.gitBranch, 'fix-city');
  assert.deepEqual(D.startLoad.map(item => item.path), ['~/.claude/CLAUDE.md', 'CLAUDE.md']);
  assert.deepEqual(D.events.map(brief), [{ i: 0, kind: 'read', path: 'AGENTS.md', thread: 'main' }]);
  assert.equal(D.events[0].inProject, true);
  assert.deepEqual(D.events[0].knownFrom, known('start', { path: 'CLAUDE.md' }));
});

test('S4, S5: headless and empty sessions are skipped, a session that went on through the SDK is kept', () => {
  assert.deepEqual(sessions.skipped, [
    { folder: MAIN, file: `${id('5')}.jsonl`, reason: 'headless' },
    { folder: MAIN, file: `${id('6')}.jsonl`, reason: 'no-user-message' }
  ]);
  assert.equal(A.entrypoint, 'cli');
  assert.equal(B.events.length, 8, 'the damaged line in B does not stop the parse');
});

test('S7, S8: session A follows the link chain and edits one file', () => {
  assert.deepEqual(A.startLoad, [
    { path: '~/.claude/CLAUDE.md', type: 'User', tokens: tok(readFileSync(path.join(claudeSettingsHome, 'CLAUDE.md'), 'utf8')) },
    { path: 'CLAUDE.md', type: 'Project', tokens: tok(fileText('CLAUDE.md')) }
  ]);
  assert.equal(A.startedAt, '2026-11-08T09:00:01.000Z');
  assert.equal(A.gitBranch, 'main');
  assert.deepEqual(A.messages, [{ n: 1, kind: 'user', text: 'Change the city page decision: city pages show the top 5 groups, not the top 10. Update the decision file.',
    cut: false, mentions: [], firstEvent: 0 }]);
  const chain = ['AGENTS.md', 'llms.txt', 'second-iteration/decisions/index.md', 'second-iteration/decisions/city.md'];
  assert.deepEqual(A.events.map(event => `${event.kind} ${event.path}`), [...chain.map(file => `read ${file}`), 'edit second-iteration/decisions/city.md']);
  assert.deepEqual(A.events.slice(0, 4).map(event => event.knownFrom), [
    known('start', { path: 'CLAUDE.md' }),
    known('file', { path: 'AGENTS.md' }),
    known('file', { path: 'AGENTS.md' }),
    known('file', { path: 'second-iteration/decisions/index.md' })
  ]);
  chain.forEach((file, i) => {
    const event = A.events[i];
    assert.deepEqual(event, { i, message: 1, thread: 'main', parentEvent: null, kind: 'read', tool: 'Read', path: file,
      tokens: readTokens(file), inProject: true, lines: { from: 1, count: lineCount(file), total: lineCount(file) },
      knownFrom: event.knownFrom, repeat: false, afterOwnWrite: false });
  });
  assert.deepEqual(A.events[4], { i: 4, message: 1, thread: 'main', parentEvent: null, kind: 'edit', tool: 'Edit',
    path: 'second-iteration/decisions/city.md', tokens: null, inProject: true });
  assert.deepEqual(A.usage, { firstRequestTokens: 21004, peakContextTokens: 30403 });
  assert.deepEqual(A.compactions, []);
});

test('S6, S7, S8, S9, S10, S18, S19: session B searches, reads by Bash, misses, and gets a correction', () => {
  assert.deepEqual(B.messages.map(message => [message.n, message.kind, message.cut, message.firstEvent]),
    [[1, 'user', true, 0], [2, 'user', false, 7]]);
  assert.equal(B.messages[0].text.length, 300);
  assert.ok(B.messages[0].text.startsWith('How does the profile rule decide'));
  assert.deepEqual(B.events.map(event => `${event.kind} ${event.tool} ${event.path}`), [
    'search Grep null', 'search Glob null', 'search Bash null',
    'read Read pipeline/METHOD.md', 'read Bash second-iteration/decisions/compare.md',
    'miss Read second-iteration/decisions/compare-demand.md',
    'read Read first-iteration/docs/tiktok-first-post-2026-09-27.md', 'read Read second-iteration/direction.md'
  ]);
  const [grep, glob, ls, method, cat, miss, orphan, direction] = B.events;
  assert.deepEqual([grep.query, grep.target, grep.resultPaths], ['profile rule', '.', ['pipeline/METHOD.md']]);
  assert.equal(grep.tokens, tok(`Found 1 file\n${OLD}/pipeline/METHOD.md`));
  assert.deepEqual([glob.query, glob.target], ['pipeline/**/*.md', '.']);
  assert.ok(glob.resultPaths.includes('pipeline/city-factory/README.md') && glob.resultPaths.every(file => file.startsWith('pipeline/')));
  assert.deepEqual([ls.query, ls.target], [null, 'second-iteration/decisions']);
  assert.ok(ls.resultPaths.includes('second-iteration/decisions/compare.md'));
  assert.deepEqual(method.lines, { from: 1, count: 40, total: lineCount('pipeline/METHOD.md') });
  assert.equal(method.tokens, readTokens('pipeline/METHOD.md', 1, 40));
  assert.deepEqual(method.knownFrom, known('search', { event: 0 }));
  assert.equal(cat.tokens, tok(fileText('second-iteration/decisions/compare.md')));
  assert.equal(cat.lines, null);
  assert.deepEqual(cat.knownFrom, known('search', { event: 2 }), 'the ls rule');
  assert.equal(miss.inProject, false);
  assert.deepEqual(miss.knownFrom, known('file', { path: 'second-iteration/decisions/compare.md' }));
  assert.deepEqual(orphan.knownFrom, known('none'));
  assert.deepEqual(orphan.lines, { from: 1, count: 20, total: lineCount('first-iteration/docs/tiktok-first-post-2026-09-27.md') });
  assert.equal(direction.message, 2);
  assert.deepEqual(direction.knownFrom, known('user', { message: 2 }));
  assert.ok(!B.events.some(event => event.query === 'git status'), 'git status gives no event');
  assert.ok(!json.includes('private-marker-x9q4') && !html.includes('private-marker-x9q4'), 'no tool output in the report');
  assert.deepEqual(B.totals, { userMessages: 2, reads: 4, filesRead: 4,
    readTokens: method.tokens + cat.tokens + orphan.tokens + direction.tokens,
    searches: 3, searchTokens: grep.tokens + glob.tokens + ls.tokens, loads: 0, edits: 0, misses: 1 });
});

test('S11, S12, S13, S14, S15: session C has loads, a subagent and a compaction', () => {
  assert.deepEqual(C.messages.map(message => message.kind), ['user', 'command', 'answer', 'denied', 'interruption', 'user']);
  assert.deepEqual(C.messages.map(message => message.text).slice(1, 5), ['/brief', 'Which page first? Madrid area pages',
    'Do not build yet. Check the layout file first.', '[Request interrupted by user]']);
  assert.deepEqual(C.messages[0].mentions, ['second-iteration/decisions/area.md']);
  assert.deepEqual(C.events.map(event => `${event.i} ${event.message} ${event.thread} ${event.parentEvent} ${event.kind} ${event.how || event.tool} ${event.path}`), [
    '0 1 main null load mention second-iteration/decisions/area.md',
    '1 1 main null read Read frontend/src/layouts/LayoutV2.astro',
    '2 1 main null load nested frontend/CLAUDE.md',
    '3 1 main null read Read frontend/DESIGN.md',
    '4 1 main null load skill .claude/skills/city-batch/SKILL.md',
    '5 4 agent:a1 5 search Grep null',
    '6 4 agent:a1 5 read Read pipeline/cli.py',
    '7 5 main null load restore frontend/DESIGN.md',
    '8 6 main null read Read frontend/DESIGN.md',
    '9 6 main null read Read ~/.claude/skills/unslop/SKILL.md'
  ]);
  const ev = C.events;
  assert.deepEqual(ev[0], { i: 0, message: 1, thread: 'main', parentEvent: null, kind: 'load', tool: null,
    path: 'second-iteration/decisions/area.md', tokens: readTokens('second-iteration/decisions/area.md'), inProject: true, how: 'mention' });
  assert.deepEqual(ev[1].knownFrom, known('none'));
  assert.deepEqual(ev[3].knownFrom, known('file', { path: 'frontend/CLAUDE.md' }));
  assert.deepEqual([ev[5].query, ev[5].target, ev[5].resultPaths], ['run_city', 'pipeline', ['pipeline/cli.py', 'pipeline/steps/run_city.py']]);
  assert.deepEqual(ev[6].lines, { from: 1, count: lineCount('pipeline/cli.py'), total: null });
  assert.equal(ev[6].tokens, readTokens('pipeline/cli.py'));
  assert.deepEqual(ev[6].knownFrom, known('search', { event: 5 }));
  assert.deepEqual(C.compactions, [{ beforeEvent: 7, preTokens: 150000, postTokens: 9000 }]);
  assert.equal(ev[3].repeat, false);
  assert.equal(ev[8].repeat, true);
  assert.deepEqual(ev[8].knownFrom, known('file', { path: 'frontend/CLAUDE.md' }));
  assert.equal(ev[9].inProject, false);
  assert.deepEqual(ev[9].knownFrom, known('start', { path: '~/.claude/CLAUDE.md' }));
  assert.deepEqual(C.messages.map(message => message.firstEvent), [0, 5, 5, 5, 7, 8]);
  assert.deepEqual(C.usage, { firstRequestTokens: 23005, peakContextTokens: 64003 });
  assert.equal(C.totals.loads, 4);
  assert.equal(C.totals.reads, 5);
  assert.equal(C.totals.filesRead, 4);
});

test('S20: top totals are the sums over the list', () => {
  const sum = key => sessions.list.reduce((total, session) => total + session.totals[key], 0);
  assert.deepEqual(sessions.totals, { sessions: 6, userMessages: sum('userMessages'), reads: sum('reads'),
    readTokens: sum('readTokens'), searches: sum('searches') });
  for (const session of sessions.list) {
    const count = kind => session.events.filter(event => event.kind === kind).length;
    assert.deepEqual([session.totals.reads, session.totals.searches, session.totals.loads, session.totals.edits, session.totals.misses],
      [count('read'), count('search'), count('load'), count('edit'), count('miss')], session.sessionId);
    session.events.forEach((event, i) => assert.equal(event.i, i));
    session.messages.forEach((message, i) => assert.equal(message.n, i + 1));
  }
});

test('S24, S25: a Bash read of 2 files gives each file its own tokens and text', () => {
  const s = byId[I];
  assert.deepEqual(s.events.map(event => `${event.i} ${event.kind} ${event.tool} ${event.path}`), [
    `0 read Bash ${CITY}`, `1 read Bash ${AREA}`, '2 read Read first-iteration/docs/NOW.md',
    '3 read Bash .gitignore', '4 read Read second-iteration/outreach/show-hn.md']);
  // Finding 4: the tokens of each file come from the file, not an even split of the output.
  assert.deepEqual([s.events[0].tokens, s.events[1].tokens], [tok(fixtureText(CITY)), tok(fixtureText(AREA))]);
  // Each file has its text, so a file that only area.md names is known from area.md.
  assert.deepEqual(s.events[2].knownFrom, known('file', { path: AREA }));
  // Finding 5: a command with 2 parts. The file gets only its own text and tokens. The find output is a search source.
  assert.equal(s.events[3].tokens, tok(fixtureText('.gitignore')));
  assert.deepEqual(s.events[4].knownFrom, known('search', { event: 3 }));
});

test('S26: a moved session from another machine, with a second instructions attachment', () => {
  const s = byId[H];
  assert.equal(s.folder, MAIN);
  assert.deepEqual(s.startLoad.map(item => [item.path, item.type]), [['~/.claude/CLAUDE.md', 'User'], ['CLAUDE.md', 'Project']]);
  assert.deepEqual(s.events.map(event => [event.path, event.inProject, event.message]), [['AGENTS.md', true, 1], ['second-iteration/plan.md', true, 2]]);
  assert.deepEqual(s.events[0].knownFrom, known('start', { path: 'CLAUDE.md' }));
  assert.ok(!JSON.stringify(s).includes('/Users/other'), 'no path of the other machine');
});

test('S16: the command writes nothing into the project or the settings home', () => {
  assert.equal(git('status', '--porcelain', '--untracked-files=all', '--ignored'), statusBefore);
  assert.equal(snapshot(claudeSettingsHome), settingsBefore);
  assert.equal(snapshot(repoSettings), repoSettingsBefore);
});

test('S17: two runs give the same report', () => {
  assert.equal(readFileSync(path.join(firstOut, 'report.json'), 'utf8'), json);
  assert.equal(readFileSync(path.join(firstOut, 'report.html'), 'utf8'), html);
});

test('S22: the page has one Sessions row per session, newest first', () => {
  // Step 8: the Sessions view is drawn from the page data.
  const data = JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
  assert.ok(html.includes('data-v="sessions"'));
  assert.deepEqual(data.sessions.map(item => item.id), sessions.list.map(session => session.sessionId));
  for (const [k, session] of sessions.list.entries()) {
    const first = session.messages.find(message => message.kind === 'user') || session.messages[0];
    assert.ok(data.sessions[k].first.startsWith(first.text.replace(/\s+/g, ' ').trim().slice(0, 100)), session.sessionId);
    assert.equal(data.sessions[k].when, `${session.startedAt.slice(0, 10)} ${session.startedAt.slice(11, 16)} UTC`);
  }
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});
