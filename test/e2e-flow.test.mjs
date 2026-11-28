// E2E for the flow of use: the question before model calls, the saved options, the run history and `context-health fix`.
// It runs the real command on a git copy of fixtures/indoeuromap and a copy of fixtures/claude-settings-home,
// with the fake binaries test/fake-claude.mjs (claude -p) and test/fake-agent.mjs (interactive claude). No real model call.
//
// The ways it can fail:
// W1  The command makes model calls before the user says yes, or with no terminal and no --yes.
// W2  The question does not come, or "y" does not start the calls.
// W3  The options of the first run are not saved, so a second run with no options loses the old sessions.
// W4  The saved options of one project are used for another project in the same report folder.
// W5  The history does not grow, or the page shows no change against the last run.
// W6  fix starts the agent in the wrong folder, or with a prompt that is not the prompt of the report.
// W7  The fix session counts as a session of the project in the next report.
// W8  fix does not write the report again after the agent stops.
// W9  The page has no fix command, or the rerun command still needs the options that are saved.
// Artifact: out/e2e-flow/report.html, report.json, history.json and settings.json of the last run.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const OLD = '/Users/example/projects/indoeuromap';
const RESEARCH = 'data/research/growth-metrics-2026-10-21/README.md';

// realpath: on macOS /var is /private/var, and the agent sees the real path as its folder.
const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'context-health-flow-')));
const project = path.join(work, 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
if (!existsSync(path.join(project, RESEARCH))) {
  mkdirSync(path.dirname(path.join(project, RESEARCH)), { recursive: true });
  writeFileSync(path.join(project, RESEARCH), '# growth-metrics-2026-10-21\n\nLocal research record.\n');
}
execFileSync('git', ['-C', project, 'init', '-q']);
execFileSync('git', ['-C', project, 'add', '-A']);
const settingsHome = path.join(work, 'claude-settings-home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), settingsHome, { recursive: true });
const out = path.join(work, 'report');
const cache = path.join(work, 'cache');
const claudeLog = path.join(work, 'claude.log');
const agentLog = path.join(work, 'agent.log');

const run = (args, { input = '', ask = false } = {}) => {
  const env = { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test', 'fake-claude.mjs'), CONTEXT_HEALTH_FAKE_LOG: claudeLog,
    CONTEXT_HEALTH_AGENT_BIN: path.join(repo, 'test', 'fake-agent.mjs'), CONTEXT_HEALTH_FAKE_AGENT_LOG: agentLog,
    CONTEXT_HEALTH_FAKE_AGENT_PROJECTS: path.join(settingsHome, 'projects') };
  if (ask) env.CONTEXT_HEALTH_ASK = '1'; else delete env.CONTEXT_HEALTH_ASK;
  const result = spawnSync(process.execPath, [cli, ...args, '--out', out, '--no-open', '--ignore', 'none'], { env, input, encoding: 'utf8' });
  assert.equal(result.status, 0, `context-health failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const calls = () => (existsSync(claudeLog) ? readFileSync(claudeLog, 'utf8').trim().split('\n').filter(Boolean).length : 0);
const json = name => JSON.parse(readFileSync(path.join(out, name), 'utf8'));
const html = () => readFileSync(path.join(out, 'report.html'), 'utf8');

test('W1: no terminal and no --yes: no model call', () => {
  for (const flags of [['--yes', '--no-calls'], ['--no-calls', '--intents']]) {
    const result = spawnSync(process.execPath, [cli, project, '--out', out, ...flags, '--no-open'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Choose either/);
    assert.equal(existsSync(out), false, 'conflicting flags must fail before writing settings');
  }
  for (const flags of [[], ['--headless']]) {
    const result = spawnSync(process.execPath, [cli, 'fix', project, '--out', out, '--no-open', '--no-calls', ...flags], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Fix needs Claude/);
    assert.equal(existsSync(out), false);
  }
  const stdout = run([project, '--claude-settings-home', settingsHome, '--old-path', OLD, '--cache', cache]);
  assert.equal(calls(), 0);
  assert.doesNotMatch(stdout, /Run them\?/);
  assert.ok(json('report.json').sessions.list.length > 0, 'the old sessions are found');
});

test('W3: the options are saved', () => {
  const settings = json('settings.json');
  assert.equal(settings.root, project);
  assert.deepEqual(settings.oldPaths, [OLD]);
  assert.equal(settings.claudeSettingsHome, settingsHome);
  assert.equal(settings.cache, cache);
});

test('W2, W1: the question comes; "n" makes no call', () => {
  const stdout = run([project], { ask: true, input: 'n\n' });
  assert.match(stdout, /sessions? to analyse\. At least \d+ sonnet calls through your Claude account\..*Run them\? \[y\/N\]/);
  assert.equal(calls(), 0);
  assert.match(stdout, /Saved options: old paths \/Users\/example\/projects\/indoeuromap/);
});

test('W2, W3: "y" makes the calls, with the saved options only', () => {
  const sessionsBefore = json('report.json').sessions.list.length;
  run([project], { ask: true, input: 'y\n' });
  assert.ok(calls() > 0, 'model calls after yes');
  const model = json('report.json');
  assert.equal(model.sessions.list.length, sessionsBefore);
  assert.ok(model.intents.totals.ok > 0);
});

test('W2: with all answers in the cache there is no question', () => {
  const before = calls();
  const stdout = run([project], { ask: true });
  assert.doesNotMatch(stdout, /Run them\?/);
  assert.equal(calls(), before);
});

test('W5: the history grows only on a change, and cold and paid samples are not compared', () => {
  // Run 1 and 2: the same result (one line). Run 3: the calls change it. Run 4: the same as run 3.
  const history = json('history.json');
  assert.equal(history.length, 2);
  assert.ok(history.every(item => item.kind === 'report'));
  assert.equal(history[0].analysed, 0);
  assert.ok(history[1].analysed > 0);
  assert.doesNotMatch(html(), /id="trend"/);
});

test('W9: the page commands need no saved option', () => {
  const page = html();
  const fix = page.match(/<code id="fix-cmd">([^<]*)<\/code>/);
  assert.ok(fix, 'fix command on the page');
  assert.match(fix[1], / fix /);
  assert.doesNotMatch(fix[1], /--old-path|--cache|--claude-settings-home/);
});

test('W6, W7, W8: fix starts the agent, then writes the report again without the fix session', () => {
  const prompt = json('report.json').prompt.text;
  assert.ok(json('report.json').fixes.list.length > 0, 'the fixture has fixes');
  const stdout = run(['fix', project]);
  const [agent] = readFileSync(agentLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(agent.cwd, project);
  assert.equal(agent.argv[0], '--session-id');
  assert.equal(agent.argv.at(-1), prompt);
  const sessionId = agent.argv[1];
  assert.deepEqual(json('settings.json').fixSessions, [sessionId]);
  assert.match(stdout, /The agent is done\. The report runs again\./);
  assert.match(readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), /Fake fix/);
  const model = json('report.json');
  assert.ok(!model.sessions.list.some(item => item.sessionId === sessionId), 'the fix session is not a session');
  assert.ok(model.sessions.skipped.some(item => item.reason === 'fix-session' && item.file === `${sessionId}.jsonl`));
  const history = json('history.json');
  assert.equal(history.at(-1).kind, 'after-fix');
  assert.match(stdout, /Previous comparable result \(/);
  assert.match(html(), /id="trend"[^>]*>Previous comparable result \(/);
  // The artifact: the state after the fix (W4 below reuses the report folder for another project).
  const artifact = path.join(repo, 'out', 'e2e-flow');
  mkdirSync(artifact, { recursive: true });
  for (const name of ['report.html', 'report.json', 'history.json', 'settings.json']) cpSync(path.join(out, name), path.join(artifact, name));
});

test('W4: another project in the same report folder does not take the saved options', () => {
  const other = path.join(work, 'other');
  mkdirSync(other);
  execFileSync('git', ['-C', other, 'init', '-q']);
  const stdout = run([other, '--claude-settings-home', settingsHome, '--cache', path.join(work, 'cache-other')]);
  assert.match(stdout, /They do not count for/);
  assert.deepEqual(json('settings.json').oldPaths, []);
  assert.equal(json('settings.json').fixSessions.length, 0);
});
