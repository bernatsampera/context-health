// Step 12: the proof of the score, from the git history of the project.
// For each analysed session: the commit of the project at the start time of the session, the context at that commit,
// the map of that context, and the grade of each file need of the session on that map. Then: did the agent search
// less for the Served needs than for the other needs?
// Git is read-only here: only `rev-parse`, `log`, `ls-tree`, `show` and `cat-file`, each with `-C <root>`.
// The context files of a commit go into `<cache>/history/<full sha>/tree/`, outside the project. `files.json` in the
// same folder is written last: with it, a later run does not read the texts from git again. Nothing is deleted.
// The memory folder of the project and ~/.claude are not in git: the proof uses their state of today.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { START_WHAT, collect } from './collect.mjs';
import { isCandidate } from './context-files.mjs';
import { weakWayOf } from './found.mjs';
import { ignoreStart } from './ignore.mjs';
import { buildMap } from './map.mjs';
import { PROOF_LIMITS, PROOF_NOTES, gradeOf } from './score-v1.mjs';

const READ_ONLY = new Set(['rev-parse', 'log', 'ls-tree', 'show', 'cat-file']);
const MAX = 1024 * 1024 * 1024;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const num = value => value.toLocaleString('en-US');
const count = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const round3 = value => (value == null ? null : Math.round(value * 1000) / 1000);
const pct = rate => `${Math.round(rate * 100)}%`;

const LEFT_OUT = {
  'no-git': 'The project is not a git repository.',
  'no-commit-before': 'The project has no commit before the start of this session.',
  'no-start-time': 'The session has no start time.',
  'git-error': 'The tool could not read the files of the commit from git.'
};

// One git command of the read-only list. Returns a Buffer. Throws when git fails.
function gitOf(root) {
  return (args, input = null) => {
    if (!READ_ONLY.has(args[0])) throw new Error(`not a read-only git command: ${args[0]}`);
    return execFileSync('git', ['-C', root, ...args], { input: input ?? undefined, maxBuffer: MAX, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'ignore'] });
  };
}

// The files of a commit that the rebuild needs on disk: the candidates of the context rule, and the Claude folders.
const isWanted = rel => isCandidate(rel) || rel.startsWith('.claude/') || rel.startsWith('.agents/') || path.posix.basename(rel) === '.gitignore';
const isSafe = rel => rel && !rel.startsWith('/') && !rel.split('/').some(part => part === '..' || part === '.' || part === '.git' || part === '');

// The file list of a commit, with its context files on disk in the cache. Returns { tree, files, read }.
// `read` is true when this call read the commit from git.
function commitFiles({ git, cacheDir, sha }) {
  const dir = path.join(cacheDir, 'history', sha);
  const tree = path.join(dir, 'tree');
  const marker = path.join(dir, 'files.json');
  try {
    const data = JSON.parse(readFileSync(marker, 'utf8'));
    if (data.commit === sha && Array.isArray(data.files)) return { tree, files: data.files, read: false };
  } catch { /* no marker: read the commit */ }
  // One listing and one `cat-file --batch` process for the commit. In a subfolder of a repository, the listing holds
  // only the files of the subfolder, with paths from the subfolder.
  const entries = git(['ls-tree', '-r', '-z', sha]).toString('utf8').split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, type, blob] = line.slice(0, tab).split(' ');
    return { mode, type, blob, path: line.slice(tab + 1) };
  }).filter(entry => entry.type === 'blob' && isSafe(entry.path));
  const files = entries.filter(entry => entry.mode !== '120000').map(entry => entry.path).sort(cmp);
  const wanted = entries.filter(entry => isWanted(entry.path));
  mkdirSync(tree, { recursive: true });
  if (wanted.length) {
    const out = git(['cat-file', '--batch'], `${wanted.map(entry => entry.blob).join('\n')}\n`);
    let at = 0;
    for (const entry of wanted) {
      const end = out.indexOf(10, at);
      const size = Number(out.subarray(at, end).toString('utf8').split(' ')[2]);
      if (!Number.isInteger(size)) throw new Error(`git cat-file gave no blob for ${entry.path}`);
      const body = out.subarray(end + 1, end + 1 + size);
      at = end + 1 + size + 1;
      const file = path.join(tree, entry.path);
      mkdirSync(path.dirname(file), { recursive: true });
      if (entry.mode === '120000') {
        // A symbolic link (a skill folder is often one): keep it when it stays in the tree.
        const target = body.toString('utf8');
        const full = path.resolve(path.dirname(file), target);
        if (!path.isAbsolute(target) && full.startsWith(tree + path.sep)) { try { symlinkSync(target, file); } catch { /* it is there */ } }
      } else writeFileSync(file, body);
    }
  }
  writeFileSync(marker, `${JSON.stringify({ commit: sha, files })}\n`);
  return { tree, files, read: true };
}

