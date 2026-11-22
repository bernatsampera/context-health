// Step 2: the map. For each file of the project, how the agent gets to it from the start load,
// in how many steps, and what the files on the way cost in tokens. No model calls.
// Step 10 adds: the auto memory files of the project (the index is a start file), the folders that a file names as
// plain text (`folderMentions`), and a second run with a virtual CLAUDE.md for a project that has no start file of
// its own (`virtualStart`).
// Step 11: the map also decides which candidates are context files (src/context-files.mjs has the rule).
// - Only a context file is a source of links. The map reads no link from a file that is out.
// - Check 7 of the rule: a link, an `@` import or (outside the code folders) a plain path in a context file brings an
//   open candidate in (`linked`). The map decides this while it reads the links, so the map and the set of context
//   files cannot disagree. A linked file is a source too, so the rule repeats.
// - A candidate that is out stays a map file (as a code file does), with `context: false` and `kind: "excluded"`.
// - A file that git does not list is a map file only when Claude Code loads it by itself, when the config file
//   includes it, or when a context file links it. A session read alone does not put it on the map (step 10 did).
import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { START_WHAT, frontmatter, importsOf, tokens } from './collect.mjs';
import { contextReport, contextRule, isCandidate, isTextFile, kindOf, loadedFiles } from './context-files.mjs';
import { readMemory } from './memory.mjs';

export const MAP_RULES = 'link 1 step, folder link 1 step per level, mention 1 step, @ import 0 steps, ' +
  'skill or command body 1 step (trigger), nested CLAUDE.md 0 extra steps';
// The start file that a project with no start file of its own can create.
export const VIRTUAL_START = 'CLAUDE.md';

function read(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

function isDir(dir) {
  try { return statSync(dir).isDirectory(); } catch { return false; }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isSource = isTextFile;
const isNestedClaude = rel => path.posix.basename(rel) === 'CLAUDE.md' && rel.includes('/') && !rel.startsWith('.claude/');

// The lines of a file that are not in a fenced code block, with their line number from 1.
function proseLines(text) {
  const out = [];
  let fence = null;
  text.replaceAll('\r', '').split('\n').forEach((line, i) => {
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      return;
    }
    if (open) { fence = open[1]; return; }
    out.push({ n: i + 1, line });
  });
  return out;
}

// Link targets on one line, outside code spans: [text](target "title") and [ref]: target.
function linkTargets(line) {
  const prose = line.replace(/`[^`]*`/g, match => ' '.repeat(match.length));
  const found = [];
  for (const match of prose.matchAll(/\]\(\s*([^)]*?)\s*\)/g)) found.push(match[1]);
  const ref = prose.match(/^\s*\[[^\]]+\]:\s*(\S+)/);
  if (ref) found.push(ref[1]);
  return found.map(target => {
    if (target.startsWith('<')) return target.slice(1, target.indexOf('>') > 0 ? target.indexOf('>') : undefined);
    return target.split(/\s+/)[0];
  }).filter(Boolean);
}

// Path-like words on one line (code spans count): words with a "/" that are not URLs.
// A word with "/" at the end can name a folder. It never names a file.
function pathWords(line) {
  const text = line.replace(/\]\([^)]*\)/g, '] ');
  const out = [];
  for (let token of text.split(/[\s,;|()<>"'`*]+/)) {
    const opens = (token.match(/\[/g) || []).length;
    const closes = (token.match(/\]/g) || []).length;
    if (opens > closes) token = token.replace(/^\[+/, '');
    if (closes > opens) token = token.replace(/\]+$/, '');
    token = token.replace(/[.:!?]+$/, '').replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, '');
    if (!token.includes('/') || token.startsWith('~')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(token) || token.startsWith('//')) continue;
    out.push(token);
  }
  return out;
}

