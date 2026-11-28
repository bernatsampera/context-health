// Render the report as one local HTML page, from the approved ui v4 sketch.
// The page calculates nothing: step 8 (src/routes.mjs, src/prompt.mjs) owns the numbers. This module picks the keys
// the page needs, formats paths, dates and words, and embeds them as one JSON object. The page script
// (src/page/page.js) draws the map and the list from that object and handles the clicks.
import { readFileSync } from 'node:fs';
import { needTest, REASON_TEXT } from './context-files.mjs';
import { ignoreText } from './ignore.mjs';
import { plain } from './prompt.mjs';
import { SKILL_LIST } from './routes.mjs';
import { METHOD, scoreTitle } from './score-v1.mjs';
import { explorationCoverage, explorationEvents } from './sessions.mjs';

export const EXPLORER_MARKER = '<meta name="context-health-explorer" content="folder-map-v2">';

const read = name => readFileSync(new URL(`./page/${name}`, import.meta.url), 'utf8');
const copyMarkdown = read('copy-markdown.html');
const css = read('page.css');
const script = read('page.js');

const esc = value => plain(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const num = value => value.toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Times come from the session files. They are shown in UTC from the ISO text, so TZ does not change the page.
const shortDate = iso => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : '');
const when = iso => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '');
const REASON_SHORT = { 'single-message': 'one message', 'not-selected': 'not selected', 'not-analysed': 'not analysed', failed: 'failed', 'too-long': 'too long' };
const FIRST_CUT = 160;
const LABEL_MAX = 22;

// A short name for a map box. The full path is in the tooltip.
export function shortLabel(rel) {
  if (!rel) return 'Skill and command list';
  if (rel.length <= LABEL_MAX) return rel;
  const parts = rel.split('/');
  const user = rel.startsWith('~/') ? '~ ' : '';
  const base = parts.at(-1);
  const folder = parts.at(-2) || '';
  // A skill body: the name of its folder is the name of the skill.
  if (base === 'SKILL.md' && folder) return `${user}${folder} skill`.length <= LABEL_MAX ? `${user}${folder} skill` : `${user}${folder}`.slice(0, LABEL_MAX);
  if (`${user}${folder}/${base}`.length <= LABEL_MAX) return `${user}${folder}/${base}`;
  // Keep the file name and as much of its folder as fits.
  const room = LABEL_MAX - user.length - base.length - 4;
  if (room >= 3) return `${user}${folder.slice(0, room)}.../${base}`;
  if (`${user}${base}`.length <= LABEL_MAX) return `${user}${base}`;
  return `${base.slice(0, 10)}...${base.slice(-(LABEL_MAX - 13))}`;
}

// The full absolute path of a file, for the copy button. Project files: the project root of the run + the path.
// `~/.claude/` files: the settings home of the run + the rest. Other paths stay as they are (`~/...` or absolute).
export function absolutePath(model, rel) {
  if (!rel) return null;
  if (rel.startsWith('~/.claude/')) return `${model.claudeSettingsHome}/${rel.slice('~/.claude/'.length)}`;
  if (rel.startsWith('~/') || rel.startsWith('/')) return rel;
  return `${model.project.root}/${rel}`;
}

// Replace each en dash and em dash in the data with a plain hyphen.
const plainDeep = value => {
  if (typeof value === 'string') return plain(value);
  if (Array.isArray(value)) return value.map(plainDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainDeep(v)]));
  return value;
};

const firstUser = session => session.messages.find(message => message.kind === 'user') || session.messages[0];

// A message as a person wrote it: no paste marks, no image marks, one line.
const cleanMessage = text => text.replace(/<\/?pasted_content\b[^>]*>?/g, ' ').replace(/\[Image[^\]]*\]/g, ' ').replace(/^[\s❯>]+/, '').replace(/\s+/g, ' ').trim();
const cutAt = (text, size) => (text.length > size ? `${text.slice(0, size).trimEnd()}...` : text);
const TEMP = /^(?:\/private)?\/(?:tmp|var\/folders)\//;

// The overview of a session: its title, what was asked and what the agent said it did, and the files that changed.
// The steps are the intents. With no intents, the steps are the user messages. No model call: all of it is in the session file.
export function sessionOverview({ session, entry, groupOf }) {
  const answerIn = (from, to) => session.answers.findLast(item => item.message >= from && item.message <= to)?.text ?? null;
  const textOf = n => { const message = session.messages[n - 1]; return message ? cleanMessage(message.text) : ''; };
  const users = session.messages.filter(message => message.kind === 'user');
  const steps = entry?.status === 'ok' && entry.intents.length
    ? entry.intents.map(intent => {
      const first = users.find(message => message.n >= intent.from && message.n <= intent.to);
      return { goal: intent.goal, you: first ? textOf(first.n) : '', did: answerIn(intent.from, intent.to), group: groupOf(session.sessionId, intent.id) };
    })
    : users.map((message, k) => ({ goal: cutAt(textOf(message.n), 140) || 'Image', you: '', did: answerIn(message.n, (users[k + 1]?.n ?? session.messages.length + 1) - 1), group: null }));
  const edited = [...new Set(session.events.filter(event => event.kind === 'edit' && event.path && !TEMP.test(event.path)).map(event => event.path))];
  const first = users.map(message => textOf(message.n)).find(Boolean);
  const message = firstUser(session);
  const text = message ? message.text.replace(/\s+/g, ' ').trim() : '';
  return { first: text.length > FIRST_CUT || message?.cut ? `${text.slice(0, FIRST_CUT).trimEnd()}...` : text,
    title: session.title ?? cutAt(first || 'Session', 80), start: session.startedAt, end: session.endedAt, asked: users.length, steps, edited };
}

