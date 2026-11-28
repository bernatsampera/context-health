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
if (stdin.startsWith('{')) {
  const task = JSON.parse(stdin);
  const controlFile = process.env.CONTEXT_HEALTH_FAKE_CONTROL;
  const control = controlFile && existsSync(controlFile) ? JSON.parse(readFileSync(controlFile, 'utf8')) : {};
  if (task.task === 'context-health-map-questions-v1') {
    if (task.intents.some(intent => intent.id === control.pauseIntent)) await new Promise(resolve => setTimeout(resolve, 15000));
    const intent = task.intents.find(item => item.label === 'Ship a release') ?? task.intents[0];
    const common = { intentId: intent.id, question: 'Which branch do we publish from?', source: 'docs/publishing.md' };
    const questions = [
      { ...common, expected: 'imaginary branch' },
      { ...common, intentId: 'g2', expected: 'stable branch' },
      { ...common, source: 'docs/unknown.md', expected: 'stable branch' },
      { ...common, expected: 'stable branch' },
      { ...common, question: 'What branch do releases use?', expected: 'stable branch' }
    ];
    process.stdout.write(JSON.stringify({ result: JSON.stringify({ questions }) }));
    process.exit(0);
  }
  if (task.task === 'context-health-map-benchmark-v1') {
    if (control.failBenchmark) process.exit(1);
    const file = 'docs/publishing.md';
    const seen = [...task.startFiles, ...task.history.map(step => step.observation)];
    const doc = seen.find(part => part.path === file && part.text);
    let action;
    if (task.question === 'Fixture: cite an unread source') action = { action: 'answer', source: file, answer: 'stable branch' };
    else if (doc) action = { action: 'answer', source: file, answer: doc.text.trim() };
    else if (seen.some(part => part.text?.includes(file) || part.matches?.some(hit => hit.path === file))) {
      action = { action: 'read', path: file };
    } else action = { action: 'search', query: 'publishing' };
    process.stdout.write(JSON.stringify({ result: JSON.stringify(action), modelUsage: { 'fixture-sonnet': {} } }));
    process.exit(0);
  }
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
