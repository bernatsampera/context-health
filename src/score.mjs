// Step 6: the score. A pure function of the report: no model calls, no file reads.
// Each intent gets 3 sub-scores from 0 to 100 (Found, Cheap, No missing) and their plain average.
// A session is the average of its scored intents. The project is the average of all scored intents.
// No data gives null with a reason, never 0, 100 or NaN. Numbers are rounded only in the output.
import { needTest } from './context-files.mjs';
import { startPathsOf } from './needs.mjs';

const METHOD = 'Score = average of Found, Cheap and No missing, 0 to 100.';
const LABELS = { good: 75, mixed: 50 };
const FIX_FIRST = 5;
const KIND_ORDER = { search: 0, no_path: 1, missing: 2 };

const mean = list => {
  const values = list.filter(value => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const round = value => value == null ? null : Math.round(value);
const labelOf = value => value == null ? null : value >= LABELS.good ? 'good' : value >= LABELS.mixed ? 'mixed' : 'poor';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Returns the exact values (for the averages) and the output object (rounded).
function scoreIntent(intent, session, startPaths, isNeed) {
  // A gone file (not on disk now, not on the map) is not counted anywhere: the session is older than the tree.
  const gone = intent.needs.filter(need => need.kind === 'file' && need.state === 'gone');
  const files = intent.needs.filter(need => need.kind === 'file' && need.state !== 'gone');
  const missingCount = intent.needs.filter(need => need.kind === 'missing').length;
  const foundCount = files.filter(need => need.state === 'in_context' || need.state === 'path').length;
  const found = files.length ? 100 * foundCount / files.length : null;

  // Cheap, per thread: a subagent starts with an empty conversation, so each thread has its own window.
  // A needed read is the first read in its thread of a need path that was not in the context of that thread
  // (the start load, or an earlier read or load in the same thread). The window of a thread ends at its last
  // needed read. readTokens = all reads of need paths in the windows (also repeats) + the search results in the windows.
  // Gone files are left out.
  const gonePaths = new Set(gone.map(need => need.path));
  const counts = path => isNeed(path) && !gonePaths.has(path);
  const inRange = event => event.message != null && event.message >= intent.from && event.message <= intent.to;
  const cheapOut = { score: null, neededTokens: 0, readTokens: 0, reads: 0, searches: 0, searchTokens: 0, windowEnd: null };
  const had = new Map();
  const windowEnd = new Map();
  for (const event of session?.events || []) {
    if (!had.has(event.thread)) had.set(event.thread, new Set(startPaths));
    const known = had.get(event.thread);
    if (event.kind === 'read' && inRange(event) && counts(event.path) && !known.has(event.path)) {
      cheapOut.neededTokens += event.tokens ?? 0;
      windowEnd.set(event.thread, event.i);
    }
    if ((event.kind === 'read' || event.kind === 'load') && event.path) known.add(event.path);
  }
  let cheap = null;
  if (windowEnd.size) {
    cheapOut.windowEnd = Math.max(...windowEnd.values());
    for (const event of session.events) {
      if (!inRange(event) || !windowEnd.has(event.thread) || event.i > windowEnd.get(event.thread)) continue;
      if (event.kind === 'read' && counts(event.path)) {
        cheapOut.reads += 1;
        cheapOut.readTokens += event.tokens ?? 0;
      } else if (event.kind === 'search') {
        cheapOut.searches += 1;
        cheapOut.searchTokens += event.tokens ?? 0;
        cheapOut.readTokens += event.tokens ?? 0;
      }
    }
    if (cheapOut.readTokens > 0) cheap = 100 * cheapOut.neededTokens / cheapOut.readTokens;
  }

  // An intent with no needs (or only gone files) is in no average, so it gets no Missing score either.
  const none = intent.needs.length === gone.length;
  const missing = none ? null : 100 / (1 + missingCount);
  const score = none ? null : mean([found, cheap, missing]);
  cheapOut.score = round(cheap);
  return {
    exact: { score, found, cheap, missing, fileNeeds: files.length + gone.length, goneNeeds: gone.length },
    out: {
      intentId: intent.intentId, from: intent.from, to: intent.to,
      score: round(score), label: labelOf(round(score)), reason: none ? (gone.length ? 'only-gone-files' : 'needs-no-context') : null,
      found: { score: round(found), found: foundCount, counted: files.length, gone: gone.length },
      cheap: cheapOut,
      missing: { score: round(missing), count: missingCount }
    }
  };
}

function fixFirst(needSessions) {
  const lines = [];
  const groups = new Map();
  for (const entry of needSessions) {
    for (const intent of entry.intents) {
      for (const need of intent.needs) {
        const ref = { sessionId: entry.sessionId, intentId: intent.intentId, needId: need.id };
        let line;
        if (need.kind === 'file' && (need.state === 'search' || need.state === 'no_path')) {
          const key = `${need.state}\n${need.path}`;
          line = groups.get(key);
          if (!line) {
            line = { kind: need.state, path: need.path, text: null, intentKeys: new Set(), sessionKeys: new Set(), refs: [] };
            groups.set(key, line);
            lines.push(line);
          }
        } else if (need.kind === 'missing') {
          line = { kind: 'missing', path: null, text: need.text, intentKeys: new Set(), sessionKeys: new Set(), refs: [] };
          lines.push(line);
        } else continue;
        line.intentKeys.add(`${entry.sessionId}:${intent.intentId}`);
        line.sessionKeys.add(entry.sessionId);
        line.refs.push(ref);
      }
    }
  }
  return lines
    .map(line => ({ kind: line.kind, path: line.path, text: line.text, intents: line.intentKeys.size, sessions: line.sessionKeys.size, refs: line.refs }))
    .sort((a, b) => b.intents - a.intents || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compare(a.path ?? a.text ?? '', b.path ?? b.text ?? ''))
    .slice(0, FIX_FIRST);
}

export function score(model) {
  const list = model.sessions?.list || [];
  const statusById = new Map((model.intents?.sessions || []).map(entry => [entry.sessionId, entry.status]));
  const needSessions = model.needs?.sessions || [];
  const needsById = new Map(needSessions.map(entry => [entry.sessionId, entry]));
  const all = [];
  // The same test as the needs (step 11). Step 5 built it for this model, so this step reads no file.
  const { isNeed } = needTest(model);

  const sessions = list.map(session => {
    const status = statusById.get(session.sessionId) ?? 'not-analysed';
    const needs = status === 'ok' ? needsById.get(session.sessionId) : null;
    const startPaths = startPathsOf(model, session);
    const results = (needs?.intents || []).map(intent => scoreIntent(intent, session, startPaths, isNeed));
    const scored = results.filter(result => result.exact.score != null).map(result => result.exact);
    all.push(...scored);
    const value = mean(scored.map(item => item.score));
    const reason = status !== 'ok' ? status : scored.length ? null : 'no-scored-intents';
    return {
      sessionId: session.sessionId,
      score: round(value), label: labelOf(round(value)), reason,
      found: round(mean(scored.map(item => item.found))), cheap: round(mean(scored.map(item => item.cheap))),
      missing: round(mean(scored.map(item => item.missing))),
      intents: results.length, scoredIntents: scored.length,
      fileNeeds: results.reduce((sum, result) => sum + result.exact.fileNeeds, 0),
      goneNeeds: results.reduce((sum, result) => sum + result.exact.goneNeeds, 0),
      intentScores: results.map(result => result.out)
    };
  });

  const value = mean(all.map(item => item.score));
  const reason = !list.length ? 'no-sessions' : all.length ? null : 'no-scored-intents';
  return {
    method: METHOD,
    labels: { ...LABELS },
    project: {
      score: round(value), label: labelOf(round(value)), reason,
      found: round(mean(all.map(item => item.found))), cheap: round(mean(all.map(item => item.cheap))),
      missing: round(mean(all.map(item => item.missing))),
      sessions: list.length, scoredSessions: sessions.filter(entry => entry.score != null).length,
      intents: sessions.reduce((sum, entry) => sum + entry.intents, 0), scoredIntents: all.length
    },
    fixFirst: fixFirst(needSessions),
    sessions
  };
}
