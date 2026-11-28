import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { collect, listFiles, START_WHAT } from '../collect.mjs';
import { isTextFile, readConfig } from '../context-files.mjs';
import { DEFAULT_IGNORE, ignoreStart } from '../ignore.mjs';
import { buildMap } from '../map.mjs';
import { explorationEvents } from '../sessions.mjs';
import { hasPhrase, normalized } from './map-benchmark.mjs';
import { evaluateVersion, freezeEvidence, readReportSource, savedNavigation, untestedVersionScore, versionFindings } from './version-review.mjs';
import { freezeReportEvidence } from './version-report.mjs';

// Versions, questions and results share one transaction. A running benchmark holds
// a revision so an older result can never be attached to newly captured files.
const schema = `
  CREATE TABLE versions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, nameKey TEXT UNIQUE NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, revision TEXT NOT NULL,
    fileCount INTEGER NOT NULL, snapshot TEXT NOT NULL
  );
  CREATE TABLE questions (
    id TEXT PRIMARY KEY, question TEXT NOT NULL, questionKey TEXT UNIQUE NOT NULL, expected TEXT NOT NULL
  );
  CREATE TABLE results (
    versionId TEXT REFERENCES versions(id), questionId TEXT REFERENCES questions(id),
    data TEXT NOT NULL, PRIMARY KEY (versionId, questionId)
  );
  PRAGMA user_version = 1;
`;

function store(dir, write, task) {
  const folder = path.join(dir, 'map-versions');
  const file = path.join(folder, 'versions.sqlite');
  if (!write && !existsSync(file)) return task(null);
  if (write) mkdirSync(folder, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file, { readOnly: !write });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version === 0 && write) db.exec(schema);
    else if (version === 0) return task(null);
    else if (version > 4) throw new Error('This map was saved with a different version of Context Health.');
    if (write && version < 2)
      db.exec(`
      ALTER TABLE versions ADD COLUMN metadata TEXT;
      ALTER TABLE versions ADD COLUMN basis TEXT;
      ALTER TABLE questions ADD COLUMN metadata TEXT;
      PRAGMA user_version = 2;`);
    if (write && version < 3)
      db.exec(`
      CREATE TABLE refactor (
        slot INTEGER PRIMARY KEY CHECK (slot = 1), id TEXT UNIQUE NOT NULL,
        versionId TEXT NOT NULL REFERENCES versions(id), revision TEXT NOT NULL,
        startedAt TEXT NOT NULL, startingFilesHash TEXT NOT NULL,
        existingPaths TEXT NOT NULL, reviewedRevision TEXT
      );
      PRAGMA user_version = 3;`);
    if (write && version < 4)
      db.exec(`
      CREATE TABLE reportEvidence (id TEXT PRIMARY KEY, contents BLOB NOT NULL);
      CREATE TABLE versionReports (
        versionId TEXT PRIMARY KEY REFERENCES versions(id), evidenceId TEXT REFERENCES reportEvidence(id),
        origin TEXT NOT NULL, reportKey TEXT NOT NULL
      );
      PRAGMA user_version = 4;`);
    const value = task(db);
    db.exec('COMMIT');
    return value;
  } finally {
    db.close();
  }
}

function pendingRefactor(db) {
  return db.prepare(`SELECT r.id, r.versionId, v.name AS versionName, r.revision, r.startedAt,
    json_array_length(r.existingPaths) AS existingChangeCount
    FROM refactor r JOIN versions v ON v.id = r.versionId WHERE r.slot = 1`).get() || null;
}

const versionColumns = 'id, name, createdAt, updatedAt, fileCount, revision';
function publicVersion({ metadata, sessionTotal, ...row }) {
  const saved = JSON.parse(metadata || '{}');
  return {
    ...row,
    parentId: null,
    parentRevision: null,
    appliedCount: 0,
    appliedFixes: [],
    score: null,
    shown: 'no-data',
    grades: null,
    scoreReason: 'Review this version to calculate its score.',
    ...saved,
    ...(((saved.parentId && !saved.recaptured) || sessionTotal === 0) && untestedVersionScore())
  };
}

