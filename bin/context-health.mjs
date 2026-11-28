#!/usr/bin/env node
// Usage: context-health [folder] [options]       write the report of the folder (default: the current folder) and open it
//        context-health fix [folder] [options]   start claude in the folder with the improvement prompt, then write the report again
//        context-health ui [--port <n>]          open the dashboard: all projects, with buttons for each step
// Options: [--claude-settings-home <dir>] [--old-path <path>]... [--out <dir>] [--no-open] [--yes|--intents] [--no-calls]
//          [--intents-model <name>] [--cache <dir>] [--sessions <n>] [--config <file>]
// Model calls (claude -p) find the intents of the sessions and check the missing-context corrections.
//   In a terminal, the command asks before it makes calls. --yes (or --intents) makes the calls with no question.
//   --no-calls uses only the cache. Without a terminal, the command uses only the cache, unless --yes is given.
// The options of a run are saved in <out>/settings.json, so the next run of the same project needs no options.
// Each run adds one line to <out>/history.json, and the page shows the change against the last run.
// It never writes into the folder it reads. Only `fix` changes the folder, through claude, and you accept each edit.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collect, listFiles } from '../src/collect.mjs';
import { readConfig } from '../src/context-files.mjs';
import { buildMap } from '../src/map.mjs';
import { dataRootOf, moveOldFolder, projectKey, readJson } from '../src/data-folder.mjs';
import { findDuplicates } from '../src/duplicates.mjs';
import { applyFix, readyFix, startFix } from '../src/fix-worktree.mjs';
import { fixBaseline, fixOutcome, measureFix, observeLater } from '../src/fix-outcome.mjs';
import { buildFixes, relatedFiles, selectFindings } from '../src/fixes.mjs';
import { findGroups } from '../src/groups.mjs';
import { buildHealth } from '../src/health.mjs';
import { buildProof } from '../src/history.mjs';
import { DEFAULT_IGNORE, ignoreDuplicates, ignoreSaved, ignoreStart, parseIgnore } from '../src/ignore.mjs';
import { findIntents, planIntents, runClaude } from '../src/intents.mjs';
import { findNeeds } from '../src/needs.mjs';
import { buildPrompt, findingPrompt } from '../src/prompt.mjs';
import { render } from '../src/render.mjs';
import { buildRoutes } from '../src/routes.mjs';
import { readSessions } from '../src/sessions.mjs';
import { badgeStamp, sessionStamp } from '../src/ui/projects.mjs';
import { score } from '../src/score.mjs';
import { scoreTitle, withProof } from '../src/score-v1.mjs';

