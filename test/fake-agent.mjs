#!/usr/bin/env node
// A fake interactive `claude` for the E2E test of `context-health fix`. It makes no model call.
// It logs { argv, cwd } to CONTEXT_HEALTH_FAKE_AGENT_LOG, adds one line to CLAUDE.md in its folder (the "fix"),
// and writes a session file for its --session-id in CONTEXT_HEALTH_FAKE_AGENT_PROJECTS/<encoded cwd>/,
// as Claude Code does. The report after the fix must not count that session.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const cwd = process.cwd();
appendFileSync(process.env.CONTEXT_HEALTH_FAKE_AGENT_LOG, `${JSON.stringify({ argv, cwd })}\n`);
appendFileSync(path.join(cwd, 'CLAUDE.md'), '\n- Fake fix: read docs/README.md for the data rules.\n');
const sessionId = argv[argv.indexOf('--session-id') + 1];
const dir = path.join(process.env.CONTEXT_HEALTH_FAKE_AGENT_PROJECTS, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
mkdirSync(dir, { recursive: true });
const base = { isSidechain: false, userType: 'external', cwd, sessionId, version: '2.1.300', gitBranch: 'main', entrypoint: 'cli' };
const records = [
  { ...base, type: 'user', uuid: 'f-1', timestamp: '2026-11-22T10:00:01.000Z', message: { role: 'user', content: argv.at(-1) }, promptSource: 'typed', origin: { kind: 'human' } },
  { ...base, type: 'assistant', uuid: 'f-2', timestamp: '2026-11-22T10:00:02.000Z', message: { id: 'msg_f', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'Done.' }] } },
  { ...base, type: 'user', uuid: 'f-3', timestamp: '2026-11-22T10:00:03.000Z', message: { role: 'user', content: 'Thanks.' }, promptSource: 'typed', origin: { kind: 'human' } }
];
writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
