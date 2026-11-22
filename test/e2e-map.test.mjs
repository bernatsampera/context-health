// E2E for step 2 (the map): run the real command on a git copy of fixtures/indoeuromap,
// with fixtures/claude-settings-home instead of ~/.claude. The ways it can fail (M1 to M18) are in
// the step 2 failure list. Artifact: out/e2e-map/report.json and report.html.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const claudeSettingsHome = path.join(repo, 'fixtures', 'claude-settings-home');

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-e2e-map-'));
const project = path.join(work, 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
// The data/research files are git-ignored, also in this repo, so a git copy of the repo can miss them.
const ignoredFiles = [
  'data/research/wave-1-finish-2026-10-20/README.md',
  'data/research/europe-expansion-2026-10-20/README.md',
  'data/research/growth-metrics-2026-10-21/README.md'
];
for (const rel of ignoredFiles) {
  const file = path.join(project, rel);
  if (existsSync(file)) continue;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `# ${rel.split('/')[2]}\n\nLocal research record.\n`);
}
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
git('init', '-q');
git('add', '-A');
const listed = git('ls-files', '-z').split('\0').filter(Boolean).sort();

const run = out => execFileSync('node', [cli, project, '--claude-settings-home', claudeSettingsHome, '--out', out, '--no-open', '--no-save'], { encoding: 'utf8' });
const firstOut = path.join(work, 'run-1');
run(firstOut);
const artifact = path.join(repo, 'out', 'e2e-map');
mkdirSync(artifact, { recursive: true });
run(artifact);
const report = JSON.parse(readFileSync(path.join(artifact, 'report.json'), 'utf8'));
const html = readFileSync(path.join(artifact, 'report.html'), 'utf8');
const map = report.map;
const file = rel => {
  const found = map.files.filter(entry => entry.path === rel);
  assert.equal(found.length, 1, `${rel} is in map.files one time`);
  return found[0];
};
const routeOf = rel => file(rel).route.map(step => step.path).join(' > ');
const fromOf = rel => file(rel).linkedFrom.map(edge => `${edge.path} ${edge.via}`);
const tokensOf = rel => file(rel).tokens;

test('the map key comes after the step 1 keys', () => {
  const keys = Object.keys(report);
  assert.ok(keys.includes('map'));
  // Step 11: the new key `contextRules` is between `contextFiles` and `map`.
  assert.equal(keys.indexOf('contextRules'), keys.indexOf('contextFiles') + 1);
  assert.equal(keys.indexOf('map'), keys.indexOf('contextRules') + 1);
  assert.match(map.rules, /folder link/);
});

test('M1: the shortest route wins', () => {
  const method = file('pipeline/METHOD.md');
  assert.equal(method.reach, 'path');
  assert.equal(method.steps, 2);
  assert.equal(method.via, 'link');
  assert.equal(routeOf('pipeline/METHOD.md'), 'CLAUDE.md > AGENTS.md > pipeline/METHOD.md');
  assert.equal(method.pathTokens, tokensOf('AGENTS.md'));
  assert.equal(method.pathTokens, 548);
  assert.deepEqual(method.route[0], { path: 'CLAUDE.md', via: 'start', line: null });
  assert.deepEqual(method.route[1], { path: 'AGENTS.md', via: 'link', line: 3 });
  assert.deepEqual(method.route[2], { path: 'pipeline/METHOD.md', via: 'link', line: 10 });
  const from = fromOf('pipeline/METHOD.md');
  assert.ok(from.includes('AGENTS.md link'));
  assert.ok(from.includes('llms.txt link'));
});

test('M2: a plain link in CLAUDE.md is a path, not start load', () => {
  const claude = file('CLAUDE.md');
  assert.equal(claude.reach, 'start');
  assert.equal(claude.steps, 0);
  assert.equal(claude.pathTokens, 0);
  assert.equal(claude.via, 'start');
  const agents = file('AGENTS.md');
  assert.equal(agents.reach, 'path');
  assert.equal(agents.steps, 1);
  assert.equal(agents.via, 'link');
  assert.equal(agents.pathTokens, 0);
  assert.deepEqual(map.files.filter(entry => entry.reach === 'start').map(entry => entry.path), ['CLAUDE.md']);
});

test('M3: a link cycle ends and keeps both files', () => {
  const city = file('second-iteration/decisions/city.md');
  const area = file('second-iteration/decisions/area.md');
  assert.equal(city.steps, 3);
  assert.equal(area.steps, 3);
  assert.ok(fromOf('second-iteration/decisions/city.md').includes('second-iteration/decisions/area.md link'));
  assert.ok(fromOf('second-iteration/decisions/area.md').includes('second-iteration/decisions/city.md link'));
});

