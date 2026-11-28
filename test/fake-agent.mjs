#!/usr/bin/env node
// A fake interactive `claude` for the E2E test of `context-health fix`. It makes no model call.
// It logs { argv, cwd } to CONTEXT_HEALTH_FAKE_AGENT_LOG, adds one line to CLAUDE.md in its folder (the "fix"),
// and writes a session file for its --session-id in CONTEXT_HEALTH_FAKE_AGENT_PROJECTS/<encoded cwd>/,
// as Claude Code does. The report after the fix must not count that session.
// With -p it is the agent of the dashboard: it reads the prompt from stdin, edits 2 files, makes 1 file, and prints the JSON answer.
// With a non-empty file agent-sleep in TMPDIR, it waits, so that the test can stop it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const cwd = process.cwd();
if (argv.includes('-p')) {
  let stdin = '';
  for await (const chunk of process.stdin) stdin += chunk;
  appendFileSync(process.env.CONTEXT_HEALTH_FAKE_AGENT_LOG, `${JSON.stringify({ argv, cwd, stdin,
    claudeMd: readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8'), untracked: existsSync(path.join(cwd, 'untracked.md')) })}\n`);
  const sleep = path.join(process.env.TMPDIR, 'agent-sleep');
  if (existsSync(sleep) && readFileSync(sleep, 'utf8')) await new Promise(resolve => setTimeout(resolve, 60_000));
  for (const name of ['CLAUDE.md', 'README.md']) appendFileSync(path.join(cwd, name), '\n- Fake fix: read docs/README.md for the data rules.\n');
  appendFileSync(path.join(cwd, 'CLAUDE.md'), '- Read first-iteration/docs/tiktok-first-post-2026-09-27.md for the first post.\n');
  mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  writeFileSync(path.join(cwd, 'docs', 'new note.md'), '# Fake fix\n');
  console.log(JSON.stringify({ type: 'result', is_error: false, result: 'Done.', total_cost_usd: 0.12, permission_denials: [] }));
  process.exit(0);
}
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
