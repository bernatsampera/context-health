#!/usr/bin/env node
// Step 12: the validation table of the real trial. It only reads reports. It makes no model call and it runs no
// command. `npm test` does not run it (its name does not end in `.test.mjs`).
//
// Usage:
//   node test/step-12-real-trial.mjs --project <name>=<report folder> [--project ...]
//        [--ab <folder with the A/B reports, default out/e2e-context-ab>] [--calls <calls.json>]
//        [--out out/e2e-step-12/validation.md]
//
// <report folder> holds a report.json of the step 12 code. <calls.json> is optional:
// { "<name>": { "calls": 4, "costUsd": 0.31, "tasks": "..." } }.
// The table names real files and real user words of the projects, so the default place is out/ (git ignores it).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  project: { type: 'string', multiple: true },
  ab: { type: 'string', default: path.join(repo, 'out', 'e2e-context-ab') },
  calls: { type: 'string' },
  out: { type: 'string', default: path.join(repo, 'out', 'e2e-step-12', 'validation.md') }
} });
if (!values.project?.length) {
  console.error('Give one or more --project <name>=<report folder>');
  process.exit(1);
}

const read = folder => JSON.parse(readFileSync(path.join(folder, 'report.json'), 'utf8'));
const num = value => (value == null ? 'no data' : value.toLocaleString('en-US'));
const pct = value => (value == null ? 'no data' : `${Math.round(value * 100)}%`);
const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 3).trimEnd()}...` : text);
const SHOWN = { score: 'the number', 'not-proven': 'Score not proven', thin: 'Not enough data', 'no-data': 'No data' };

function projectPart(name, folder) {
  const report = read(folder);
  const v1 = report.health.v1;
  const lines = [`## ${name}`, ''];
  if (!v1) return [...lines, 'This report has no `health.v1`.', ''];
  const g = v1.grades;
  const p = v1.penalty;
  lines.push('| | |', '|---|---|',
    `| Score (method ${v1.method}) | ${v1.score == null ? 'no data' : `${v1.score} ${v1.label}`} |`,
    `| The page shows | ${SHOWN[v1.shown] ?? v1.shown}${v1.reason ? `: ${cell(v1.reason)}` : ''} |`,
    `| Base | ${cell(v1.base.text)} |`,
    `| Grades | ${num(g.served)} Served, ${num(g.slow)} Slow, ${num(g.missed)} Missed, of ${num(g.total)} needs |`,
    `| Before the penalty | ${v1.raw ?? 'no data'} |`,
    `| Start load penalty | ${num(p.points)} of ${num(p.max)} points: ${num(p.startTokens)} tokens at the start, ${num(p.unusedTokens)} not used, ${num(p.freeTokens)} free |`,
    `| Old score (step 9, for comparison) | ${report.health.score == null ? 'no data' : `${report.health.score} ${report.health.label}`} |`, '');

  const proof = v1.proof;
  lines.push(`### Proof: ${proof.status}`, '', cell(proof.text), '');
  if (proof.grades) {
    lines.push('| Grade on the map of the session commit | Needs | Got with no link | By a search | Path from the user | Nothing named it | Search rate | Typed facts | Typed fact rate |', '|---|---|---|---|---|---|---|---|---|');
    for (const key of ['served', 'slow', 'missed', 'other']) {
      const row = proof.grades[key];
      if (!row || row.needs == null) continue;
      const label = key === 'other' ? `The group to compare (${proof.compare === 'missed' ? 'Missed' : 'Slow and Missed'})` : key[0].toUpperCase() + key.slice(1);
      lines.push(`| ${label} | ${num(row.needs)} | ${num(row.searched)} | ${num(row.ways?.search)} | ${num(row.ways?.user)} | ${num(row.ways?.none)} | ${pct(row.searchRate)} | ${row.typedFacts == null ? 'no data' : Math.round(row.typedFacts * 100) / 100} | ${row.typedFactRate == null ? 'no data' : `${row.typedFactRate} for each need`} |`);
    }
    lines.push('');
  }
  if (proof.checks) lines.push(`Checks: ${Object.entries(proof.checks).map(([key, value]) => `${key} ${value === true ? 'yes' : value === false ? 'no' : 'no data'}`).join(', ')}. Typed facts left out of the rates: ${num(proof.factsLeftOut ?? 0)}.`, '');
  const leftOut = proof.sessions?.leftOut || [];
  lines.push(`Sessions in the proof: ${num(proof.sessions?.used ?? 0)}. Left out: ${num(leftOut.length)}.`);
  const byReason = new Map();
  for (const item of leftOut) byReason.set(item.reason, [...(byReason.get(item.reason) || []), item]);
  for (const [reason, list] of byReason) lines.push(`- ${reason}: ${num(list.length)} (${cell(list[0].text ?? '')})`);
  for (const note of proof.notes || []) lines.push(`- Note: ${cell(note)}`);
  lines.push('');

  lines.push('### The 4 questions', '', '| Question | Answer | Items | Fixes under it |', '|---|---|---|---|');
  const fixes = [...(report.fixes?.list || [])];
  for (const q of v1.questions) {
    lines.push(`| ${cell(q.title)} | ${cell(q.answer ?? 'no data')} | ${num(q.n)} | ${num(fixes.filter(fix => fix.question === q.key).length)} |`);
  }
  lines.push('');

  const rules = v1.facts?.rule || [];
  const tasks = v1.facts?.task || [];
  lines.push(`### Typed facts: ${num(rules.length)} rule, ${num(tasks.length)} task`, '');
  if (rules.length || tasks.length) {
    lines.push('| Kind | Fact | Times | Saved in |', '|---|---|---|---|');
    for (const fact of rules) lines.push(`| rule | ${cell(clip(fact.text, 160))} | ${num(fact.uses ?? 1)} | ${cell(fact.savedPath ?? '')}${fact.savedPath && fact.grade === 'missed' ? ' (no route)' : ''} |`);
    for (const fact of tasks) lines.push(`| task | ${cell(clip(fact.text, 160))} | | |`);
    lines.push('');
  }
  return lines;
}

