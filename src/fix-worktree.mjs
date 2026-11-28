// The fix of the dashboard. `claude -p` edits a temporary git worktree, never the project.
// The result is a list of patches in <out>/fix.json. The user picks files, and Apply writes only those files.
// The worktree is in the temp folder of the system: in the cache folder, claude can load the CLAUDE.md of a folder above.
// It is removed as soon as the patches are read, so a fix that nobody reviews leaves nothing in the project.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relatedFiles } from './fixes.mjs';
import { isCandidate } from './context-files.mjs';
import { readJson } from './data-folder.mjs';
import { PARENT_ENV, trackModelProcess } from './intents.mjs';

const MAX_BUFFER = 256 * 1024 * 1024;
// No hooks of the project run, and no large files are downloaded.
const GIT_ENV = { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', GIT_OPTIONAL_LOCKS: '0' };
const git = (dir, args, options = {}) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.quotePath=false', ...args],
  { cwd: dir, env: GIT_ENV, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'], ...options });
const gitText = (dir, args) => git(dir, args).toString();
// The same patch form on each machine, with the user settings off.
const DIFF = ['-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'color.ui=false', 'diff', '--no-ext-diff', '--no-textconv',
  '--no-renames', '--ignore-submodules', '--binary'];

const NOTE = `

## How to work

You work in a temporary copy of the project. Edit the files directly. You cannot run commands, and you cannot ask questions.
Do not run context-health. Change only the files that section 5 names. When you are done, stop.
`;

export const GIT_REASONS = {
  'no-git': 'Fix needs a git repository.',
  'no-commit': 'Fix needs a git repository with one commit or more.'
};

export function gitState(root) {
  try { git(root, ['rev-parse', '--show-toplevel']); } catch { return 'no-git'; }
  try { git(root, ['rev-parse', '--verify', '-q', 'HEAD']); } catch { return 'no-commit'; }
  return 'ok';
}

export const fixPath = outDir => path.join(outDir, 'fix.json');
export function readyFix(outDir) {
  const fix = readJson(fixPath(outDir), null);
  return fix?.status === 'ready' ? fix : null;
}
const write = (outDir, fix) => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(fixPath(outDir), `${JSON.stringify(fix, null, 2)}\n`);
};

function runAgent(cwd, prompt) {
  const bin = process.env.CONTEXT_HEALTH_AGENT_BIN || 'claude';
  // Claude Code 2.1.322 blocks each edit in .claude/ here, also with an allow rule. Those files go into `blocked`, and the page names them.
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--tools', 'Read,Edit,Write,Glob,Grep',
    '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'];
  const env = { ...process.env };
  for (const key of PARENT_ENV) delete env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    trackModelProcess(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => reject(new Error(error.code === 'ENOENT' ? 'claude not found' : error.message)));
    child.on('close', code => {
      let answer = null;
      try { answer = JSON.parse(stdout); } catch { /* the code or stderr says what is wrong */ }
      if (code !== 0 || !answer || answer.is_error) {
        const why = (typeof answer?.result === 'string' && answer.result) || stderr.trim() || `claude exited with code ${code}`;
        return reject(new Error(why.slice(0, 400)));
      }
      resolve(answer);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${prompt}${NOTE}`);
  });
}

// The patches of the worktree: one entry for each file that the agent changed.
function readPatches(dir) {
  // Intent to add: a new file shows in the diff, and the index keeps the state from before the agent.
  git(dir, ['add', '-A', '-N', '.']);
  const names = gitText(dir, [...DIFF, '--relative', '--name-status', '-z']).split('\0').filter(Boolean);
  const files = [];
  for (let k = 0; k < names.length; k += 2) {
    const patch = gitText(dir, [...DIFF, '--relative', '--', names[k + 1]]);
    const [added, removed] = gitText(dir, [...DIFF, '--relative', '--numstat', '--', names[k + 1]]).split('\t').map(value => Number(value) || 0);
    files.push({ path: names[k + 1], status: names[k] === 'A' ? 'added' : names[k] === 'D' ? 'deleted' : 'modified', added, removed, patch });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export async function startFix({ root, outDir, prompt, findings = [], baseline, scoped }) {
  const state = gitState(root);
  if (state !== 'ok') throw new Error(GIT_REASONS[state]);
  const top = gitText(root, ['rev-parse', '--show-toplevel']).trim();
  const prefix = gitText(root, ['rev-parse', '--show-prefix']).trim();
  const holder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'context-health-fix-')));
  const tree = path.join(holder, path.basename(top));
  const cleanUp = () => {
    try { git(top, ['worktree', 'remove', '--force', tree]); } catch { /* it was not made */ }
    try { rmdirSync(holder); } catch { /* not empty: leave it */ }
  };
  // Stop in the dashboard sends SIGTERM to this process and to the agent.
  const stop = () => { cleanUp(); process.exit(143); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    git(top, ['worktree', 'add', '--detach', '-q', tree, 'HEAD']);
    // The uncommitted changes come too, so the patches fit the files that the user has now.
    const dirty = git(top, [...DIFF, 'HEAD']);
    if (dirty.length) git(tree, ['apply', '--whitespace=nowarn', '-'], { input: dirty });
    const loose = gitText(top, ['ls-files', '-o', '--exclude-standard', '-z']).split('\0').filter(rel => rel && isCandidate(rel));
    for (const rel of loose) cpSync(path.join(top, rel), path.join(tree, rel), { recursive: true });
    git(tree, ['add', '-A']);
    const cwd = path.join(tree, prefix);
    if (!existsSync(cwd)) throw new Error('Git does not track this folder, so Fix cannot copy it.');
    console.log('fix: claude edits a copy of the project');
    const answer = await runAgent(cwd, prompt);
    const files = readPatches(cwd).map(file => ({
      ...file, findingIds: findings.filter(item => relatedFiles(item).includes(file.path)).map(item => item.id)
    })).filter(file => !scoped || file.findingIds.length);
    const blocked = new Set((answer.permission_denials || []).map(item => item.tool_input?.file_path).filter(Boolean)
      .map(file => (file.startsWith(`${cwd}/`) ? path.relative(cwd, file) : file)));
    if (!files.length && blocked.size) throw new Error('Claude could not edit ' + [...blocked].join(', ') + '.');
    write(outDir, { id: randomUUID(), at: new Date().toISOString(), findings, baseline, status: files.length ? 'ready' : 'empty', files,
      blocked: [...blocked], costUsd: Number(answer.total_cost_usd) || 0 });
    console.log(`fix: ${files.length} files changed in the copy`);
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    cleanUp();
  }
}

const applyPatches = (root, items, ...flags) =>
  git(root, ['apply', '--whitespace=nowarn', ...flags, '-'], { input: items.map(item => item.patch).join('') });

function pickFiles({ outDir, files }) {
  const fix = readyFix(outDir);
  if (!fix) throw new Error('There is no fix to apply.');
  const picked = fix.files.filter(file => files.includes(file.path));
  if (!picked.length || picked.length !== new Set(files).size) throw new Error('The fix does not have these files.');
  return { fix, picked };
}

// The picked files that changed in the project after the fix, so their patches do not fit.
export function fixConflicts({ root, outDir, files }) {
  return pickFiles({ outDir, files }).picked
    .filter(item => { try { applyPatches(root, [item], '--check'); return false; } catch { return true; } }).map(item => item.path);
}

// Returns { conflicts }. With one conflict or more, no file changes.
export function applyFix({ root, outDir, files }) {
  const conflicts = fixConflicts({ root, outDir, files });
  if (conflicts.length) return { conflicts };
  const { fix, picked } = pickFiles({ outDir, files });
  applyPatches(root, picked);
  write(outDir, { ...fix, status: 'applied', applied: picked.map(item => item.path) });
  return { conflicts: [] };
}

export function discardFix(outDir) {
  const fix = readyFix(outDir);
  if (fix) write(outDir, { ...fix, status: 'discarded' });
}