const binPath = fileURLToPath(import.meta.url);
const toolRoot = path.resolve(path.dirname(binPath), '..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'claude-settings-home': { type: 'string' },
    'old-path': { type: 'string', multiple: true },
    out: { type: 'string' },
    intents: { type: 'boolean', default: false },
    yes: { type: 'boolean', short: 'y', default: false },
    'no-calls': { type: 'boolean', default: false },
    'intents-model': { type: 'string' },
    cache: { type: 'string' },
    sessions: { type: 'string' },
    config: { type: 'string' },
    ignore: { type: 'string' },
    'no-open': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    'no-save': { type: 'boolean', default: false },
    // For the dashboard: --estimate prints the calls that a run makes, as JSON. fix --headless edits a copy, fix --apply writes the picked files.
    estimate: { type: 'boolean', default: false },
    finding: { type: 'string' },
    fingerprint: { type: 'string' },
    headless: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    file: { type: 'string', multiple: true },
    port: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

if (values.help) {
  console.log('Usage: context-health [folder] [options]      write the report and open it');
  console.log('       context-health fix [folder] [options]  start claude with the improvement prompt, then write the report again');
  console.log('       context-health ui [--port <n>]         open the dashboard: all projects, with buttons for each step');
  console.log('  fix --finding <id>            work on one finding from the saved report (for example x1)');
  console.log('  --yes, -y                     make the model calls with no question (--intents does the same)');
  console.log('  --no-calls                    make no model call: use only the cache');
  console.log('  --old-path <path>             an earlier place of the project, for its sessions (can repeat)');
  console.log('  --sessions <n>                how many of the newest sessions with 2 or more user messages to analyse (default: 20)');
  console.log('  --config <file>               a JSON file outside the project: { "include": [globs], "exclude": [globs] }.');
  console.log('                                "include" makes each matching Markdown file a context file. "exclude" takes it out.');
  console.log('                                In a glob, * and ? stay in one folder, ** crosses folders. A glob starts at the project root.');
  console.log('  --ignore <user,skills|none>   exclude user files or skills from the score (default: user,skills)');
  console.log('                                Paid checks can still send their text to Claude.');
  console.log('  --verbose                     show analysis stage details on a cache-only run');
  console.log('  --intents-model <name>        the model for the calls (default: sonnet)');
  console.log('  --claude-settings-home <dir>  read this folder instead of ~/.claude');
  console.log('  --out <dir>                   the report folder (default: <data>/<project name>-<hash>/)');
  console.log('  --cache <dir>                 the model answer cache (default: <data>/.cache/<project name>-<hash>/)');
  console.log('  --no-open                     do not open the page');
  console.log('  --no-save                     do not read or write the saved options and the history (for the tests)');
  console.log('The options of a run are saved in <out>/settings.json. The next run of the same project uses them.');
  console.log('<data> is out/ in a git checkout of this tool, else ~/.context-health/. Set CONTEXT_HEALTH_HOME to change it.');
  process.exit(0);
}

const fail = message => { console.error(message); process.exit(1); };
if (values.headless && values.apply) fail('Choose either --headless to prepare a fix or --apply to apply reviewed files.');
if (values['no-calls'] && (values.yes || values.intents)) fail('Choose either --no-calls or --yes/--intents.');
if (positionals[0] === 'fix' && values['no-calls'] && !values.apply) fail('Fix needs Claude. Use the report command with --no-calls for a local report.');
if (values.estimate && positionals[0] === 'fix') fail('Use --estimate with the report command.');
const home = os.homedir();
const dataRoot = dataRootOf(toolRoot, home);
if (positionals[0] === 'ui') {
  const { startUi } = await import('../src/ui/server.mjs');
  await startUi({ dataRoot, binPath, home, claudeSettingsHome: path.resolve(values['claude-settings-home'] || path.join(home, '.claude')),
    customHome: values['claude-settings-home'] ? path.resolve(values['claude-settings-home']) : null, port: values.port, open: !values['no-open'] });
  await new Promise(() => {}); // The server runs until Ctrl-C.
}
const command = positionals[0] === 'fix' ? 'fix' : 'report';
const folderArg = command === 'fix' ? positionals[1] : positionals[0];
const root = path.resolve(folderArg || process.cwd());
if (!existsSync(root)) fail(`No such folder: ${root}`);
const key = values['no-save'] ? projectKey(root) : moveOldFolder(dataRoot, root);
const defaultOut = path.join(dataRoot, key);
const outDir = path.resolve(values.out || defaultOut);
const inside = dir => dir === root || dir.startsWith(root + path.sep);
if (inside(outDir)) fail(`The output folder must be outside the project: ${outDir}`);

// ---------- saved options ----------
// An option on the command line replaces the saved value. The new values are saved for the next run.
const settingsPath = path.join(outDir, 'settings.json');
let saved = values['no-save'] ? {} : readJson(settingsPath, {});
// Saved options of another folder do not count. This run saves its own options.
if (saved.root && saved.root !== root) {
  console.log(`The report folder had the options of ${saved.root}. They do not count for ${root}.`);
  saved = {};
}
const abs = value => (value == null ? null : path.resolve(value));
const settings = {
  root,
  oldPaths: values['old-path'] ? values['old-path'].map(abs) : (saved.oldPaths || []),
  config: values.config != null ? abs(values.config) : (saved.config ?? null),
  sessions: values.sessions ?? saved.sessions ?? '20',
  intentsModel: values['intents-model'] ?? saved.intentsModel ?? 'sonnet',
  claudeSettingsHome: values['claude-settings-home'] != null ? abs(values['claude-settings-home']) : (saved.claudeSettingsHome ?? null),
  cache: values.cache != null ? abs(values.cache) : (saved.cache ?? null),
  fixSessions: saved.fixSessions || [],
  ignore: saved.ignore ?? [...DEFAULT_IGNORE]
};
if (values.ignore != null) {
  try { settings.ignore = parseIgnore(values.ignore); } catch (error) { fail(error.message); }
}
const usedSaved = Object.keys(saved).length > 0;
const limit = Number(settings.sessions);
if (!Number.isInteger(limit) || limit < 1) fail(`--sessions needs a whole number of 1 or more: ${settings.sessions}`);
const claudeSettingsHome = settings.claudeSettingsHome || path.join(home, '.claude');
const cacheDir = settings.cache || path.join(dataRoot, '.cache', key);
if (inside(cacheDir)) fail(`The cache folder must be outside the project: ${cacheDir}`);

// The config file of step 11. A bad file stops the command before it writes a report.
let config = null;
if (settings.config != null) {
  try { config = readConfig(settings.config, root); } catch (error) { fail(error.message); }
}

const saveSettings = () => {
  if (values['no-save']) return;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
};
if (!values.estimate) saveSettings();
if (usedSaved) {
  const parts = [settings.oldPaths.length ? `old paths ${settings.oldPaths.join(', ')}` : null,
    settings.config ? `config ${settings.config}` : null, settings.sessions !== '20' ? `sessions ${settings.sessions}` : null,
    settings.intentsModel !== 'sonnet' ? `model ${settings.intentsModel}` : null].filter(Boolean);
  if (parts.length) console.log(`Saved options: ${parts.join(', ')} (${settingsPath})`);
}

// ---------- the commands for the page ----------
const q = value => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${String(value).replace(/'/g, `'\\''`)}'`);
const outFlag = outDir === defaultOut ? [] : ['--out', q(outDir)];
const commands = {
  // With --no-save the options are not saved, so the command must name them.
  rerun: ['node', q(binPath), q(root), ...outFlag, ...(values['no-save'] ? [
    ...settings.oldPaths.flatMap(p => ['--old-path', q(p)]),
    ...(settings.claudeSettingsHome ? ['--claude-settings-home', q(settings.claudeSettingsHome)] : []),
    ...(settings.config ? ['--config', q(settings.config)] : []),
    ...(String(settings.ignore) !== String(DEFAULT_IGNORE) ? ['--ignore', settings.ignore.join(',') || 'none'] : []),
    ...(settings.sessions !== '20' ? ['--sessions', settings.sessions] : []),
    ...(settings.intentsModel !== 'sonnet' ? ['--intents-model', q(settings.intentsModel)] : []),
    ...(settings.cache ? ['--cache', q(settings.cache)] : []), '--no-save'] : [])].join(' '),
  fix: ['node', q(binPath), 'fix', q(root), ...outFlag].join(' ')
};
// --old-path replaces the saved list, so include its existing entries as well.
const oldPathCommand = [commands.rerun, '--no-calls', ...(values['no-save'] ? [] : settings.oldPaths.flatMap(p => ['--old-path', q(p)])), '--old-path', '"/path/to/previous/project"'].join(' ');

// ---------- the model steps ----------
// The steps that can call the model. With allowCalls false, they use only the cache.
async function modelSteps(model, memory, allowCalls, checks = null) {
  const calls = { ok: 0, failed: 0 };
  const call = async request => {
    const result = await runClaude(request);
    calls[result.ok ? 'ok' : 'failed'] += 1;
    return result;
  };
  const options = { call, allowCalls, model: settings.intentsModel, cacheDir };
  model.intents = await findIntents({ sessions: model.sessions, memory, options: { ...options, limit } });
  // The had check of step 5 uses the same option, model and cache as step 4.
  model.needs = await findNeeds({ model, memory, options, keep: checks });
  // Step 8: one model call groups the intents. Routes and the prompt only calculate.
  model.groups = await findGroups({ model, options });
  // Step 9: the exact copies on every run, and one model call for the other duplicate facts.
  model.duplicates = await findDuplicates({ model, options });
  return calls;
}

// The calls that a run with calls makes at least. New sessions can bring more correction checks.
function pendingCalls(model) {
  const pending = result => result.status === 'not-analysed' || (result.status === 'failed' && !/^the model input /.test(result.reason));
  const sessions = model.intents.sessions.filter(pending).length;
  const checks = model.needs.sessions.filter(entry => pending(entry.check)).length;
  const total = sessions + checks + Number(pending(model.groups)) + Number(pending(model.duplicates.check));
  return { sessions, total };
}

function analysisState(model) {
  const failures = [];
  const record = (step, result, sessionId) => {
    if (result.status !== 'failed') return;
    const { reason } = result;
    failures.push({ step, ...(sessionId ? { sessionId } : {}), reason, retryable: !/^the model input /.test(reason) });
  };
  for (const item of model.intents.sessions) record('Session analysis', item, item.sessionId);
  for (const item of model.needs.sessions) record('Correction check', item.check, item.sessionId);
  record('Intent grouping', model.groups);
  record('Duplicate check', model.duplicates.check);
  const { singleMessage, notSelected, tooLong } = model.intents.totals;
  return { pending: pendingCalls(model), failures, skipped: { singleMessage, notSelected, tooLong } };
}

async function quiet(task) {
  const log = console.log;
  console.log = () => {};
  try { return await task(); } finally { console.log = log; }
}

async function askYes(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(question)).trim()); } finally { rl.close(); }
}

