#!/usr/bin/env node
// The A/B demo in one command:  npm run ab
//
// It runs the tool on bad/ with every combination of the patches in patches/ (each run takes a fraction of a
// second), writes one page, out/context-ab/index.html, and opens it. On the page, tick the fixes to apply.
// The page needs no server: the numbers are inside it, and the full reports are in out/context-ab/runs/.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allPatches, betterPatches, run } from './apply.mjs';
import { compare, summarize } from './compare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
// Each patch doubles the runs. Above this count, run only bad, each patch alone, and better.
const MAX_FULL = 7;

const labelOf = patches => (patches.length ? patches.join('+') : 'bad');

function subsets(names) {
  if (names.length > MAX_FULL) return [[], ...names.map(name => [name]), betterPatches];
  const out = [];
  for (let mask = 0; mask < 2 ** names.length; mask += 1) out.push(names.filter((_, k) => mask & (1 << k)));
  return out;
}

export function build({ outRoot = path.join(repo, 'out', 'context-ab') } = {}) {
  const patches = allPatches.map(name => {
    const patch = JSON.parse(readFileSync(path.join(here, 'patches', `${name}.json`), 'utf8'));
    return { name, title: patch.title, reason: patch.reason, counterExample: patch.counterExample || null, edits: patch.edits };
  });
  const versions = {};
  for (const set of subsets(allPatches)) {
    const label = labelOf(set);
    const out = path.join(outRoot, 'runs', label);
    run({ patches: set, label, open: false, out });
    versions[label] = { ...summarize(JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'))), report: `runs/${label}/report.html` };
  }
  mkdirSync(outRoot, { recursive: true });
  const file = path.join(outRoot, 'index.html');
  writeFileSync(file, page({ patches, versions, better: betterPatches, full: allPatches.length <= MAX_FULL }));
  return { file, versions, table: compare(versions.bad, versions[labelOf(betterPatches)], 'bad', 'better') };
}

const json = value => JSON.stringify(value).replace(/</g, '\\u003c');

function page(data) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Context A/B</title>
<style>
:root { --bg: #fafaf9; --panel: #ffffff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4;
  --good: #15803d; --good-bg: #dcfce7; --bad: #b91c1c; --bad-bg: #fee2e2; --accent: #1d4ed8; --warn-bg: #fef3c7; --warn: #92400e; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --panel: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c;
  --good: #4ade80; --good-bg: #14532d; --bad: #f87171; --bad-bg: #7f1d1d; --accent: #93c5fd; --warn-bg: #78350f; --warn: #fde68a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 8px; }
p.lead { color: var(--muted); margin: 0 0 20px; }
.fixes { display: grid; gap: 8px; }
label.fix { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 10px 14px; cursor: pointer; }
label.fix input { margin-top: 4px; width: 18px; height: 18px; }
label.fix.on { border-color: var(--accent); }
.fix .title { font-weight: 600; }
.fix .reason { grid-column: 2; color: var(--muted); font-size: 14px; }
.tag { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 99px; background: var(--warn-bg); color: var(--warn); margin-left: 6px; }
.buttons { display: flex; gap: 8px; margin: 12px 0 0; flex-wrap: wrap; }
button { font: inherit; padding: 6px 16px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
button:hover { border-color: var(--accent); }
.now { margin-top: 12px; color: var(--muted); }
.now b { color: var(--text); }
.wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
th, td { text-align: left; padding: 7px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
td.num { font-variant-numeric: tabular-nums; }
.up { color: var(--good); background: var(--good-bg); border-radius: 4px; padding: 0 6px; font-size: 13px; }
.down { color: var(--bad); background: var(--bad-bg); border-radius: 4px; padding: 0 6px; font-size: 13px; }
.hint { color: var(--muted); font-size: 13px; }
code { font-size: 13px; }
pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; overflow-x: auto; font-size: 13px; margin: 6px 0 14px; }
.del { color: var(--bad); } .add { color: var(--good); }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
<h1>Context A/B</h1>
<p class="lead">The same 6 recorded sessions, scored on the bad context and on the bad context with the fixes you tick.
A better context puts the files the agent needs closer to the start: fewer steps, fewer tokens on the way.</p>

<h2>1. Tick the fixes</h2>
<div class="fixes" id="fixes"></div>
<div class="buttons"><button id="none">Bad (no fix)</button><button id="better">Better (all good fixes)</button></div>
<div class="now" id="now"></div>

<h2>2. The scores</h2>
<div class="wrap"><table id="scores"></table></div>
<p class="hint">Green: better than bad. Red: worse than bad. The score of the tool does not count steps, so the route rows below the score show them.</p>

<h2>3. The route to each file the sessions needed</h2>
<div class="wrap"><table id="files"></table></div>
<p class="hint">A route is the chain of links from the start load to the file. "no route": no link reaches the file, so the user had to give the path. "in context": loaded at start.</p>

<h2>4. What the ticked fixes change in the context</h2>
<div id="edits"></div>

<h2>Full reports</h2>
<p id="reports"></p>
<p class="hint">Your own fix: copy <code>fixtures/context-ab/patches/C5.json</code> to <code>C6.json</code>, edit it, and run <code>npm run ab</code> again. Details: <code>fixtures/context-ab/README.md</code>.</p>
</main>
<script>
const DATA = ${json(data)};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const selected = new Set();
const labelOf = () => DATA.patches.map(p => p.name).filter(n => selected.has(n)).join('+') || 'bad';

const fixes = document.getElementById('fixes');
for (const p of DATA.patches) {
  const el = document.createElement('label');
  el.className = 'fix';
  el.innerHTML = '<input type="checkbox" value="' + esc(p.name) + '"><span class="title">' + esc(p.name) + ': ' + esc(p.title) +
    (p.counterExample ? '<span class="tag">counter-example</span>' : '') + '</span><span class="reason">' +
    esc(p.counterExample ? p.counterExample : p.reason) + '</span>';
  el.querySelector('input').addEventListener('change', e => { e.target.checked ? selected.add(p.name) : selected.delete(p.name); draw(); });
  fixes.appendChild(el);
}
const setAll = names => { selected.clear(); names.forEach(n => selected.add(n)); draw(); };
document.getElementById('none').onclick = () => setAll([]);
document.getElementById('better').onclick = () => setAll(DATA.better);

// [name, get, higher is better]
const ROWS = [
  ['Score', s => s.score, true], ['Found', s => s.found, true], ['Cheap', s => s.cheap, true], ['No missing', s => s.missing, true],
  ['Needs with no route', s => s.noRoute, false], ['Needs at 0 or 1 step', s => s.near, true],
  ['Mean steps of a need with a route', s => s.meanSteps, false], ['Mean route tokens of a need with a route', s => s.meanRouteTokens, false],
  ['Start load tokens', s => s.startLoadTokens, false], ['Broken links', s => s.brokenLinks, false]
];
const delta = (a, b, higher) => {
  if (a == null || b == null || a === b) return '';
  const d = Math.round((b - a) * 100) / 100;
  return ' <span class="' + ((d > 0) === higher ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + d + '</span>';
};
const routeText = f => !f ? 'not read' : !f.route ? 'no route' : f.state === 'in_context' ? 'in context' : f.route.steps + (f.route.steps === 1 ? ' step, ' : ' steps, ') + f.route.tokens + ' tokens';
// Lower is better: in context (0), then steps, then tokens. No route is worst.
const cost = f => !f || !f.route ? Infinity : f.route.steps * 1e6 + f.route.tokens;

const lines = text => text.replace(/\\n+$/, '').split('\\n');

function draw() {
  const label = labelOf();
  const name = label === DATA.better.join('+') ? 'better' : label;
  const a = DATA.versions.bad;
  const b = DATA.versions[label];
  for (const input of fixes.querySelectorAll('input')) { input.checked = selected.has(input.value); input.parentElement.classList.toggle('on', input.checked); }
  try { history.replaceState(null, '', '#' + label); } catch (e) {}
  const now = document.getElementById('now');
  if (!b) {
    now.innerHTML = 'Version <b>' + esc(label) + '</b> was not run (too many patches for all combinations). Pick one fix, no fix, or Better.';
    return;
  }
  now.innerHTML = 'Right column: <b>' + (label === 'bad' ? 'bad, no fix' : (name === 'better' ? 'better = ' : '') + 'bad + ' + esc(label.split('+').join(', '))) + '</b>';
  document.getElementById('scores').innerHTML = '<tr><th></th><th>bad</th><th>' + esc(name) + '</th></tr>' +
    ROWS.map(([name, get, higher]) => '<tr><td>' + name + '</td><td class="num">' + esc(get(a)) + '</td><td class="num">' + esc(get(b)) + delta(get(a), get(b), higher) + '</td></tr>').join('');
  const paths = [...new Set([...a.files, ...b.files].map(f => f.path))];
  const intents = p => Math.max(...[a, b].map(s => (s.files.find(f => f.path === p) || {}).intents || 0));
  paths.sort((x, y) => intents(y) - intents(x) || (x < y ? -1 : 1));
  document.getElementById('files').innerHTML = '<tr><th>File</th><th>Intents</th><th>bad</th><th>' + esc(name) + '</th></tr>' +
    paths.map(p => {
      const fa = a.files.find(f => f.path === p), fb = b.files.find(f => f.path === p);
      const mark = cost(fb) < cost(fa) ? ' <span class="up">closer</span>' : cost(fb) > cost(fa) ? ' <span class="down">farther</span>' : '';
      return '<tr><td><code>' + esc(p) + '</code></td><td class="num">' + intents(p) + '</td><td>' + routeText(fa) + '</td><td>' + routeText(fb) + mark + '</td></tr>';
    }).join('');
  const ticked = DATA.patches.filter(p => selected.has(p.name));
  document.getElementById('edits').innerHTML = ticked.length ? ticked.map(p => '<p><b>' + esc(p.name) + '</b>: ' + esc(p.title) + '</p>' +
    p.edits.map(e => '<pre><span class="hint">' + esc(e.file) + '</span>\\n' +
      lines(e.find).map(l => '<span class="del">- ' + esc(l) + '</span>').join('\\n') + '\\n' +
      lines(e.replace).map(l => '<span class="add">+ ' + esc(l) + '</span>').join('\\n') + '</pre>').join('')).join('')
    : '<p class="hint">No fix ticked.</p>';
  document.getElementById('reports').innerHTML = '<a href="' + esc(a.report) + '">bad</a>' + (label === 'bad' ? '' : ' and <a href="' + esc(b.report) + '">' + esc(label) + '</a>');
}

const start = decodeURIComponent(location.hash.slice(1));
setAll(start && start !== 'bad' ? start.split('+').filter(n => DATA.patches.some(p => p.name === n)) : []);
</script>
</body>
</html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const started = Date.now();
    const { file, versions, table } = build();
    process.stdout.write(`${table}\n`);
    console.log(`${Object.keys(versions).length} versions in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    console.log(`page: ${file}`);
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawnSync(opener, [file], { stdio: 'ignore' });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
