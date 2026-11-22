// Step 12: the health score, method v1. A pure function: no model call, no file read, no git.
// Each need of each intent gets a grade on the map of today:
// - Served: a route of 0 or 1 step, and not by a folder link only.
// - Slow: a route of 2 or more steps, or a route of 1 step by a folder link only.
// - Missed: no route.
// A rule that the user had to type takes the grade of the file with a route that holds it now, else it is Missed.
// raw = 100 x (Served + 0.5 x Slow) / all needs. score = round(clamp(raw - penalty, 0, 100)).
// The penalty is for the start load tokens that no intent used. The proof (src/history.mjs) changes only
// `shown`, `reason` and `headline`: see `withProof`.
import path from 'node:path';
import { isNamed } from './context-files.mjs';

export const METHOD = 'v1';
export const THIN = { sessions: 5, needs: 20 };
export const PENALTY = { max: 15, freeTokens: 3000, perTokens: 1000 };
export const PROOF_LIMITS = { served: 10, other: 10 };
export const RULES = 'Each need of each intent gets a grade on the map of today. Served: a route of 0 or 1 step, and a start file names the file or loads it. ' +
  'Slow: a route of 2 or more steps, or a route of 1 step by a folder link only. Missed: no route. A rule that you had to type takes the grade of ' +
  'the file with a route that holds it now, else it is Missed. Raw score = 100 x (Served + 0.5 x Slow) / all needs. ' +
  'The start load penalty takes 1 point for each 1,000 unused tokens above 3,000, and 15 points at most. ' +
  'Score = raw score minus penalty, from 0 to 100. Good from 80, mixed from 50, else poor. ' +
  'With fewer than 5 analysed sessions or fewer than 20 needs, there is not enough data for a number. ' +
  'The number shows only when the proof from the git history passes.';
export const USED_RULE = 'An instruction file (CLAUDE.md, AGENTS.md, CLAUDE.local.md, a rule) is used when 1 or more intents ran. ' +
  'An @ import of another file and the memory index are used when an intent needed the file, or when the file is on the map route of a needed file ' +
  '(the memory index also when an intent needed a memory file that it links). ' +
  'A skill, command or agent description is used when an analysed session loaded its body. An item with no token count is not in the sum.';
