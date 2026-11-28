// E2E for the A/B demo in fixtures/context-ab/: run the real command on bad/ and on patched copies of it, with the
// 6 recorded sessions of claude-home/ and the fake claude binary. No real model call.
// Claim: a better context gives shorter routes to the files that the intents need.
//
// Ways the demo can fail (each test names its cases):
// AB1  A patch does not apply to bad/ alone (its text is gone or is there 2 times).
// AB2  A planted fault is not in bad/ (direction.md has a route, or a duplicate fact is missing).
// AB3  The sessions are not read or not scored, so the scores say nothing.
// AB4  better does not give shorter routes or a higher Found than bad.
// AB5  A hot file does not get closer (compare.md, direction.md, METHOD.md).
// AB6  better still names a file in "What to fix first".
// AB7  The counter-example C1 does not lower Cheap (then the README tells a wrong story).
// AB8  C4 does not remove the duplicate facts.
// AB9  The compare table is not the same on two runs, or it holds a path of this machine.
// AB10 The page of `npm run ab` misses a combination, or holds a path of this machine.
// Step 9, the health score and the duplicate check: H4 to H12 and D1 to D13 in the step 9 failure list.
// Step 10, the duplicate check: X8, X10 and X18 in the step 10 failure list. The fake answers have the verdict
// `same` of duplicates-v2. The other checks of step 10 are in test/e2e-step-10-b.test.mjs.
// Step 12, the v1 score: AB14 to AB16 in the step 12 failure list.
//
// Artifact: out/e2e-context-ab/compare-bad-vs-better.md, compare-bad-vs-C1.md, health-by-version.md, and the reports
// in bad/, better/, C1/ to C5/. Step 11: counts-by-version.md. Step 12: v1-by-version.md.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertReportExit } from './report-html.mjs';
import { CONFIG, applyPatch, betterPatches, parseArgs, run } from '../fixtures/context-ab/apply.mjs';
import { compare, summarize } from '../fixtures/context-ab/compare.mjs';
import { build } from '../fixtures/context-ab/ab.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ab = path.join(repo, 'fixtures', 'context-ab');
const artifact = path.join(repo, 'out', 'e2e-context-ab');
mkdirSync(artifact, { recursive: true });

const runVersion = name => {
  const options = parseArgs([name, '--out', path.join(artifact, name)]);
  const { out } = run(options);
  return JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'));
};
const bad = runVersion('bad');
const better = runVersion('better');
const c1 = runVersion('C1');
const [sBad, sBetter, sC1] = [bad, better, c1].map(summarize);
const file = (summary, p) => summary.files.find(f => f.path === p);
const DIRECTION = 'second-iteration/direction.md';
const COMPARE = 'second-iteration/decisions/compare.md';
const METHOD = 'pipeline/METHOD.md';
const badText = rel => readFileSync(path.join(ab, 'bad', rel), 'utf8');

test('AB1: each patch applies to bad/ alone, and better is C2 to C5', () => {
  assert.deepEqual(betterPatches, ['C2', 'C3', 'C4', 'C5']);
  for (const name of ['C1', 'C2', 'C3', 'C4', 'C5']) {
    const copy = path.join(mkdtempSync(path.join(os.tmpdir(), `context-ab-${name}-`)), 'p');
    cpSync(path.join(ab, 'bad'), copy, { recursive: true });
    assert.doesNotThrow(() => applyPatch(copy, name), name);
  }
  assert.throws(() => parseArgs(['C9']), /Unknown patch "C9"/);
});

test('AB2: bad/ has the planted faults', () => {
  assert.equal(file(sBad, DIRECTION).state, 'no_path');
  assert.equal(file(sBad, DIRECTION).route, null);
  // D1: the batch rule, word for word in two files.
  const batch = 'Present the exact city batch before `run_batch`. It submits at once.';
  assert.ok(badText('AGENTS.md').includes(batch));
  assert.ok(badText('pipeline/city-factory/README.md').includes(batch));
  // D2: the status.md limit, 60 in AGENTS.md and 80 in plan.md.
  assert.ok(badText('AGENTS.md').includes('status.md` (60 lines maximum)'));
  assert.ok(badText('second-iteration/plan.md').includes('Keep it under 80 lines.'));
  // D3: the profile rule, current in direction.md and old in METHOD.md.
  assert.ok(badText(DIRECTION).includes('top 8 origin groups'));
  assert.ok(badText(METHOD).includes('top 10 origin groups'));
});

test('AB3: the 6 sessions are read and scored in each version', () => {
  for (const report of [bad, better, c1]) {
    assert.equal(report.score.project.sessions, 6);
    assert.equal(report.score.project.scoredIntents, 6);
    assert.equal(summarize(report).needs, 19);
  }
});

