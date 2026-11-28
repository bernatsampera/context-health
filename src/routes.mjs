// Step 8b: the route the agent took to each needed file, and the numbers of the page. A pure function:
// no model call, no file read. It reads map, sessions, intents, needs and groups.
// The route of a need: walk `knownFrom` back through the files of the same session
// (file > the file that named it > ... > a start file). The walk stops at a search, a path the user gave,
// or a read that nothing named. When it cannot go further back (a nested CLAUDE.md load, a cycle, no earlier
// event), the rest of the route comes from the map, and `fromMap` is true.
import { START_WHAT } from './collect.mjs';
import { needTest } from './context-files.mjs';

export const SKILL_LIST = ':skill-list';
const WEAK = new Set(['search', 'none', 'user']);
const PROBLEM_ORDER = ['search', 'no_path', 'unnamed', 'weak_route', 'told_path', 'missing'];
const WAYS = ['links', 'search', 'no_path', 'unnamed', 'weak_route', 'told_path'];
export const METHOD = 'Direct reach = file needs reached only by links from the start load, of all file needs that are not gone plus the missing needs. ' +
  'Average route = mean map steps of the needed files that have a route. Told by user = missing needs.';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (sessionId, intentId) => `${sessionId}:${intentId}`;

// ---------- the walk ----------

function walker({ mapFiles, startPaths, session }) {
  const events = session.events;
  // A file the harness loaded (a nested CLAUDE.md) with no map route still came from the harness, not from a guess.
  const mapRoute = (rel, loaded) => {
    const file = mapFiles.get(rel);
    if (!file || file.reach === 'none' || !file.route.length) return [{ path: rel, how: loaded ? 'map' : 'none' }];
    return file.route.map(entry => ({ path: entry.path, how: 'map' }));
  };
  // The earliest read or load of `rel` before `from`, in the same thread or the main thread.
  const sourceEvent = (rel, from) => events.find(event => event.path === rel && (event.kind === 'read' || event.kind === 'load') &&
    event.i < from.i && (event.thread === from.thread || event.thread === 'main')) || null;

  return need => {
    const back = []; // from the need back to the head
    let fromMap = false;
    const fallback = (rel, loaded = false) => {
      fromMap = true;
      const have = new Set(back.map(item => item.path));
      for (const item of mapRoute(rel, loaded).reverse()) if (!have.has(item.path)) back.push(item);
    };
    const seen = new Set();
    let rel = need.path;
    let event = events.find(item => item.i === need.firstEvent) || null;
    for (;;) {
      seen.add(rel);
      if (startPaths.has(rel)) { back.push({ path: rel, how: 'start' }); break; }
      if (event?.kind === 'load' && event.how === 'skill') { back.push({ path: rel, how: 'trigger' }); break; }
      if (event?.kind === 'load' && event.how === 'mention') { back.push({ path: rel, how: 'user' }); break; }
      if (!event || event.kind === 'load') { fallback(rel, event?.kind === 'load'); break; } // nested, restore, or no earlier event
      const known = event.knownFrom || { kind: 'none', path: null };
      if (known.kind === 'search' || known.kind === 'user' || known.kind === 'none') { back.push({ path: rel, how: known.kind }); break; }
      // A repeat read names its own path: go back to the earlier read or load of the same file.
      if (known.path === rel) {
        const earlier = sourceEvent(rel, event);
        if (earlier) { event = earlier; continue; }
        fallback(rel);
        break;
      }
      if (!known.path) { back.push({ path: rel, how: 'start' }); break; }
      if (seen.has(known.path)) { fallback(rel); break; } // a cycle of known-from paths
      back.push({ path: rel, how: 'link' });
      if (known.kind === 'start') { back.push({ path: known.path, how: 'start' }); break; }
      const next = sourceEvent(known.path, event);
      rel = known.path;
      event = next;
    }
    return { route: back.reverse(), fromMap };
  };
}

// ---------- problems ----------

const problem = (kind, extra = {}) => ({ kind, path: null, steps: null, via: null, viaHow: null, text: null, quote: null, ...extra });