// The map of the context at a commit: { mapFiles, startPaths }.
function oldMapOf({ model, root, home, claudeSettingsHome, config, tree, files }) {
  const old = ignoreStart(collect({ root: tree, home, claudeSettingsHome, config, listing: { method: 'git', files }, realRoot: root }), { ignore: model.ignore, root, home });
  const built = buildMap({ root: tree, model: old, files, sessions: model.sessions, config, memoryRoot: root });
  return { mapFiles: new Map(built.map.files.map(file => [file.path, file])),
    startPaths: new Set(old.startLoad.filter(item => START_WHAT.has(item.what)).map(item => item.path)) };
}

// The grade of a path on an old map. A file that is not on that map (it was not in the commit) is Missed.
function gradeOn(old, rel) {
  const file = old.mapFiles.get(rel);
  return gradeOf(file ? file.steps : old.startPaths.has(rel) ? 0 : null, file, old.mapFiles);
}

// The same exception as src/found.mjs, on the old map: a file 1 step away that the start names without its path.
function namedAtStart(old, rel) {
  const file = old.mapFiles.get(rel);
  if (!file || file.steps !== 1) return false;
  return file.route.at(-1).via === 'trigger' || old.mapFiles.get(file.route.at(-2)?.path)?.kind === 'memory index';
}

// ---------- the numbers and the text ----------

function result({ rows, allNeeds, leftOut, commits, used, factsLeftOut, noGit }) {
  const group = list => {
    const needs = list.length;
    const searched = list.filter(row => row.searched).length;
    // How the agent got the searched needs: a search gave the path, the user gave it, or nothing named it.
    const ways = { search: 0, user: 0, none: 0 };
    for (const row of list) if (row.searched) ways[row.way] += 1;
    const typedFacts = list.reduce((total, row) => total + row.facts, 0);
    return { needs, searched, searchRate: needs ? round3(searched / needs) : null, typedFacts: round3(typedFacts), typedFactRate: needs ? round3(typedFacts / needs) : null, ways };
  };
  const of = grade => rows.filter(row => row.grade === grade);
  const missed = of('missed');
  const compare = missed.length >= PROOF_LIMITS.other ? 'missed' : 'slow+missed';
  const grades = { served: group(of('served')), slow: group(of('slow')), missed: group(missed),
    other: group(compare === 'missed' ? missed : rows.filter(row => row.grade !== 'served')) };
  const { served, other } = grades;
  const name = compare === 'missed' ? 'Missed' : 'Slow and Missed';
  const known = key => served[key] != null && other[key] != null;
  const checks = { enough: served.needs >= PROOF_LIMITS.served && other.needs >= PROOF_LIMITS.other,
    searchRate: known('searchRate') ? served.searchRate < other.searchRate : null,
    typedFactRate: known('typedFactRate') ? served.typedFactRate <= other.typedFactRate : null };
  const searchText = `the agent searched for ${served.searchRate == null ? 'no' : pct(served.searchRate)} of the Served needs and for ${other.searchRate == null ? 'no' : pct(other.searchRate)} of the ${name} needs`;
  const typedText = `you typed ${served.typedFactRate} rules for each Served need and ${other.typedFactRate} for each ${name} need`;
  let status;
  let text;
  if (!allNeeds) {
    status = 'no-data';
    text = 'Score not proven: no analysed session has a file need.';
  } else if (!checks.enough) {
    status = 'not-enough';
    text = noGit ? `Score not proven: the project is not a git repository, so the tool cannot rebuild the context of the old sessions (${PROOF_LIMITS.served} Served needs and ${PROOF_LIMITS.other} Slow and Missed needs are necessary).`
      : `Score not proven: ${count(used, 'session')} with a commit ${used === 1 ? 'gives' : 'give'} ${count(served.needs, 'Served need')} and ${count(other.needs, `${name} need`)} (${PROOF_LIMITS.served} of each are necessary).`;
  } else if (checks.searchRate && checks.typedFactRate) {
    status = 'pass';
    text = `Proven on ${count(used, 'session')}: ${searchText}.${served.typedFacts + other.typedFacts > 0 ? ` ${typedText.charAt(0).toUpperCase()}${typedText.slice(1)}.` : ''}`;
  } else {
    status = 'fail';
    text = !checks.searchRate ? `Score not proven: ${searchText}. The rate of the Served needs must be lower.`
      : `Score not proven: ${typedText}. The rate of the Served needs must not be higher.`;
  }
  return { status, text, limits: { ...PROOF_LIMITS }, compare, sessions: { used, leftOut }, grades, checks, factsLeftOut, commits, notes: [...PROOF_NOTES] };
}

