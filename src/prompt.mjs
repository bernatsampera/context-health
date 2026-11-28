// Step 8c: the improvement prompt. A pure function: it builds a text from the data of the earlier steps
// and step 8, for the user to paste into an agent. It invents nothing: each number comes from report.json.
// Step 11: the prompt shows the 5 counts of `health.counts` in place of the score. Section 5 is the list of
// `fixes.list` (src/fixes.mjs): one fix for each root cause, 10 at most. Each list of section 4 has a limit.
// Step 12: one line with the v1 headline (`health.v1.headline`) above the 5 counts, when it is there. The told facts
// come from `health.parts.found`, so they are rules only: a task fact is not a need and is not in the prompt.
import { START_WHAT } from './collect.mjs';
import { ignoreText } from './ignore.mjs';
import { isNamed } from './context-files.mjs';
import { buildFixes } from './fixes.mjs';
import { fixContext } from './health.mjs';
import { buildView } from './routes.mjs';

const num = value => value.toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
// No en dash or em dash in the prompt, also when a goal or a quote of the user has one.
export const plain = text => String(text ?? '').replace(/[\u2013\u2014]/g, '-');
const MAX_GROUPS = 8;
const MAX_HOT = 10;
// Each list of "Problems found": 15 items at most, then "And N more.".
const MAX_LIST = 15;
const MAX_UNUSED = MAX_LIST;

const WAY_TEXT = { links: 'by links', search: 'by search', no_path: 'with no path', unnamed: 'with nothing that named it before',
  weak_route: 'through a file found by search', told_path: 'because the user gave the path' };

