// Step 5: the needs of each intent. A need is a context file that the agent read in the range of the intent,
// or a missing-context correction of the user. Step 5 joins `knownFrom` of step 3 with the map of step 2
// to give the state of each file need. No model call for the reads.
// The only model call is the check of the missing-context corrections, one call per session. It asks 2 things:
// - "had": did the agent already have the fact in the text it had (the start load and the earlier reads)?
// - "now" (step 10): is the fact in a context file of today (a file the session wrote later, a memory file,
//   a start file, or a file with the same words)? Then the need gets `savedPath` and `savedQuote`.
// The call runs only with --intents, else it uses the cache.
// Step 11: only a context file can be a need (`needTest` of src/context-files.mjs). A read of a file that step 10
// counted and that is out now is a dropped read: `needs.dropped` counts it, with its reason.
// Step 12 (needs-check-v3): the check also gives the kind of each fact. `rule`: a lasting rule or fact. `task`: a
// request for this one task. Only a rule is a need. A task fact goes to `intent.taskFacts` and `needs.taskFacts`.
// An answer with no valid kind counts as a rule (`factKind: null`). A fact that the agent had stays a `had` need.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { START_WHAT } from './collect.mjs';
import { REASONS, USER_OTHER, needTest, wasNeedPath } from './context-files.mjs';
import { INPUT_LIMIT, jsonOf, mapLimit, runClaude } from './intents.mjs';
import { readMemory } from './memory.mjs';

export const PROMPT_VERSION = 'needs-check-v3';
const FACT_KINDS = new Set(['rule', 'task']);
const PROMPT_FILE = new URL(`./prompts/${PROMPT_VERSION}.md`, import.meta.url);
// Load events that are needs: a skill body and a nested CLAUDE.md.
const LOAD_NEEDS = new Set(['skill', 'nested']);
const FILE_HEAD = 10000;
const FILE_TAIL = 2000;
const MIN_QUOTE = 10; // characters: a shorter quote matches too easily
const PARALLEL = 4;
// The "Files now" part of the check input (step 10).
const FILES_NOW_LIMIT = 60000; // characters of the part, from its line "Files now: N" to the end
const MATCH_FILES = 5; // word matches for each correction
const MATCH_MIN_WORDS = 2; // shared words that a match needs
const MATCH_SHORT_FILE = 100; // words: a shorter file counts as a file of this size, so a stub file does not win
// Words that do not count in the word match: English function words, the parts of short forms ("don't"), and "md".
const STOP_WORDS = new Set(('about above after again against all also am an and any are as at be because been before being below between both but by ' +
  'can cannot could did do does doing done down during each either else ever every few for from further had has have having he her here hers him his ' +
  'how however if in into is it its just least less many may me might more most much must my neither no nor not now of off on once only onto or other ' +
  'our ours out over own per same shall she should so some such than that the their theirs them then there these they this those through to too under ' +
  'until up upon us very via was we were what when where which while who whom whose why will with within without would yes yet you your yours ' +
  'aren couldn didn doesn don hadn hasn haven isn ll mustn re shouldn ve wasn weren won wouldn md').split(' '));

const num = value => value.toLocaleString('en-US');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- which reads are needs ----------

const isUserPath = rel => rel.startsWith('~/.claude/');
const isProjectPath = rel => !rel.startsWith('/') && !rel.startsWith('~/');

// A path that can be a need: `needTest(model).isNeed` of src/context-files.mjs. Needs, routes, duplicates and score
// use this one test. Config files (`.mcp.json`, `.claude/*.json`) are context files for step 1, but not needs:
// Claude Code reads them as settings, and their text is not context for the agent.

// The paths whose text is in the context of every thread from the start: the session start load, plus the
// top-level start load items that put text into the context. Step 6 uses it for Cheap.
export function startPathsOf(model, session) {
  const topStart = model.startLoad.filter(item => START_WHAT.has(item.what)).map(item => item.path);
  return new Set([...topStart, ...session.startLoad.map(item => item.path)]);
}

// ---------- file needs ----------