// ---------- main ----------

// Returns { proof, stats }. `stats` is for the command line only: { commits, read } (the commits of the proof, and how
// many of them this run read from git). `proof` has no time, no folder of the cache and no full path.
export function buildProof({ model, root, home, claudeSettingsHome, cacheDir, config = null }) {
  root = path.resolve(root);
  const git = gitOf(root);
  const text = args => { try { return git(args).toString('utf8').trim(); } catch { return null; } };
  const noGit = text(['rev-parse', '--is-inside-work-tree']) !== 'true';
  const verify = ref => Boolean(text(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]));
  const refs = new Map();
  const isRef = ref => { if (!refs.has(ref)) refs.set(ref, verify(ref)); return refs.get(ref); };
  // The branch of the session when git has it, else the default branch.
  const branchOf = name => {
    if (name) for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) if (isRef(ref)) return { ref, branch: name, fallback: false };
    for (const [ref, branch] of [['refs/remotes/origin/HEAD', 'origin/HEAD'], ['refs/heads/main', 'main'], ['refs/heads/master', 'master'], ['HEAD', 'HEAD']]) {
      if (isRef(ref)) return { ref, branch, fallback: true };
    }
    return null;
  };
  const maps = new Map(); // full sha -> old map, or null when git could not give the commit
  const stats = { commits: 0, read: 0 };
  const oldMap = sha => {
    if (!maps.has(sha)) {
      let old = null;
      try {
        const { tree, files, read } = commitFiles({ git, cacheDir, sha });
        old = oldMapOf({ model, root, home, claudeSettingsHome, config, tree, files });
        stats.commits += 1;
        if (read) stats.read += 1;
      } catch { /* left out: git-error */ }
      maps.set(sha, old);
    }
    return maps.get(sha);
  };

  const sessionsById = new Map(model.sessions.list.map(session => [session.sessionId, session]));
  const intentsOf = new Map();
  for (const intent of model.routes.intents) intentsOf.set(intent.sessionId, [...(intentsOf.get(intent.sessionId) || []), intent]);
  const typedOf = new Map(); // sessionId:intentId -> the typed rules of the intent
  for (const entry of model.needs.sessions) {
    for (const intent of entry.intents) typedOf.set(`${entry.sessionId}:${intent.intentId}`, intent.needs.filter(need => need.kind === 'missing').length);
  }

  const leftOut = [];
  const commits = [];
  const rows = []; // one for each file need of a used session: { grade, searched, facts }
  let used = 0;
  let allNeeds = 0;
  let factsLeftOut = 0;
  for (const entry of model.intents.sessions.filter(item => item.status === 'ok')) {
    const session = sessionsById.get(entry.sessionId);
    const intents = intentsOf.get(entry.sessionId) || [];
    allNeeds += intents.reduce((total, intent) => total + intent.needs.length, 0);
    const out = reason => leftOut.push({ sessionId: entry.sessionId, reason, text: LEFT_OUT[reason] });
    if (noGit) { out('no-git'); continue; }
    const time = Date.parse(session?.startedAt ?? '');
    if (Number.isNaN(time)) { out('no-start-time'); continue; }
    const branch = branchOf(session.gitBranch);
    const sha = branch ? text(['log', `--before=${new Date(time).toISOString().replace(/\.\d+Z$/, 'Z')}`, '-1', '--format=%H', branch.ref]) : null;
    if (!sha || !/^[0-9a-f]{40,64}$/.test(sha)) { out('no-commit-before'); continue; }
    const old = oldMap(sha);
    if (!old) { out('git-error'); continue; }
    used += 1;
    commits.push({ sessionId: entry.sessionId, commit: sha.slice(0, 7), branch: branch.branch, fallback: branch.fallback });
    for (const intent of intents) {
      const typed = typedOf.get(`${intent.sessionId}:${intent.intentId}`) || 0;
      // Each typed rule of the intent is divided in equal parts over the file needs of the intent (P13: none, left out).
      if (!intent.needs.length) { factsLeftOut += typed; continue; }
      for (const need of intent.needs) {
        const way = weakWayOf(need);
        rows.push({ grade: gradeOn(old, need.path), way, searched: Boolean(way) && !(way === 'none' && namedAtStart(old, need.path)), facts: typed / intent.needs.length });
      }
    }
  }
  return { proof: result({ rows, allNeeds, leftOut, commits, used, factsLeftOut, noGit }), stats };
}
