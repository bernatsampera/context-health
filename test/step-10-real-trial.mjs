#!/usr/bin/env node
// Step 10: the before and after table of the real trial. It only reads reports. It makes no model call and it
// runs no command. `npm test` does not run it (its name does not end in `.test.mjs`).
//
// Usage:
//   node test/step-10-real-trial.mjs --project <name>=<before folder>,<after folder> [--project ...]
//        [--calls <calls.json>] [--out out/e2e-step-10/before-after.md]
//
// <before folder> and <after folder> each hold a report.json of the same project: one from the step 9 code,
// one from the step 10 code. <calls.json> is optional: { "<name>": { "calls": 4, "costUsd": 0.31, "tasks": "..." } }.
// The table names real files of the projects, so the default place is out/ (git ignores it).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { concreteDifference } from '../src/duplicates.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  project: { type: 'string', multiple: true },
  calls: { type: 'string' },
  out: { type: 'string', default: path.join(repo, 'out', 'e2e-step-10', 'before-after.md') }
} });
if (!values.project?.length) {
  console.error('Give one or more --project <name>=<before folder>,<after folder>');
  process.exit(1);
}

const read = folder => JSON.parse(readFileSync(path.join(folder, 'report.json'), 'utf8'));
const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 3).trimEnd()}...` : text);
const isWorktreePath = rel => /(^|\/)\.claude\/worktrees\//.test(rel) || /^\.worktrees\//.test(rel);
const isMemoryPath = rel => /^~\/\.claude\/projects\/[^/]+\/memory\//.test(rel);

// The numbers of one report. Each key that step 9 did not have reads as "not in step 9".
function summary(report) {
  const h = report.health;
  const p = h.parts;
  const d = report.duplicates;
  const lost = p.found.lost || [];
  const fixes = (report.prompt.text.split('\n## 5. What to improve\n')[1] || '').split('\n## ')[0]
    .split('\n').filter(line => /^\d+\. /.test(line)).slice(0, 3);
  const part = key => `${p[key].score ?? 'no data'} (${p[key].answer ?? 'no data'})`;
  const check = d.check;
  const read = check.status !== 'ok' ? `model check ${check.status}`
    : `${check.checked} of ${check.total} files${check.needed == null ? '' : `, ${check.neededChecked} of ${check.needed} needed files`}`;
  const saved = p.found.saved;
  return {
    score: h.score == null ? `none (${h.reason})` : `${h.score} ${h.label}`,
    found: part('found'), close: part('close'), oneSource: part('oneSource'),
    lost: lost.length,
    lostUses: lost.reduce((sum, item) => sum + item.uses, 0),
    lostWorktree: lost.filter(item => isWorktreePath(item.path)).length,
    lostMemory: lost.filter(item => isMemoryPath(item.path)).length,
    root: p.found.root === undefined ? 'not in step 9' : p.found.root ? `${p.found.root.fix} (${p.found.root.uses} uses)` : 'none (the project has a start file)',
    told: (p.found.told || []).length,
    saved: saved === undefined ? 'not in step 9' : saved.length ? saved.map(item => `"${clip(item.text, 70)}" is in ${item.path}`).join('<br>') : 'none',
    differAll: d.facts.filter(fact => fact.differ).length,
    differNeeded: (p.oneSource.facts || []).filter(fact => fact.differ).length,
    differList: (p.oneSource.facts || []).filter(fact => fact.differ).map(fact => `${fact.what}: ${fact.places.map(place => place.value).join(' / ')}`),
    // Replay: the code guard of step 10 on each fact that this report marks as different. No model call.
    differFacts: d.facts.filter(fact => fact.differ),
    copied: (p.oneSource.facts || []).filter(fact => !fact.differ).length,
    read,
    thin: h.data === undefined ? 'not in step 9' : h.data.note ?? 'none (the data is not thin)',
    skipped: h.data === undefined ? 'not in step 9' : h.data.skippedNote ?? 'none',
    startLoad: `${report.totals.startLoadTokens.toLocaleString('en-US')} tokens, ${report.totals.startLoadItems} items`,
    sessions: `${report.sessions.list.length} read, ${report.intents.totals.ok} analysed, ${report.sessions.skipped.length} files skipped`,
    fixes
  };
}

const ROWS = [
  ['Health score', 'score'], ['Found (answer)', 'found'], ['Close (answer)', 'close'], ['One source (answer)', 'oneSource'],
  ['Lost files', 'lost'], ['Needs for the lost files', 'lostUses'], ['Lost files with a worktree path', 'lostWorktree'],
  ['Lost files in the memory folder', 'lostMemory'], ['Root item', 'root'],
  ['Facts told by you that count as a gap', 'told'], ['Told facts marked saved', 'saved'],
  ['Facts that disagree, all files', 'differAll'], ['Facts that disagree, in needed files', 'differNeeded'], ['Copied facts in needed files', 'copied'],
  ['The model check read', 'read'], ['Thin data line', 'thin'], ['Skipped files line', 'skipped'],
  ['Start load', 'startLoad'], ['Sessions', 'sessions']
];

const calls = values.calls ? JSON.parse(readFileSync(values.calls, 'utf8')) : {};
const lines = ['# Step 10: the real trial, before and after', '',
  'Before: the report of the step 9 code. After: the report of the step 10 code, on the same project and the same session files.',
  'Build it again with `node test/step-10-real-trial.mjs` (see the head of that file).', ''];
for (const spec of values.project) {
  const [name, folders] = spec.split('=');
  const [beforeDir, afterDir] = folders.split(',');
  const before = summary(read(beforeDir));
  const after = summary(read(afterDir));
  lines.push(`## ${name}`, '', '| | Before (step 9) | After (step 10) |', '|---|---|---|');
  for (const [label, key] of ROWS) lines.push(`| ${label} | ${cell(before[key])} | ${cell(after[key])} |`);
  lines.push('');
  for (const [title, data] of [['Facts that disagree in needed files, before', before], ['Facts that disagree in needed files, after', after]]) {
    lines.push(`${title}:`, '', ...(data.differList.length ? data.differList.map(text => `- ${cell(text)}`) : ['- None.']), '');
  }
  const kept = before.differFacts.filter(fact => concreteDifference(fact.places));
  lines.push(`Replay of the step 10 code guard on the ${before.differFacts.length} facts that step 9 marked as different (all files, no model call). It keeps ${kept.length}:`, '',
    ...(kept.length ? kept.map(fact => `- ${cell(`${fact.what}: ${fact.places.map(place => place.value).join(' / ')}`)}`) : ['- None.']), '');
  for (const [title, data] of [['The first 3 fixes of the prompt, before', before], ['The first 3 fixes of the prompt, after', after]]) {
    lines.push(`${title}:`, '', ...(data.fixes.length ? data.fixes.map(text => cell(text)) : ['None.']), '');
  }
  if (calls[name]) lines.push(`New model calls for the after report: ${calls[name].calls} (${calls[name].tasks}), cost ${calls[name].costUsd.toFixed(2)} USD as the claude binary reports it.`, '');
}
const text = `${lines.join('\n').replace(/[\u2013\u2014]/g, '-').trimEnd()}\n`;
mkdirSync(path.dirname(values.out), { recursive: true });
writeFileSync(values.out, text);
console.log(values.out);