export function fileState({ need, events, startPaths }) {
  const first = need.firstEvent;
  // The text is in context when the start load has it, or an earlier read or load of the same path is in this thread.
  // A subagent starts with the start load and its own prompt only. It does not get the main conversation.
  const visible = event => event.thread === need.thread;
  if (startPaths.has(need.path)) return 'in_context';
  if (events.some(event => event.i < first && event.path === need.path && (event.kind === 'read' || event.kind === 'load') && visible(event))) {
    return 'in_context';
  }
  // The file is not on disk now and the map does not know it: the session is older than the tree.
  if (!need.exists && !need.map) return 'gone';
  // A skill body or a nested CLAUDE.md that the harness loaded: the start load (the skill listing, or the folder rule) led to it.
  if (need.how) return 'path';
  if (need.knownFrom?.kind === 'search') return 'search';
  if (need.map) return need.map.reach === 'start' || need.map.reach === 'path' ? 'path' : 'no_path';
  // The map covers the project only. A ~/.claude/ file has a path when a file the agent had names it.
  if (need.scope === 'user' && (need.knownFrom?.kind === 'start' || need.knownFrom?.kind === 'file')) return 'path';
  return 'no_path';
}

function existsNow(rel, model) {
  if (isUserPath(rel)) return existsSync(path.join(model.claudeSettingsHome, rel.slice('~/.claude/'.length)));
  return existsSync(path.join(model.project.root, rel));
}

// `drop(path, reason)` gets each dropped read of the intent.
function intentReads({ intent, session, model, mapFiles, startPaths, test, drop }) {
  const inRange = session.events.filter(event => event.message != null && event.message >= intent.from && event.message <= intent.to);
  const needs = new Map();
  const newNeed = (event, { reads, how, knownFrom }) => {
    const file = mapFiles.get(event.path) || null;
    const need = {
      id: null, kind: 'file', path: event.path,
      scope: isUserPath(event.path) ? 'user' : 'project', fileKind: file ? file.kind : null,
      exists: existsNow(event.path, model), ignored: file ? file.ignored : false,
      reads, firstEvent: event.i, firstMessage: event.message, thread: event.thread, how, tokens: event.tokens ?? 0,
      knownFrom,
      map: file ? { reach: file.reach, steps: file.steps, pathTokens: file.pathTokens, via: file.via } : null,
      state: null
    };
    need.state = fileState({ need, events: session.events, startPaths });
    return need;
  };
  const other = { codeFiles: new Set(), codeTokens: 0, outsideFiles: new Set(), outsideTokens: 0, searches: 0, misses: 0, excludedFiles: new Set(), excludedTokens: 0 };
  for (const event of inRange) {
    if (event.kind === 'search') { other.searches += 1; continue; }
    if (event.kind === 'miss') { other.misses += 1; continue; }
    // A skill body load and a nested CLAUDE.md load are needs found by a path (D2). Other loads (@-mention, restore) are not needs.
    // The path rule of step 10 says which loads count. Then the test of step 11 says: a need, or a dropped read.
    const isLoad = event.kind === 'load' && LOAD_NEEDS.has(event.how) && wasNeedPath(event.path);
    if (!isLoad && (event.kind !== 'read' || !event.path)) continue;
    const tokens = event.tokens ?? 0;
    // A file that step 10 counted as a need path and that is out now: a dropped read. It is not a code read.
    const reason = test.reasonOf(event.path);
    if (reason) {
      other.excludedFiles.add(event.path);
      other.excludedTokens += tokens;
      drop(event.path, reason);
      continue;
    }
    if (isLoad) {
      if (!needs.has(event.path)) needs.set(event.path, newNeed(event, { reads: 0, how: event.how, knownFrom: { kind: 'start', path: null, message: null, event: null } }));
      continue;
    }
    if (!test.isNeed(event.path)) {
      if (isProjectPath(event.path)) { other.codeFiles.add(event.path); other.codeTokens += tokens; } else { other.outsideFiles.add(event.path); other.outsideTokens += tokens; }
      continue;
    }
    const known = needs.get(event.path);
    if (known) { known.reads += 1; continue; }
    needs.set(event.path, newNeed(event, { reads: 1, how: null, knownFrom: event.knownFrom ?? { kind: 'none', path: null, message: null, event: null } }));
  }
  return {
    needs: [...needs.values()].sort((a, b) => a.firstEvent - b.firstEvent),
    otherReads: { codeFiles: other.codeFiles.size, codeTokens: other.codeTokens, outsideFiles: other.outsideFiles.size,
      outsideTokens: other.outsideTokens, searches: other.searches, misses: other.misses,
      excludedFiles: other.excludedFiles.size, excludedTokens: other.excludedTokens }
  };
}

