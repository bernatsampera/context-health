// Collect the context of one project folder, as Claude Code sees it at the start of a session
// that runs in the project root. No model calls: the result is deterministic.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { contextRule } from './context-files.mjs';
import { readMemory } from './memory.mjs';

export const TOKEN_METHOD = 'characters / 4, rounded up (estimate)';
const IMPORT_MAX_DEPTH = 5; // Claude Code follows @ imports up to 5 hops.
// Start load items that put the text of a file into the context at the start (step 10 adds the memory index).
// A skill or command description does not. The map, the needs and the routes use the same set.
export const START_WHAT = new Set(['instructions', 'import', 'rule', 'memory']);

export function tokens(text) {
  return Math.ceil(text.length / 4);
}

function read(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

function isDir(dir) {
  try { return statSync(dir).isDirectory(); } catch { return false; }
}

function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

// ---------- file listing ----------

// Tracked plus untracked files that git does not ignore. Without git, walk the folder.
// The walk leaves out the worktree folders (`.claude/worktrees/` and `.worktrees/`): they hold copies of the project.
export function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    // --cached also lists tracked files that are deleted on disk: drop them.
    const files = [...new Set(out.split('\0').filter(Boolean))].filter(rel => isFile(path.join(root, rel)));
    return { method: 'git', files: files.sort() };
  } catch {
    const files = [];
    const walk = rel => {
      for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (child === '.claude/worktrees' || child === '.worktrees') continue;
        if (entry.isDirectory()) walk(child);
        else files.push(child);
      }
    };
    walk('');
    return { method: 'walk', files: files.sort() };
  }
}

// Step 11: which file is a candidate and its kind (`isCandidate`, `kindOf`) are in src/context-files.mjs, with the rule
// that says which candidates are context files.

// ---------- frontmatter and imports ----------

export function frontmatter(text) {
  const lines = text.replaceAll('\r', '').split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.slice(1).findIndex(line => line.trim() === '---');
  if (end < 0) return {};
  const data = {};
  const body = lines.slice(1, end + 1);
  for (let i = 0; i < body.length; i += 1) {
    const match = body[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (['|', '>', '|-', '>-', ''].includes(value)) {
      const parts = [];
      while (i + 1 < body.length && /^\s+/.test(body[i + 1])) parts.push(body[++i].trim());
      value = parts.join(value.startsWith('|') ? '\n' : ' ');
    }
    data[match[1]] = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return data;
}

// @ imports, outside code blocks and code spans, that point to an existing file.
export function importsOf(text, file, ctx) {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const found = [];
  for (const match of prose.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w.\-/]+[\w])/g)) {
    const raw = match[1];
    const target = raw.startsWith('~/.claude/') ? path.join(ctx.claudeSettingsHome, raw.slice('~/.claude/'.length))
      : raw.startsWith('~/') ? path.join(ctx.home, raw.slice(2))
      : path.isAbsolute(raw) ? raw : path.resolve(path.dirname(file), raw);
    if (isFile(target) && !found.includes(target)) found.push(target);
  }
  return found;
}

// ---------- start load ----------

function display(abs, ctx) {
  const { root, home, claudeSettingsHome } = ctx;
  if (abs === root || abs.startsWith(root + path.sep)) return path.relative(root, abs);
  // Files of the Claude settings home always show as ~/.claude/..., also when it is a fixture folder.
  if (abs.startsWith(claudeSettingsHome + path.sep)) return `~/.claude/${path.relative(claudeSettingsHome, abs)}`;
  if (abs === home || abs.startsWith(home + path.sep)) return `~/${path.relative(home, abs)}`;
  return abs;
}

function addInstructionFile(items, abs, ctx, scope, via, depth = 0, seen = new Set()) {
  if (seen.has(abs)) return;
  seen.add(abs);
  const text = read(abs);
  if (text == null) return;
  items.push({
    scope, what: depth === 0 ? 'instructions' : 'import', path: display(abs, ctx),
    tokens: tokens(text), via
  });
  if (depth >= IMPORT_MAX_DEPTH) return;
  for (const target of importsOf(text, abs, ctx)) {
    addInstructionFile(items, target, ctx, scope, `@ import in ${display(abs, ctx)}`, depth + 1, seen);
  }
}

