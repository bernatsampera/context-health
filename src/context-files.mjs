// Step 11: which files of a project are context files. Step 10 counted each Markdown file. So test fixtures,
// run output and the prompt templates of a product counted too.
// The rule, in the order of its checks, for a candidate path of the project:
// 1. A glob of `exclude` in the config file matches: out (`config-exclude`). A file of the start load stays.
// 2. A glob of `include` in the config file matches: in (`config`).
// 3. Claude Code loads the file by itself: in, also when git ignores it.
// 4. Git does not list the file: out (`ignored`). With no git, no file is ignored. A file in the folder of a project
//    skill that Claude Code loads is not ignored: such a folder is often a symbolic link, and git lists no file behind a link.
// 5. A folder of the path is a test folder (`test`) or an output folder (`output`): out.
// 6. The name or the place is on the allow list: in (`instructions`, `claude-folder`, `root-doc`, `docs-folder`, `index`).
// 7. A context file names the file: in (`linked`). The map decides this while it reads the links (src/map.mjs).
// 8. Each other candidate: out (`code-folder` in a code folder, else `not-linked`).
// This module holds checks 1 to 6, the config file, and the test that says which path can be a need.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ignoreTest } from './ignore.mjs';
import { readMemory } from './memory.mjs';

// A folder with one of these names, at any depth of the path. Names compare in lower case.
export const TEST_FOLDERS = new Set(['test', 'tests', '__tests__', 'e2e', 'fixtures', 'fixture', '__fixtures__', 'testdata', '__snapshots__']);
export const OUTPUT_FOLDERS = new Set(['artifacts', 'node_modules', 'dist', 'build', 'out', 'coverage', 'tmp', 'temp']);
export const CODE_FOLDERS = new Set(['src', 'lib', 'libs', 'app', 'bin', 'cmd', 'pkg', 'internal', 'scripts', 'source']);
export const DOCS_FOLDERS = new Set(['docs', 'doc', 'dev']);
const INSTRUCTION_NAMES = new Set(['CLAUDE.md', 'AGENTS.md', 'CLAUDE.local.md']);
const CLAUDE_FOLDERS = /^(?:\.claude\/(?:skills|commands|agents|rules)|\.agents\/skills)\//;
// The folder right below these folders is the name of a skill. It is not a test or output folder.
const SKILL_FOLDERS = /^(?:\.claude|\.agents)\/skills\/[^/]+\//;
const USER_FOLDERS = new Set(['skills', 'commands', 'agents', 'rules']);

// The class of a context file, in the order of the report.
export const WHYS = ['config', 'start-load', 'instructions', 'claude-folder', 'root-doc', 'docs-folder', 'index', 'linked'];
// The reason of a candidate that is out, in the order of the report. `user-other` is only for a file of ~/.claude/.
export const REASONS = ['option', 'config-exclude', 'ignored', 'test', 'output', 'code-folder', 'not-linked'];
export const USER_OTHER = 'user-other';
// A short text for each reason, for the page.
export const REASON_TEXT = {
  option: 'The settings of this report ignore it',
  'config-exclude': 'The config file leaves it out',
  ignored: 'Git ignores it',
  test: 'It is in a test folder',
  output: 'It is in an output folder',
  'code-folder': 'It is in a code folder, and no context file links it',
  'not-linked': 'No context file names it',
  'user-other': 'It is in ~/.claude, but it is not a skill, command, agent, rule or memory file of this project'
};

const lower = text => text.toLowerCase();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- candidates and kinds ----------

// A file whose text an agent reads as context: Markdown (`.md`, `.mdx`, any case) or `llms.txt`.
export const isTextFile = rel => /\.mdx?$/i.test(rel) || path.posix.basename(rel) === 'llms.txt';

// A candidate: a text file, `.mcp.json`, or a `.json` file below `.claude/`. The rule decides which candidates count.
export function isCandidate(rel) {
  if (isTextFile(rel) || path.posix.basename(rel) === '.mcp.json') return true;
  return lower(rel).startsWith('.claude/') && lower(rel).endsWith('.json');
}