// ---------- the check of the corrections ----------

// The parts of a file text that go to the model: all of it, or its head and its tail.
const seenParts = text => (text.length <= FILE_HEAD + FILE_TAIL ? [text] : [text.slice(0, FILE_HEAD), text.slice(-FILE_TAIL)]);

function cutFile(text) {
  const parts = seenParts(text);
  return parts.length === 1 ? text : `${parts[0]}\n[cut: ${num(text.length - FILE_HEAD - FILE_TAIL)} characters]\n${parts[1]}`;
}

// The texts the agent had before message `n`: the start load, plus the main thread reads and loads of
// need paths before that message. Returns a Map path -> list of texts, in the order the agent got them.
// The path rule of step 10 decides here, so a file that is out now stays: the question is what the agent had.
function textsBefore(session, memo, n) {
  const texts = new Map();
  const add = (rel, text) => {
    if (!text) return;
    const list = texts.get(rel) || [];
    if (!list.includes(text)) list.push(text);
    texts.set(rel, list);
  };
  for (const item of session.startLoad) add(item.path, memo.startLoadText?.[item.path]);
  for (const event of session.events) {
    if (event.thread !== 'main' || event.message == null || event.message >= n) continue;
    if ((event.kind === 'read' || event.kind === 'load') && wasNeedPath(event.path)) add(event.path, memo.eventText?.[event.i]);
  }
  return texts;
}

// ---------- the files of today (step 10) ----------

// The place on disk of a report path: the settings home for ~/.claude/, the home folder for ~/, else the project.
function absOf(rel, model) {
  if (isUserPath(rel)) return path.join(model.claudeSettingsHome, rel.slice('~/.claude/'.length));
  if (rel.startsWith('~/')) return path.join(os.homedir(), rel.slice(2));
  if (rel.startsWith('/')) return rel;
  return path.join(model.project.root, rel);
}

// The words of a text for the word match: runs of letters and digits in lower case, 2 characters or more,
// no stop words. A plural "s" goes ("rules" is "rule", "copies" is "copy"). No other change of a word.
function wordsOf(text) {
  const words = new Set();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue;
    const word = raw.length > 4 && raw.endsWith('ies') ? `${raw.slice(0, -3)}y`
      : raw.length > 3 && raw.endsWith('s') && !/(?:ss|us|is)$/.test(raw) ? raw.slice(0, -1) : raw;
    if (!STOP_WORDS.has(word)) words.add(word);
  }
  return words;
}

