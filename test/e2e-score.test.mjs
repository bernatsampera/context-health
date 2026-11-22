// E2E for step 6 (score): run the real command on a git copy of fixtures/indoeuromap, with a copy of
// fixtures/claude-settings-home plus 5 sessions that this file writes, and the fake claude binary test/fake-claude.mjs.
// No real model call. The ways it can fail (X1 to X19) are in the step 6 failure list. Each test names its cases.
// All expected numbers are worked out by hand in the comments. A read text of 4 x k characters is k tokens.
// Artifact: out/e2e-score/report.json and report.html (same content on every run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fake = path.join(repo, 'test', 'fake-claude.mjs');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const MAIN = '-Users-example-projects-indoeuromap';
const id = digit => `${digit.repeat(8)}-0000-0000-0000-000000000000`;
const [A, B, C, D] = ['1', '2', '3', '4'].map(id);
const S = n => `9600000${n}-0000-0000-0000-000000000000`;
const [S1, S2, S3, S4, S5, S6, S7] = [1, 2, 3, 4, 5, 6, 7].map(S);
const RESEARCH = 'data/research/growth-metrics-2026-10-21/README.md';
const TIKTOK = 'first-iteration/docs/tiktok-first-post-2026-09-27.md';
const METHOD = 'pipeline/METHOD.md';
const COMPARE = 'second-iteration/decisions/compare.md';
const GONE = 'second-iteration/old-gone.md';
const GONE2 = 'second-iteration/old-plan-gone.md';

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-score-'));
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

