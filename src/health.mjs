// Step 9b: the health score of the context. A pure function: no model call, no file read.
// It reads routes (the needs of each intent), needs (the facts the user had to tell), map and duplicates.
//
// Total = 50% Found + 30% Close + 20% One source, each 0 to 100.
// - Found: needs with a map route from the start load, of all file needs (not gone) plus the missing needs.
// - Close: the mean value of the same needs. 0 or 1 step = 1, then half for each more step. No route or missing = 0.
// - One source: the mean value of the file needs. A file with a fact that another file gives with a different
//   value = 0. A file with a copy of a fact (same value) = 0.5. Else 1.
// Each need counts, so a file needed by 4 intents weighs 4. The map steps describe the context, so the score
// moves when the context changes, also on the same recorded sessions.
//
// Step 10: each why and each fix comes from the real state of the file on the map (`fixContext`). The prompt uses
// the same texts. A told fact that a file with a route holds now counts as a need for that file. `health.data`
// says how much data the score has.
// Step 11: `health.counts` holds the 5 counts of the page. The old parts stay for comparison. `place()` of `fixContext`
// gives the file to edit (`target`, `line`), and a folder hint comes only from a named file.
import { START_WHAT } from './collect.mjs';
import { isNamed } from './context-files.mjs';
import { foundFiles } from './found.mjs';
import { buildV1 } from './score-v1.mjs';

export const WEIGHTS = { found: 50, close: 30, oneSource: 20 };
export const METHOD = 'Total = 50% Found + 30% Close + 20% One source. Found = needs with a route from the start load, of all needs (a fact you had to type counts as a need with no route, until a file with a route holds it). ' +
  'Close = mean of 1 at 0 or 1 step, 0.5 at 2 steps, 0.25 at 3 steps (half for each more step), 0 with no route. ' +
  'One source = mean of 1 for a needed file with no copied fact, 0.5 for a file with a copy, 0 for a file whose fact has a different value in another file.';
// Thin data: fewer analysed sessions or fewer counted needs than these limits.
export const THIN_SESSIONS = 5;
export const THIN_NEEDS = 20;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const closeValue = steps => (steps == null ? 0 : steps <= 1 ? 1 : 0.5 ** (steps - 1));
const pct = (sum, n) => (n ? (100 * sum) / n : null);
const round = value => (value == null ? null : Math.round(value));
const labelOf = value => (value == null ? null : value >= 80 ? 'good' : value >= 50 ? 'mixed' : 'poor');
const num = value => value.toLocaleString('en-US');
const count = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const isOutside = rel => rel.startsWith('~/') || rel.startsWith('/');
const MEMORY_PATH = /^~\/\.claude\/projects\/[^/]+\/memory\//;

function reasonOf(model) {
  if (!model.sessions.list.length) return 'no-sessions';
  if (!model.intents.totals.ok) return 'not-analysed';
  return 'no-needs';
}

// ---------- the start file ----------

// The project instruction file of the start load: CLAUDE.md, or AGENTS.md when Claude Code reads it in place of
// CLAUDE.md. With none, the file that the project can create (`map.virtualStart.path`), and `exists` is false.
export function startFileOf(model) {
  const item = model.startLoad.find(entry => entry.scope === 'project' && entry.what === 'instructions');
  if (item) return { path: item.path, exists: true };
  return { path: model.map.virtualStart?.path ?? 'CLAUDE.md', exists: false };
}

// How a text names the start file. A file that is not there yet is "the new CLAUDE.md" (R1).
export const startRefOf = start => (start.exists ? start.path : `the new ${start.path}`);

// ---------- the real state of a file, and its fix ----------

// The needs that count: the file needs of the routes (not gone) and the missing needs.
function needsOf(model) {
  return {
    needs: model.routes.intents.flatMap(intent => intent.needs),
    missing: model.needs.sessions.flatMap(entry => entry.intents.flatMap(intent => intent.needs.filter(need => need.kind === 'missing')))
  };
}

