#!/usr/bin/env node
// A fake folder dialog for the E2E test of the dashboard. It prints the text of the file CONTEXT_HEALTH_FAKE_PICKER.
// An empty text is a cancel: exit code 1, as osascript and zenity do.
import { readFileSync } from 'node:fs';

const answer = readFileSync(process.env.CONTEXT_HEALTH_FAKE_PICKER, 'utf8').trim();
if (!answer) process.exit(1);
console.log(answer);