test('M4, M5, M13: broken links are exactly the 3 real ones', () => {
  assert.deepEqual(map.broken, [
    { source: 'frontend/llms.txt', line: 11, target: 'frontend/src/pages/methodology/[country].astro', raw: 'src/pages/methodology/[country].astro' },
    { source: 'frontend/llms.txt', line: 12, target: 'frontend/src/pages/[country]/index.astro', raw: 'src/pages/[country]/index.astro' },
    { source: 'second-iteration/decisions/compare.md', line: 20, target: 'second-iteration/decisions/compare-demand.md', raw: 'compare-demand.md' }
  ]);
  for (const entry of map.broken) assert.ok(!map.files.some(f => f.path === entry.target), `${entry.target} is not a file`);
  assert.ok(!map.files.some(f => /^[a-z]+:/.test(f.path) || f.path.includes('#')), 'no URL or anchor in files');
  assert.ok(!map.files.some(f => f.path.endsWith('old-hero-copy.md')), 'a link in a code block is not followed');
  assert.ok(!fromOf('second-iteration/direction.md').some(edge => edge.startsWith('second-iteration/decisions/home.md')),
    'a path in a code block is not a mention');
});

test('M6: the orphan has no route', () => {
  const orphan = file('first-iteration/docs/tiktok-first-post-2026-09-27.md');
  assert.equal(orphan.reach, 'none');
  assert.equal(orphan.steps, null);
  assert.equal(orphan.pathTokens, null);
  assert.equal(orphan.via, null);
  assert.deepEqual(orphan.route, []);
  assert.deepEqual(orphan.linkedFrom, []);
});

test('M7: a folder link reaches the direct files of the folder', () => {
  // frontend/llms.txt has steps 2: the body of the command frontend-design-system (trigger, 1 step) names it.
  const index = file('frontend/src/pages/index.astro');
  assert.equal(index.steps, 3);
  assert.equal(index.via, 'folder');
  assert.equal(routeOf('frontend/src/pages/index.astro'), '.claude/commands/frontend-design-system.md > frontend/llms.txt > frontend/src/pages/index.astro');
  const edge = file('second-iteration/decisions/home.md').linkedFrom.find(e => e.path === 'second-iteration/plan.md');
  assert.deepEqual(edge, { path: 'second-iteration/plan.md', via: 'folder', line: 8 });
});

test('M8: each subfolder level of a linked folder adds 1 step', () => {
  const cityMap = file('frontend/src/components/map/CityMap.tsx');
  assert.equal(file('frontend/llms.txt').steps, 2);
  assert.equal(cityMap.steps, 4, 'frontend/llms.txt 2, folder link 1, subfolder level 1');
  assert.equal(cityMap.via, 'folder');
  assert.equal(cityMap.context, false);
  // HomePage.tsx: the folder route (4 steps) ties with the mention in home.md (4 steps). Fewer pathTokens wins.
  const home = file('frontend/src/components/pages/HomePage.tsx');
  assert.equal(home.steps, 4);
  assert.equal(home.via, 'folder');
  assert.equal(home.pathTokens, tokensOf('.claude/commands/frontend-design-system.md') + tokensOf('frontend/llms.txt'));
  assert.ok(fromOf('frontend/src/components/pages/HomePage.tsx').includes('second-iteration/decisions/home.md mention'));
});

test('M9: plain path text is a mention; a bare file name is not', () => {
  // AGENTS.md links pipeline-and-coverage.md, so this decision file has steps 2 and NOW.md has steps 3.
  const now = file('first-iteration/docs/NOW.md');
  assert.equal(now.steps, 3);
  assert.equal(routeOf('first-iteration/docs/NOW.md'), 'CLAUDE.md > AGENTS.md > second-iteration/decisions/pipeline-and-coverage.md > first-iteration/docs/NOW.md');
  assert.equal(now.via, 'mention');
  assert.ok(now.linkedFrom.length > 0);
  for (const edge of now.linkedFrom) {
    assert.ok(edge.path.startsWith('second-iteration/decisions/'), `${edge.path} is a decision file`);
    assert.equal(edge.via, 'mention');
  }
  const missing = 'first-iteration/docs/business/tasks/task-04-home-value-line.md';
  assert.ok(!map.files.some(f => f.path === missing));
  assert.ok(!map.broken.some(b => b.target === missing));
});