// What health and the prompt know about each file. Both use it, so both give the same fix for a file (F11).
export function fixContext(model) {
  const mapFiles = new Map(model.map.files.map(file => [file.path, file]));
  const start = startFileOf(model);
  const startRef = startRefOf(start);
  const startPaths = new Set(model.startLoad.filter(item => START_WHAT.has(item.what)).map(item => item.path));
  // The steps of a path: from the map. A start load file that is not on the map (`~/.claude/CLAUDE.md`) has 0 steps.
  // A path that is not on the map and not in the start load has no route.
  const stepsOf = rel => {
    const file = mapFiles.get(rel);
    if (file) return file.steps;
    return startPaths.has(rel) ? 0 : null;
  };
  const linkersOf = rel => [...new Set((mapFiles.get(rel)?.linkedFrom || []).map(item => item.path))].sort(cmp);

  // The gap of a file with no route: the file to link. Walk up `linkedFrom`, the first linker by path each time.
  // A file with no linker is its own gap. A walk that comes back to a file it saw is a cycle: the gap is the
  // first file of the cycle by path, so each file of the cycle gets the same gap (F5, F6).
  const gapOf = rel => {
    const chain = [rel];
    for (;;) {
      const next = linkersOf(chain.at(-1))[0];
      if (next == null) return chain.at(-1);
      const at = chain.indexOf(next);
      if (at >= 0) return chain.slice(at).sort(cmp)[0];
      chain.push(next);
    }
  };

  // A project file near the start that names the folder of `gap`, or a folder above it, as plain text: the place for
  // the link (F10). Near the start: 0 or 1 step, and not behind a trigger. A link in a file that is further away gives
  // a long route, so the start file is the better place then.
  // The order: the source with the fewest steps. Then a source that a file names (a source that only a folder
  // link reaches is a file that nothing names). Then the nearest folder, then by path and line.
  const depth = folder => folder.split('/').length;
  const nearStart = file => file != null && file.steps != null && file.steps <= 1 && file.route[0]?.via !== 'trigger';
  const mentions = (model.map.folderMentions || [])
    // Step 11: the tool tells the agent to edit only a named file, so a file that is only linked gives no hint.
    .filter(item => !isOutside(item.source) && nearStart(mapFiles.get(item.source)) && isNamed(mapFiles.get(item.source)))
    .map(item => ({ ...item, steps: mapFiles.get(item.source).steps, byFolder: mapFiles.get(item.source).route.some(step => step.via === 'folder') ? 1 : 0 }))
    .sort((a, b) => a.steps - b.steps || a.byFolder - b.byFolder || depth(b.folder) - depth(a.folder) || cmp(a.source, b.source) || a.line - b.line);
  const hintOf = gap => (isOutside(gap) ? null : mentions.find(item => gap.startsWith(`${item.folder}/`)) || null);
  const hintKey = hint => `${hint.source}\u0000${hint.line}\u0000${hint.folder}`;

  // The lost files: the needed files with no route, with their uses and how the sessions got them.
  const { needs } = needsOf(model);
  const lost = new Map();
  for (const need of needs) {
    if (stepsOf(need.path) != null) continue;
    const item = lost.get(need.path) || { path: need.path, uses: 0, told: 0, search: 0 };
    item.uses += 1;
    if (need.route[0]?.how === 'user') item.told += 1;
    if (need.route[0]?.how === 'search' || need.state === 'search') item.search += 1;
    lost.set(need.path, item);
  }
  for (const item of lost.values()) item.gap = gapOf(item.path);
  // The gaps that share one folder mention. With 2 or more, the folder name cannot be the link to each of them.
  const hintUsers = new Map();
  for (const gap of new Set([...lost.values()].map(item => item.gap))) {
    const hint = hintOf(gap);
    if (hint) hintUsers.set(hintKey(hint), (hintUsers.get(hintKey(hint)) || new Set()).add(gap));
  }

  // Where the link to `gap` goes, in one sentence. `kind` says what the sentence needs. `target` and `line` (step 11)
  // name the file to edit: the start file, the memory index, or a named file near the start that names the folder.
  const memoryIndex = model.startLoad.find(item => item.what === 'memory')?.path ?? null;
  const place = gap => {
    if (!mapFiles.has(gap) && isOutside(gap)) {
      return { kind: 'outside', target: start.path, line: null, text: `Name the full path of ${gap} in ${startRef}, with one line that says when to read it. The map does not count a link to a file outside the project.` };
    }
    // A memory file: Claude Code loads the first 200 lines of the index MEMORY.md, so the link goes there.
    if (MEMORY_PATH.test(gap)) {
      return { kind: 'memory', target: memoryIndex ?? gap.replace(/\/memory\/.*$/, '/memory/MEMORY.md'), line: null, text: `Add a line with a link to ${gap} to the memory index (MEMORY.md in the memory folder of the project), in its first 200 lines.` };
    }
    const hint = hintOf(gap);
    if (hint) {
      // The folder name can be the link when it names the folder of the gap, and no other gap needs the same name.
      const shared = [...(hintUsers.get(hintKey(hint)) || [])].some(other => other !== gap);
      const own = gap.slice(0, gap.lastIndexOf('/')) === hint.folder;
      return { kind: 'mention', target: hint.source, line: hint.line, text: own && !shared ? `In ${hint.source} (line ${hint.line}), make the folder name a link to ${gap}.`
        : `In ${hint.source} (line ${hint.line}), add a link to ${gap} next to the folder name ${hint.folder}.` };
    }
    return { kind: 'start', target: start.path, line: null, text: `Link ${gap} from ${startRef}, with one line that says when to read it.` };
  };

  // Why a file has no route, from its state on the map (F3, F4, F9).
  const whyOf = (rel, gap) => {
    if (!mapFiles.has(rel) && isOutside(rel)) return 'It is outside the project, so the map has no route to it.';
    const linker = linkersOf(rel)[0];
    if (linker == null) return 'No file links to it.';
    return `No file on a route links to it. ${linker} links it, but that file has no route.` +
      (gap !== linker && gap !== rel ? ` The chain of links starts at ${gap}.` : '');
  };

  // The fix of a far file: a direct link from the start file.
  const farFix = uses => (uses >= 2 ? `Link it from ${startRef}, so it is 1 step from the start.`
    : `Needed by 1 intent. Link it from ${startRef} only if this task comes back.`);

  return { mapFiles, start, startRef, stepsOf, gapOf, place, whyOf, farFix, lost, inProject: rel => !isOutside(rel) };
}

