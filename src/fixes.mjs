// Step 11: the fixes, one for each root cause, 10 at most. A pure function: no model call, no file read.
// The causes (see "Change 3" of the step 11 failure list):
// - `root`: the project has no start file of its own. One fix for the new file and the lost files under it.
// - `no-route`: the lost files that one link brings in (one gap). 2 or more gaps in one folder are one fix for the folder.
// - `told`: a fact that the user typed and that no file with a route holds.
// - `searched`: the files with a route that the agent searched, grouped by the file (or the line) that links them.
//   A linker that the agent does not read first (2 or more steps from the start, or a file that only a folder link
//   reaches, such as a dated record) is not the place for the fix: all its files are one fix, a link from the start file.
// - `one-source`: a fact with different values, when each of its places is a named file.
// Left out by rule: each copy of a fact, each far file, the unused files. `left` counts what the rules leave out.
// Step 12: `question` is the question of the page that the fix answers. `find`: the agent cannot find the file or the
// fact from what it reads (root, no-route, one-source, a link text or a trigger description that does not say when).
// `close`: the file has a route, but no link by name near the start (a folder link, a far linker, a linker that is
// not named). `told`: a rule that the user typed. A task fact is not in `found.told`, so it gets no fix.
// The page and the prompt both read `fixes.list`, so they show the same texts.
import { START_WHAT } from './collect.mjs';
import { isNamed } from './context-files.mjs';
import { foundFiles } from './found.mjs';
import { fixContext } from './health.mjs';

export const FIX_LIMIT = 10;
export const KINDS = ['root', 'no-route', 'told', 'searched', 'one-source'];
export const QUESTIONS = ['find', 'close', 'told'];
// A long list of files in a fix text: the files with the most needs, then "and N more".
const MAX_NAMES = 5;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const num = value => value.toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const folderOf = rel => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const short = text => String(text ?? '').replace(/[.!?]+$/, '');
// `items`: [{ path, n, line }]. The text of each: the path, its line when known, and its count (`unit`: need or search).
function names(items, unit, withLine = false) {
  // `search`: the times that the agent got the file with no link (a search, a path from the user, or nothing that named it).
  const count = n => (unit === 'search' ? plural(n, 'time') : plural(n, unit));
  const list = items.slice(0, MAX_NAMES).map(item => `${item.path} (${withLine && item.line != null ? `line ${item.line}, ` : ''}${count(item.n)})`);
  return `${list.join(', ')}${items.length > MAX_NAMES ? `, and ${num(items.length - MAX_NAMES)} more` : ''}`;
}

