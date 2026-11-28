// E2E for the Searched grade (method v3) and for the searches that the tool did not see.
// It runs the real command on a small git project with one session, and the fake binary test/fake-claude.mjs. No real model call.
//
// The ways it can fail (written before the code):
// S1 A search in a command that reads files by a wildcard is not seen (`ls -la && cat README* | head`).
// S2 A search in a command that also does something else is not seen (`npm run build; ls docs`).
// S3 A read before the search counts as found by that search, or an `ls` that failed counts.
// S4 A file with no route that the agent found by search, or through a searched file, gets 0 points.
// S5 A file that nothing named, or that the user named, gets points.
// S6 A file with a route loses its grade because the agent searched it.
// S7 Question 1 does not list a searched file, or its fix goes away.
// S8 The grades do not sum to the total, or the score is not (Served + half of Slow + half of Searched) of all needs.
// S9 The change makes new model calls for a session that has its answers.
// S10 The change of the score compares a run with another method.
// S11 The dashboard does not get the new count.
// S12 The proof uses the sessions for its grades (then it proves itself): it must use the map only.
// Artifact: out/e2e-searched/report.html, needs.json (each need with its way and grade) and v1.json (the score).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertReportExit } from './report-html.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'context-health-searched-')));
const artifact = path.join(repo, 'out', 'e2e-searched');
mkdirSync(artifact, { recursive: true });
const project = path.join(work, 'demo');
const files = { 'CLAUDE.md': '# Demo\n\nSee [linked](docs/linked.md).\n', 'README.md': '# Read me\n', 'docs/linked.md': '# Linked\n', 'docs/alpha.md': '# Alpha\n\nMore in [gamma](gamma.md).\n',
  'docs/gamma.md': '# Gamma\n', 'docs/beta.md': '# Beta\n', 'docs/told.md': '# Told\n', 'docs/early.md': '# Early\n', 'docs/failed.md': '# Failed\n' };
for (const [name, text] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(project, name)), { recursive: true });
  writeFileSync(path.join(project, name), text);
}
const git = (...args) => execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } });
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'start');

const ID = '98000001-0000-0000-0000-000000000000';
const home = path.join(work, 'home');
const dir = path.join(home, 'projects', project.replace(/[^A-Za-z0-9]/g, '-'));
mkdirSync(dir, { recursive: true });
let tick = 0;
const base = () => { tick += 1; return { isSidechain: false, cwd: project, sessionId: ID, entrypoint: 'cli', uuid: `x${tick}`, timestamp: `2026-11-20T10:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z` }; };
const user = text => [{ ...base(), type: 'user', message: { role: 'user', content: text }, promptSource: 'typed', origin: { kind: 'human' } }];
const tool = (name, input, result, isError = false) => {
  const id = `t${tick}`;
  return [{ ...base(), type: 'assistant', message: { id: `m${tick}`, role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id, name, input }] } },
    { ...base(), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: isError }] } }];
};
const bash = (command, result, isError) => tool('Bash', { command }, result, isError);
const read = name => tool('Read', { file_path: path.join(project, name) }, files[name].split('\n').slice(0, -1).map((line, k) => `${k + 1}\t${line}`).join('\n'));
writeFileSync(path.join(dir, `${ID}.jsonl`), `${[
  ...user('Learn this project'),
  ...read('docs/early.md'),
  ...bash('ls -la && cat README* 2>/dev/null | head -60 && git log --oneline | head', 'total 8\n-rw-r--r--@ 1 me staff 20 Nov 17 22:43 CLAUDE.md\ndrwxr-xr-x 4 me staff 128 Nov 18 10:47 docs\n-rw-r--r--@ 1 me staff 10 Nov 18 10:46 README.md\n# Read me\nabc123 start'),
  ...read('README.md'),
  ...bash('npm run build; ls docs', '> build\nok\nalpha.md\nearly.md\nlinked.md'),
  ...read('docs/alpha.md'),
  ...read('docs/gamma.md'),
  ...read('docs/linked.md'),
  ...read('docs/beta.md'),
  ...bash('npm run check; ls docs/failed.md', 'ls: docs/failed.md: Permission denied', true),
  ...read('docs/failed.md'),
  ...user('Now read docs/told.md'),
  ...read('docs/told.md')
].map(record => JSON.stringify(record)).join('\n')}\n`);

