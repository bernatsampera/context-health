#!/usr/bin/env node
// A fake `claude` binary for the E2E tests. It makes no model call.
// It reads stdin, takes the session id and the task from the first line
// (`context-health <task> <promptVersion> session <sessionId>`), and prints the answer in
// fixtures/fake-claude/<sessionId>.<task>.json in the shape of `claude -p --output-format json`.
// Answer file: { "result": <text or object>, "total_cost_usd": <number> } or { "exit": <code>, "stderr": <text> }.
// With CONTEXT_HEALTH_FAKE_LOG set, it appends one JSON line per call: { argv, cwd, stdin }.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const answers = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-claude');
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
if (process.env.CONTEXT_HEALTH_FAKE_LOG) {
  appendFileSync(process.env.CONTEXT_HEALTH_FAKE_LOG, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin })}\n`);
}
const head = stdin.split('\n', 1)[0].match(/^context-health (\S+) \S+ session (\S+)$/);
const file = head && path.join(answers, `${head[2]}.${head[1]}.json`);
if (!file || !existsSync(file)) {
  process.stderr.write(`fake claude: no answer for "${stdin.split('\n', 1)[0]}"\n`);
  process.exit(2);
}
const answer = JSON.parse(readFileSync(file, 'utf8'));
if (answer.exit) {
  process.stderr.write(`${answer.stderr || 'fake claude: error'}\n`);
  process.exit(answer.exit);
}
const result = typeof answer.result === 'string' ? answer.result : JSON.stringify(answer.result);
process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result,
  total_cost_usd: answer.total_cost_usd ?? 0 })}\n`);