function problemOf(need, mapStepsOf = () => null) {
  const head = need.route[0];
  const steps = need.steps;
  if (need.state === 'search') return problem('search', { path: need.path, steps });
  if (need.state === 'no_path') return problem('no_path', { path: need.path });
  if (!WEAK.has(head.how)) return null;
  // The user gave the path of a file earlier on the route: the problem is that file.
  if (head.path !== need.path && head.how === 'user') return problem('told_path', { path: head.path, steps: mapStepsOf(head.path) });
  if (head.path !== need.path) return problem('weak_route', { path: need.path, steps, via: head.path, viaHow: head.how });
  if (head.how === 'user') return problem('told_path', { path: need.path, steps });
  if (head.how === 'search') return problem('search', { path: need.path, steps });
  return problem('unnamed', { path: need.path, steps });
}

export const wayOf = need => {
  const item = problemOf(need);
  return item ? item.kind : 'links';
};

// ---------- views (one group, one session) ----------

const routeKey = route => route.map(item => `${item.how}:${item.path}`).join('>');

// The edges of one route. A trigger head comes from the skill and command list. A search head is a jump from the start file.
function edgesOf(route, searchFrom) {
  const out = [];
  const head = route[0];
  if (head.how === 'trigger') out.push({ from: SKILL_LIST, to: head.path, kind: 'trigger' });
  if (head.how === 'search' && searchFrom && searchFrom !== head.path) out.push({ from: searchFrom, to: head.path, kind: 'search' });
  // An edge into a file of the map part of the route is kind `map`: the agent did not show that it took it.
  for (let k = 1; k < route.length; k += 1) out.push({ from: route[k - 1].path, to: route[k].path, kind: route[k].how === 'map' ? 'map' : 'link' });
  return out;
}

export function buildView(items, searchFrom) {
  const files = new Map();
  const edges = new Map();
  const problems = new Map();
  for (const item of items) {
    const edgeKeys = new Set();
    for (const need of item.needs) {
      const file = files.get(need.path) || { path: need.path, uses: 0, ways: Object.fromEntries(WAYS.map(way => [way, 0])), routes: new Map() };
      file.uses += 1;
      file.ways[wayOf(need)] += 1;
      const rk = routeKey(need.route);
      const known = file.routes.get(rk) || { route: need.route, count: 0 };
      known.count += 1;
      file.routes.set(rk, known);
      files.set(need.path, file);
      for (const edge of edgesOf(need.route, searchFrom)) {
        const ek = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
        if (edgeKeys.has(ek)) continue;
        edgeKeys.add(ek);
        const known2 = edges.get(ek) || { ...edge, count: 0 };
        known2.count += 1;
        edges.set(ek, known2);
      }
    }
    const seen = new Set();
    for (const entry of item.problems) {
      const pk = [entry.kind, entry.path, entry.via, entry.text].join('\u0000');
      if (seen.has(pk)) continue;
      seen.add(pk);
      const known3 = problems.get(pk) || { ...entry, count: 0 };
      known3.count += 1;
      problems.set(pk, known3);
    }
  }
  return {
    files: [...files.values()].sort((a, b) => b.uses - a.uses || cmp(a.path, b.path)).map(file => ({
      path: file.path, uses: file.uses, ways: file.ways,
      routes: [...file.routes.entries()].sort((a, b) => b[1].count - a[1].count || cmp(a[0], b[0])).map(([, value]) => value)
    })),
    edges: [...edges.values()].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind)),
    problems: [...problems.values()].sort((a, b) => b.count - a.count || PROBLEM_ORDER.indexOf(a.kind) - PROBLEM_ORDER.indexOf(b.kind) ||
      cmp(a.path ?? a.text ?? '', b.path ?? b.text ?? ''))
  };
}

const isWeak = view => view.problems.some(item => item.kind === 'search' || item.kind === 'no_path' || item.kind === 'unnamed' || item.kind === 'weak_route');
const isTold = view => view.problems.some(item => item.kind === 'missing' || item.kind === 'told_path');

// ---------- the map ----------

