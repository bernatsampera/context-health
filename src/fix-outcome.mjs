import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { collect, listFiles, START_WHAT } from './collect.mjs';
import { ignoreStart } from './ignore.mjs';
import { buildMap } from './map.mjs';
import { relatedFiles } from './fixes.mjs';

const unique = values => [...new Set(values)];

export function fixBaseline(model, findings) {
  const paths = unique(model.routes.intents.flatMap(intent => intent.needs.map(need => need.path)));
  const related = unique(findings.flatMap(relatedFiles));
  return {
    sessions: unique(model.intents.sessions.filter(item => item.status === 'ok').map(item => item.sessionId)),
    knownSessions: model.sessions.list.map(session => session.sessionId),
    paths, related,
    rules: findings.filter(finding => finding.rule).map(finding => ({ text: finding.rule, files: relatedFiles(finding) })),
    readPaths: unique(model.sessions.list.flatMap(session => session.events
      .filter(event => event.kind === 'read' || event.kind === 'load').map(event => event.path).filter(Boolean))),
    ignore: model.ignore || []
  };
}

export function measureFix(baseline, options) {
  const { root, home, config } = options;
  const model = ignoreStart(collect(options), { root, home, ignore: baseline.ignore });
  const { files } = listFiles(root);
  const sessions = { list: [{ events: baseline.readPaths.map(path => ({ path, kind: 'read' })) }] };
  const { map } = buildMap({ root, model, files, sessions, config });
  const steps = new Map(model.startLoad.filter(file => START_WHAT.has(file.what)).map(file => [file.path, 0]));
  for (const file of map.files) steps.set(file.path, file.steps);
  const contents = new Map(baseline.related.map(file => {
    const absolute = file.startsWith('~/') ? path.join(home, file.slice(2)) : path.resolve(root, file);
    try { return [file, readFileSync(absolute)]; } catch { return [file, null]; }
  }));
  const normalize = text => text.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  const rules = (baseline.rules || []).map(rule => rule.files.filter(file => {
    const content = contents.get(file);
    return content && normalize(content.toString('utf8')).includes(normalize(rule.text));
  }));
  return {
    rules, startTokens: model.totals.startLoadTokens,
    hashes: Object.fromEntries([...contents].map(([file, content]) => [file, content && createHash('sha256').update(content).digest('hex')])),
    steps: Object.fromEntries(unique([...baseline.paths, ...baseline.related]).map(path => [path, steps.get(path) ?? null]))
  };
}

export function fixOutcome(baseline, before, after, files, at) {
  const count = (measure, startTokens) => {
    const reachable = baseline.paths.filter(file => measure(file) != null).length;
    return { reachable, unreachable: baseline.paths.length - reachable, startTokens };
  };
  const changedPaths = baseline.paths.filter(file => before.steps[file] !== after.steps[file]);
  const changedFiles = files ?? baseline.related.filter(file => before.hashes[file] !== after.hashes[file]);
  return { at, files: changedFiles, sessions: baseline.sessions.length, knownSessions: baseline.knownSessions,
    before: count(file => before.steps[file], before.startTokens), after: count(file => after.steps[file], after.startTokens),
    rules: (baseline.rules || []).map((rule, index) => ({ text: rule.text, before: before.rules[index], after: after.rules[index] })),
    routes: unique([...baseline.related, ...changedPaths]).map(path => ({ path, before: before.steps[path], after: after.steps[path] })),
    ignore: baseline.ignore };
}

export function observeLater(model, outcome) {
  const known = new Set(outcome.knownSessions || []);
  const ids = new Set(model.sessions.list.filter(session => !known.has(session.sessionId) && Date.parse(session.startedAt) > Date.parse(outcome.at)).map(session => session.sessionId));
  const analysed = model.intents.sessions.filter(session => ids.has(session.sessionId) && session.status === 'ok');
  const paths = new Set(outcome.routes.map(route => route.path));
  let searched = 0;
  let followed = 0;
  for (const intent of model.routes.intents) {
    if (!ids.has(intent.sessionId)) continue;
    for (const need of intent.needs) {
      if (!paths.has(need.path) || need.state === 'in_context') continue;
      const how = need.route.at(-1)?.how;
      if (how === 'search') searched += 1;
      if (how === 'link') followed += 1;
    }
  }
  return { sessions: analysed.length, searched, followed };
}