// The texts of today, read from disk one time for each run. Nothing here comes from a session.
// - read(rel): the text of a file, or null when the tool cannot read it or it is empty.
// - words(rel): the words of a file that has text, and its size in words (100 or more).
// - index: the path of the memory index, or null.
// - pool(): the files that a word match can give (each context file of the map that can be a need, and each memory
//   file with text), and the weight of a word. A file that is out is not in the pool, so it is never a file of
//   today for the check. The weight is a whole number, so each machine gives the same order:
//   1 + floor(log2(files of the pool / files of the pool that hold the word)).
function todayFiles(model, test) {
  const texts = new Map();
  const auto = readMemory({ root: model.project.root, claudeSettingsHome: model.claudeSettingsHome });
  for (const file of auto.files) texts.set(file.path, file.text);
  const read = rel => {
    if (!texts.has(rel)) {
      let text = null;
      try { text = readFileSync(absOf(rel, model), 'utf8'); } catch { /* not on disk now, or not a file */ }
      texts.set(rel, text);
    }
    const text = texts.get(rel);
    return text && text.trim() ? text : null;
  };
  const known = new Map();
  const words = rel => {
    if (!known.has(rel)) {
      // The words of the part that goes to the model. The name of the file counts too: a memory file name says what the file is about.
      const list = wordsOf([path.posix.basename(rel).replace(/\.[^.]+$/, ''), ...seenParts(read(rel))].join('\n'));
      known.set(rel, { words: list, size: Math.max(list.size, MATCH_SHORT_FILE) });
    }
    return known.get(rel);
  };
  let pool = null;
  const buildPool = () => {
    const paths = new Set(auto.files.map(file => file.path));
    for (const file of model.map?.files || []) if (test.isNeed(file.path)) paths.add(file.path);
    const files = [];
    const holders = new Map();
    for (const rel of [...paths].sort(cmp)) {
      if (read(rel) == null) continue;
      const entry = { path: rel, ...words(rel) };
      for (const word of entry.words) holders.set(word, (holders.get(word) || 0) + 1);
      files.push(entry);
    }
    // A word that no file of the pool holds (a file outside the map can have one) counts as a word of 1 file.
    const weight = word => {
      let bits = 1;
      for (let rest = Math.floor(files.length / (holders.get(word) || 1)); rest > 1; rest = Math.floor(rest / 2)) bits += 1;
      return bits;
    };
    return { files, weight };
  };
  return { read, words, index: auto.index ? auto.index.path : null, pool: () => { pool ??= buildPool(); return pool; } };
}

// The word match of one file with the words of one correction: the sum of the weights of the shared words,
// or 0 when the file shares fewer than 2 words.
function matchSum(words, file, weight) {
  let shared = 0;
  let sum = 0;
  for (const word of words) if (file.words.has(word)) { shared += 1; sum += weight(word); }
  return shared >= MATCH_MIN_WORDS ? sum : 0;
}

// The score of a match is the square of its sum, divided by the size of the file in words: a rare word counts
// more, and a long file does not win only because it has many words. The higher score comes first.
// The compare uses whole numbers only (no division), so each machine gives the same order.
const byScore = (a, b) => b.sum * b.sum * a.size - a.sum * a.sum * b.size;

// The files of today that can hold the fact of a correction of this session, each one time:
// - written: the need paths that the session wrote in or after the message of the first correction. The best word
//   match with a correction comes first, then the order of the writes.
// - others: the memory index, then the start load files of today, then the word matches by rank (the best match
//   of each correction, then the second of each, up to 5 for each correction). A word match is a file of the pool
//   that is not in the list yet. The best score comes first, then plain path order.
// A file that is not on disk now is left out.
function pathsNow({ corrections, session, model, today, test }) {
  const taken = new Set();
  const take = rel => { if (taken.has(rel) || today.read(rel) == null) return false; taken.add(rel); return true; };
  const pool = today.pool();
  const words = corrections.map(item => wordsOf(`${item.text}\n${item.quote}`));
  const first = Math.min(...corrections.map(item => item.message));
  const written = [];
  for (const event of session.events) {
    if (event.kind !== 'edit' || event.message == null || event.message < first || !test.isNeed(event.path) || !take(event.path)) continue;
    const file = today.words(event.path);
    written.push({ path: event.path, order: written.length, size: file.size, sum: Math.max(...words.map(list => matchSum(list, file, pool.weight))) });
  }
  written.sort((a, b) => byScore(a, b) || a.order - b.order);
  const others = [];
  if (today.index && take(today.index)) others.push(today.index);
  for (const item of model.startLoad) if (START_WHAT.has(item.what) && take(item.path)) others.push(item.path);
  const ranked = words.map(list => pool.files.filter(file => !taken.has(file.path))
    .map(file => ({ path: file.path, size: file.size, sum: matchSum(list, file, pool.weight) })).filter(item => item.sum > 0)
    .sort((a, b) => byScore(a, b) || cmp(a.path, b.path)).slice(0, MATCH_FILES));
  for (let rank = 0; rank < MATCH_FILES; rank += 1) for (const list of ranked) if (list[rank] && take(list[rank].path)) others.push(list[rank].path);
  return { written: written.map(item => item.path), others };
}

// ---------- the check input and the check of the answer ----------