function buildMapNodes({ model, mapFiles, used }) {
  const nodes = new Map();
  const add = node => { if (!nodes.has(node.id)) nodes.set(node.id, node); };
  const base = (id, rel, lane, column, steps, tokens) => ({ id, path: rel, lane, column, row: null, steps, tokens,
    intents: used.intents.get(id)?.size || 0, groups: used.groups.get(id)?.size || 0,
    usedBy: { groups: model.groups.list.map(group => group.id).filter(key => used.groups.get(id)?.has(key)),
      sessions: model.sessions.list.map(session => session.sessionId).filter(key => used.sessions.get(id)?.has(key)) } });
  for (const item of model.startLoad) if (START_WHAT.has(item.what)) add(base(item.path, item.path, 'start', 0, 0, item.tokens));
  // Step 11: only the context files that can be a need are on the page map. A file that is out has no box.
  // Step 5 built the test for this model, so this step reads no file.
  const { isNeed } = needTest(model);
  const shown = model.map.files.filter(file => isNeed(file.path));
  for (const file of shown) if (file.reach === 'start') add(base(file.path, file.path, 'start', 0, 0, file.tokens));
  if (shown.some(file => file.reach === 'path' && file.route[0]?.via === 'trigger')) add(base(SKILL_LIST, null, 'start', 0, 0, null));
  for (const file of shown) if (file.reach === 'path') add(base(file.path, file.path, 'steps', file.steps, file.steps, file.tokens));
  const lane = shown.filter(file => file.reach === 'none').map(file => base(file.path, file.path, 'none', null, null, file.tokens));
  // Needed files that the map does not know (and that are not gone) go to the lane too.
  for (const rel of used.needPaths) if (!nodes.has(rel) && !lane.some(node => node.id === rel) && !mapFiles.has(rel)) lane.push(base(rel, rel, 'none', null, null, null));
  lane.sort((a, b) => cmp(a.path, b.path)).forEach((node, k) => { node.row = k; add(node); });

  // Rows: the order of the route tree (a parent before its children, children by path), so a parent in the same column comes first.
  const parentOf = node => {
    const file = mapFiles.get(node.id);
    if (node.lane !== 'steps' || !file) return null;
    if (file.route.length >= 2) return file.route.at(-2).path;
    return file.route[0]?.via === 'trigger' ? SKILL_LIST : null;
  };
  const children = new Map();
  const tree = [...nodes.values()].filter(node => node.lane !== 'none');
  for (const node of tree) {
    const parent = parentOf(node);
    if (parent && nodes.has(parent)) children.set(parent, [...(children.get(parent) || []), node.id]);
  }
  const order = new Map();
  const visit = id => {
    if (order.has(id)) return;
    order.set(id, order.size);
    for (const child of (children.get(id) || []).sort(cmp)) visit(child);
  };
  for (const node of tree.filter(item => item.lane === 'start')) visit(node.id);
  for (const node of [...tree].sort((a, b) => cmp(a.id, b.id))) visit(node.id);
  const columns = new Map();
  for (const node of tree) columns.set(node.column, [...(columns.get(node.column) || []), node]);
  for (const list of columns.values()) list.sort((a, b) => order.get(a.id) - order.get(b.id)).forEach((node, k) => { node.row = k; });

  const list = [...nodes.values()].sort((a, b) => (a.lane === 'none') - (b.lane === 'none') || (a.column ?? 0) - (b.column ?? 0) || a.row - b.row);
  const treeEdges = tree.map(node => ({ from: parentOf(node), to: node.id })).filter(edge => edge.from && nodes.has(edge.from));
  return { list, treeEdges };
}

// ---------- main ----------

