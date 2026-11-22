// Step 9a: facts that are written in two or more context files.
// Two checks:
// 1. Exact (no model call, every run): a sentence of 6 or more words that is word for word in 2 or more files.
// 2. Model (one call per run, only with --intents, else the cache): the same fact with the same or a different
//    value, also when the words differ ("60 lines" in one file, "80 lines" in another).
// The code checks each model quote against the file text.
// Step 10: `differ` needs two things. The model says that the places do not agree (`same: false`), and the code
// finds a concrete difference (a number, a literal or a name) between two kept places. Else the fact is a copy.
// It reads the context files from disk. It never writes into the project.
// Step 11: it reads only the context files of the map that can be a need. A file that is out is never read.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { INPUT_LIMIT, jsonOf, runClaude } from './intents.mjs';
import { needTest } from './context-files.mjs';

export const PROMPT_VERSION = 'duplicates-v2';
const PROMPT_FILE = new URL(`./prompts/${PROMPT_VERSION}.md`, import.meta.url);
const MIN_WORDS = 6;
const MIN_CHARS = 30;
const WHAT_MAX = 90;

const sha256 = text => createHash('sha256').update(text).digest('hex');
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
// Plain string order (not the locale), so two machines give the same order.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The text a reader sees: no link targets, no markdown marks, one space, lower case.
export const norm = text => squash(String(text ?? '')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[`*_>#|~]/g, ' ')
  .replace(/^\s*(?:[-+]|\d+[.)])\s+/gm, ' ')).toLowerCase();

const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 3).trimEnd()}...` : text);

// ---------- the files ----------

// The full path of a context file. `~/.claude/` files are in the settings home of the run. Other `~/` paths are not read.
function absoluteOf(model, rel) {
  if (rel.startsWith('~/.claude/')) return path.join(model.claudeSettingsHome, rel.slice('~/.claude/'.length));
  if (rel.startsWith('~/') || rel.startsWith('/')) return null;
  return path.join(model.project.root, rel);
}

function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

// The real path of a file: 2 paths with the same real path are one file on disk (a symbolic link).
function realOf(file) {
  try { return realpathSync(file); } catch { return file; }
}

// The context files that can be needs, with their text, in the order of the model input (step 10):
// 1. The needed files: more uses for each character of text first, then more uses, then path. So one large file
//    with many uses does not push out many small needed files, and the one call checks more of the needs.
// 2. The other files: fewer map steps first, no route last, then path.
// The uses of a file: the file needs (not gone) with its path, over all intents. A needed file has 1 or more uses.
// `size` is the length of the text that goes into the input (no space at its end).
// Step 11: one file on disk with 2 paths (a skill folder that is a symbolic link) is read one time. Else each of its
// sentences is a copy of itself. The path with more uses stays, then the path with fewer map steps, then the first path.
// The uses of the other paths go to the path that stays.
function contextTexts(model) {
  const uses = new Map();
  for (const entry of model.needs?.sessions || []) {
    for (const intent of entry.intents) {
      for (const need of intent.needs) if (need.kind === 'file' && need.state !== 'gone') uses.set(need.path, (uses.get(need.path) || 0) + 1);
    }
  }
  const { isNeed } = needTest(model);
  const list = [];
  for (const file of model.map.files) {
    if (!isNeed(file.path)) continue;
    const abs = absoluteOf(model, file.path);
    const text = abs && readText(abs);
    if (text == null) continue;
    list.push({ path: file.path, text, size: text.trimEnd().length, uses: uses.get(file.path) || 0, steps: file.steps ?? null, real: realOf(abs) });
  }
  const far = file => (file.steps == null ? Number.MAX_SAFE_INTEGER : file.steps);
  const byReal = new Map();
  for (const file of list) byReal.set(file.real, [...(byReal.get(file.real) || []), file]);
  const single = [];
  for (const same of byReal.values()) {
    same.sort((a, b) => b.uses - a.uses || far(a) - far(b) || cmp(a.path, b.path));
    const { real: _r, ...kept } = same[0];
    single.push({ ...kept, uses: same.reduce((sum, file) => sum + file.uses, 0) });
  }
  // Uses for each character, with whole numbers only (no division): a.uses / a.size > b.uses / b.size is
  // a.uses * b.size > b.uses * a.size. Two files with no use give 0 here, and their map steps decide.
  const dense = (a, b) => b.uses * a.size - a.uses * b.size;
  // A file with no use: the files of the project first, then the files outside it (`~/.claude/` skills, commands, agents
  // and memory files). Else the user files, which are all 1 step away, take the room of the project files.
  const outside = file => (file.path.startsWith('~/') || file.path.startsWith('/') ? 1 : 0);
  return single.sort((a, b) => (b.uses > 0) - (a.uses > 0) || dense(a, b) || b.uses - a.uses || (a.uses ? 0 : outside(a) - outside(b) || far(a) - far(b)) || cmp(a.path, b.path));
}

// ---------- exact check ----------

// The sentences of a file that can be a copy: no front matter, no code blocks, no headings, no table rules.
export function sentencesOf(text) {
  const out = [];
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  let fence = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence || !line || line.startsWith('#') || /^\|?[\s:|-]+\|?$/.test(line)) continue;
    const cells = line.startsWith('|') ? line.split('|').map(cell => cell.trim()).filter(Boolean) : [line.replace(/^(?:[-+*]|\d+[.)])\s+/, '')];
    for (const cell of cells) {
      for (const sentence of cell.split(/(?<=[.!?])\s+(?=[A-Z`*[(])/)) {
        // A sentence that starts with a link is an index entry, not a fact.
        if (/^\[[^\]]*\]\(/.test(sentence.trim())) continue;
        const n = norm(sentence).replace(/[.!?:;,]+$/, '');
        // Words of the plain sentence: `pipeline_status` is one word.
        const words = sentence.replace(/[`*]/g, '').trim().split(/\s+/).length;
        if (n.length >= MIN_CHARS && words >= MIN_WORDS) out.push({ quote: sentence.trim(), n });
      }
    }
  }
  return out;
}

