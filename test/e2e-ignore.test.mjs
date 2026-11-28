// E2E for the options that ignore a part of the context: --ignore user and --ignore skills.
// It runs the real command on a git copy of fixtures/indoeuromap, with a copy of fixtures/claude-settings-home and a memory folder,
// and the fake binary test/fake-claude.mjs. No real model call.
// user: each file outside the project (~/.claude/CLAUDE.md, ~/AGENTS.md, the memory, the user skills, commands, agents and rules).
// skills: the skills, commands and agents of the project and of the user.
//
// The ways it can fail (written before the code):
// G1  With --ignore none, the report does not count each file.
// G12 With no option, the user files and the skills count. A saved choice of "none" does not win over the default.
// G2  An ignored file is still in the start load, on the map, a need, in a fix, in the prompt or in a duplicate fact.
// G3  A file that is not ignored goes out: a project CLAUDE.md, a doc, a rule of the project.
// G4  The option makes a model call, or the saved answers do not count.
// G5  A rule that only an ignored file holds still counts as saved.
// G6  The change of the score compares a run with the option and a run without it.
// G7  The proof uses the ignored files on the old maps.
// G8  The option is not saved, or "none" does not take it off, or a wrong word is taken.
// G9  After the option is off again, the report is not the same as before.
// G10 The page and the prompt do not say what is ignored.
// G11 A CLAUDE.md above the project, in the same git repository, counts as a user file.
// Artifact: out/e2e-ignore/<option>.html and summary.json (the counts of each run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'context-health-ignore-')));
const artifact = path.join(repo, 'out', 'e2e-ignore');
mkdirSync(artifact, { recursive: true });
const mono = path.join(work, 'mono');
const project = path.join(mono, 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
writeFileSync(path.join(mono, 'CLAUDE.md'), '# Team file of the repository\n');
mkdirSync(path.join(project, '.claude', 'rules'), { recursive: true });
writeFileSync(path.join(project, '.claude', 'rules', 'team.md'), '# Team rule\n');
const git = (...args) => execFileSync('git', ['-C', mono, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' });
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'start', '--date', '2026-01-01T00:00:00Z');
// A CLAUDE.md above the repository, so it is not a file of the team.
writeFileSync(path.join(work, 'CLAUDE.md'), '# Outside the repository\n');
const home = path.join(work, 'home');
cpSync(path.join(repo, 'fixtures', 'claude-settings-home'), home, { recursive: true });
const memory = path.join(home, 'projects', mono.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
mkdirSync(memory, { recursive: true });
writeFileSync(path.join(memory, 'MEMORY.md'), '# Memory\n\n- [Colors](colors.md)\n');
writeFileSync(path.join(memory, 'colors.md'), '# Colors\n\nThe map uses warm colors.\n');

const log = path.join(work, 'claude.log');
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);
const out = path.join(work, 'report');
const env = { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test', 'fake-claude.mjs'), CONTEXT_HEALTH_FAKE_LOG: log };
function command(...args) {
  return spawnSync(process.execPath, [path.join(repo, 'bin', 'context-health.mjs'), project, '--out', out, '--no-open', ...args], { env, encoding: 'utf8' });
}
const summary = {};
function run(name, ...args) {
  const result = command(...args);
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(path.join(out, 'report.html'), 'utf8');
  const report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'));
  writeFileSync(path.join(artifact, `${name}.html`), html.replaceAll(work, '<work>'));
  const v1 = report.health.v1;
  summary[name] = { score: v1.score, grades: v1.grades, startLoad: report.totals.startLoadTokens, boxes: report.routes.map.nodes.map(node => node.id), fixes: report.fixes.list.length };
  writeFileSync(path.join(artifact, 'summary.json'), `${JSON.stringify(summary, null, 2).replaceAll(work, '<work>')}\n`);
  return { html, report, stdout: result.stdout, json: JSON.stringify(report) };
}
const base = ['--claude-settings-home', home, '--old-path', '/Users/example/projects/indoeuromap', '--cache', path.join(work, 'cache')];
const first = run('all', ...base, '--yes', '--ignore', 'none');
const paid = calls();
const user = run('user', '--no-calls', '--ignore', 'user');
const skills = run('skills', '--no-calls', '--ignore', 'skills');
const both = run('both', '--no-calls', '--ignore', 'user,skills');
const kept = run('both-saved', '--no-calls');
const again = run('none', '--no-calls', '--ignore', 'none');

const isUser = rel => Boolean(rel) && (rel.startsWith('~/') || rel.startsWith('/'));
const isSkill = rel => Boolean(rel) && (/^(?:~\/)?\.(?:claude|agents)\/(?:skills|commands|agents)\//.test(rel) || rel === ':skill-list');
const teamFile = path.join(mono, 'CLAUDE.md');
// Each place of a report where a context file can show.
const places = ({ report }) => ({
  startLoad: report.startLoad.map(item => item.path),
  later: report.later.map(item => item.path),
  boxes: report.routes.map.nodes.map(node => node.id),
  needs: report.needs.sessions.flatMap(entry => entry.intents.flatMap(intent => intent.needs.filter(need => need.kind === 'file').map(need => need.path))),
  saved: report.needs.sessions.flatMap(entry => entry.intents.flatMap(intent => intent.needs.map(need => need.savedPath))),
  penalty: report.health.v1.penalty.items.map(item => item.path),
  fixes: report.fixes.list.flatMap(fix => [...(fix.files || []), fix.target]),
  duplicates: report.duplicates.facts.flatMap(fact => fact.places.map(place => place.path)),
  contextFiles: report.contextFiles.map(file => file.path)
});
const check = (result, ignored) => {
  for (const [where, list] of Object.entries(places(result))) {
    assert.deepEqual(list.filter(rel => rel !== teamFile && ignored(rel)), [], where);
  }
};

test('the fixture has both kinds, so the test can fail', () => {
  const all = places(first);
  assert.ok(all.startLoad.some(rel => isUser(rel) && !isSkill(rel)) && all.startLoad.some(isSkill));
  assert.ok(all.needs.some(isSkill), 'a skill is a need');
  assert.ok(all.needs.some(isUser), 'a user file is a need');
  assert.ok(all.boxes.includes(':skill-list') && all.boxes.some(rel => rel.endsWith('/MEMORY.md')));
  assert.ok(all.startLoad.includes(path.join(work, 'CLAUDE.md')));
});

test('G2: with user, no file outside the project is left', () => {
  check(user, isUser);
  assert.ok(!JSON.stringify(user.report.prompt).includes('~/.claude'), 'the prompt');
  assert.ok(places(user).startLoad.some(isSkill), 'the project skills stay');
});

test('G2: with skills, no skill, command or agent is left', () => {
  check(skills, isSkill);
  assert.ok(places(skills).startLoad.includes('~/.claude/CLAUDE.md'), 'the user file stays');
  assert.ok(places(skills).boxes.some(rel => rel.endsWith('/MEMORY.md')), 'the memory stays');
});

test('G2, G3: with both, only the files of the project are left', () => {
  check(both, rel => isUser(rel) || isSkill(rel));
  for (const result of [user, skills, both]) {
    const now = places(result);
    for (const rel of ['CLAUDE.md', '.claude/rules/team.md']) assert.ok(now.startLoad.includes(rel), rel);
    const stays = rel => !isUser(rel) && !isSkill(rel);
    assert.deepEqual(now.contextFiles.filter(stays), places(first).contextFiles.filter(stays));
    assert.deepEqual(now.needs.filter(stays), places(first).needs.filter(stays));
  }
  const dropped = both.report.needs.dropped.byReason.option;
  assert.ok(dropped.needs > 0, 'the report says what it dropped');
  assert.ok(both.report.totals.startLoadTokens < user.report.totals.startLoadTokens && user.report.totals.startLoadTokens < first.report.totals.startLoadTokens);
});

test('G11: the CLAUDE.md of the repository above the project stays, the one above the repository goes', () => {
  assert.ok(places(user).startLoad.includes(teamFile));
  assert.ok(!places(user).startLoad.includes(path.join(work, 'CLAUDE.md')));
});

test('G4: no model call, and the same answers', () => {
  assert.equal(calls(), paid);
  for (const result of [user, skills, both]) {
    assert.deepEqual(result.report.intents, first.report.intents);
    assert.deepEqual(result.report.groups, first.report.groups);
    assert.deepEqual(result.report.needs.sessions.map(entry => entry.check), first.report.needs.sessions.map(entry => entry.check));
    assert.deepEqual(result.report.duplicates.check, again.report.duplicates.check);
  }
  const estimate = command('--estimate', '--ignore', 'user,skills');
  assert.equal(JSON.parse(estimate.stdout.trim().split('\n').at(-1)).total, JSON.parse(command('--estimate', '--ignore', 'none').stdout.trim().split('\n').at(-1)).total);
  assert.equal(calls(), paid);
});

test('G5: a typed rule is saved only in a file that is not ignored', () => {
  const rules = result => result.report.health.v1.facts.rule;
  assert.deepEqual(rules(both).map(rule => rule.text), rules(first).map(rule => rule.text));
  for (const rule of rules(both)) assert.ok(!rule.savedPath || (!isUser(rule.savedPath) && !isSkill(rule.savedPath)));
});

test('G6: the change of the score compares only runs with the same option', () => {
  const history = JSON.parse(readFileSync(path.join(out, 'history.json'), 'utf8'));
  assert.ok(history.some(item => item.ignore?.length === 2) && history.some(item => !item.ignore));
  for (const result of [user, skills, both]) assert.doesNotMatch(result.html, /id="trend"/);
  assert.doesNotMatch(again.html, /id="trend"/);
});

test('G7: the proof has the needs of the score only', () => {
  const total = proof => proof.grades.served.needs + proof.grades.slow.needs + proof.grades.missed.needs;
  const needs = places(both).needs.length;
  assert.ok(total(both.report.health.v1.proof) <= needs);
  const ids = both.report.routes.intents.flatMap(intent => intent.needs.map(need => need.path));
  assert.deepEqual(ids.filter(rel => isUser(rel) || isSkill(rel)), []);
});

test('G8: the option is saved, "none" takes it off, and a wrong word is refused', () => {
  assert.equal(kept.json, both.json);
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'settings.json'), 'utf8')).ignore, []);
  const bad = command('--ignore', 'user,everything');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /--ignore/);
});