test('AB4: better gives shorter routes and a higher Found than bad', () => {
  assert.deepEqual([sBad.found, sBetter.found], [85, 100]);
  assert.deepEqual([sBad.score, sBetter.score], [95, 100]);
  assert.deepEqual([sBad.noRoute, sBetter.noRoute], [3, 0]);
  assert.deepEqual([sBad.near, sBetter.near], [6, 15]);
  assert.ok(sBetter.meanSteps < sBad.meanSteps);
  assert.ok(sBetter.meanRouteTokens < sBad.meanRouteTokens);
});

test('AB5: the hot files get closer', () => {
  assert.deepEqual(file(sBad, COMPARE).route, { steps: 3, tokens: 719 });
  assert.deepEqual(file(sBetter, COMPARE).route, { steps: 1, tokens: 0 });
  assert.deepEqual(file(sBetter, DIRECTION).route, { steps: 1, tokens: 0 });
  assert.deepEqual(file(sBad, METHOD).route, { steps: 2, tokens: 548 });
  assert.deepEqual(file(sBetter, METHOD).route, { steps: 1, tokens: 0 });
});

test('AB6: bad names direction.md in "What to fix first", better names nothing', () => {
  assert.deepEqual(bad.score.fixFirst.map(f => [f.kind, f.path, f.intents]), [['no_path', DIRECTION, 3]]);
  assert.deepEqual(better.score.fixFirst, []);
});

test('AB7: the counter-example C1 gives shorter routes but a lower Cheap and score', () => {
  assert.equal(file(sC1, 'AGENTS.md').state, 'in_context');
  assert.ok(sC1.meanSteps < sBad.meanSteps);
  assert.ok(sC1.cheap < sBad.cheap, `${sC1.cheap} < ${sBad.cheap}`);
  assert.ok(sC1.score < sBad.score, `${sC1.score} < ${sBad.score}`);
  assert.ok(sC1.startLoadTokens > sBad.startLoadTokens);
});

test('AB8: C4 removes the duplicate facts', () => {
  const copy = path.join(mkdtempSync(path.join(os.tmpdir(), 'context-ab-c4-')), 'p');
  cpSync(path.join(ab, 'bad'), copy, { recursive: true });
  applyPatch(copy, 'C4');
  const text = rel => readFileSync(path.join(copy, rel), 'utf8');
  assert.ok(!text('pipeline/city-factory/README.md').includes('Present the exact city batch before'));
  assert.ok(!text('second-iteration/plan.md').includes('80 lines'));
  assert.ok(!text(METHOD).includes('top 10 origin groups'));
});

test('AB9: the compare table is the same on two runs and has no machine path', () => {
  const table = compare(sBad, sBetter, 'bad', 'better');
  const again = compare(summarize(runVersion('bad')), sBetter, 'bad', 'better');
  assert.equal(again, table);
  assert.ok(!table.includes(os.tmpdir()) && !table.includes(os.homedir()));
  writeFileSync(path.join(artifact, 'compare-bad-vs-better.md'), table);
  writeFileSync(path.join(artifact, 'compare-bad-vs-C1.md'), compare(sBad, sC1, 'bad', 'C1'));
});

test('AB10: npm run ab builds one page with every combination of the patches', () => {
  const { file, versions } = build({ outRoot: path.join(artifact, 'page') });
  assert.equal(Object.keys(versions).length, 32);
  const html = readFileSync(file, 'utf8');
  const data = JSON.parse(html.match(/const DATA = (.*);\n/)[1]);
  assert.deepEqual(Object.keys(data.versions).sort(), Object.keys(versions).sort());
  assert.deepEqual(data.better, ['C2', 'C3', 'C4', 'C5']);
  assert.equal(data.versions.bad.found, 85);
  assert.equal(data.versions['C2+C3+C4+C5'].found, 100);
  assert.ok(data.patches.find(p => p.name === 'C1').counterExample);
  assert.ok(!html.includes(os.tmpdir()) && !html.includes(os.homedir()));
});

// ---------- step 9: the health score and the duplicate check ----------