const log = path.join(work, 'claude.log');
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
const out = path.join(work, 'report');
const run = (exit, ...args) => {
  const result = spawnSync(process.execPath, [path.join(repo, 'bin', 'context-health.mjs'), project, '--claude-settings-home', home, '--out', out, '--cache', path.join(work, 'cache'), '--no-open', ...args],
    { env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test', 'fake-claude.mjs'), CONTEXT_HEALTH_FAKE_LOG: log }, encoding: 'utf8' });
  const report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'));
  assertReportExit(result, report, exit);
  return { report, html: readFileSync(path.join(out, 'report.html'), 'utf8'), stdout: result.stdout };
};
// S10: a run of an older method in the history.
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'history.json'), JSON.stringify([{ at: '2026-11-01T10:00:00.000Z', kind: 'report', ignore: ['user', 'skills'], shown: 'thin', score: 14, label: 'poor', headline: 'x', analysed: 1, needs: 7, fixes: 3, startLoadTokens: 10, contextTokens: 50 }]));
const { report, html, stdout } = run(0, '--yes');
const v1 = report.health.v1;
const needs = Object.fromEntries(report.routes.intents.flatMap(intent => intent.needs).map(need => [need.path, need]));
writeFileSync(path.join(artifact, 'report.html'), html.replaceAll(work, '<work>'));
writeFileSync(path.join(artifact, 'v1.json'), `${JSON.stringify({ score: v1.score, grades: v1.grades, questions: v1.questions, proof: v1.proof }, null, 2).replaceAll(work, '<work>')}\n`);
writeFileSync(path.join(artifact, 'needs.json'), `${JSON.stringify(Object.values(needs).map(need => ({ path: need.path, state: need.state, route: need.route })), null, 2)}\n`);
const known = name => report.needs.sessions[0].intents.flatMap(intent => intent.needs).find(need => need.path === name).knownFrom.kind;

test('S1: ls in a command with a wildcard read is a search', () => {
  assert.equal(known('README.md'), 'search');
});

test('S2: ls after another program is a search', () => {
  assert.equal(known('docs/alpha.md'), 'search');
  assert.equal(known('docs/linked.md'), 'search');
});

test('S3: a read before the search, and a failed ls, do not count', () => {
  assert.equal(known('docs/early.md'), 'none');
  assert.equal(known('docs/failed.md'), 'none');
  assert.equal(known('docs/beta.md'), 'none');
  assert.equal(known('docs/told.md'), 'user');
});

test('S4, S5, S6, S8: the grades and the score', () => {
  assert.equal(v1.method, 'v3');
  assert.deepEqual(v1.grades, { served: 1, slow: 0, searched: 3, missed: 4, total: 8 });
  assert.equal(v1.score, Math.round(100 * (1 + 0.5 * 3) / 8));
  assert.deepEqual(needs['docs/gamma.md'].route.map(step => step.how), ['search', 'link']);
});

test('S7: question 1 lists the searched files with the fix', () => {
  const find = v1.questions.find(question => question.key === 'find');
  const grade = name => find.items.find(item => item.path === name)?.grade;
  for (const name of ['README.md', 'docs/alpha.md', 'docs/gamma.md']) assert.equal(grade(name), 'searched', name);
  for (const name of ['docs/beta.md', 'docs/early.md', 'docs/failed.md', 'docs/told.md']) assert.equal(grade(name), 'missed', name);
  assert.equal(grade('docs/linked.md'), undefined);
  assert.equal(find.answer, '3 files searched and 4 files missed');
  assert.ok(report.fixes.list.some(fix => fix.files.includes('docs/alpha.md')));
});

test('S9: a second run makes no new call for the session', () => {
  const count = () => calls().filter(line => line.includes('context-health intents')).length;
  const before = count();
  run(2, '--yes');
  assert.equal(count(), before);
});

test('S10: no change of the score against another method', () => {
  assert.doesNotMatch(html, /id="trend"/);
  assert.doesNotMatch(stdout, /Previous comparable result/);
  assert.equal(JSON.parse(readFileSync(path.join(out, 'history.json'), 'utf8')).at(-1).method, 'v3');
});

test('S11: the dashboard gets the count', () => {
  assert.equal(JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8')).grades.searched, 3);
});

test('S12: the proof grades by the map only', () => {
  const { grades } = v1.proof;
  assert.deepEqual([grades.served.needs, grades.slow.needs, grades.missed.needs], [1, 0, 7]);
});