test('G12: with no option both are ignored; the saved "none" wins', () => {
  const fresh = path.join(work, 'fresh');
  const go = (...args) => {
    const result = spawnSync(process.execPath, [path.join(repo, 'bin', 'context-health.mjs'), project, '--out', fresh, '--no-open', '--no-calls', ...base, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(path.join(fresh, 'report.json'), 'utf8'));
  };
  const plain = go();
  assert.deepEqual(plain.ignore, ['user', 'skills']);
  assert.equal(JSON.stringify(plain), both.json);
  assert.deepEqual(JSON.parse(readFileSync(path.join(fresh, 'settings.json'), 'utf8')).ignore, ['user', 'skills']);
  assert.equal(go('--ignore', 'none').ignore, undefined);
  assert.equal(go().ignore, undefined);
});

test('G1, G9: with the option off, the report is the same as before it', () => {
  const plain = run('plain', '--no-calls');
  assert.equal(again.json, plain.json);
  assert.equal(again.report.ignore, undefined);
  const same = ({ report }) => JSON.stringify([report.startLoad, report.map, report.needs.sessions, report.routes, report.health.v1.score, report.fixes]);
  assert.equal(same(again), same(first));
});

test('G10: the page and the prompt say what is ignored', () => {
  assert.match(user.html, /Without user settings</);
  assert.match(skills.html, /Without skills</);
  assert.match(both.html, /Without user settings and skills</);
  assert.doesNotMatch(first.html, /Without (?:user|skills)/);
  assert.match(both.report.prompt.text, /not counted/i);
  assert.doesNotMatch(first.report.prompt.text, /not counted/i);
});