const settings = path.join(work, 'claude-settings-home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), settings, { recursive: true });
const sessionDir = path.join(settings, 'projects', MAIN);
const fileText = rel => readFileSync(path.join(project, rel), 'utf8');
const userClaude = readFileSync(path.join(settings, 'CLAUDE.md'), 'utf8');

// Items: { user }, { agent }, { read: abs, text }, { grep: pattern, files: [abs], text? },
// { task: agentId, items: [read and grep items] } (an Agent call in the main thread and its subagent file).
function writeSession(sessionId, start, items) {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: [
    { path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
    { path: `${OLD}/CLAUDE.md`, content: fileText('CLAUDE.md'), type: 'Project' }] } })];
  const tool = (list, extra, name, input, content, toolUseResult) => {
    const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
    list.push(rec({ ...extra, type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test',
      content: [{ type: 'tool_use', id: toolId, name, input }], usage } }));
    list.push(rec({ ...extra, type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content }] }, toolUseResult }));
    return toolId;
  };
  const toolItem = (list, extra, item) => {
    if (item.read != null) {
      const lines = item.text.split('\n').length;
      tool(list, extra, 'Read', { file_path: item.read }, item.text, { type: 'text', file: { filePath: item.read, content: item.text, numLines: lines, startLine: 1, totalLines: lines } });
    }
    if (item.grep != null) tool(list, extra, 'Grep', { pattern: item.grep, path: OLD, output_mode: 'files_with_matches' },
      item.text ?? `Found ${item.files.length} files\n${item.files.join('\n')}`, { mode: 'files_with_matches', filenames: item.files, numFiles: item.files.length });
  };
  for (const item of items) {
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    toolItem(records, {}, item);
    if (item.task != null) {
      const sub = [];
      for (const inner of item.items) toolItem(sub, { isSidechain: true, agentId: item.task }, inner);
      const toolId = tool(records, {}, 'Agent', { description: `Helper ${item.task}`, prompt: 'Check the rule.', subagent_type: 'general-purpose' }, 'Done.', { agentId: item.task });
      const dir = path.join(sessionDir, sessionId, 'subagents');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `agent-${item.task}.jsonl`), `${sub.map(record => JSON.stringify(record)).join('\n')}\n`);
      writeFileSync(path.join(dir, `agent-${item.task}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: `Helper ${item.task}`, toolUseId: toolId }));
    }
  }
  writeFileSync(path.join(sessionDir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

const abs = rel => `${OLD}/${rel}`;
// A read of `rel` whose result text is exactly `tokens` tokens. The filler names no path.
const read = (rel, tokens) => ({ read: rel.startsWith('/') ? rel : abs(rel), text: 'x'.repeat(tokens * 4) });

// S1. Event numbers (i) in the comments. Needs: i1 n1 CLAUDE.md, n2 city.md, n3 METHOD.md, n4 missing c1.
// i2 n1 city.md, n2 old-gone.md, n3 had c3. i3 no needs. i4 n1 missing c4, n2 missing c5.
writeSession(S1, '2026-11-19T10:00:00.000Z', [
  { user: 'Change the city page rule to the top 5 groups.' },
  { grep: 'profile', files: [abs(METHOD)] },          // 0 search
  read('CLAUDE.md', 200),                              // 1 in_context (start load): readTokens only
  read('second-iteration/decisions/city.md', 800),     // 2 path: needed
  read('pipeline/cli.py', 900),                        // 3 code: not in Cheap
  read('second-iteration/decisions/city.md', 800),     // 4 repeat: readTokens only
  read('.mcp.json', 50),                               // 5 config: not in Cheap
  read(METHOD, 1000),                                  // 6 search: needed, windowEnd
  read(`${HOME}/notes/todo.md`, 70),                   // 7 outside: not in Cheap
  { agent: 'Changed.' },
  { user: 'No, groups below 3 people are hidden.' },   // message 2, c1 missing-context, check: not found
  read('CLAUDE.md', 200),                              // 8 after windowEnd: not in Cheap
  { agent: 'Fixed.' },
  { user: 'Now fix the link to the old plan.' },       // message 3, i2
  read('second-iteration/decisions/city.md', 800),     // 9 in_context (read in i1): readTokens only
  read(GONE, 100),                                     // 10 not on disk, no map entry: gone, not counted
  { agent: 'Done.' },
  { user: 'Also make the button red.' },               // message 4, c2 changed-mind
  { agent: 'Ok.' },
  { user: 'And never write tests here.' },             // message 5, c3 missing-context, check: had (CLAUDE.md)
  { agent: 'Ok.' },
  { user: 'What is the time zone of the server?' },    // message 6, i3: needs no context
  { agent: 'UTC.' },
  { user: 'Add the compare page.' },                   // message 7, i4
  { agent: 'Added.' },
  { user: 'It must show two cities side by side.' },   // message 8, c4 missing-context, not found
  { agent: 'Ok.' },
  { user: 'Use one decimal for the numbers.' },        // message 9, c5 missing-context, not found
  { agent: 'Ok.' }
]);
writeSession(S2, '2026-11-18T10:00:00.000Z', [{ user: 'Rename the button.' }, { agent: 'Done.' }, { user: 'Thanks.' }]);
writeSession(S3, '2026-11-17T10:00:00.000Z', [{ user: 'First message of S3.' }, { agent: 'ok' }, { user: 'Second message of S3.' }]);
writeSession(S4, '2026-11-16T10:00:00.000Z', Array.from({ length: 150 }, (_, k) => ({ user: `T${k + 1} `.padEnd(2000, 't'), agent: 'ok' })));
writeSession(S5, '2026-11-15T10:00:00.000Z', [
  { user: 'Fix the typo in the readme.' },             // message 1, i1
  read('CLAUDE.md', 50),                               // 0 in_context only
  { agent: 'Fixed.' },
  { user: 'Thanks, that looks good.' },                // message 2
  { user: 'Add a test for the city page.' },           // message 3, i2
  { agent: 'I add a test.' },
  { user: 'No, never tests here.' },                   // message 4, c1 missing-context, check: had (CLAUDE.md)
  { user: 'Check the agents file.' },                  // message 5, i3
  { read: abs('AGENTS.md'), text: '' },                // 1 path, 0 tokens
  { agent: 'It is empty.' },
  { user: 'Ok.' }                                      // message 6
]);
// S6: two subagents (findings 2 and 3). Each subagent starts with an empty conversation, so a file that the
// main thread read in i1 is not in its context, and a file that another subagent read is a first read for it.
writeSession(S6, '2026-11-14T12:00:00.000Z', [
  { user: 'Read the city rule.' },                      // message 1, i1
  read('second-iteration/decisions/city.md', 800),      // 0 main: path
  { agent: 'Read.' },
  { user: 'Now check it against the method with two helpers.' }, // message 2, i2
  { task: 'h1', items: [
    read('second-iteration/decisions/city.md', 800),    // 1 agent:h1, first read in this thread (main read it in i1): path
    read(METHOD, 1000)] },                              // 2 agent:h1: path
  { task: 'h2', items: [
    { grep: 'profile', files: [abs(METHOD)], text: `${abs(METHOD)}\n${'x'.repeat(800 - abs(METHOD).length - 1)}` }, // 3 agent:h2 search, 200 tokens
    read(METHOD, 1000)] },                              // 4 agent:h2, first read in this thread
  { agent: 'Done.' },
  { user: 'Thanks.' }                                   // message 3
]);
// S7: the only need is a file that is gone now (the session is older than the tree).
writeSession(S7, '2026-11-14T10:00:00.000Z', [
  { user: 'Fix the link to the old plan.' },           // message 1, i1
  read(GONE2, 100),                                    // 0 gone
  { agent: 'Done.' },
  { user: 'Thanks.' }                                  // message 2
]);

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const cacheA = path.join(work, 'cache-a');

function run({ out, cache = cacheA, intents = true, extra = [], oldPath = true }) {
  const args = [cli, project, '--claude-settings-home', settings, '--out', out, '--cache', cache, '--no-open', '--no-save', ...extra];
  if (oldPath) args.push('--old-path', OLD);
  if (intents) args.push('--intents');
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
  const json = existsSync(path.join(out, 'report.json')) ? readFileSync(path.join(out, 'report.json'), 'utf8') : null;
  const html = existsSync(path.join(out, 'report.html')) ? readFileSync(path.join(out, 'report.html'), 'utf8') : null;
  return { status: result.status, stderr: result.stderr, json, html, report: json && JSON.parse(json) };
}

// R1 and R2: --intents two times with the same cache. R2 is the artifact.
const r1 = run({ out: path.join(work, 'run-1') });
const artifact = path.join(repo, 'out', 'e2e-score');
mkdirSync(artifact, { recursive: true });
const r2 = run({ out: artifact });
// R3: no --intents, an empty cache: nothing is analysed.
const r3 = run({ out: path.join(work, 'run-3'), cache: path.join(work, 'cache-empty'), intents: false });
// R4: no --intents, the full cache, --sessions 1: only S1 is selected.
const r4 = run({ out: path.join(work, 'run-4'), intents: false, extra: ['--sessions', '1'] });
// R5: no --old-path: no session at all.
const r5 = run({ out: path.join(work, 'run-5'), intents: false, oldPath: false });

const sc = r1.report.score;
const sessionOf = (report, sessionId) => report.score.sessions.find(entry => entry.sessionId === sessionId);
const intentOf = (sessionId, intentId) => sessionOf(r1.report, sessionId).intentScores.find(entry => entry.intentId === intentId);
const NO_CHEAP = { score: null, neededTokens: 0, readTokens: 0, reads: 0, searches: 0, searchTokens: 0, windowEnd: null };
const NO_FOUND = { score: null, found: 0, counted: 0, gone: 0 };

test('X17: score is the last key, sessions and intents keep the order of the earlier steps', () => {
  for (const r of [r1, r3, r4, r5]) assert.equal(r.status, 0, r.stderr);
  assert.equal(Object.keys(r1.report).at(-1), 'score');
  // Step 8 adds groups, routes and prompt between needs and score. Step 9 adds duplicates and health.
  // Step 11 adds fixes between health and prompt.
  assert.deepEqual(Object.keys(r1.report).slice(-8), ['needs', 'groups', 'duplicates', 'routes', 'health', 'fixes', 'prompt', 'score']);
  assert.deepEqual(Object.keys(sc), ['method', 'labels', 'project', 'fixFirst', 'sessions']);
  assert.equal(sc.method, 'Score = average of Found, Cheap and No missing, 0 to 100.');
  assert.deepEqual(sc.labels, { good: 75, mixed: 50 });
  assert.deepEqual(sc.sessions.map(entry => entry.sessionId), r1.report.sessions.list.map(session => session.sessionId));
  assert.deepEqual(sc.sessions.map(entry => entry.sessionId), [S1, S2, S3, S4, S5, S6, S7, D, C, B, A]);
  for (const entry of r1.report.needs.sessions) {
    assert.deepEqual(sessionOf(r1.report, entry.sessionId).intentScores.map(item => [item.intentId, item.from, item.to]),
      entry.intents.map(intent => [intent.intentId, intent.from, intent.to]));
  }
  assert.deepEqual(Object.keys(sessionOf(r1.report, S1)), ['sessionId', 'score', 'label', 'reason', 'found', 'cheap', 'missing',
    'intents', 'scoredIntents', 'fileNeeds', 'goneNeeds', 'intentScores']);
  assert.deepEqual(Object.keys(intentOf(S1, 'i1')), ['intentId', 'from', 'to', 'score', 'label', 'reason', 'found', 'cheap', 'missing']);
});

test('X1, X3: S1 i1, found by a path and by a search, and what Cheap counts', () => {
  // Found: CLAUDE.md in_context, city.md path, METHOD.md search. 2 of 3 = 66.67, shown 67.
  // Needed (the first read in the main thread of a file that was not in its context): city.md 800 + METHOD.md 1,000 = 1,800.
  // windowEnd of the main thread = 6 (METHOD.md).
  // readTokens: events 1 CLAUDE.md 200, 2 city.md 800, 4 city.md 800, 6 METHOD.md 1,000 = 2,800 in 4 reads,
  // plus the search 0: "Found 1 files\n<OLD>/pipeline/METHOD.md" is 68 characters = 17 tokens. 2,817 in total.
  // Not counted: 3 cli.py (code), 5 .mcp.json (config), 7 ~/notes (outside), 8 CLAUDE.md (after windowEnd).
  // Cheap = 100 x 1,800 / 2,817 = 63.90, shown 64. Missing: 1 (c1) = 100 / 2 = 50.
  // Score = (66.67 + 63.90 + 50) / 3 = 60.19, shown 60, mixed.
  assert.deepEqual(r1.report.needs.sessions.find(entry => entry.sessionId === S1).intents[0].needs.map(need => [need.id, need.path, need.state ?? need.kind]),
    [['n1', 'CLAUDE.md', 'in_context'], ['n2', 'second-iteration/decisions/city.md', 'path'], ['n3', METHOD, 'search'], ['n4', null, 'missing']]);
  assert.deepEqual(intentOf(S1, 'i1'), { intentId: 'i1', from: 1, to: 2, score: 60, label: 'mixed', reason: null,
    found: { score: 67, found: 2, counted: 3, gone: 0 },
    cheap: { score: 64, neededTokens: 1800, readTokens: 2817, reads: 4, searches: 1, searchTokens: 17, windowEnd: 6 },
    missing: { score: 50, count: 1 } });
});

test('X2, X4, X7, X20: S1 i2, a file in context, a file that is gone, a changed mind and a had need', () => {
  // city.md: read in i1, so in_context and found. old-gone.md: not on disk and not on the map: gone, not counted. Found 1 of 1 = 100.
  // Needed: nothing (city.md is in context, old-gone.md is gone). Cheap null.
  // c2 changed-mind gives no need, c3 is had: Missing 100 / (1 + 0) = 100. Score = (100 + 100) / 2 = 100, good.
  const needs = r1.report.needs.sessions.find(entry => entry.sessionId === S1).intents[1].needs;
  assert.deepEqual(needs.filter(need => need.kind === 'file').map(need => [need.path, need.state, need.exists, need.map]),
    [['second-iteration/decisions/city.md', 'in_context', true, { reach: 'path', steps: 3, pathTokens: 719, via: 'link' }], [GONE, 'gone', false, null]]);
  assert.deepEqual(intentOf(S1, 'i2'), { intentId: 'i2', from: 3, to: 5, score: 100, label: 'good', reason: null,
    found: { score: 100, found: 1, counted: 1, gone: 1 },
    cheap: NO_CHEAP,
    missing: { score: 100, count: 0 } });
});

test('X21: S6, a subagent does not have the main context', () => {
  // i2: city.md is read first by subagent h1. The main thread read it in i1, but a subagent starts empty: path, not in_context.
  const needs = r1.report.needs.sessions.find(entry => entry.sessionId === S6).intents[1].needs;
  assert.deepEqual(needs.map(need => [need.path, need.thread, need.state, need.reads, need.tokens]), [
    ['second-iteration/decisions/city.md', 'agent:h1', 'path', 1, 800],
    [METHOD, 'agent:h1', 'path', 2, 1000]
  ]);
  // i1: city.md 800 by a path in the main thread. Score 100.
  // i2, Cheap per thread. h1: first reads city.md 800 and METHOD.md 1,000, window up to event 2: 1,800 read.
  // h2: the search 3 (200 tokens), then its first read of METHOD.md 1,000, window up to event 4: 1,200.
  // Needed 800 + 1,000 + 1,000 = 2,800. Read and searched 1,800 + 1,000 + 200 = 3,000 in 3 reads and 1 search.
  // Cheap = 100 x 2,800 / 3,000 = 93.33, shown 93. Found 2 of 2. Score = (100 + 93.33 + 100) / 3 = 97.78, shown 98.
  // (Before: city.md was in context for h1, and METHOD.md in h2 was a repeat: Cheap 1,000 / 1,800 = 56.)
  const [i1, i2] = sessionOf(r1.report, S6).intentScores;
  assert.deepEqual(i1.cheap, { score: 100, neededTokens: 800, readTokens: 800, reads: 1, searches: 0, searchTokens: 0, windowEnd: 0 });
  assert.deepEqual(i2, { intentId: 'i2', from: 2, to: 3, score: 98, label: 'good', reason: null,
    found: { score: 100, found: 2, counted: 2, gone: 0 },
    cheap: { score: 93, neededTokens: 2800, readTokens: 3000, reads: 3, searches: 1, searchTokens: 200, windowEnd: 4 },
    missing: { score: 100, count: 0 } });
  // S6 = (100 + 97.78) / 2 = 98.89, shown 99. Cheap (100 + 93.33) / 2 = 96.67, shown 97.
  const { intentScores: _s6, ...s6 } = sessionOf(r1.report, S6);
  assert.deepEqual(s6, { sessionId: S6, score: 99, label: 'good', reason: null, found: 100, cheap: 97, missing: 100,
    intents: 2, scoredIntents: 2, fileNeeds: 3, goneNeeds: 0 });
});

test('X20: S7, an intent whose only need is a file that is gone', () => {
  // The read file is not on disk and not on the map: gone. No other need, so the intent has no score.
  const { intentScores, ...s7 } = sessionOf(r1.report, S7);
  assert.deepEqual(intentScores, [{ intentId: 'i1', from: 1, to: 2, score: null, label: null, reason: 'only-gone-files',
    found: { score: null, found: 0, counted: 0, gone: 1 }, cheap: NO_CHEAP, missing: { score: null, count: 0 } }]);
  assert.deepEqual(s7, { sessionId: S7, score: null, label: null, reason: 'no-scored-intents', found: null, cheap: null, missing: null,
    intents: 1, scoredIntents: 0, fileNeeds: 1, goneNeeds: 1 });
});

test('X5, X11: S1 i3 needs no context, S1 i4 has only missing needs', () => {
  // i3: no reads, no correction: null with a reason, and no sub-score (not even Missing 100).
  assert.deepEqual(intentOf(S1, 'i3'), { intentId: 'i3', from: 6, to: 6, score: null, label: null, reason: 'needs-no-context',
    found: NO_FOUND, cheap: NO_CHEAP, missing: { score: null, count: 0 } });
  // i4: 2 missing, no file need. Missing = 100 / 3 = 33.33. Found and Cheap null. Score = 33.33, shown 33, poor.
  assert.deepEqual(intentOf(S1, 'i4'), { intentId: 'i4', from: 7, to: 9, score: 33, label: 'poor', reason: null,
    found: NO_FOUND, cheap: NO_CHEAP, missing: { score: 33, count: 2 } });
  // S1 = mean of i1, i2, i4 (exact): (60.19 + 100 + 33.33) / 3 = 64.51, shown 65, mixed.
  // Found (66.67 + 100) / 2 = 83.33. Cheap 63.90 (i1 only). Missing (50 + 100 + 33.33) / 3 = 61.11.
  // File needs: i1 3, i2 2 = 5. Gone: old-gone.md = 1.
  const { intentScores, ...s1 } = sessionOf(r1.report, S1);
  assert.equal(intentScores.length, 4);
  assert.deepEqual(s1, { sessionId: S1, score: 65, label: 'mixed', reason: null, found: 83, cheap: 64, missing: 61, intents: 4, scoredIntents: 3,
    fileNeeds: 5, goneNeeds: 1 });
});

test('X10, X12: S5, three intents that score 100 with sub-scores that are null', () => {
  const s5 = sessionOf(r1.report, S5);
  // i1: only CLAUDE.md (in_context). Found 1 of 1 = 100. Nothing to find: Cheap null, windowEnd null. Score (100 + 100) / 2.
  // i2: only a had need. Found null, Cheap null, Missing 100. Score 100.
  // i3: AGENTS.md by a path with 0 tokens. Found 100. readTokens 0: Cheap null. Score 100.
  assert.deepEqual(s5.intentScores, [
    { intentId: 'i1', from: 1, to: 2, score: 100, label: 'good', reason: null, found: { score: 100, found: 1, counted: 1, gone: 0 }, cheap: NO_CHEAP, missing: { score: 100, count: 0 } },
    { intentId: 'i2', from: 3, to: 4, score: 100, label: 'good', reason: null, found: NO_FOUND, cheap: NO_CHEAP, missing: { score: 100, count: 0 } },
    { intentId: 'i3', from: 5, to: 6, score: 100, label: 'good', reason: null, found: { score: 100, found: 1, counted: 1, gone: 0 },
      cheap: { score: null, neededTokens: 0, readTokens: 0, reads: 1, searches: 0, searchTokens: 0, windowEnd: 1 }, missing: { score: 100, count: 0 } }
  ]);
  // Session Cheap is null: no intent has a Cheap score.
  assert.deepEqual([s5.score, s5.label, s5.reason, s5.found, s5.cheap, s5.missing, s5.intents, s5.scoredIntents], [100, 'good', null, 100, null, 100, 3, 3]);
});

test('X19: the fixture sessions B and C', () => {
  // B i1: METHOD.md search 516, compare.md search 233, tiktok no_path 259, direction.md path 483, 1 missing.
  // Found 1 of 4 = 25. All 4 are needed and each is read once: 1,491 tokens. The 3 searches before them cost
  // Grep 17 + Glob 117 + Bash ls 24 = 158 tokens. Cheap = 1,491 / 1,649 = 90.42, shown 90. Missing 50.
  // Score = (25 + 90.42 + 50) / 3 = 55.14, shown 55, mixed.
  assert.deepEqual(intentOf(B, 'i1'), { intentId: 'i1', from: 1, to: 2, score: 55, label: 'mixed', reason: null,
    found: { score: 25, found: 1, counted: 4, gone: 0 },
    cheap: { score: 90, neededTokens: 1491, readTokens: 1649, reads: 4, searches: 3, searchTokens: 158, windowEnd: 7 },
    missing: { score: 50, count: 1 } });
  // C i1: frontend/CLAUDE.md (nested load) and city-batch SKILL.md (skill load) are found by a path, with no cost in Cheap.
  // frontend/DESIGN.md path 178. Found 3 of 3. The code read and the subagent read of cli.py are not context.
  // The subagent has no needed read, so its search is in no window. Score 100.
  assert.deepEqual(intentOf(C, 'i1'), { intentId: 'i1', from: 1, to: 5, score: 100, label: 'good', reason: null,
    found: { score: 100, found: 3, counted: 3, gone: 0 }, cheap: { score: 100, neededTokens: 178, readTokens: 178, reads: 1, searches: 0, searchTokens: 0, windowEnd: 3 },
    missing: { score: 100, count: 0 } });
  // C i2: DESIGN.md again (in_context, 178), then unslop SKILL.md (path, 69). Found 2 of 2 = 100.
  // Cheap = 100 x 69 / (178 + 69) = 27.94, shown 28. Score = (100 + 27.94 + 100) / 3 = 75.98, shown 76, good.
  assert.deepEqual(intentOf(C, 'i2'), { intentId: 'i2', from: 6, to: 6, score: 76, label: 'good', reason: null,
    found: { score: 100, found: 2, counted: 2, gone: 0 }, cheap: { score: 28, neededTokens: 69, readTokens: 247, reads: 2, searches: 0, searchTokens: 0, windowEnd: 9 },
    missing: { score: 100, count: 0 } });
  // C = (100 + 75.98) / 2 = 87.99, shown 88. Cheap (100 + 27.94) / 2 = 63.97, shown 64.
  const { intentScores: _c, ...c } = sessionOf(r1.report, C);
  assert.deepEqual(c, { sessionId: C, score: 88, label: 'good', reason: null, found: 100, cheap: 64, missing: 100, intents: 2, scoredIntents: 2, fileNeeds: 5, goneNeeds: 0 });
  const { intentScores: _b, ...b } = sessionOf(r1.report, B);
  assert.deepEqual(b, { sessionId: B, score: 55, label: 'mixed', reason: null, found: 25, cheap: 90, missing: 50, intents: 1, scoredIntents: 1, fileNeeds: 4, goneNeeds: 0 });
});

test('X6, X9: sessions with no score have null and a reason', () => {
  const nullSession = (sessionId, reason, intents = 0) => ({ sessionId, score: null, label: null, reason,
    found: null, cheap: null, missing: null, intents, scoredIntents: 0, fileNeeds: 0, goneNeeds: 0 });
  const { intentScores: s2Intents, ...s2 } = sessionOf(r1.report, S2);
  assert.deepEqual(s2, nullSession(S2, 'no-scored-intents', 1));
  assert.deepEqual(s2Intents.map(item => [item.intentId, item.score, item.reason]), [['i1', null, 'needs-no-context']]);
  for (const [sessionId, reason] of [[S3, 'failed'], [S4, 'too-long'], [A, 'single-message'], [D, 'single-message']]) {
    assert.deepEqual(sessionOf(r1.report, sessionId), { ...nullSession(sessionId, reason), intentScores: [] }, sessionId);
  }
  // R3: nothing is analysed. Every session is null with the step 4 status, and the project too.
  const p3 = r3.report.score;
  assert.deepEqual(p3.project, { score: null, label: null, reason: 'no-scored-intents', found: null, cheap: null, missing: null,
    sessions: 11, scoredSessions: 0, intents: 0, scoredIntents: 0 });
  assert.deepEqual(p3.fixFirst, []);
  assert.deepEqual(p3.sessions.map(entry => [entry.sessionId.slice(0, 8), entry.reason]), [['96000001', 'not-analysed'],
    ['96000002', 'not-analysed'], ['96000003', 'not-analysed'], ['96000004', 'too-long'], ['96000005', 'not-analysed'], ['96000006', 'not-analysed'], ['96000007', 'not-analysed'],
    ['44444444', 'single-message'], ['33333333', 'not-analysed'], ['22222222', 'not-analysed'], ['11111111', 'single-message']]);
  // R4: --sessions 1 selects S1 only. The project is S1: 65, mixed.
  const p4 = r4.report.score;
  assert.deepEqual([p4.project.score, p4.project.label, p4.project.scoredSessions, p4.project.scoredIntents], [65, 'mixed', 1, 3]);
  for (const sessionId of [S2, S3, S4, S5, S6, S7, C, B]) assert.equal(sessionOf(r4.report, sessionId).reason, 'not-selected', sessionId);
  // R5: no session at all.
  assert.deepEqual(r5.report.score.project, { score: null, label: null, reason: 'no-sessions', found: null, cheap: null, missing: null,
    sessions: 0, scoredSessions: 0, intents: 0, scoredIntents: 0 });
  assert.deepEqual([r5.report.score.sessions, r5.report.score.fixFirst], [[], []]);
});

test('X8: the project is the mean of all scored intents', () => {
  // 11 scored intents: S1 60.19, 100, 33.33; S5 100, 100, 100; S6 100, 97.78; C 100, 75.98; B 55.14.
  // Sum 922.42 / 11 = 83.86, shown 84, good. S7 i1 has only a gone file: no score, in no average.
  // Found: S1 66.67, 100; S5 100, 100; S6 100, 100; C 100, 100; B 25 = 791.67 / 9 = 87.96 (88).
  // Cheap: S1 63.90; S6 100, 93.33; C 100, 27.94; B 90.42 = 475.58 / 6 = 79.26 (79).
  // Missing: S1 50, 100, 33.33; S5 100 x 3; S6 100, 100; C 100, 100; B 50 = 933.33 / 11 = 84.85 (85).
  // Intents: S1 4, S2 1, S5 3, S6 2, S7 1, C 2, B 1 = 14. Scored sessions: S1, S5, S6, C, B.
  assert.deepEqual(sc.project, { score: 84, label: 'good', reason: null, found: 88, cheap: 79, missing: 85,
    sessions: 11, scoredSessions: 5, intents: 14, scoredIntents: 11 });
});

test('X14: what to fix first', () => {
  // Candidates: search METHOD.md (S1 i1, B i1), search compare.md (B), no_path tiktok (B),
  // and 4 missing lines (S1 c1, c4, c5 and B c1). The gone files (S1 old-gone.md, S7) are not candidates.
  // Sorted by intents, then search, no_path, missing, then path or text. 7 lines, the first 5 stay.
  const line = (kind, rel, text, refs, intents = 1, sessions = 1) => ({ kind, path: rel, text, intents, sessions,
    refs: refs.map(([sessionId, intentId, needId]) => ({ sessionId, intentId, needId })) });
  assert.deepEqual(sc.fixFirst, [
    line('search', METHOD, null, [[S1, 'i1', 'n3'], [B, 'i1', 'n1']], 2, 2),
    line('search', COMPARE, null, [[B, 'i1', 'n2']]),
    line('no_path', TIKTOK, null, [[B, 'i1', 'n3']]),
    line('missing', null, 'Compare pages show two cities side by side', [[S1, 'i4', 'n1']]),
    line('missing', null, 'Groups below 3 people are hidden', [[S1, 'i1', 'n4']])
  ]);
});

test('X13, X15, X16: words, details and numbers agree; two runs give the same output', () => {
  const word = value => value == null ? null : value >= 75 ? 'good' : value >= 50 ? 'mixed' : 'poor';
  const whole = value => value === null || Number.isInteger(value);
  assert.ok(!r1.json.includes('NaN'));
  assert.equal(sc.project.label, word(sc.project.score));
  for (const entry of sc.sessions) {
    assert.equal(entry.label, word(entry.score), entry.sessionId);
    for (const value of [entry.score, entry.found, entry.cheap, entry.missing]) assert.ok(whole(value), entry.sessionId);
    for (const item of entry.intentScores) {
      const where = `${entry.sessionId}:${item.intentId}`;
      assert.equal(item.label, word(item.score), where);
      assert.equal(item.found.score, item.found.counted ? Math.round(100 * item.found.found / item.found.counted) : null, where);
      assert.equal(item.cheap.score, item.cheap.readTokens ? Math.round(100 * item.cheap.neededTokens / item.cheap.readTokens) : null, where);
      assert.ok(item.cheap.neededTokens <= item.cheap.readTokens, where);
      assert.ok(item.cheap.searchTokens <= item.cheap.readTokens, where);
      const parts = [item.found.score, item.cheap.score, item.missing.score].filter(value => value != null);
      if (item.score == null) assert.deepEqual(parts, [], where);
      else {
        assert.equal(item.missing.score, Math.round(100 / (1 + item.missing.count)), where);
        assert.ok(Math.abs(item.score - parts.reduce((a, b) => a + b, 0) / parts.length) <= 1, where);
      }
      for (const value of [item.score, ...parts]) assert.ok(whole(value) && value >= 0 && value <= 100, where);
    }
  }
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(r2.json, r1.json);
  assert.equal(r2.html, r1.html);
});

test('X18: the step 8 page does not show the score, and shows the same sessions and needs', () => {
  // Step 8 removed the score from the page (the user asked for the 3 route metrics instead). report.json keeps the
  // score key, and the checks above keep its numbers.
  const data = JSON.parse(r1.html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
  for (const r of [r1, r3, r5]) {
    for (const old of ['data-project-score', 'data-score=', 'id="verdict"', 'Cheap']) assert.ok(!r.html.includes(old), old);
    assert.ok(!r.html.includes('NaN'));
  }
  assert.equal(sc.project.score, 84);
  const row = sessionId => data.sessions.find(item => item.id === sessionId);
  // A session that failed, and one with an intent that needs no context.
  assert.deepEqual([row(S3).reasonShort, row(S3).intentCount], ['failed', 0]);
  assert.equal(row(S1).intentCount, 4);
  // D2: the skill body load is a trigger route, the nested CLAUDE.md load a route from the map.
  const skill = row(C).files.find(file => file.path === '.claude/skills/city-batch/SKILL.md');
  assert.deepEqual(skill.routes[0].route, [{ path: '.claude/skills/city-batch/SKILL.md', how: 'trigger' }]);
  assert.equal(row(C).files.find(file => file.path === 'frontend/CLAUDE.md').routes[0].route.at(-1).how, 'map');
  // X20: a gone file is not on the page. S7 has one intent whose only need is gone: no file, no problem.
  assert.deepEqual([row(S7).intentCount, row(S7).files, row(S7).problems], [1, [], []]);
  assert.ok(!r1.html.includes(GONE) && !r1.html.includes(GONE2));
  assert.ok(r3.html.includes('data-state="not-analysed"'));
  assert.ok(r5.html.includes('data-state="no-sessions"'));
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});
