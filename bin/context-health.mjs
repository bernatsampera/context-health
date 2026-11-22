#!/usr/bin/env node
// Usage: context-health [folder] [options]       write the report of the folder (default: the current folder) and open it
//        context-health fix [folder] [options]   start claude in the folder with the improvement prompt, then write the report again
// Options: [--claude-settings-home <dir>] [--old-path <path>]... [--out <dir>] [--no-open] [--yes|--intents] [--no-calls]
//          [--intents-model <name>] [--cache <dir>] [--sessions <n>] [--config <file>]
// Model calls (claude -p) find the intents of the sessions and check the missing-context corrections.
//   In a terminal, the command asks before it makes calls. --yes (or --intents) makes the calls with no question.
//   --no-calls uses only the cache. Without a terminal, the command uses only the cache, unless --yes is given.
// The options of a run are saved in <out>/settings.json, so the next run of the same project needs no options.
// Each run adds one line to <out>/history.json, and the page shows the change against the last run.
// It never writes into the folder it reads. Only `fix` changes the folder, through claude, and you accept each edit.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collect, listFiles } from '../src/collect.mjs';
import { readConfig } from '../src/context-files.mjs';
import { buildMap } from '../src/map.mjs';
import { findDuplicates } from '../src/duplicates.mjs';
import { buildFixes } from '../src/fixes.mjs';
import { findGroups } from '../src/groups.mjs';
import { buildHealth } from '../src/health.mjs';
import { buildProof } from '../src/history.mjs';
import { findIntents } from '../src/intents.mjs';
import { findNeeds } from '../src/needs.mjs';
import { buildPrompt } from '../src/prompt.mjs';
import { render } from '../src/render.mjs';
import { buildRoutes } from '../src/routes.mjs';
import { readSessions } from '../src/sessions.mjs';
import { score } from '../src/score.mjs';
import { withProof } from '../src/score-v1.mjs';

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
    'no-open': { type: 'boolean', default: false },
    'no-save': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

if (values.help) {
  console.log('Usage: context-health [folder] [options]      write the report and open it');
  console.log('       context-health fix [folder] [options]  start claude with the improvement prompt, then write the report again');
  console.log('  --yes, -y                     make the model calls with no question (--intents does the same)');
  console.log('  --no-calls                    make no model call: use only the cache');
  console.log('  --old-path <path>             an earlier place of the project, for its sessions (can repeat)');
  console.log('  --sessions <n>                how many of the newest sessions with 2 or more user messages to analyse (default: 20)');
  console.log('  --config <file>               a JSON file outside the project: { "include": [globs], "exclude": [globs] }.');
  console.log('                                "include" makes each matching Markdown file a context file. "exclude" takes it out.');
  console.log('                                In a glob, * and ? stay in one folder, ** crosses folders. A glob starts at the project root.');
  console.log('  --intents-model <name>        the model for the calls (default: sonnet)');
  console.log('  --claude-settings-home <dir>  read this folder instead of ~/.claude');
  console.log('  --out <dir>                   the report folder (default: <data>/<project name>/)');
  console.log('  --cache <dir>                 the model answer cache (default: <data>/.cache/<project name>/)');
  console.log('  --no-open                     do not open the page');
  console.log('  --no-save                     do not read or write the saved options and the history (for the tests)');
  console.log('The options of a run are saved in <out>/settings.json. The next run of the same project uses them.');
  console.log('<data> is out/ in a git checkout of this tool, else ~/.context-health/. Set CONTEXT_HEALTH_HOME to change it.');
  process.exit(0);
}

const fail = message => { console.error(message); process.exit(1); };
const command = positionals[0] === 'fix' ? 'fix' : 'report';
const folderArg = command === 'fix' ? positionals[1] : positionals[0];
const root = path.resolve(folderArg || process.cwd());
if (!existsSync(root)) fail(`No such folder: ${root}`);
const home = os.homedir();
// The data folder: out/ in a git checkout of this tool, ~/.context-health/ in an npm install. CONTEXT_HEALTH_HOME replaces both.
const dataRoot = process.env.CONTEXT_HEALTH_HOME ? path.resolve(process.env.CONTEXT_HEALTH_HOME)
  : existsSync(path.join(toolRoot, ".git")) ? path.join(toolRoot, "out") : path.join(home, ".context-health");
const outDir = path.resolve(values.out || path.join(dataRoot, path.basename(root)));
const inside = dir => dir === root || dir.startsWith(root + path.sep);
if (inside(outDir)) fail(`The output folder must be outside the project: ${outDir}`);