test('M10: links into git-ignored files give ignored entries, not broken links', () => {
  for (const rel of ignoredFiles) {
    const entry = file(rel);
    assert.equal(entry.ignored, true);
    // Step 11: a file that git ignores is not a context file, also when a context file links it (`ignored`).
    // It stays a map file with its route, as a code file does. Before, `context` was true.
    assert.deepEqual([entry.context, entry.kind, entry.why], [false, 'excluded', 'ignored']);
    assert.equal(entry.steps, 3);
    assert.equal(entry.route.at(-2).path, 'llms.txt');
  }
  assert.ok(fromOf('data/research/growth-metrics-2026-10-21/README.md').includes('second-iteration/metrics.md link'));
  assert.ok(!report.contextFiles.some(f => f.path.startsWith('data/research/')));
  assert.equal(map.files.filter(f => f.ignored).length, 3);
});

test('M11: a nested CLAUDE.md comes with the first file of its folder', () => {
  const claude = file('frontend/CLAUDE.md');
  const design = file('frontend/DESIGN.md');
  const others = map.files.filter(f => f.path.startsWith('frontend/') && f.steps != null
    && f.path !== 'frontend/CLAUDE.md' && f.path !== 'frontend/DESIGN.md');
  const lowest = Math.min(...others.map(f => f.steps));
  assert.equal(lowest, 2);
  assert.equal(claude.via, 'auto');
  assert.equal(claude.steps, lowest);
  assert.equal(claude.route.at(-2).path, 'frontend/llms.txt');
  assert.equal(design.via, 'import');
  assert.equal(design.steps, lowest);
  assert.equal(routeOf('frontend/DESIGN.md'), '.claude/commands/frontend-design-system.md > frontend/llms.txt > frontend/CLAUDE.md > frontend/DESIGN.md');
  assert.equal(claude.pathTokens, tokensOf('.claude/commands/frontend-design-system.md') + tokensOf('frontend/llms.txt'));
  assert.ok(fromOf('frontend/DESIGN.md').includes('frontend/CLAUDE.md import'));
});

test('M12: skill and command bodies come by trigger; skills for other agents do not', () => {
  for (const rel of ['.claude/skills/geo-audit/SKILL.md', '.claude/commands/brief.md', '~/.claude/skills/unslop/SKILL.md']) {
    const entry = file(rel);
    assert.equal(entry.reach, 'path', rel);
    assert.equal(entry.steps, 1, rel);
    assert.equal(entry.via, 'trigger', rel);
    assert.equal(entry.pathTokens, 0, rel);
    assert.equal(entry.context, true, rel);
  }
  assert.equal(file('~/.claude/skills/unslop/SKILL.md').kind, 'skill body');
  assert.equal(file('.claude/skills/geo-audit/SKILL.md').kind, 'skill');
  for (const rel of ['.agents/skills/source-command-brief/SKILL.md', '.agents/skills/source-command-frontend-design-system/SKILL.md']) {
    assert.equal(file(rel).reach, 'none', rel);
  }
});

test('M14: two runs give the same report', () => {
  assert.equal(readFileSync(path.join(firstOut, 'report.json'), 'utf8'), readFileSync(path.join(artifact, 'report.json'), 'utf8'));
  assert.equal(readFileSync(path.join(firstOut, 'report.html'), 'utf8'), html);
});

test('M15: the totals match the files', () => {
  const t = map.totals;
  const count = test => map.files.filter(test).length;
  assert.equal(t.files, map.files.length);
  assert.equal(t.contextFiles, count(f => f.context));
  assert.equal(t.start, count(f => f.reach === 'start'));
  assert.equal(t.byPath, count(f => f.reach === 'path'));
  assert.equal(t.none, count(f => f.reach === 'none'));
  assert.equal(t.noneContext, count(f => f.reach === 'none' && f.context));
  assert.equal(t.start + t.byPath + t.none, t.files);
  assert.equal(t.brokenLinks, map.broken.length);
  assert.equal(t.maxSteps, Math.max(...map.files.map(f => f.steps ?? 0)));
  assert.equal(t.bySteps.reduce((sum, row) => sum + row.files, 0), t.start + t.byPath);
  assert.deepEqual(t.bySteps.map(row => row.steps), [...new Set(t.bySteps.map(row => row.steps))].sort((a, b) => a - b));
  for (const row of t.bySteps) {
    const files = map.files.filter(f => f.steps === row.steps);
    assert.equal(row.files, files.length);
    assert.equal(row.tokens, files.reduce((sum, f) => sum + f.tokens, 0));
  }
  for (const f of map.files) {
    assert.ok(['start', 'path', 'none'].includes(f.reach), f.path);
    if (f.reach === 'none') assert.deepEqual([f.steps, f.pathTokens, f.via, f.route.length], [null, null, null, 0], f.path);
    else {
      assert.equal(f.route.at(-1).path, f.path);
      assert.equal(f.route.at(-1).via, f.via);
      assert.ok(['start', 'trigger'].includes(f.route[0].via), f.path);
      assert.equal(f.route[0].line, null);
    }
  }
});