// In a terminal the command asks. CONTEXT_HEALTH_ASK=1 makes it ask without a terminal (for the E2E test).
const canAsk = () => (process.stdin.isTTY && process.stdout.isTTY) || process.env.CONTEXT_HEALTH_ASK === '1';

// ---------- the report ----------
// The model with no ignored file. The model answers are the same: only the files and the numbers change.
async function withoutIgnored({ model, collected, files, sessions, memory, checks }) {
  const { ignore } = settings;
  const next = ignoreStart(collected, { ignore, root, home });
  applyMap(next, buildMap({ root, model: next, files, sessions, config }));
  Object.assign(next, { sessions, intents: model.intents, groups: model.groups, duplicates: ignoreDuplicates(model.duplicates, ignore) });
  const given = new Map([...checks].map(([id, item]) => [id, { ...item, results: ignoreSaved(item.results, ignore) }]));
  next.needs = await findNeeds({ model: next, memory, options: { allowCalls: false, model: settings.intentsModel, cacheDir }, given });
  return next;
}

function applyMap(model, built) {
  model.contextFiles = built.contextFiles;
  model.contextRules = built.contextRules;
  model.totals.contextFiles = built.contextFiles.length;
  model.totals.contextTokens = built.contextFiles.reduce((total, file) => total + file.tokens, 0);
  model.map = built.map;
}

