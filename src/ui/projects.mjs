// The projects of the dashboard, from the report folders, and the suggestions, from the session folders of Claude Code.
// There is no other list. It only reads, except newProject and saveSettings, which write settings.json.
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { planIntents, PROMPT_VERSION } from '../intents.mjs';
import { readSessions } from '../sessions.mjs';
import path from 'node:path';
import { projectKey, readJson } from '../data-folder.mjs';
import { gitState, readyFix } from '../fix-worktree.mjs';
import { DEFAULT_IGNORE, parseIgnore } from '../ignore.mjs';

const HEAD_BYTES = 64 * 1024;
const encode = folder => folder.replace(/[^A-Za-z0-9]/g, '-');
const isDir = dir => { try { return statSync(dir).isDirectory(); } catch { return false; } };
const list = dir => { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const inside = (file, dir) => file === dir || file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

// The first part of a session file. A real session file can have many megabytes.
function readHead(file) {
  let fd = null;
  try {
    fd = openSync(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
  } catch { return ''; } finally { if (fd != null) closeSync(fd); }
}
const isHeadless = head => /"entrypoint":"sdk-cli"/.test(head) && !/"entrypoint":"(?!sdk-cli")/.test(head);
const cwdsOf = head => [...head.matchAll(/"cwd":("(?:[^"\\]|\\.)*")/g)].map(match => { try { return JSON.parse(match[1]); } catch { return null; } })
  .filter(value => value && path.isAbsolute(value));
const sessionFiles = dir => list(dir).filter(entry => entry.isFile() && entry.name.endsWith('.jsonl')).map(entry => {
  const file = path.join(dir, entry.name);
  const stat = statSync(file);
  return { file, mtime: stat.mtimeMs, birth: stat.birthtimeMs };
}).sort((a, b) => b.mtime - a.mtime);

// ---------- the list ----------

// On repeat visits, only stat candidate logs and intent answers. Parse logs and
// validate model answers with the report's own rules when an input changes.
const counts = new Map();
const digest = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const filesStamp = (dir, extension) => list(dir).filter(entry => entry.isFile() && entry.name.endsWith(extension))
  .map(entry => entry.name).sort().map(name => {
    const file = path.join(dir, name);
    const stat = statSync(file, { throwIfNoEntry: false });
    return [file, stat?.size, stat?.ctimeMs];
  });

export function sessionStamp(settings, claudeSettingsHome) {
  const roots = [settings.root, ...(settings.oldPaths || [])].map(encode);
  const base = path.join(claudeSettingsHome, 'projects');
  const folders = list(base).filter(entry => entry.isDirectory() && roots.some(root => entry.name.startsWith(root.slice(0, 200))))
    .map(entry => entry.name).sort();
  const inputs = [settings.root, settings.oldPaths || [], settings.fixSessions || [], Number(settings.sessions) || 20,
    settings.intentsModel || 'sonnet', base];
  // Refresh saved counts when the rules for eligible sessions or their cache keys change.
  for (const file of ['sessions.mjs', 'intents.mjs', `prompts/${PROMPT_VERSION}.md`]) inputs.push(statSync(new URL(`../${file}`, import.meta.url)).mtimeMs);
  return digest([...inputs, ...folders.map(folder => filesStamp(path.join(base, folder), '.jsonl'))]);
}

export const badgeStamp = (sessions, cacheDir) => digest([sessions, cacheDir, filesStamp(path.join(cacheDir, 'intents'), '.json')]);

function pendingSessions({ settings, dataRoot, key, limit, saved }) {
  const claudeSettingsHome = settings.claudeSettingsHome || path.join(os.homedir(), '.claude');
  const cacheDir = settings.cache || path.join(dataRoot, '.cache', key);
  const stamp = badgeStamp(sessionStamp(settings, claudeSettingsHome), cacheDir);
  if (saved?.stamp === stamp && Number.isInteger(saved.count) && saved.count >= 0) return saved.count;
  if (counts.get(key)?.stamp === stamp) return counts.get(key).count;
  const { report, memory } = readSessions({ root: settings.root, oldPaths: settings.oldPaths, skipIds: settings.fixSessions,
    home: os.homedir(), claudeSettingsHome });
  const count = planIntents({ sessions: report, memory, options: { cacheDir, model: settings.intentsModel, limit } }).pending.length;
  counts.set(key, { stamp, count });
  return count;
}

const scoreOf = item => item && { at: item.at, shown: item.shown, score: item.score, label: item.label, fixes: item.fixes, analysed: item.analysed,
  analysis: item.analysis ?? null, needs: item.needs, sessions: item.sessions ?? null, grades: item.grades ?? null, pending: item.pending ?? null };

// A report from before summary.json: the report itself has the numbers. The next run writes the small file.
function oldSummary(dir, entry) {
  const file = path.join(dir, 'report.json');
  const model = readJson(file, null);
  if (!model?.health?.v1) return entry ?? null;
  const v1 = model.health.v1;
  return { at: statSync(file).mtime.toISOString(), shown: v1.shown, score: v1.score ?? null, label: v1.label ?? null, fixes: model.fixes?.list?.length ?? 0,
    analysed: v1.base?.analysed ?? 0, needs: v1.base?.needs ?? 0, sessions: model.sessions?.list?.length ?? null, grades: v1.grades ?? null,
    pending: { sessions: model.intents?.totals?.notAnalysed ?? 0 } };
}

export function readProject({ dataRoot, key, claudeSettingsHome }) {
  const dir = path.join(dataRoot, key);
  const settings = readJson(path.join(dir, 'settings.json'), null);
  // The folder name must be the name of its root. This leaves out the test artifacts and the moved projects.
  if (!settings?.root || projectKey(settings.root) !== key || !isDir(settings.root)) return null;
  const history = readJson(path.join(dir, 'history.json'), []);
  const hasReport = existsSync(path.join(dir, 'report.html'));
  const last = readJson(path.join(dir, 'summary.json'), null) || (hasReport ? oldSummary(dir, history.at(-1)) : null);
  const summary = scoreOf(last);
  // Only the runs with the same method that ignore the same files.
  const scores = history.filter(item => item.shown === 'score' && item.score != null && last?.comparisonKey && item.comparisonKey === last.comparisonKey && item.method === last.method && String(item.ignore ?? '') === String(last?.ignore ?? ''));
  const before = summary?.shown !== 'score' || summary.score == null ? null : [...scores].reverse().find(item => item.score !== summary.score);
  const limit = Number(settings.sessions) || 20;
  const fix = readyFix(dir);
  return {
    key, root: settings.root, name: path.basename(settings.root), parent: path.dirname(settings.root), hasReport, summary,
    delta: before ? summary.score - before.score : null,
    newSessions: pendingSessions({ settings, dataRoot, key, limit, saved: last?.badge }),
    git: gitState(settings.root),
    fix: fix ? { files: fix.files.length } : null,
    settings: { oldPaths: settings.oldPaths || [], sessions: limit, intentsModel: settings.intentsModel || 'sonnet', ignore: settings.ignore ?? DEFAULT_IGNORE }
  };
}

export function listProjects({ dataRoot, claudeSettingsHome }) {
  const rank = item => (item.fix ? 0 : !item.summary || item.summary.score == null ? 1 : item.newSessions ? 2 : 3);
  return list(dataRoot).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => readProject({ dataRoot, key: entry.name, claudeSettingsHome })).filter(Boolean)
    .sort((a, b) => rank(a) - rank(b) || (a.summary?.score ?? 0) - (b.summary?.score ?? 0) || (a.name < b.name ? -1 : 1));
}

// ---------- the suggestions ----------

function isTemp(folder) {
  if (process.env.CONTEXT_HEALTH_TEMP_PROJECTS === '1') return false;
  let temp = os.tmpdir();
  try { temp = realpathSync(temp); } catch { /* keep the name */ }
  return [temp, os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].some(dir => inside(folder, dir));
}

// The folders with interactive sessions, newest first. Claude Code replaces each special character in its folder name,
// so the path comes from the cwd in a session file.
export function listSuggestions({ claudeSettingsHome, dataRoot, added }) {
  const base = path.join(claudeSettingsHome, 'projects');
  const found = new Map();
  for (const entry of list(base)) {
    if (!entry.isDirectory()) continue;
    const files = sessionFiles(path.join(base, entry.name));
    let cwd = null;
    for (const item of files.slice(0, 5)) {
      const head = readHead(item.file);
      if (isHeadless(head)) continue;
      const cwds = cwdsOf(head);
      cwd = cwds.find(value => encode(value) === entry.name) || cwds[0] || null;
      if (cwd) break;
    }
    if (!cwd) continue;
    // A worktree is the same project as its main folder.
    const root = cwd.replace(/\/(?:\.claude\/worktrees|\.worktrees)\/.*$/, '');
    const item = found.get(root) || { root, name: path.basename(root), parent: path.dirname(root), sessions: 0, last: 0 };
    item.sessions += files.length;
    item.last = Math.max(item.last, files[0].mtime);
    found.set(root, item);
  }
  return [...found.values()].filter(item => !added.includes(item.root) && !isTemp(item.root) && !refuse({ root: item.root, dataRoot }))
    .sort((a, b) => b.last - a.last).map(({ last, ...item }) => ({ ...item, lastAt: new Date(last).toISOString() }));
}

// ---------- add and settings ----------

// Why a folder cannot be a project, or null.
export function refuse({ root, dataRoot }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return 'Choose a folder.';
  if (!isDir(root)) return `There is no folder at ${root}.`;
  if (path.dirname(root) === root || root === os.homedir()) return 'Choose the folder of one project.';
  if (inside(dataRoot, root)) return 'This folder holds the reports of context-health. Set CONTEXT_HEALTH_HOME to another folder to add it.';
  return null;
}

const save = (dataRoot, key, settings) => {
  mkdirSync(path.join(dataRoot, key), { recursive: true });
  writeFileSync(path.join(dataRoot, key, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
};

export function newProject({ dataRoot, root, customHome }) {
  const key = projectKey(root);
  save(dataRoot, key, { root, oldPaths: [], config: null, sessions: '20', intentsModel: 'sonnet', claudeSettingsHome: customHome, cache: null, fixSessions: [], ignore: [...DEFAULT_IGNORE] });
  return key;
}

// Throws an Error with a text for the user.
export function saveSettings({ dataRoot, key, changes }) {
  const settings = readJson(path.join(dataRoot, key, 'settings.json'), null);
  const next = { ...settings };
  for (const [name, value] of Object.entries(changes ?? {})) {
    if (name === 'sessions') {
      if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error('Sessions must be a number from 1 to 500.');
      next.sessions = String(value);
    } else if (name === 'intentsModel') {
      if (typeof value !== 'string' || !/^[a-z0-9][\w.:\-[\]]*$/i.test(value)) throw new Error('This model name is not valid.');
      next.intentsModel = value;
    } else if (name === 'oldPaths') {
      if (!Array.isArray(value) || value.some(folder => typeof folder !== 'string' || !path.isAbsolute(folder))) throw new Error('Enter an absolute folder path on each line.');
      next.oldPaths = [...new Set(value.map(folder => path.resolve(folder)))];
    } else if (name === 'ignore') {
      if (!Array.isArray(value)) throw new Error('Choose what to ignore.');
      next.ignore = parseIgnore(value.join(','));
    } else throw new Error(`There is no setting ${name}.`);
  }
  save(dataRoot, key, next);
}