// ---------- saved options ----------
// An option on the command line replaces the saved value. The new values are saved for the next run.
const settingsPath = path.join(outDir, 'settings.json');
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
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
  fixSessions: saved.fixSessions || []
};
const usedSaved = Object.keys(saved).length > 0;
const limit = Number(settings.sessions);
if (!Number.isInteger(limit) || limit < 1) fail(`--sessions needs a whole number of 1 or more: ${settings.sessions}`);
const claudeSettingsHome = settings.claudeSettingsHome || path.join(home, '.claude');
const cacheDir = settings.cache || path.join(dataRoot, '.cache', path.basename(root));
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
saveSettings();
if (usedSaved) {
  const parts = [settings.oldPaths.length ? `old paths ${settings.oldPaths.join(', ')}` : null,
    settings.config ? `config ${settings.config}` : null, settings.sessions !== '20' ? `sessions ${settings.sessions}` : null,
    settings.intentsModel !== 'sonnet' ? `model ${settings.intentsModel}` : null].filter(Boolean);
  if (parts.length) console.log(`Saved options: ${parts.join(', ')} (${settingsPath})`);
}

// ---------- the commands for the page ----------
const q = value => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${String(value).replace(/'/g, `'\\''`)}'`);
const defaultOut = path.join(dataRoot, path.basename(root));
const outFlag = outDir === defaultOut ? [] : ['--out', q(outDir)];
const commands = {
  // With --no-save the options are not saved, so the command must name them.
  rerun: ['node', q(binPath), q(root), '--yes', ...outFlag, ...(values['no-save'] ? [
    ...settings.oldPaths.flatMap(p => ['--old-path', q(p)]),
    ...(settings.claudeSettingsHome ? ['--claude-settings-home', q(settings.claudeSettingsHome)] : []),
    ...(settings.config ? ['--config', q(settings.config)] : []),
    ...(settings.sessions !== '20' ? ['--sessions', settings.sessions] : []),
    ...(settings.intentsModel !== 'sonnet' ? ['--intents-model', q(settings.intentsModel)] : []),
    ...(settings.cache ? ['--cache', q(settings.cache)] : []), '--no-save'] : [])].join(' '),
  fix: ['node', q(binPath), 'fix', q(root), ...outFlag].join(' ')
};

// ---------- the model steps ----------
// The steps that can call the model. With allowCalls false, they use only the cache.
async function modelSteps(model, memory, allowCalls) {
  const options = { allowCalls, model: settings.intentsModel, cacheDir };
  model.intents = await findIntents({ sessions: model.sessions, memory, options: { ...options, limit } });
  // The had check of step 5 uses the same option, model and cache as step 4.
  model.needs = await findNeeds({ model, memory, options });
  // Step 8: one model call groups the intents. Routes and the prompt only calculate.
  model.groups = await findGroups({ model, options });
  // Step 9: the exact copies on every run, and one model call for the other duplicate facts.
  model.duplicates = await findDuplicates({ model, options });
}

// The calls that a run with calls makes at least. New sessions can bring more correction checks.
function pendingCalls(model) {
  const sessions = model.intents.totals.notAnalysed;
  const checks = model.needs.sessions.filter(entry => entry.check.status === 'not-analysed').length;
  const groups = model.groups.status === 'not-analysed' || (sessions > 0 && model.groups.status !== 'failed') ? 1 : 0;
  const duplicates = model.duplicates.check.status === 'not-analysed' ? 1 : 0;
  return { sessions, total: sessions + checks + groups + duplicates };
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
async function report(kind) {
  const { files } = listFiles(root);
  // memory (full texts for steps 4 and 5) is never written to disk.
  const { report: sessions, memory } = readSessions({ root, home, claudeSettingsHome, oldPaths: settings.oldPaths, files,
    skipIds: settings.fixSessions });
  const model = collect({ root, home, claudeSettingsHome, config });
  // Step 10: the sessions are read first, so the map knows the files that a session read and that git does not list.
  // Step 11: the map decides which files are context files, because a link can bring a file in.
  const built = buildMap({ root, model, files, sessions, config });
  model.contextFiles = built.contextFiles;
  model.contextRules = built.contextRules;
  model.totals.contextFiles = built.contextFiles.length;
  model.totals.contextTokens = built.contextFiles.reduce((total, file) => total + file.tokens, 0);
  model.map = built.map;
  model.sessions = sessions;

  let allowCalls = values.yes || values.intents;
  if (!allowCalls && !values['no-calls'] && canAsk()) {
    const probe = { ...model };
    await quiet(() => modelSteps(probe, memory, false));
    const pending = pendingCalls(probe);
    if (pending.total) {
      const what = pending.sessions ? `${pending.sessions} new session${pending.sessions === 1 ? '' : 's'} to analyse` : 'some checks to redo';
      allowCalls = await askYes(`${what}: about ${pending.total} or more ${settings.intentsModel} calls (claude -p). Run them? [y/N] `);
    }
  }
  await modelSteps(model, memory, allowCalls);

  model.routes = buildRoutes(model);
  // Step 9: the health score only calculates. The prompt uses it.
  model.health = buildHealth(model);
  // Step 12: the proof of the v1 score reads the git history (read-only) and keeps old context files in the cache folder.
  // It changes only `shown`, `reason` and `headline` of `health.v1`.
  const proofRun = buildProof({ model, root, home, claudeSettingsHome, cacheDir, config });
  withProof(model.health.v1, proofRun.proof);
  // Step 11: one fix for each root cause, 10 at most. The prompt and the page use the same list.
  model.fixes = buildFixes(model);
  model.prompt = buildPrompt(model);
  // Step 6 only calculates. The page calculates nothing.
  model.score = score(model);

  // The history: one line for each run. The page compares with the last line before this run.
  const historyPath = path.join(outDir, 'history.json');
  const history = values['no-save'] ? [] : readJson(historyPath, []);
  const v1 = model.health.v1;
  const entry = { at: new Date().toISOString(), kind, shown: v1.shown, score: v1.score ?? null, label: v1.label ?? null,
    headline: v1.headline, analysed: v1.base.analysed, needs: v1.base.needs, fixes: model.fixes.list.length,
    startLoadTokens: model.totals.startLoadTokens, contextTokens: model.totals.contextTokens };
  // A run with the same result as the last line adds no line, so two equal runs give the same page.
  // The page compares with the last line that has another result. After a fix, it compares with the last line (the state before the fix).
  const same = (a, b) => JSON.stringify({ ...a, at: null, kind: null }) === JSON.stringify({ ...b, at: null, kind: null });
  const previous = (kind === 'after-fix' ? history.at(-1) : [...history].reverse().find(item => !same(item, entry))) || null;
  if (!values['no-save'] && (kind === 'after-fix' || !history.length || !same(history.at(-1), entry))) {
    writeFileSync(historyPath, `${JSON.stringify([...history, entry].slice(-50), null, 2)}\n`);
  }

  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'report.json');
  const htmlPath = path.join(outDir, 'report.html');
  writeFileSync(jsonPath, `${JSON.stringify(model, null, 2)}\n`);
  // The commands and the last run are for the page only. They are not in report.json.
  writeFileSync(htmlPath, render(model, { command: commands.rerun, fixCommand: values['no-save'] ? null : commands.fix, previous, current: entry }));

  const t = model.totals;
  console.log(`${model.project.name}: start load ${t.startLoadTokens.toLocaleString('en-US')} tokens ` +
    `(${t.startLoadItems} items), ${t.contextFiles} context files`);
  // Step 11: the 5 counts, in place of the score lines of steps 6 and 9.
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
  console.log(`score v1: ${v1.headline}${v1.headline.endsWith('.') ? '' : '.'} proof: ${v1.proof.status}, ${v1.proof.sessions.used} of ${v1.base.analysed} sessions, ` +
    `${proofRun.stats.commits} commits (${proofRun.stats.read} read from git)`);
  if (previous) console.log(`last run (${previous.at.slice(0, 16).replace('T', ' ')}): ${runText(previous)}. now: ${runText(entry)}.`);
  console.log(htmlPath);
  if (model.fixes.list.length && !values['no-save']) console.log(`To make the fixes: ${commands.fix}`);
  if (!values['no-open']) {
    // open on macOS, xdg-open elsewhere. A missing opener must not crash the command: the page is written.
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(opener, [htmlPath], { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Could not run ${opener}. Open the page by hand.`));
    child.unref();
  }
  return model;
}

function runText(item) {
  const head = item.shown === 'score' || item.score != null ? `score ${item.score} ${item.label}` : `no score (${item.shown})`;
  return `${head}, ${item.fixes} fixes, start load ${item.startLoadTokens.toLocaleString('en-US')} tokens`;
}

// ---------- fix ----------
// It starts an interactive claude in the project with the improvement prompt. The session id is saved,
// so the fix session does not count in the next reports. Then it writes the report again.
async function fix() {
  const reportPath = path.join(outDir, 'report.json');
  let model = existsSync(reportPath) ? readJson(reportPath, null) : null;
  if (!model) {
    console.log('No report yet. The command writes it first.');
    model = await report('report');
  }
  if (!model.fixes?.list?.length) {
    console.log('The report has no fixes. Nothing to do.');
    return;
  }
  const sessionId = randomUUID();
  settings.fixSessions = [...settings.fixSessions, sessionId];
  saveSettings();
  const bin = process.env.CONTEXT_HEALTH_AGENT_BIN || 'claude';
  console.log(`Starting ${bin} in ${root} with the improvement prompt (${model.fixes.list.length} fixes).`);
  console.log('Read each edit before you accept it. When the agent is done, exit it (/exit). Then the report runs again.');
  const code = await new Promise(resolve => {
    const child = spawn(bin, ['--session-id', sessionId, model.prompt.text], { cwd: root, stdio: 'inherit' });
    child.on('error', error => { console.error(`Could not start ${bin}: ${error.message}`); resolve(-1); });
    child.on('exit', resolve);
  });
  if (code === -1) process.exit(1);
  console.log('The agent is done. The report runs again.');
  await report('after-fix');
}

if (command === 'fix') await fix();
else await report('report');