// Returns { input, now }. `now` is a Map path -> text on disk of each file in the "Files now" part.
function checkInput({ sessionId, corrections, session, memo, model, today, test }) {
  const all = new Map();
  const blocks = [];
  for (const item of corrections) {
    const texts = textsBefore(session, memo, item.message);
    item.texts = texts;
    for (const [rel, list] of texts) {
      const known = all.get(rel) || [];
      for (const text of list) if (!known.includes(text)) known.push(text);
      all.set(rel, known);
    }
    blocks.push([`## Correction ${item.id} (message ${item.message})`, `Fact: ${squash(item.text)}`, `User words: ${squash(item.quote)}`,
      `Files the agent had: ${[...texts.keys()].join(', ') || 'none'}`].join('\n'));
  }
  const files = [...all].map(([rel, list]) => `## File ${rel}\n${cutFile(list.join('\n\n'))}`);
  const base = [`context-health needs-check ${PROMPT_VERSION} session ${sessionId}`, `Corrections: ${corrections.length}`, ...blocks, ...files].join('\n\n');
  // The "Files now" part gets 60,000 characters, or less when the rest of the input leaves less room below the
  // input limit. A file that does not fit is left out, and the next files can still go in.
  const room = Math.min(FILES_NOW_LIMIT, INPUT_LIMIT - base.length - 3);
  const now = new Map();
  const parts = [];
  let used = 'Files now: 999'.length;
  // Returns false when the file does not fit below the limit.
  const put = (rel, limit) => {
    const text = today.read(rel);
    // No text goes to the model two times: a file of today with the text that the agent had gets one line.
    const had = all.get(rel);
    const same = had?.length === 1 && had[0].trimEnd() === text.trimEnd();
    const block = `## File now ${rel}\n${same ? `[the same text as under "## File ${rel}"]` : cutFile(text)}`;
    if (used + 2 + block.length > limit) return false;
    used += 2 + block.length;
    parts.push(block);
    now.set(rel, text);
    return true;
  };
  if (room > used) {
    const { written, others } = pathsNow({ corrections, session, model, today, test });
    // The files that the session wrote come first, but they get only half of the room, so the memory index, the
    // start files and the word matches go in too. A written file that does not fit in that half waits for the end.
    const waiting = written.filter(rel => !put(rel, Math.floor(room / 2)));
    for (const rel of [...others, ...waiting]) put(rel, room);
  }
  return { input: `${[base, `Files now: ${parts.length}`, ...parts].join('\n\n')}\n`, now };
}

// Where the fact is today, from the `now` of one check. It counts only when the path is a file of today in the
// input and the quote is in the text of that file on disk. Each other case means not saved.
function savedOf(check, now) {
  const none = { savedPath: null, savedQuote: null };
  const value = check.now;
  if (!value || typeof value !== 'object' || typeof value.path !== 'string' || typeof value.quote !== 'string') return none;
  const text = now.get(value.path);
  const quote = value.quote.trim();
  if (text == null || squash(quote).length < MIN_QUOTE || !squash(text).includes(squash(quote))) return none;
  return { savedPath: value.path, savedQuote: quote };
}

// Throws on an answer that does not check each correction (then the call is tried again).
// A bad `now` does not throw: the fact is not saved, and the rest of the answer counts.
function parseChecks(text, corrections, now) {
  const answer = jsonOf(text);
  if (!answer || !Array.isArray(answer.checks)) throw new Error('no checks list');
  const byId = new Map();
  for (const item of answer.checks) if (item && typeof item === 'object' && typeof item.correction === 'string' && !byId.has(item.correction)) byId.set(item.correction, item);
  const results = {};
  for (const item of corrections) {
    const check = byId.get(item.id);
    if (!check) throw new Error(`no check for ${item.id}`);
    // No kind, or another word: null. The fact then counts as a rule, so it is not lost.
    const factKind = FACT_KINDS.has(check.kind) ? check.kind : null;
    if (check.found !== true) { results[item.id] = { checkResult: 'not-found', path: null, sourceQuote: null, ...savedOf(check, now), factKind }; continue; }
    const quote = typeof check.quote === 'string' ? check.quote.trim() : '';
    const list = typeof check.path === 'string' ? item.texts.get(check.path) : null;
    const good = list && squash(quote).length >= MIN_QUOTE && list.some(text => squash(text).includes(squash(quote)));
    // The agent had the fact: the context was not the problem, so no "saved" place is kept.
    results[item.id] = good ? { checkResult: 'had', path: check.path, sourceQuote: quote, savedPath: null, savedQuote: null, factKind }
      : { checkResult: 'bad-quote', path: null, sourceQuote: null, ...savedOf(check, now), factKind };
  }
  return results;
}