// ---------- Found ----------

function found(ctx, model, needs, missing) {
  const counted = needs.length + missing.length;
  const virtual = model.map.virtualStart;
  const reachedSteps = new Map((virtual?.reached || []).map(item => [item.path, item.steps]));
  const groupUses = new Map();
  for (const item of ctx.lost.values()) groupUses.set(item.gap, (groupUses.get(item.gap) || 0) + item.uses);

  const lostItems = [...ctx.lost.values()]
    .sort((a, b) => groupUses.get(b.gap) - groupUses.get(a.gap) || cmp(a.gap, b.gap) || b.uses - a.uses || cmp(a.path, b.path))
    .map(item => {
      const where = ctx.place(item.gap);
      // The root item: the new start file brings the file in, or the fix of the file needs the new start file.
      const brought = virtual ? (virtual.imports.length ? reachedSteps.has(item.path) : where.kind === 'start') : false;
      const steps = reachedSteps.get(item.path) ?? null;
      const rootFix = !brought ? null
        : virtual.imports.length ? `${steps === 0 ? `The new ${virtual.path} loads it at the start.` : `The new ${virtual.path} gives it a route of ${count(steps, 'step')}.`} See the first fix.`
          : `Link ${item.gap === item.path ? 'it' : item.gap} from the new ${virtual.path}. See the first fix.`;
      return {
        path: item.path, uses: item.uses, cost: item.uses,
        why: ctx.whyOf(item.path, item.gap) + (item.told ? ` You had to give the path ${item.told === 1 ? '1 time' : `${num(item.told)} times`}.`
          : item.search ? ' The agent found it by a search.' : ''),
        fix: rootFix ?? where.text,
        gap: item.gap, underRoot: brought
      };
    });

  // The root item: a project with no start file of its own. One new file is the first fix.
  let root = null;
  if (virtual) {
    const files = lostItems.filter(item => item.underRoot)
      .map(item => ({ path: item.path, uses: item.uses, steps: reachedSteps.get(item.path) ?? null }))
      .sort((a, b) => b.uses - a.uses || cmp(a.path, b.path));
    const lines = virtual.imports.map(rel => `\`@${rel}\``).join(' and ');
    root = {
      path: virtual.path, imports: virtual.imports, uses: files.reduce((total, file) => total + file.uses, 0), files,
      why: virtual.imports.length
        ? `No project instruction file loads at the start: the project has no ${virtual.path}, and Claude Code does not load ${virtual.imports.join(', ')} here.`
        : `No project instruction file loads at the start: the project has no ${virtual.path} and no AGENTS.md.`,
      fix: virtual.imports.length ? `Create ${virtual.path} with the line ${lines}.`
        : files.length ? `Create ${virtual.path}. Link each lost file from it, with one line that says when to read it.`
          : `Create ${virtual.path}. Put the rules of the project in it, and link the files that the agent needs.`
    };
  }

  // The facts the user had to tell. A fact that a file with a route holds now is a need for that file: it is reached (S7).
  const told = new Map();
  const saved = new Map();
  for (const need of missing) {
    const text = squash(need.text);
    const savedPath = need.savedPath ?? null;
    const steps = savedPath ? ctx.stepsOf(savedPath) : null;
    const key = `${text}\u0000${savedPath ?? ''}`;
    if (steps != null) {
      const item = saved.get(key) || { text, quote: squash(need.quote) || null, uses: 0, path: savedPath, steps, savedQuote: squash(need.savedQuote) || null };
      item.uses += 1;
      saved.set(key, item);
    } else {
      const item = told.get(key) || { text, quote: squash(need.quote) || null, uses: 0, savedPath };
      item.uses += 1;
      told.set(key, item);
    }
  }
  const byUses = (a, b) => b.uses - a.uses || cmp(a.text, b.text) || cmp(a.path ?? a.savedPath ?? '', b.path ?? b.savedPath ?? '');
  const toldItems = [...told.values()].sort(byUses).map(item => ({
    text: item.text, quote: item.quote, uses: item.uses, cost: item.uses,
    // S6: the fact is in a file now, but that file has no route. The fix says where it is and where the link goes.
    fix: item.savedPath ? `The fact is in ${item.savedPath} now, but that file has no route from the start. ${ctx.place(item.savedPath).text}`
      : 'Write this fact in the file the agent reads for this task.',
    savedPath: item.savedPath
  }));
  const savedItems = [...saved.values()].sort(byUses);

  const lostFiles = lostItems.length;
  const toldFacts = toldItems.length;
  const answer = !counted ? null
    : !lostFiles && !toldFacts ? 'Yes'
      : [lostFiles ? count(lostFiles, 'file lost', 'files lost') : null, toldFacts ? count(toldFacts, 'fact told by you', 'facts told by you') : null].filter(Boolean).join(', ');
  const reached = needs.filter(need => ctx.stepsOf(need.path) != null).length + savedItems.reduce((total, item) => total + item.uses, 0);
  return { score: pct(reached, counted), counted, reached, answer, lost: lostItems, told: toldItems, root, saved: savedItems };
}

