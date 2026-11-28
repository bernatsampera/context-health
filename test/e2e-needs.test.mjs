// E2E for step 5 (needs): run the real command on a git copy of fixtures/indoeuromap, with a copy of
// fixtures/claude-settings-home plus 3 sessions that this file writes, and the fake claude binary test/fake-claude.mjs.
// No real model call. The ways it can fail (N1 to N22) are in the step 5 failure list. Each test names its cases.
// Step 10 changed the check to needs-check-v2: the input has a "Files now" part, and each missing and had need has
// `savedPath` and `savedQuote`. The cases of that part are in test/e2e-step-10-c.test.mjs. This project has no memory
// folder and the fake answers here have no `now`, so no fact is saved (S9 and S20 of the step 10 failure list).
// Artifact: out/e2e-needs/report.json and report.html (same content on every run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withoutRunFolders } from './report-html.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fake = path.join(repo, 'test', 'fake-claude.mjs');
const prompt = readFileSync(path.join(repo, 'src', 'prompts', 'needs-check-v3.md'), 'utf8');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-indoeuromap';
const id = digit => `${digit.repeat(8)}-0000-0000-0000-000000000000`;
const [B, C] = ['2', '3'].map(id);
const N1 = '95000001-0000-0000-0000-000000000000';
const N2 = '95000002-0000-0000-0000-000000000000';
const N3 = '95000003-0000-0000-0000-000000000000';
const RESEARCH = 'data/research/growth-metrics-2026-10-21/README.md';

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-needs-'));
const project = path.join(work, 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
// The data/research files are git-ignored, also in this repo, so a git copy of the repo can miss them.
if (!existsSync(path.join(project, RESEARCH))) {
  mkdirSync(path.dirname(path.join(project, RESEARCH)), { recursive: true });
  writeFileSync(path.join(project, RESEARCH), '# growth-metrics-2026-10-21\n\nLocal research record.\n');
}
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
git('init', '-q');
git('add', '-A');
const statusBefore = git('status', '--porcelain', '--untracked-files=all', '--ignored');

const settings = path.join(work, 'claude-settings-home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), settings, { recursive: true });
const sessionDir = path.join(settings, 'projects', MAIN);
const fileText = rel => readFileSync(path.join(project, rel), 'utf8');
const userClaude = readFileSync(path.join(settings, 'CLAUDE.md'), 'utf8');
const unslop = readFileSync(path.join(settings, 'skills', 'unslop', 'SKILL.md'), 'utf8');

// Items: { user }, { agent }, { read: abs, text }, { miss: abs }, { grep: pattern, files: [abs] }.
function writeSession(sessionId, start, items) {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: [
    { path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
    { path: `${OLD}/CLAUDE.md`, content: fileText('CLAUDE.md'), type: 'Project' }] } })];
  const tool = (name, input, content, toolUseResult, isError = false) => {
    const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
    records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test',
      content: [{ type: 'tool_use', id: toolId, name, input }], usage } }));
    records.push(rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content,
      ...(isError ? { is_error: true } : {}) }] }, ...(toolUseResult ? { toolUseResult } : {}) }));
  };
  for (const item of items) {
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    if (item.read != null) {
      const lines = item.text.split('\n').length;
      tool('Read', { file_path: item.read }, item.text, { type: 'text', file: { filePath: item.read, content: item.text, numLines: lines, startLine: 1, totalLines: lines } });
    }
    if (item.miss != null) tool('Read', { file_path: item.miss }, 'File does not exist.', null, true);
    if (item.grep != null) tool('Grep', { pattern: item.grep, path: OLD, output_mode: 'files_with_matches' },
      `Found ${item.files.length} files\n${item.files.join('\n')}`, { mode: 'files_with_matches', filenames: item.files, numFiles: item.files.length });
  }
  writeFileSync(path.join(sessionDir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

const abs = rel => `${OLD}/${rel}`;
const real = rel => ({ read: abs(rel), text: fileText(rel) });
const TIKTOK = 'first-iteration/docs/tiktok-first-post-2026-09-27.md';
writeSession(N1, '2026-11-18T10:00:00.000Z', [
  { user: 'Change the city page rule to the top 5 groups.' },
  { read: abs('pipeline/cli.py'), text: `${fileText('pipeline/cli.py')}\ncode-marker-k8` },
  real('second-iteration/decisions/city.md'),
  real('second-iteration/decisions/city.md'),
  { grep: 'profile', files: [abs('CLAUDE.md'), abs(TIKTOK)] },
  real('CLAUDE.md'),
  real(TIKTOK),
  real('.mcp.json'),
  real('.claude/settings.json'),
  real(RESEARCH),
  { read: `${HOME}/notes/todo.md`, text: 'outside-marker-k9 todo list' },
  { read: abs('second-iteration/old-plan.md'), text: '# Old plan\n\nThis file is gone now.\n' },
  { read: `${HOME}/.claude/skills/unslop/SKILL.md`, text: unslop },
  { miss: abs('second-iteration/nope.md') },
  { agent: 'Changed to the top 5 groups.' },
  { user: 'No, counts below 3 people must never be shown.' },
  { agent: 'Fixed.' },
  { user: 'Now the area page. Read second-iteration/plan.md first.' },
  real('second-iteration/plan.md'),
  real('AGENTS.md'),
  real('pipeline/METHOD.md'),
  real('second-iteration/decisions/area.md'),
  real('second-iteration/decisions/city.md'),
  { agent: 'I add a test for the area page.' },
  { user: 'Do not write tests here.' }, { agent: 'Ok.' },
  { user: 'Use the blue map style.' }, { agent: 'Ok.' },
  { user: 'Make the legend bigger.' }, { agent: 'Ok.' },
  { user: 'The rule is in direction.md.' },
  { read: abs('second-iteration/decisions/compare.md'), text: `${fileText('second-iteration/decisions/compare.md')}\ncompare-marker-q7` },
  { agent: 'Done.' }
]);
writeSession(N2, '2026-11-17T10:00:00.000Z', [{ user: 'Rename the button.' }, { agent: 'Done.' }, { user: 'What is the time zone of the server?' }, { agent: 'UTC.' }]);
writeSession(N3, '2026-11-16T10:00:00.000Z', [{ user: 'Run the city batch.' }, { agent: 'I run pip install.' }, { user: 'No, we always use uv run.' }]);

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const cacheA = path.join(work, 'cache-a');
const head = call => call.stdin.split('\n', 1)[0];
// The intents and needs-check calls. Step 8 adds one intent-groups call per run (this test has no fake answer for it).
const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  .filter(call => !head(call).startsWith('context-health intent-groups '));
const checkCalls = list => list.filter(call => head(call).startsWith('context-health needs-check '));
const sessionOf = call => head(call).split(' ').at(-1);

function run({ out, cache = cacheA, intents = true }) {
  const args = [cli, project, '--claude-settings-home', settings, '--old-path', OLD, '--out', out, '--cache', cache, '--no-open', '--verbose', '--ignore', 'none', '--no-save'];
  if (intents) args.push('--intents');
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
  const json = existsSync(path.join(out, 'report.json')) ? readFileSync(path.join(out, 'report.json'), 'utf8') : null;
  const html = existsSync(path.join(out, 'report.html')) ? readFileSync(path.join(out, 'report.html'), 'utf8') : null;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json, html, report: json && JSON.parse(json) };
}
const byId = report => Object.fromEntries(report.needs.sessions.map(entry => [entry.sessionId, entry]));

// R1 and R2: --intents two times with the same cache.
const r1 = run({ out: path.join(work, 'run-1') });
const r1Calls = calls();
const artifact = path.join(repo, 'out', 'e2e-needs');
mkdirSync(artifact, { recursive: true });
const r2 = run({ out: artifact });
const r2Calls = calls().slice(r1Calls.length);
// R3: no --intents, a cache with the intents only.
const cacheC = path.join(work, 'cache-c');
cpSync(path.join(cacheA, 'intents'), path.join(cacheC, 'intents'), { recursive: true });
const r3Before = calls().length;
const r3 = run({ out: path.join(work, 'run-3'), cache: cacheC, intents: false });
const r3Calls = calls().length - r3Before;
// R4: no --intents, the full cache.
const r4Before = calls().length;
const r4 = run({ out: path.join(work, 'run-4'), intents: false });
const r4Calls = calls().length - r4Before;
const statusAfter = git('status', '--porcelain', '--untracked-files=all', '--ignored');

const s1 = byId(r1.report);
const n1 = s1[N1];
const needOf = (intent, rel) => intent.needs.find(need => need.path === rel);

test('N19: one entry for each ok session, after intents, in order', () => {
  assert.equal(r1.status, 0, r1.stderr);
  const keys = Object.keys(r1.report);
  assert.deepEqual(keys.slice(keys.indexOf('intents'), keys.indexOf('intents') + 2), ['intents', 'needs']);
  // Step 12: needs-check-v3. The old fake answers have no `kind`, so each fact counts as a rule (`factKind: null`).
  assert.equal(r1.report.needs.promptVersion, 'needs-check-v3');
  const ok = r1.report.intents.sessions.filter(entry => entry.status === 'ok').map(entry => entry.sessionId);
  assert.deepEqual(ok, [N1, N2, N3, C, B]);
  assert.deepEqual(r1.report.needs.sessions.map(entry => entry.sessionId), ok);
  for (const entry of r1.report.needs.sessions) {
    const intents = byId(r1.report)[entry.sessionId].intents;
    const source = r1.report.intents.sessions.find(item => item.sessionId === entry.sessionId).intents;
    assert.deepEqual(intents.map(intent => [intent.intentId, intent.from, intent.to]), source.map(intent => [intent.id, intent.from, intent.to]));
    for (const intent of intents) {
      assert.deepEqual(intent.needs.map(need => need.id), intent.needs.map((_, index) => `n${index + 1}`));
      const files = intent.needs.filter(need => need.kind === 'file');
      assert.deepEqual(intent.needs.slice(0, files.length), files, 'file needs first');
      assert.deepEqual(files.map(need => need.firstEvent), files.map(need => need.firstEvent).sort((a, b) => a - b));
    }
  }
});

test('N1, N3, N4, N5, N16, N17: the file needs of N1 i1', () => {
  const i1 = n1.intents[0];
  assert.deepEqual(i1.needs.filter(need => need.kind === 'file').map(need => [need.path, need.state]), [
    ['second-iteration/decisions/city.md', 'path'],
    ['CLAUDE.md', 'in_context'],
    [TIKTOK, 'search'],
    // Step 11: the read of the research file is not a need now. Git ignores the file, so it is not a context file,
    // also with the link from second-iteration/metrics.md. Before, it was the 4th need (`path`). It is a dropped read.
    ['second-iteration/old-plan.md', 'gone'],
    ['~/.claude/skills/unslop/SKILL.md', 'path']
  ]);
  assert.equal(needOf(i1, RESEARCH), undefined);
  assert.deepEqual(r1.report.needs.dropped, { needs: 1, reads: 1, files: 1, byReason: { ignored: { needs: 1, reads: 1, files: 1 } },
    list: [{ path: RESEARCH, reason: 'ignored', needs: 1, reads: 1 }] });
  const city = needOf(i1, 'second-iteration/decisions/city.md');
  assert.deepEqual(city, { id: 'n1', kind: 'file', path: 'second-iteration/decisions/city.md', scope: 'project', fileKind: 'doc',
    exists: true, ignored: false, reads: 2, firstEvent: 1, firstMessage: 1, thread: 'main', how: null, tokens: Math.ceil(fileText('second-iteration/decisions/city.md').length / 4),
    knownFrom: { kind: 'none', path: null, message: null, event: null },
    map: { reach: 'path', steps: 3, pathTokens: 719, via: 'link' }, state: 'path' });
  assert.ok(city.tokens > 0);
  const tiktok = needOf(i1, TIKTOK);
  assert.equal(tiktok.knownFrom.kind, 'search');
  assert.deepEqual(tiktok.map, { reach: 'none', steps: null, pathTokens: null, via: null });
  // The research file is still a map file (a context file links it), with `ignored: true` and the kind `excluded`.
  assert.deepEqual(r1.report.map.files.filter(file => file.path === RESEARCH).map(file => [file.ignored, file.context, file.kind, file.why]), [[true, false, 'excluded', 'ignored']]);
  const gone = needOf(i1, 'second-iteration/old-plan.md');
  assert.deepEqual([gone.exists, gone.fileKind, gone.map, gone.ignored], [false, null, null, false]);
  const user = needOf(i1, '~/.claude/skills/unslop/SKILL.md');
  assert.deepEqual([user.scope, user.fileKind, user.map, user.exists, user.knownFrom.kind],
    ['user', 'skill body', { reach: 'path', steps: 1, pathTokens: 0, via: 'trigger' }, true, 'start']);
  const code = fileText('pipeline/cli.py');
  // Step 11: `otherReads` has 2 new keys for the dropped reads. The research file is the one dropped file of this intent.
  assert.deepEqual(i1.otherReads, { codeFiles: 3, codeTokens: i1.otherReads.codeTokens, outsideFiles: 1,
    outsideTokens: Math.ceil('outside-marker-k9 todo list'.length / 4), searches: 1, misses: 1,
    excludedFiles: 1, excludedTokens: Math.ceil(fileText(RESEARCH).length / 4) });
  assert.ok(i1.otherReads.codeTokens >= Math.ceil(code.length / 4));
  for (const rel of ['pipeline/cli.py', '.mcp.json', '.claude/settings.json', '~/notes/todo.md']) assert.equal(needOf(i1, rel), undefined, rel);
});

test('N2, N5, N6, N7: the file needs of N1 i2', () => {
  const [i1, i2] = n1.intents;
  assert.deepEqual(i2.needs.filter(need => need.kind === 'file').map(need => [need.path, need.knownFrom.kind, need.state]), [
    ['second-iteration/plan.md', 'user', 'path'],
    ['AGENTS.md', 'start', 'path'],
    ['pipeline/METHOD.md', 'file', 'path'],
    ['second-iteration/decisions/area.md', 'file', 'path'],
    ['second-iteration/decisions/city.md', 'file', 'in_context'],
    ['second-iteration/decisions/compare.md', 'none', 'path']
  ]);
  assert.equal(needOf(i2, 'pipeline/METHOD.md').knownFrom.path, 'second-iteration/decisions/city.md', 'the first source in the session');
  assert.equal(needOf(i2, 'second-iteration/plan.md').knownFrom.message, 3);
  assert.equal(needOf(i1, 'second-iteration/decisions/area.md'), undefined);
  assert.equal(needOf(i2, 'second-iteration/decisions/city.md').reads, 1);
  const c = byId(r1.report)[C];
  assert.deepEqual(c.intents[1].needs.map(need => [need.path, need.scope, need.state]),
    [['frontend/DESIGN.md', 'project', 'in_context'], ['~/.claude/skills/unslop/SKILL.md', 'user', 'path']]);
  // D2: a nested CLAUDE.md load and a skill body load in the intent are needs found by a path. The @-mention load is not.
  assert.deepEqual(c.intents[0].needs.map(need => [need.path, need.how, need.state, need.knownFrom.kind, need.reads]), [
    ['frontend/CLAUDE.md', 'nested', 'path', 'start', 0],
    ['frontend/DESIGN.md', null, 'path', 'file', 1],
    ['.claude/skills/city-batch/SKILL.md', 'skill', 'path', 'start', 0]]);
  const skill = c.intents[0].needs[2];
  assert.deepEqual([skill.firstEvent, skill.thread, skill.tokens, skill.knownFrom], [4, 'main', 80, { kind: 'start', path: null, message: null, event: null }]);
  assert.equal(c.intents[1].needs[0].how, null, 'the restore load is not a need');
  assert.deepEqual(c.intents[0].otherReads, { codeFiles: 2, codeTokens: c.intents[0].otherReads.codeTokens, outsideFiles: 0, outsideTokens: 0, searches: 1, misses: 0,
    excludedFiles: 0, excludedTokens: 0 });
  const b = byId(r1.report)[B];
  assert.deepEqual(b.intents[0].needs.filter(need => need.kind === 'file').map(need => [need.path, need.state]), [
    ['pipeline/METHOD.md', 'search'], ['second-iteration/decisions/compare.md', 'search'], [TIKTOK, 'no_path'], ['second-iteration/direction.md', 'path']]);
});

test('N8, N9, N10, N11: the missing and had needs of N1', () => {
  const [i1, i2] = n1.intents;
  assert.deepEqual(n1.check, { status: 'ok', reason: null, costUsd: 0.012 });
  // Step 11: the id is n6 (before: n7), because the intent has one file need less (the research file).
  assert.deepEqual(i1.needs.at(-1), { id: 'n6', kind: 'missing', path: null, correctionId: 'c1', message: 2,
    text: 'Counts below 3 people must never be shown', quote: 'counts below 3 people must never be shown', checkResult: 'not-found', sourceQuote: null,
    savedPath: null, savedQuote: null, factKind: null });
  const others = i2.needs.filter(need => need.kind !== 'file');
  assert.deepEqual(others.map(need => [need.id, need.kind, need.correctionId, need.message, need.path, need.checkResult, need.sourceQuote]), [
    ['n7', 'had', 'c2', 4, 'CLAUDE.md', 'had', 'Do not write, run, or keep tests.'],
    ['n8', 'missing', 'c3', 5, null, 'bad-quote', null],
    ['n9', 'missing', 'c5', 7, null, 'bad-quote', null]
  ]);
  // Step 10 (S9, S10): the 2 new keys are the last keys of each missing and had need. The old fake answers have no `now`, so nothing is saved.
  for (const need of [...i1.needs, ...i2.needs, ...byId(r1.report)[B].intents[0].needs].filter(item => item.kind !== 'file')) {
    // Step 12: `factKind` is the last key of a missing need. A had need does not have it.
    assert.deepEqual(Object.keys(need), [...['id', 'kind', 'path', 'correctionId', 'message', 'text', 'quote', 'checkResult', 'sourceQuote', 'savedPath', 'savedQuote'], ...(need.kind === 'missing' ? ['factKind'] : [])]);
    assert.deepEqual([need.savedPath, need.savedQuote], [null, null], need.correctionId);
  }
  for (const need of i1.needs.filter(item => item.kind === 'file')) assert.ok(!('savedPath' in need), 'a file need has no saved keys');
  assert.ok(!i2.needs.some(need => need.correctionId === 'c4'), 'changed-mind gives no need');
  // Step 11: 5 file needs (before: 6). The read of the research file is a dropped read.
  assert.deepEqual(i1.totals, { fileNeeds: 5, missing: 1, had: 0 });
  assert.deepEqual(i2.totals, { fileNeeds: 6, missing: 2, had: 1 });
  const b = byId(r1.report)[B];
  assert.deepEqual(b.check, { status: 'ok', reason: null, costUsd: 0.008 });
  assert.deepEqual(b.intents[0].needs.at(-1).checkResult, 'not-found');
});

test('N12: a failed check keeps the needs missing and the report', () => {
  const n3 = s1[N3];
  assert.deepEqual(n3.check, { status: 'failed', reason: 'claude exited with code 1', costUsd: null });
  assert.deepEqual(n3.intents[0].needs.map(need => [need.kind, need.correctionId, need.checkResult]), [['missing', 'c1', 'not-checked']]);
  assert.equal(checkCalls(r1Calls).filter(call => sessionOf(call) === N3).length, 2);
  assert.deepEqual(readdirSync(path.join(cacheA, 'needs')).map(name => name.split('.')[0]).sort(), [B, N1].sort());
});

test('N13: no --intents makes no check call', () => {
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(r3Calls, 0);
  const s3 = byId(r3.report);
  for (const sessionId of [N1, N3, B]) {
    assert.deepEqual(s3[sessionId].check, { status: 'not-analysed', reason: 'not analysed: run with --intents', costUsd: null }, sessionId);
    for (const need of s3[sessionId].intents.flatMap(intent => intent.needs).filter(need => need.kind !== 'file')) {
      assert.deepEqual([need.kind, need.checkResult, need.path, need.savedPath, need.savedQuote], ['missing', 'not-checked', null, null, null]);
    }
  }
  assert.match(r3.stdout, /needs: 3 sessions have a missing-context check that is not analysed/);
  assert.equal(r4Calls, 0);
  const s4 = byId(r4.report);
  for (const sessionId of [N1, B, C, N2]) assert.deepEqual(s4[sessionId], s1[sessionId]);
  assert.equal(s4[N3].check.status, 'not-analysed');
});

test('N14, N18: no check call without a missing-context correction, an intent with no reads', () => {
  for (const sessionId of [C, N2]) {
    assert.deepEqual(s1[sessionId].check, { status: 'not-needed', reason: null, costUsd: null });
    assert.equal(checkCalls(r1Calls).filter(call => sessionOf(call) === sessionId).length, 0);
  }
  for (const intent of s1[N2].intents) {
    assert.deepEqual([intent.needs, intent.totals, intent.otherReads], [[], { fileNeeds: 0, missing: 0, had: 0 },
      { codeFiles: 0, codeTokens: 0, outsideFiles: 0, outsideTokens: 0, searches: 0, misses: 0, excludedFiles: 0, excludedTokens: 0 }]);
  }
});

test('N15, N21: the check input and the call are safe', () => {
  const list = [...checkCalls(r1Calls), ...checkCalls(r2Calls)];
  assert.deepEqual(checkCalls(r1Calls).map(sessionOf).sort(), [N1, N3, N3, B].sort());
  const tmp = realpathSync(os.tmpdir());
  for (const call of list) {
    assert.deepEqual(call.argv, ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--no-session-persistence',
      '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config', '--system-prompt', prompt]);
    assert.ok(call.cwd.startsWith(`${tmp}/`) && !call.cwd.startsWith(realpathSync(work)), call.cwd);
    assert.match(head(call), /^context-health needs-check needs-check-v3 session [0-9a-f-]{36}$/);
  }
  assert.equal(new Set(list.map(call => call.cwd)).size, list.length);
  const stdin = checkCalls(r1Calls).find(call => sessionOf(call) === N1).stdin;
  assert.ok(stdin.includes('## Correction c1 (message 2)\nFact: Counts below 3 people must never be shown'));
  assert.ok(stdin.includes('Files the agent had: ~/.claude/CLAUDE.md, CLAUDE.md, second-iteration/decisions/city.md, '));
  assert.ok(stdin.includes('## File CLAUDE.md\n') && stdin.includes('Do not write, run, or keep tests.'));
  assert.ok(stdin.includes('## File second-iteration/decisions/area.md\n'));
  assert.ok(!stdin.includes('## Correction c4'));
  for (const marker of ['compare-marker-q7', 'code-marker-k8', 'outside-marker-k9', '## File .mcp.json']) assert.ok(!stdin.includes(marker), marker);
  // Step 10: the "Files now" part comes after the files the agent had. The texts in it come from the disk of today, so the
  // marker that only the session text of compare.md has is not in it. With no memory folder (S20) it holds the start
  // load files of today and the word matches. A start file with the text the agent had gets one line, not its text again.
  const at = stdin.indexOf('\n\nFiles now: ');
  assert.ok(at > stdin.indexOf('## File second-iteration/decisions/area.md\n'), 'the part is at the end');
  const nowPaths = stdin.slice(at).split('\n\n## File now ').slice(1).map(block => block.split('\n', 1)[0]);
  assert.equal(stdin.slice(at + 2).split('\n', 1)[0], `Files now: ${nowPaths.length}`);
  assert.deepEqual(nowPaths.slice(0, 2), ['~/.claude/CLAUDE.md', 'CLAUDE.md'], 'the start load files of today come first');
  assert.ok(nowPaths.length > 2 && nowPaths.length <= 2 + 5 * 4, 'then up to 5 word matches for each of the 4 corrections');
  assert.equal(new Set(nowPaths).size, nowPaths.length, 'no file two times');
  assert.ok(!nowPaths.some(rel => rel.includes('/memory/')), 'no memory file');
  assert.ok(stdin.includes('## File now CLAUDE.md\n[the same text as under "## File CLAUDE.md"]'));
  assert.equal(stdin.split(fileText('CLAUDE.md').trim()).length - 1, 1, 'the text of CLAUDE.md is in the input one time');
  assert.ok(stdin.length - at <= 60000 + 2);
  assert.equal(statusAfter, statusBefore);
});