const versions = { bad, C1: c1, C2: runVersion('C2'), C3: runVersion('C3'), C4: runVersion('C4'), C5: runVersion('C5'), better };
const partsOf = report => { const h = report.health; return [h.score, h.parts.found.score, h.parts.close.score, h.parts.oneSource.score]; };
const cli = path.join(repo, 'bin', 'context-health.mjs');
const fake = path.join(repo, 'test', 'fake-claude.mjs');
// A run of the command on a project copy of apply.mjs, with its own cache and call log.
// Step 11: with the config file of the A/B runs (see apply.mjs), so second-iteration/direction.md stays a context file.
function direct({ project, cache, intents, log, name, config = CONFIG, exit = 0 }) {
  const out = path.join(artifact, 'direct', name);
  const args = [cli, project, '--claude-settings-home', path.join(ab, 'claude-home'), '--old-path', '/Users/example/projects/indoeuromap',
    '--cache', cache, '--out', out, '--no-open', '--ignore', 'none', '--no-save'];
  if (config) args.push('--config', config);
  if (intents) args.push('--intents');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: fake, CONTEXT_HEALTH_FAKE_LOG: log } });
  const json = readFileSync(path.join(out, 'report.json'), 'utf8');
  const report = JSON.parse(json);
  assertReportExit(result, report, exit);
  return { json, report };
}
const dupCalls = log => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  .filter(call => call.stdin.startsWith('context-health duplicates ')) : []);

test('H5, H6, H7, H8: the health score goes up with a better context, on the same sessions', () => {
  // 19 needs: AGENTS.md 6 (1 step), METHOD.md 4 (2), decisions/index.md 3 (2), direction.md 3 (no route in bad),
  // compare.md 2 (3), method-and-data-rules.md 1 (3). A file needed by 4 intents weighs 4 (H8).
  // bad. Found: 16 of 19 = 84.21. Close: 6 x 1 + 7 x 0.5 + 3 x 0.25 = 10.25, / 19 = 53.95.
  //   One source: AGENTS.md (6), METHOD.md (4) and direction.md (3) each have a fact with another value elsewhere: 0.
  //   The 6 other needs: 1. 6 / 19 = 31.58. Total: 42.11 + 16.18 + 6.32 = 64.61, shown 65.
  // better (C2 to C5). Found 19 of 19. Close: 15 x 1 + 3 x 0.5 + 1 x 0.25 = 16.75, / 19 = 88.16.
  //   One source: AGENTS.md, METHOD.md and direction.md still have copies with the same value (the 60 lines limit,
  //   the 200 records rule, the batch rule): 13 x 0.5 + 6 = 12.5, / 19 = 65.79. Total: 50 + 26.45 + 13.16 = 89.61, shown 90.
  // H7: the total comes from the parts before rounding.
  assert.deepEqual(partsOf(bad), [65, 84, 54, 32]);
  assert.deepEqual(partsOf(better), [90, 100, 88, 66]);
  assert.deepEqual([bad.health.label, better.health.label], ['mixed', 'good']);
  // H5: the recorded sessions are the same, so Found comes from the map. H6: each improvement moves a part.
  assert.deepEqual(partsOf(versions.C3), [75, 100, 62, 32], 'C3 gives direction.md a route');
  assert.deepEqual(partsOf(versions.C4), [81, 100, 58, 66], 'C4 removes the copies with other values');
  // C2: the same Close as better (16.75 / 19), the One source of bad: 50 + 26.45 + 6.32 = 82.77, shown 83.
  assert.deepEqual(partsOf(versions.C2), [83, 100, 88, 32], 'C2 links the 3 hot files from CLAUDE.md');
  assert.deepEqual(partsOf(versions.C5), partsOf(bad), 'C5 fixes a link that no session follows');
});

test('H4: a far file that gets a route raises Close (no cliff)', () => {
  // C3 gives direction.md a route of 2 steps. The old Average route got worse (1.81 to 1.84). Close goes up.
  assert.ok(versions.C3.health.parts.close.score > bad.health.parts.close.score);
});