// ---------- Close ----------

// `placed`: one entry for each need that has a place: { path, steps }. The file needs, and the told facts that a file
// with a route holds now. `counted` also has the told facts with no file: they count 0.
function close(ctx, placed, counted) {
  const sum = placed.reduce((total, need) => total + closeValue(need.steps), 0);
  const far = new Map();
  for (const need of placed) {
    if (need.steps == null || need.steps <= 1) continue;
    const item = far.get(need.path) || { path: need.path, uses: 0, steps: need.steps };
    item.uses += 1;
    far.set(need.path, item);
  }
  const items = [...far.values()].map(item => {
    const route = ctx.mapFiles.get(item.path)?.route.map(entry => entry.path) || [];
    return { path: item.path, uses: item.uses, steps: item.steps, route, cost: item.uses * (1 - closeValue(item.steps)), fix: ctx.farFix(item.uses) };
  }).sort((a, b) => b.cost - a.cost || cmp(a.path, b.path));
  const oneStep = placed.filter(need => need.steps != null && need.steps <= 1).length;
  // The needs that count 0 here because they have no route: the lost file needs and the facts told by the user.
  const noRoute = counted - placed.filter(need => need.steps != null).length;
  const parts = [items.length ? count(items.length, 'file far', 'files far') : null,
    noRoute ? (noRoute === 1 ? '1 need has no route' : `${num(noRoute)} needs have no route`) : null].filter(Boolean);
  return { score: pct(sum, counted), counted, oneStep, answer: !counted ? null : parts.length ? parts.join(', ') : 'Yes', far: items, noRoute };
}