function exactFacts(files) {
  const bySentence = new Map();
  // In path order, so the exact facts do not change with the order of the model input.
  for (const file of [...files].sort((a, b) => cmp(a.path, b.path))) {
    for (const sentence of sentencesOf(file.text)) {
      const places = bySentence.get(sentence.n) || new Map();
      if (!places.has(file.path)) places.set(file.path, sentence.quote);
      bySentence.set(sentence.n, places);
    }
  }
  const facts = [];
  for (const [n, places] of bySentence) {
    if (places.size < 2) continue;
    const list = [...places.entries()].sort((a, b) => cmp(a[0], b[0]));
    facts.push({ what: clip(squash(list[0][1]), WHAT_MAX), differ: false, source: 'exact', key: n,
      places: list.map(([rel, quote]) => ({ path: rel, quote, value: null })) });
  }
  return facts;
}

// ---------- model check ----------

function modelInput(files) {
  // The id is a hash of the sorted file paths only (not their text, not their order in the input, not which are
  // needed), so one fake answer serves every text version of the same files and every set of sessions.
  const runId = `run-${sha256(files.map(file => file.path).sort(cmp).join('\n')).slice(0, 12)}`;
  const head = `context-health duplicates ${PROMPT_VERSION} session ${runId}`;
  let input = `${head}\nFiles: ${files.length}\n`;
  const checked = [];
  for (const file of files) {
    const block = `\n### FILE ${file.path}\n${file.text.trimEnd()}\n`;
    // A file that does not fit is left out. A smaller file after it can still go in.
    if (input.length + block.length > INPUT_LIMIT) continue;
    input += block;
    checked.push(file);
  }
  // The count line must name the files that went in.
  input = input.replace(`\nFiles: ${files.length}\n`, `\nFiles: ${checked.length}\n`);
  return { input, checked };
}

