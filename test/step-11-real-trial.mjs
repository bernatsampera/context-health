#!/usr/bin/env node
// Step 11: the before and after table of the real trial. It only reads reports. It makes no model call and it
// runs no command. `npm test` does not run it (its name does not end in `.test.mjs`).
//
// Usage:
//   node test/step-11-real-trial.mjs --project <name>=<before folder>,<after folder> [--project ...]
//        [--calls <calls.json>] [--out out/e2e-step-11/before-after.md]
//
// <before folder> and <after folder> each hold a report.json of the same project: one from the step 10 code,
// one from the step 11 code. <calls.json> is optional: { "<name>": { "calls": 4, "costUsd": 0.31, "tasks": "..." } }.
// The 5 counts of the step 10 column come from the step 10 report with the count rules of step 11 (`buildHealth`),
// so the 2 columns differ only by the context file rule.
// The table names real files of the projects, so the default place is out/ (git ignores it).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildHealth } from '../src/health.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  project: { type: 'string', multiple: true },
  calls: { type: 'string' },
  out: { type: 'string', default: path.join(repo, 'out', 'e2e-step-11', 'before-after.md') }
} });
if (!values.project?.length) {
  console.error('Give one or more --project <name>=<before folder>,<after folder>');
  process.exit(1);
}