test('M16: every listed file is in the map, code files too', () => {
  const projectPaths = map.files.filter(f => !f.ignored && !f.path.startsWith('~/')).map(f => f.path);
  assert.deepEqual(projectPaths, listed);
  const cli = file('pipeline/cli.py');
  assert.equal(cli.kind, 'code');
  assert.equal(file('frontend/package.json').kind, 'code', 'a .json code file is not config');
  // Step 11: a candidate that is out has the kind `excluded` and its reason. The fixture has 5: the 3 research files
  // (git ignores them) and the 2 index files of data/ (no context file names them). Each other file with
  // `context: false` is code, as before.
  assert.deepEqual(map.files.filter(f => f.kind === 'excluded').map(f => `${f.path} ${f.why}`), [
    'data/_index.data.md not-linked',
    'data/research/europe-expansion-2026-10-20/README.md ignored',
    'data/research/growth-metrics-2026-10-21/README.md ignored',
    'data/research/wave-1-finish-2026-10-20/README.md ignored',
    'data/spain/madrid/_index.madrid.md not-linked'
  ]);
  for (const f of map.files.filter(f => !f.context && f.kind !== 'excluded')) assert.equal(f.kind, 'code', f.path);
  assert.equal(file('.mcp.json').kind, 'config');
  assert.equal(cli.context, false);
  assert.equal(cli.steps, 4);
  assert.equal(cli.via, 'link');
  assert.equal(file('pipeline/METHOD.md').context, true);
});

test('M17: the page shows the map', () => {
  // Step 8: the map is drawn from the page data. The list of broken links is not on the new page (report.json keeps it).
  const data = JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
  const node = rel => data.map.nodes.find(item => item.id === rel);
  // Each file in a column by its steps, with the map route for the tooltip.
  for (const entry of map.files.filter(item => item.context && item.kind !== 'config' && item.reach === 'path')) {
    assert.equal(node(entry.path).column, entry.steps, entry.path);
    assert.equal(node(entry.path).lane, 'steps', entry.path);
  }
  assert.deepEqual(node('pipeline/METHOD.md').route, ['CLAUDE.md', 'AGENTS.md', 'pipeline/METHOD.md']);
  assert.equal(node('pipeline/METHOD.md').tokens, file('pipeline/METHOD.md').tokens);
  // The context files with no path are in the lane "No path from the start load", sorted by path.
  const lane = data.map.nodes.filter(item => item.lane === 'none').map(item => item.id);
  assert.deepEqual(lane, map.files.filter(item => item.context && item.kind !== 'config' && item.reach === 'none').map(item => item.path));
  assert.ok(lane.includes('first-iteration/docs/tiktok-first-post-2026-09-27.md'));
  assert.equal(data.map.columns, map.totals.maxSteps + 1);
  // The edges of the route tree: each file with a path has one edge from its parent on the route.
  assert.ok(data.map.edges.some(edge => edge.from === 'AGENTS.md' && edge.to === 'pipeline/METHOD.md' && edge.onMap));
  assert.ok(data.map.edges.some(edge => edge.from === ':skill-list' && edge.to === '.claude/skills/city-batch/SKILL.md' && edge.onMap));
  assert.ok(!html.includes('Not built yet'), 'the Not built yet section is gone');
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});

test('M18: the lists are sorted', () => {
  const sorted = (list, key) => list.every((item, i) => i === 0 || key(list[i - 1], item) <= 0);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  assert.ok(sorted(map.files, (a, b) => cmp(a.path, b.path)));
  assert.ok(sorted(map.broken, (a, b) => cmp(a.source, b.source) || a.line - b.line || cmp(a.target, b.target)));
  for (const f of map.files) assert.ok(sorted(f.linkedFrom, (a, b) => cmp(a.path, b.path) || a.line - b.line), f.path);
});