function abPart(folder) {
  const names = ['bad', 'C1', 'C2', 'C3', 'C4', 'C5', 'better'].filter(name => existsSync(path.join(folder, name, 'report.json')));
  if (!names.length) return ['## A/B fixture', '', `No A/B report in ${path.relative(repo, folder)}. Run \`node --test test/e2e-context-ab.test.mjs\` first.`, ''];
  const lines = ['## A/B fixture', '', 'The same 6 recorded sessions on each version of the context (`fixtures/context-ab`). The data is thin, so the page shows no number. The table gives the number of `report.json`.', '',
    '| Version | Score v1 | Served | Slow | Missed | Before the penalty | Penalty | Start load |', '|---|---|---|---|---|---|---|---|'];
  for (const name of names) {
    const v1 = read(path.join(folder, name)).health.v1;
    if (!v1) { lines.push(`| ${name} | no health.v1 | | | | | | |`); continue; }
    lines.push(`| ${name} | ${v1.score} ${v1.label} | ${v1.grades.served} | ${v1.grades.slow} | ${v1.grades.missed} | ${v1.raw} | ${v1.penalty.points} | ${num(v1.penalty.startTokens)} tokens |`);
  }
  const note = path.join(folder, 'v1-by-version.md');
  if (existsSync(note)) lines.push('', `The reason for each version is in \`${path.relative(repo, note)}\`.`);
  lines.push('');
  return lines;
}

const out = ['# Step 12: validation of the health score, method v1', '',
  'Made by `test/step-12-real-trial.mjs` from the reports of the step 12 code. It names real files and real user words, so it stays in `out/`.', ''];
for (const entry of values.project) {
  const at = entry.indexOf('=');
  out.push(...projectPart(entry.slice(0, at), path.resolve(entry.slice(at + 1))));
}
out.push(...abPart(path.resolve(values.ab)));
if (values.calls && existsSync(values.calls)) {
  const calls = JSON.parse(readFileSync(values.calls, 'utf8'));
  out.push('## Model calls of the real trial', '', '| Project | Calls | Cost (USD) | Tasks |', '|---|---|---|---|');
  for (const [name, item] of Object.entries(calls)) out.push(`| ${name} | ${num(item.calls)} | ${item.costUsd ?? 'no data'} | ${cell(item.tasks ?? '')} |`);
  out.push('');
}
const text = out.join('\n').replace(/[\u2013\u2014]/g, '-');
mkdirSync(path.dirname(values.out), { recursive: true });
writeFileSync(values.out, text);
console.log(values.out);