export function buildPrompt(model) {
  const routes = model.routes;
  const mapFiles = new Map(model.map.files.map(file => [file.path, file]));
  const groupsById = new Map(model.groups.list.map(group => [group.id, group]));
  const all = buildView(routes.intents, routes.map.searchFrom);
  const intentCount = routes.intents.length;
  // The start file and the fix of each file: the same as in health.
  const ctx = fixContext(model);
  const startRef = ctx.startRef;
  const routeText = rel => {
    const file = mapFiles.get(rel);
    if (!file || file.reach === 'none') return 'no route from the start load on the map';
    if (file.reach === 'start') return 'in the start load';
    return `${file.route.map(item => item.path).join(' > ')} (${plural(file.steps, 'step')}, ${num(file.pathTokens)} tokens on the way)`;
  };
  const lines = [`You improve the agent context of the project ${model.project.name}: CLAUDE.md, AGENTS.md, skills and the docs they link. ` +
    'The data below comes from context-health, which read the context files and the Claude Code sessions of the project.', ''];
  const section = (title, body) => { lines.push(`## ${title}`, ...body, ''); };
  const none = list => (list.length ? list : ['- None.']);
  const noData = '- No analysed intents yet. Run context-health with --intents first.';

  // The 5 counts of step 11, in place of the health score.
  const h = model.health;
  const found = h.parts.found;
  const counts = h.counts;
  const withBase = line => `${line.text}${line.base ? `, ${line.base}` : ''}`;
  const top = counts.startLoad.top.map(item => `${item.path} (${item.what}, ${num(item.tokens)} tokens)`).join(', ');
  const countLines = [
    `- a. ${withBase(counts.noRoute)}.`,
    `- b. ${withBase(counts.searched)}.`,
    `- c. ${counts.told.text}.`,
    `- d. ${counts.startLoad.text}.${top ? ` The biggest items: ${top}.` : ''}`,
    `- e. ${counts.sessions.text}.`
  ];
  // The v1 headline, as one sentence. No line when health has no v1.
  const headline = String(h.v1?.headline ?? '').replace(/\s+/g, ' ').trim();
  const scoreLines = headline ? [`- The score of today: ${headline}${/[.!?]$/.test(headline) ? '' : '.'}`] : [];
  const dropped = model.needs.dropped?.needs || 0;
  const facts = h.parts.oneSource.facts || [];
  const placeText = fact => fact.places.map(place => `${place.path}: "${place.quote}"`).join('; ');
  const lostByPath = new Map(found.lost.map(item => [item.path, item]));
  const startPaths = new Set(model.startLoad.filter(item => START_WHAT.has(item.what)).map(item => item.path));
  const named = rel => (mapFiles.has(rel) ? isNamed(mapFiles.get(rel)) : startPaths.has(rel));

  // 1. What was explored.
  const ok = model.intents.sessions.filter(entry => entry.status === 'ok').length;
  const grouped = model.groups.status === 'ok' ? `grouped into ${plural(model.groups.list.length, 'goal')}`
    : `not grouped (${model.groups.status === 'not-needed' ? 'fewer than 2 intents' : model.groups.reason || model.groups.status})`;
  section('1. What was explored', [
    `- Project: ${model.project.name}.`,
    `- Sessions: ${num(model.sessions.list.length)} read, ${num(ok)} analysed. Intents: ${num(intentCount)}, ${grouped}.`,
    `- Start load: ${num(model.totals.startLoadTokens)} tokens in ${plural(model.totals.startLoadItems, 'item')} (instruction files, the skill and command list).`,
    `- Context files: ${num(model.totals.contextFiles)}. On the map, ${plural(model.map.totals.noneContext, 'context file')} have no path from the start load.`,
    ...scoreLines,
    ...(model.ignore?.length ? [`- The user chose to leave out the ${ignoreText(model.ignore)}. They are not counted. Do not change them.`] : []),
    'The 5 counts of today:',
    ...countLines,
    // How much data the counts have.
    ...[h.data.note, h.data.skippedNote].filter(Boolean).map(text => `- ${text}`),
    ...(dropped ? [`- ${plural(dropped, 'read')} of files that are not context files ${dropped === 1 ? 'does' : 'do'} not count as needs.`] : [])
  ]);

  // 2. What the agent needs most.
  const groupLines = routes.byGroup.slice(0, MAX_GROUPS).map(entry => {
    const group = groupsById.get(entry.groupId);
    const files = entry.files.map(file => `${file.path} (${file.uses})`).join(', ');
    return `- "${group.label}", ${plural(group.count, 'time')}: ${files || 'no context file'}.`;
  });
  if (routes.byGroup.length > MAX_GROUPS) groupLines.push(`- And ${plural(routes.byGroup.length - MAX_GROUPS, 'more group')}.`);
  section('2. What the agent needs most', intentCount ? groupLines : [noData]);

  // 3. The routes to the hot files today.
  const hotAll = all.files.filter(file => file.uses >= 2);
  const hot = (hotAll.length ? hotAll : all.files).slice(0, MAX_HOT);
  section('3. The routes to the hot files today', !intentCount ? [noData] : none(hot.map(file => {
    const ways = Object.entries(file.ways).filter(([, count]) => count).map(([way, count]) => `${WAY_TEXT[way]} ${plural(count, 'time')}`).join(', ');
    return `- ${file.path}, needed by ${plural(file.uses, 'intent')}: ${routeText(file.path)}. Reached ${ways}.`;
  })));

  // 4. Problems found. Each list has a limit.
  const capped = list => (!list.length ? ['- None.'] : list.length > MAX_LIST ? [...list.slice(0, MAX_LIST), `- And ${num(list.length - MAX_LIST)} more.`] : list);
  // The why of health, so the page and the prompt say the same thing about a file.
  const noPath = counts.noRoute.items.map(item => `- ${item.path}: needed by ${plural(item.uses, 'intent')}. ${lostByPath.get(item.path)?.why || 'No link reaches it.'}`);
  const searched = counts.searched.items.map(item => `- ${item.path}: needed by ${plural(item.uses, 'intent')}, searched ${plural(item.searched, 'time')}. ${item.why}`);
  // Only the facts that are still a gap. A fact that a file with a route holds now is in its own list.
  const told = found.told.map(item => `- "${item.text}" (${plural(item.uses, 'time')}). The user said: "${item.quote ?? item.text}"${item.savedPath ? ` It is in ${item.savedPath} now, a file with no route.` : ''}`);
  const saved = found.saved.map(item => `- "${item.text}": in ${item.path}${item.steps ? ` (${plural(item.steps, 'step')} from the start)` : ' (in the start load)'}.`);
  // Only the facts with different values whose places are all named files. A copy is not a problem of this list.
  const differ = facts.filter(fact => fact.differ && fact.places.every(place => named(place.path)))
    .map(fact => `- ${fact.what.replace(/[.!?]+$/, '')}. ${placeText(fact)}.`);
  const unusedNodes = routes.map.nodes.filter(node => node.path && node.lane !== 'start' && node.intents === 0).map(node => node.path);
  const unused = !unusedNodes.length ? ['- None.'] : [`- ${unusedNodes.slice(0, MAX_UNUSED).join(', ')}${unusedNodes.length > MAX_UNUSED ? `, and ${num(unusedNodes.length - MAX_UNUSED)} more` : ''}.`];
  // How much of the context the duplicate check read.
  const coverage = h.parts.oneSource.coverage;
  const factsHow = h.parts.oneSource.checked === 'exact-only' ? ' (only exact copies checked, so no different value can show)'
    : coverage.checked < coverage.total ? ` (the model check read ${num(coverage.checked)} of ${plural(coverage.total, 'file')})` : '';
  section('4. Problems found', !intentCount ? [noData] : [
    'Needed files with no route from the start load:', ...capped(noPath),
    'Needed files with a route that the agent searched:', ...capped(searched),
    'Facts that the user typed (not in the context):', ...capped(told),
    ...(saved.length ? ['Facts that the user typed, and that a context file holds now (no change needed):', ...capped(saved)] : []),
    `Facts with different values in two or more instruction files${factsHow}:`, ...capped(differ),
    `Context files that no intent used (${num(unusedNodes.length)}):`, ...unused
  ]);

  // 5. What to improve: the fixes of `fixes.list`, one for each root cause. The page shows the same texts.
  const fixes = model.fixes ?? buildFixes(model);
  const fixLines = fixes.list.map((fix, k) => `${k + 1}. ${fix.text}`);
  if (fixes.smaller.length) fixLines.push(`And ${plural(fixes.smaller.length, 'smaller item')}.`);
  if (!intentCount) fixLines.push('Run context-health with --intents first, so there is data to improve from.');
  else if (!fixes.total) fixLines.push('No change is needed from this data: each needed file has a route, and the agent did not search. Run context-health again after more sessions.');
  section('5. What to improve', fixLines);

  // 6. Then.
  section('6. Then', [
    `- Make these changes in the repo. Keep ${startRef} small: add links and one line facts, not long text. Do not delete files without asking.`,
    `- When you are done, run context-health again on the same sessions. Compare the 5 counts with the counts above (lines a to e of section 1), and report the change. Lines b and c fall only with new sessions.`
  ]);
  return { text: plain(`${lines.join('\n').trim()}\n`) };
}

export function findingPrompt(model, finding) {
  return plain([
    `Improve the agent instructions for ${model.project.name}. Work only on finding ${finding.id}.`,
    '## 5. What to improve',
    finding.text,
    `Suggested edit: ${finding.target}${finding.line ? ' at line ' + finding.line : ''}.`,
    'Keep the edit small and preserve unrelated work. If the evidence is insufficient to choose the right rule, leave it for review.'
  ].join('\n\n'));
}