// Throws on a bad answer (then the call is tried again): not a list, no verdict `same` (true or false), an unknown
// path, an empty quote or value.
function checkAnswer(answer, known) {
  if (!answer || !Array.isArray(answer.facts)) throw new Error('no facts list');
  return answer.facts.map((fact, k) => {
    if (!fact || typeof fact !== 'object') throw new Error(`fact ${k + 1} is not an object`);
    const what = squash(fact.what);
    if (!what) throw new Error(`fact ${k + 1} has no what`);
    if (typeof fact.same !== 'boolean') throw new Error(`fact ${k + 1} has no same (true or false)`);
    if (!Array.isArray(fact.places) || fact.places.length < 2) throw new Error(`fact ${k + 1} has fewer than 2 places`);
    const places = fact.places.map((place, j) => {
      if (!place || !known.has(place.path)) throw new Error(`fact ${k + 1} place ${j + 1}: unknown file ${JSON.stringify(place?.path)}`);
      const quote = squash(place.quote);
      const value = squash(place.value);
      if (!quote) throw new Error(`fact ${k + 1} place ${j + 1} has no quote`);
      if (!value) throw new Error(`fact ${k + 1} place ${j + 1} has no value`);
      return { path: place.path, quote, value };
    });
    return { what, same: fact.same, places };
  });
}

// ---------- the concrete parts of a value ----------
// The code does not compare the free words of two values: "only when asked" and "only when told" are the same value.
// It compares the concrete parts only:
// - numbers: digits ("60", "80.5"), a version as one part ("24.22.1"), a date or a range as its number parts
//   ("2090-01-01" is 2090, 1, 1), a number with a joined unit ("60s" is 60), and the number words zero to twenty.
//   An ordinal ("first", "1st") is not a number.
// - literals: the words of the value that the quote has in backticks or in double quotes (a span of 3 words or fewer).
// - names: the words of the value that hold `-`, `_`, `.`, `/` or a digit.
// Two places differ when each has a concrete part that the other does not have. A side that only adds detail
// ("1 to 3" and "3 or less", "2090" and "2090-01-01") is the same value.

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const LITERAL_MAX_WORDS = 3;
const NUMBER = /^\d+(?:\.\d+)*$/; // 60, 80.5, 24.22.1
const NUMBER_LIST = /^\d+(?:[.\/-]\d+)+$/; // a date or a range: 2090-01-01, 1-3
const NUMBER_UNIT = /^v?(\d+(?:\.\d+)*)\p{L}*$/u; // 60s, 100ms, v2
const ORDINAL = /^\d+(?:st|nd|rd|th)$/;
const NAME = /[-_./\d]/;
const ABBREVIATION = /^(?:\p{L}\.)+\p{L}$/u; // e.g, i.e

// The words of a text in their compare form: lower case, "10,000" as 10000, no link scheme ("https://"), cut at
// `=`, `,`, `;` and `:`, and no marks at the ends of a word ("--scope" is "scope", "(24.21.0)." is "24.21.0").
function wordsOf(text) {
  const out = [];
  for (const raw of String(text ?? '').toLowerCase().replace(/(\d),(?=\d{3}(?!\d))/g, '$1').split(/\s+/)) {
    const bare = raw.replace(/^[^\p{L}\p{N}~./@_]+/u, '').replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    for (const piece of bare.split(/[=,;]|:(?!\/)/)) {
      const word = piece.replace(/^[^\p{L}\p{N}~./@_]+/u, '').replace(/^~(?!\/)/, '').replace(/[^\p{L}\p{N}_]+$/u, '');
      if (word) out.push(word);
    }
  }
  return out;
}

