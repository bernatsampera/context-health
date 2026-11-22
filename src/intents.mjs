// Step 4: cut each selected session into intents with message ranges, and list the corrections of the user.
// This is the only step that calls a model, and only with --intents. Without it, it uses the cache only.
// The model gives the first message of each intent. The code builds the ranges, so they cover 1 to N
// with no gap and no overlap.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROMPT_VERSION = 'intents-v2';
export const INPUT_LIMIT = 240000; // characters of model input for one session
const PROMPT_FILE = new URL(`./prompts/${PROMPT_VERSION}.md`, import.meta.url);
const CAUSES = new Set(['missing-context', 'changed-mind', 'agent-error', 'unclear']);
const TEXT_HEAD = 1500;
const TEXT_TAIL = 500;
const AGENT_TEXT_CUT = 400;
const PARALLEL = 4;
const CALL_TIMEOUT_MS = 10 * 60 * 1000;
// Env of a parent Claude Code session. The call must not join that session.
const PARENT_ENV = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS', 'CLAUDE_CODE_SESSION_ATTENDED'];

const num = value => value.toLocaleString('en-US');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const roundCost = value => Math.round(value * 1e6) / 1e6;

// ---------- the model call (step 5 uses it too) ----------

function claudeBin() {
  const bin = process.env.CONTEXT_HEALTH_CLAUDE_BIN || 'claude';
  return bin.includes('/') ? path.resolve(bin) : bin;
}

function callOnce({ bin, args, input }) {
  return new Promise(resolve => {
    // A new empty folder outside the project for each call, so the call loads no project context.
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'context-health-call-'));
    const env = { ...process.env };
    for (const key of PARENT_ENV) delete env[key];
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { rmdirSync(cwd); } catch { /* not empty: leave it */ }
      resolve(result);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, reason: 'claude timed out', retry: true }); }, CALL_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', () => {});
    child.on('error', error => finish({ ok: false, reason: error.code === 'ENOENT' ? 'claude not found' : `claude did not start (${error.code})`, retry: false }));
    child.on('close', code => {
      if (code !== 0) return finish({ ok: false, reason: `claude exited with code ${code}`, retry: true });
      let envelope;
      try { envelope = JSON.parse(stdout); } catch { return finish({ ok: false, reason: 'bad answer: the output is not JSON', retry: true }); }
      const costUsd = Number(envelope.total_cost_usd) || 0;
      if (envelope.is_error || typeof envelope.result !== 'string') {
        return finish({ ok: false, reason: 'claude gave an error', retry: true, costUsd });
      }
      finish({ ok: true, text: envelope.result, costUsd });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// One model call, with one more try on a bad answer. `parse(text)` throws an Error on a bad answer.
// Returns { ok: true, text, value, costUsd } or { ok: false, reason }.
export async function runClaude({ model, systemPrompt, input, parse = text => text }) {
  const bin = claudeBin();
  const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--no-session-persistence',
    '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config', '--system-prompt', systemPrompt];
  let cost = 0;
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callOnce({ bin, args, input });
    cost += result.costUsd || 0;
    if (result.ok) {
      try {
        return { ok: true, text: result.text, value: parse(result.text), costUsd: roundCost(cost) };
      } catch (error) {
        last = { ok: false, reason: `bad answer: ${error.message}` };
        continue;
      }
    }
    last = { ok: false, reason: result.reason };
    if (!result.retry) break;
  }
  return last;
}

// Run fn on each item, at most `limit` at a time. The results keep the item order.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Take the JSON object out of the model text (it can come in a fenced block).
export function jsonOf(text) {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to < from) throw new Error('not JSON');
  try { return JSON.parse(text.slice(from, to + 1)); } catch { throw new Error('not JSON'); }
}

// ---------- the model input ----------

