// Reuse the report's map and v3 scoring rules on the exact saved documents.
// The scoring basis holds the compact inputs needed to compare versions.
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { tokens } from '../collect.mjs';
import { fixContext } from '../health.mjs';
import { buildMap } from '../map.mjs';
import { buildV1, METHOD } from '../score-v1.mjs';
import { hasPhrase, normalized } from './map-benchmark.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const norm = (text) =>
  String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
const safe = (file) =>
  typeof file === 'string' &&
  file &&
  !path.isAbsolute(file) &&
  !file.startsWith('~/') &&
  path.normalize(file) === file &&
  !file.startsWith('../');
const arrays = (value) => (Array.isArray(value) ? value : []);

// Navigation describes the files in this map. Historical needs and session
// evidence stay fixed when a refactor reorganizes entry files, skills or guides.
export function savedNavigation(snapshot, source) {
  const paths = new Set(snapshot.files.map((file) => file.path));
  const localItems = (items) => arrays(items)
    .filter((item) => item.scope === 'project' && paths.has(item.path))
    .map((item) => ({
      scope: 'project',
      what: item.what,
      path: item.path,
      tokens: item.tokens ?? null,
      ...(item.name ? { name: item.name } : {}),
      ...(item.body?.path ? { body: { path: item.body.path } } : {})
    }));
  return {
    start: localItems(source?.startLoad).filter(
      (item) => snapshot.entries.includes(item.path) || item.what.endsWith(' description')
    ),
    later: localItems(source?.later)
  };
}