test('H9, H10, H11, H12: the 3 questions, their items and their order', () => {
  const answers = report => ['found', 'close', 'oneSource'].map(key => report.health.parts[key].answer);
  // Step 10, C3: the Close answer also counts the needs with no route. bad: direction.md has no route and 3 intents
  // need it, and no fact was told: 3 needs. better: each need has a route, so the answer does not change.
  assert.deepEqual(answers(bad), ['1 file lost', '4 files far, 3 needs have no route', '3 facts disagree, 5 copied']);
  assert.deepEqual(answers(better), ['Yes', '2 files far', '6 facts copied']);
  assert.deepEqual([bad.health.parts.close.noRoute, better.health.parts.close.noRoute, versions.C3.health.parts.close.noRoute], [3, 0, 0]);
  // C3 gives direction.md a route of 2 steps: 5 far files (METHOD.md, index.md, direction.md, compare.md, method-and-data-rules.md).
  assert.equal(versions.C3.health.parts.close.answer, '5 files far');
  // Step 10, C6: a part says "Yes" only at 100.
  for (const report of Object.values(versions)) for (const part of Object.values(report.health.parts)) assert.equal(part.answer === 'Yes', part.score === 100);
  const found = bad.health.parts.found;
  assert.deepEqual(found.lost.map(item => [item.path, item.uses, item.why]), [[DIRECTION, 3, 'No file links to it. You had to give the path 3 times.']]);
  // H11, H12: by the needs they cost, then by path. The file needed once is last, with its own fix.
  assert.deepEqual(bad.health.parts.close.far.map(item => [item.path, item.uses, item.steps]), [
    [METHOD, 4, 2], [COMPARE, 2, 3], ['second-iteration/decisions/index.md', 3, 2], ['second-iteration/decisions/method-and-data-rules.md', 1, 3]]);
  assert.match(bad.health.parts.close.far.at(-1).fix, /^Needed by 1 intent\./);
  // Step 10, F3: the fix of the lost file names the file and the real start file. No file names the folder of direction.md as plain text.
  assert.deepEqual([found.lost[0].gap, found.lost[0].underRoot, found.lost[0].fix], [DIRECTION, false, `Link ${DIRECTION} from CLAUDE.md, with one line that says when to read it.`]);
  assert.deepEqual([found.root, found.saved, better.health.parts.found.root], [null, [], null]);
  assert.deepEqual(bad.health.parts.close.far[0].route, ['CLAUDE.md', 'AGENTS.md', METHOD]);
  // The facts with other values come first. Each item names its files and a fix (H10).
  const facts = bad.health.parts.oneSource.facts;
  assert.deepEqual(facts.slice(0, 3).map(fact => [fact.what, fact.differ, fact.keep]), [
    ['The line limit of status.md', true, 'AGENTS.md'],
    ['How many origin groups a city profile shows', true, METHOD],
    ['The smallest group a city profile shows', true, METHOD]]);
  for (const fact of facts) assert.ok(fact.places.length >= 2 && fact.fix.includes(fact.keep), fact.what);
});

test('D7, D8, D9, D12: one fake answer for every version, checked against the text of each', () => {
  // D12: the run id is a hash of the file paths, so bad and better find the same fake answer.
  for (const report of [bad, better, ...Object.values(versions)]) assert.equal(report.duplicates.check.status, 'ok');
  const byWhat = (report, what) => report.duplicates.facts.filter(fact => fact.what === what);
  // D8: bad: 60 and 80 lines differ. better: C4 removed the 80 lines sentence, the 3 places left say 60.
  assert.deepEqual(byWhat(bad, 'The line limit of status.md').map(fact => [fact.differ, fact.places.length]), [[true, 4]]);
  assert.deepEqual(byWhat(better, 'The line limit of status.md').map(fact => [fact.differ, fact.places.length]), [[false, 3]]);
  // D7: C4 removed the old profile rule from METHOD.md: 1 place left, so the fact is dropped, with a note.
  assert.deepEqual(byWhat(better, 'How many origin groups a city profile shows'), []);
  assert.ok(better.duplicates.notes.includes('Fact 2 (How many origin groups a city profile shows): fewer than 2 files are left, so it is left out'));
  assert.ok(better.duplicates.notes.includes('Fact 1 (The line limit of status.md): the quote is not in second-iteration/plan.md, so that place is left out'));
  // Step 10, X8: the fake model says `same: false` for the line limit. In better, the code finds no different number
  // in the 3 places left, so the fact is a copy, and one note says so. In bad, the model and the code agree: no note.
  const overruled = 'the model says that the places do not agree, but they show no different number, literal or name, so it is a copy';
  assert.deepEqual(better.duplicates.notes.filter(note => note.endsWith(overruled)), [`Fact 1 (The line limit of status.md): ${overruled}`]);
  assert.deepEqual(bad.duplicates.notes, []);
  // Step 10, L3: all 58 files fit in the input. The 6 needed files are in it.
  assert.deepEqual(bad.duplicates.check, { status: 'ok', reason: null, costUsd: 0.0412, checked: 58, total: 58, needed: 6, neededChecked: 6 });
  assert.equal(bad.duplicates.promptVersion, 'duplicates-v2');
  // Step 10, L3: the model check read each file, so the One source detail has no line about the limit.
  assert.deepEqual([bad.health.parts.oneSource.coverage, bad.health.parts.oneSource.note], [{ checked: 58, total: 58, needed: 6, neededChecked: 6 }, null]);
  // D9: the batch rule is one fact (from the model), not also an exact one.
  const batch = report => report.duplicates.facts.filter(fact => fact.places.some(place => place.quote.includes('Present the exact city batch')));
  assert.deepEqual(batch(bad).map(fact => [fact.source, fact.places.length]), [['model', 3]]);
  // D3: no fact has two places in the same file.
  for (const fact of bad.duplicates.facts) assert.equal(new Set(fact.places.map(place => place.path)).size, fact.places.length, fact.what);
});