async function report(kind, applied) {
  const startedAt = new Date().toISOString();
  const stamp = !values['no-save'] && !values.estimate ? sessionStamp(settings, claudeSettingsHome) : null;
  const initialBadge = stamp && badgeStamp(stamp, cacheDir);
  const { files } = listFiles(root);
  // memory (full texts for steps 4 and 5) is never written to disk.
  const { report: sessions, memory } = readSessions({ root, home, claudeSettingsHome, oldPaths: settings.oldPaths, files,
    skipIds: settings.fixSessions });
  const collected = collect({ root, home, claudeSettingsHome, config });
  let model = collected;
  // Step 10: the sessions are read first, so the map knows the files that a session read and that git does not list.
  // Step 11: the map decides which files are context files, because a link can bring a file in.
  applyMap(model, buildMap({ root, model, files, sessions, config }));
  model.sessions = sessions;

  let allowCalls = values.yes || values.intents;
  if (values.estimate || (!allowCalls && !values['no-calls'] && canAsk())) {
    const probe = { ...model };
    await quiet(() => modelSteps(probe, memory, false));
    const pending = pendingCalls(probe);
    if (values.estimate) {
      console.log(JSON.stringify({ ...pending, model: settings.intentsModel, limit, ignore: settings.ignore }));
      return probe;
    }
    if (pending.total) {
      const what = pending.sessions ? `${pending.sessions} session${pending.sessions === 1 ? '' : 's'} to analyse` : 'some checks to redo';
      console.log('Claude receives selected session messages, recent assistant replies and tool counts, and file paths and text for checks. This can include personal instructions, memory and skills excluded from the score.');
      allowCalls = await askYes(`${what}. At least ${pending.total} ${settings.intentsModel} call${pending.total === 1 ? '' : 's'} through your Claude account. Follow-up checks and retries can add calls. Run them? [y/N] `);
    }
  }
  const checks = new Map();
  const runSteps = () => modelSteps(model, memory, allowCalls, checks);
  const calls = allowCalls || values.verbose ? await runSteps() : await quiet(runSteps);
  const analysis = analysisState(model);
  if (settings.ignore.length) model = await withoutIgnored({ model, collected, files, sessions, memory, checks });

  console.log(`${model.project.name}: ${model.totals.contextFiles} context files found.`);
  model.analysis = analysis;
  model.routes = buildRoutes(model);
  // Step 9: the health score only calculates. The prompt uses it.
  model.health = buildHealth(model);
  // Step 12: the proof of the v1 score reads the git history (read-only) and keeps old context files in the cache folder.
  // It changes only `shown`, `reason` and `headline` of `health.v1`.
  const proofRun = buildProof({ model, root, home, claudeSettingsHome, cacheDir, config });
  withProof(model.health.v1, proofRun.proof);
  // Step 11: one fix for each root cause, 10 at most. The prompt and the page use the same list.
  model.fixes = buildFixes(model);
  const outcomePath = path.join(outDir, 'fix-outcome.json');
  const outcome = applied?.baseline
    ? { root, scope: fixScope(), ...fixOutcome(applied.baseline, applied.before, measure(applied.baseline), applied.files, applied.at) }
    : values['no-save'] ? null : readJson(outcomePath, null);
  if (outcome?.root === root && outcome.scope === fixScope() && JSON.stringify(outcome.ignore || []) === JSON.stringify(model.ignore || [])) {
    model.fixOutcome = { ...outcome, later: observeLater(model, outcome) };
    if (applied?.baseline && !values['no-save']) writeFileSync(outcomePath, JSON.stringify(outcome));
  }
  model.prompt = buildPrompt(model);
  // Step 6 only calculates. The page calculates nothing.
  model.score = score(model);

  // The history: one line for each run. The page compares with the last line before this run.
  const historyPath = path.join(outDir, 'history.json');
  const history = values['no-save'] ? [] : readJson(historyPath, []);
  const v1 = model.health.v1;
  const analysedIds = new Set(model.intents.sessions.filter(session => session.status === 'ok').map(session => session.sessionId));
  const sample = model.sessions.list.filter(session => analysedIds.has(session.sessionId))
    .map(s => [s.sessionId, s.endedAt, s.totals]);
  const comparisonKey = createHash('sha256').update(JSON.stringify([root, settings.intentsModel, config, sample])).digest('hex');
  const entry = { at: new Date().toISOString(), kind, method: v1.method, ...(settings.ignore.length ? { ignore: settings.ignore } : {}), shown: v1.shown, score: v1.score ?? null, label: v1.label ?? null,
    comparisonKey, headline: v1.headline, analysed: v1.base.analysed, needs: v1.base.needs, fixes: model.fixes.list.length,
    startLoadTokens: model.totals.startLoadTokens, contextTokens: model.totals.contextTokens };
  // A run with the same result as the last line adds no line, so two equal runs give the same page.
  // The page compares with the last line that has another result. After a fix, it compares with the last line (the state before the fix).
  const same = (a, b) => JSON.stringify({ ...a, at: null, kind: null }) === JSON.stringify({ ...b, at: null, kind: null });
  // A run that ignores other files, or that has another method, is not a change of the project.
  const alike = history.filter(item => item.comparisonKey === comparisonKey && String(item.ignore ?? '') === String(settings.ignore) && item.method === v1.method);
  const previous = (kind === 'after-fix' ? alike.at(-1) : [...alike].reverse().find(item => !same(item, entry))) || null;
  if (!values['no-save'] && (kind === 'after-fix' || !history.length || !same(history.at(-1), entry))) {
    writeFileSync(historyPath, `${JSON.stringify([...history, entry].slice(-50), null, 2)}\n`);
  }

  mkdirSync(outDir, { recursive: true });
  // The small file of the dashboard. The history skips a run with the same result, so it does not say when the last run was.
  if (!values['no-save']) {
    // A paid run may have written cache answers. Use the original transcripts and
    // the final cache so a session edit during the run invalidates this count.
    const finalBadge = badgeStamp(stamp, cacheDir);
    const count = finalBadge === initialBadge ? analysis.pending.sessions :
      planIntents({ sessions, memory, options: { model: settings.intentsModel, cacheDir, limit } }).pending.length;
    const summary = { ...entry, startedAt, badge: { stamp: finalBadge, count }, grades: v1.grades ?? null, sessions: model.sessions.list.length, pending: analysis.pending, analysis };
    writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  }
  const jsonPath = path.join(outDir, 'report.json');
  const htmlPath = path.join(outDir, 'report.html');
  writeFileSync(jsonPath, `${JSON.stringify(model, null, 2)}\n`);
  // The commands and the last run are for the page only. They are not in report.json.
  writeFileSync(htmlPath, render(model, { command: commands.rerun, oldPathCommand, fixCommand: values['no-save'] ? null : commands.fix, previous, current: entry }));

  if (!v1.base.analysed && !analysis.failures.length) {
    if (analysis.pending.sessions) console.log(`${analysis.pending.sessions} eligible session${analysis.pending.sessions === 1 ? '' : 's'} ready to analyse. Run the command again in a terminal to review the estimate.`);
    else if (!model.sessions.list.length) console.log(`No sessions found for ${root} in ${path.join(claudeSettingsHome, 'projects')}. If the project moved, add its previous path with --old-path.`);
    else console.log('No sessions are eligible for analysis. The report shows why each session was skipped.');
    console.log('Explore the files in the report below.');
  }
  if (analysis.failures.length) {
    const reasons = [...new Set(analysis.failures.map(failure => failure.reason))];
    console.error(`${analysis.failures.length} analysis check${analysis.failures.length === 1 ? '' : 's'} failed. ${reasons.join('. ')}.`);
    if (reasons.includes('claude not found')) console.error('Install Claude Code or add the claude executable to PATH, then rerun. Successful checks are cached.');
    else if (analysis.failures.some(failure => failure.retryable)) console.error('Check your Claude Code sign-in and model, then rerun. Successful checks are cached.');
    else console.error('Reduce the input size before trying again.');
  }
  if (v1.base.analysed) {
    const c = model.health.counts;
    const n = value => value.toLocaleString('en-US');
    const abc = c.reason ? `no data (${c.reason})`
      : `${n(c.noRoute.files)} of ${n(c.noRoute.of)} needed files with no route, ${n(c.searched.files)} with a route but searched, ` +
        `${n(c.told.facts)} facts typed (${n(c.told.saved)} saved)`;
    console.log(`counts: ${abc}, start load ${n(c.startLoad.tokens)} tokens, ${n(c.sessions.analysed)} of ${n(c.sessions.total)} sessions. ` +
      `fixes: ${model.fixes.list.length}${model.fixes.smaller.length ? ` (and ${model.fixes.smaller.length} smaller)` : ''}. ` +
      `duplicates: ${model.duplicates.facts.length} facts, model check ${model.duplicates.check.status}`);
    const m = model.routes.metrics;
    console.log(`routes: direct reach ${m.directReach.percent == null ? 'no data' : `${m.directReach.percent}%`}, ` +
      `average route ${m.averageRoute.steps == null ? 'no data' : `${m.averageRoute.steps.toFixed(1)} steps`}, told by user ${m.toldByUser.count}, ` +
      `${model.groups.list.length} intent groups`);
    console.log(`Health: ${v1.headline}${v1.headline.endsWith('.') ? '' : '.'} proof: ${v1.proof.status}, ${v1.proof.sessions.used} of ${v1.base.analysed} sessions, ` +
      `${proofRun.stats.commits} commits (${proofRun.stats.read} read from git)`);
  }
  if (previous) console.log(`Previous comparable result (${previous.at.slice(0, 16).replace('T', ' ')}): ${runText(previous)}. Now: ${runText(entry)}.`);
  if (applied && model.fixOutcome) {
    const { before, after, sessions } = model.fixOutcome;
    console.log(`After the fix, ${after.reachable} needed files have a route, compared with ${before.reachable} before, using the same ${sessions} recorded sessions. Start load changed from ${before.startTokens} to ${after.startTokens} tokens.`);
  }
  console.log(htmlPath);
  if (model.fixes.list.length && !values['no-save']) console.log(`To make the fixes: ${commands.fix}`);
  if (!values['no-open']) {
    // open on macOS, xdg-open elsewhere. A missing opener must not crash the command: the page is written.
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(opener, [htmlPath], { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Could not run ${opener}. Open the page by hand.`));
    child.unref();
  }
  if (process.env.CONTEXT_HEALTH_PROGRESS && allowCalls && analysis.failures.length) {
    const first = analysis.failures[0];
    const next = first.reason === 'claude not found' ? 'Install Claude Code or add claude to PATH, then retry.' : first.retryable ? 'Check Claude Code sign-in, the model in Settings and your connection. Retry to reuse successful checks.' : 'Shorten the input before trying again.';
    console.log(`progress: partial ${JSON.stringify(`${first.step}: ${first.reason}. ${next}`)}`);
  }
  if (calls.failed && !calls.ok) process.exitCode = 2;
  return model;
}

function runText(item) {
  const head = item.shown === 'score' ? `score ${item.score} ${item.label}` : scoreTitle(item.shown, item.analysed);
  return `${head}, ${item.fixes} fixes, start load ${item.startLoadTokens.toLocaleString('en-US')} tokens`;
}

// ---------- fix ----------
// It starts an interactive claude in the project with the improvement prompt. The session id is saved,
// so the fix session does not count in the next reports. Then it writes the report again.
const measure = baseline => measureFix(baseline, { root, home, claudeSettingsHome, config });
const fixScope = () => createHash('sha256').update(JSON.stringify([root, settings.intentsModel, limit, claudeSettingsHome,
  settings.oldPaths, settings.ignore, config])).digest('hex');

function fixRequest(model) {
  let findings;
  try { findings = selectFindings(model, values.finding, values.fingerprint); } catch (error) { fail(error.message); }
  return { findings, scoped: values.finding !== undefined, prompt: values.finding ? findingPrompt(model, findings[0]) : model.prompt.text,
    baseline: { ...fixBaseline(model, findings), scope: fixScope() } };
}

async function fix() {
  const reportPath = path.join(outDir, 'report.json');
  let model = existsSync(reportPath) ? readJson(reportPath, null) : null;
  if (!model) {
    console.log('No report yet. The command writes it first.');
    model = await report('report');
  }
  if (!model.fixes?.list?.length) {
    if (values.finding !== undefined) fail('This finding is missing from the current report.');
    console.log('The report has no fixes. Nothing to do.');
    return;
  }
  const request = fixRequest(model);
  const before = measure(request.baseline);
  const sessionId = randomUUID();
  settings.fixSessions = [...settings.fixSessions, sessionId];
  saveSettings();
  const bin = process.env.CONTEXT_HEALTH_AGENT_BIN || 'claude';
  console.log(`Starting ${bin} in ${root} with the improvement prompt (${request.findings.length} fixes).`);
  console.log('Read each edit before you accept it. When the agent is done, exit it (/exit). Then the report runs again.');
  const code = await new Promise(resolve => {
    const child = spawn(bin, ['--session-id', sessionId, request.prompt], { cwd: root, stdio: 'inherit' });
    child.on('error', error => { console.error(`Could not start ${bin}: ${error.message}`); resolve(-1); });
    child.on('exit', resolve);
  });
  if (code !== 0) fail(code == null ? 'The fix was interrupted. Review any edits in the project.' : 'The agent stopped before completing the fix. Review its message and any edits in the project.');
  console.log('The agent is done. The report runs again.');
  await report('after-fix', { baseline: request.baseline, before, at: new Date().toISOString() });
}

// The fix of the dashboard, in two parts. Between them, the user reviews the changes of the copy.
async function fixHeadless() {
  const model = readJson(path.join(outDir, 'report.json'), null);
  if (!model?.fixes?.list?.length) fail('The report has no fixes.');
  try { await startFix({ root, outDir, ...fixRequest(model) }); } catch (error) { fail(error.message); }
}

async function fixApply() {
  const draft = readyFix(outDir);
  let baseline = draft?.baseline;
  if (baseline) {
    if (baseline.scope && baseline.scope !== fixScope()) fail('The settings changed. Discard the draft and generate it again with the current settings.');
    const picked = values.file || [];
    const ids = new Set(draft.files.filter(file => picked.includes(file.path)).flatMap(file => file.findingIds || []));
    const findings = draft.findings.filter(finding => ids.has(finding.id));
    baseline = { ...baseline, related: [...new Set([...picked, ...findings.flatMap(relatedFiles)])],
      rules: baseline.rules?.filter(rule => findings.some(finding => finding.rule === rule.text)) };
  }
  const before = baseline && measure(baseline);
  let result = null;
  try { result = applyFix({ root, outDir, files: values.file || [] }); } catch (error) { fail(error.message); }
  if (result.conflicts.length) fail(`These files changed after the fix: ${result.conflicts.join(', ')}`);
  await report('after-fix', { baseline, before, files: values.file, at: new Date().toISOString() });
}

if (command === 'fix' && values.headless) await fixHeadless();
else if (command === 'fix' && values.apply) await fixApply();
else if (command === 'fix') await fix();
else await report('report');
