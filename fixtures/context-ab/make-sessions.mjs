#!/usr/bin/env node
// Turns fixtures/context-ab/sessions.json into recorded Claude Code sessions and fake model answers.
// Run it again only when you change sessions.json:  node fixtures/context-ab/make-sessions.mjs
// - Session files: fixtures/context-ab/claude-home/projects/-Users-example-projects-indoeuromap/<id>.jsonl
// - Fake answers:  fixtures/fake-claude/<id>.intents.json (one intent per session, no corrections)
// Each Read records the text of the file in bad/ now. After that, the recording does not follow bad/, like a real session.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bad = path.join(here, 'bad');
const OLD = '/Users/example/projects/indoeuromap';
const HOME = '/Users/example';
const sessionDir = path.join(here, 'claude-home', 'projects', '-Users-example-projects-indoeuromap');
const answerDir = path.join(here, '..', 'fake-claude');
const { sessions } = JSON.parse(readFileSync(path.join(here, 'sessions.json'), 'utf8'));
const userClaude = readFileSync(path.join(here, 'claude-home', 'CLAUDE.md'), 'utf8');
const fileText = rel => readFileSync(path.join(bad, rel), 'utf8');

mkdirSync(sessionDir, { recursive: true });
for (const session of sessions) {
  const { id, start, items, goal } = session;
  const base = { isSidechain: false, userType: 'external', cwd: OLD, sessionId: id, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
  const usage = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  let k = 0;
  const rec = extra => {
    k += 1;
    return { ...base, uuid: `${id.slice(0, 8)}-${k}`, timestamp: new Date(Date.parse(start) + k * 1000).toISOString(), ...extra };
  };
  const records = [rec({ type: 'attachment', attachment: { type: 'instructions', files: [
    { path: `${HOME}/.claude/CLAUDE.md`, content: userClaude, type: 'User' },
    { path: `${OLD}/CLAUDE.md`, content: fileText('CLAUDE.md'), type: 'Project' }] } })];
  for (const item of items) {
    if (item.user != null) {
      records.push(rec({ type: 'user', message: { role: 'user', content: item.user }, promptSource: 'typed', origin: { kind: 'human' } }));
    } else if (item.agent != null) {
      records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: item.agent }], usage } }));
    } else if (item.read != null) {
      const abs = `${OLD}/${item.read}`;
      const text = fileText(item.read);
      const lines = text.split('\n').length;
      const toolId = `toolu_${id.slice(0, 8)}_${k}`;
      records.push(rec({ type: 'assistant', message: { id: `msg_${k}`, role: 'assistant', model: 'claude-test',
        content: [{ type: 'tool_use', id: toolId, name: 'Read', input: { file_path: abs } }], usage } }));
      records.push(rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content: text }] },
        toolUseResult: { type: 'text', file: { filePath: abs, content: text, numLines: lines, startLine: 1, totalLines: lines } } }));
    } else {
      throw new Error(`${id}: unknown item ${JSON.stringify(item)}`);
    }
  }
  writeFileSync(path.join(sessionDir, `${id}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
  const answer = { total_cost_usd: 0.01, result: { intents: [{ start: 1, goal, corrections: [] }] } };
  writeFileSync(path.join(answerDir, `${id}.intents.json`), `${JSON.stringify(answer, null, 2)}\n`);
}
console.log(`wrote ${sessions.length} sessions to ${path.relative(process.cwd(), sessionDir)} and their fake answers`);
