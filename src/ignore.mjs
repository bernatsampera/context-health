// The options that ignore a part of the context (`--ignore user,skills`), as if the files were not there.
// - user: each file outside the project: ~/.claude/CLAUDE.md, ~/AGENTS.md, the memory, the user skills, commands, agents and rules.
//   A CLAUDE.md above the project in the same git repository is a file of the team: it stays.
// - skills: the skills, commands and agents of the project and of the user.
// The model steps run on the full context, so an option costs no call. Then the ignored files go out of the map,
// the needs, the duplicates and the start load, and all numbers come from what is left.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

export const IGNORE = ['user', 'skills'];
// With no choice, both are ignored: the score says how good the context of the project itself is (method v2).
export const DEFAULT_IGNORE = ['user', 'skills'];
const WORDS = { user: 'user settings', skills: 'skills' };
// The text for the page, or null. An example: "user settings and skills".
export const ignoreText = ignore => (ignore?.length ? ignore.map(name => WORDS[name]).join(' and ') : null);

// Returns the list in a fixed order. Throws an Error on a word that is not an option.
export function parseIgnore(value) {
  const words = String(value).split(',').map(word => word.trim()).filter(word => word && word !== 'none');
  const wrong = words.find(word => !IGNORE.includes(word));
  if (wrong) throw new Error(`--ignore takes ${IGNORE.join(', ')} or none: ${wrong}`);
  return IGNORE.filter(name => words.includes(name));
}

const isOutside = rel => rel.startsWith('~/') || rel.startsWith('/');
const PROJECT_SKILL = /^(?:.*\/)?\.(?:claude\/(?:skills|commands|agents)|agents\/skills)\//;
const isSkill = rel => PROJECT_SKILL.test(rel) || (rel.startsWith('~/.claude/') && rel.split('/').slice(2, -1).some(name => ['skills', 'commands', 'agents'].includes(name)) && !/^~\/\.claude\/projects\//.test(rel));

// The test for one path of the report.
export function ignoreTest(ignore) {
  const user = Boolean(ignore?.includes('user'));
  const skills = Boolean(ignore?.includes('skills'));
  return rel => Boolean(rel) && ((user && isOutside(rel)) || (skills && isSkill(rel)));
}

const real = dir => { try { return realpathSync(dir); } catch { return dir; } };

// The model of step 1 with no ignored item in the start load and in `later`. `root`: the project folder of today.
export function ignoreStart(model, { ignore, root, home }) {
  if (!ignore?.length) return model;
  const ignored = ignoreTest(ignore);
  let top = null;
  try { top = real(execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { /* no git */ }
  const absOf = rel => (rel.startsWith('~/') ? path.join(home, rel.slice(2)) : rel);
  const ofTeam = item => item.scope === 'parent folder' && top != null && real(absOf(item.path)).startsWith(top + path.sep);
  const keep = item => ofTeam(item) || (!ignored(item.path) && !(ignore.includes('skills') && / (?:description|body)$/.test(item.what)));
  const startLoad = model.startLoad.filter(keep);
  const later = model.later.filter(keep);
  const sum = items => items.reduce((total, item) => total + (item.tokens || 0), 0);
  return { ...model, startLoad, later, ignore: [...ignore],
    totals: { ...model.totals, startLoadTokens: sum(startLoad), startLoadItems: startLoad.length, laterTokens: sum(later) } };
}

// The results of the corrections check with no saved place in an ignored file.
export function ignoreSaved(results, ignore) {
  const ignored = ignoreTest(ignore);
  return results && Object.fromEntries(Object.entries(results).map(([id, item]) => [id, ignored(item.savedPath) ? { ...item, savedPath: null, savedQuote: null } : item]));
}

// The duplicate facts with no place in an ignored file. A fact needs 2 places.
export function ignoreDuplicates(duplicates, ignore) {
  const ignored = ignoreTest(ignore);
  const facts = duplicates.facts.map(fact => ({ fact, places: fact.places.filter(place => !ignored(place.path)) })).filter(item => item.places.length >= 2)
    .map(({ fact, places }) => ({ ...fact, places, differ: fact.differ && (places.length === fact.places.length || new Set(places.map(place => place.value ?? place.quote)).size > 1) }));
  return { ...duplicates, facts: facts.map((fact, k) => ({ ...fact, id: `f${k + 1}` })) };
}
