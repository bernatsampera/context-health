// E2E for step 8 (intent groups, routes, metrics, the improvement prompt): run the real command on a git copy of
// fixtures/indoeuromap, with a copy of fixtures/claude-settings-home plus 4 sessions that this file writes, and the fake
// claude binary test/fake-claude.mjs. No real model call. The ways it can fail are in the step 8 failure list
// (G, W and Q). Each test names its cases. The expected numbers are worked out by hand in the comments.
// Artifact: out/e2e-routes/report.json and report.html (same content on every run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const R = n => `9100000${n}-0000-0000-0000-000000000000`;
const [R1, R2, R3, R4] = [1, 2, 3, 4].map(R);
const RESEARCH = 'data/research/growth-metrics-2026-10-21/README.md';
const CITY = 'second-iteration/decisions/city.md';
const INDEX = 'second-iteration/decisions/index.md';
const TIKTOK = 'first-iteration/docs/tiktok-first-post-2026-09-27.md';
const DIRECTION = 'second-iteration/direction.md';
const METRICS = 'second-iteration/metrics.md';

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-routes-'));
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
const abs = rel => `${OLD}/${rel}`;

// Items: { user }, { agent }, { read: rel, text? } (default: the real text of the file), { grep: pattern, files: [rel] }.
function writeSession(sessionId, start, items) {
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
  let k = 0;
  const rec = extra => { k += 1; return { ...base, uuid: `${sessionId.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra }; };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: [
    { path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
    { path: `${OLD}/CLAUDE.md`, content: fileText('CLAUDE.md'), type: 'Project' }] } })];
  const tool = (name, input, content, toolUseResult) => {
    const toolId = `toolu_${sessionId.slice(0, 8)}_${k}`;
    records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: toolId, name, input }], usage } }));
    records.push(rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content }] }, toolUseResult }));
  };
  for (const item of items) {
    if (item.user != null) records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    if (item.agent != null) records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    if (item.read != null) {
      const text = item.text ?? fileText(item.read);
      const lines = text.split('\n').length;
      tool('Read', { file_path: abs(item.read) }, text, { type: 'text', file: { filePath: abs(item.read), content: text, numLines: lines, startLine: 1, totalLines: lines } });
    }
    if (item.grep != null) {
      const files = item.files.map(abs);
      tool('Grep', { pattern: item.grep, path: OLD, output_mode: 'files_with_matches' }, `Found ${files.length} files\n${files.join('\n')}`,
        { mode: 'files_with_matches', filenames: files, numFiles: files.length });
    }
  }
  writeFileSync(path.join(sessionDir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

// R1: links all the way. CLAUDE.md (start load) names AGENTS.md, AGENTS.md names decisions/index.md, index.md names city.md.
writeSession(R1, '2026-11-21T10:00:00.000Z', [
  { user: 'Change the city page for Paris: show the top 5 groups.' },
  { read: 'AGENTS.md' },                       // known from start CLAUDE.md
  { read: INDEX },                             // known from file AGENTS.md
  { read: CITY },                              // known from file index.md
  { agent: 'Done.' },
  { user: 'Thanks.' }
]);
// R2: city.md found by a search.
writeSession(R2, '2026-11-20T10:00:00.000Z', [
  { user: 'Fix the title of the Berlin city page.' },
  { grep: 'Berlin', files: [CITY] },
  { read: CITY },                              // known from search
  { agent: 'Done.' },
  { user: 'Thanks.' }
]);
// R3: city.md by a search again, the orphan with nothing that names it, and a missing-context correction.
writeSession(R3, '2026-11-19T10:00:00.000Z', [
  { user: 'Update the Madrid city page with the new groups.' },
  { grep: 'Madrid', files: [CITY] },
  { read: CITY },                              // known from search
  { read: TIKTOK, text: 'x'.repeat(400) },     // known from none, no map route: no_path
  { agent: 'Done.' },
  { user: 'No, city pages must use LayoutV2.' }, // c1 missing-context, the check does not find it
  { agent: 'Ok.' }
]);
// R4: llms.txt found by a search, direction.md named by llms.txt (a weak route), metrics.md named by the user.
writeSession(R4, '2026-11-18T10:00:00.000Z', [
  { user: `Draft a Show HN post. Use the numbers in ${METRICS}.` },
  { grep: 'Show HN', files: ['llms.txt'] },
  { read: 'llms.txt' },                        // known from search
  { read: DIRECTION },                         // known from file llms.txt
  { read: METRICS },                           // known from user message 1
  { agent: 'Drafted.' },
  { user: 'Thanks.' }
]);

const log = path.join(work, 'calls.jsonl');
writeFileSync(log, '');
const cacheA = path.join(work, 'cache-a');
const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const head = call => call.stdin.split('\n', 1)[0];
const groupCalls = list => list.filter(call => head(call).startsWith('context-health intent-groups '));

function run({ out, cache = cacheA, intents = true, extra = [], tz = 'UTC' }) {
  const args = [cli, project, '--claude-settings-home', settings, '--old-path', OLD, '--out', out, '--cache', cache, '--no-open', '--no-save', ...extra];
  if (intents) args.push('--intents');
  const result = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, TZ: tz, CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
  const json = existsSync(path.join(out, 'report.json')) ? readFileSync(path.join(out, 'report.json'), 'utf8') : null;
  const html = existsSync(path.join(out, 'report.html')) ? readFileSync(path.join(out, 'report.html'), 'utf8') : null;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json, html, report: json && JSON.parse(json) };
}
const since = before => calls().slice(before);

// R1 and R2: --intents two times with the same cache, two time zones. R2 is the artifact.
const r1 = run({ out: path.join(work, 'run-1') });
const r1Calls = calls();
const artifact = path.join(repo, 'out', 'e2e-routes');
mkdirSync(artifact, { recursive: true });
let before = calls().length;
const r2 = run({ out: artifact, tz: 'Asia/Tokyo' });
const r2Calls = since(before);
// R3: no --intents, an empty cache.
before = calls().length;
const r3 = run({ out: path.join(work, 'run-3'), cache: path.join(work, 'cache-empty'), intents: false });
const r3Calls = since(before);
// R4: --sessions 2 (R1 and R2): the fake answer names an unknown intent.
before = calls().length;
const r4 = run({ out: path.join(work, 'run-4'), extra: ['--sessions', '2'] });
const r4Calls = since(before);
// R5: --sessions 3 (R1, R2, R3): the fake answer has a long label.
before = calls().length;
const r5 = run({ out: path.join(work, 'run-5'), extra: ['--sessions', '3'] });
const r5Calls = since(before);
// R6: --sessions 1 (R1 only): one intent, no call.
before = calls().length;
const r6 = run({ out: path.join(work, 'run-6'), extra: ['--sessions', '1'] });
const r6Calls = since(before);

const report = r1.report;
const routes = report.routes;
const intentOf = (sessionId, intentId) => routes.intents.find(item => item.sessionId === sessionId && item.intentId === intentId);
const needOf = (sessionId, rel) => intentOf(sessionId, 'i1').needs.find(need => need.path === rel);
const groupByLabel = label => report.groups.list.find(group => group.label === label);
const viewOf = groupId => routes.byGroup.find(entry => entry.groupId === groupId);
const P = (kind, extra = {}) => ({ kind, path: null, steps: null, via: null, viaHow: null, text: null, quote: null, ...extra });

test('the runs work, and the new keys come after needs, before score', () => {
  for (const r of [r1, r2, r3, r4, r5, r6]) assert.equal(r.status, 0, r.stderr);
  const keys = Object.keys(report);
  // Step 9 adds duplicates (before routes) and health (before prompt). Step 11 adds fixes (after health).
  assert.deepEqual(keys.slice(keys.indexOf('needs')), ['needs', 'groups', 'duplicates', 'routes', 'health', 'fixes', 'prompt', 'score']);
  assert.deepEqual(Object.keys(report.fixes), ['limit', 'total', 'list', 'smaller', 'left']);
  assert.deepEqual(Object.keys(report.groups), ['promptVersion', 'model', 'status', 'reason', 'costUsd', 'intents', 'list', 'notes']);
  assert.deepEqual(Object.keys(routes), ['method', 'metrics', 'map', 'intents', 'byGroup', 'bySession']);
  assert.deepEqual(Object.keys(report.prompt), ['text']);
  for (const entry of report.intents.sessions.filter(item => [R1, R2, R3, R4].includes(item.sessionId))) assert.equal(entry.status, 'ok', entry.sessionId);
});

test('G5, G6, G9, G10: one call groups the intents, sorted by count', () => {
  // 7 ok intents: R1 i1, R2 i1, R3 i1, R4 i1 (this file), B i1, C i1, C i2 (fixture).
  assert.equal(report.groups.status, 'ok');
  assert.equal(report.groups.intents, 7);
  assert.equal(report.groups.costUsd, 0.006);
  assert.deepEqual(report.groups.list.map(group => [group.id, group.label, group.count]), [
    ['g1', 'Change a city page', 3],
    ['g2', 'Fix the frontend layout and design', 2],
    ['g3', 'Draft a Show HN post', 1],
    ['g4', 'Understand the profile rule', 1]
  ]);
  // Members in session order (newest first), then intent order.
  assert.deepEqual(report.groups.list[0].members, [R1, R2, R3].map(sessionId => ({ sessionId, intentId: 'i1' })));
  assert.deepEqual(report.groups.list[1].members, [{ sessionId: C, intentId: 'i1' }, { sessionId: C, intentId: 'i2' }]);
  const list = groupCalls(r1Calls);
  assert.equal(list.length, 1);
  assert.match(head(list[0]), /^context-health intent-groups intent-groups-v1 session run-[0-9a-f]{12}$/);
  // The input is sorted by sessionId: 2222 (B), 3333 (C i1, i2), 9100000 1 to 4. Only the goals, with a number.
  // The em dash of the R3 goal is in the input as it is: the model sees the words of the user.
  assert.equal(list[0].stdin.split('\n').slice(1).join('\n'), ['Intents: 7',
    '1. Know how the profile rule picks the groups of a city profile',
    '2. Fix the phone layout of the neighbourhood page',
    '3. Check the design rules again and apply the writing rules to the new text',
    '4. Change the city page for Paris',
    '5. Fix the title of the Berlin city page',
    '6. Update the Madrid city page \u2014 the new groups',
    '7. Draft a Show HN post', ''].join('\n'));
  for (const marker of ['show the top 5 groups', 'LayoutV2']) assert.ok(!list[0].stdin.includes(marker), marker);
  const prompt = readFileSync(path.join(repo, 'src', 'prompts', 'intent-groups-v1.md'), 'utf8');
  assert.deepEqual(list[0].argv, ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--no-session-persistence',
    '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config', '--system-prompt', prompt]);
});

test('G2, G7, W17: a second run in another time zone makes no group call and gives the same files', () => {
  assert.equal(groupCalls(r2Calls).length, 0);
  assert.equal(r2Calls.length, 0, 'no call at all');
  assert.equal(r2.json, r1.json);
  assert.equal(r2.html, r1.html);
  // The cache has the answers of R1 and R5. The bad answer of R4 is not cached.
  const files = readdirSync(path.join(cacheA, 'groups'));
  assert.equal(files.length, 2);
  const cached = JSON.parse(readFileSync(path.join(cacheA, 'groups', files[0]), 'utf8'));
  assert.deepEqual(Object.keys(cached), ['promptVersion', 'model', 'key', 'costUsd', 'result', 'checked']);
});

test('G1: no --intents and no cache: no call, each intent is its own group', () => {
  assert.equal(r3Calls.length, 0);
  const groups = r3.report.groups;
  // No intent is ok without --intents and a cache, so there is nothing to group.
  assert.equal(r3.report.intents.totals.ok, 0);
  assert.deepEqual([groups.status, groups.intents, groups.list], ['not-needed', 0, []]);
  assert.deepEqual(r3.report.routes.metrics, { directReach: { percent: null, direct: 0, counted: 0 }, averageRoute: { steps: null, needs: 0 }, toldByUser: { count: 0 } });
  // With the intents cache but no groups cache, the groups are not analysed.
  const cacheI = path.join(work, 'cache-i');
  cpSync(path.join(cacheA, 'intents'), path.join(cacheI, 'intents'), { recursive: true });
  cpSync(path.join(cacheA, 'needs'), path.join(cacheI, 'needs'), { recursive: true });
  const n0 = calls().length;
  const r = run({ out: path.join(work, 'run-g1'), cache: cacheI, intents: false });
  assert.equal(calls().length, n0);
  assert.equal(r.report.groups.status, 'not-analysed');
  assert.equal(r.report.groups.reason, 'not analysed: run with --intents');
  assert.equal(r.report.groups.list.length, 7);
  assert.ok(r.report.groups.list.every(group => group.count === 1));
  // Labels are the goals, in plain string order.
  assert.deepEqual(r.report.groups.list.map(group => group.label), [
    'Change the city page for Paris', 'Check the design rules again and apply the writing rules to the new text', 'Draft a Show HN post',
    'Fix the phone layout of the neighbourhood page', 'Fix the title of the Berlin city page',
    'Know how the profile rule picks the groups of a city profile', 'Update the Madrid city page \u2014 the new groups']);
  // The metrics do not depend on the groups.
  assert.deepEqual(r.report.routes.metrics, routes.metrics);
});

test('G3: an answer with an unknown intent fails after 2 calls, and each intent is its own group', () => {
  assert.equal(groupCalls(r4Calls).length, 2);
  const groups = r4.report.groups;
  assert.equal(groups.status, 'failed');
  assert.equal(groups.reason, 'bad answer: unknown intent 3');
  assert.deepEqual(groups.list.map(group => [group.label, group.count]), [['Change the city page for Paris', 1], ['Fix the title of the Berlin city page', 1]]);
  assert.ok(!existsSync(path.join(work, 'run-4', 'groups')));
});

test('G4: a long label is cut to 8 words, with a note', () => {
  assert.equal(groupCalls(r5Calls).length, 1);
  const groups = r5.report.groups;
  assert.equal(groups.status, 'ok');
  assert.deepEqual(groups.list.map(group => [group.label, group.count]), [['Change one city page of the site for', 3]]);
  assert.deepEqual(groups.notes, ['Cut the label of group 1 to 8 words']);
});

test('G8: one intent makes no call', () => {
  // Step 9: the run still makes its duplicates call. No intent-groups call.
  assert.equal(groupCalls(r6Calls).length, 0);
  assert.equal(r6.report.groups.status, 'not-needed');
  assert.deepEqual(r6.report.groups.list.map(group => [group.id, group.label, group.count]), [['g1', 'Change the city page for Paris', 1]]);
});

test('W1: the route the agent took, link by link', () => {
  assert.deepEqual(needOf(R1, 'AGENTS.md'), { needId: 'n1', path: 'AGENTS.md', state: 'path', steps: 1, direct: true, fromMap: false,
    route: [{ path: 'CLAUDE.md', how: 'start' }, { path: 'AGENTS.md', how: 'link' }] });
  assert.deepEqual(needOf(R1, CITY), { needId: 'n3', path: CITY, state: 'path', steps: 3, direct: true, fromMap: false,
    route: [{ path: 'CLAUDE.md', how: 'start' }, { path: 'AGENTS.md', how: 'link' }, { path: INDEX, how: 'link' }, { path: CITY, how: 'link' }] });
  assert.deepEqual(intentOf(R1, 'i1').problems, []);
  assert.equal(intentOf(R1, 'i1').groupId, 'g1');
});

test('W2, W7: a search head, a weak route and a path the user gave', () => {
  assert.deepEqual(needOf(R2, CITY).route, [{ path: CITY, how: 'search' }]);
  assert.equal(needOf(R2, CITY).direct, false);
  assert.deepEqual(intentOf(R2, 'i1').problems, [P('search', { path: CITY, steps: 3 })]);
  // R4: llms.txt by a search, direction.md named by llms.txt, metrics.md named by the user.
  assert.deepEqual(needOf(R4, DIRECTION), { needId: 'n2', path: DIRECTION, state: 'path', steps: 3, direct: false, fromMap: false,
    route: [{ path: 'llms.txt', how: 'search' }, { path: DIRECTION, how: 'link' }] });
  assert.deepEqual(needOf(R4, METRICS).route, [{ path: METRICS, how: 'user' }]);
  assert.deepEqual(intentOf(R4, 'i1').problems, [
    P('search', { path: 'llms.txt', steps: 2 }),
    P('weak_route', { path: DIRECTION, steps: 3, via: 'llms.txt', viaHow: 'search' }),
    P('told_path', { path: METRICS, steps: 3 })
  ]);
  // Fixture B: direction.md named by the user, the orphan with no path, the missing correction.
  assert.deepEqual(intentOf(B, 'i1').problems.map(item => [item.kind, item.path]), [
    ['search', 'pipeline/METHOD.md'], ['search', 'second-iteration/decisions/compare.md'], ['no_path', TIKTOK], ['told_path', DIRECTION], ['missing', null]]);
});

test('W4, W6: a nested CLAUDE.md load takes the rest of the route from the map, a skill body is a trigger', () => {
  const c = intentOf(C, 'i1');
  const design = c.needs.find(need => need.path === 'frontend/DESIGN.md');
  // DESIGN.md is known from frontend/CLAUDE.md, which the harness loaded (nested). The map route of frontend/CLAUDE.md is
  // .claude/commands/frontend-design-system.md > frontend/llms.txt > frontend/CLAUDE.md.
  assert.deepEqual(design.route, [
    { path: '.claude/commands/frontend-design-system.md', how: 'map' }, { path: 'frontend/llms.txt', how: 'map' },
    { path: 'frontend/CLAUDE.md', how: 'map' }, { path: 'frontend/DESIGN.md', how: 'link' }]);
  assert.equal(design.fromMap, true);
  assert.equal(design.direct, true);
  assert.deepEqual(c.needs.find(need => need.path === '.claude/skills/city-batch/SKILL.md').route, [{ path: '.claude/skills/city-batch/SKILL.md', how: 'trigger' }]);
  // C i2: unslop is named by the user CLAUDE.md of the start load.
  assert.deepEqual(intentOf(C, 'i2').needs.find(need => need.path === '~/.claude/skills/unslop/SKILL.md').route,
    [{ path: '~/.claude/CLAUDE.md', how: 'start' }, { path: '~/.claude/skills/unslop/SKILL.md', how: 'link' }]);
});

test('W9 to W12: the 3 metrics, worked out by hand', () => {
  // File needs (none gone) and direct ones:
  //   C i1: frontend/CLAUDE.md, frontend/DESIGN.md, city-batch skill: 3 direct. Steps 2, 2, 1.
  //   C i2: DESIGN.md (in context), unslop: 2 direct. Steps 2, 1.
  //   B i1: METHOD.md (search), compare.md (search), the orphan (no path), direction.md (told): 0 direct. Steps 2, 3, none, 3.
  //   R1 i1: AGENTS.md, index.md, city.md: 3 direct. Steps 1, 2, 3.
  //   R2 i1: city.md (search): 0 direct. Steps 3.
  //   R3 i1: city.md (search), the orphan (no path): 0 direct. Steps 3, none.
  //   R4 i1: llms.txt (search), direction.md (weak route), metrics.md (told): 0 direct. Steps 2, 3, 3.
  // File needs: 3 + 2 + 4 + 3 + 1 + 2 + 3 = 18. Missing needs: B c1, R3 c1 = 2. Counted: 20. Direct: 3 + 2 + 3 = 8.
  // Direct reach: 100 x 8 / 20 = 40.
  // Steps: C 2+2+1+2+1 = 8 (5 needs), B 2+3+3 = 8 (3), R1 1+2+3 = 6 (3), R2 3 (1), R3 3 (1), R4 2+3+3 = 8 (3).
  // Sum 36 over 16 needs = 2.25, one decimal: 2.3.
  // Told by user: 2 missing needs.
  assert.deepEqual(routes.metrics, {
    directReach: { percent: 40, direct: 8, counted: 20 },
    averageRoute: { steps: 2.3, needs: 16 },
    toldByUser: { count: 2 }
  });
});

test('W13 to W15: the view of a group: two routes to one file, one line per problem', () => {
  const g1 = viewOf(groupByLabel('Change a city page').id);
  assert.deepEqual(g1.sessions, [R1, R2, R3]);
  assert.equal(g1.weak, true);
  assert.equal(g1.told, true);
  // city.md: 3 uses, by links once (R1) and by search 2 times (R2, R3).
  const city = g1.files[0];
  assert.equal(city.path, CITY);
  assert.equal(city.uses, 3);
  assert.deepEqual(city.ways, { links: 1, search: 2, no_path: 0, unnamed: 0, weak_route: 0, told_path: 0 });
  assert.deepEqual(city.routes, [
    { route: [{ path: CITY, how: 'search' }], count: 2 },
    { route: [{ path: 'CLAUDE.md', how: 'start' }, { path: 'AGENTS.md', how: 'link' }, { path: INDEX, how: 'link' }, { path: CITY, how: 'link' }], count: 1 }
  ]);
  assert.deepEqual(g1.files.map(file => [file.path, file.uses]), [[CITY, 3], ['AGENTS.md', 1], [TIKTOK, 1], [INDEX, 1]]);
  // The search problem of R2 and R3 is one line with count 2. The text of the correction keeps its words.
  assert.deepEqual(g1.problems, [
    { ...P('search', { path: CITY, steps: 3 }), count: 2 },
    { ...P('no_path', { path: TIKTOK }), count: 1 },
    { ...P('missing', { text: 'City pages must use LayoutV2 \u2013 always', quote: 'No, city pages must use LayoutV2.' }), count: 1 }
  ]);
  // Edges: the link route once, the search jump from CLAUDE.md 2 times.
  assert.deepEqual(g1.edges, [
    { from: 'AGENTS.md', to: INDEX, kind: 'link', count: 1 },
    { from: 'CLAUDE.md', to: 'AGENTS.md', kind: 'link', count: 1 },
    { from: 'CLAUDE.md', to: CITY, kind: 'search', count: 2 },
    { from: INDEX, to: CITY, kind: 'link', count: 1 }
  ]);
  // Heat: city.md is on a route of 3 intents of 1 group. CLAUDE.md is on the route of R1 only (a search jump does not count).
  const node = rel => routes.map.nodes.find(item => item.id === rel);
  assert.deepEqual([node(CITY).intents, node(CITY).groups], [3, 1]);
  assert.deepEqual([node('CLAUDE.md').intents, node('CLAUDE.md').groups], [1, 1]);
  // frontend-design-system.md is only on the map part of a route: the agent did not run that command.
  assert.equal(node('.claude/commands/frontend-design-system.md').intents, 0);
  assert.equal(node('frontend/CLAUDE.md').intents, 1, 'C i1 only: C i2 reached DESIGN.md through it, but from the map');
  assert.equal(node(TIKTOK).lane, 'none');
});

test('W16: one entry per session, also when it is not analysed', () => {
  assert.deepEqual(routes.bySession.map(entry => entry.sessionId), report.sessions.list.map(session => session.sessionId));
  const s = sessionId => routes.bySession.find(entry => entry.sessionId === sessionId);
  for (const sessionId of [A, D]) assert.deepEqual({ ...s(sessionId), sessionId: null }, { sessionId: null, intents: [], groups: [], files: [], edges: [], problems: [] });
  assert.deepEqual([s(C).intents, s(C).groups], [['i1', 'i2'], ['g2']]);
  assert.deepEqual(s(R4).problems.map(item => [item.kind, item.count]), [['search', 1], ['weak_route', 1], ['told_path', 1]]);
});

test('W18, W19, W20: the map nodes', () => {
  const nodes = routes.map.nodes;
  assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length, 'no node twice');
  // Start column: the instruction files of the start load, then the skill and command list.
  assert.deepEqual(nodes.filter(node => node.lane === 'start').map(node => node.id), ['~/.claude/CLAUDE.md', 'CLAUDE.md', ':skill-list']);
  const mapNeeds = report.map.files.filter(file => file.context && file.path !== '.mcp.json' && file.path !== '.claude/settings.json');
  for (const file of mapNeeds) assert.ok(nodes.some(node => node.id === file.path), file.path);
  assert.equal(nodes.length, 2 + 1 + mapNeeds.length - 1, 'start files, the list, the map files (CLAUDE.md is both)');
  const node = rel => nodes.find(item => item.id === rel);
  assert.deepEqual([node('frontend/llms.txt').column, node('frontend/CLAUDE.md').column, node('frontend/DESIGN.md').column], [2, 2, 2]);
  assert.ok(node('frontend/llms.txt').row < node('frontend/CLAUDE.md').row && node('frontend/CLAUDE.md').row < node('frontend/DESIGN.md').row);
  assert.equal(routes.map.columns, 6);
  assert.equal(routes.map.searchFrom, 'CLAUDE.md');
  const text = JSON.stringify({ routes, groups: report.groups, prompt: report.prompt });
  assert.ok(!text.includes(work) && !text.includes(os.tmpdir()), 'no temporary path');
  assert.ok(!text.includes(project), 'no absolute project path');
});

test('Q1 to Q6: the improvement prompt', () => {
  const text = report.prompt.text;
  const headings = text.split('\n').filter(line => line.startsWith('## '));
  assert.deepEqual(headings, ['## 1. What was explored', '## 2. What the agent needs most', '## 3. The routes to the hot files today',
    '## 4. Problems found', '## 5. What to improve', '## 6. Then']);
  assert.ok(text.includes('- Sessions: 8 read, 6 analysed. Intents: 7, grouped into 4 goals.'));
  // Step 11: section 1 has the 5 counts of health.counts. The prompt does not show the health score any more.
  // Needed files (W9 to W12): 13. The tiktok orphan has no route: 1. Found by search or told by the user: city.md,
  // direction.md, llms.txt, METHOD.md, compare.md, metrics.md: 6. Told facts: B c1, R3 c1: 2.
  // Sessions: 8 read (6 analysed, A and D have one message), 1 headless, 1 with no user message: 10.
  const c = report.health.counts;
  const top = c.startLoad.top.map(item => `${item.path} (${item.what}, ${item.tokens.toLocaleString('en-US')} tokens)`).join(', ');
  assert.equal(c.startLoad.top.length, 3);
  assert.ok(text.includes([
    'The 5 counts of today:',
    '- a. 1 needed file has no route, of 13 needed files.',
    '- b. 6 needed files have a route, but the agent searched, of 13 needed files.',
    '- c. 2 facts you had to type (0 already saved).',
    `- d. Start load: 698 tokens. The biggest items: ${top}.`,
    '- e. From 6 of 10 sessions (1 headless skipped, 1 with no user message, 2 not analysed).',
    '- 2 session files were not read: 1 headless (run through the SDK), 1 with no user message.',
    '', '## 2. What the agent needs most'].join('\n')));
  assert.deepEqual([c.noRoute.text, c.noRoute.base, c.searched.text, c.searched.base, c.told.text, c.startLoad.text, c.sessions.text],
    ['1 needed file has no route', 'of 13 needed files', '6 needed files have a route, but the agent searched', 'of 13 needed files',
      '2 facts you had to type (0 already saved)', 'Start load: 698 tokens', 'From 6 of 10 sessions (1 headless skipped, 1 with no user message, 2 not analysed)']);
  assert.ok(!text.includes('Health score') && !text.includes('of 100'), 'no health score in the prompt');
  // The score stays in report.json.
  assert.equal(typeof report.health.score, 'number');
  assert.ok(!text.includes('Direct reach'));
  assert.ok(text.includes('- "Change a city page", 3 times: second-iteration/decisions/city.md (3), AGENTS.md (1), '));
  assert.ok(text.includes(`- ${CITY}, needed by 3 intents: CLAUDE.md > AGENTS.md > ${INDEX} > ${CITY} (3 steps, `));
  assert.ok(text.includes('Reached by links 1 time, by search 2 times.'));
  // Step 11: section 4 has new list titles. This fixture has no told fact that a context file holds now, so that list is not there.
  const problems = text.slice(text.indexOf('## 4. Problems found'), text.indexOf('## 5. What to improve'));
  assert.deepEqual(problems.split('\n').filter(line => line.endsWith(':') && !line.startsWith('- ')), [
    'Needed files with no route from the start load:', 'Needed files with a route that the agent searched:',
    'Facts that the user typed (not in the context):', 'Facts with different values in two or more instruction files:',
    'Context files that no intent used (39):']);
  assert.ok(problems.includes(`- ${TIKTOK}: needed by 2 intents. No file links to it.`), 'the why of health in section 4');
  assert.ok(problems.includes(`- ${CITY}: needed by 3 intents, searched 2 times. ${INDEX} (line 7) links it. The link text must say when to read it.`));
  assert.ok(problems.includes('- "City pages must use LayoutV2 - always" (1 time). The user said: "No, city pages must use LayoutV2."'));
  // Step 11: the prompt does not list the copied facts any more. They stay in report.json, and fixes.left counts them.
  assert.ok(!text.includes('Facts written in two or more files') && !text.includes('- Copy: '));
  const facts = report.health.parts.oneSource.facts;
  const noTests = facts.find(fact => fact.what === 'No tests in this project');
  assert.deepEqual([noTests.differ, noTests.keep, noTests.places.map(place => [place.path, place.quote])],
    [false, 'AGENTS.md', [['AGENTS.md', 'Do not write, run, or keep tests.'], ['CLAUDE.md', 'Do not write, run, or keep tests.']]]);
  assert.deepEqual(report.fixes.left, { copies: facts.filter(fact => !fact.differ).length, notNamed: 0 });
  assert.equal(report.fixes.left.copies, 7);

  // Step 11: section 5 prints fixes.list, one fix for each root cause. The order: needs (high first), then the kind.
  const improve = text.slice(text.indexOf('## 5. What to improve'), text.indexOf('## 6. Then'));
  const fixes = report.fixes;
  const plain = value => value.replace(/[\u2013\u2014]/g, '-');
  assert.deepEqual([fixes.limit, fixes.total, fixes.smaller.length], [10, 5, 0]);
  assert.deepEqual(improve.trim().split('\n').slice(1), fixes.list.map((fix, k) => `${k + 1}. ${plain(fix.text)}`), 'the prompt prints each fix as it is');
  const COMPARE = 'second-iteration/decisions/compare.md';
  assert.deepEqual(fixes.list.map(fix => [fix.id, fix.kind, fix.needs, fix.target, fix.line, fix.files]), [
    ['x1', 'searched', 5, 'CLAUDE.md', null, [CITY, COMPARE, DIRECTION, METRICS]],
    ['x2', 'no-route', 2, 'AGENTS.md', 12, [TIKTOK]],
    ['x3', 'searched', 2, 'AGENTS.md', null, ['llms.txt', 'pipeline/METHOD.md']],
    ['x4', 'told', 1, 'CLAUDE.md', null, []],
    ['x5', 'told', 1, 'CLAUDE.md', null, []]]);
  // The 3 old fixes "Shorten the route to city.md", "to llms.txt" and "to metrics.md" are gone: a far file is not a fix
  // any more. A fix is now a root cause: a needed file with a route that the agent did not take.
  // city.md (R2, R3: search) and compare.md (B: search) have their link in decisions/index.md. direction.md (B) and
  // metrics.md (R4) have their link in llms.txt, and the user gave the path of each. The 2 linkers are 2 steps from the
  // start (CLAUDE.md > AGENTS.md > the linker), so the agent does not read them first: one fix, a link from CLAUDE.md.
  for (const linker of [INDEX, 'llms.txt']) assert.equal(report.map.files.find(file => file.path === linker).steps, 2, linker);
  const x1 = plain(fixes.list[0].text);
  assert.equal(improve.includes(`\n1. ${x1}\n`), true);
  assert.equal(x1.startsWith('Link these files from CLAUDE.md, or from an index file that it links by name, with one line each that says when to read it: ' +
    `${CITY} (2 times), ${COMPARE} (1 time), `), true, x1);
  assert.ok(x1.includes('Today only files that the agent does not read first name them (a file 2 or more steps from the start, or a file that only a folder link reaches).'));
  // The count words of direction.md and metrics.md, and the total of this text, are not checked here: the text says
  // "1 search" for a path that the user gave (ways.user is 1, ways.search is 0).
  for (const rel of [DIRECTION, METRICS]) {
    assert.ok(x1.includes(`${rel} (`), rel);
    assert.deepEqual(c.searched.items.find(item => item.path === rel).ways, { search: 0, user: 1, none: 0 }, rel);
  }
  // The orphan: no file links it, and AGENTS.md (line 12) names its top folder `first-iteration/` as plain text.
  assert.ok(improve.includes(`\n2. In AGENTS.md (line 12), add a link to ${TIKTOK} next to the folder name first-iteration. 2 intents needed it. No file links to it.\n`));
  // R4 found llms.txt by search, and B found METHOD.md by search. AGENTS.md links them on lines 11 and 10. AGENTS.md is
  // 1 step from the start, so the fix is its link text: one fix for the 2 files.
  assert.ok(improve.includes('\n3. In AGENTS.md, make the link text of each file say what the file holds and when to read it: ' +
    'llms.txt (line 11, 1 time), pipeline/METHOD.md (line 10, 1 time). The agent got them with no link 2 times (a search, a path from the user, or a read with nothing that named the file).\n'));
  // The 2 told facts, with the times the user typed each.
  assert.ok(improve.includes('\n4. Add this fact to CLAUDE.md, or to a file that it links: "City pages must use LayoutV2 - always". The user typed it 1 time.\n'));
  assert.ok(improve.includes('\n5. Add this fact to CLAUDE.md, or to a file that it links: "The current profile rule is in second-iteration/direction.md, not in pipeline/METHOD.md". The user typed it 1 time.\n'));
  // The old fix 'Keep "No tests in this project" only in AGENTS.md' is gone: a copy with the same value is not a fix any more.
  for (const r of [r1, r3, r4, r5, r6]) {
    assert.ok(!r.report.prompt.text.includes('Shorten the route') && !/Keep "[^"]*" only in/.test(r.report.prompt.text), 'no fix for a far file or for a copy');
  }
  // Each file of line a and line b is in one fix.
  assert.deepEqual(fixes.list.flatMap(fix => fix.files).sort(), [...c.noRoute.items, ...c.searched.items].map(item => item.path).sort());
  // Section 6 compares the 5 counts.
  assert.ok(text.includes('Compare the 5 counts with the counts above (lines a to e of section 1), and report the change. Lines b and c fall only with new sessions.'));
  assert.ok(!text.includes('Compare the health score'));
  assert.ok(!text.includes('..'), 'no double period');
  for (const r of [r1, r3, r4, r5, r6]) assert.ok(!/[\u2013\u2014]/.test(r.report.prompt.text), 'no en dash or em dash');
  // Q5: no analysed intent. Rows a, b and c have no data, and the sentence of section 5 has no number.
  const t3 = r3.report.prompt.text;
  const c3 = r3.report.health.counts;
  assert.equal(c3.reason, 'not-analysed');
  assert.deepEqual(r3.report.fixes, { limit: 10, total: 0, list: [], smaller: [], left: { copies: 0, notNamed: 0 } });
  assert.ok(t3.includes('- No analysed intents yet. Run context-health with --intents first.'));
  for (const key of ['noRoute', 'searched', 'told']) assert.match(c3[key].text, /: no data$/);
  assert.ok(t3.includes(`- a. ${c3.noRoute.text}.\n- b. ${c3.searched.text}.\n- c. ${c3.told.text}.\n- d. ${c3.startLoad.text}.`));
  assert.ok(t3.includes(`\n- e. ${c3.sessions.text}.\n`));
  assert.ok(t3.includes('## 5. What to improve\nRun context-health with --intents first, so there is data to improve from.\n\n## 6. Then'));
  assert.ok(t3.includes('Compare the 5 counts with the counts above (lines a to e of section 1), and report the change.'));
  console.log(`Artifact: ${path.join(artifact, 'report.json')}`);
});