// ---------- One source ----------

function oneSource(needs, duplicates, mapFiles) {
  const uses = new Map();
  for (const need of needs) uses.set(need.path, (uses.get(need.path) || 0) + 1);
  // The worst state of each file: 0 when a fact of it has a different value somewhere, 0.5 for a copy.
  const worst = new Map();
  for (const fact of duplicates.facts) {
    const value = fact.differ ? 0 : 0.5;
    for (const place of fact.places) worst.set(place.path, Math.min(worst.get(place.path) ?? 1, value));
  }
  const counted = needs.length;
  const sum = needs.reduce((total, need) => total + (worst.get(need.path) ?? 1), 0);
  const items = duplicates.facts.map(fact => {
    const needed = fact.places.reduce((total, place) => total + (uses.get(place.path) || 0), 0);
    // Keep the fact in the place that the intents read most. Ties: the place nearer the start, then plain path order.
    const stepsOf = rel => mapFiles.get(rel)?.steps ?? Infinity;
    const keep = [...fact.places].sort((a, b) => (uses.get(b.path) || 0) - (uses.get(a.path) || 0) || stepsOf(a.path) - stepsOf(b.path) || cmp(a.path, b.path))[0].path;
    return { id: fact.id, what: fact.what, differ: fact.differ, source: fact.source, needed, keep,
      places: fact.places.map(place => ({ ...place, uses: uses.get(place.path) || 0 })),
      fix: fact.differ ? `The files do not agree. Choose the right value, keep it only in ${keep}, and link to it from the others.`
        : `Keep it only in ${keep}, and link to it from the others.` };
  }).sort((a, b) => (b.needed > 0) - (a.needed > 0) || (b.differ - a.differ) || b.needed - a.needed || cmp(a.what, b.what));
  const inNeeded = items.filter(item => item.needed > 0);
  const differ = inNeeded.filter(item => item.differ).length;
  const copied = inNeeded.length - differ;
  const answer = !counted ? null
    : !inNeeded.length ? 'Yes'
      : differ && copied ? `${count(differ, 'fact disagrees', 'facts disagree')}, ${copied} copied`
        : differ ? count(differ, 'fact disagrees', 'facts disagree') : count(copied, 'fact copied', 'facts copied');
  const check = duplicates.check;
  const full = check.status === 'ok' || check.status === 'not-needed';
  // L3: how much of the context the model check read. The exact check reads each file.
  const coverage = { checked: check.checked, total: check.total, needed: check.needed, neededChecked: check.neededChecked };
  const partial = check.status === 'ok' && check.checked < check.total;
  const note = !full ? 'Only exact copies are checked. Run with --intents for the full check.'
    : partial ? `The model check read ${num(check.checked)} of ${count(check.total, 'file')}, and ${num(check.neededChecked)} of ${count(check.needed, 'needed file')}. ` +
      'The other files do not fit in one model call, so only their exact copies are checked.'
      : null;
  return { score: pct(sum, counted), counted, answer, checked: full ? 'full' : 'exact-only', note,
    facts: inNeeded, otherFacts: items.filter(item => item.needed === 0), coverage };
}