// ---------- AGENTS.md ----------

const CLAUDE_FILES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
const AGENTS_FILES = ['AGENTS.md', '.claude/AGENTS.md'];
export const AGENTS_VIA_FALLBACK = 'AGENTS.md (no CLAUDE.md in the project folder or above it)';
export const AGENTS_VIA_BOTH = 'AGENTS.md (setting: CLAUDE.md and AGENTS.md)';

// The instruction files of one folder that are on disk. `<home>/.claude/` and the settings home of the run are the
// place of the user settings, not the `.claude/` folder of a project, so their files do not count for that folder.
function filesIn(dir, names, ctx) {
  const userPlace = dir === ctx.home || path.join(dir, '.claude') === ctx.claudeSettingsHome;
  return names.filter(name => !(userPlace && name.startsWith('.claude/')))
    .map(name => path.join(dir, name)).filter(isFile);
}

// The Claude Code setting for AGENTS.md (version 2.1.277 or later), from settings.json of the settings home:
// pluginConfigs["cc-plugin-agents-md@builtin"].options.instructionFiles (the old plugin id is "agents-md@builtin").
// - "fallback" (`claude-md-or-agents-md`, the default): AGENTS.md loads only when no CLAUDE.md is in the project folder or above it.
// - "both" (`claude-md-and-agents-md`): AGENTS.md loads also when a CLAUDE.md is there.
// - "off" (`claude-md`, `managed-only`): AGENTS.md does not load.
function agentsMode(claudeSettingsHome) {
  let value = null;
  try {
    const configs = JSON.parse(readFileSync(path.join(claudeSettingsHome, 'settings.json'), 'utf8')).pluginConfigs || {};
    value = [configs['cc-plugin-agents-md@builtin'], configs['agents-md@builtin']]
      .map(config => config?.options?.instructionFiles).find(item => typeof item === 'string') ?? null;
  } catch { /* no settings file, or not JSON: the default */ }
  if (value === 'claude-md-and-agents-md') return 'both';
  if (value === 'claude-md' || value === 'managed-only') return 'off';
  return 'fallback';
}

// An AGENTS.md that loads is one item. Its @ imports are not followed.
function addAgentsFile(items, abs, ctx, scope, via, seen) {
  if (seen.has(abs)) return;
  const text = read(abs);
  if (text == null) return;
  seen.add(abs);
  items.push({ scope, what: 'instructions', path: display(abs, ctx), tokens: tokens(text), via });
}

// Skills: <base>/skills/<name>/SKILL.md, symlinks followed. Only name + description load at start.
function skillDescriptions(base, ctx, scope) {
  const dir = path.join(base, 'skills');
  if (!isDir(dir)) return [];
  const items = [];
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'SKILL.md');
    const text = read(file);
    if (text == null) continue;
    const meta = frontmatter(text);
    const line = `${meta.name || name}: ${meta.description || ''}`;
    items.push({
      scope, what: 'skill description', path: display(file, ctx), name: meta.name || name,
      tokens: tokens(line), via: 'skill listing', missingDescription: !meta.description,
      body: { path: display(file, ctx), tokens: tokens(text) }
    });
  }
  return items;
}

function markdownFilesUnder(dir) {
  if (!isDir(dir)) return [];
  const out = [];
  const walk = sub => {
    for (const entry of readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      const abs = path.join(dir, rel);
      if (entry.isDirectory() || (entry.isSymbolicLink() && isDir(abs))) walk(rel);
      else if (rel.endsWith('.md')) out.push(rel);
    }
  };
  walk('');
  return out.sort();
}

// Commands and agents: only the description loads at start.
function describedFiles(base, folder, what, ctx, scope) {
  return markdownFilesUnder(path.join(base, folder)).map(rel => {
    const file = path.join(base, folder, rel);
    const text = read(file) || '';
    const meta = frontmatter(text);
    const name = meta.name || rel.replace(/\.md$/, '').replaceAll('/', ':');
    // Without a description field, Claude Code shows the first line of the body.
    const firstLine = text.replace(/^---[\s\S]*?\n---\n/, '').split('\n').find(line => line.trim())?.trim() || '';
    const description = meta.description || firstLine;
    return {
      scope, what, path: display(file, ctx), name,
      tokens: tokens(`${name}: ${description}`), via: `${what.split(' ')[0]} listing`,
      missingDescription: !description, body: { path: display(file, ctx), tokens: tokens(text) }
    };
  });
}