function cutText(text) {
  if (text.length <= TEXT_HEAD + TEXT_TAIL) return text;
  return `${text.slice(0, TEXT_HEAD)}\n[cut: ${num(text.length - TEXT_HEAD - TEXT_TAIL)} characters]\n${text.slice(-TEXT_TAIL)}`;
}

function modelInput(sessionId, messages) {
  const parts = [`context-health intents ${PROMPT_VERSION} session ${sessionId}`, `Messages: ${messages.length}`];
  for (const message of messages) {
    const lines = [`## Message ${message.n} (${message.kind})`];
    const before = message.agentBefore || { lastText: '', tools: [] };
    if (before.lastText) {
      const text = before.lastText.length > AGENT_TEXT_CUT ? `${before.lastText.slice(0, AGENT_TEXT_CUT)} [cut]` : before.lastText;
      lines.push(`Agent before: ${text.replace(/\s+/g, ' ')}`);
    }
    if (before.tools?.length) lines.push(`Agent tools before: ${before.tools.map(tool => `${tool.name} x${tool.count}`).join(', ')}`);
    lines.push(cutText(message.text));
    parts.push(lines.join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

// ---------- the check of the answer ----------

// Throws on an answer with no usable intent (then the call is tried again).
function checkAnswer(answer, n) {
  if (!answer || !Array.isArray(answer.intents)) throw new Error('no intents list');
  const notes = [];
  const valid = start => Number.isInteger(start) && start >= 1 && start <= n;
  const items = answer.intents.filter(item => item && typeof item === 'object');
  const starts = [];
  for (const item of items) {
    if (!valid(item.start)) { notes.push(`Dropped start ${JSON.stringify(item.start ?? null)}: no such message`); continue; }
    starts.push(item);
  }
  starts.sort((a, b) => a.start - b.start);
  const kept = [];
  for (const item of starts) {
    if (kept.length && kept.at(-1).start === item.start) { notes.push(`Dropped start ${item.start}: a second intent starts there`); continue; }
    kept.push(item);
  }
  if (!kept.length) throw new Error('no intent starts at a message of the session');
  const firstStart = kept[0].start;
  if (firstStart !== 1) notes.push(`Moved start ${firstStart} to 1`);
  const intents = kept.map((item, index) => {
    const goal = typeof item.goal === 'string' ? item.goal.replace(/\s+/g, ' ').trim() : '';
    const from = index === 0 ? 1 : item.start;
    if (!goal) notes.push(`Intent at ${from} has no goal`);
    return { id: `i${index + 1}`, goal, from, to: index + 1 < kept.length ? kept[index + 1].start - 1 : n, corrections: [] };
  });
  const holder = message => intents.find(intent => message >= intent.from && message <= intent.to);
  const corrections = [];
  for (const item of items) {
    for (const raw of Array.isArray(item.corrections) ? item.corrections : []) {
      if (!raw || typeof raw !== 'object') continue;
      const message = raw.message;
      if (!valid(message)) { notes.push(`Dropped correction at message ${JSON.stringify(message ?? null)}: no such message`); continue; }
      let cause = raw.cause;
      if (!CAUSES.has(cause)) { notes.push(`Changed cause ${JSON.stringify(cause ?? null)} to unclear at message ${message}`); cause = 'unclear'; }
      const target = holder(message);
      const from = valid(item.start) ? holder(item.start) : null;
      if (from && from !== target) {
        notes.push(`Moved correction at message ${message} to ${target.id}: the answer had it under the intent that starts at ${item.start}`);
      }
      corrections.push({ target, message, text: typeof raw.text === 'string' ? raw.text.trim() : '',
        quote: typeof raw.quote === 'string' ? raw.quote.trim() : '', cause });
    }
  }
  corrections.sort((a, b) => a.message - b.message);
  corrections.forEach((item, index) => {
    item.target.corrections.push({ id: `c${index + 1}`, message: item.message, text: item.text, quote: item.quote, cause: item.cause });
  });
  return { intents, notes };
}

// ---------- the cache ----------

function readCache(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return typeof data.result === 'string' ? data : null;
  } catch { return null; }
}

// ---------- main ----------

// options: { allowCalls, model, cacheDir, limit }
export async function findIntents({ sessions, memory, options }) {
  const { allowCalls = false, model = 'sonnet', cacheDir, limit = 20 } = options;
  const prompt = readFileSync(PROMPT_FILE, 'utf8');
  const folder = path.join(cacheDir, 'intents');
  let selected = 0;
  const entries = sessions.list.map(session => {
    const messages = memory.get(session.sessionId)?.messages || [];
    const entry = { sessionId: session.sessionId, status: null, reason: null, messages: messages.length, costUsd: null, intents: [], notes: [] };
    if (session.totals.userMessages < 2) return { entry, status: 'single-message', reason: 'fewer than 2 user messages' };
    selected += 1;
    if (selected > limit) return { entry, status: 'not-selected', reason: `not in the newest ${limit} sessions with 2 or more user messages` };
    const input = modelInput(session.sessionId, messages);
    if (input.length > INPUT_LIMIT) {
      return { entry, status: 'too-long', reason: `the model input has ${num(input.length)} characters, the limit is ${num(INPUT_LIMIT)}` };
    }
    const key = sha256(`${prompt}\n${model}\n${input}`);
    return { entry, input, key, file: path.join(folder, `${session.sessionId}.${key}.json`) };
  });

  const parse = n => text => checkAnswer(jsonOf(text), n);
  const pending = [];
  for (const item of entries) {
    if (item.status) continue;
    const cached = readCache(item.file);
    if (cached) {
      try {
        Object.assign(item, { status: 'ok', checked: parse(item.entry.messages)(cached.result), costUsd: cached.costUsd ?? null });
        continue;
      } catch { /* a bad cache file counts as a miss */ }
    }
    if (!allowCalls) { Object.assign(item, { status: 'not-analysed', reason: 'not analysed: run with --intents' }); continue; }
    pending.push(item);
  }

  let calls = 0;
  if (pending.length) {
    mkdirSync(folder, { recursive: true });
    console.log(`intents: ${pending.length} model calls (${model}), up to ${PARALLEL} at a time`);
    await mapLimit(pending, PARALLEL, async item => {
      const result = await runClaude({ model, systemPrompt: prompt, input: item.input, parse: parse(item.entry.messages) });
      calls += 1;
      if (!result.ok) { Object.assign(item, { status: 'failed', reason: result.reason }); return; }
      writeFileSync(item.file, `${JSON.stringify({ promptVersion: PROMPT_VERSION, model, sessionId: item.entry.sessionId,
        key: item.key, costUsd: result.costUsd, result: result.text, checked: result.value }, null, 2)}\n`);
      Object.assign(item, { status: 'ok', checked: result.value, costUsd: result.costUsd });
    });
  }

  const list = entries.map(item => {
    const entry = { ...item.entry, status: item.status, reason: item.status === 'ok' ? null : item.reason };
    if (item.status === 'ok') Object.assign(entry, { costUsd: item.costUsd, intents: item.checked.intents, notes: item.checked.notes });
    return entry;
  });
  const countOf = status => list.filter(entry => entry.status === status).length;
  const totals = { sessions: list.length, ok: countOf('ok'), singleMessage: countOf('single-message'), notSelected: countOf('not-selected'),
    notAnalysed: countOf('not-analysed'), failed: countOf('failed'), tooLong: countOf('too-long') };
  if (totals.notAnalysed) {
    console.log(`intents: ${totals.notAnalysed} sessions are not analysed. Run with --intents to call the model (${model}).`);
  }
  if (calls || totals.failed) console.log(`intents: ${totals.ok} ok, ${totals.failed} failed`);
  return { promptVersion: PROMPT_VERSION, model, limit, totals, sessions: list };
}
