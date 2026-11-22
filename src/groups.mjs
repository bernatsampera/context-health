// Step 8a: put similar intents of all sessions into groups, with a short label and a count.
// One model call per run, only with --intents, through runClaude and a cache of step 4.
// Without a good answer, each intent is its own group, with its goal as the label.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { INPUT_LIMIT, jsonOf, runClaude } from './intents.mjs';

export const PROMPT_VERSION = 'intent-groups-v1';
const PROMPT_FILE = new URL(`./prompts/${PROMPT_VERSION}.md`, import.meta.url);
const MAX_LABEL_WORDS = 8;

const sha256 = text => createHash('sha256').update(text).digest('hex');
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const intentNumber = id => Number(String(id).slice(1));
// Plain string order (not the locale), so two machines give the same order.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The ok intents in a fixed order: by sessionId, then by intent number. This is the "sorted input".
function sortedIntents(intents) {
  const list = [];
  for (const entry of intents.sessions) {
    if (entry.status !== 'ok') continue;
    for (const intent of entry.intents) list.push({ sessionId: entry.sessionId, intentId: intent.id, goal: squash(intent.goal) });
  }
  return list.sort((a, b) => cmp(a.sessionId, b.sessionId) || intentNumber(a.intentId) - intentNumber(b.intentId));
}

function modelInput(list) {
  const lines = list.map((item, index) => `${index + 1}. ${item.goal || '(no goal)'}`);
  // A run level call has no session. The id is a short hash of the sorted input, so the fake binary can find its answer.
  const runId = `run-${sha256(lines.join('\n')).slice(0, 12)}`;
  return { runId, input: `${[`context-health intent-groups ${PROMPT_VERSION} session ${runId}`, `Intents: ${list.length}`, ...lines].join('\n')}\n` };
}

// Throws on a bad answer (then the call is tried again). Returns { groups: [{ label, members: [index] }], notes }.
function checkAnswer(answer, n) {
  if (!answer || !Array.isArray(answer.groups)) throw new Error('no groups list');
  const seen = new Set();
  const notes = [];
  const groups = answer.groups.map((group, k) => {
    if (!group || typeof group !== 'object') throw new Error(`group ${k + 1} is not an object`);
    let label = squash(group.label);
    if (!label) throw new Error(`group ${k + 1} has no label`);
    const words = label.split(' ');
    if (words.length > MAX_LABEL_WORDS) {
      label = words.slice(0, MAX_LABEL_WORDS).join(' ');
      notes.push(`Cut the label of group ${k + 1} to ${MAX_LABEL_WORDS} words`);
    }
    if (!Array.isArray(group.members) || !group.members.length) throw new Error(`group ${k + 1} has no members`);
    for (const member of group.members) {
      if (!Number.isInteger(member) || member < 1 || member > n) throw new Error(`unknown intent ${JSON.stringify(member)}`);
      if (seen.has(member)) throw new Error(`intent ${member} is in two groups`);
      seen.add(member);
    }
    return { label, members: group.members.map(member => member - 1) };
  });
  if (seen.size !== n) throw new Error(`${n - seen.size} intents are in no group`);
  return { groups, notes };
}

function readCache(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return typeof data.result === 'string' ? data : null;
  } catch { return null; }
}

// Build the list: ids g1, g2, ... sorted by count (high first), then label, then the first member.
function buildList(list, groups, order) {
  const built = groups.map(group => {
    const members = group.members.map(index => list[index])
      .sort((a, b) => order.get(a.sessionId) - order.get(b.sessionId) || intentNumber(a.intentId) - intentNumber(b.intentId));
    return { label: group.label, count: members.length, members: members.map(item => ({ sessionId: item.sessionId, intentId: item.intentId })) };
  });
  const first = group => `${String(order.get(group.members[0].sessionId)).padStart(6, '0')}:${group.members[0].intentId}`;
  built.sort((a, b) => b.count - a.count || cmp(a.label, b.label) || cmp(first(a), first(b)));
  return built.map((group, k) => ({ id: `g${k + 1}`, label: group.label, count: group.count, members: group.members }));
}

// options: { allowCalls, model, cacheDir }
export async function findGroups({ model, options }) {
  const { allowCalls = false, model: modelName = 'sonnet', cacheDir } = options;
  const prompt = readFileSync(PROMPT_FILE, 'utf8');
  const order = new Map(model.sessions.list.map((session, k) => [session.sessionId, k]));
  const list = sortedIntents(model.intents);
  const alone = () => list.map(item => ({ label: item.goal || `Intent ${item.intentId}`, members: [list.indexOf(item)] }));
  const done = (status, reason, costUsd, groups, notes = []) => ({ promptVersion: PROMPT_VERSION, model: modelName, status, reason,
    costUsd, intents: list.length, list: buildList(list, groups, order), notes });

  if (list.length < 2) return done('not-needed', null, null, alone());
  const { input } = modelInput(list);
  if (input.length > INPUT_LIMIT) return done('failed', `the model input is above ${INPUT_LIMIT} characters`, null, alone());
  const key = sha256(`${prompt}\n${modelName}\n${input}`);
  const folder = path.join(cacheDir, 'groups');
  const file = path.join(folder, `${key}.json`);
  const parse = text => checkAnswer(jsonOf(text), list.length);
  const cached = readCache(file);
  if (cached) {
    try {
      const checked = parse(cached.result);
      return done('ok', null, cached.costUsd ?? null, checked.groups, checked.notes);
    } catch { /* a bad cache file counts as a miss */ }
  }
  if (!allowCalls) {
    console.log('groups: not analysed. Run with --intents to group the intents.');
    return done('not-analysed', 'not analysed: run with --intents', null, alone());
  }
  console.log(`groups: 1 model call (${modelName}) for ${list.length} intents`);
  const result = await runClaude({ model: modelName, systemPrompt: prompt, input, parse });
  if (!result.ok) {
    console.log(`groups: failed (${result.reason}). Each intent is its own group.`);
    return done('failed', result.reason, null, alone());
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ promptVersion: PROMPT_VERSION, model: modelName, key, costUsd: result.costUsd,
    result: result.text, checked: result.value }, null, 2)}\n`);
  return done('ok', null, result.costUsd, result.value.groups, result.value.notes);
}