export const PROOF_NOTES = ['Memory files and the files of ~/.claude are not in git. The proof uses their state of today.',
  'A file that git did not track at the commit is not on the old map.'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const num = value => value.toLocaleString('en-US');
const count = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const labelOf = value => (value == null ? null : value >= 80 ? 'good' : value >= 50 ? 'mixed' : 'poor');
const INSTRUCTION_NAMES = new Set(['CLAUDE.md', 'AGENTS.md', 'CLAUDE.local.md']);
const isInstructionPath = rel => INSTRUCTION_NAMES.has(path.posix.basename(rel)) || /(?:^|\/)\.claude\/rules\//.test(rel);

// The grade of a file from its steps and its map file (`file` is null for a start file that is not on the map).
// The proof uses it for the old map too.
// The map keeps one route for each file. When a folder link and a link by name give the same number of steps, the kept
// route can be the folder link. So a file 1 step away with a folder link in its route is Slow only when no start
// file names it (S1: "by a folder link only").
export function gradeOf(steps, file, mapFiles) {
  if (steps == null) return 'missed';
  if (steps > 1) return 'slow';
  if (!(file?.route || []).some(step => step.via === 'folder')) return 'served';
  return (file.linkedFrom || []).some(link => link.via !== 'folder' && mapFiles.get(link.path)?.steps === 0) ? 'served' : 'slow';
}

export const penaltyPoints = unused => Math.min(PENALTY.max, Math.floor(Math.max(0, unused - PENALTY.freeTokens) / PENALTY.perTokens));

// The proof before the command runs it (buildHealth is pure, and the proof needs git).
export function emptyProof() {
  const none = () => ({ needs: 0, searched: 0, searchRate: null, typedFacts: 0, typedFactRate: null, ways: { search: 0, user: 0, none: 0 } });
  return { status: 'no-data', text: 'The proof did not run.', limits: { ...PROOF_LIMITS }, compare: 'slow+missed',
    sessions: { used: 0, leftOut: [] }, grades: { served: none(), slow: none(), missed: none(), other: none() },
    checks: { enough: false, searchRate: null, typedFactRate: null }, factsLeftOut: 0, commits: [], notes: [...PROOF_NOTES] };
}

// ---------- the start load penalty ----------

function penaltyOf(model, ctx, needPaths) {
  const ok = model.intents.sessions.filter(entry => entry.status === 'ok');
  const ran = ok.reduce((total, entry) => total + entry.intents.length, 0) > 0;
  const okIds = new Set(ok.map(entry => entry.sessionId));
  const sessions = model.sessions.list.filter(session => okIds.has(session.sessionId));
  // The files on the map route of a needed file.
  const onRoute = new Set();
  for (const rel of needPaths) for (const step of ctx.mapFiles.get(rel)?.route || []) if (step.path !== rel) onRoute.add(step.path);
  const loaded = new Set();
  const commands = new Set();
  for (const session of sessions) {
    for (const event of session.events) if ((event.kind === 'load' || event.kind === 'read') && event.path) loaded.add(event.path);
    for (const message of session.messages) if (message.kind === 'command') commands.add(message.text.split(/\s+/)[0]);
  }
  const state = item => {
    if (item.what === 'instructions' || item.what === 'rule' || (item.what === 'import' && isInstructionPath(item.path))) {
      return ran ? [true, 'An instruction file counts as used when 1 or more intents ran.'] : [false, 'No intent ran.'];
    }
    if (item.what === 'import' || item.what === 'memory') {
      if (needPaths.has(item.path)) return [true, 'An intent needed this file.'];
      if (onRoute.has(item.path)) return [true, 'It is on the map route of a file that an intent needed.'];
      if (item.what === 'memory' && [...needPaths].some(rel => (ctx.mapFiles.get(rel)?.linkedFrom || []).some(link => link.path === item.path))) {
        return [true, 'An intent needed a memory file that it links.'];
      }
      return [false, 'No intent needed this file, and it is not on the map route of a needed file.'];
    }
    // A skill, command or agent description.
    const kind = item.what.replace(' description', '');
    const body = item.body?.path ?? item.path;
    if (loaded.has(body)) return [true, `An analysed session loaded the body of this ${kind}.`];
    if (kind === 'command' && commands.has(`/${item.name}`)) return [true, 'An analysed session ran this command.'];
    return [false, `No analysed session loaded the body of this ${kind}.`];
  };
  const items = model.startLoad.filter(item => item.tokens != null).map(item => {
    const [used, why] = state(item);
    return { path: item.path, what: item.what, name: item.name ?? null, tokens: item.tokens, used, why };
  });
  const sum = list => list.reduce((total, item) => total + item.tokens, 0);
  const startTokens = sum(items);
  const unusedTokens = sum(items.filter(item => !item.used));
  return { points: penaltyPoints(unusedTokens), ...PENALTY, startTokens, usedTokens: startTokens - unusedTokens, unusedTokens, rule: USED_RULE, items };
}

// ---------- shown, reason, headline ----------

const NO_DATA = {
  'no-sessions': 'The tool found no session of this project.',
  'not-analysed': 'No session is analysed. Run with --intents.',
  'no-needs': 'The analysed sessions have no need: no context file read and no typed rule.'
};
const HEAD = { 'not-proven': 'Score not proven', thin: 'Not enough data', 'no-data': 'No data' };
const headlineOf = v1 => (v1.shown === 'score' ? `${v1.score} ${v1.label} (method ${METHOD})` : `${HEAD[v1.shown]} (method ${METHOD}). ${v1.reason}`);
const firstUpper = text => text.charAt(0).toUpperCase() + text.slice(1);

// Add the proof. It changes only `proof`, `shown`, `reason` and `headline` (P14). No data and thin data stay.
export function withProof(v1, proof) {
  v1.proof = proof;
  if (v1.shown === 'no-data' || v1.shown === 'thin') return v1;
  v1.shown = proof.status === 'pass' ? 'score' : 'not-proven';
  v1.reason = v1.shown === 'score' ? null : firstUpper(proof.text.replace(/^Score not proven: /, ''));
  v1.headline = headlineOf(v1);
  return v1;
}

// ---------- main ----------

// `ctx` is the result of `fixContext(model)` of src/health.mjs. `noData`: the reason key of health when no need counts.
export function buildV1(model, ctx, noData = 'no-needs') {
  const mapFiles = ctx.mapFiles;
  const gradeOfPath = rel => gradeOf(ctx.stepsOf(rel), mapFiles.get(rel), mapFiles);
  const fileNeeds = model.routes.intents.flatMap(intent => intent.needs);
  // Only rule facts are needs (worker C keeps the task facts out of `intent.needs`).
  const typed = model.needs.sessions.flatMap(entry => entry.intents.flatMap(intent => intent.needs.filter(need => need.kind === 'missing')));
  const taskFacts = model.needs.taskFacts?.list ?? [];

  // The files: each needed file, and each file with a route that holds a typed rule.
  const files = new Map();
  const fileOf = rel => {
    if (!files.has(rel)) files.set(rel, { path: rel, grade: gradeOfPath(rel), steps: ctx.stepsOf(rel), uses: 0, needs: 0, facts: 0 });
    return files.get(rel);
  };
  const grades = { served: 0, slow: 0, missed: 0, total: 0 };
  for (const need of fileNeeds) {
    const file = fileOf(need.path);
    file.uses += 1;
    file.needs += 1;
    grades[file.grade] += 1;
  }
  // The typed rules, one entry for each text and place.
  const rules = new Map();
  for (const need of typed) {
    const text = squash(need.text);
    const savedPath = need.savedPath ?? null;
    const saved = savedPath != null && ctx.stepsOf(savedPath) != null;
    const grade = saved ? gradeOfPath(savedPath) : 'missed';
    const key = `${text}\u0000${savedPath ?? ''}`;
    const rule = rules.get(key) || { text, quote: squash(need.quote) || null, uses: 0, savedPath, grade, saved };
    rule.uses += 1;
    rules.set(key, rule);
    grades[grade] += 1;
    if (saved) { const file = fileOf(savedPath); file.uses += 1; file.facts += 1; }
  }
  grades.total = fileNeeds.length + typed.length;
  const ruleList = [...rules.values()].sort((a, b) => b.uses - a.uses || cmp(a.text, b.text) || cmp(a.savedPath ?? '', b.savedPath ?? ''));
  const byUses = (a, b) => b.uses - a.uses || cmp(a.path, b.path);
  const fileList = [...files.values()].sort(byUses);

  // The score.
  const analysed = model.intents.sessions.filter(entry => entry.status === 'ok').length;
  const total = model.sessions.list.length + model.sessions.skipped.length;
  const penalty = penaltyOf(model, ctx, new Set(fileNeeds.map(need => need.path)));
  const rawExact = grades.total ? (100 * (grades.served + 0.5 * grades.slow)) / grades.total : null;
  const score = rawExact == null ? null : Math.round(Math.min(100, Math.max(0, rawExact - penalty.points)));
  const has = grades.total > 0;
  const ran = model.intents.sessions.some(entry => entry.status === 'ok' && entry.intents.length);

  // Question 1: the Missed files and the Missed rules.
  const needsText = n => count(n, 'need');
  const missedFiles = fileList.filter(file => file.grade === 'missed').map(file => {
    const gap = ctx.gapOf(file.path);
    const where = ctx.place(gap);
    return { label: file.path, count: needsText(file.uses), text: `${ctx.whyOf(file.path, gap)} ${where.text}`, path: file.path, kind: 'file',
      uses: file.uses, grade: 'missed', gap, target: where.target, line: where.line };
  });
  const toldText = rule => (rule.saved ? `It is already saved in ${rule.savedPath}.`
    : rule.savedPath ? `The fact is in ${rule.savedPath} now, but that file has no route from the start. ${ctx.place(rule.savedPath).text}`
      : 'Write this fact in the file that the agent reads for this task.');
  const missedRules = ruleList.filter(rule => !rule.saved).map(rule => ({ label: rule.text, count: needsText(rule.uses), text: toldText(rule),
    path: rule.savedPath, kind: 'fact', uses: rule.uses, grade: 'missed', quote: rule.quote }));
  const findAnswer = [missedFiles.length ? count(missedFiles.length, 'file') : null, missedRules.length ? count(missedRules.length, 'fact') : null].filter(Boolean);

  // Question 2: the Slow files, each with the file and the line to change.
  const slowFiles = fileList.filter(file => file.grade === 'slow').map(file => {
    const route = mapFiles.get(file.path)?.route || [];
    const last = route.at(-1);
    const from = route.at(-2)?.path ?? null;
    const linker = mapFiles.get(from);
    const routeText = route.map(step => step.path).join(' > ');
    let where;
    let why;
    if (last?.via === 'folder' && linker?.steps === 0 && isNamed(linker)) {
      // A folder link in a start file: name the file there.
      const at = last.line == null ? '' : ` (line ${last.line})`;
      why = `${from}${at} links only the folder of this file.`;
      where = { target: from, line: last.line ?? null, text: `In ${from}${at}, name the file: add a link to ${file.path}, with one line that says when to read it.` };
    } else {
      why = route.some(step => step.via === 'folder') ? `Its route has a folder link (${routeText}).` : `It is ${count(file.steps, 'step')} from the start (${routeText}).`;
      where = ctx.place(file.path);
    }
    return { label: file.path, count: needsText(file.uses), text: `${why} ${where.text}`, path: file.path, kind: 'file',
      uses: file.uses, grade: 'slow', steps: file.steps, route: route.map(step => step.path), target: where.target, line: where.line };
  });

  // Question 3: each typed rule.
  const toldItems = ruleList.map(rule => ({ label: rule.text, count: count(rule.uses, 'time'), text: toldText(rule), path: rule.savedPath, kind: 'fact',
    uses: rule.uses, grade: rule.grade, quote: rule.quote, saved: rule.saved, savedPath: rule.savedPath }));
  const savedRules = ruleList.filter(rule => rule.saved).length;

  // Question 4: the start items that no intent used, the biggest first.
  const unused = penalty.items.filter(item => !item.used).sort((a, b) => b.tokens - a.tokens || cmp(a.path, b.path) || cmp(a.what, b.what))
    .map(item => ({ label: item.path, count: count(item.tokens, 'token'), text: item.why, path: item.path, kind: 'start-item',
      what: item.what, name: item.name, tokens: item.tokens }));
  const off = count(penalty.points, 'point');
  const leanLines = [`Start load: ${count(penalty.startTokens, 'token')}.`];
  if (ran) {
    leanLines.push(`Not used by an intent: ${count(penalty.unusedTokens, 'token')}.`,
      `The first ${num(PENALTY.freeTokens)} unused tokens are free. Each ${num(PENALTY.perTokens)} more take 1 point, ${PENALTY.max} points at most: ${off} off.`);
  }

  const question = (key, title, answer, items, lines = []) => ({ key, title, answer, n: items.length, lines, items });
  const questions = [
    question('find', 'Can the agent find what it needs?', !has ? null : findAnswer.length ? `${findAnswer.join(' and ')} missed` : 'Yes', [...missedFiles, ...missedRules]
      .sort((a, b) => b.uses - a.uses || cmp(a.label, b.label))),
    question('close', 'Are the needed files close to the start?', !has ? null : slowFiles.length ? `${count(slowFiles.length, 'file')} slow` : 'Yes', slowFiles),
    question('told', 'Did you have to tell the agent?', !has ? null : toldItems.length ? `${count(toldItems.length, 'rule')} typed, ${num(savedRules)} already saved` : 'Yes', toldItems),
    question('lean', 'Is the start load lean?', !ran ? null : unused.length ? `${count(penalty.startTokens, 'token')}, ${num(penalty.unusedTokens)} not used, ${off} off` : 'Yes',
      ran ? unused : [], leanLines)
  ];

  const thin = has && (analysed < THIN.sessions || grades.total < THIN.needs);
  const v1 = {
    method: METHOD,
    rules: RULES,
    score,
    label: labelOf(score),
    shown: !has ? 'no-data' : thin ? 'thin' : 'not-proven',
    reason: null,
    headline: null,
    base: { analysed, total, needs: grades.total, text: `from ${num(analysed)} of ${count(total, 'session')}, ${needsText(grades.total)}` },
    grades,
    raw: rawExact == null ? null : Math.round(rawExact * 10) / 10,
    penalty,
    questions,
    facts: {
      rule: ruleList.map(rule => ({ text: rule.text, quote: rule.quote, uses: rule.uses, savedPath: rule.savedPath, grade: rule.grade })),
      task: taskFacts.map(fact => ({ text: squash(fact.text), quote: squash(fact.quote) || null, sessionId: fact.sessionId, intentId: fact.intentId }))
    },
    proof: null
  };
  if (!has) v1.reason = NO_DATA[noData] ?? NO_DATA['no-needs'];
  else if (thin) v1.reason = `Only ${count(analysed, 'analysed session')} and ${needsText(grades.total)} (${THIN.sessions} sessions and ${THIN.needs} needs are necessary).`;
  v1.headline = v1.reason ? headlineOf(v1) : null;
  return withProof(v1, emptyProof());
}