export function kindOf(rel) {
  const base = path.posix.basename(rel);
  if (base === 'CLAUDE.md' || base === 'CLAUDE.local.md') return 'instructions';
  if (base === 'AGENTS.md') return 'instructions (other agents)';
  if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(rel)) return 'skill';
  if (/^\.agents\/skills\//.test(rel)) return 'skill (other agents)';
  if (rel.startsWith('.claude/commands/')) return 'command';
  if (rel.startsWith('.claude/agents/')) return 'agent';
  if (rel.startsWith('.claude/rules/')) return 'rule';
  if (base === 'llms.txt') return 'index';
  if (base === '.mcp.json' || rel.endsWith('.json')) return 'config';
  return 'doc';
}

// ---------- the folders and the allow list ----------

const foldersOf = rel => rel.split('/').slice(0, -1).map(lower);

// `test` or `output` when a folder of the path is a test or an output folder (the first such folder decides), else null.
export function badFolder(rel) {
  const folders = foldersOf(rel);
  const skip = SKILL_FOLDERS.test(rel) ? 2 : -1;
  for (let k = 0; k < folders.length; k += 1) {
    if (k === skip) continue;
    if (TEST_FOLDERS.has(folders[k])) return 'test';
    if (OUTPUT_FOLDERS.has(folders[k])) return 'output';
  }
  return null;
}

export const inCodeFolder = rel => foldersOf(rel).some(name => CODE_FOLDERS.has(name));

// The class that the name or the place of a path gives (check 6), or null.
export function placeOf(rel) {
  const base = path.posix.basename(rel);
  if (INSTRUCTION_NAMES.has(base)) return 'instructions';
  if (CLAUDE_FOLDERS.test(rel)) return 'claude-folder';
  if (!rel.includes('/') && /^(?:readme|contributing)\.md$/i.test(base)) return 'root-doc';
  // A folder `docs`, `doc` or `dev` with no code folder above it.
  const folders = foldersOf(rel);
  const docs = folders.findIndex(name => DOCS_FOLDERS.has(name));
  const code = folders.findIndex(name => CODE_FOLDERS.has(name));
  if (docs >= 0 && (code < 0 || docs < code)) return 'docs-folder';
  if (lower(base) === 'index.md' || base === 'llms.txt') return 'index';
  return null;
}

// ---------- the config file ----------