function state(db) {
  if (!db) return { versions: [], questions: [], results: [], refactor: null };
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  const extra = schemaVersion >= 2 ? ', metadata' : '';
  const reportKey = schemaVersion >= 4
    ? ', (SELECT reportKey FROM versionReports WHERE versionId = versions.id) AS reportKey' : ', NULL AS reportKey';
  return {
    refactor: schemaVersion >= 3 ? pendingRefactor(db) : null,
    versions: db
      .prepare('SELECT ' + versionColumns + extra + (schemaVersion >= 2 ? ", json_extract(basis,'$.total') AS sessionTotal" : '') + reportKey + ' FROM versions ORDER BY rowid')
      .all()
      .map(publicVersion),
    questions: db
      .prepare('SELECT id, question, expected' + extra + ' FROM questions ORDER BY rowid')
      .all()
      .map(({ metadata, ...row }) => ({
        ...row,
        intentId: null,
        intentLabel: null,
        source: null,
        ...JSON.parse(metadata || '{}'),
        revision: questionRevision(row)
      })),
    results: db
      .prepare('SELECT data FROM results ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(row.data))
  };
}

const checkedLegacy = new Map();
export function mapState({ dir, root }) {
  const current = store(dir, false, state);
  if (!root) return current;
  const pending = current.versions.filter((version) => !version.scoreScope);
  if (!pending.length) return current;
  const report = statSync(path.join(dir, 'report.json'), { throwIfNoEntry: false, bigint: true });
  if (!report) return current;
  const stamp = [report.ino, report.size, report.ctimeNs, ...pending.map((v) => v.revision)].join(':');
  if (checkedLegacy.get(dir) === stamp) return current;
  // Initialize older records against their own files on first open. The report
  // supplies historical needs; its current score and map are never copied.
  const next = store(dir, true, (db) => {
    let source, attachment;
    for (const version of pending) {
      if (db.prepare('SELECT basis FROM versions WHERE id = ?').get(version.id)?.basis) continue;
      let basis, score;
      try {
        const snapshot = snapshotFrom(db, version.id);
        source ??= readReportSource({ dir, root });
        basis = freezeEvidence({ dir, root, snapshot, source });
        if (!source.report) continue;
        score = publicScore(evaluateVersion(snapshot, basis));
      } catch {
        continue;
      }
      db.prepare("UPDATE versions SET metadata=json_patch(COALESCE(metadata,'{}'),?),basis=? WHERE id=?").run(
        JSON.stringify(score),
        JSON.stringify(basis),
        version.id
      );
      attachment ??= storeReportEvidence(db, source, 'recovered');
      attachReport(db, version.id, version.revision, basis, attachment);
    }
    return state(db);
  });
  checkedLegacy.set(dir, stamp);
  return next;
}

const digest = (value) => createHash('sha256').update(value).digest('hex');
const questionRevision = ({ question, expected }) => digest(JSON.stringify([question, expected]));
const inside = (folder, file) => file === folder || file.startsWith(folder + path.sep);
const keyOf = (text) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

function input(value, field, limit) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Enter ${field}.`);
  const text = value.trim();
  if (text.length > limit) throw new Error(`Use ${limit} characters or fewer for ${field}.`);
  return text;
}

function checkFolder(dir, root) {
  if (inside(realpathSync(root), realpathSync(dir))) throw new Error('Choose a report folder outside the project.');
}

function settingsFor(dir, root) {
  const file = path.join(dir, 'settings.json');
  if (!existsSync(file)) return {};
  const settings = JSON.parse(readFileSync(file, 'utf8'));
  if (settings.root && realpathSync(settings.root) !== root) throw new Error('The report belongs to a different project.');
  return settings;
}

// Exclude session storage even when a Markdown link or an include glob points to it.
const privateFolder =
  /(?:^|\/)(?:\.git|\.worktrees|\.claude\/(?:projects|worktrees|sessions)|\.codex\/(?:sessions|archived_sessions))(?:\/|$)/;
const fileStamp = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
function projectDocument(root, rel) {
  if (!isTextFile(rel) || path.isAbsolute(rel) || rel.startsWith('~/') || privateFolder.test(rel)) return null;
  const file = path.resolve(root, rel);
  if (!inside(root, file) || path.relative(root, file) !== rel) return null;
  let real;
  try {
    real = realpathSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  // An alias under the project may point into a private folder or outside the repository.
  return real === file && statSync(file).isFile() ? file : null;
}

function readProjectMap({ dir, root }) {
  root = realpathSync(root);
  checkFolder(dir, root);
  const settings = settingsFor(dir, root);
  const home = os.homedir();
  const claudeSettingsHome = settings.claudeSettingsHome || path.join(home, '.claude');
  const config = settings.config ? readConfig(settings.config, root) : null;
  const listing = listFiles(root);
  const stamps = new Map();
  const remember = (rel) => {
    const file = projectDocument(root, rel);
    if (!file) return false;
    if (!stamps.has(rel)) stamps.set(rel, fileStamp(statSync(file, { bigint: true })));
    return true;
  };
  listing.files = listing.files.filter(remember);
  const collected = collect({ root, home, claudeSettingsHome, config, listing });
  const ignore = [...new Set(['user', ...(settings.ignore ?? DEFAULT_IGNORE)])];
  const model = ignoreStart(collected, { ignore, root, home });
  // The remote runner sees only project guides. Exclude the user's own context,
  // session transcripts, JSON settings and imports that point outside the project.
  const projectItem = (item) => item.scope === 'project' && remember(item.path);
  model.startLoad = model.startLoad.filter(projectItem);
  model.later = model.later.filter(projectItem);

  const { map } = buildMap({ root, model, files: listing.files, config });
  const files = [];
  for (const node of map.files) {
    if (!node.context) continue;
    const file = projectDocument(root, node.path);
    if (!file && stamps.has(node.path)) throw new Error('A context file changed while saving. Try again.');
    if (!file) continue;
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd, { bigint: true });
      const stamp = fileStamp(stat);
      if (
        realpathSync(file) !== file ||
        !stat.isFile() ||
        fileStamp(statSync(file, { bigint: true })) !== stamp ||
        (stamps.has(node.path) && stamps.get(node.path) !== stamp)
      ) {
        throw new Error('A context file changed while saving. Try again.');
      }
      const text = readFileSync(fd, 'utf8');
      if (fileStamp(fstatSync(fd, { bigint: true })) !== stamp)
        throw new Error('A context file changed while saving. Try again.');
      stamps.set(node.path, stamp);
      files.push({ path: node.path, text });
    } finally {
      closeSync(fd);
    }
  }
  // An editor may replace an earlier file while later guides are still being
  // read. Reject that mixed snapshot before it can be reviewed or saved.
  for (const file of files) {
    const name = projectDocument(root, file.path);
    if (!name || fileStamp(statSync(name, { bigint: true })) !== stamps.get(file.path))
      throw new Error('A context file changed while reading the project. Try again.');
  }
  const paths = new Set(files.map((file) => file.path));
  const entries = [
    ...new Set(model.startLoad.filter((item) => START_WHAT.has(item.what) && paths.has(item.path)).map((item) => item.path))
  ];
  const links = [];
  for (const file of map.files) {
    if (!paths.has(file.path)) continue;
    for (const source of file.linkedFrom) {
      if (paths.has(source.path)) links.push({ from: source.path, to: file.path, via: source.via, line: source.line });
    }
  }
  return { root, contents: { files, entries, links }, navigation: model };
}

function capture(options) {
  const { root, contents, navigation } = readProjectMap(options);
  if (!contents.files.length) throw new Error('Add a project context file such as README.md before saving a version.');
  const snapshot = JSON.stringify(contents);
  const source = readReportSource({ dir: options.dir, root });
  const basis = freezeEvidence({ dir: options.dir, root, snapshot: contents, navigation, source });
  return {
    snapshot,
    revision: digest(snapshot),
    fileCount: contents.files.length,
    basis,
    source,
    metadata: publicScore(evaluateVersion(contents, basis))
  };
}

function publicScore({ score, scoreReason, shown, grades, scoreScope, scoreEvidenceAt }) {
  return { score, scoreReason, shown, grades, scoreScope, scoreEvidenceAt };
}

function insertVersion(db, name, saved) {
  const nameKey = keyOf(name);
  if (db.prepare('SELECT 1 FROM versions WHERE nameKey = ?').get(nameKey)) {
    throw new Error('A version already has that name. Choose a different name.');
  }
  const at = new Date().toISOString(),
    id = randomUUID();
  db.prepare(
    'INSERT INTO versions(id,name,nameKey,createdAt,updatedAt,revision,fileCount,snapshot,basis,metadata) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    name,
    nameKey,
    at,
    at,
    saved.revision,
    saved.fileCount,
    saved.snapshot,
    JSON.stringify(saved.basis),
    JSON.stringify(saved.metadata)
  );
  const attachment = saved.attachment || storeReportEvidence(db, saved.source, 'saved');
  attachReport(db, id, saved.revision, saved.basis, attachment);
  return id;
}

export function createVersion({ dir, root, name }) {
  name = input(name, 'a version name', 80);
  const saved = capture({ dir, root });
  return store(dir, true, (db) => {
    insertVersion(db, name, saved);
    return state(db);
  });
}

export function updateVersion({ dir, root, versionId }) {
  return store(dir, true, (db) => {
    const previous = db.prepare('SELECT revision,metadata FROM versions WHERE id = ?').get(versionId);
    if (!previous) throw new Error('Choose an existing map version.');
    if (pendingRefactor(db)?.versionId === versionId)
      throw new Error('This version is the starting point of an open refactor. Save or cancel the refactor first.');
    if (db.prepare(`SELECT 1 FROM versions WHERE json_extract(metadata, '$.source') = 'refactor'
        AND (id = ? OR json_extract(metadata, '$.parentId') = ?) LIMIT 1`).get(versionId, versionId))
      throw new Error('This version is saved for a refactor comparison. Save your changes as another version.');
    const saved = capture({ dir, root });
    const metadata = JSON.parse(previous.metadata || '{}');
    if (previous.revision !== saved.revision) {
      db.prepare('UPDATE versions SET updatedAt = ?, revision = ?, fileCount = ?, snapshot = ? WHERE id = ?').run(
        new Date().toISOString(),
        saved.revision,
        saved.fileCount,
        saved.snapshot,
        versionId
      );
      db.prepare('DELETE FROM results WHERE versionId = ?').run(versionId);
      if (metadata.appliedFixes) {
        const contents = JSON.parse(saved.snapshot);
        const files = new Map(contents.files.map((f) => [f.path, f.text]));
        metadata.appliedFixes = metadata.appliedFixes.filter((f) => files.get(f.file)?.split(/\r?\n/).includes(f.after));
        metadata.appliedCount = metadata.appliedFixes.length;
      }
    }
    db.prepare('UPDATE versions SET metadata = ?, basis = ? WHERE id = ?').run(
      JSON.stringify({ ...metadata, ...saved.metadata, ...(metadata.parentId && { recaptured: true }) }),
      JSON.stringify(saved.basis),
      versionId
    );
    attachReport(db, versionId, saved.revision, saved.basis, storeReportEvidence(db, saved.source, 'saved'));
    return state(db);
  });
}

function checkQuestion(db, { question, expected }, id = null) {
  question = input(question, 'a benchmark question', 1000);
  expected = input(expected, 'the expected answer', 240);
  const questionKey = keyOf(question);
  const match = db.prepare('SELECT id FROM questions WHERE questionKey = ?').get(questionKey);
  if (match && match.id !== id) throw new Error('This question is already in the project.');
  return { question, expected, questionKey };
}

export function addQuestion({ dir, root, ...values }) {
  if (root) checkFolder(dir, root);
  return store(dir, true, (db) => {
    const { question, expected, questionKey } = checkQuestion(db, values);
    db.prepare('INSERT INTO questions (id, question, questionKey, expected, metadata) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(),
      question,
      questionKey,
      expected,
      JSON.stringify(intentOf(values))
    );
    return state(db);
  });
}

export function updateQuestion({ dir, questionId, ...values }) {
  return store(dir, true, (db) => {
    const old = db.prepare('SELECT question, expected,metadata FROM questions WHERE id = ?').get(questionId);
    if (!old) throw new Error('Choose a saved benchmark question.');
    const { question, expected, questionKey } = checkQuestion(db, values, questionId);
    const changed = question !== old.question || expected !== old.expected;
    const metadata = JSON.parse(old.metadata || '{}');
    if (changed) {
      db.prepare('UPDATE questions SET question = ?, questionKey = ?, expected = ? WHERE id = ?').run(
        question,
        questionKey,
        expected,
        questionId
      );
      db.prepare('DELETE FROM results WHERE questionId = ?').run(questionId);
      delete metadata.source;
    }
    if (Object.hasOwn(values, 'intentId') || Object.hasOwn(values, 'intentLabel'))
      Object.assign(metadata, intentOf(values));
    db.prepare('UPDATE questions SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), questionId);
    return state(db);
  });
}

function snapshotFrom(db, versionId) {
  const row = db?.prepare('SELECT snapshot, revision FROM versions WHERE id = ?').get(versionId);
  if (!row) throw new Error('Choose an existing map version.');
  if (digest(row.snapshot) !== row.revision)
    throw new Error('The saved map could not be verified. Update this version from the project.');
  return { ...JSON.parse(row.snapshot), revision: row.revision };
}

export function readSnapshot({ dir, versionId }) {
  return store(dir, false, (db) => snapshotFrom(db, versionId));
}

function storeReportEvidence(db, source, origin) {
  const evidence = freezeReportEvidence(source.report);
  if (!evidence) return { evidenceId: null, origin: 'unavailable' };
  return storeFrozenEvidence(db, evidence, origin);
}

function storeFrozenEvidence(db, evidence, origin) {
  const contents = JSON.stringify(evidence);
  const evidenceId = digest(contents);
  if (!db.prepare('SELECT 1 FROM reportEvidence WHERE id=?').get(evidenceId))
    db.prepare('INSERT INTO reportEvidence(id,contents) VALUES(?,?)').run(evidenceId, gzipSync(contents));
  return { evidenceId, origin };
}

function reportAttachment(db, versionId) {
  return db.prepare('SELECT evidenceId, origin, reportKey FROM versionReports WHERE versionId=?').get(versionId);
}

function attachReport(db, versionId, revision, basis, { evidenceId, origin }) {
  // A recapture with identical files can still change the sessions or the score.
  const reportKey = digest(JSON.stringify([revision, basis, evidenceId, origin]));
  const previous = reportAttachment(db, versionId);
  if (previous?.reportKey !== reportKey) {
    db.prepare(`INSERT INTO versionReports(versionId,evidenceId,origin,reportKey) VALUES(?,?,?,?)
      ON CONFLICT(versionId) DO UPDATE SET evidenceId=excluded.evidenceId, origin=excluded.origin, reportKey=excluded.reportKey`)
      .run(versionId, evidenceId, origin, reportKey);
    if (previous?.evidenceId && previous.evidenceId !== evidenceId)
      db.prepare('DELETE FROM reportEvidence WHERE id=? AND NOT EXISTS (SELECT 1 FROM versionReports WHERE evidenceId=?)')
        .run(previous.evidenceId, previous.evidenceId);
  }
  return { evidenceId, origin, reportKey };
}

function matchesScoredReport(db, { root, versionId }, snapshot, basis, source) {
  if (basis.evidenceAt !== source.evidenceAt) return false;
  // A child inherits the parent's scoring evidence even if it moved the file
  // that verified a fact. Check the exact recorded ancestor in that case.
  const ancestor = db.prepare(`SELECT p.id FROM versions c JOIN versions p
    ON p.id=json_extract(c.metadata,'$.parentId') AND p.revision=json_extract(c.metadata,'$.parentRevision')
    WHERE c.id=? AND json_extract(p.basis,'$.scope')=? AND json_extract(p.basis,'$.evidenceAt')=?`);
  const seen = new Set();
  while (!seen.has(versionId)) {
    if (freezeEvidence({ root, snapshot, source }).scope === basis.scope) return true;
    seen.add(versionId);
    const parent = ancestor.get(versionId, basis.scope, basis.evidenceAt);
    if (!parent) return false;
    versionId = parent.id;
    snapshot = snapshotFrom(db, versionId);
  }
  return false;
}

// Older versions have scored inputs and saved files. Only recover the detailed
// sessions when the project's report still matches the evidence used to score
// that version. Pin the outcome so a later refresh cannot rewrite its history.
function ensureReport(db, { dir, root, versionId }, snapshot) {
  const attached = reportAttachment(db, versionId);
  if (attached) return attached;
  snapshot ??= snapshotFrom(db, versionId);
  const row = db.prepare('SELECT basis FROM versions WHERE id=?').get(versionId);
  let basis = JSON.parse(row.basis);
  if (basis?.evidenceAt) {
    const compatible = db.prepare(`SELECT r.evidenceId FROM versionReports r JOIN versions v ON v.id=r.versionId
      WHERE r.evidenceId IS NOT NULL AND json_extract(v.basis,'$.evidenceAt')=?
      AND json_extract(v.basis,'$.scope')=? LIMIT 1`).get(basis.evidenceAt, basis.scope);
    if (compatible) return attachReport(db, versionId, snapshot.revision, basis, { ...compatible, origin: 'recovered' });
  }
  root ||= basis?.root || JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8')).root;
  let source;
  try {
    source = readReportSource({ dir, root });
  } catch {
    source = { report: null, evidenceAt: null };
  }
  const hadBasis = Boolean(basis);
  basis ??= evidenceFor(db, { dir, root, versionId }, snapshot, source);
  let attachment = { evidenceId: null, origin: 'unavailable' };
  if (source.report && (!hadBasis || matchesScoredReport(db, { root, versionId }, snapshot, basis, source)))
    attachment = storeReportEvidence(db, source, 'recovered');
  return attachReport(db, versionId, snapshot.revision, basis, attachment);
}

export function readVersionReportKey({ dir, versionId }) {
  return store(dir, false, db => {
    if (!db) return null;
    if (db.prepare('PRAGMA user_version').get().user_version < 4)
      return db.prepare('SELECT revision,NULL AS key FROM versions WHERE id=?').get(versionId) || null;
    return db.prepare('SELECT revision,reportKey AS key FROM versions LEFT JOIN versionReports ON id=versionId WHERE id=?')
      .get(versionId) || null;
  });
}

export function readVersionReport({ dir, root, versionId, revision }) {
  function read(db, allowMigration) {
    const saved = db?.prepare('SELECT revision FROM versions WHERE id=?').get(versionId);
    if (!saved) throw new Error('Choose an existing map version.');
    if (revision != null && saved.revision !== revision)
      throw new Error('This version has changed. Open its latest report.');
    if (!allowMigration && (db.prepare('PRAGMA user_version').get().user_version < 4 || !reportAttachment(db, versionId))) return null;

    const snapshot = snapshotFrom(db, versionId);
    let attachment = ensureReport(db, { dir, root, versionId }, snapshot);
    const { basis, ...version } = db.prepare('SELECT ' + versionColumns + ', metadata, basis FROM versions WHERE id=?').get(versionId);
    let evidence = null;
    if (attachment.evidenceId) {
      const row = db.prepare('SELECT contents FROM reportEvidence WHERE id=?').get(attachment.evidenceId);
      const contents = row && gunzipSync(row.contents);
      if (!contents || digest(contents) !== attachment.evidenceId) throw new Error('The saved report evidence could not be verified.');
      evidence = JSON.parse(contents.toString('utf8'));
      if (evidence.explorationVersion === 1) {
        if (!allowMigration) return null;
        for (const session of evidence.sessions.list) {
          const searchEvents = explorationEvents(session).filter(event => event.kind === 'search');
          session.events = [...session.events.filter(event => event.kind !== 'search'), ...searchEvents].sort((a, b) => a.i - b.i);
        }
        evidence.explorationVersion = 2;
        attachment = attachReport(db, versionId, snapshot.revision, JSON.parse(basis), storeFrozenEvidence(db, evidence, attachment.origin));
      } else if (!evidence.explorationVersion) {
        if (!allowMigration) return null;
        const scored = JSON.parse(basis);
        let source;
        try { source = readReportSource({ dir, root: root || scored.root }); } catch { /* The original report is unavailable. */ }
        if (source?.report && scored.evidenceAt && source.evidenceAt === scored.evidenceAt) {
          const candidate = freezeReportEvidence(source.report);
          // Compare every field the original serializer kept, including event indexes.
          const legacy = structuredClone(candidate);
          delete legacy.explorationVersion;
          for (const session of legacy.sessions.list) {
            delete session.explorationCoverage;
            session.events = session.events.filter(e => e.kind !== 'search');
            for (const event of session.events) delete event.message;
          }
          if (digest(JSON.stringify(legacy)) === attachment.evidenceId) evidence = candidate;
        }
        evidence.explorationVersion = 2;
        attachment = attachReport(db, versionId, snapshot.revision, scored, storeFrozenEvidence(db, evidence, attachment.origin));
      }
    }
    return {
      version: publicVersion({ ...version, sessionTotal: JSON.parse(basis).total, reportKey: attachment.reportKey }), snapshot, basis: JSON.parse(basis),
      evidence, evidenceOrigin: attachment.origin, cacheKey: attachment.reportKey
    };
  }
  return store(dir, false, db => read(db, false)) || store(dir, true, db => read(db, true));
}

function intentOf({ intentId, intentLabel }) {
  if (intentId == null && intentLabel == null) return { intentId: null, intentLabel: null };
  return { intentId: input(intentId, 'an intent', 160), intentLabel: input(intentLabel, 'an intent name', 500) };
}

export function addQuestions({ dir, root, versionId, revision, questions }) {
  if (root) checkFolder(dir, root);
  if (!Array.isArray(questions)) throw new Error('Choose the drafted questions to save.');
  return store(dir, true, (db) => {
    const snapshot = snapshotFrom(db, versionId);
    if (revision !== snapshot.revision) throw new Error('The version changed. Generate the questions again.');
    const docs = new Map(snapshot.files.map((f) => [f.path, normalized(f.text)]));
    const wording = (text) =>
      keyOf(text)
        .replace(/[?.!]+$/u, '')
        .trim();
    const fact = (q) => JSON.stringify([q.intentId, q.source, normalized(q.expected)]);
    const existing = state(db).questions;
    const known = new Set(existing.map((q) => wording(q.question)));
    const covered = new Set(existing.filter((q) => q.intentId && q.source).map(fact));
    const add = db.prepare('INSERT INTO questions(id,question,questionKey,expected,metadata) VALUES(?,?,?,?,?)');
    let addedCount = 0;
    for (const q of questions) {
      const question = input(q?.question, 'a benchmark question', 1000),
        questionKey = keyOf(question);
      if (known.has(wording(question))) continue;
      const expected = input(q?.expected, 'the expected answer', 240);
      if (covered.has(fact(q))) continue;
      if (!docs.has(q.source) || !hasPhrase(docs.get(q.source), normalized(expected)))
        throw new Error('The expected answer must appear in the saved source document.');
      add.run(randomUUID(), question, questionKey, expected, JSON.stringify({ ...intentOf(q), source: q.source }));
      known.add(wording(question));
      covered.add(fact(q));
      addedCount++;
    }
    return { ...state(db), addedCount };
  });
}

export function removeQuestion({ dir, questionId }) {
  return store(dir, true, (db) => {
    if (!db.prepare('SELECT 1 FROM questions WHERE id = ?').get(questionId))
      throw new Error('Choose a saved benchmark question.');
    db.prepare('DELETE FROM results WHERE questionId = ?').run(questionId);
    db.prepare('DELETE FROM questions WHERE id = ?').run(questionId);
    return state(db);
  });
}

function evidenceFor(db, { dir, root, versionId }, snapshot, source) {
  const row = db.prepare('SELECT metadata,basis FROM versions WHERE id = ?').get(versionId);
  if (row.basis) return JSON.parse(row.basis);
  // Initialize legacy maps from their own saved documents the first time
  // someone reviews them or chooses one as the basis for a comparison.
  root ||= JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8')).root;
  const basis = freezeEvidence({ dir, root, snapshot, source });
  db.prepare('UPDATE versions SET basis=?, metadata=? WHERE id=?').run(
    JSON.stringify(basis),
    JSON.stringify({ ...JSON.parse(row.metadata || '{}'), ...publicScore(evaluateVersion(snapshot, basis)) }),
    versionId
  );
  return basis;
}

function review(db, { dir, root, versionId, includeProposals }) {
  const snapshot = snapshotFrom(db, versionId);
  const basis = evidenceFor(db, { dir, root, versionId }, snapshot);
  const evaluated = evaluateVersion(snapshot, basis);
  const current = state(db);
  const version = current.versions.find(v => v.id === versionId);
  const score = version.shown === 'no-sessions' ? { ...untestedVersionScore(), scoreScope: basis.scope } : publicScore(evaluated);
  const findings = versionFindings({
    snapshot,
    basis,
    evaluated,
    questions: current.questions,
    results: current.results.filter((r) => r.versionId === versionId && r.revision === snapshot.revision),
    includeProposals
  });
  return { snapshot, basis, report: { versionId, revision: snapshot.revision, ...score, ...findings } };
}

export function inspectVersion(options) {
  return store(options.dir, true, (db) => review(db, options).report);
}

function scanForRefactor(options) {
  const { contents, navigation } = readProjectMap(options);
  contents.navigation = savedNavigation(contents, navigation);
  const text = JSON.stringify(contents);
  return { contents, text, workingRevision: digest(text), filesHash: digest(JSON.stringify(contents.files)) };
}

function changedFiles(parent, current) {
  const before = new Map(parent.files.map((file) => [file.path, file.text]));
  const after = new Map(current.files.map((file) => [file.path, file.text]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.filter((path) => before.get(path) !== after.get(path)).map((path) => ({
    path,
    kind: !before.has(path) ? 'added' : !after.has(path) ? 'removed' : 'edited',
    before: before.get(path) ?? null,
    after: after.get(path) ?? null
  }));
}

function requireRefactor(db, refactorId) {
  const row = db.prepare('SELECT * FROM refactor WHERE slot = 1').get();
  if (!row || row.id !== refactorId) throw new Error('This refactor is no longer open. Refresh the versions.');
  return row;
}

function refactorComparison(db, draft, working) {
  const parent = snapshotFrom(db, draft.versionId);
  if (parent.revision !== draft.revision)
    throw new Error('The starting version has changed. Cancel this refactor and start again from the saved version.');
  const existingPaths = new Set(JSON.parse(draft.existingPaths));
  const changes = changedFiles(parent, working.contents).map((change) => ({
    ...change,
    presentAtStart: existingPaths.has(change.path)
  }));
  return {
    refactor: pendingRefactor(db),
    changes,
    workingRevision: working.workingRevision,
    canSave: changes.length > 0 && working.filesHash !== draft.startingFilesHash
  };
}

export function startRefactor({ dir, root, versionId, revision, acceptRevision }) {
  const working = scanForRefactor({ dir, root });
  return store(dir, true, (db) => {
    const pending = pendingRefactor(db);
    if (pending) {
      if (pending.versionId !== versionId || pending.revision !== revision)
        throw new Error('A refactor is already open for this project. Save or cancel it before starting another.');
      return refactorComparison(db, requireRefactor(db, pending.id), working);
    }
    const parent = snapshotFrom(db, versionId);
    if (parent.revision !== revision) throw new Error('The starting version has changed. Refresh the versions and try again.');
    const changes = changedFiles(parent, working.contents);
    if (changes.length && acceptRevision !== working.workingRevision)
      return { refactor: null, changes, workingRevision: working.workingRevision, canSave: false };

    ensureReport(db, { dir, root, versionId }, parent);
    db.prepare(`INSERT INTO refactor(slot,id,versionId,revision,startedAt,startingFilesHash,existingPaths)
      VALUES(1,?,?,?,?,?,?)`).run(
      randomUUID(), versionId, revision, new Date().toISOString(), working.filesHash,
      JSON.stringify(changes.map((change) => change.path))
    );
    return { refactor: pendingRefactor(db), changes, workingRevision: working.workingRevision, canSave: false };
  });
}

export function reviewRefactor({ dir, root, refactorId }) {
  const working = scanForRefactor({ dir, root });
  return store(dir, true, (db) => {
    const draft = requireRefactor(db, refactorId);
    const result = refactorComparison(db, draft, working);
    db.prepare('UPDATE refactor SET reviewedRevision = ? WHERE id = ?').run(
      result.canSave ? result.workingRevision : null, refactorId
    );
    return result;
  });
}

export function saveRefactor({ dir, root, refactorId, workingRevision, name }) {
  name = input(name, 'a version name', 80);
  const working = scanForRefactor({ dir, root });
  return store(dir, true, (db) => {
    // A lost HTTP response can be retried without creating a second version.
    const saved = db.prepare(`SELECT id FROM versions WHERE revision = ? AND name = ?
      AND json_extract(metadata, '$.refactorId') = ?`).get(workingRevision ?? null, name, refactorId ?? null);
    if (saved) return { ...state(db), createdVersionId: saved.id };
    const draft = requireRefactor(db, refactorId);
    const result = refactorComparison(db, draft, working);
    if (!workingRevision || draft.reviewedRevision !== workingRevision || working.workingRevision !== workingRevision)
      throw new Error('Review the current file changes before saving this version.');
    if (!result.canSave) throw new Error('Make a change to the project context, then review the files again.');
    const attachment = ensureReport(db, { dir, root, versionId: draft.versionId });
    const { basis } = db.prepare('SELECT basis FROM versions WHERE id = ?').get(draft.versionId);
    const evidence = JSON.parse(basis);
    const id = insertVersion(db, name, {
      snapshot: working.text,
      revision: workingRevision,
      fileCount: working.contents.files.length,
      basis: evidence,
      attachment,
      metadata: {
        ...untestedVersionScore(),
        scoreScope: evidence.scope,
        source: 'refactor',
        refactorId,
        parentId: draft.versionId,
        parentRevision: draft.revision,
        changedFiles: result.changes.map(({ path, kind, presentAtStart }) => ({ path, kind, presentAtStart }))
      }
    });
    db.prepare('DELETE FROM refactor WHERE id = ?').run(refactorId);
    return { ...state(db), createdVersionId: id };
  });
}

export function cancelRefactor({ dir, refactorId }) {
  return store(dir, true, (db) => {
    requireRefactor(db, refactorId);
    db.prepare('DELETE FROM refactor WHERE id = ?').run(refactorId);
    return state(db);
  });
}

export function createChildVersion({ dir, root, versionId, revision, name, proposalIds }) {
  name = input(name, 'a version name', 80);
  if (!Array.isArray(proposalIds) || !proposalIds.length || new Set(proposalIds).size !== proposalIds.length)
    throw new Error('Choose one or more different proposals.');
  return store(dir, true, (db) => {
    const { snapshot, basis, report } = review(db, { dir, root, versionId, includeProposals: true });
    if (snapshot.revision !== revision) throw new Error('The parent version changed. Review its proposals again.');
    const selected = proposalIds.map((id) => report.proposals.find((p) => p.id === id));
    if (selected.some((p) => !p)) throw new Error('A proposal changed. Open the proposals again.');
    const files = new Map(snapshot.files.map((f) => [f.path, { ...f }]));
    const entries = [...snapshot.entries];
    for (const proposal of selected) {
      let file = files.get(proposal.file);
      if (!file) {
        file = { path: proposal.file, text: '' };
        files.set(file.path, file);
        entries.push(file.path);
      }
      file.text += (file.text && !file.text.endsWith('\n') ? '\n' : '') + proposal.after + '\n';
    }
    const contents = { files: [...files.values()], entries, links: [], ...(snapshot.navigation && { navigation: snapshot.navigation }) };
    const assessed = evaluateVersion(contents, basis);
    contents.links = assessed.links;
    if (selected.some((p) => !assessed.links.some((l) => l.from === p.file && l.to === p.target && l.via === 'link'))) {
      throw new Error('A proposed link could not be verified in the saved map. Choose another edit.');
    }
    const text = JSON.stringify(contents);
    const id = insertVersion(db, name, {
      snapshot: text,
      revision: digest(text),
      fileCount: files.size,
      basis,
      attachment: ensureReport(db, { dir, root, versionId }, snapshot),
      metadata: {
        ...untestedVersionScore(),
        scoreScope: basis.scope,
        parentId: versionId,
        parentRevision: revision,
        appliedCount: selected.length,
        appliedFixes: selected.map(({ id, title, file, before, after }) => ({ id, title, file, before, after }))
      }
    });
    return { ...state(db), createdVersionId: id };
  });
}

export function recordResult({ dir, result, revision, questionRevision: testedQuestionRevision }) {
  return store(dir, true, (db) => {
    const { versionId, questionId } = result;
    const saved = db.prepare('SELECT revision FROM versions WHERE id = ?').get(versionId);
    if (!saved || saved.revision !== revision)
      throw new Error('The version changed while the benchmark ran. Run it again.');
    const question = db.prepare('SELECT question, expected FROM questions WHERE id = ?').get(questionId);
    if (!question) throw new Error('Choose a saved benchmark question.');
    if (testedQuestionRevision && questionRevision(question) !== testedQuestionRevision) {
      throw new Error('The question changed while the benchmark ran. Run it again.');
    }
    db.prepare(
      `INSERT INTO results (versionId, questionId, data) VALUES (?, ?, ?)
      ON CONFLICT(versionId, questionId) DO UPDATE SET data = excluded.data`
    ).run(versionId, questionId, JSON.stringify({ ...result, revision }));
    return state(db);
  });
}
