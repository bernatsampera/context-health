import path from 'node:path';
import { START_WHAT } from '../collect.mjs';
import { savedDuplicateFacts } from '../duplicates.mjs';
import { buildFixes } from '../fixes.mjs';
import { buildHealth } from '../health.mjs';
import { fileState } from '../needs.mjs';
import { render, sessionOverview } from '../render.mjs';
import { buildRoutes } from '../routes.mjs';
import { explorationCoverage, explorationEvents, projectLocation } from '../sessions.mjs';
import { withProof } from '../score-v1.mjs';
import { buildVersionMap, evaluateVersion } from './version-review.mjs';

const list = value => Array.isArray(value) ? value : [];
const projectPath = projectLocation;
const normalize = text => String(text || '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();

function sourceOf(known) {
  if (!known) return null;
  if (known.path && !projectPath(known.path)) return { kind: 'none', path: null };
  return { kind: known.kind, path: known.path ?? null };
}

// Keep the overview already shown to the owner and just the events needed to
// replay a route. Raw conversations, search results and tool output stay out.
export function freezeReportEvidence(report) {
  if (!report) return null;
  const entries = list(report.intents?.sessions).map(entry => ({
    sessionId: entry.sessionId, status: entry.status, reason: entry.reason,
    intents: list(entry.intents).map(({ id, goal, from, to }) => ({ id, goal, from, to }))
  }));
  const groups = list(report.groups?.list).map(({ id, label, members }) => ({
    id, label, members: list(members), count: list(members).length
  }));
  const intentsById = new Map(entries.map(s => [s.sessionId, s]));
  const groupOf = (sessionId, intentId) => groups.find(g => g.members.some(m => m.sessionId === sessionId && m.intentId === intentId))?.id ?? null;
  const sessions = list(report.sessions?.list).map(s => {
    const events = list(s.events).filter(e => projectPath(e.path) && ['load', 'read', 'edit'].includes(e.kind));
    const messages = list(s.messages);
    const searches = explorationEvents(s).filter(e => e.kind === 'search');
    const overview = sessionOverview({
      session: { ...s, events, messages, answers: list(s.answers) }, entry: intentsById.get(s.sessionId), groupOf
    });
    return {
      sessionId: s.sessionId, startedAt: s.startedAt, endedAt: s.endedAt, title: overview.title, overview,
      explorationCoverage: explorationCoverage(s),
      events: [...events.filter(e => e.kind !== 'edit').map(e => ({
        kind: e.kind, path: e.path, i: e.i, message: e.message, thread: e.thread, how: e.how, knownFrom: sourceOf(e.knownFrom)
      })), ...searches].sort((a, b) => a.i - b.i),
      messages: messages.filter(m => m.kind === 'command').map(m => ({ kind: 'command', text: m.text.split(/\s+/)[0] }))
    };
  });
  const needs = list(report.needs?.sessions).map(s => ({
    sessionId: s.sessionId, intents: list(s.intents).map(intent => ({
      intentId: intent.intentId, needs: list(intent.needs).filter(n => n.kind === 'missing' || projectPath(n.path)).map(n =>
        n.kind === 'missing' ? { kind: 'missing', text: n.text, quote: n.quote, savedPath: projectPath(n.savedPath) ? n.savedPath : null, savedQuote: n.savedQuote }
          : { id: n.id, kind: n.kind, path: n.path, scope: 'project', how: n.how, knownFrom: sourceOf(n.knownFrom),
              firstEvent: n.firstEvent, thread: n.thread, state: n.state })
    }))
  }));
  return {
    explorationVersion: 2,
    sessions: { list: sessions, skipped: list(report.sessions?.skipped).filter(Boolean).map(({ folder, file, reason }) => ({ folder, file, reason })) },
    intents: { sessions: entries, totals: { ...report.intents?.totals, ok: entries.filter(s => s.status === 'ok').length } },
    groups: { list: groups }, needs, taskFacts: report.needs?.taskFacts, dropped: report.needs?.dropped,
    duplicateFacts: list(report.duplicates?.facts).filter(fact => fact.source === 'model')
      .map(fact => ({ ...fact, places: list(fact.places).filter(place => projectPath(place.path)) })).filter(fact => fact.places.length >= 2),
    proof: report.health?.v1?.proof
  };
}

function versionNeeds(evidence, model) {
  const files = new Map(model.map.files.map(f => [f.path, f]));
  const entries = new Set(model.startLoad.filter(f => START_WHAT.has(f.what)).map(f => f.path));
  const events = new Map(model.sessions.list.map(s => [s.sessionId, s.events]));
  const sessions = list(evidence?.needs).filter(s => events.has(s.sessionId)).map(s => ({
    sessionId: s.sessionId, intents: s.intents.map(intent => ({
      intentId: intent.intentId, needs: intent.needs.map(original => {
        if (original.kind === 'missing') {
          const quote = normalize(original.savedQuote);
          const verified = quote && normalize(model.documents.get(original.savedPath)).includes(quote);
          return { ...original, savedPath: verified ? original.savedPath : null, savedQuote: verified ? original.savedQuote : null };
        }
        const file = files.get(original.path);
        const need = { ...original, exists: Boolean(file), map: file || null };
        need.state = !file ? 'gone' : fileState({ need, events: events.get(s.sessionId), startPaths: entries });
        return need;
      })
    }))
  }));
  return { sessions, taskFacts: evidence?.taskFacts || { list: [] }, dropped: evidence?.dropped };
}

export function renderVersionReport({ version, snapshot, basis, evidence }) {
  const model = buildVersionMap(snapshot, basis);
  model.project = { name: path.basename(basis.root), root: basis.root };
  model.sessions = {
    list: list(evidence?.sessions.list).map(s => ({ ...s, startLoad: [] })),
    skipped: list(evidence?.sessions.skipped)
  };
  model.intents = evidence?.intents || { sessions: [], totals: { ok: 0 } };
  model.groups = evidence?.groups || { list: [] };
  model.needs = versionNeeds(evidence, model);
  model.routes = buildRoutes(model);
  model.totals = {
    contextFiles: snapshot.files.length, startLoadItems: model.startLoad.length,
    startLoadTokens: model.startLoad.reduce((sum, item) => sum + (item.tokens || 0), 0)
  };
  model.duplicates = {
    facts: savedDuplicateFacts(snapshot.files, evidence?.duplicateFacts || []),
    check: { status: 'not-analysed', checked: 0, total: snapshot.files.length, needed: 0, neededChecked: 0 }
  };
  if (version.shown === 'no-sessions') {
    const untested = {
      ...model, sessions: { list: [], skipped: [] }, intents: { sessions: [] },
      needs: { sessions: [] }, routes: { intents: [] }
    };
    model.health = buildHealth(untested);
    Object.assign(model.health.v1, { shown: version.shown, score: version.score, reason: version.scoreReason });
    model.fixes = buildFixes({ ...untested, health: model.health });
    model.prompt = { text: '' };
    return render(model, { version, evidence: Boolean(evidence) });
  }
  model.health = buildHealth(model);
  // Historical versions can have a score without their full session detail.
  // Preserve the exact scoring sample used at capture, including needs for
  // files absent in this revision, without inventing sessions to display.
  const evaluated = evaluateVersion(snapshot, basis, model);
  const score = model.health.v1;
  const matchesSample = evidence && score.score === evaluated.scorecard.score
    && Object.keys(evaluated.grades).every(key => score.grades[key] === evaluated.grades[key]);
  if (!matchesSample) {
    const summary = evaluated.scorecard;
    // The compact scoring basis holds counts but no text for historical rules.
    for (const question of summary.questions) {
      const known = question.items.filter(item => item.kind !== 'fact');
      if (known.length < question.items.length) question.lines.push('The original text of these rules is unavailable for this version.');
      question.items = known;
      question.n = known.length;
    }
    summary.facts.rule = [];
    model.health.v1 = summary;
  }
  const proof = evidence?.proof;
  withProof(model.health.v1, proof?.text ? proof : {
    status: basis.proven ? 'pass' : 'no-data',
    text: basis.proven ? 'The historical check passed. Its details are unavailable for this version.' : 'No historical check was saved.'
  });
  if (!evidence) model.health.counts.sessions = null;
  model.fixes = buildFixes(model);
  model.prompt = { text: '' };
  return render(model, { version, evidence: Boolean(evidence) });
}