test('N20: a second run uses the cache and gives the same report', () => {
  assert.deepEqual(checkCalls(r2Calls).map(sessionOf), [N3, N3]);
  assert.equal(r2Calls.length, 2, 'no intents call either');
  assert.equal(r2.json, r1.json);
  assert.equal(withoutRunFolders(r2.html), withoutRunFolders(r1.html));
});

test('N22: the page shows the needs', () => {
  // Step 8 page: each need of each session is in the page data of its session row. A file need (not gone) is a file
  // of the session view, with as many uses as intents that needed it. A missing need is a "told by you" problem.
  // A had need and a gone need are not shown.
  const data = JSON.parse(r1.html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
  let checked = 0;
  for (const entry of r1.report.needs.sessions) {
    const row = data.sessions.find(item => item.id === entry.sessionId);
    const needs = entry.intents.flatMap(intent => intent.needs);
    for (const need of needs) {
      checked += 1;
      if (need.kind === 'file' && need.state !== 'gone') {
        const uses = needs.filter(item => item.kind === 'file' && item.path === need.path).length;
        assert.equal(row.files.find(file => file.path === need.path)?.uses, uses, `${entry.sessionId} ${need.id}`);
      } else if (need.kind === 'file') {
        assert.ok(!row.files.some(file => file.path === need.path), `gone ${need.path}`);
      } else {
        const shown = row.problems.filter(item => item.kind === 'missing' && item.text === need.text);
        assert.equal(shown.length, need.kind === 'missing' ? 1 : 0, `${entry.sessionId} ${need.id} ${need.kind}`);
      }
    }
  }
  assert.ok(checked >= 10);
  assert.ok(data.sessions.some(item => item.files.some(file => file.path === 'second-iteration/decisions/city.md')));
  assert.ok(data.sessions.some(item => item.problems.some(problem => problem.kind === 'missing' && problem.text.startsWith('Counts below 3 people must never be shown'))));
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});