// A name in a form that does not depend on case, "_" or spaces: `feedback_from_zero.md` and `feedback-from-zero` are the same.
const slug = name => name.toLowerCase().replace(/\.mdx?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// [[name]] links on one line, outside code spans. A memory file uses them for another memory file.
function wikiTargets(line) {
  const prose = line.replace(/`[^`]*`/g, match => ' '.repeat(match.length));
  return [...prose.matchAll(/\[\[([^\[\]|#]+)(?:[|#][^\[\]]*)?\]\]/g)]
    .map(match => ({ raw: match[0], name: match[1].trim() })).filter(item => item.name);
}

// A small binary heap with a compare function.
class Heap {
  constructor(less) { this.items = []; this.less = less; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

// Fewer steps, then fewer pathTokens, then the route that comes first in path order.
function compareLabels(a, b) {
  if (a.steps !== b.steps) return a.steps - b.steps;
  if (a.pathTokens !== b.pathTokens) return a.pathTokens - b.pathTokens;
  const n = Math.min(a.route.length, b.route.length);
  for (let i = 0; i < n; i += 1) {
    const c = cmp(a.route[i].path, b.route[i].path);
    if (c) return c;
  }
  return a.route.length - b.route.length;
}

// Returns { map, contextFiles, contextRules }. `config` is null or the object of readConfig.
// Step 12 (the proof): `memoryRoot` is the project folder of today when `root` is a copy of an old commit.
export function buildMap({ root, model, files, sessions = null, config = null, memoryRoot = null }) {
  root = path.resolve(root);
  const ctx = { root, home: os.homedir(), claudeSettingsHome: model.claudeSettingsHome };
  const toRel = abs => path.relative(root, abs).split(path.sep).join('/');
  const inRoot = abs => abs.startsWith(root + path.sep) && !toRel(abs).split('/').includes('.git');
  // The auto memory of the project. Its files are map files with a `~/.claude/projects/<folder>/memory/` path.
  const memory = readMemory({ root: memoryRoot ?? root, claudeSettingsHome: model.claudeSettingsHome });
  const inMemory = abs => memory.files.length > 0 && abs.startsWith(memory.dir + path.sep);
  // The report path of a full path: a project path, a memory path, or null for a path outside both.
  const idOf = abs => (inRoot(abs) ? toRel(abs)
    : inMemory(abs) ? `${memory.display}/${path.relative(memory.dir, abs).split(path.sep).join('/')}` : null);
  // A full path as written in a file: a path in the project or in the memory folder stays, else it is from the project root.
  const fromRoot = written => (written.startsWith(root + '/') || inMemory(written) ? written : path.join(root, written));
  const dirs = new Map();
  const isFolder = abs => { if (!dirs.has(abs)) dirs.set(abs, isDir(abs)); return dirs.get(abs); };
  // The memory file that [[name]] names when no file `name.md` is there: the file with this `name` in its front matter,
  // else the file with this file name (with "-" for each other character), else the one file whose name ends with `-name`
  // (a link often leaves out the first word of the name, such as `feedback` or `project`).
  const memoryNames = memory.files.map(item => ({ abs: item.abs, name: slug(frontmatter(item.text).name || ''), file: slug(path.basename(item.abs)) }));
  const wikiFile = name => {
    const key = slug(name);
    if (!key) return null;
    const ends = memoryNames.filter(item => item.name.endsWith(`-${key}`) || item.file.endsWith(`-${key}`));
    return (memoryNames.find(item => item.name === key) || memoryNames.find(item => item.file === key) || (ends.length === 1 ? ends[0] : null))?.abs ?? null;
  };

  // Checks 1 to 6 of the rule for a candidate path.
  const listed = new Set(files);
  const { start, auto, skills } = loadedFiles(model);
  const rule = contextRule({ config, git: model.listing.method === 'git', listed, start, auto, skills });
  const onDisk = rel => { const abs = path.join(root, rel); return inRoot(abs) && toRel(abs) === rel && isFile(abs); };
  // Files on disk that the file list does not have (git ignores them), and that the tool sees with no link:
  // - `extra`: the files that Claude Code loads by itself, and the candidates of the sessions that the rule lets in
  //   (the config file includes them). They are map files, and their links are edges.
  // - `unlisted`: each other candidate that a session read or loaded. It is out, and it is not a map file.
  const extra = new Set();
  const unlisted = new Map(); // path -> reason
  for (const rel of auto) if (!listed.has(rel) && onDisk(rel)) extra.add(rel);
  const checked = new Set();
  for (const session of sessions?.list || []) {
    for (const event of session.events) {
      const rel = event.path;
      if ((event.kind !== 'read' && event.kind !== 'load') || !rel || rel === '.' || rel.startsWith('~') || rel.startsWith('/')) continue;
      if (listed.has(rel) || extra.has(rel) || checked.has(rel) || !isCandidate(rel)) continue;
      checked.add(rel);
      if (!onDisk(rel)) continue;
      const verdict = rule(rel);
      if (verdict.state === 'out') unlisted.set(rel, verdict.why);
      else extra.add(rel);
    }
  }
  const nestedAgents = new Set(model.later.filter(item => item.what === 'nested instructions' && path.posix.basename(item.path) === 'AGENTS.md')
    .map(item => item.path));

  // One run of the map. `virtual` is null, or a start file that is not on disk: { path, text }.
  // `fixed` is null, or the class of each file from the real run (path -> { context, kind, why }). With it, the run
  // changes no class: the second run must not change the set of context files.
  const run = (virtual, fixed) => {
    // Nodes: listed files, the files of `extra`, memory files, linked git-ignored files,
    // and the ~/.claude bodies behind a trigger.
    // `why`: the class of a context file, the reason of a candidate that is out, null for a code file.
    // `open`: the links decide (check 7). Then `why` is the reason for the case that no context file names the file.
    const nodes = new Map();
    const addProjectNode = (rel, ignored) => {
      const text = read(path.join(root, rel)) ?? '';
      // kindOf names the kinds of context files. A candidate that is out is `excluded`. Every other file is code.
      const node = { path: rel, context: false, kind: 'code', why: null, open: false, tokens: tokens(text), ignored, text, abs: path.join(root, rel), memory: false };
      const known = fixed?.get(rel);
      if (known) Object.assign(node, known);
      else if (isCandidate(rel)) {
        const verdict = rule(rel);
        Object.assign(node, { context: verdict.state === 'in', kind: verdict.state === 'in' ? kindOf(rel) : 'excluded', why: verdict.why, open: verdict.state === 'open' && !fixed });
      }
      nodes.set(rel, node);
      return node;
    };
    for (const rel of files) addProjectNode(rel, false);
    for (const rel of [...extra].sort(cmp)) addProjectNode(rel, true);
    for (const file of memory.files) {
      const isIndex = memory.index != null && file.path === memory.index.path;
      // Only the part of the index that loads at the start gives edges. The tokens are the tokens of the full file.
      nodes.set(file.path, { path: file.path, context: true, kind: isIndex ? 'memory index' : 'memory', why: 'memory', open: false, tokens: tokens(file.text), ignored: false,
        text: isIndex ? memory.index.loaded : file.text, abs: file.abs, memory: true });
    }
    if (virtual) {
      nodes.set(virtual.path, { path: virtual.path, context: true, kind: kindOf(virtual.path), why: 'start-load', open: false, tokens: tokens(virtual.text), ignored: false,
        text: virtual.text, abs: path.join(root, virtual.path), memory: false });
    }
    const triggers = [];
    for (const item of model.later) {
      if (!/ body$/.test(item.what) || triggers.includes(item.path)) continue;
      if (item.path.startsWith('~/')) {
        if (!nodes.has(item.path)) {
          nodes.set(item.path, { path: item.path, context: true, kind: item.what, why: 'user', open: false, tokens: item.tokens ?? 0, ignored: false, text: null, abs: null, memory: false });
        }
      } else if (!nodes.has(item.path)) continue;
      triggers.push(item.path);
    }

    // Edges, read from each source file outside code blocks.
    const edges = new Map(); // source path -> [{ to, weight, via, line }]
    const imports = new Map(); // source path -> [{ to, line }] (used only from instruction files)
    const broken = [];
    const folderWords = []; // { folder, source, line }: plain text that names a folder of the project
    const addEdge = (from, to, weight, via, line) => {
      if (from === to) return;
      if (!edges.has(from)) edges.set(from, []);
      const list = edges.get(from);
      if (!list.some(e => e.to === to && e.via === via && e.line === line)) list.push({ to, weight, via, line });
    };
    const folderFiles = dir => [...nodes.keys()].filter(rel => !rel.startsWith('~/') && rel.startsWith(`${dir}/`));

    // The sources: the context files with text. A file that is out gives no edge.
    const queue = [...nodes.values()].filter(node => node.context && node.text != null && isSource(node.path));
    // Check 7: a context file names an open candidate, so it is a context file too (`linked`) and a new source.
    // A plain path (`mention`) does not count for a file in a code folder. A folder link never counts.
    const promote = (id, via) => {
      const target = nodes.get(id);
      if (!target?.open || (via === 'mention' && target.why === 'code-folder')) return;
      Object.assign(target, { context: true, kind: kindOf(id), openWhy: target.why, why: 'linked', open: false });
      queue.push(target);
    };
    // A file on disk that is not a map file yet (git does not list it): a new map file, and a source when it is a context file.
    const addLinked = rel => {
      const added = addProjectNode(rel, true);
      if (added.context && isSource(rel)) queue.push(added);
    };
    const readSource = node => {
      const abs = node.abs;
      const dir = path.dirname(abs);
      // A memory file resolves a relative link from its own folder, then from the project root.
      const linkBases = node.memory ? [dir, root] : [dir];
      for (const { n, line } of proseLines(node.text)) {
        const linked = new Set();
        // The first candidate that is a map file, a file on disk or a folder gives the edge. Else the link is broken.
        const link = (candidates, raw) => {
          let missing = null;
          for (const target of candidates) {
            const id = target === root ? '' : idOf(target);
            if (id == null) continue; // outside the project and the memory folder
            const inProject = !id.startsWith('~/');
            if (id && nodes.has(id)) {
              addEdge(node.path, id, 1, 'link', n);
              linked.add(id);
              promote(id, 'link');
              return;
            }
            if (id && isFile(target)) {
              // A file of the memory folder that is not a Markdown file is not a map file.
              if (!inProject) return;
              addLinked(id);
              addEdge(node.path, id, 1, 'link', n);
              linked.add(id);
              promote(id, 'link');
              return;
            }
            if (isDir(target)) {
              for (const [other] of nodes) {
                if (inProject ? (other.startsWith('~/') || (id && !other.startsWith(`${id}/`))) : !other.startsWith(`${id}/`)) continue;
                const depth = (id ? other.slice(id.length + 1) : other).split('/').length - 1;
                addEdge(node.path, other, 1 + depth, 'folder', n);
              }
              return;
            }
            missing ??= id;
          }
          if (missing != null) broken.push({ source: node.path, line: n, target: missing, raw });
        };
        for (const raw of linkTargets(line)) {
          if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#') || raw.startsWith('//')) continue;
          let clean = raw.replace(/[#?].*$/, '');
          try { clean = decodeURI(clean); } catch { /* keep as written */ }
          if (!clean) continue;
          link(clean.startsWith('/') ? [fromRoot(clean)] : linkBases.map(base => path.resolve(base, clean)), raw);
        }
        if (node.memory) {
          // [[name]] is a link to name.md in the memory folder, or to the memory file with that name.
          for (const { raw, name } of wikiTargets(line)) {
            const fileName = /\.mdx?$/i.test(name) ? name : `${name}.md`;
            link([...new Set([path.resolve(dir, fileName), path.resolve(memory.dir, fileName), wikiFile(name)])].filter(item => item && inMemory(item)), raw);
          }
        }
        const words = pathWords(line);
        const candidatesOf = token => (token.startsWith('/') ? [fromRoot(token)] : [path.resolve(dir, token), path.resolve(root, token)]);
        for (const token of words) {
          if (token.endsWith('/')) continue;
          for (const candidate of candidatesOf(token)) {
            const id = idOf(candidate);
            if (id == null || !nodes.has(id)) continue;
            if (!linked.has(id)) {
              addEdge(node.path, id, 1, 'mention', n);
              promote(id, 'mention');
            }
            break;
          }
        }
        // A path-like word that names a folder of the project. It is not an edge: the agent still has to list the folder.
        if (!virtual) {
          for (const word of words) {
            const token = word.replace(/\/+$/, '');
            if (!/[A-Za-z0-9]/.test(token)) continue;
            for (const candidate of candidatesOf(token)) {
              if (!inRoot(candidate) || !isFolder(candidate)) continue;
              folderWords.push({ folder: toRel(candidate), source: node.path, line: n });
              break;
            }
          }
        }
        if (node.memory) continue; // @ imports work only in instruction files
        for (const target of importsOf(line, abs, ctx)) {
          if (!inRoot(target)) continue;
          const rel = toRel(target);
          if (!nodes.has(rel)) addLinked(rel);
          if (!imports.has(node.path)) imports.set(node.path, []);
          imports.get(node.path).push({ to: rel, line: n });
        }
      }
    };

    // @ imports work only in instruction files and in the files they import. An import brings an open candidate in,
    // and that file is a new source. So read the sources and the imports in turns, until no new source is left.
    const readImports = () => {
      const importSources = [...nodes.keys()].filter(rel => !rel.startsWith('~/') && ['CLAUDE.md', 'CLAUDE.local.md'].includes(path.posix.basename(rel)));
      for (let i = 0; i < importSources.length; i += 1) {
        for (const edge of imports.get(importSources[i]) || []) {
          addEdge(importSources[i], edge.to, 0, 'import', edge.line);
          promote(edge.to, 'import');
          if (!importSources.includes(edge.to)) importSources.push(edge.to);
        }
      }
    };
    do {
      while (queue.length) readSource(queue.shift());
      readImports();
    } while (queue.length);

    // A nested CLAUDE.md comes with the first file the agent reaches in its folder.
    // A nested AGENTS.md that loads (it is in `later`) comes the same way.
    const autoEdges = new Map(); // file path -> [nested instruction file]
    for (const rel of [...nodes.keys()].filter(item => isNestedClaude(item) || nestedAgents.has(item)).sort()) {
      const folder = path.posix.dirname(rel);
      for (const other of folderFiles(folder)) {
        if (other === rel) continue;
        if (!autoEdges.has(other)) autoEdges.set(other, []);
        autoEdges.get(other).push(rel);
      }
    }
    const outgoing = from => [
      ...(edges.get(from) || []),
      ...(autoEdges.get(from) || []).map(to => ({ to, weight: 0, via: 'auto', line: null }))
    ];

    // Shortest routes: Dijkstra with the labels (steps, pathTokens, route).
    // The start points: the project files of the start load, and the memory index (its item has scope `project`).
    const startPaths = virtual ? [virtual.path] : [];
    for (const item of model.startLoad) {
      if (item.scope === 'project' && START_WHAT.has(item.what) && nodes.has(item.path) && !startPaths.includes(item.path)) {
        startPaths.push(item.path);
      }
    }
    const best = new Map();
    const settled = new Set();
    const heap = new Heap((a, b) => compareLabels(a.label, b.label) < 0);
    const offer = (to, label) => {
      if (settled.has(to)) return;
      const old = best.get(to);
      if (old && compareLabels(label, old) >= 0) return;
      best.set(to, label);
      heap.push({ to, label });
    };
    for (const rel of startPaths) offer(rel, { steps: 0, pathTokens: 0, route: [{ path: rel, via: 'start', line: null }] });
    for (const rel of triggers) offer(rel, { steps: 1, pathTokens: 0, route: [{ path: rel, via: 'trigger', line: null }] });
    while (heap.size) {
      const { to: from, label } = heap.pop();
      if (settled.has(from) || best.get(from) !== label) continue;
      settled.add(from);
      const cost = label.steps === 0 ? 0 : nodes.get(from).tokens;
      for (const edge of outgoing(from)) {
        offer(edge.to, {
          steps: label.steps + edge.weight,
          pathTokens: label.pathTokens + cost,
          route: [...label.route, { path: edge.to, via: edge.via, line: edge.line }]
        });
      }
    }

    // Incoming edges with a line, for linkedFrom.
    const incoming = new Map();
    for (const [from, list] of edges) {
      for (const edge of list) {
        if (!incoming.has(edge.to)) incoming.set(edge.to, []);
        incoming.get(edge.to).push({ path: from, via: edge.via, line: edge.line });
      }
    }

    const out = [...nodes.values()].sort((a, b) => cmp(a.path, b.path)).map(node => {
      const label = best.get(node.path);
      const reach = !label ? 'none' : label.steps === 0 ? 'start' : 'path';
      const linkedFrom = (incoming.get(node.path) || [])
        .sort((a, b) => cmp(a.path, b.path) || a.line - b.line || cmp(a.via, b.via));
      return {
        path: node.path, context: node.context, kind: node.kind, why: node.why, tokens: node.tokens, ignored: node.ignored,
        reach, steps: label ? label.steps : null, pathTokens: label ? label.pathTokens : null,
        via: label ? label.route.at(-1).via : null,
        route: label ? label.route : [],
        linkedFrom
      };
    });
    broken.sort((a, b) => cmp(a.source, b.source) || a.line - b.line || cmp(a.target, b.target));
    // The first context file by path that names a linked file in a way that counts for it.
    const linkers = new Map();
    for (const node of nodes.values()) {
      if (node.why !== 'linked') continue;
      const names = (incoming.get(node.path) || []).filter(item => item.via === 'link' || item.via === 'import' || (item.via === 'mention' && node.openWhy !== 'code-folder'));
      linkers.set(node.path, names.map(item => item.path).sort(cmp)[0] ?? null);
    }
    return { out, broken, folderWords, linkers };
  };

  const { out, broken, folderWords, linkers } = run(null, null);

  // The context files of the project and the candidates that are out, from the real run only.
  const project = out.filter(file => !file.path.startsWith('~/'));
  const excluded = project.filter(file => file.kind === 'excluded').map(file => ({ path: file.path, reason: file.why }));
  for (const [rel, reason] of unlisted) if (!excluded.some(file => file.path === rel)) excluded.push({ path: rel, reason });
  const report = contextReport({ config, excluded,
    files: project.filter(file => file.context).map(file => ({ path: file.path, kind: file.kind, tokens: file.tokens, why: file.why, linkedFrom: linkers.get(file.path) })) });

  // Folder mentions: keep only the folders that hold a file with no route, at any depth.
  const noRoute = out.filter(file => file.reach === 'none').map(file => file.path);
  const holds = new Map();
  const holdsNoRoute = folder => {
    if (!holds.has(folder)) holds.set(folder, noRoute.some(rel => rel.startsWith(`${folder}/`)));
    return holds.get(folder);
  };
  const mentionKeys = new Set();
  const folderMentions = folderWords.filter(item => {
    const key = `${item.folder}\u0000${item.source}\u0000${item.line}`;
    if (mentionKeys.has(key) || !holdsNoRoute(item.folder)) return false;
    mentionKeys.add(key);
    return true;
  }).sort((a, b) => cmp(a.folder, b.folder) || cmp(a.source, b.source) || a.line - b.line);

  // A project with no start file of its own: what would a new CLAUDE.md bring in? The map runs a second time with a
  // virtual CLAUDE.md that imports AGENTS.md (when the project has it). The real numbers come from the first run only.
  let virtualStart = null;
  if (!model.startLoad.some(item => item.scope === 'project' && item.what === 'instructions')) {
    const imports = isFile(path.join(root, 'AGENTS.md')) ? ['AGENTS.md'] : [];
    const fixed = new Map(out.map(file => [file.path, { context: file.context, kind: file.kind, why: file.why }]));
    const second = run({ path: VIRTUAL_START, text: imports.map(rel => `@${rel}\n`).join('') }, fixed);
    const realReach = new Map(out.map(file => [file.path, file.reach]));
    const reached = second.out.filter(file => file.path !== VIRTUAL_START && file.reach !== 'none' && (realReach.get(file.path) ?? 'none') === 'none')
      .map(file => ({ path: file.path, steps: file.steps }));
    virtualStart = { path: VIRTUAL_START, imports, reached };
  }

  const bySteps = new Map();
  for (const file of out) {
    if (file.steps == null) continue;
    const row = bySteps.get(file.steps) || { steps: file.steps, files: 0, tokens: 0 };
    row.files += 1;
    row.tokens += file.tokens;
    bySteps.set(file.steps, row);
  }
  const count = test => out.filter(test).length;
  const map = {
    rules: MAP_RULES,
    totals: {
      files: out.length,
      contextFiles: count(f => f.context),
      start: count(f => f.reach === 'start'),
      byPath: count(f => f.reach === 'path'),
      none: count(f => f.reach === 'none'),
      noneContext: count(f => f.reach === 'none' && f.context),
      brokenLinks: broken.length,
      maxSteps: out.reduce((max, f) => Math.max(max, f.steps ?? 0), 0),
      bySteps: [...bySteps.values()].sort((a, b) => a.steps - b.steps)
    },
    files: out,
    broken,
    folderMentions,
    virtualStart
  };
  return { map, contextFiles: report.contextFiles, contextRules: report.contextRules };
}