// A glob to a RegExp. `*` and `?` do not cross a `/`. `**` crosses folders, and `**/` also matches no folder.
// The glob starts at the project root: `./` or `/` at its start is left out. `/` at its end means each file below.
export function globToRegExp(glob) {
  let text = glob.replace(/^\.?\//, '');
  if (text.endsWith('/')) text += '**';
  let out = '';
  for (let k = 0; k < text.length; k += 1) {
    const char = text[k];
    if (char === '*' && text[k + 1] === '*') {
      const whole = (k === 0 || text[k - 1] === '/') && text[k + 2] === '/';
      out += whole ? '(?:[^/]+/)*' : '.*';
      k += whole ? 2 : 1;
    } else if (char === '*') out += '[^/]*';
    else if (char === '?') out += '[^/]';
    else out += char.replace(/[\\^$+.()|[\]{}]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const CONFIG_KEYS = ['include', 'exclude'];

// Read the config file of `--config`. Returns { path, include, exclude }. Throws an Error with one clear line.
export function readConfig(file, root) {
  const full = path.resolve(file);
  if (full === root || full.startsWith(root + path.sep)) throw new Error(`The config file must be outside the project: ${full}`);
  let text;
  try { text = readFileSync(full, 'utf8'); } catch { throw new Error(`Cannot read the config file: ${full}`); }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`The config file is not JSON: ${full}`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`The config file must be a JSON object with the keys "include" and "exclude": ${full}`);
  }
  for (const key of Object.keys(data)) {
    if (!CONFIG_KEYS.includes(key)) throw new Error(`Unknown key "${key}" in the config file (the keys are "include" and "exclude"): ${full}`);
  }
  for (const key of CONFIG_KEYS) {
    const list = data[key] ?? [];
    if (!Array.isArray(list) || list.some(glob => typeof glob !== 'string' || !glob.trim())) {
      throw new Error(`"${key}" in the config file must be a list of globs: ${full}`);
    }
  }
  return { path: full, include: [...(data.include ?? [])], exclude: [...(data.exclude ?? [])] };
}

// The 2 glob tests of a config (null: no config).
function globTests(config) {
  const include = (config?.include || []).map(globToRegExp);
  const exclude = (config?.exclude || []).map(globToRegExp);
  return { included: rel => include.some(glob => glob.test(rel)), excluded: rel => exclude.some(glob => glob.test(rel)) };
}

// ---------- checks 1 to 6 ----------

// The project files that Claude Code loads by itself, from the model of step 1:
// - start: the start load files with text (instructions, `@` imports, rules). An `exclude` glob cannot take them out.
// - auto: these files, the rules that load when a file matches, and the bodies of the skills, commands and agents.
// - skills: the folders of the project skills, each with `/` at its end.
export function loadedFiles(model) {
  const inProject = rel => rel && !rel.startsWith('~/') && !rel.startsWith('/');
  const start = new Set(model.startLoad.filter(item => item.scope === 'project' && ['instructions', 'import', 'rule'].includes(item.what) && inProject(item.path))
    .map(item => item.path));
  const auto = new Set(start);
  const skills = [];
  for (const item of model.later) {
    if (item.scope !== 'project' || !inProject(item.path)) continue;
    if (/ body$/.test(item.what) || item.what === 'rule') auto.add(item.path);
    if (item.what === 'skill body') skills.push(`${path.posix.dirname(item.path)}/`);
  }
  return { start, auto, skills };
}

// The rule for one candidate path. Returns { state, why }:
// - state `in`: a context file, `why` is its class.
// - state `out`: not a context file, `why` is the reason.
// - state `open`: the links decide (check 7). `why` is the reason when no context file names the file.
// options: config (null or the object of readConfig), git (false: no file is ignored), listed (the paths that git lists),
// start, auto and skills (see loadedFiles).
export function contextRule({ config = null, git = true, listed = new Set(), start = new Set(), auto = new Set(), skills = [], ignore = null }) {
  const { included, excluded } = globTests(config);
  const ignored = ignoreTest(ignore);
  return rel => {
    if (ignored(rel)) return { state: 'out', why: 'option' };
    const loaded = start.has(rel);
    const out = excluded(rel);
    if (out && !loaded) return { state: 'out', why: 'config-exclude' };
    if (!out && included(rel)) return { state: 'in', why: 'config' };
    // A config file is not a text file. Claude Code reads the root `.mcp.json` and the `.json` files of `.claude/` by
    // itself, as settings. A `.mcp.json` in a subfolder is the config of that folder: checks 4 and 5 hold for it.
    const isConfig = !isTextFile(rel);
    const settings = isConfig && (rel === '.mcp.json' || lower(rel).startsWith('.claude/'));
    if (loaded || auto.has(rel) || settings) return { state: 'in', why: placeOf(rel) ?? 'start-load' };
    if (git && !listed.has(rel) && !skills.some(folder => rel.startsWith(folder))) return { state: 'out', why: 'ignored' };
    const folder = badFolder(rel);
    if (folder) return { state: 'out', why: folder };
    const place = placeOf(rel);
    if (place) return { state: 'in', why: place };
    if (isConfig) return { state: 'in', why: 'start-load' };
    return { state: 'open', why: inCodeFolder(rel) ? 'code-folder' : 'not-linked' };
  };
}

// ---------- the report keys ----------

// A named file: a context file that the rule allows by itself. A file that counts only by a link is not named.
export const isNamed = file => Boolean(file) && file.context === true && file.why !== 'linked';

// Count a list by one key, with the keys in a fixed order. Only the keys with a count are in the result.
function countBy(list, key, order) {
  const out = {};
  for (const name of order) {
    const n = list.filter(item => item[key] === name).length;
    if (n) out[name] = n;
  }
  return out;
}

// `contextFiles` and `contextRules` of the report.
// files: the context files of the project, as { path, kind, tokens, why, linkedFrom }. excluded: { path, reason }.
export function contextReport({ config, files, excluded }) {
  const contextFiles = [...files].sort((a, b) => cmp(a.path, b.path)).map(file => ({ path: file.path, kind: file.kind, tokens: file.tokens, why: file.why,
    ...(file.why === 'linked' ? { linkedFrom: file.linkedFrom } : {}) }));
  const out = [...excluded].sort((a, b) => cmp(a.path, b.path)).map(file => ({ path: file.path, reason: file.reason }));
  return {
    contextFiles,
    contextRules: {
      config: config ? { path: config.path, include: config.include, exclude: config.exclude } : null,
      counts: { candidates: contextFiles.length + out.length, context: contextFiles.length, excluded: out.length,
        byWhy: countBy(contextFiles, 'why', WHYS), byReason: countBy(out, 'reason', REASONS) },
      excluded: out
    }
  };
}

// ---------- which path can be a need ----------

const isUserPath = rel => rel.startsWith('~/.claude/');
const isProjectPath = rel => !rel.startsWith('/') && !rel.startsWith('~/');

// The rule of step 10: a text file of the project that is not a config file, or a `.md` file of ~/.claude/.
// Step 11 still uses it for 2 things: the texts that the agent had, and which reads count as dropped.
export function wasNeedPath(rel) {
  if (!rel) return false;
  if (isUserPath(rel)) return lower(rel).endsWith('.md');
  if (!isProjectPath(rel)) return false;
  return isCandidate(rel) && kindOf(rel) !== 'config';
}

const tests = new WeakMap();

// One test for needs, routes, duplicates and score, built from the model (the map and `contextRules` must be there).
// - isNeed(rel): the path can be a need. A map file: a context file that is not a config file. A file of ~/.claude/:
//   the user file, a file with a folder `skills`, `commands`, `agents` or `rules` in its path, a memory file of the
//   project, or a start load item. A project file that is not on disk now: the path alone decides (it can be `gone`).
// - reasonOf(rel): why a path that step 10 counted is out now, or null.
export function needTest(model) {
  if (tests.has(model)) return tests.get(model);
  const mapFiles = new Map((model.map?.files || []).map(file => [file.path, file]));
  const excluded = new Map((model.contextRules?.excluded || []).map(file => [file.path, file.reason]));
  const globs = globTests(model.contextRules?.config);
  const memory = model.ignore?.includes('user') ? null
    : `${readMemory({ root: model.project.root, claudeSettingsHome: model.claudeSettingsHome }).display}/`;
  const startItems = new Set(model.startLoad.map(item => item.path));
  const userNeed = rel => rel === '~/.claude/CLAUDE.md' || (memory && rel.startsWith(memory)) || startItems.has(rel) ||
    rel.slice('~/.claude/'.length).split('/').slice(0, -1).some(name => USER_FOLDERS.has(name));
  // A project path that the map and the list of excluded files do not know: the file is not on disk now.
  const pathReason = rel => (globs.excluded(rel) ? 'config-exclude' : badFolder(rel));
  const ignored = ignoreTest(model.ignore);
  const reasonOf = rel => {
    if (!wasNeedPath(rel)) return null;
    if (ignored(rel)) return 'option';
    const file = mapFiles.get(rel);
    if (file) return file.context ? null : file.why;
    if (isUserPath(rel)) return userNeed(rel) ? null : USER_OTHER;
    return excluded.get(rel) ?? pathReason(rel);
  };
  const isNeed = rel => {
    if (!rel) return false;
    const file = mapFiles.get(rel);
    if (file) return file.context && file.kind !== 'config';
    return wasNeedPath(rel) && reasonOf(rel) == null;
  };
  const test = { isNeed, reasonOf };
  tests.set(model, test);
  return test;
}
