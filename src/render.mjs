// Render the report as one local HTML page, from the approved ui v4 sketch.
// The page calculates nothing: step 8 (src/routes.mjs, src/prompt.mjs) owns the numbers. This module picks the keys
// the page needs, formats paths, dates and words, and embeds them as one JSON object. The page script
// (src/page/page.js) draws the map and the list from that object and handles the clicks.
import { readFileSync } from 'node:fs';
import { REASON_TEXT } from './context-files.mjs';
import { plain } from './prompt.mjs';
import { SKILL_LIST } from './routes.mjs';

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

// The object the page script reads. Only joins and formatting.
export function pageData(model) {
  const routes = model.routes;
  const mapFiles = new Map(model.map.files.map(file => [file.path, file]));
  const view = entry => ({ files: entry.files, edges: entry.edges, problems: entry.problems });
  const groupsById = new Map(model.groups.list.map(group => [group.id, group]));
  const intentsById = new Map(model.intents.sessions.map(entry => [entry.sessionId, entry]));
  const routesBySession = new Map(routes.bySession.map(entry => [entry.sessionId, entry]));
  return plainDeep({
    project: { name: model.project.name, root: model.project.root },
    settingsHome: model.claudeSettingsHome,
    map: {
      columns: routes.map.columns,
      searchFrom: routes.map.searchFrom,
      nodes: routes.map.nodes.map(node => {
        const file = node.path ? mapFiles.get(node.path) : null;
        return { id: node.id, path: node.path, label: shortLabel(node.path), abs: absolutePath(model, node.path),
          lane: node.lane, column: node.column, row: node.row, steps: node.steps, tokens: node.tokens,
          intents: node.intents, groups: node.groups,
          route: file && file.reach === 'path' ? [...(file.route[0]?.via === 'trigger' ? [SKILL_LIST] : []), ...file.route.map(item => item.path)] : [] };
      }),
      edges: routes.map.edges
    },
    groups: routes.byGroup.map(entry => {
      const group = groupsById.get(entry.groupId);
      return { id: entry.groupId, label: group.label, count: group.count, sessions: entry.sessions, weak: entry.weak, told: entry.told, ...view(entry) };
    }),
    sessions: model.sessions.list.map(session => {
      const status = intentsById.get(session.sessionId);
      const entry = routesBySession.get(session.sessionId);
      const message = firstUser(session);
      const text = message ? message.text.replace(/\s+/g, ' ').trim() : '';
      const reasonShort = status?.status === 'ok' ? (status.intents.length ? null : 'no intents') : REASON_SHORT[status?.status] || 'not analysed';
      return { id: session.sessionId, date: shortDate(session.startedAt), when: when(session.startedAt),
        first: text.length > FIRST_CUT || message?.cut ? `${text.slice(0, FIRST_CUT).trimEnd()}...` : text,
        status: status?.status ?? null, reason: status?.reason ?? null, reasonShort,
        intentCount: entry.intents.length, groups: entry.groups, ...view(entry) };
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

// ---------- the health score (step 12, method v1): one number and four questions; each detail is closed ----------

const QUESTIONS = [
  { key: 'find', title: 'Can the agent find what it needs?' },
  { key: 'close', title: 'Are the needed files close to the start?' },
  { key: 'told', title: 'Did you have to tell the agent?' },
  { key: 'lean', title: 'Is the start load lean?' }
];
const STATE = { 'not-proven': 'Score not proven', thin: 'Not enough data', 'no-data': 'No data' };
const WORDS = ['good', 'mixed', 'poor'];
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
  // The page shows the number when there is one, also with thin data or no proof. Then the reason is a note under it.
  const state = v1 && STATE[v1.shown] ? v1.shown : v1?.shown === 'score' && typeof v1.score === 'number' ? 'score' : 'no-data';
  const shown = typeof v1?.score === 'number' ? 'score' : state;
  const reason = v1?.shown !== 'score' && STATE[v1?.shown] ? v1?.reason || null
    : shown === 'score' ? null : v1?.reason || NO_SCORE[h.counts?.reason] || (v1 ? 'The report gives no reason.' : 'This report has no v1 score.');
  const byKey = new Map(arr(v1?.questions).filter(q => q && typeof q === 'object').map(q => [q.key, q]));
  const questions = QUESTIONS.map(q => ({ ...q, answer: null, lines: [], items: [], ...(byKey.get(q.key) || {}), key: q.key }));
  return { v1, state, shown, reason, questions, method: v1?.method || 'v1', base: v1?.base?.text || h.counts?.sessions?.text || '' };
}

// One fix. The number is the place of the fix in `fixes.list` (the prompt has the same order).
const fixLi = (x, n) => `<li data-fix="${esc(x.id)}" data-kind="${esc(x.kind)}"><div class="ft">${n ? `<b class="fn">${n}.</b> ` : ''}${rich(x.text)}</div>` +
  `${typeof x.needs === 'number' ? `<div class="m">Covers ${plural(x.needs, 'need')}${x.files?.length ? ` in ${plural(x.files.length, 'file')}` : ''}.</div>` : ''}</li>`;
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
  const fix = fixes.length ? `<div class="hfix"><div class="fh">${fixes.length === 1 ? 'Fix' : 'Fixes'}</div><ul class="fixlist">${fixes.map(([x, n]) => fixLi(x, n)).join('')}</ul></div>` : '';
  return `${lines}${items.length ? `<ul class="hitems">${items.map(itemHtml).join('')}</ul>` : ''}${none}${fix}`;
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
  const { v1, state, shown, reason, questions, method, base } = v1View(model);
  const word = WORDS.includes(v1?.label) ? v1.label : '';
  const top = shown === 'score'
    ? `<div class="hv"><span class="hscore">${esc(v1.score)}</span><small> / 100</small></div>` +
      `<div class="htags">${word ? `<span class="hlabel ${word}">${word}</span>` : ''}${reason ? `<span class="hflag">${STATE[v1.shown] || ''}</span>` : ''}</div>`
    : `<div class="hstate">${STATE[shown]}</div><p class="hreason">${rich(reason)}</p>`;
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
      ${shown === 'score' && reason ? `<p class="hreason hnote" data-note="${esc(v1.shown)}">${STATE[v1.shown] || ''}: ${rich(reason)}</p>` : ''}
      <p class="hmeta"><span class="hmethod">method ${esc(method)}</span>${base ? `<span class="hbase">${esc(base)}</span>` : ''}</p>
      ${proofHtml(v1, reason)}${baseDetail}
      </details>
    </div>
    <div class="hqs">
    ${rows.join('\n    ')}
    </div>
  </section>`;
}

// The fixes of `fixes.list` are under their questions. This part holds the smaller items, closed.
function fixesHtml(model) {
  const list = arr(model.fixes?.list);
  const smaller = arr(model.fixes?.smaller);
  const body = smaller.length ? `<details class="hother" id="fix-smaller"><summary>${plural(smaller.length, 'smaller item')}</summary><ul class="fixlist">${smaller.map(x => fixLi(x, 0)).join('')}</ul></details>`
    : list.length ? '' : '<p class="nofix">No fix from this data.</p>';
  return `<section class="fixes" id="fixes" data-fixes="${list.length}" data-smaller="${smaller.length}" aria-label="Smaller fixes"${body ? '' : ' hidden'}>
    ${body}
  </section>`;
}

// The change against the last run, from <out>/history.json. No line on the first run.
function trendLine(run) {
  const before = run?.previous;
  const now = run?.current;
  if (!before || !now) return '';
  const text = item => (item.score != null ? `${item.score} ${item.label}` : 'no score');
  const delta = before.score != null && now.score != null ? now.score - before.score : null;
  const sign = delta == null ? '' : delta > 0 ? ` (+${delta})` : delta < 0 ? ` (${delta})` : ' (no change)';
  const when = esc(String(before.at).slice(0, 16).replace('T', ' '));
  return `<p class="state trend" id="trend" data-delta="${delta ?? ''}">Last run (${when}${before.kind === 'after-fix' ? ', after a fix' : ''}): ` +
    `<b>${esc(text(before))}</b>, ${esc(before.fixes)} fixes. Now: <b>${esc(text(now))}${esc(sign)}</b>, ${esc(now.fixes)} fixes.</p>`;
}

function stateLine(model, run) {
  const t = model.intents.totals;
  if (!model.sessions.list.length) {
    return '<p class="state none" data-state="no-sessions">No sessions for this project. The tool reads the sessions in <code>~/.claude/projects/</code>. ' +
      'If the project was in another folder before, add <code>--old-path &lt;old folder&gt;</code>.</p>';
  }
  const lines = [];
  if (!t.ok) {
    lines.push(`<p class="state" data-state="not-analysed">No session is analysed yet. Run with <code>--intents</code> to find the intents ` +
      `(one model call for each session, ${esc(model.intents.model)}).${t.notAnalysed ? ` ${plural(t.notAnalysed, 'session')} wait for it.` : ''}</p>`);
  } else if (t.notAnalysed) {
    const cmd = run?.command;
    lines.push(`<div class="state cmdbox" data-state="some-not-analysed"><p><b>${plural(t.notAnalysed, 'new session')} ${t.notAnalysed === 1 ? 'is' : 'are'} not in this report.</b> ` +
      `To add ${t.notAnalysed === 1 ? 'it' : 'them'}, run this command in a terminal. It makes about ${plural(t.notAnalysed + 2, 'model call')} (${esc(model.intents.model)}).</p>` +
      (cmd ? `<div class="cmd"><code id="rerun">${esc(cmd)}</code><button type="button" class="btn small" id="copy-rerun">Copy command</button></div>` : `<p>Run the same command again with <code>--intents</code>.</p>`) + '</div>');
  }
  return lines.join('\n  ');
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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>context-health: ${esc(model.project.name)}</title>
<style>
${css}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1 id="pname">${esc(model.project.name)}</h1>
      <p class="eyebrow">Context health report</p>
    </div>
  </header>
  ${healthHtml(model)}
  ${trendLine(run)}
  ${fixesHtml(model)}
  ${stateLine(model, run)}

  <div class="grid">
    <section aria-label="Context map">
      <p class="key"><span><i class="h"></i>used by more intents</span><span><i></i>route by links</span><span><i class="s"></i>found by search</span><span><i class="t"></i>no path or told by you</span><button type="button" class="keybtn" id="toggle-unused" aria-pressed="false" hidden>Show unused files</button><span class="zoom" id="zoom" role="group" aria-label="Zoom the map"><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit" id="zoom-level">Fit</button><button type="button" data-z="in" aria-label="Zoom in">+</button></span></p>
      <p class="hint">Scroll the map sideways.</p>
      <div class="mapbox"><svg id="map" role="img" aria-label="Map of the context files by steps from the start load"></svg></div>
      <div class="note" id="note" aria-live="polite"></div>
    </section>
    <aside aria-label="Intents and sessions">
      <div class="switch" id="switch" role="group" aria-label="List"><button type="button" data-v="intents" aria-pressed="true">Intents</button><button type="button" data-v="sessions" aria-pressed="false">Sessions</button></div>
      <div class="chips" id="chips" role="group" aria-label="Filter intents"></div>
      <div id="list"></div>
      <div class="promptbox">
        <div class="actions">
          <button type="button" class="btn primary" id="copy-prompt">Copy improvement prompt</button>
          <button type="button" class="btn ghost" id="show-prompt" aria-expanded="false" aria-controls="prompt">Show prompt</button>
        </div>
        ${run?.fixCommand ? `<p class="fixcmd">Or let the tool start claude with this prompt: <code id="fix-cmd">${esc(run.fixCommand)}</code></p>` : ''}
        <section id="prompt" hidden aria-label="Improvement prompt">${promptHtml(model.prompt.text)}</section>
      </div>
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
