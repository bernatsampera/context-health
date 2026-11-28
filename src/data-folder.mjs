// Where the reports are. Each project has one report folder `<name>-<6 hex of its path>` in the data folder,
// so two projects with the same folder name do not share a report.
// Before this rule the folder was `<name>`. A folder with the old name is renamed at its next use.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

export const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };

// out/ in a git checkout of this tool, ~/.context-health/ in an npm install. CONTEXT_HEALTH_HOME replaces both.
export function dataRootOf(toolRoot, home) {
  if (process.env.CONTEXT_HEALTH_HOME) return path.resolve(process.env.CONTEXT_HEALTH_HOME);
  return existsSync(path.join(toolRoot, '.git')) ? path.join(toolRoot, 'out') : path.join(home, '.context-health');
}

export const projectKey = root => `${path.basename(root)}-${createHash('sha256').update(root).digest('hex').slice(0, 6)}`;

// Rename the report folder and the model answers of a project from the old name. It deletes nothing.
export function moveOldFolder(dataRoot, root) {
  const key = projectKey(root);
  const name = path.basename(root);
  const owner = readJson(path.join(dataRoot, name, 'settings.json'), null)?.root ?? null;
  const oldCache = path.join(dataRoot, '.cache', name);
  const newCache = path.join(dataRoot, '.cache', key);
  // The old cache can hold the answers of two projects with one name. A project that does not own the old folder gets a copy.
  if (existsSync(oldCache) && !existsSync(newCache)) {
    if (owner === root) renameSync(oldCache, newCache);
    else cpSync(oldCache, newCache, { recursive: true });
  }
  if (owner === root && !existsSync(path.join(dataRoot, key))) renameSync(path.join(dataRoot, name), path.join(dataRoot, key));
  return key;
}

// All old folders, at the start of the dashboard.
export function moveOldFolders(dataRoot) {
  if (!existsSync(dataRoot)) return;
  for (const entry of readdirSync(dataRoot, { withFileTypes: true })) {
    const root = entry.isDirectory() && readJson(path.join(dataRoot, entry.name, 'settings.json'), null)?.root;
    if (root && path.basename(root) === entry.name) moveOldFolder(dataRoot, root);
  }
}
