// Step 11: how the sessions found each needed file. A pure function: no model call, no file read.
// The counts of the page (src/health.mjs) and the fixes (src/fixes.mjs) both use it, so they agree on which file
// has no route and which file the agent searched.
//
// One entry for each needed file (a context file that 1 or more intents read, not gone):
// - `steps`: the steps of the file on the map (`fixContext().stepsOf`). `null` means no route.
// - `state`: `start` (0 steps), `no-route`, `searched` (a route of 1 step or more, and 1 or more weak needs), `links`.
// - `searched`: the needs of the file that the agent did not reach by links. `ways` says how: `search` (a search gave
//   the path), `user` (the user gave the path), `none` (nothing that the session shows named the path).
// - `linker`: the last link of the map route: the file and the line that name the needed file. `null` with no route
//   and for a start file.
//
// A need is not weak in 3 cases:
// - The text was in the context before the intent (`in_context`): the agent did not look for the file.
// - The agent reached the file by a link from another file. When that other file was found by a search, the search
//   counts for that other file, not for this one.
// - Nothing named the path, but the start names the file in another way: a memory file that the memory index links
//   (the session record does not hold the index), or a body behind a trigger (the skill list names the skill).
import { isNamed } from './context-files.mjs';

const WEAK = new Set(['search', 'user', 'none']);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// How one need was found when it was not by links: `search`, `user`, `none`, or `null`.
export function weakWayOf(need) {
  if (need.state === 'in_context') return null;
  if (need.state === 'search') return 'search';
  const head = need.route[0];
  return head && head.path === need.path && WEAK.has(head.how) ? head.how : null;
}

export function searchedWayOf(need, mapFiles) {
  const way = weakWayOf(need);
  if (way !== 'none') return way;
  const file = mapFiles.get(need.path);
  // The start can name a skill or a memory file even when its path is absent from the record.
  const namedAtStart = file?.steps === 1 && (file.route.at(-1)?.via === 'trigger' ||
    mapFiles.get(file.route.at(-2)?.path)?.kind === 'memory index');
  return namedAtStart ? null : way;
}

// `ctx` is the result of `fixContext(model)` of src/health.mjs.
export function foundFiles(model, ctx) {
  const mapFiles = ctx.mapFiles;
  const linkerOf = rel => {
    const file = mapFiles.get(rel);
    if (!file || !file.steps) return null;
    const last = file.route.at(-1);
    const from = file.route.at(-2)?.path ?? null;
    // A trigger has no file: the skill, command and agent list of the start load names the body.
    return { path: from, line: last.line ?? null, via: last.via, named: from == null ? true : isNamed(mapFiles.get(from)) };
  };
  const files = new Map();
  for (const intent of model.routes.intents) {
    for (const need of intent.needs) {
      const entry = files.get(need.path) || { path: need.path, uses: 0, steps: ctx.stepsOf(need.path), state: null, searched: 0,
        ways: { search: 0, user: 0, none: 0 }, linker: linkerOf(need.path) };
      entry.uses += 1;
      const way = searchedWayOf(need, mapFiles);
      if (way) { entry.searched += 1; entry.ways[way] += 1; }
      files.set(need.path, entry);
    }
  }
  for (const entry of files.values()) {
    entry.state = entry.steps == null ? 'no-route' : entry.steps === 0 ? 'start' : entry.searched ? 'searched' : 'links';
  }
  return [...files.values()].sort((a, b) => b.uses - a.uses || cmp(a.path, b.path));
}