function readCache(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return typeof data.result === 'string' ? data : null;
  } catch { return null; }
}

// ---------- main ----------

// options: { allowCalls, model, cacheDir }
// `keep`: a Map that gets the check of each session. `given`: such a Map. With it, the checks are not made again.
export async function findNeeds({ model, memory, options, keep = null, given = null }) {
  const { allowCalls = false, call = runClaude, model: modelName = 'sonnet', cacheDir } = options;
  const prompt = readFileSync(PROMPT_FILE, 'utf8');
  const folder = path.join(cacheDir, 'needs');
  const mapFiles = new Map((model.map?.files || []).map(file => [file.path, file]));
  const test = needTest(model);
  const sessionsById = new Map(model.sessions.list.map(session => [session.sessionId, session]));
  // The dropped reads: path -> { reason, reads, intents }. One need for each intent and path.
  const droppedFiles = new Map();
  const dropFor = key => (rel, reason) => {
    const item = droppedFiles.get(rel) || { path: rel, reason, reads: 0, intents: new Set() };
    item.reads += 1;
    item.intents.add(key);
    droppedFiles.set(rel, item);
  };
  // The files of today are read only when a session has a correction to check.
  let today = null;

  const items = model.intents.sessions.filter(entry => entry.status === 'ok').map(entry => {
    const session = sessionsById.get(entry.sessionId);
    const memo = memory.get(entry.sessionId) || {};
    const startPaths = startPathsOf(model, session);
    const intents = entry.intents.map(intent => ({ intent,
      ...intentReads({ intent, session, model, mapFiles, startPaths, test, drop: dropFor(`${entry.sessionId}:${intent.id}`) }) }));
    const corrections = entry.intents.flatMap(intent => intent.corrections.filter(item => item.cause === 'missing-context'))
      .map(item => ({ ...item }));
    const item = { entry, session, intents, corrections, check: { status: 'not-needed', reason: null, costUsd: null }, results: null };
    if (!corrections.length) return item;
    if (given) return Object.assign(item, given.get(entry.sessionId));
    today ??= todayFiles(model, test);
    Object.assign(item, checkInput({ sessionId: entry.sessionId, corrections, session, memo, model, today, test }));
    item.key = sha256(`${prompt}\n${modelName}\n${item.input}`);
    item.file = path.join(folder, `${entry.sessionId}.${item.key}.json`);
    return item;
  });

  const pending = [];
  for (const item of items) {
    if (!item.corrections.length || given) continue;
    const parse = text => parseChecks(text, item.corrections, item.now);
    const cached = readCache(item.file);
    if (cached) {
      try {
        item.results = parse(cached.result);
        item.check = { status: 'ok', reason: null, costUsd: cached.costUsd ?? null };
        continue;
      } catch { /* a bad cache file counts as a miss */ }
    }
    if (item.input.length > INPUT_LIMIT) {
      item.check = { status: 'failed', reason: `the model input has ${num(item.input.length)} characters, the limit is ${num(INPUT_LIMIT)}`, costUsd: null };
      continue;
    }
    if (!allowCalls) { item.check = { status: 'not-analysed', reason: 'not analysed: run with --intents', costUsd: null }; continue; }
    pending.push(item);
  }

  if (pending.length) {
    mkdirSync(folder, { recursive: true });
    console.log(`needs: ${pending.length} check calls (${modelName}), up to ${PARALLEL} at a time`);
    await mapLimit(pending, PARALLEL, async item => {
      const result = await call({ model: modelName, systemPrompt: prompt, input: item.input, parse: text => parseChecks(text, item.corrections, item.now) });
      if (!result.ok) { item.check = { status: 'failed', reason: result.reason, costUsd: null }; return; }
      writeFileSync(item.file, `${JSON.stringify({ promptVersion: PROMPT_VERSION, model: modelName, sessionId: item.entry.sessionId,
        key: item.key, costUsd: result.costUsd, result: result.text, checked: result.value }, null, 2)}\n`);
      item.results = result.value;
      item.check = { status: 'ok', reason: null, costUsd: result.costUsd };
    });
  }

  if (keep) for (const item of items) keep.set(item.entry.sessionId, { check: item.check, results: item.results });
  const sessions = items.map(item => ({
    sessionId: item.entry.sessionId,
    check: item.check,
    intents: item.intents.map(({ intent, needs: fileNeeds, otherReads }) => {
      const taskFacts = [];
      const others = intent.corrections.filter(correction => correction.cause === 'missing-context').flatMap(correction => {
        const result = item.results?.[correction.id] || { checkResult: 'not-checked', path: null, sourceQuote: null };
        const had = result.checkResult === 'had';
        const saved = { savedPath: result.savedPath ?? null, savedQuote: result.savedQuote ?? null };
        // A task fact is not a need. A fact that the agent had stays a `had` need, with each kind.
        if (!had && result.factKind === 'task') {
          taskFacts.push({ correctionId: correction.id, message: correction.message, text: correction.text, quote: correction.quote,
            checkResult: result.checkResult, ...saved, factKind: 'task' });
          return [];
        }
        return [{ id: null, kind: had ? 'had' : 'missing', path: result.path,
          correctionId: correction.id, message: correction.message, text: correction.text, quote: correction.quote,
          checkResult: result.checkResult, sourceQuote: result.sourceQuote, ...saved,
          ...(had ? {} : { factKind: result.factKind ?? null }) }];
      }).sort((a, b) => a.message - b.message);
      taskFacts.sort((a, b) => a.message - b.message);
      const needs = [...fileNeeds, ...others];
      needs.forEach((need, index) => { need.id = `n${index + 1}`; });
      const count = kind => needs.filter(need => need.kind === kind).length;
      return { intentId: intent.id, from: intent.from, to: intent.to, needs, taskFacts, otherReads,
        totals: { fileNeeds: count('file'), missing: count('missing'), had: count('had') } };
    })
  }));
  const waiting = sessions.filter(entry => entry.check.status === 'not-analysed').length;
  if (waiting && !given) console.log(`needs: ${waiting} sessions have a missing-context check that is not analysed. Run with --intents.`);
  const failed = sessions.filter(entry => entry.check.status === 'failed').length;
  if (!given && (pending.length || failed)) console.log(`needs: ${sessions.filter(entry => entry.check.status === 'ok').length} checks ok, ${failed} failed`);
  // The task facts of the run: session order, then intent, then correction.
  const taskList = sessions.flatMap(entry => entry.intents.flatMap(intent => intent.taskFacts.map(fact => (
    { sessionId: entry.sessionId, intentId: intent.intentId, correctionId: fact.correctionId, text: fact.text, quote: fact.quote }))));
  return { promptVersion: PROMPT_VERSION, sessions, dropped: droppedReport(droppedFiles), taskFacts: { count: taskList.length, list: taskList } };
}

// `needs.dropped`: the totals, the counts for each reason (only the reasons with a count, in the order of the
// reason list, then `user-other`), and each file. `needs` counts one for each intent and path, `reads` each event.
function droppedReport(droppedFiles) {
  const list = [...droppedFiles.values()].map(item => ({ path: item.path, reason: item.reason, needs: item.intents.size, reads: item.reads }))
    .sort((a, b) => b.needs - a.needs || b.reads - a.reads || cmp(a.path, b.path));
  const sums = items => ({ needs: items.reduce((sum, item) => sum + item.needs, 0), reads: items.reduce((sum, item) => sum + item.reads, 0), files: items.length });
  const byReason = {};
  for (const reason of [...REASONS, USER_OTHER]) {
    const items = list.filter(item => item.reason === reason);
    if (items.length) byReason[reason] = sums(items);
  }
  return { ...sums(list), byReason, list };
}