test('D1, D2, D4, D13: without --intents: only exact copies, no duplicates call', () => {
  const { project } = run(parseArgs(['bad', '--out', path.join(artifact, 'direct', 'bad-setup')]));
  const log = path.join(artifact, 'direct', 'calls-no-intents.jsonl');
  writeFileSync(log, '');
  const { report } = direct({ project, cache: mkdtempSync(path.join(os.tmpdir(), 'context-ab-cache-')), intents: false, log, name: 'no-intents' });
  assert.equal(dupCalls(log).length, 0);
  assert.equal(report.duplicates.check.status, 'not-analysed');
  assert.ok(report.duplicates.facts.every(fact => fact.source === 'exact'));
  const quotes = report.duplicates.facts.map(fact => fact.places.map(place => place.path).join(' + ') + ': ' + fact.places[0].quote);
  assert.ok(quotes.includes('AGENTS.md + pipeline/city-factory/README.md: Present the exact city batch before `run_batch`.'), quotes.join('\n'));
  assert.ok(quotes.includes('pipeline/METHOD.md + second-iteration/direction.md: A profile needs 200 classified records.'));
  // D2: each exact copy has 6 or more words, and none starts with a link.
  for (const fact of report.duplicates.facts) {
    for (const place of fact.places) assert.ok(place.quote.replace(/[`*]/g, '').split(/\s+/).length >= 6 && !place.quote.startsWith('['), place.quote);
  }
  // D13: the part says that only exact copies are checked.
  const part = report.health.parts.oneSource;
  assert.deepEqual([part.checked, part.note], ['exact-only', 'Only exact copies are checked. Run with --intents for the full check.']);
});

test('D5, D6: the cache, and a model answer that names a file that is not in the input', () => {
  const { project } = run(parseArgs(['bad', '--out', path.join(artifact, 'direct', 'bad-setup-2')]));
  const cache = mkdtempSync(path.join(os.tmpdir(), 'context-ab-cache-'));
  const log = path.join(artifact, 'direct', 'calls-cache.jsonl');
  writeFileSync(log, '');
  const r1 = direct({ project, cache, intents: true, log, name: 'cache-1' });
  assert.equal(dupCalls(log).length, 1);
  assert.match(dupCalls(log)[0].stdin.split('\n')[0], /^context-health duplicates duplicates-v2 session run-[0-9a-f]{12}$/);
  // D11: only the context files go in, no session text.
  const stdin = dupCalls(log)[0].stdin;
  assert.ok(stdin.includes('\n### FILE AGENTS.md\n'));
  assert.ok(!stdin.includes('City profiles must show the top 8 origin groups'), 'no user message of session 99000001');
  const r2 = direct({ project, cache, intents: true, log, name: 'cache-2', exit: 2 });
  assert.equal(dupCalls(log).length, 1, 'D5: no second call');
  assert.equal(JSON.stringify(r2.report.duplicates), JSON.stringify(r1.report.duplicates));
  // D6: one more file gives another run id. Its fake answer names docs/does-not-exist.md: a bad answer, tried 2 times.
  mkdirSync(path.join(project, 'notes'), { recursive: true });
  writeFileSync(path.join(project, 'notes', 'extra.md'), '# Extra\n\nA note for the D6 test.\n');
  spawnSync('git', ['-C', project, 'add', '-A']);
  // Step 11: no file names notes/extra.md, so the rule alone leaves it out and the run id does not change. This run
  // passes a config file that also includes notes/, so the file is a context file as before.
  const extraConfig = path.join(mkdtempSync(path.join(os.tmpdir(), 'context-ab-config-')), 'context-files.json');
  writeFileSync(extraConfig, `${JSON.stringify({ include: [...JSON.parse(readFileSync(CONFIG, 'utf8')).include, 'notes/**'] }, null, 2)}\n`);
  const r3 = direct({ project, cache, intents: true, log, name: 'unknown-path', config: extraConfig, exit: 2 });
  assert.equal(dupCalls(log).length, 3);
  assert.equal(r3.report.duplicates.check.status, 'failed');
  assert.match(r3.report.duplicates.check.reason, /unknown file "docs\/does-not-exist\.md"/);
  assert.equal(r3.report.health.parts.oneSource.checked, 'exact-only');
});

test('Artifact: the health score of each version', () => {
  const rows = Object.entries(versions).map(([name, report]) => {
    const h = report.health;
    return `| ${name} | ${h.score} ${h.label} | ${h.parts.found.score} | ${h.parts.close.score} | ${h.parts.oneSource.score} | ${h.parts.found.answer} | ${h.parts.close.answer} | ${h.parts.oneSource.answer} |`;
  });
  const table = ['# Health score of each version', '', 'The same 6 recorded sessions on each version of the context. Total = 50% Found + 30% Close + 20% One source.', '',
    '| Version | Score | Found | Close | One source | Can the agent find each file it needs? | Are the needed files close to the start? | Is each fact in one place only? |',
    '|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
  assert.ok(!table.includes(os.tmpdir()) && !table.includes(os.homedir()));
  writeFileSync(path.join(artifact, 'health-by-version.md'), table);
  console.log(`Artifact: ${path.join(artifact, 'health-by-version.md')}`);
});

// ---------- step 11: the 5 counts and the fixes (AB11 to AB13 and NC10 in the step 11 failure list) ----------

const countRow = report => { const c = report.health.counts; return [c.noRoute.files, c.searched.files, c.told.facts, report.fixes.list.length]; };

test('AB11: the config keeps the planted lost file, and bad with no config drops its 3 reads', () => {
  // Each A/B run passes fixtures/context-ab/context-files.json. So second-iteration/direction.md, which no file links
  // in bad, stays a context file, and each version has the same 19 needs for 6 files.
  for (const [name, report] of Object.entries(versions)) {
    assert.deepEqual([name, report.health.counts.needs, report.needs.dropped.needs], [name, { files: 6, needs: 19 }, 0]);
    assert.deepEqual(report.contextRules.config.include, ['second-iteration/**', 'pipeline/**', 'data/**']);
  }
  assert.equal(bad.contextFiles.find(file => file.path === DIRECTION).why, 'config');
  // With no config, the rule alone decides: no context file names direction.md, and its folder is not on the allow list.
  const { project } = run(parseArgs(['bad', '--out', path.join(artifact, 'direct', 'bad-setup-3')]));
  const log = path.join(artifact, 'direct', 'calls-no-config.jsonl');
  writeFileSync(log, '');
  const { report } = direct({ project, cache: mkdtempSync(path.join(os.tmpdir(), 'context-ab-cache-')), intents: false, log, name: 'no-config', config: null });
  assert.equal(report.contextRules.config, null);
  assert.deepEqual(report.contextRules.excluded.find(file => file.path === DIRECTION), { path: DIRECTION, reason: 'not-linked' });
  assert.ok(!report.contextFiles.some(file => file.path === DIRECTION));
});

test('AB12, AB13, NC10: the 5 counts and the fixes of each version, on the same 6 sessions', () => {
  // Line a comes from the map. bad: direction.md (3 needs) has no route. C2, C3 and C4 each give it a link, C1 and C5 do not.
  // Line b comes from the recordings. They do not change: the user gave the path of direction.md 3 times. So when a
  // version gives the file a route, the file moves from line a to line b. Line a plus line b is 1 in each version.
  // Line c: no session has a fact that the user had to type.
  // The fixes of bad: the 3 planted facts with different values (D2 and the 2 parts of D3, each in named files through
  // the config) and the link to direction.md. C4 removes the 3 different values. better: only the link text of
  // direction.md in CLAUDE.md is left.
  const rows = Object.fromEntries(Object.entries(versions).map(([name, report]) => [name, countRow(report)]));
  assert.deepEqual(rows, {
    bad: [1, 0, 0, 4], C1: [1, 0, 0, 4], C2: [0, 1, 0, 4], C3: [0, 1, 0, 4], C4: [0, 1, 0, 1], C5: [1, 0, 0, 4], better: [0, 1, 0, 1]
  });
  for (const row of Object.values(rows)) assert.equal(row[0] + row[1], 1);
  assert.deepEqual(bad.health.counts.noRoute.items, [{ path: DIRECTION, uses: 3 }]);
  assert.deepEqual(better.health.counts.searched.items.map(item => [item.path, item.searched, item.ways, item.linker.path]),
    [[DIRECTION, 3, { search: 0, user: 3, none: 0 }, 'CLAUDE.md']]);
  assert.deepEqual(bad.fixes.list.map(fix => fix.kind), ['one-source', 'one-source', 'one-source', 'no-route']);
  assert.deepEqual(better.fixes.list.map(fix => [fix.kind, fix.target, fix.files]), [['searched', 'CLAUDE.md', [DIRECTION]]]);
  // Line d: C1 loads AGENTS.md at the start with an @ import, so the start load grows. The old score did not show this cost.
  const load = report => report.health.counts.startLoad.tokens;
  assert.ok(load(c1) > load(bad), `${load(c1)} > ${load(bad)}`);
  assert.equal(load(versions.C3), load(bad));
  // Line e: each of the 6 sessions is analysed. The old parts of the score stay in report.json.
  for (const report of Object.values(versions)) {
    assert.equal(report.health.counts.sessions.text, 'From 6 of 6 sessions');
    assert.equal(typeof report.health.score, 'number');
  }
  const lines = Object.entries(versions).map(([name, report]) => {
    const c = report.health.counts;
    return `| ${name} | ${c.noRoute.files} of ${c.noRoute.of} | ${c.searched.files} of ${c.searched.of} | ${c.told.facts} (${c.told.saved} saved) | ${c.startLoad.tokens.toLocaleString('en-US')} tokens | ${c.sessions.analysed} of ${c.sessions.total} | ${report.fixes.list.length} |`;
  });
  const table = ['# The 5 counts of each version', '', 'The same 6 recorded sessions on each version of the context.',
    'Line a comes from the map, so it moves when the context changes. Line b comes from the recordings: a file that gets a route moves from line a to line b, until new sessions use the link.', '',
    '| Version | a. Needed files with no route | b. Needed files with a route that the agent searched | c. Facts you had to type | d. Start load | e. Sessions | Fixes |',
    '|---|---|---|---|---|---|---|', ...lines, ''].join('\n');
  assert.ok(!table.includes(os.tmpdir()) && !table.includes(os.homedir()));
  writeFileSync(path.join(artifact, 'counts-by-version.md'), table);
  console.log(`Artifact: ${path.join(artifact, 'counts-by-version.md')}`);
});

// ---------- step 12: the v1 score is sensitive (AB14 to AB16 in the step 12 failure list) ----------

const v1Row = report => { const v = report.health.v1; return [v.score, v.grades.served, v.grades.slow, v.grades.missed, v.penalty.points]; };
// Why each version has its score. The test checks the direction of each, and the table of the artifact gives the reason.
const V1_REASON = {
  bad: 'The base. direction.md (3 needs) has no route: Missed.',
  C1: 'A counter-example of the old score. CLAUDE.md imports AGENTS.md, so the files that AGENTS.md links are 1 step nearer. AGENTS.md is an instruction file, so its tokens are not a penalty.',
  C2: 'CLAUDE.md links the hot files by name: Slow and Missed needs become Served.',
  C3: 'AGENTS.md names direction.md: its 3 needs go from Missed to Slow (2 steps).',
  C4: 'Each copy of a fact becomes a link to its source. One of these links names direction.md: its 3 needs go from Missed to Slow. Method v1 does not count the copies themselves.',
  C5: 'The same score as bad, by design: a broken link to a file that does not exist is not a need.',
  better: 'C2 to C5 together. The 4 needs that stay Slow are files that only decisions/index.md or AGENTS.md links.'
};

// [score, served, slow, missed, penalty points] of each version, 19 needs each. By hand:
// bad: 6 Served, 10 Slow (METHOD.md 4, decisions/index.md 3, compare.md 2, method-and-data-rules.md 1), 3 Missed
// (direction.md). 100 x (6 + 5) / 19 = 57.9. C3 and C4: direction.md is Slow, 100 x (6 + 6.5) / 19 = 65.8.
// C2 and better: 100 x (15 + 2) / 19 = 89.5 (Math.round gives 89, the value is 89.47). C1: 100 x (13 + 1.5) / 19 = 76.3.
// The start load is below the free 3,000 tokens in each version, so the penalty is 0.
const V1_ROWS = { bad: [58, 6, 10, 3, 0], C1: [76, 13, 3, 3, 0], C2: [89, 15, 4, 0, 0], C3: [66, 6, 13, 0, 0], C4: [66, 6, 13, 0, 0],
  C5: [58, 6, 10, 3, 0], better: [89, 15, 4, 0, 0] };

test('AB14: each planted fix raises the v1 score on the same 6 sessions, or keeps it with a stated reason', () => {
  const rows = Object.fromEntries(Object.entries(versions).map(([name, report]) => [name, v1Row(report)]));
  const score = name => rows[name][0];
  // The grades come from the map of each version. The 19 needs are the same in each version.
  for (const [name, report] of Object.entries(versions)) {
    const v = report.health.v1;
    assert.equal(v.method, 'v3');
    assert.equal(v.grades.total, 19, name);
    assert.equal(v.grades.served + v.grades.slow + v.grades.missed, 19, name);
    assert.equal(v.score, Math.round(Math.max(0, Math.min(100, 100 * (v.grades.served + 0.5 * v.grades.slow) / 19 - v.penalty.points))), name);
    // 6 sessions and 19 needs: thin data (fewer than 20 needs). The page shows no number, report.json keeps it.
    assert.equal(v.shown, 'thin', name);
    // The project copies have no commit, so no session is in the proof.
    assert.equal(v.proof.status, 'not-enough', name);
    assert.equal(v.proof.sessions.used, 0, name);
  }
  assert.deepEqual(rows, V1_ROWS);
  assert.ok(score('C2') > score('bad'), 'C2 raises the score');
  assert.ok(score('C3') > score('bad'), 'C3 raises the score');
  assert.ok(score('C4') > score('bad'), 'C4 raises the score');
  // C5 keeps the score: v1 has no part for a broken link (the reason is in V1_REASON).
  assert.deepEqual(rows.C5, rows.bad);
  assert.ok(score('better') >= Math.max(score('C2'), score('C3')), 'better is not below its best fix');
  assert.ok(score('C1') >= score('bad'), 'the import does not lower the score');
  // bad: direction.md is the 1 Missed file with 3 needs.
  assert.equal(rows.bad[3], 3);
  assert.equal(rows.better[3], 0);
  const lines = Object.entries(versions).map(([name, report]) => {
    const v = report.health.v1;
    return `| ${name} | ${v.score} ${v.label} | ${v.grades.served} | ${v.grades.slow} | ${v.grades.missed} | ${v.raw} | ${v.penalty.points} | ${V1_REASON[name]} |`;
  });
  const table = ['# The v1 score of each version', '', 'The same 6 recorded sessions (19 needs) on each version of the context. Score = 100 x (Served + 0.5 x Slow) / needs, minus the start load penalty.',
    'The data is thin (fewer than 20 needs), so the page shows "Not enough data". The number is in `report.json`.', '',
    '| Version | Score v1 | Served | Slow | Missed | Before the penalty | Penalty | Why |', '|---|---|---|---|---|---|---|---|', ...lines, ''].join('\n');
  assert.ok(!table.includes(os.tmpdir()) && !table.includes(os.homedir()));
  writeFileSync(path.join(artifact, 'v1-by-version.md'), table);
  console.log(`Artifact: ${path.join(artifact, 'v1-by-version.md')}`);
});

test('AB15, AB16: a new context file that no intent used changes the v1 score by 0, and 2 runs give the same v1 object', () => {
  const { project } = run(parseArgs(['bad', '--out', path.join(artifact, 'direct', 'bad-setup-4')]));
  const cache = mkdtempSync(path.join(os.tmpdir(), 'context-ab-cache-'));
  const log = path.join(artifact, 'direct', 'calls-v1.jsonl');
  writeFileSync(log, '');
  const first = direct({ project, cache, intents: true, log, name: 'v1-first' }).report.health.v1;
  const second = direct({ project, cache, intents: true, log, name: 'v1-second', exit: 2 }).report.health.v1;
  assert.deepEqual(second, first);
  assert.deepEqual(first, bad.health.v1);
  // A new file in a docs folder is a context file by the rule of step 11. No intent read it, and no file links it.
  mkdirSync(path.join(project, 'docs'), { recursive: true });
  writeFileSync(path.join(project, 'docs', 'unused-note.md'), '# A note that no session used\n\nThe office plant gets water each Friday.\n');
  spawnSync('git', ['-C', project, 'add', '-A']);
  const added = direct({ project, cache, intents: true, log, name: 'v1-unused-file', exit: 2 }).report;
  assert.ok(added.contextFiles.some(file => file.path === 'docs/unused-note.md'));
  assert.deepEqual([added.health.v1.score, added.health.v1.grades, added.health.v1.penalty.points],
    [first.score, first.grades, first.penalty.points]);
  // The same file with a link from CLAUDE.md: still no need, so the grades do not change. CLAUDE.md is an instruction
  // file, so its longer text is not a penalty.
  const claude = path.join(project, 'CLAUDE.md');
  writeFileSync(claude, `${readFileSync(claude, 'utf8')}\nThe office notes: [unused note](docs/unused-note.md).\n`);
  const linked = direct({ project, cache, intents: true, log, name: 'v1-unused-file-linked', exit: 2 }).report;
  assert.deepEqual([linked.health.v1.score, linked.health.v1.grades, linked.health.v1.penalty.points],
    [first.score, first.grades, first.penalty.points]);
});