const parentFolder = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';

function rememberParents(folders, path) {
  let folder = parentFolder(path);
  while (!folders.has(folder)) {
    folders.add(folder);
    folder = parentFolder(folder);
  }
}

// Keep the outcome recorded by the tool: a successful search may return only source
// files outside the context map. Hiding those paths must not turn it into an empty search.
function sessionExploration(session, inventory) {
  const opened = new Set();
  const lookups = new Map();
  const events = explorationEvents(session);
  // Old shell events kept the operand but did not distinguish a file from a folder.
  // A descendant in the evidence proves it was a folder even if it has since moved.
  const observedFolders = new Set(['.']);
  for (const event of events) {
    if (event.kind === 'read') rememberParents(observedFolders, event.path);
    else for (const path of event.resultPaths) rememberParents(observedFolders, path);
  }
  for (const event of events) {
    if (event.kind === 'read') {
      if (inventory.contextPath(event.path)) opened.add(event.path);
      continue;
    }
    const target = event.target.replace(/\/+$/, '') || '.';
    const folderTarget = event.targetKind === 'folder' || (event.targetKind !== 'file' &&
      (inventory.knownFolders.has(target) || observedFolders.has(target)));
    const folder = folderTarget ? target : parentFolder(target);
    const resultPaths = [...new Set(event.resultPaths.map(path => path.replace(/\/+$/, ''))
      .filter(path => inventory.folders.has(path) || inventory.contextPath(path)))].sort();
    const { operation, query, outcome } = event;
    const key = JSON.stringify([operation, target, folder, query, outcome, resultPaths]);
    const existing = lookups.get(key);
    if (existing) existing.count++;
    else lookups.set(key, { operation, target, folder, query, outcome, resultPaths, count: 1 });
  }
  let coverage = explorationCoverage(session);
  if (coverage !== 'recorded' && !lookups.size) coverage = opened.size ? 'reads-only' : 'unavailable';
  return { opened: [...opened], lookups: [...lookups.values()], coverage };
}

// A folder link gives a possible route to everything below it. A file reference
// is narrower: the source actually names, links to or imports that file.
function fileReferences(files, paths) {
  const references = [];
  for (const file of files) {
    if (!paths.has(file.path)) continue;
    const sources = new Set();
    for (const link of file.linkedFrom || []) {
      if (['link', 'mention', 'import'].includes(link.via) && paths.has(link.path)) sources.add(link.path);
    }
    for (const from of sources) references.push({ from, to: file.path });
  }
  return references;
}

// The object the page script reads.
export function pageData(model) {
  const routes = model.routes;
  const mapFiles = new Map(model.map.files.map(file => [file.path, file]));
  const nodes = [...routes.map.nodes];
  const paths = new Set(nodes.map(node => node.path).filter(Boolean));
  // Saved versions may explicitly include a context file outside the files used for scoring.
  for (const path of model.documents?.keys() || []) {
    if (paths.has(path)) continue;
    paths.add(path);
    nodes.push({ id: path, path, lane: 'none', column: null, row: null, steps: null, tokens: mapFiles.get(path)?.tokens,
      intents: 0, groups: 0, usedBy: { sessions: [], groups: [] } });
  }
  const folders = new Set(['.']);
  for (const path of paths) rememberParents(folders, path);
  const knownFolders = new Set(folders);
  for (const path of mapFiles.keys()) rememberParents(knownFolders, path);
  const { isNeed } = needTest(model);
  const inventory = { folders, knownFolders, contextPath: path => paths.has(path) || (!mapFiles.has(path) && isNeed(path)) };
  const view = entry => ({ files: entry.files, edges: entry.edges, problems: entry.problems });
  const groupsById = new Map(model.groups.list.map(group => [group.id, group]));
  const intentsById = new Map(model.intents.sessions.map(entry => [entry.sessionId, entry]));
  const routesBySession = new Map(routes.bySession.map(entry => [entry.sessionId, entry]));
  const groupOf = (sessionId, intentId) => model.groups.list.find(group => group.members.some(item => item.sessionId === sessionId && item.intentId === intentId))?.id ?? null;
  return plainDeep({
    project: { name: model.project.name, root: model.project.root },
    settingsHome: model.claudeSettingsHome,
    map: {
      columns: routes.map.columns,
      searchFrom: routes.map.searchFrom,
      nodes: nodes.map(node => {
        const file = node.path ? mapFiles.get(node.path) : null;
        return { id: node.id, path: node.path, label: shortLabel(node.path), abs: absolutePath(model, node.path),
          lane: node.lane, column: node.column, row: node.row, steps: node.steps, tokens: node.tokens,
          intents: node.intents, groups: node.groups, usedBy: node.usedBy,
          route: file && file.reach === 'path' ? [...(file.route[0]?.via === 'trigger' ? [SKILL_LIST] : []), ...file.route.map(item => item.path)] : [] };
      }),
      edges: routes.map.edges,
      references: fileReferences(model.map.files, paths)
    },
    groups: routes.byGroup.map(entry => {
      const group = groupsById.get(entry.groupId);
      return { id: entry.groupId, label: group.label, count: group.count, sessions: entry.sessions, weak: entry.weak, told: entry.told, ...view(entry) };
    }),
    sessions: model.sessions.list.map(session => {
      const status = intentsById.get(session.sessionId);
      const entry = routesBySession.get(session.sessionId);
      const reasonShort = status?.status === 'ok' ? (status.intents.length ? null : 'no intents') : REASON_SHORT[status?.status] || 'not analysed';
      return { id: session.sessionId, date: shortDate(session.startedAt), when: when(session.startedAt),
        status: status?.status ?? null, reason: status?.reason ?? null, reasonShort,
        intentCount: entry.intents.length, groups: entry.groups, ...(session.overview || sessionOverview({ session, entry: status, groupOf })),
        exploration: sessionExploration(session, inventory), ...view(entry) };
    }),
    // Review decision D4: the page names each session file that was not read, with its reason.
    skipped: model.sessions.skipped.map(item => ({ folder: item.folder, file: item.file, reason: item.reason })),
    health: model.health,
    fixes: model.fixes,
    // Step 11: the dropped reads, as the base detail shows them.
    dropped: droppedView(model),
    prompt: model.prompt.text
  });
}

