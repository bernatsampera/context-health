#!/usr/bin/env node
// Compares two runs of apply.mjs and prints a Markdown table.
//
//   node fixtures/context-ab/compare.mjs                bad against better
//   node fixtures/context-ab/compare.mjs bad C2        bad against C2
//   node fixtures/context-ab/compare.mjs <dir> <dir>   two report folders
//
// A label is a folder in out/context-ab/ (run `node fixtures/context-ab/apply.mjs <label>` first). The table is also written to
// out/context-ab/compare-<a>-vs-<b>.md.
//
// The route of a need: the steps on the map from the start load to the file, and the tokens of the files on the way.
// "in context" is 0 steps (the text was loaded at start). "no route" means no link or path chain reaches the file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outRoot = path.resolve(here, '..', '..', 'out', 'context-ab');

const route = need => {
  if (need.state === 'in_context') return { steps: 0, tokens: 0 };
  if (need.state === 'path' && need.map) return { steps: need.map.steps, tokens: need.map.pathTokens };
  return null;
};

// One version: its scores, and the route of each file need of each intent.
export function summarize(report) {
  const needs = report.needs.sessions.flatMap(session => session.intents.flatMap(intent =>
    intent.needs.filter(need => need.kind === 'file').map(need => ({ ...need, sessionId: session.sessionId }))));
  const routed = needs.map(route).filter(Boolean);
  const mean = values => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null);
  const files = new Map();
  for (const need of needs) {
    const file = files.get(need.path) || { path: need.path, intents: 0, state: need.state, route: route(need) };
    file.intents += 1;
    files.set(need.path, file);
  }
  const p = report.score.project;
  return {
    score: p.score, label: p.label, found: p.found, cheap: p.cheap, missing: p.missing,
    startLoadTokens: report.totals.startLoadTokens,
    brokenLinks: report.map.broken.length,
    needs: needs.length,
    noRoute: needs.length - routed.length,
    near: routed.filter(r => r.steps <= 1).length,
    meanSteps: mean(routed.map(r => r.steps)),
    meanRouteTokens: mean(routed.map(r => r.tokens)),
    files: [...files.values()]
  };
}

const show = file => {
  if (!file) return 'not read';
  if (!file.route) return 'no route';
  if (file.state === 'in_context') return 'in context';
  return `${file.route.steps} steps, ${file.route.tokens} tok`;
};

export function compare(a, b, nameA, nameB) {
  const lines = [`# ${nameA} against ${nameB}`, '', '## Scores', '', `| | ${nameA} | ${nameB} |`, '|---|---|---|'];
  const rows = [
    ['Score', s => `${s.score} ${s.label}`], ['Found', s => s.found], ['Cheap', s => s.cheap], ['No missing', s => s.missing],
    ['Start load tokens', s => s.startLoadTokens], ['Broken links', s => s.brokenLinks],
    ['File needs (all intents)', s => s.needs], ['Needs with no route', s => s.noRoute],
    ['Needs at 0 or 1 step', s => s.near],
    ['Mean steps of a need with a route', s => s.meanSteps], ['Mean route tokens of a need with a route', s => s.meanRouteTokens]
  ];
  for (const [name, get] of rows) lines.push(`| ${name} | ${get(a)} | ${get(b)} |`);
  lines.push('', '## Route of each needed file', '', `| File | Intents | ${nameA} | ${nameB} |`, '|---|---|---|---|');
  const paths = [...new Set([...a.files, ...b.files].map(file => file.path))];
  const intents = p => Math.max(a.files.find(f => f.path === p)?.intents ?? 0, b.files.find(f => f.path === p)?.intents ?? 0);
  paths.sort((x, y) => intents(y) - intents(x) || (x < y ? -1 : 1));
  for (const p of paths) {
    lines.push(`| \`${p}\` | ${intents(p)} | ${show(a.files.find(f => f.path === p))} | ${show(b.files.find(f => f.path === p))} |`);
  }
  return `${lines.join('\n')}\n`;
}

const dirOf = arg => (existsSync(path.join(arg, 'report.json')) ? path.resolve(arg) : path.join(outRoot, arg));
const load = dir => {
  const file = path.join(dir, 'report.json');
  if (!existsSync(file)) throw new Error(`No report in ${dir}. Run: node fixtures/context-ab/apply.mjs ${path.basename(dir)}`);
  return JSON.parse(readFileSync(file, 'utf8'));
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [argA = 'bad', argB = 'better'] = process.argv.slice(2);
    const [dirA, dirB] = [dirOf(argA), dirOf(argB)];
    const [nameA, nameB] = [path.basename(dirA), path.basename(dirB)];
    const text = compare(summarize(load(dirA)), summarize(load(dirB)), nameA, nameB);
    const file = path.join(outRoot, `compare-${nameA}-vs-${nameB}.md`);
    writeFileSync(file, text);
    process.stdout.write(`${text}\nwritten: ${file}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