const read = folder => JSON.parse(readFileSync(path.join(folder, 'report.json'), 'utf8'));
const num = value => (value == null ? 'no data' : value.toLocaleString('en-US'));
const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 3).trimEnd()}...` : text);
const TEST_PATH = /(^|[\s"'`(,:])(?:tests?|__tests__|e2e|fixtures?)\/[^\s"'`),]+/;
const SRC_PATH = /(^|[\s"'`(,:])src\/[^\s"'`),]+/;

// The numbered fixes of the prompt, section 5.
const promptFixes = report => (report.prompt.text.split('\n## 5. What to improve\n')[1] || '').split('\n## ')[0]
  .split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));

// The 5 counts of a report. A step 10 report has no `health.counts`: the step 11 rules count its data.
function countsOf(report) {
  if (report.health.counts) return report.health.counts;
  try { return buildHealth(report).counts; } catch (error) { return { error: error.message }; }
}

function summary(report) {
  const counts = countsOf(report);
  const fixes = promptFixes(report);
  const copy = fixes.filter(text => text.startsWith('Keep "'));
  const fileNeeds = report.routes.intents.flatMap(intent => intent.needs);
  const dropped = report.needs.dropped;
  const rules = report.contextRules;
  const h = report.health;
  const line = key => (counts.error ? `not built (${counts.error})` : counts[key]?.text ?? 'no data');
  return {
    contextFiles: `${num(report.totals.contextFiles)} (${num(report.totals.contextTokens)} tokens)`,
    excluded: !rules ? 'not in step 10 (each Markdown file counts)'
      : `${num(rules.counts.excluded)}: ${Object.entries(rules.counts.byReason).map(([reason, n]) => `${num(n)} ${reason}`).join(', ') || 'none'}`,
    needs: `${num(fileNeeds.length)} needs for ${num(new Set(fileNeeds.map(need => need.path)).size)} files`,
    dropped: !dropped ? 'not in step 10' : !dropped.needs ? 'none'
      : `${num(dropped.needs)} needs (${num(dropped.reads)} reads, ${num(dropped.files)} files): ${Object.entries(dropped.byReason).map(([reason, item]) => `${num(item.needs)} ${reason}`).join(', ')}`,
    a: line('noRoute'), b: line('searched'), c: line('told'),
    d: counts.error ? line('startLoad') : `${counts.startLoad.text} (${counts.startLoad.top.map(item => `${item.path} ${num(item.tokens)}`).join(', ')})`,
    e: line('sessions'),
    score: h.score == null ? `none (${h.reason})` : `${h.score} ${h.label} (Found ${h.parts.found.score}, Close ${h.parts.close.score}, One source ${h.parts.oneSource.score})`,
    fixes: fixes.length,
    smaller: report.fixes ? report.fixes.smaller.length : 'not in step 10',
    copyFixes: copy.length,
    copyTests: copy.filter(text => TEST_PATH.test(text)).length,
    testFixes: fixes.filter(text => TEST_PATH.test(text)).length,
    srcFixes: fixes.filter(text => SRC_PATH.test(text)).length,
    targets: !report.fixes ? 'not in step 10 (a fix had no target)'
      : `${[...report.fixes.list, ...report.fixes.smaller].filter(fix => /^(?:tests?|src)\//.test(fix.target || '')).length} of ${report.fixes.total} causes`,
    analysed: report.intents.sessions.filter(entry => entry.status === 'ok').map(entry => entry.sessionId),
    promptSize: `${num(report.prompt.text.length)} characters`,
    list: report.fixes ? report.fixes.list.map(fix => `[${fix.kind}, ${num(fix.needs)} ${fix.needs === 1 ? 'need' : 'needs'}] ${clip(fix.text, 260)}`) : fixes.slice(0, 10).map(text => clip(text, 260)),
    droppedTop: dropped ? dropped.list.slice(0, 10).map(item => `${item.path}: ${item.reason}, ${num(item.needs)} ${item.needs === 1 ? 'need' : 'needs'}`) : []
  };
}

const ROWS = [
  ['Context files of the project', 'contextFiles'], ['Markdown files that do not count, by reason', 'excluded'],
  ['File needs', 'needs'], ['Dropped reads, by reason', 'dropped'],
  ['Count a', 'a'], ['Count b', 'b'], ['Count c', 'c'], ['Count d', 'd'], ['Count e', 'e'],
  ['Old health score (kept in report.json)', 'score'],
  ['Fixes in the prompt', 'fixes'], ['Smaller items (not in the prompt)', 'smaller'],
  ['Copy fixes in the prompt', 'copyFixes'], ['Copy fixes that name a test file', 'copyTests'],
  ['Fixes that name a test file', 'testFixes'], ['Fixes that name a file of src/ (as the file to edit, or as a file that the fix covers)', 'srcFixes'],
  ['Fixes whose file to edit is in tests/ or src/', 'targets'], ['Size of the prompt', 'promptSize']
];

const calls = values.calls ? JSON.parse(readFileSync(values.calls, 'utf8')) : {};
const lines = ['# Step 11: the real trial, before and after', '',
  'Before: the report of the step 10 code. After: the report of the step 11 code on the same project, with no new model call for the intents.',
  'The session files changed between the 2 runs (new sessions, and sessions that got longer). A session with no analysis in the cache is "not analysed" in step 11. So count e differs, and the line under each table says how many analysed sessions the 2 reports share.',
  'Count a: needed files with no route. Count b: needed files with a route that the agent searched. Count c: facts that the user typed. Count d: the start load. Count e: the sessions.',
  'The counts of the step 10 column use the count rules of step 11 on the step 10 report, so the 2 columns differ by the context file rule.',
  'Build it again with `node test/step-11-real-trial.mjs` (see the head of that file).', ''];
for (const spec of values.project) {
  const [name, folders] = spec.split('=');
  const [beforeDir, afterDir] = folders.split(',');
  const before = summary(read(beforeDir));
  const after = summary(read(afterDir));
  lines.push(`## ${name}`, '', '| | Step 10 | Step 11 |', '|---|---|---|');
  for (const [label, key] of ROWS) lines.push(`| ${label} | ${cell(before[key])} | ${cell(after[key])} |`);
  const shared = after.analysed.filter(id => before.analysed.includes(id)).length;
  lines.push('', `Analysed sessions: ${before.analysed.length} in step 10, ${after.analysed.length} in step 11, ${shared} in both.`);
  lines.push('', `The fixes of step 11 (${after.list.length}):`, '', ...(after.list.length ? after.list.map((text, k) => `${k + 1}. ${cell(text)}`) : ['None.']), '');
  lines.push('The 10 files with the most dropped reads:', '', ...(after.droppedTop.length ? after.droppedTop.map(text => `- ${cell(text)}`) : ['- None.']), '');
  if (calls[name]) lines.push(`New model calls for the step 11 report: ${calls[name].calls} (${calls[name].tasks}), cost ${calls[name].costUsd.toFixed(2)} USD as the claude binary reports it.`, '');
}
const text = `${lines.join('\n').replace(/[\u2013\u2014]/g, '-').trimEnd()}\n`;
mkdirSync(path.dirname(values.out), { recursive: true });
writeFileSync(values.out, text);
console.log(values.out);