// JSON inside a script element: no `<`, `>` or `&`, so no text can close the element or open a new one.
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const ignoredTag = model => (model.ignore?.length ? `<span class="hflag off">Without ${ignoreText(model.ignore)}</span>` : '');

// ---------- the health score (step 12, method v1): one number and four questions; each detail is closed ----------

const QUESTIONS = [
  { key: 'find', title: 'Can the agent find what it needs?' },
  { key: 'close', title: 'Are the needed files close to the start?' },
  { key: 'told', title: 'Did you have to tell the agent?' },
  { key: 'lean', title: 'Is the start load lean?' }
];
const STATE = { 'not-proven': 'Score not proven', thin: 'Not enough data', 'no-data': 'No data' };
const WORDS = ['good', 'mixed', 'poor'];
// The proof grades by the map only, so it has no Searched.
const GRADES = [['served', 'Served'], ['slow', 'Slow'], ['missed', 'Missed']];
// A report with no v1 reason: the reason of the counts (step 11).
const NO_SCORE = {
  'no-sessions': 'No sessions for this project yet.',
  'not-analysed': 'No session is analysed yet. Run with `--intents`.',
  'no-needs': 'The analysed intents read no context file.'
};
const DROPPED_FILES = 10;
const LEFT_OUT_LINES = 12;