// The literal words of a quote: the words in a backtick span, or in a double-quoted span outside the backticks.
// A span of more than 3 words is a command or a sentence, not a value: it gives no literal.
function literalsOf(quote) {
  const out = new Set();
  const add = span => {
    const words = wordsOf(span);
    if (words.length <= LITERAL_MAX_WORDS) for (const word of words) out.add(word);
  };
  const rest = String(quote ?? '').replace(/`+([^`]+)`+/g, (_all, span) => { add(span); return ' '; });
  for (const match of rest.matchAll(/"([^"]+)"|\u201C([^\u201D]+)\u201D/g)) add(match[1] ?? match[2]);
  return out;
}

// { numbers, names, words } of one place. `names` holds the literals and the names. `words` holds each word of the
// value that is not a number.
function partsOf(place) {
  const literals = literalsOf(place.quote);
  const numbers = new Set();
  const names = new Set();
  const words = new Set();
  // "01" is 1. A part with a dot stays as it is.
  const number = text => numbers.add(text.includes('.') ? text : text.replace(/^0+(?=\d)/, ''));
  for (const word of wordsOf(place.value)) {
    if (ORDINAL.test(word)) continue;
    if (NUMBER.test(word)) { number(word); continue; }
    if (NUMBER_LIST.test(word)) { for (const part of word.split(/[\/-]/)) number(part); continue; }
    const unit = word.match(NUMBER_UNIT);
    if (unit) { number(unit[1]); continue; }
    if (NUMBER_WORDS.includes(word)) { number(String(NUMBER_WORDS.indexOf(word))); continue; }
    words.add(word);
    if (literals.has(word) || (NAME.test(word) && !ABBREVIATION.test(word))) names.add(word);
  }
  return { numbers, names, words };
}

// A name or a number is in a word when it is the word, or a part of it that is cut at characters that are not
// letters or digits ("notes.md" is in "docs/notes.md", "8" is in "top-8").
function inWord(name, word) {
  const edge = char => char === undefined || !/[\p{L}\p{N}]/u.test(char);
  for (let at = word.indexOf(name); at >= 0; at = word.indexOf(name, at + 1)) {
    if (edge(word[at - 1]) && edge(word[at + name.length])) return true;
  }
  return false;
}
const hasName = (side, name) => [...side.words].some(word => inWord(name, word));

// "24" and "24.22" are the start of the version "24.22.1" (3 or more parts): the version only adds detail.
const startsVersion = (short, long) => long.split('.').length >= 3 && long.startsWith(`${short}.`);
// A word can hold a number too: "8" is in "top-8".
const hasNumber = (side, value) => [...side.numbers].some(other => other === value || startsVersion(value, other) || startsVersion(other, value)) || hasName(side, value);

// True when `a` has a concrete part that `b` does not have.
const hasMore = (a, b) => [...a.numbers].some(value => !hasNumber(b, value)) || [...a.names].some(name => !hasName(b, name));
const placesDiffer = (a, b) => hasMore(a, b) && hasMore(b, a);

// True when two of the places ({ quote, value }) have a concrete difference.
export function concreteDifference(places) {
  const parts = places.map(partsOf);
  return parts.some((a, i) => parts.some((b, j) => j > i && placesDiffer(a, b)));
}

// Keep the places whose quote is in the file. A fact needs 2 files. `differ` needs the verdict of the model
// (`same: false`) and a concrete difference between two kept places.
function verify(facts, texts, notes) {
  const out = [];
  facts.forEach((fact, k) => {
    const places = [];
    for (const place of fact.places) {
      if (places.some(item => item.path === place.path)) continue;
      if (!texts.get(place.path).includes(norm(place.quote))) {
        notes.push(`Fact ${k + 1} (${clip(fact.what, 50)}): the quote is not in ${place.path}, so that place is left out`);
        continue;
      }
      places.push(place);
    }
    if (places.length < 2) {
      if (fact.places.length >= 2) notes.push(`Fact ${k + 1} (${clip(fact.what, 50)}): fewer than 2 files are left, so it is left out`);
      return;
    }
    places.sort((a, b) => cmp(a.path, b.path));
    const concrete = concreteDifference(places);
    if (fact.same === false && !concrete) {
      notes.push(`Fact ${k + 1} (${clip(fact.what, 50)}): the model says that the places do not agree, but they show no different number, literal or name, so it is a copy`);
    }
    out.push({ what: clip(fact.what, WHAT_MAX), differ: fact.same === false && concrete, source: 'model', places });
  });
  return out;
}

function readCache(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return typeof data.result === 'string' ? data : null;
  } catch { return null; }
}

// An exact fact is the same as a model fact when each of its places is a place of the model fact with an overlapping quote.
function covered(exact, modelFacts) {
  return modelFacts.some(fact => exact.places.every(place => fact.places.some(item => item.path === place.path &&
    (norm(item.quote).includes(norm(place.quote).replace(/[.!?]+$/, '')) || norm(place.quote).includes(norm(item.quote).replace(/[.!?]+$/, ''))))));
}

// options: { allowCalls, model, cacheDir }
export async function findDuplicates({ model, options }) {
  const { allowCalls = false, model: modelName = 'sonnet', cacheDir } = options;
  const prompt = readFileSync(PROMPT_FILE, 'utf8');
  const files = contextTexts(model);
  const isNeeded = file => file.uses > 0;
  const needed = files.filter(isNeeded).length;
  const texts = new Map(files.map(file => [file.path, norm(file.text)]));
  const exact = exactFacts(files);
  const notes = [];
  const done = (check, modelFacts) => {
    const kept = exact.filter(fact => !covered(fact, modelFacts));
    const facts = [...modelFacts, ...kept.map(({ key: _k, ...fact }) => fact)]
      .sort((a, b) => (b.differ - a.differ) || b.places.length - a.places.length || cmp(a.what, b.what) || cmp(a.places[0].path, b.places[0].path))
      .map((fact, k) => ({ id: `f${k + 1}`, ...fact }));
    return { promptVersion: PROMPT_VERSION, model: modelName, files: files.length, exact: exact.length, check, facts, notes };
  };
  // `read`: the files that the model check read. Empty when the check did not run.
  const check = (status, reason, costUsd, read) => ({ status, reason, costUsd, checked: read.length, total: files.length,
    needed, neededChecked: read.filter(isNeeded).length });

  if (files.length < 2) return done(check('not-needed', null, null, files), []);
  const { input, checked } = modelInput(files);
  const counts = `${checked.length} of ${files.length} files, ${checked.filter(isNeeded).length} of ${needed} needed files`;
  // Only when the model check ran: a run with no check read no file.
  const limitNote = () => {
    if (checked.length < files.length) notes.push(`The model check read ${counts}: the others do not fit in the input limit of ${INPUT_LIMIT.toLocaleString('en-US')} characters`);
  };
  const known = new Set(checked.map(file => file.path));
  const key = sha256(`${prompt}\n${modelName}\n${input}`);
  const folder = path.join(cacheDir, 'duplicates');
  const file = path.join(folder, `${key}.json`);
  const parse = text => checkAnswer(jsonOf(text), known);
  const cached = readCache(file);
  let saved = null;
  if (cached) {
    // A bad cache file counts as a miss. An answer in the shape of duplicates-v1 (no `same`) is bad.
    try { saved = parse(cached.result); } catch { saved = null; }
  }
  if (saved) {
    limitNote();
    return done(check('ok', null, cached.costUsd ?? null, checked), verify(saved, texts, notes));
  }
  if (!allowCalls) {
    console.log(`duplicates: exact copies only. Run with --intents to check facts with different words or values (1 model call, ${counts}).`);
    return done(check('not-analysed', 'not analysed: run with --intents', null, []), []);
  }
  console.log(`duplicates: 1 model call (${modelName}) for ${counts}`);
  const result = await runClaude({ model: modelName, systemPrompt: prompt, input, parse });
  if (!result.ok) {
    console.log(`duplicates: failed (${result.reason}). Exact copies only.`);
    return done(check('failed', result.reason, null, []), []);
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ promptVersion: PROMPT_VERSION, model: modelName, key, costUsd: result.costUsd,
    result: result.text, checked: result.value }, null, 2)}\n`);
  limitNote();
  return done(check('ok', null, result.costUsd, checked), verify(result.value, texts, notes));
}
