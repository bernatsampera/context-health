# Changes

All numbers come from a real run (`npm run ab`) on 2026-11-21. The test `test/e2e-context-ab.test.mjs` checks the main ones.

## Planted faults in bad/

`bad/` is `fixtures/indoeuromap/` with these changes.

| # | Fault | Where | Why it is bad |
|---|---|---|---|
| F1 | No file reaches `second-iteration/direction.md`. The links in `llms.txt`, `README.md` and `second-iteration/plan.md` are removed, and the path in `decisions/method-and-data-rules.md` became "owner". | 4 files | The current profile rule is in this file. The agent cannot find it, so the user must give the path. |
| F1 | `direction.md` has a new section "Profile rule (current, from 2026-11-01)": top 8 groups, groups below 3 people hidden. | `second-iteration/direction.md` | The rule exists, but only in a file with no route. |
| D1 | "Present the exact city batch before `run_batch`. It submits at once." word for word in two files. | `AGENTS.md`, `pipeline/city-factory/README.md` | Two copies. A change to one leaves the other old. |
| D2 | The `status.md` limit: 60 lines in `AGENTS.md`, "Keep it under 80 lines" in `plan.md`. | `AGENTS.md`, `second-iteration/plan.md` | A copy that already drifted. The agent cannot know which number is right. |
| D3 | The profile rule: top 8 and below 3 in `direction.md`, an old top 10 and below 5 in `METHOD.md`. | `second-iteration/direction.md`, `pipeline/METHOD.md` | The old copy is in the file with a route, so the agent reads the wrong rule first (sessions 1 and 2). |

Not planted, from the source fixture: the broken link `compare-demand.md` in `decisions/compare.md`, and 2 broken links in `frontend/llms.txt`.

## The sessions

6 sessions, one intent each, in `sessions.json`. 19 file needs in total.

| Hot spot | Sessions | Files read |
|---|---|---|
| Profile rule | 99000001, 99000002, 99000003 | `AGENTS.md`, `METHOD.md` or the decision files, then `direction.md` (the user gives the path) |
| Compare pages | 99000004, 99000005 | `AGENTS.md`, `decisions/index.md`, `decisions/compare.md` (and `METHOD.md` in 99000005) |
| Method numbers | 99000006 | `AGENTS.md`, `METHOD.md` |

`AGENTS.md` is read in all 6, `METHOD.md` in 4, `decisions/index.md` and `direction.md` in 3, `compare.md` in 2.

## Patches

Each patch applies to `bad/` alone. `better` is C2 + C3 + C4 + C5.

| Patch | Change | Reason |
|---|---|---|
| C1 (counter-example) | `CLAUDE.md` imports `@AGENTS.md` instead of a plain link. | AGENTS.md is read in every session, so load it at start. |
| C2 | `CLAUDE.md` gets a section "Files for the common tasks" with direct links to `direction.md`, `decisions/compare.md` and `METHOD.md`. | These are the hot files of the sessions. A direct link puts each of them 1 step from the start. |
| C3 | Step 4 of `AGENTS.md` says: "For the current profile rule, read `second-iteration/direction.md`". | The missing rule is written down where the agent looks for profiles. |
| C4 | Removes D1, D2 and D3. The copy in `city-factory/README.md` becomes a link to `AGENTS.md`. The 80 lines sentence in `plan.md` is removed. The old rule in `METHOD.md` becomes a link to `direction.md`. | One fact, one place. |
| C5 | `compare.md`: "Notes: [comparison demand](compare-demand.md)." becomes "No notes yet." | The link target does not exist. |

## Measured effect

"Route" is steps / tokens on the way. "none" is no route. "ctx" is in the start load.

| Version | Score | Found | Cheap | Start load tokens | Broken links | No route | At 0 or 1 step | Mean steps | Mean route tokens | `direction.md` | `compare.md` | `METHOD.md` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bad | 95 | 85 | 100 | 698 | 3 | 3 | 6 | 1.81 | 375 | none | 3 / 719 | 2 / 548 |
| C1 | 89 | 85 | 82 | 1,246 | 3 | 3 | 13 | 0.81 | 32 | none | 2 / 171 | 1 / 0 |
| C2 | 100 | 100 | 100 | 772 | 3 | 0 | 15 | 1.26 | 120 | 1 / 0 | 1 / 0 | 1 / 0 |
| C3 | 100 | 100 | 100 | 698 | 3 | 0 | 6 | 1.84 | 417 | 2 / 570 | 3 / 741 | 2 / 570 |
| C4 | 100 | 100 | 100 | 698 | 3 | 0 | 6 | 2.00 | 1,336 | 3 / 6,465 | 3 / 719 | 2 / 548 |
| C5 | 95 | 85 | 100 | 698 | 2 | 3 | 6 | 1.81 | 375 | none | 3 / 719 | 2 / 548 |
| better | 100 | 100 | 100 | 772 | 2 | 0 | 15 | 1.26 | 120 | 1 / 0 | 1 / 0 | 1 / 0 |

What each row shows:

- **C2 is the main win.** The 3 hot files move to 1 step, for 74 more start load tokens. 15 of 19 needs are at 0 or 1 step (6 in bad).
- **C3 gives the missing file a route** (2 steps), so Found goes from 85 to 100. The mean steps go up a little, because a far file now counts in the mean. That is not worse: in bad that file had no route at all.
- **C4 also gives `direction.md` a route, but a bad one:** through the 23 KB `METHOD.md`, 3 steps and 6,465 tokens. A link from a big file is an expensive route. Found goes up the same as C3, so Found alone does not show the difference. The route tokens do.
- **C1 is the counter-example.** Every route is 1 step shorter, but the start load grows by 548 tokens, and Cheap drops from 100 to 82. The sessions read AGENTS.md again, and that read now counts as a re-read of text already in context. In a new session the agent would not read it again, but the recordings cannot show that.
- **C5 only fixes the broken link count** (3 to 2). No session follows that link.
- **The duplicates (D1 to D3) change no number.** The tool does not compare text between files yet. C4 removes them for the day it does.