// A why or a fix text: escaped, and a span in backticks (a literal line such as `@AGENTS.md`) is a code element.
const rich = value => esc(value).replace(/`([^`]+)`/g, '<code>$1</code>');
// A short list inside an item.
const sub = rows => `<ul class="hsub">${rows.map(row => `<li>${row}</li>`).join('')}</ul>`;
const code = rel => `<code>${esc(rel)}</code>`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const arr = value => (Array.isArray(value) ? value : []);
const count = value => (typeof value === 'number' ? num(value) : 'no data');
const percent = rate => (typeof rate === 'number' ? `${Math.round(rate * 100)}%` : 'no data');

// The dropped reads: the reads of files that are not context files. For each reason, its count, its text and the
// files with the most dropped needs. The page data holds the same object.
export function droppedView(model) {
  const dropped = model.needs?.dropped || { needs: 0, reads: 0, files: 0, byReason: {}, list: [] };
  return { needs: dropped.needs, reads: dropped.reads, files: dropped.files,
    reasons: Object.entries(dropped.byReason).map(([reason, count]) => {
      const files = dropped.list.filter(x => x.reason === reason).sort((a, b) => b.needs - a.needs || b.reads - a.reads || cmp(a.path, b.path));
      return { reason, text: REASON_TEXT[reason] || reason, needs: count.needs, reads: count.reads, files: count.files,
        top: files.slice(0, DROPPED_FILES).map(x => ({ path: x.path, needs: x.needs, reads: x.reads })), more: Math.max(files.length - DROPPED_FILES, 0) };
    }) };
}

// The base of the score: the sessions by reason, then the dropped reads.
function sessionsDetail(model, counts) {
  const other = counts.total - counts.read - counts.headless - counts.noUserMessage;
  const rows = [['analysed', counts.analysed, 'analysed: the score comes from these sessions'],
    ['notAnalysed', counts.notAnalysed, 'not analysed: run with <code>--intents</code> to add them'],
    ['headless', counts.headless, 'headless (run through the SDK): the tool does not read them'],
    ['noUserMessage', counts.noUserMessage, 'with no user message: the tool does not read them'],
    ['other', other, 'not read for another reason']].filter(([key, n]) => n > 0 || key === 'analysed');
  const d = droppedView(model);
  const dropped = !d.reads ? '<p class="hsum">No read was dropped.</p>'
    : `<p class="hsum" data-dropped="${d.reads}"><b>${plural(d.reads, 'read')} of ${plural(d.files, 'file')} ${d.reads === 1 ? 'does' : 'do'} not count as a need.</b> These files are not context files.</p>` +
      `<ul class="hitems">${d.reasons.map(r => `<li class="hi" data-reason="${esc(r.reason)}"><div class="what">${esc(r.text)}: ${plural(r.reads, 'read')} of ${plural(r.files, 'file')}</div>` +
        sub([...r.top.map(x => `${code(x.path)} <span class="m">${plural(x.reads, 'read')} in ${plural(x.needs, 'intent')}</span>`), ...(r.more ? [`<span class="m more">and ${num(r.more)} more</span>`] : [])]) + '</li>').join('')}</ul>`;
  return `<ul class="hlist hsess">${rows.map(([key, n, text]) => `<li data-sessions="${key}"><b>${num(n)}</b><span>${text}</span></li>`).join('')}</ul>${dropped}`;
}

// What the page shows of `health.v1`. A report with no v1 object shows "No data" and the 4 questions with no answer.
function v1View(model) {
  const h = model.health || {};
  const v1 = h.v1 && typeof h.v1 === 'object' ? h.v1 : null;
  const state = v1 && STATE[v1.shown] ? v1.shown : v1?.shown === 'score' && typeof v1.score === 'number' ? 'score' : 'no-data';
  const reason = v1?.shown !== 'score' && STATE[v1?.shown] ? v1?.reason || null
    : state === 'score' ? null : v1?.reason || NO_SCORE[h.counts?.reason] || 'There is no score in this report.';
  const byKey = new Map(arr(v1?.questions).filter(q => q && typeof q === 'object').map(q => [q.key, q]));
  const questions = QUESTIONS.map(q => ({ ...q, answer: null, lines: [], items: [], ...(byKey.get(q.key) || {}), key: q.key }));
  return { v1, state, reason, questions, method: v1?.method || METHOD, base: v1?.base?.text || h.counts?.sessions?.text || '' };
}

// One fix. The number is the place of the fix in `fixes.list` (the prompt has the same order).
function commandDetails(label, id, command) {
  return `<details class="finding-command standalone-only"><summary>${esc(label)}</summary><div class="cmd"><code id="${esc(id)}">${esc(command)}</code><button type="button" class="btn small" data-copy-command="${esc(id)}">Copy command</button></div></details>`;
}

function fixLi(fix, run, sessions, gaps, searches) {
  const id = esc(fix.id);
  const sessionIds = arr(fix.sessionIds);
  const sample = sessionIds.map(key => sessions.get(key)?.title).find(Boolean);
  const files = arr(fix.files);
  const gap = gaps.get(files[0]) || files[0] || 'the guide';
  const index = fix.editFiles?.find(path => path.endsWith('/index.md'));
  const headlines = {
    root: `Give the agent a starting point in ${fix.target}`,
    told: fix.editFiles?.length ? `Link to the rule in ${fix.editFiles[0]}` : `Write down the rule you supplied`,
    searched: `Make ${files[0] || 'the guide'} easier to find`,
    'one-source': `Resolve conflicting guidance in ${fix.target}`,
    'no-route': index ? `Add ${index} to guide the agent` : `Link ${gap} from ${fix.target}`
  };
  const headline = headlines[fix.kind] || 'Review this change';
  let why = '';
  if (fix.kind === 'root' || fix.kind === 'no-route') {
    why = files.length ? `The starting instructions have no path to ${files.length === 1 ? esc(files[0]) : plural(files.length, 'file')} used in past work.` : 'The project has no starting instructions.';
  } else if (fix.kind === 'told') {
    why = fix.rule ? `You had to supply this rule: “${esc(cutAt(fix.rule, 200))}”` : 'You supplied a rule the agent needed.';
  } else if (fix.kind === 'searched') {
    why = `The agent found ${files.length === 1 ? 'this file' : 'these files'} without following the links in the map.`;
  } else if (fix.kind === 'one-source') {
    why = 'The project gives different values for the same fact.';
  }
  const search = files.map(file => searches.get(file)?.find(s => sessionIds.includes(s.id))).find(Boolean);
  const observed = search ? `In “${esc(cutAt(search.title, 100))}”, the agent found ${code(search.path)} by searching.`
    : sample ? `Seen in “${esc(cutAt(sample, 100))}”.` : '';
  const example = observed ? `<p class="finding-example">${observed}</p>` : '';
  const evidence = sessionIds.length ? `<button type="button" class="btn ghost" data-finding-sessions="${esc(JSON.stringify(sessionIds))}" data-finding-file="${esc(fix.files?.[0])}">Show ${plural(sessionIds.length, 'session')}</button>` : '';
  const fingerprintAttr = fix.fingerprint ? ` data-fingerprint="${esc(fix.fingerprint)}"` : '';
  const action = run?.version ? '' : `<button type="button" class="btn small dashboard-only" data-report-action="fix" data-finding="${id}"${fingerprintAttr}>Preview this fix</button>`;
  const signature = /^[a-f0-9]{64}$/.test(fix.fingerprint || '') ? ` --fingerprint ${fix.fingerprint}` : '';
  const terminal = run?.fixCommand && /^x\d+$/.test(fix.id) ? commandDetails('Fix in terminal', `fix-cmd-${id}`, `${run.fixCommand} --finding ${fix.id}${signature}`) : '';
  return `<li data-fix="${id}" data-kind="${esc(fix.kind)}"><h3 id="finding-${id}" tabindex="-1">${esc(headline)}</h3>` +
    `<p class="finding-why">${why}</p>${example}<details class="finding-plan"><summary>See suggested edit</summary>` +
    `<div class="ft">${rich(fix.text)}</div><div class="finding-actions">${evidence}${action}${terminal}</div></details></li>`;
}
// A fix with no question, or with a question that the page does not have, goes under "find".
const questionOf = fix => (QUESTIONS.some(q => q.key === fix?.question) ? fix.question : 'find');

// One item of a question. The same markup for each question: the label, the count, the text.
function itemHtml(x) {
  const kind = x?.kind || 'item';
  const label = kind === 'fact' ? `"${esc(x.label)}"` : code(x?.label);
  return `<li class="hi${x?.saved === true ? ' saved' : ''}" data-item="${esc(kind)}"><div class="what">${label}${x?.count ? ` <span class="m">${esc(x.count)}</span>` : ''}</div>` +
    `${x?.text ? `<div class="why">${rich(x.text)}</div>` : ''}</li>`;
}

function detailHtml(q, fixes) {
  const lines = arr(q.lines).map(line => `<p class="hline">${rich(line)}</p>`).join('');
  const items = arr(q.items);
  const none = !lines && !items.length ? (q.answer == null ? '<p class="hok none">No data.</p>' : '<p class="hok">No problem here.</p>') : '';
  const links = fixes.map(([x, n]) => `<a href="#finding-${esc(x.id)}">View fix ${n}</a>`).join(' · ');
  return `${links ? `<p class="hfix">${links}</p>` : ''}${lines}${items.length ? `<ul class="hitems">${items.map(itemHtml).join('')}</ul>` : ''}${none}`;
}

// The proof: one line, and a closed part with the rates of each grade, the sessions left out and the notes.
function proofHtml(v1, reason) {
  const p = v1?.proof;
  if (!p || typeof p !== 'object') return '';
  const rows = GRADES.filter(([key]) => p.grades?.[key]).map(([key, name]) => {
    const g = p.grades[key];
    return `<tr data-grade="${key}"><th scope="row">${name}</th><td>${count(g.needs)}</td><td>${percent(g.searchRate)}</td><td>${percent(g.typedFactRate)}</td></tr>`;
  });
  const table = rows.length ? `<table class="ptable"><thead><tr><th scope="col">Grade</th><th scope="col">Needs</th><th scope="col">Searched</th><th scope="col">Typed facts</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '';
  // The sessions left out: one line for each reason and text.
  const groups = new Map();
  for (const x of arr(p.sessions?.leftOut)) {
    const key = `${x?.reason}\n${x?.text}`;
    groups.set(key, { reason: x?.reason, text: x?.text || x?.reason, n: (groups.get(key)?.n || 0) + 1 });
  }
  const left = [...groups.values()];
  const leftOut = arr(p.sessions?.leftOut).length;
  const sessions = p.sessions ? `<p class="hsum">${typeof p.sessions.used === 'number' ? `${plural(p.sessions.used, 'session')} in the proof. ` : ''}${leftOut ? `${plural(leftOut, 'session')} left out:` : 'No session left out.'}</p>` +
    (left.length ? `<ul class="hlist pleft">${left.slice(0, LEFT_OUT_LINES).map(x => `<li data-left="${esc(x.reason)}"><b>${num(x.n)}</b><span>${esc(x.text)}</span></li>`).join('')}` +
      `${left.length > LEFT_OUT_LINES ? `<li><span class="m">and ${num(left.length - LEFT_OUT_LINES)} more reasons</span></li>` : ''}</ul>` : '') : '';
  const notes = arr(p.notes).length ? `<ul class="pnotes">${p.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : '';
  const rules = v1.rules ? `<p class="hsum prules">${esc(v1.rules)}</p>` : '';
  // The reason line of the number area can hold the proof text. Then the proof line does not say it again.
  const line = p.text && !(reason && p.text.includes(reason)) ? `<p class="hproof" data-proof="${esc(p.status)}">${esc(p.text)}</p>` : '';
  return `${line}<details class="hother" id="proof" data-proof="${esc(p.status)}"><summary>Proof and method</summary>${table}${sessions}${notes}${rules}</details>`;
}

function healthHtml(model) {
  if (model.health?.v1?.shown === 'no-sessions') {
    return `<section class="health" id="health" data-shown="no-sessions" aria-label="Context score">
      <div class="hnum"><div class="hv"><span class="hscore">0</span><small> / 100</small></div>
      <p class="hreason">${esc(model.health.v1.reason)}</p></div></section>`;
  }
  const { v1, state, reason, questions, method, base } = v1View(model);
  const word = WORDS.includes(v1?.label) ? v1.label : '';
  const top = state === 'score'
    ? `<div class="hv"><span class="hscore">${esc(v1.score)}</span><small> / 100</small></div>` +
      `<div class="htags">${word ? `<span class="hlabel ${word}">${word}</span>` : ''}${ignoredTag(model)}</div>`
    : `<div class="hstate">${esc(scoreTitle(state, v1?.base?.analysed || 0))}</div><p class="hreason">${rich(reason)}</p>`;
  const sessions = model.health?.counts?.sessions;
  const baseDetail = sessions ? `<details class="hother" id="base-detail"><summary>Sessions and dropped reads</summary>${sessionsDetail(model, sessions)}</details>` : '';
  const list = arr(model.fixes?.list).map((fix, k) => [fix, k + 1]);
  const rows = questions.map(q => {
    const fixes = list.filter(([fix]) => questionOf(fix) === q.key);
    const n = arr(q.items).length;
    const tone = q.answer == null ? 'none' : q.answer === 'Yes' ? 'good' : 'on';
    return `<div class="qrow" data-q="${q.key}" data-n="${n}">
      <button type="button" class="hq" aria-expanded="false" aria-controls="hd-${q.key}"><span class="dot ${tone}"></span><span class="ask">${esc(q.title)}</span>` +
      `<span class="qa${q.answer == null ? ' none' : ''}">${esc(q.answer ?? 'no data')}</span>${fixes.length ? `<span class="qf">${plural(fixes.length, 'fix', 'fixes')}</span>` : ''}</button>
      <div class="hd" id="hd-${q.key}" hidden>${detailHtml(q, fixes)}</div>
    </div>`;
  });
  return `<section class="health" id="health" data-shown="${state}" data-method="${esc(method)}" aria-label="Context score">
    <div class="hnum">
      ${top}
      <details class="hother habout" id="about"><summary>How this score is made</summary>
      ${state !== 'score' ? ignoredTag(model) : ''}
      ${state !== 'score' && typeof v1?.score === 'number' ? `<p class="hmeta">Provisional estimate: ${esc(v1.score)}/100</p>` : ''}
      <p class="hmeta"><span class="hmethod">method ${esc(method)}</span>${base ? `<span class="hbase">${esc(base)}</span>` : ''}</p>
      ${proofHtml(v1, reason)}${baseDetail}
      </details>
    </div>
    <div class="hqs">
    ${rows.join('\n    ')}
    </div>
  </section>`;
}

function fixesHtml(model, run) {
  const list = arr(model.fixes?.list);
  const smaller = arr(model.fixes?.smaller);
  const sessions = new Map(arr(model.sessions?.list).map(s => [s.sessionId, s]));
  const gaps = new Map(arr(model.health?.parts?.found?.lost).map(f => [f.path, f.gap]));
  const searches = new Map();
  for (const session of arr(model.needs?.sessions)) {
    const title = sessions.get(session.sessionId)?.title;
    if (!title) continue;
    for (const intent of session.intents) for (const need of intent.needs) {
      if (need.knownFrom?.kind !== 'search') continue;
      if (!searches.has(need.path)) searches.set(need.path, []);
      searches.get(need.path).push({ path: need.path, title, id: session.sessionId });
    }
  }
  const rows = items => `<ul class="fixlist">${items.map(x => fixLi(x, run, sessions, gaps, searches)).join('')}</ul>`;
  const more = list.length > 1 ? `<details class="hother"><summary>${plural(list.length - 1, 'more fix', 'more fixes')}</summary>${rows(list.slice(1))}</details>` : '';
  const minor = smaller.length ? `<details class="hother" id="fix-smaller"><summary>${plural(smaller.length, 'smaller item')}</summary>${rows(smaller)}</details>` : '';
  const body = list.length || smaller.length ? `<h2>Suggested changes</h2>${list.length ? rows(list.slice(0, 1)) : ''}${more}${minor}` : '<p class="nofix">No fix from this data.</p>';
  return `<section class="fixes" id="fixes" data-fixes="${list.length}" data-smaller="${smaller.length}" tabindex="-1" aria-label="Suggested fixes">
    ${body}
  </section>`;
}

// The change against the last run, from <out>/history.json. No line on the first run.
function trendLine(run) {
  const before = run?.previous;
  const now = run?.current;
  if (!before || !now) return '';
  const text = item => (item.shown === 'score' ? `${item.score} ${item.label}` : scoreTitle(item.shown, item.analysed));
  const delta = before.shown === 'score' && now.shown === 'score' ? now.score - before.score : null;
  const sign = delta == null ? '' : delta > 0 ? ` (+${delta})` : delta < 0 ? ` (${delta})` : ' (no change)';
  const when = esc(String(before.at).slice(0, 16).replace('T', ' '));
  return `<p class="state trend" id="trend" data-delta="${delta ?? ''}">Previous comparable result (${when}${before.kind === 'after-fix' ? ', after a fix' : ''}): ` +
    `<b>${esc(text(before))}</b>, ${esc(before.fixes)} fixes. Now: <b>${esc(text(now))}${esc(sign)}</b>, ${esc(now.fixes)} fixes.</p>`;
}

function stateLine(model, run) {
  if (run?.version) {
    if (!run.evidence) return '<p class="state">Detailed session evidence is unavailable for this version.</p>';
    if (!model.sessions.list.length) return '<p class="state">No sessions were recorded for this version.</p>';
    return '';
  }
  const t = model.intents.totals;
  const failures = arr(model.analysis?.failures);
  if (t.ok && !t.notAnalysed && !failures.length) return '';
  const empty = !model.sessions.list.length;
  const state = failures.length ? 'failed' : empty ? 'no-sessions' : t.ok ? 'some-not-analysed' : 'not-analysed';
  const intro = t.ok ? '' : `<strong>${plural(model.totals.contextFiles, 'context file')} found.</strong> `;
  const explore = model.totals.contextFiles ? '<a href="#mapcard" data-report-action="explore">Explore files</a>' : '';
  let message;
  let controls = '';
  if (failures.length) {
    const reasons = [...new Set(failures.map(f => f.reason))];
    const next = reasons.includes('claude not found') ? ' Install Claude Code or add the claude executable to PATH.' : '';
    message = `${plural(t.ok, 'session')} analysed. ${plural(failures.length, 'check')} failed. ${reasons.map(esc).join('. ')}.${next}`;
  } else if (empty) {
    message = `No sessions found for ${code(model.project.root)} in ${code(model.claudeSettingsHome + '/projects')}.`;
    controls = '<button class="btn small dashboard-only" type="button" data-report-action="old-path">Add previous project path</button>';
    if (run?.oldPathCommand) controls += commandDetails('Add previous project path', 'old-path-cmd', run.oldPathCommand);
  } else if (t.notAnalysed) {
    message = `${plural(t.notAnalysed, 'session')} ready to analyse.`;
  } else {
    message = t.singleMessage ? 'Sessions need at least two user messages to qualify.' : 'No sessions are ready for analysis.';
    if (t.tooLong) message += ` ${plural(t.tooLong, 'session')} exceeded the input limit.`;
  }
  if (t.notAnalysed || failures.some(f => f.retryable)) {
    const label = failures.length ? 'Retry failed analysis' : `Analyse ${plural(t.notAnalysed, 'session')}`;
    controls += `<button type="button" class="btn small dashboard-only" data-report-action="analyse">${label}</button>`;
    if (run?.command) controls += commandDetails(label, 'rerun', run.command);
  }
  return `<div class="state first-run" data-state="${state}"><p>${intro}${message}</p><div class="first-run-actions">${controls}${explore}</div></div>`;
}

function outcomeHtml(outcome) {
  if (!outcome) return '';
  const distance = n => n == null ? 'no route' : n === 0 ? 'in the starting instructions' : plural(n, 'link');
  const changed = arr(outcome.routes).filter(route => route.before !== route.after);
  const routes = changed.map(route => `<li>${code(route.path)}: ${distance(route.before)} before, ${distance(route.after)} after.</li>`);
  for (const rule of arr(outcome.rules)) {
    const where = paths => paths.length ? paths.map(code).join(', ') : 'no matching file';
    routes.push(`<li>Exact wording of “${esc(rule.text)}” in the files checked: ${where(rule.before)} before, ${where(rule.after)} after.</li>`);
  }
  const later = outcome.later;
  const tokens = outcome.before.startTokens === outcome.after.startTokens ? '' :
    `<p>Starting instructions changed from ${num(outcome.before.startTokens)} to ${num(outcome.after.startTokens)} tokens.</p>`;
  return `<section class="fix-outcome"><h2>After the fix</h2><p>Compared the same ${plural(outcome.sessions, 'recorded session')}. Needed files with a route: ${num(outcome.before.reachable)} before, ${num(outcome.after.reachable)} after.</p>` +
    (routes.length ? `<ul>${routes.join('')}</ul>` : '<p>The measured file routes stayed the same.</p>') +
    tokens +
    `<p>${later?.sessions ? `In ${plural(later.sessions, 'later session')}, Claude followed a link to an affected file ${plural(later.followed, 'time')} and found one by search ${plural(later.searched, 'time')}.` : 'Later usage will appear here after you analyse a new session.'}</p></section>`;
}

// The prompt as a clean panel. The section "What to improve" is highlighted.
function promptHtml(text) {
  const [intro, ...sections] = text.trim().split('\n## ');
  const body = sections.map(section => {
    const [title, ...lines] = section.split('\n');
    const parts = [];
    let list = null;
    const close = () => { if (list) parts.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`); list = null; };
    for (const line of lines) {
      const bullet = line.match(/^- (.*)$/);
      const numbered = line.match(/^\d+\. (.*)$/);
      if (bullet || numbered) {
        const tag = bullet ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { close(); list = { tag, items: [] }; }
        list.items.push(`<li>${esc((bullet || numbered)[1])}</li>`);
      } else if (line.trim()) { close(); parts.push(`<h4>${esc(line)}</h4>`); }
    }
    close();
    const html = `<h3>${esc(title)}</h3>${parts.join('')}`;
    return /What to improve$/.test(title) ? `<div class="fix">${html}</div>` : html;
  }).join('');
  return `<p class="intro">${esc(intro)}</p>${body}`;
}