export function buildRoutes(model) {
  const mapFiles = new Map(model.map.files.map(file => [file.path, file]));
  const sessionsById = new Map(model.sessions.list.map(session => [session.sessionId, session]));
  const topStart = model.startLoad.filter(item => START_WHAT.has(item.what)).map(item => item.path);
  const groupOf = new Map();
  for (const group of model.groups.list) for (const member of group.members) groupOf.set(keyOf(member.sessionId, member.intentId), group.id);
  // A search jump starts at the project CLAUDE.md, else at the project instruction file of the start load
  // (AGENTS.md when Claude Code reads it in place of CLAUDE.md, step 10), else at the first start file.
  const projectStart = model.startLoad.find(item => item.scope === 'project' && item.what === 'instructions')?.path;
  const searchFrom = topStart.includes('CLAUDE.md') ? 'CLAUDE.md' : projectStart || topStart[0] || model.map.files.find(file => file.reach === 'start')?.path || null;

  const intents = [];
  for (const entry of model.needs.sessions) {
    const session = sessionsById.get(entry.sessionId);
    const startPaths = new Set([...topStart, ...session.startLoad.map(item => item.path)]);
    const walk = walker({ mapFiles, startPaths, session });
    for (const intent of entry.intents) {
      const needs = intent.needs.filter(need => need.kind === 'file' && need.state !== 'gone').map(need => {
        const { route, fromMap } = walk(need);
        const steps = need.map?.steps ?? null;
        const direct = (need.state === 'in_context' || need.state === 'path') && !WEAK.has(route[0].how);
        return { needId: need.id, path: need.path, state: need.state, steps, direct, fromMap, route };
      });
      const problems = needs.map(need => problemOf(need, rel => mapFiles.get(rel)?.steps ?? null)).filter(Boolean);
      for (const need of intent.needs.filter(item => item.kind === 'missing')) {
        problems.push(problem('missing', { text: need.text, quote: need.quote }));
      }
      intents.push({ sessionId: entry.sessionId, intentId: intent.intentId, groupId: groupOf.get(keyOf(entry.sessionId, intent.intentId)) ?? null,
        missing: intent.needs.filter(item => item.kind === 'missing').length, needs, problems });
    }
  }

  // Heat: the distinct intents and groups that have a file on a route.
  const used = { intents: new Map(), groups: new Map(), sessions: new Map(), edges: new Map(), needPaths: new Set() };
  const mark = (map, id, value) => map.set(id, (map.get(id) || new Set()).add(value));
  for (const item of intents) {
    const k = keyOf(item.sessionId, item.intentId);
    // One place for all 3 counts, so a box and the list of its sessions and intents agree.
    const use = id => { mark(used.intents, id, k); mark(used.groups, id, item.groupId); mark(used.sessions, id, item.sessionId); };
    for (const need of item.needs) {
      used.needPaths.add(need.path);
      // Heat counts the files the agent showed it used: the need, and each file of the route that is not from the map.
      for (const step of need.route) if (step.how !== 'map' || step.path === need.path) use(step.path);
      if (need.route[0].how === 'trigger') use(SKILL_LIST);
      for (const edge of edgesOf(need.route, searchFrom)) if (edge.kind === 'link' || edge.kind === 'trigger') mark(used.edges, `${edge.from}\u0000${edge.to}`, k);
    }
  }
  const nodes = buildMapNodes({ model, mapFiles, used });
  const onMap = new Set(nodes.treeEdges.map(edge => `${edge.from}\u0000${edge.to}`));
  const ids = new Set(nodes.list.map(node => node.id));
  const edges = [
    ...nodes.treeEdges.map(edge => ({ from: edge.from, to: edge.to, onMap: true })),
    ...[...used.edges.keys()].filter(key => !onMap.has(key)).map(key => key.split('\u0000')).filter(([from, to]) => ids.has(from) && ids.has(to))
      .map(([from, to]) => ({ from, to, onMap: false }))
  ].map(edge => ({ ...edge, intents: used.edges.get(`${edge.from}\u0000${edge.to}`)?.size || 0 }))
    .sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));

  // Metrics.
  const fileNeeds = intents.flatMap(item => item.needs);
  const missing = intents.reduce((sum, item) => sum + item.missing, 0);
  const counted = fileNeeds.length + missing;
  const direct = fileNeeds.filter(need => need.direct).length;
  const withSteps = fileNeeds.filter(need => need.steps != null);
  const stepSum = withSteps.reduce((sum, need) => sum + need.steps, 0);
  const metrics = {
    directReach: { percent: counted ? Math.round((100 * direct) / counted) : null, direct, counted },
    averageRoute: { steps: withSteps.length ? Math.round((10 * stepSum) / withSteps.length) / 10 : null, needs: withSteps.length },
    toldByUser: { count: missing }
  };

  const byGroup = model.groups.list.map(group => {
    const members = new Set(group.members.map(member => keyOf(member.sessionId, member.intentId)));
    const items = intents.filter(item => members.has(keyOf(item.sessionId, item.intentId)));
    const view = buildView(items, searchFrom);
    const sessionIds = new Set(group.members.map(member => member.sessionId));
    return { groupId: group.id, sessions: model.sessions.list.map(session => session.sessionId).filter(id => sessionIds.has(id)),
      weak: isWeak(view), told: isTold(view), ...view };
  });
  const bySession = model.sessions.list.map(session => {
    const items = intents.filter(item => item.sessionId === session.sessionId);
    const groupIds = [];
    for (const item of items) if (item.groupId && !groupIds.includes(item.groupId)) groupIds.push(item.groupId);
    return { sessionId: session.sessionId, intents: items.map(item => item.intentId), groups: groupIds, ...buildView(items, searchFrom) };
  });

  return {
    method: METHOD,
    metrics,
    map: { columns: Math.max(0, ...nodes.list.filter(node => node.lane !== 'none').map(node => node.column)) + 1, searchFrom,
      nodes: nodes.list, edges },
    intents: intents.map(({ missing: _m, ...item }) => item),
    byGroup,
    bySession
  };
}
