# Context A/B demo

This demo shows that a better context gives shorter routes to the files that an intent needs.
A route is the chain of context files from the start load to the file: the steps, and the tokens of the files on the way.

The demo has one bad context and small patches that improve it. The same 6 recorded sessions are scored on each version, so only the context changes.

## Run it

From the repo root:

```
npm run ab
```

A page opens. Tick the fixes you want to try:

- **Bad (no fix)** shows the bad context.
- **Better (all good fixes)** shows bad + C2, C3, C4, C5.
- Tick one fix, or any mix, to see what it changes.

The page shows bad on the left and your choice on the right. Green is better than bad, red is worse.

## Your own fix

To write your own improvement, add a file `patches/C6.json` in the same shape as the others. Each edit has a file, the exact text to find (it must be there 1 time), and the new text. Then run `npm run ab` again. A C6 box appears on the page.

## What is here

| Path | What it is |
|---|---|
| `bad/` | The bad context: a copy of `fixtures/indoeuromap/` with planted faults. The faults are in `CHANGES.md`. |
| `patches/C1.json` to `C5.json` | One improvement each, with its reason. C1 is a counter-example: `better` leaves it out. |
| `CHANGES.md` | Each planted fault and each patch, with the measured effect. |
| `sessions.json` | The 6 recorded sessions, in a form you can read: the user messages, the files read, the hot spot. |
| `make-sessions.mjs` | Turns `sessions.json` into session files in `claude-home/projects/` and fake answers in `../fake-claude/9900000*.intents.json`. Run it again only after you change `sessions.json`. |
| `claude-home/` | The fake `~/.claude`: the global files and the 6 sessions. |
| `ab.mjs` | `npm run ab`. It runs every combination of the patches (about 7 s), writes `out/context-ab/index.html` and opens it. Above 7 patches, it runs only bad, each patch alone, and better. |
| `apply.mjs` | One run. It copies `bad/` to a new temp folder, applies the patches, runs `git init` there and runs the tool with the fake model. No file in the repo changes. |
| `compare.mjs` | The numbers of one report, and the bad against better table that `npm run ab` prints. |

The E2E test is `test/e2e-context-ab.test.mjs`. Its artifact is `out/e2e-context-ab/compare-bad-vs-better.md`.

## How to read the table

- **Needs with no route:** files that an intent read, but that no link or path chain reaches. The agent could only find them because the user named the path.
- **Needs at 0 or 1 step:** files that were in the start load, or one link away from it.
- **Mean steps / mean route tokens of a need with a route:** the average route of the needs that have one. A fix that gives a route to a far file can raise this mean (see C4 in `CHANGES.md`). Read it together with "no route".
- **Score, Found, Cheap, No missing:** the scores of the tool. Only Found and Cheap can move here (see the limits).

## Limits

The sessions are recordings. A better context does not change what the agent did in them. It changes only what the map says about each file the agent read:

- A need moves from "no route" to "path" (Found goes up), and its route gets shorter. The score itself does not count steps, so the compare table shows them.
- A file that the agent found with a search stays "search". So no session here has a search.
- "No missing" checks only the text that the session read. A rule that a patch writes down does not change it. So no session here has a user correction.
- The tool does not compare text between files. The duplicate facts (D1 to D3) change no number yet.