// Rules without a `paths` field load at start. Rules with `paths` load when the agent reads a matching file.
function rules(base, ctx, scope) {
  return markdownFilesUnder(path.join(base, 'rules')).map(rel => {
    const file = path.join(base, 'rules', rel);
    const text = read(file) || '';
    const paths = frontmatter(text).paths;
    return { scope, what: 'rule', path: display(file, ctx), tokens: tokens(text),
      via: paths ? `when a file matches ${paths}` : 'rules folder', conditional: Boolean(paths) };
  });
}

function mcpServers(root) {
  const text = read(path.join(root, '.mcp.json'));
  if (text == null) return [];
  try {
    return Object.keys(JSON.parse(text).mcpServers || {}).sort().map(name => ({
      scope: 'project', what: 'MCP server', path: '.mcp.json', name, tokens: null,
      via: '.mcp.json (tool definitions are not counted: the server must run to list them)'
    }));
  } catch {
    return [{ scope: 'project', what: 'MCP server', path: '.mcp.json', name: '(invalid JSON)', tokens: null, via: '.mcp.json' }];
  }
}

// ---------- main ----------

// claudeSettingsHome: the folder Claude Code uses for user settings, normally ~/.claude.
// config: null, or the object of readConfig (the globs of `--config`).
// Step 11: the context files need the links of the map. So `contextFiles`, `contextRules` and their 2 totals are
// empty here, and the command fills them from the result of buildMap.
// Step 12 (the proof): `listing` replaces the file list of git, and `realRoot` is the project folder of today when
// `root` is a copy of an old commit. The parent folders and the auto memory then come from the real project.
export function collect({ root, home, claudeSettingsHome = path.join(home, '.claude'), config = null, listing = null, realRoot = null }) {
  root = path.resolve(root);
  realRoot = path.resolve(realRoot ?? root);
  home = path.resolve(home);
  claudeSettingsHome = path.resolve(claudeSettingsHome);
  const ctx = { root, home, claudeSettingsHome };
  listing ??= listFiles(root);
  // The nested instruction files: a listed CLAUDE.md or AGENTS.md in a subfolder that the rule lets in.
  // One in a test or output folder is out, so it is not in `later`.
  const rule = contextRule({ config, git: listing.method === 'git', listed: new Set(listing.files) });
  const nestedFiles = listing.files.filter(rel => rel.includes('/') && !rel.startsWith('.claude/') &&
    ['CLAUDE.md', 'AGENTS.md'].includes(path.posix.basename(rel)) && rule(rel).state === 'in');

  // The folders above the project, the nearest first. The home folder is one of them. The file system root is not.
  const parents = [];
  for (let dir = path.dirname(realRoot); dir !== path.dirname(dir); dir = path.dirname(dir)) parents.push(dir);
  // AGENTS.md (step 10). By default it loads only when no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md is in the
  // project folder or in a folder above it. The user file of the settings home does not count: it is not a project file.
  const mode = agentsMode(claudeSettingsHome);
  const claudeFound = [root, ...parents].some(dir => filesIn(dir, CLAUDE_FILES, ctx).length > 0);
  const agentsLoad = mode === 'both' || (mode === 'fallback' && !claudeFound);
  const agentsVia = mode === 'both' ? AGENTS_VIA_BOTH : AGENTS_VIA_FALLBACK;

  // Start load, in the order Claude Code builds it: user, parent folders, project.
  const start = [];
  const instructionSeen = new Set();
  addInstructionFile(start, path.join(claudeSettingsHome, 'CLAUDE.md'), ctx, 'user', 'user instructions', 0, instructionSeen);
  for (const dir of parents) {
    for (const file of filesIn(dir, CLAUDE_FILES, ctx)) addInstructionFile(start, file, ctx, 'parent folder', 'CLAUDE.md in a parent folder', 0, instructionSeen);
    if (agentsLoad) for (const file of filesIn(dir, AGENTS_FILES, ctx)) addAgentsFile(start, file, ctx, 'parent folder', agentsVia, instructionSeen);
  }
  for (const file of filesIn(root, CLAUDE_FILES, ctx)) addInstructionFile(start, file, ctx, 'project', 'project instructions', 0, instructionSeen);
  if (agentsLoad) for (const file of filesIn(root, AGENTS_FILES, ctx)) addAgentsFile(start, file, ctx, 'project', agentsVia, instructionSeen);
  // The auto memory index (step 10): Claude Code loads its first part at the start. The other memory files load on a read.
  const memory = readMemory({ root: realRoot, claudeSettingsHome });
  if (memory.index) {
    start.push({ scope: 'project', what: 'memory', path: memory.index.path, tokens: tokens(memory.index.loaded),
      via: 'auto memory index (the first 200 lines or 25 KB)' });
  }
  const userClaude = claudeSettingsHome;
  const projectClaude = path.join(root, '.claude');
  const allRules = [...rules(userClaude, ctx, 'user'), ...rules(projectClaude, ctx, 'project')];
  start.push(...allRules.filter(rule => !rule.conditional));
  const listings = [
    ...skillDescriptions(userClaude, ctx, 'user'), ...skillDescriptions(projectClaude, ctx, 'project'),
    ...describedFiles(userClaude, 'commands', 'command description', ctx, 'user'),
    ...describedFiles(projectClaude, 'commands', 'command description', ctx, 'project'),
    ...describedFiles(userClaude, 'agents', 'agent description', ctx, 'user'),
    ...describedFiles(projectClaude, 'agents', 'agent description', ctx, 'project')
  ];
  start.push(...listings, ...mcpServers(root));

  // Loads later: behind a trigger, or when the agent enters a folder.
  const later = [
    ...listings.map(item => ({ scope: item.scope, what: `${item.what.replace(' description', '')} body`,
      path: item.body.path, tokens: item.body.tokens, trigger: `${item.name} is invoked` })),
    ...allRules.filter(rule => rule.conditional).map(rule => ({ scope: rule.scope, what: 'rule', path: rule.path,
      tokens: rule.tokens, trigger: rule.via })),
    // A nested CLAUDE.md loads with its own @ imports when the agent reads a file in its folder.
    // A nested AGENTS.md loads the same way when AGENTS.md files load (step 10), with no imports. In fallback mode it
    // loads only when its folder has no CLAUDE.md.
    ...nestedFiles.flatMap(rel => {
      const folder = path.posix.dirname(rel);
      const trigger = `the agent reads a file in ${folder}/`;
      if (path.posix.basename(rel) === 'AGENTS.md') {
        if (!agentsLoad || (mode === 'fallback' && filesIn(path.join(root, folder), CLAUDE_FILES, ctx).length)) return [];
        return [{ scope: 'project', what: 'nested instructions', path: rel, tokens: tokens(read(path.join(root, rel)) ?? ''), trigger }];
      }
      const loaded = [];
      addInstructionFile(loaded, path.join(root, rel), ctx, 'project', '', 0, new Set(instructionSeen));
      return loaded.map(item => ({ scope: 'project', what: item.what === 'import' ? 'nested import' : 'nested instructions',
        path: item.path, tokens: item.tokens, trigger: item.what === 'import' ? `${trigger} (${item.via})` : trigger }));
    })
  ];

  const sum = items => items.reduce((total, item) => total + (item.tokens || 0), 0);
  // The keys are in the order of the report. `contextFiles`, `contextRules` and their totals come from the map.
  return {
    project: { name: path.basename(root), root },
    claudeSettingsHome,
    tokenMethod: TOKEN_METHOD,
    listing: { method: listing.method, files: listing.files.length },
    totals: {
      startLoadTokens: sum(start),
      startLoadItems: start.length,
      laterTokens: sum(later),
      contextFiles: 0,
      contextTokens: 0
    },
    startLoad: start,
    later,
    contextFiles: [],
    contextRules: null
  };
}