// ---------- how much data the score has ----------

function dataOf(model, score, needs) {
  const sessions = model.sessions.list.length;
  const analysed = model.intents.sessions.filter(entry => entry.status === 'ok').length;
  const thin = score != null && (analysed < THIN_SESSIONS || needs < THIN_NEEDS);
  const reasons = model.sessions.skipped.map(item => item.reason);
  const skipped = { total: reasons.length, headless: reasons.filter(reason => reason === 'headless').length,
    noUserMessage: reasons.filter(reason => reason === 'no-user-message').length };
  const fixSessions = reasons.filter(reason => reason === 'fix-session').length;
  const parts = [skipped.headless ? `${num(skipped.headless)} headless (run through the SDK)` : null,
    skipped.noUserMessage ? `${num(skipped.noUserMessage)} with no user message` : null,
    fixSessions ? `${num(fixSessions)} from context-health fix` : null].filter(Boolean);
  return {
    sessions, analysed, needs, thin,
    limits: { sessions: THIN_SESSIONS, needs: THIN_NEEDS },
    skipped,
    note: thin ? `Thin data: ${count(analysed, 'analysed session')}${sessions > analysed ? ` of ${num(sessions)} read` : ''} and ${count(needs, 'need')}. The counts can change a lot with more sessions.` : null,
    skippedNote: skipped.total ? `${skipped.total === 1 ? '1 session file was' : `${num(skipped.total)} session files were`} not read${parts.length ? `: ${parts.join(', ')}` : ''}.` : null
  };
}

// ---------- the five counts (step 11) ----------

// Where the link to a searched file is, in one or two sentences. The page shows it for each file of line b.
function searchedWhy(file, startRef) {
  const linker = file.linker;
  if (!linker) return 'The map has a route, but it names no link.';
  const at = linker.line == null ? '' : ` (line ${linker.line})`;
  if (linker.via === 'trigger') return 'It loads behind a trigger. The description of its skill, command or agent must say when to use it.';
  if (linker.via === 'auto') return `It loads by itself when the agent reads a file in its folder (${linker.path}).`;
  if (!linker.named) return `${linker.path}${at} names it, but that file is not an instruction file. Link it from ${startRef}, and say when to read it.`;
  if (linker.via === 'folder') return `${linker.path}${at} links only its folder. The link must name the file and say when to read it.`;
  return `${linker.path}${at} ${linker.via === 'mention' ? 'names' : 'links'} it. The link text must say when to read it.`;
}