export function render(model, run = null) {
  const data = pageData(model);
  if (run?.version) data.version = { id: run.version.id, name: run.version.name, revision: run.version.revision, evidence: run.evidence };
  const diagnostics = healthHtml(model) + fixesHtml(model, run);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="context-health-layout" content="versions">
${EXPLORER_MARKER}
${run?.version ? `<meta name="context-health-version" content="${esc(run.version.id)}"><meta name="context-health-revision" content="${esc(run.version.revision)}">` : ''}
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>context-health: ${esc(model.project.name)}${run?.version ? ' · ' + esc(run.version.name) : ''}</title>
<style>
${css}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1 id="pname">${esc(run?.version?.name || model.project.name)}</h1>
      <p class="eyebrow">${run?.version ? esc(model.project.name) + ' · ' : ''}Context health report</p>
    </div>
  </header>
  ${stateLine(model, run)}
  ${outcomeHtml(model.fixOutcome)}
  ${model.intents.totals.ok || model.fixes?.total ? diagnostics : `<details class="hother"><summary>Report details</summary>${diagnostics}</details>`}
  ${trendLine(run)}

  <h2 class="explorer-title">Context map</h2>
  <div class="grid">
    <section aria-label="Context map" id="mapcard">
      <div class="map-controls">
        <input type="search" id="file-search" aria-label="Search files" placeholder="Find a file or folder" aria-controls="map">
        <div class="map-activity-filters" id="map-activity-filters" role="group" aria-label="Filter by recorded activity" hidden>
          <button type="button" id="opened-files" class="keybtn" aria-pressed="false" aria-controls="map" title="Show files read by the agent">Opened files</button>
          <button type="button" id="explored-folders" class="keybtn" aria-pressed="false" aria-controls="map" title="Show folders the agent listed or searched">Explored folders</button>
        </div>
        <div class="map-tools"><span class="zoom" id="zoom" role="group" aria-label="Zoom the map"><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit" id="zoom-level" aria-label="Fit map to width">Fit</button><button type="button" data-z="in" aria-label="Zoom in">+</button></span><button type="button" class="fullbtn" id="full" aria-pressed="false" aria-label="Full screen" title="Full screen"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="go" d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/><path class="stop" d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/></svg></button></div>
      </div>
      <div id="map-status" role="status"></div>
      <div id="folder-map-coverage" role="status" hidden></div>
      <div class="mapbox"><svg id="map" role="group" aria-label="Context files by folder"></svg></div>
      <details class="map-legend"><summary>Map key</summary><div class="key"><span><i class="h"></i>Opened</span><span><i class="s"></i>Listed or matched</span><span><i class="t"></i>Empty search</span><span><i class="ref"></i>File reference</span><span><i class="obs"></i>Recorded lookup</span></div></details>
      <div class="note" id="note" aria-live="polite"></div>
    </section>
    <aside aria-label="Sessions and intents">
      <div class="switch" id="switch" role="group" aria-label="List"><button type="button" data-v="sessions" aria-pressed="true">Sessions</button><button type="button" data-v="intents" aria-pressed="false">Intents</button></div>
      <input type="search" id="evidence-search" aria-label="Search sessions" placeholder="Search sessions" aria-controls="list">
      <div class="chips" id="chips" role="group" aria-label="Filter intents"></div>
      <div id="evidence-status" role="status"></div>
      <div id="list"></div>
      ${run?.version ? '' : `<div class="promptbox">
        <div class="actions">
          <button type="button" class="btn primary" id="copy-prompt">Copy improvement prompt</button>
          <button type="button" class="btn ghost" id="show-prompt" aria-expanded="false" aria-controls="prompt">Show prompt</button>
        </div>
        ${run?.fixCommand ? `<p class="fixcmd">Or let the tool start claude with this prompt: <code id="fix-cmd">${esc(run.fixCommand)}</code></p>` : ''}
        <section id="prompt" hidden aria-label="Improvement prompt">${promptHtml(model.prompt.text)}</section>
      </div>`}
    </aside>
  </div>
</div>
<div id="tip" hidden></div>
<div class="copied" id="copied" aria-live="polite"></div>
<script type="application/json" id="page-data">${scriptJson(data)}</script>
<script>
${script}</script>
${copyMarkdown}</body>
</html>
`;
}