export function readReportSource({ dir, root }) {
  const file = path.join(dir, 'report.json');
  let fd, report, evidenceAt;
  try {
    fd = openSync(file, 'r');
    const before = fstatSync(fd, { bigint: true });
    report = JSON.parse(readFileSync(fd, 'utf8'));
    const after = fstatSync(fd, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      throw new Error('The report changed while it was being read.');
    evidenceAt = after.mtime.toISOString();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('The report could not be read. Refresh the report and try again.');
    return { report: null, evidenceAt: null };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const sameProject = (a, b) => {
    if (a === b) return true;
    if (typeof a !== 'string' || !path.isAbsolute(a)) return false;
    try {
      return realpathSync(a) === realpathSync(b);
    } catch {
      return false;
    }
  };
  return sameProject(report?.project?.root, root) && report?.health?.v1?.method === METHOD
    ? { report, evidenceAt }
    : { report: null, evidenceAt: null };
}

export function freezeEvidence({ dir, root, snapshot, navigation, source = readReportSource({ dir, root }) }) {
  const { report, evidenceAt } = source;
  const paths = new Set(snapshot.files.map((f) => f.path));
  const { start, later } = savedNavigation(snapshot, navigation || report);
  const analysed = arrays(report?.intents?.sessions).filter((s) => s.status === 'ok');
  const ids = new Set(analysed.map((s) => s.sessionId));
  const loaded = new Set(),
    commands = new Set();
  for (const s of arrays(report?.sessions?.list))
    if (ids.has(s.sessionId)) {
      for (const e of arrays(s.events))
        if ((e.kind === 'read' || e.kind === 'load') && paths.has(e.path)) loaded.add(e.path);
      for (const m of arrays(s.messages)) if (m.kind === 'command') commands.add(String(m.text).split(/\s+/)[0]);
    }
  const titles = new Map(arrays(report?.sessions?.list).map((s) => [s.sessionId, s.title]));
  const fileNeeds = arrays(report?.routes?.intents).flatMap((i) =>
    arrays(i.needs)
      .filter((n) => typeof n.path === 'string')
      .map((n) => ({
        path: safe(n.path) ? n.path : '(outside saved map)',
        state: n.state,
        session: typeof titles.get(i.sessionId) === 'string' ? titles.get(i.sessionId).slice(0, 200) : null,
        route: n.route?.[0]?.how ? [{ how: n.route[0].how }] : []
      }))
  );
  const documents = new Map(snapshot.files.map((f) => [f.path, f.text]));
  const facts = arrays(report?.needs?.sessions).flatMap((s) =>
    arrays(s.intents).flatMap((i) =>
      arrays(i.needs)
        .filter((n) => n.kind === 'missing')
        .map((n) => ({
          path:
            n.savedQuote && documents.has(n.savedPath) && norm(documents.get(n.savedPath)).includes(norm(n.savedQuote))
              ? n.savedPath
              : null
        }))
    )
  );
  return {
    root,
    start,
    later,
    fileNeeds,
    facts,
    evidenceAt: report ? evidenceAt : null,
    analysed: analysed.length,
    ran: analysed.some((s) => s.intents?.length),
    total: arrays(report?.sessions?.list).length + arrays(report?.sessions?.skipped).length,
    loaded: [...loaded],
    commands: [...commands],
    proven: report?.health?.v1?.proof?.status === 'pass',
    scope: digest([METHOD, [...ids].sort(), fileNeeds, facts])
  };
}

export function buildVersionMap(snapshot, basis) {
  const documents = new Map(snapshot.files.map((f) => [f.path, f.text]));
  const navigation = snapshot.navigation || basis;
  const startLoad = navigation.start.map((i) => ({
    ...i,
    tokens: i.what.endsWith(' description') ? i.tokens : tokens(documents.get(i.path) || '')
  }));
  for (const name of snapshot.entries)
    if (!startLoad.some((i) => i.path === name))
      startLoad.push({ scope: 'project', what: 'instructions', path: name, tokens: tokens(documents.get(name) || '') });
  const model = {
    claudeSettingsHome: basis.root,
    listing: { method: 'walk' },
    startLoad,
    later: navigation.later,
    ignore: ['user']
  };
  const built = buildMap({
    root: basis.root,
    model,
    documents,
    files: [...documents.keys()],
    config: { include: ['**'], exclude: [] }
  });
  return { ...model, ...built, documents };
}

// A saved map needs its own session evidence before it can receive a rating.
export function untestedVersionScore() {
  return {
    score: 0,
    shown: 'no-sessions',
    scoreReason: 'No sessions run on this version.',
    grades: { served: 0, slow: 0, searched: 0, missed: 0, total: 0 },
    scoreEvidenceAt: null
  };
}

export function evaluateVersion(snapshot, basis, model = buildVersionMap(snapshot, basis)) {
  const { map, documents } = model;
  const links = map.files.flatMap((f) => f.linkedFrom.map((l) => ({ from: l.path, to: f.path, via: l.via, line: l.line })));
  const sessions = Array.from({ length: basis.analysed }, (_, i) => ({
    sessionId: String(i),
    status: 'ok',
    intents: basis.ran ? [{}] : []
  }));
  const replay = {
    ...model,
    map,
    routes: { intents: [{ needs: basis.fileNeeds }] },
    intents: { sessions },
    sessions: {
      list: sessions.map((s, i) => ({
        sessionId: s.sessionId,
        events: i === 0 ? basis.loaded.map((p) => ({ kind: 'read', path: p })) : [],
        messages: i === 0 ? basis.commands.map((text) => ({ kind: 'command', text })) : []
      })),
      skipped: Array(Math.max(0, basis.total - sessions.length))
    },
    needs: {
      sessions: [
        {
          intents: [
            {
              needs: basis.facts.map((f, i) => ({
                kind: 'missing',
                text: String(i),
                savedPath:
                  documents.has(f.path) && (!f.quote || norm(documents.get(f.path)).includes(norm(f.quote))) ? f.path : null
              }))
            }
          ]
        }
      ]
    }
  };
  const context = fixContext(replay);
  const scorecard = buildV1(replay, context, basis.analysed ? 'no-needs' : 'not-analysed');
  const shown = scorecard.shown === 'not-proven' && basis.proven ? 'score' : scorecard.shown;
  const score = shown === 'score' ? scorecard.score : null;
  const scoreReason =
    shown === 'score'
      ? null
      : shown === 'not-proven'
        ? 'The historical check has not confirmed this score.'
        : scorecard.reason;
  return {
    links,
    scorecard,
    context,
    mapFiles: context.mapFiles,
    score,
    scoreReason,
    shown,
    grades: scorecard.grades,
    scoreScope: basis.scope,
    scoreEvidenceAt: basis.evidenceAt ?? null,
    ...(basis.total === 0 && !basis.analysed && untestedVersionScore())
  };
}

export function versionFindings({ snapshot, basis, evaluated, questions, results, includeProposals }) {
  const documents = new Map(snapshot.files.map((f) => [f.path, f.text])),
    used = new Map(),
    struggles = [];
  const add = (key, title, detail, source, extra = {}) => {
    struggles.push({ id: digest(key), title, detail, source, sessions: [], ...extra });
  };
  for (const n of basis.fileNeeds)
    if (documents.has(n.path)) {
      const item = used.get(n.path) || { source: n.path, count: 0, sessions: new Set() };
      item.count++;
      if (n.session) item.sessions.add(n.session);
      used.set(n.path, item);
    }
  for (const r of results) {
    const q = questions.find((i) => i.id === r.questionId);
    if (!q || r.status === 'error') continue;
    const searched = r.steps?.some((s) => s.action === 'search');
    if (r.status === 'correct' && !searched) continue;
    const match = (file) => documents.has(file) && hasPhrase(normalized(documents.get(file)), normalized(q.expected));
    const explicit = [q.source, r.source].find((p) => p && match(p));
    const candidates = explicit ? [] : snapshot.files.filter((f) => match(f.path));
    const source = explicit || (candidates.length === 1 ? candidates[0].path : null);
    add(
      ['benchmark', q.id, q.revision, r.status, source],
      q.question,
      r.status === 'correct'
        ? 'The agent answered correctly after searching the saved files.'
        : 'The agent missed the expected answer in this version.',
      source
    );
  }
  const priority = (item) => (evaluated.mapFiles.get(item.source)?.steps == null ? 2 : 1) * item.count;
  for (const { source: file, count, sessions } of [...used.values()].sort(
    (a, b) => priority(b) - priority(a) || b.count - a.count || a.source.localeCompare(b.source)
  )) {
    const node = evaluated.mapFiles.get(file);
    const folder = node?.route?.some((s) => s.via === 'folder');
    if (!node || node.steps === 0 || (node.steps === 1 && !folder)) continue;
    const suffix = count === 1 ? 'recorded need' : 'recorded needs';
    const route =
      node.steps === null
        ? 'No link from a starting file reaches this guide.'
        : folder
          ? 'The route to this guide goes through a folder link.'
          : `It takes ${node.steps} links to reach this guide.`;
    const title =
      documents.get(file).match(/^#\s+([^\n\r]+)/m)?.[1] || path.basename(file, path.extname(file)).replaceAll('-', ' ');
    add(['route', file, count, node.steps], title.slice(0, 140), `${route} It appeared in ${count} ${suffix}.`, file, {
      needCount: count,
      sessions: [...sessions]
    });
  }
  const proposals = [];
  if (includeProposals) {
    // Prefer the project instruction file. A project with no entry can gain one
    // in its child. Never overwrite an existing file that is outside the entries.
    const entry =
      snapshot.entries.find((f) => /(^|\/)(CLAUDE|AGENTS)\.md$/.test(f)) ||
      snapshot.entries[0] ||
      (!documents.has('CLAUDE.md') ? 'CLAUDE.md' : null);
    const grouped = new Map();
    for (const s of struggles)
      if (s.source && documents.has(s.source) && entry && s.source !== entry) {
        const direct =
          snapshot.entries.includes(s.source) ||
          snapshot.links.some((l) => snapshot.entries.includes(l.from) && l.to === s.source && l.via !== 'folder');
        if (!direct) {
          const gap = evaluated.mapFiles.get(s.source)?.steps == null ? evaluated.context.gapOf(s.source) : s.source;
          const target = documents.has(gap) && gap !== entry ? gap : s.source;
          const matches = grouped.get(target) || [];
          matches.push(s);
          grouped.set(target, matches);
        }
      }
    for (const [target, matches] of grouped) {
      // An unsafe filename cannot be represented by a single Markdown link.
      if (/[\r\n\u0000]/.test(target)) continue;
      const heading =
        documents.get(target).match(/^#\s+([^\n\r]+)/m)?.[1] ||
        path.basename(target, path.extname(target)).replaceAll('-', ' ');
      const label =
        heading
          .replace(/[\[\]<>\\]/g, '')
          .trim()
          .slice(0, 100) || 'Project guide';
      const rel = path.posix.relative(path.posix.dirname(entry), target);
      const href = rel
        .split('/')
        .map((s) => encodeURIComponent(s).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29')))
        .join('/');
      const after = `- [${label}](${href})`,
        struggleIds = matches.map((s) => s.id);
      proposals.push({
        id: digest([snapshot.revision, entry, after, struggleIds]),
        title: `Link to ${label}`,
        reason: matches[0].detail,
        file: entry,
        target,
        before: '',
        after,
        struggleIds
      });
    }
  }
  return { struggles, proposals };
}