// The 5 counts of the page. `reason` is not null when lines a, b and c have no data.
function countsOf(model, ctx, foundPart, reason) {
  const files = foundFiles(model, ctx);
  const none = reason != null;
  const lost = files.filter(file => file.state === 'no-route');
  const searched = files.filter(file => file.state === 'searched')
    .sort((a, b) => b.searched - a.searched || b.uses - a.uses || cmp(a.path, b.path));
  const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);
  const base = none ? null : `of ${count(files.length, 'needed file')}`;
  const facts = foundPart.told.length + foundPart.saved.length;
  const top = model.startLoad.filter(item => item.tokens != null)
    .sort((a, b) => b.tokens - a.tokens || cmp(a.path, b.path) || cmp(a.what, b.what)).slice(0, 3)
    .map(item => ({ path: item.path, what: item.what, tokens: item.tokens }));
  const read = model.sessions.list.length;
  const analysed = model.intents.sessions.filter(entry => entry.status === 'ok').length;
  const reasons = model.sessions.skipped.map(item => item.reason);
  const headless = reasons.filter(item => item === 'headless').length;
  const noUserMessage = reasons.filter(item => item === 'no-user-message').length;
  const other = reasons.length - headless - noUserMessage;
  const total = read + reasons.length;
  const why = [headless ? `${num(headless)} headless skipped` : null, noUserMessage ? `${num(noUserMessage)} with no user message` : null,
    other ? `${num(other)} skipped for another reason` : null, read - analysed ? `${num(read - analysed)} not analysed` : null].filter(Boolean);
  return {
    reason,
    needs: { files: none ? null : files.length, needs: none ? null : sum(files, 'uses') },
    noRoute: { files: none ? null : lost.length, needs: none ? null : sum(lost, 'uses'), of: none ? null : files.length,
      text: none ? 'Needed files with no route: no data' : `${count(lost.length, 'needed file has', 'needed files have')} no route`, base,
      items: lost.map(file => ({ path: file.path, uses: file.uses })) },
    searched: { files: none ? null : searched.length, needs: none ? null : sum(searched, 'searched'), of: none ? null : files.length,
      text: none ? 'Needed files with a route that the agent searched: no data' : `${count(searched.length, 'needed file has', 'needed files have')} a route, but the agent searched`, base,
      items: searched.map(file => ({ path: file.path, uses: file.uses, searched: file.searched, ways: file.ways, steps: file.steps, linker: file.linker,
        why: searchedWhy(file, ctx.startRef) })) },
    told: { facts: none ? null : facts, saved: none ? null : foundPart.saved.length,
      text: none ? 'Facts you had to type: no data' : `${count(facts, 'fact')} you had to type (${num(foundPart.saved.length)} already saved)` },
    startLoad: { tokens: model.totals.startLoadTokens, items: model.totals.startLoadItems, text: `Start load: ${count(model.totals.startLoadTokens, 'token')}`, top },
    sessions: { analysed, total, read, notAnalysed: read - analysed, headless, noUserMessage, other,
      text: `From ${num(analysed)} of ${count(total, 'session')}${why.length ? ` (${why.join(', ')})` : ''}` }
  };
}

// ---------- main ----------

export function buildHealth(model) {
  const ctx = fixContext(model);
  const { needs, missing } = needsOf(model);
  const foundPart = found(ctx, model, needs, missing);
  // Each need that has a place: the file needs, and the told facts that a file with a route holds now.
  const placed = [...needs.map(need => ({ path: need.path, steps: ctx.stepsOf(need.path) })),
    ...foundPart.saved.flatMap(item => Array.from({ length: item.uses }, () => ({ path: item.path, steps: item.steps })))];
  const parts = { found: foundPart, close: close(ctx, placed, foundPart.counted), oneSource: oneSource(needs, model.duplicates, ctx.mapFiles) };
  const have = Object.entries(WEIGHTS).filter(([key]) => parts[key].score != null);
  const weight = have.reduce((total, [, w]) => total + w, 0);
  const total = have.length && parts.found.score != null ? have.reduce((sum, [key, w]) => sum + w * parts[key].score, 0) / weight : null;
  const score = round(total);
  const reason = score == null ? reasonOf(model) : null;
  return {
    method: METHOD,
    weights: WEIGHTS,
    score,
    label: labelOf(score),
    reason: score == null ? reasonOf(model) : null,
    parts: Object.fromEntries(Object.entries(parts).map(([key, part]) => [key, { ...part, score: round(part.score) }])),
    data: dataOf(model, score, foundPart.counted),
    counts: countsOf(model, ctx, foundPart, reason),
    // Step 12: the score of method v1 (src/score-v1.mjs). The command adds the proof.
    v1: buildV1(model, ctx, reasonOf(model))
  };
}
