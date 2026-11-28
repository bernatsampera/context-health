// E2E: run the real command on a git copy of fixtures/indoeuromap, with fixtures/claude-settings-home instead of ~/.claude.
// Ways it can fail, and the check for each:
//   F1 reads the real ~/.claude instead of the given folder    -> start load has only fixture user items
//   F2 counts what does not load at start (AGENTS.md by plain link, nested CLAUDE.md, .agents/skills)
//   F3 misses what loads (user and project skills, commands, MCP servers, skill with no description)
//   F4 follows an @ in a code span, or loops on an import cycle -> nested import listed once, no code-span import
//   F5 counts git-ignored files as context                     -> data/research/* absent (step 11: data/**/_index.*.md are out too, no file names them)
//   F6 writes into the project it reads                        -> git status of the copy is unchanged
//   F7 output changes between two runs                         -> report.json is identical byte for byte
//   F8 the page opener crashes the command (open is macOS only) -> no opener: exit 0; the opener of the platform gets the page
// Artifact: out/e2e-indoeuromap/report.json and report.html (same content on every run).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withoutRunFolders } from './report-html.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin', 'context-health.mjs');
const claudeSettingsHome = path.join(repo, 'fixtures', 'claude-settings-home');

const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-e2e-'));
const project = path.join(work, 'indoeuromap');
cpSync(path.join(repo, 'fixtures', 'indoeuromap'), project, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
git('init', '-q');
git('add', '-A');
const statusBefore = git('status', '--porcelain', '--untracked-files=all', '--ignored');

const run = out => execFileSync('node', [cli, project, '--claude-settings-home', claudeSettingsHome, '--out', out, '--no-open', '--ignore', 'none', '--no-save'], { encoding: 'utf8' });
const firstOut = path.join(work, 'run-1');
run(firstOut);
const artifact = path.join(repo, 'out', 'e2e-indoeuromap');
mkdirSync(artifact, { recursive: true });
run(artifact);
const model = JSON.parse(readFileSync(path.join(artifact, 'report.json'), 'utf8'));
const html = readFileSync(path.join(artifact, 'report.html'), 'utf8');
const startKeys = model.startLoad.map(item => `${item.scope} ${item.what} ${item.name || item.path}`);
const laterPaths = model.later.map(item => item.path);

test('F1, F3: the start load is exactly the fixture items', () => {
  assert.deepEqual(startKeys, [
    'user instructions ~/.claude/CLAUDE.md',
    'project instructions CLAUDE.md',
    'user skill description frontend-design',
    'user skill description unslop',
    'project skill description city-batch',
    'project skill description geo-audit',
    'project skill description programmatic-seo',
    'project skill description website-structure',
    'user command description create-commit',
    'project command description brief',
    'project command description frontend-design-system',
    'project MCP server diversity-map-data',
    'project MCP server diversity-map-jobs'
  ]);
  assert.equal(model.startLoad.find(item => item.name === 'city-batch').missingDescription, true);
  assert.equal(model.startLoad.find(item => item.name === 'brief').missingDescription, false, 'first body line counts');
});

test('F2: files that do not load at start stay out of the start load', () => {
  const startPaths = model.startLoad.map(item => item.path);
  for (const file of ['AGENTS.md', 'frontend/CLAUDE.md', 'frontend/DESIGN.md', 'llms.txt']) {
    assert.ok(!startPaths.includes(file), `${file} is not start load`);
  }
  assert.ok(!startPaths.some(file => file.startsWith('.agents/')), '.agents/skills is for other agents');
  assert.equal(model.contextFiles.find(file => file.path === 'AGENTS.md').kind, 'instructions (other agents)');
});

test('F4: nested CLAUDE.md loads with its import once; code spans are not imports', () => {
  assert.deepEqual(laterPaths.filter(file => file.startsWith('frontend/')), ['frontend/CLAUDE.md', 'frontend/DESIGN.md']);
  assert.match(model.later.find(item => item.path === 'frontend/DESIGN.md').trigger, /@ import in frontend\/CLAUDE\.md/);
  assert.ok(!model.startLoad.some(item => item.what === 'import'), 'the @ in a code span is not followed');
});

test('F5: git-ignored files are not context files', () => {
  const data = model.contextFiles.filter(file => file.path.startsWith('data/')).map(file => file.path);
  // Step 11: the 2 index files of data/ went out. Git lists them, but no context file names them, they are not in
  // a docs folder, and their name is not `index.md` (`not-linked`). Before, each listed Markdown file counted.
  assert.deepEqual(data, []);
  assert.deepEqual(model.contextRules.excluded.filter(file => file.path.startsWith('data/')),
    [
      { path: 'data/_index.data.md', reason: 'not-linked' },
      { path: 'data/research/europe-expansion-2026-10-20/README.md', reason: 'ignored' },
      { path: 'data/research/growth-metrics-2026-10-21/README.md', reason: 'ignored' },
      { path: 'data/research/wave-1-finish-2026-10-20/README.md', reason: 'ignored' },
      { path: 'data/spain/madrid/_index.madrid.md', reason: 'not-linked' }
    ]);
});

test('F6: the command writes nothing into the project', () => {
  assert.equal(git('status', '--porcelain', '--untracked-files=all', '--ignored'), statusBefore);
  assert.throws(() => execFileSync('node', [cli, project, '--out', path.join(project, 'out'), '--no-open', '--ignore', 'none', '--no-save'],
    { stdio: 'pipe' }), 'an output folder inside the project is refused');
});

test('F7: two runs give the same report', () => {
  assert.equal(readFileSync(path.join(firstOut, 'report.json'), 'utf8'), readFileSync(path.join(artifact, 'report.json'), 'utf8'));
  assert.equal(withoutRunFolders(readFileSync(path.join(firstOut, 'report.html'), 'utf8')), withoutRunFolders(html));
});

test('the page has the header, the map of the context and the Copy markdown button', () => {
  // Step 8 replaced the closed parts (Start load, Behind a trigger, Context files) with the map: each start load
  // instruction file, the skill and command list, and each context file that can be a need is one box on it.
  assert.ok(!html.includes('<h2>The context</h2>') && !html.includes('Not built yet'));
  assert.ok(html.includes('<h1 id="pname">indoeuromap</h1>'));
  assert.ok(html.includes('data-state="no-sessions"'), 'this test passes no --old-path: no sessions');
  // Step 9: the health block replaces the 3 metrics. With no sessions it has no count, and it says why.
  // Step 11: the block has 5 rows of counts. It has no `data-health`: the page does not show the score any more.
  // Step 12: the block is the score of method v1 again. With no sessions it shows "No data" and the reason, and no number.
  assert.ok(html.includes('<section class="health" id="health" data-shown="no-data" data-method="v3" aria-label="Context score">'));
  assert.ok(html.includes('<div class="hstate">No data<') && !html.includes('class="hscore"') && !html.includes('data-health='));
  assert.ok(html.includes('<p class="hreason">The tool found no session of this project.<') && !html.includes('data-metric='));
  const data = JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
  const ids = data.map.nodes.map(node => node.id);
  assert.equal(new Set(ids).size, ids.length, 'no box twice');
  assert.deepEqual(data.map.nodes.filter(node => node.lane === 'start').map(node => node.id), ['~/.claude/CLAUDE.md', 'CLAUDE.md', ':skill-list']);
  for (const item of model.later) assert.ok(ids.includes(item.path), `trigger body ${item.path}`);
  for (const item of model.contextFiles.filter(entry => entry.kind !== 'config')) assert.ok(ids.includes(item.path), item.path);
  for (const item of model.contextFiles.filter(entry => entry.kind === 'config')) assert.ok(!ids.includes(item.path), `config ${item.path}`);
  assert.ok(html.includes('id="copy-md-btn"'));
  console.log(`Artifact: ${path.join(artifact, 'report.html')}`);
});

test('F8: the page opener never crashes the command, and it uses the opener of the platform', () => {
  // No opener on the PATH: the command still ends with exit code 0 and writes the page.
  const empty = mkdtempSync(path.join(work, 'bin-empty-'));
  const out1 = path.join(work, 'run-open-1');
  const r1 = spawnSync(process.execPath, [cli, project, '--claude-settings-home', claudeSettingsHome, '--out', out1],
    { encoding: 'utf8', env: { ...process.env, PATH: empty } });
  assert.equal(r1.status, 0, r1.stderr);
  assert.ok(existsSync(path.join(out1, 'report.html')));
  // A fake opener on the PATH: it gets the path of the page.
  const bin = mkdtempSync(path.join(work, 'bin-fake-'));
  const log = path.join(work, 'opener.log');
  const opener = path.join(bin, process.platform === 'darwin' ? 'open' : 'xdg-open');
  writeFileSync(opener, `#!/bin/sh\necho "$1" >> '${log}'\n`);
  chmodSync(opener, 0o755);
  const out2 = path.join(work, 'run-open-2');
  const r2 = spawnSync(process.execPath, [cli, project, '--claude-settings-home', claudeSettingsHome, '--out', out2],
    { encoding: 'utf8', env: { ...process.env, PATH: bin } });
  assert.equal(r2.status, 0, r2.stderr);
  // The opener runs detached, so wait for it (at most 5 seconds).
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let k = 0; k < 50 && !existsSync(log); k += 1) Atomics.wait(wait, 0, 0, 100);
  for (let k = 0; k < 10 && existsSync(log) && !readFileSync(log, 'utf8').endsWith('\n'); k += 1) Atomics.wait(wait, 0, 0, 100);
  assert.equal(readFileSync(log, 'utf8'), `${path.join(out2, 'report.html')}\n`);
});
