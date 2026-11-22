// The auto memory of a project (step 10). Claude Code keeps it in <settings home>/projects/<project folder>/memory/.
// At the start of a session it loads the first 200 lines (or 25 KB) of MEMORY.md, the index. The other files of the
// folder load only when the agent reads them. This module only reads. It never writes into the settings home.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const MEMORY_INDEX = 'MEMORY.md';
export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = 25000;

const readText = file => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
const isDir = dir => { try { return statSync(dir).isDirectory(); } catch { return false; } };
const real = dir => { try { return realpathSync(dir); } catch { return dir; } };

// The name of the session folder of a path: each character that is not a letter or a digit becomes `-`.
export const encodeFolder = folder => folder.replace(/[^A-Za-z0-9]/g, '-');

// The folder that names the memory: the root of the git repository (worktrees and subfolders share one memory),
// else the project root itself.
function memoryRoot(root) {
  try {
    const common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (path.basename(common) !== '.git') return root;
    const top = path.dirname(common);
    // git gives the real path. When it is the same folder as the root, keep the root as it was given.
    return real(top) === real(root) ? root : top;
  } catch { return root; }
}

// `"autoMemoryEnabled": false` in the user settings or in the project settings turns the memory off.
function memoryOff({ root, claudeSettingsHome }) {
  const files = [path.join(claudeSettingsHome, 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json')];
  return files.some(file => {
    try { return JSON.parse(readFileSync(file, 'utf8')).autoMemoryEnabled === false; } catch { return false; }
  });
}

// The part of the index that loads at the start.
export function loadedPart(text) {
  let part = text.split('\n').slice(0, MEMORY_INDEX_MAX_LINES).join('\n');
  if (Buffer.byteLength(part, 'utf8') > MEMORY_INDEX_MAX_BYTES) part = Buffer.from(part, 'utf8').subarray(0, MEMORY_INDEX_MAX_BYTES).toString('utf8').replace(/�$/, '');
  return part;
}

// Returns { dir, display, index, files }.
// - dir: the full path of the memory folder. display: its report form, `~/.claude/projects/<folder>/memory`.
// - index: { path, abs, text, loaded } of MEMORY.md, or null. `loaded` is the part that loads at the start.
// - files: each Markdown file of the folder (the index too), as { path, abs, text }, sorted by path.
//   `path` is the report form: `~/.claude/projects/<folder>/memory/<name>`.
// With no memory folder, or with the memory turned off: index is null and files is empty.
export function readMemory({ root, claudeSettingsHome }) {
  root = path.resolve(root);
  claudeSettingsHome = path.resolve(claudeSettingsHome);
  const folder = encodeFolder(memoryRoot(root));
  const dir = path.join(claudeSettingsHome, 'projects', folder, 'memory');
  const display = `~/.claude/projects/${folder}/memory`;
  const empty = { dir, display, index: null, files: [] };
  if (!isDir(dir) || memoryOff({ root, claudeSettingsHome })) return empty;
  const names = [];
  const walk = sub => {
    for (const entry of readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile() && rel.toLowerCase().endsWith('.md')) names.push(rel);
    }
  };
  walk('');
  const files = names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(rel => ({ path: `${display}/${rel}`, abs: path.join(dir, rel), text: readText(path.join(dir, rel)) ?? '' }));
  const indexFile = files.find(file => file.path === `${display}/${MEMORY_INDEX}`) || null;
  return { dir, display, index: indexFile ? { ...indexFile, loaded: loadedPart(indexFile.text) } : null, files };
}