export function buildFixes(model) {
  const empty = { limit: FIX_LIMIT, total: 0, list: [], smaller: [], left: { copies: 0, notNamed: 0 } };
  if (!model.routes?.intents?.length) return empty;
  const ctx = fixContext(model);
  const found = model.health.parts.found;
  const start = ctx.start.path;
  const startRef = ctx.startRef;
  const startPaths = new Set(model.startLoad.filter(item => START_WHAT.has(item.what)).map(item => item.path));
  // A file that the tool can tell the agent to edit: a named context file, or a start load file that is not on the map.
  const named = rel => (ctx.mapFiles.has(rel) ? isNamed(ctx.mapFiles.get(rel)) : startPaths.has(rel));
  const fixes = [];
  // `question` of a searched fix is the last argument. Each other kind has one question.
  const QUESTION = { root: 'find', 'no-route': 'find', told: 'told', 'one-source': 'find' };
  const add = (kind, needs, files, target, line, text, question = QUESTION[kind]) =>
    fixes.push({ kind, needs, files, target, line: line ?? null, text: text.replace(/[\u2013\u2014]/g, '-'), question });

  // ----- root: the new start file, and the lost files under it -----
  if (found.root) {
    const root = found.root;
    const files = root.files.map(file => ({ path: file.path, n: file.uses }));
    add('root', root.uses, files.map(file => file.path), root.path, null, `${root.fix} ${root.why}` +
      (files.length ? ` It covers ${plural(files.length, 'needed file')} with no route (${plural(root.uses, 'need')}): ${names(files, 'need')}.` : ''));
  }

  // ----- no-route: one group for each gap, then one fix for a folder with 2 or more gaps -----
  const groups = new Map();
  for (const item of found.lost) {
    if (item.underRoot) continue;
    const group = groups.get(item.gap) || { gap: item.gap, uses: 0, files: [], where: ctx.place(item.gap) };
    group.uses += item.uses;
    group.files.push(item);
    groups.set(item.gap, group);
  }
  const folders = new Map();
  for (const group of groups.values()) {
    const folder = group.where.kind === 'start' ? folderOf(group.gap) : '';
    const key = folder ? `folder\u0000${folder}` : `gap\u0000${group.gap}`;
    folders.set(key, [...(folders.get(key) || []), group]);
  }
  for (const [key, list] of folders) {
    const files = list.flatMap(group => group.files).map(item => ({ path: item.path, n: item.uses, why: item.why }))
      .sort((a, b) => b.n - a.n || cmp(a.path, b.path));
    const uses = files.reduce((total, file) => total + file.n, 0);
    const paths = files.map(file => file.path);
    if (list.length >= 2) {
      const folder = key.split('\u0000')[1];
      add('no-route', uses, paths, start, null, `Write one index file in the folder ${folder}/ (for example ${folder}/index.md), and link it from ${startRef}. ` +
        `In the index, name each file and say when to read it. It covers ${plural(files.length, 'needed file')} with no route (${plural(uses, 'need')}): ${names(files, 'need')}.`);
      continue;
    }
    const [group] = list;
    const where = group.where;
    const target = named(where.target) || where.kind === 'memory' ? where.target : start;
    const text = files.length === 1 && files[0].path === group.gap ? `${where.text} ${plural(uses, 'intent')} needed it. ${files[0].why}`
      : `${where.text} It gives a route to ${plural(files.length, 'needed file')} (${plural(uses, 'need')}): ${names(files, 'need')}.`;
    add('no-route', uses, paths, target, target === where.target ? where.line : null, text);
  }

  // ----- told: a fact that the user typed. No fix for a fact that a file with a route holds now (`found.saved`) -----
  const lostPaths = new Set(found.lost.map(item => item.path));
  for (const item of found.told) {
    const said = `The user typed it ${plural(item.uses, 'time')}.`;
    // The file that holds the fact is a lost file too: its `no-route` fix (or the root fix) is the one fix of this cause.
    if (item.savedPath && lostPaths.has(item.savedPath)) continue;
    if (item.savedPath) {
      const where = ctx.place(item.savedPath);
      const target = named(where.target) || where.kind === 'memory' ? where.target : start;
      add('told', item.uses, [], target, target === where.target ? where.line : null,
        `The fact "${short(item.text)}" is in ${item.savedPath} now, but that file has no route from the start. ${where.text} ${said}`);
    } else {
      add('told', item.uses, [], start, null, `Add this fact to ${startRef}, or to a file that it links: "${short(item.text)}". ${said}`);
    }
  }

  // ----- searched: the files with a route that the agent searched, grouped by what links them -----
  const searched = foundFiles(model, ctx).filter(file => file.state === 'searched');
  // A linker is a good place for a fix when the agent reads it first: a start file, or a file 1 step away that a
  // file names (no folder link and no trigger on its route).
  const near = rel => {
    if (startPaths.has(rel)) return true;
    const file = ctx.mapFiles.get(rel);
    return Boolean(file) && file.steps != null && file.steps <= 1 && !file.route.some(step => step.via === 'folder' || step.via === 'trigger');
  };
  const byCause = new Map();
  for (const file of searched) {
    const linker = file.linker;
    const linkerNamed = linker && (linker.path == null || linker.named || named(linker.path));
    const key = !linker ? 'none'
      : linker.via === 'trigger' ? `trigger\u0000${file.path}`
        : !linkerNamed ? `other\u0000${linker.path}`
          : linker.path != null && !near(linker.path) ? 'far'
          : linker.via === 'folder' ? `folder\u0000${linker.path}\u0000${linker.line}`
            : `link\u0000${linker.path}`;
    byCause.set(key, [...(byCause.get(key) || []), file]);
  }
  for (const [key, list] of byCause) {
    const [how, from] = key.split('\u0000');
    const files = list.map(file => ({ path: file.path, n: file.searched, line: file.linker?.line ?? null }))
      .sort((a, b) => b.n - a.n || cmp(a.path, b.path));
    const n = files.reduce((total, file) => total + file.n, 0);
    const paths = files.map(file => file.path);
    const times = `The agent got ${list.length === 1 ? 'it' : 'them'} with no link ${plural(n, 'time')} (a search, a path from the user, or a read with nothing that named the file).`;
    const one = files.length === 1;
    if (how === 'trigger' && named(paths[0])) {
      add('searched', n, paths, paths[0], null, `${paths[0]} loads behind a trigger. Make the description of its skill, command or agent say when to use it. ${times}`, 'find');
    } else if (how === 'folder') {
      const line = list[0].linker.line;
      const folder = folderOf(paths[0]);
      add('searched', n, paths, from, line, `${from}${line == null ? '' : ` (line ${line})`} links only the folder ${folder}/, so no link names the files in it. ` +
        `Name ${one ? 'this file' : 'these files'} there, or link an index of the folder, and say when to read ${one ? 'it' : 'each'}: ${names(files, 'search')}. ${times}`, 'close');
    } else if (how === 'link') {
      const lines = [...new Set(files.map(file => file.line))];
      add('searched', n, paths, from, lines.length === 1 ? lines[0] : null,
        one ? `In ${from}${files[0].line == null ? '' : ` (line ${files[0].line})`}, make the link text of ${paths[0]} say what the file holds and when to read it. ${times}`
          : `In ${from}, make the link text of each file say what the file holds and when to read it: ${names(files, 'search', true)}. ${times}`, 'find');
    } else if (how === 'far') {
      add('searched', n, paths, start, null, `Link ${one ? 'this file' : 'these files'} from ${startRef}, or from an index file that it links by name, with one line ${one ? '' : 'each '}that says when to read it: ${names(files, 'search')}. ` +
        `Today only ${one ? 'a file' : 'files'} that the agent does not read first ${one ? 'names it' : 'name them'} (a file 2 or more steps from the start, or a file that only a folder link reaches). ${times}`, 'close');
    } else {
      // The linker is not a named file (or the map names no linker): the link goes into the start file.
      const today = how === 'other' ? ` ${from} names ${one ? 'it' : 'them'} today, but that file is not an instruction file, so do not change it.` : '';
      add('searched', n, paths, start, null, `Link ${one ? 'this file' : 'these files'} from ${startRef}, with one line ${one ? '' : 'each '}that says when to read it: ${names(files, 'search')}.${today} ${times}`, 'close');
    }
  }

  // ----- one-source: a fact with different values, when each place is a named file -----
  const facts = model.health.parts.oneSource.facts || [];
  let notNamed = 0;
  for (const fact of facts) {
    if (!fact.differ) continue;
    if (!fact.places.every(place => named(place.path))) { notNamed += 1; continue; }
    const places = fact.places.slice(0, MAX_NAMES).map(place => `${place.path}: "${place.quote}"`).join('; ') +
      (fact.places.length > MAX_NAMES ? `; and ${num(fact.places.length - MAX_NAMES)} more` : '');
    add('one-source', fact.needed, [], fact.keep, null,
      `Make the files agree on "${short(fact.what)}": ${places}. Ask the user which value is right, keep it only in ${fact.keep}, and link to it from the others.`);
  }

  fixes.sort((a, b) => b.needs - a.needs || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || cmp(a.target, b.target) ||
    cmp(a.files[0] ?? '', b.files[0] ?? '') || cmp(a.text, b.text));
  const all = fixes.map((fix, k) => ({ id: `x${k + 1}`, ...fix }));
  return { limit: FIX_LIMIT, total: all.length, list: all.slice(0, FIX_LIMIT), smaller: all.slice(FIX_LIMIT),
    left: { copies: facts.filter(fact => !fact.differ).length, notNamed } };
}
