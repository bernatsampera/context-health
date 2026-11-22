# Fixtures

Test fixtures for context-health. This file is outside both fixtures on purpose. It is not part of their context.

## `indoeuromap/`

A smaller, self-contained copy of the diversity-map project (public name IndoEuroMap), made on 2026-11-21.
All files are real files. There are no symlinks and no references back to the source.
The fixture does not follow the source in the future.

Use it as the project root. It has a mixed code and docs layout: root entry files, `.claude/` and `.agents/` setup, the `second-iteration/` plan and decisions, pipeline and frontend docs with stub code, and the `first-iteration/` archive.

## `claude-settings-home/`

A fake `~/.claude` with fixed content, so tests never read the real one. Pass it with `--claude-settings-home fixtures/claude-settings-home`.

- `claude-settings-home/CLAUDE.md`: generic global instructions (writing style, uv, no deletes, E2E tests only).
- `claude-settings-home/skills/unslop/SKILL.md`: user-level skill with `name` and `description`.
- `claude-settings-home/skills/frontend-design/SKILL.md`: user-level skill with `name` and `description`.
- `claude-settings-home/commands/create-commit.md`: user-level command with a `description` in frontmatter.

## Deliberate cases

| Case | Path | Detail |
|---|---|---|
| Root CLAUDE.md links with a normal Markdown link, not an `@` import | `indoeuromap/CLAUDE.md` | `[AGENTS.md](AGENTS.md)`. Claude Code does not load AGENTS.md at start because of this link. |
| Nested CLAUDE.md | `indoeuromap/frontend/CLAUDE.md` | Frontend rules. Claude Code loads it only when it works in `frontend/`. |
| One `@` import | `indoeuromap/frontend/CLAUDE.md` | Line `@./DESIGN.md`. The path is relative to the importing file, so the target is `indoeuromap/frontend/DESIGN.md`. |
| Skill with no `description` | `indoeuromap/.claude/skills/city-batch/SKILL.md` | Frontmatter has `name` only. |
| Broken link | `indoeuromap/second-iteration/decisions/compare.md` | `[comparison demand](compare-demand.md)` in the Open section. The target does not exist. |
| Circular link pair | `indoeuromap/second-iteration/decisions/city.md` and `indoeuromap/second-iteration/decisions/area.md` | Each has a "See also" section that links to the other. |
| Orphan Markdown file | `indoeuromap/first-iteration/docs/tiktok-first-post-2026-09-27.md` | No file links to it or names its path. |
| Link to a folder | `indoeuromap/second-iteration/plan.md` | `[decisions/](decisions/)` with a trailing slash. `indoeuromap/frontend/llms.txt` also links `src/pages/` and `src/components/`. |
| Ignored search noise under `data/` | `indoeuromap/data/` | 5 files. See the note below. |

### Note on `data/`

The real `.gitignore` is kept as is. It ignores `data/**` but re-includes `!data/**/_index.*.md`. So:

- Ignored: `data/research/wave-1-finish-2026-10-20/README.md`, `data/research/europe-expansion-2026-10-20/README.md`, `data/research/growth-metrics-2026-10-21/README.md`.
- Not ignored (re-included index files): `data/_index.data.md`, `data/spain/madrid/_index.madrid.md`.

`llms.txt` links the three ignored README files, and `second-iteration/metrics.md` links the growth-metrics README. These are links into ignored files.

### Other cases that come from the real project

- `AGENTS.md`, `README.md`, and `llms.txt` are three entry files with overlapping links.
- `pipeline/METHOD.md` (about 23 KB) is the big file one hop away from `AGENTS.md` and `llms.txt`.
- `.claude/commands/` and `.agents/skills/source-command-*` hold the same two commands in two formats.
- Decision files name archive files as plain path text in their tables (for example `first-iteration/docs/NOW.md`), not as Markdown links. The archive is reachable by path mention only.
- `.mcp.json` declares two MCP servers.
- `.claude/skills/geo-audit/SKILL.md` has an em dash in its description. It is copied from the real skill.

## Where the fixture differs from the real project

- Size: about 73 files instead of about 9,750 tracked files. Most of `frontend/src/`, `pipeline/methods/`, the factory source, `social/`, and nearly all of `first-iteration/` are left out.
- Links to files that are not in the fixture were removed. In `llms.txt` and `index.md` files the whole bullet was removed. In other files the link became its plain text. So `second-iteration/decisions/index.md` lists 6 decision files, and `second-iteration/outreach/index.md` lists 2.
- Decision files kept: `home.md`, `city.md`, `area.md`, `compare.md`, `pipeline-and-coverage.md`, `method-and-data-rules.md`. Outreach files kept: `findings.md`, `show-hn.md`.
- Shortened (headings kept, first lines of each section kept, lines with links kept): `second-iteration/outreach/findings.md`, `social/tiktok/README.md`, `first-iteration/docs/business/public-wording-plan-2026-10-11.md`. `first-iteration/docs/NOW.md` keeps 4 of its journal entries.
- `pipeline/METHOD.md` links `../revision/local-group-update.md` in the source, which is broken there. The fixture points it to `../first-iteration/revision/local-group-update.md`.
- `.claude/skills/*` are real folders, not symlinks to a user folder. Only `geo-audit`, `programmatic-seo`, and `website-structure` are kept, with their real descriptions and a short new body. `city-batch` is new.
- New files that the real project does not have: `frontend/CLAUDE.md`, `frontend/DESIGN.md`, `.claude/skills/city-batch/SKILL.md`, the "See also" sections in `city.md` and `area.md`, and the broken link in `compare.md`. `plan.md` links `decisions/` instead of `decisions/index.md`.
- Code files are short stubs: `pyproject.toml`, `Makefile`, `pipeline/cli.py`, `pipeline/artifacts.py`, `pipeline/steps/run_city.py`, `pipeline/city-factory/pyproject.toml`, `pipeline/city-factory/src/city_factory/mcp_server.py`, `frontend/package.json`, `frontend/astro.config.mjs`, `frontend/src/layouts/LayoutV2.astro`, `frontend/src/pages/index.astro`, `frontend/src/components/pages/HomePage.tsx`, `frontend/src/lib/aggregates.ts`, `frontend/src/styles/global.css`, `frontend/src/data/profile-manifest.json`. The two `pyproject.toml` files and `frontend/package.json` are real copies. The other code files are new stubs.
- The `data/` files are written for the fixture. The real `data/` is not on disk.
- Personal data was replaced: server home paths and user names became `owner`, the analytics host became `umami.example.com`, and the analytics site ID became `00000000`.
- Not copied: `.claude/settings.local.json`, `.codex/`, `.github/`, `uv.lock`, `.venv/`, and all real data.

## Cases added after the first build

- **`@` in a code span:** `claude-settings-home/CLAUDE.md`, section "Skills". The path exists, but it is inside backticks, so it is not an import.
- **Import cycle:** `indoeuromap/frontend/DESIGN.md` imports `@./CLAUDE.md`, and `frontend/CLAUDE.md` imports `@./DESIGN.md`. The tool must load each file once and stop.

## Map cases

Added for step 2 (the map). The checks are in `test/e2e-map.test.mjs`. The full list is in the step 2 failure list.

| Case | Path | Detail |
|---|---|---|
| Link targets with square brackets | `indoeuromap/frontend/llms.txt` | `src/pages/[country]/index.astro` and `src/pages/methodology/[country].astro`. Both targets are missing, so they are 2 of the 3 broken links. |
| Link in a code block, anchor link | `indoeuromap/second-iteration/decisions/home.md`, end of the Open section | A fenced block holds a link to the missing `old-hero-copy.md` and the path `second-iteration/direction.md`. Neither is an edge. `[section list](#decisions)` is an anchor, not an edge. |
| File one subfolder below a linked folder | `indoeuromap/frontend/src/components/map/CityMap.tsx` | New code stub. Only the folder link `src/components/` in `frontend/llms.txt` reaches it, so it costs 1 step more than a direct file of the folder. |
| Linked git-ignored files | `indoeuromap/data/research/*/README.md` | The 3 files that `llms.txt` and `metrics.md` link. They are git-ignored, also in this repo, so git does not keep them. `test/e2e-map.test.mjs` writes them into its copy when they are missing. |
| Command body that names a path | `indoeuromap/.claude/commands/frontend-design-system.md` | Names `frontend/llms.txt` as plain path text. This gives `frontend/` a route of 2 steps through the trigger. This case was already there. |

## Session cases

Fake Claude Code sessions for step 3, in `claude-settings-home/projects/`. All records use the fake root `/Users/example/projects/indoeuromap` and the fake home `/Users/example`. The demo and `test/e2e-sessions.test.mjs` pass `--old-path /Users/example/projects/indoeuromap`. The step 1 test passes no `--old-path`, so it finds no session.
The texts are invented. Tool results hold the real text of the fixture files at the time of writing (2026-11-21). They do not follow later changes of the fixture files, like a real session. No tool result holds `decisions/home.md` or `frontend/llms.txt` (step 2 changes them).
The checks are listed in the step 3 failure list.

| Session | Folder | Case |
|---|---|---|
| A `11111111-...` | `-Users-example-projects-indoeuromap/` | Good path: reads `AGENTS.md`, `llms.txt`, `decisions/index.md`, `decisions/city.md` (each named by the one before), then an Edit. The last record has `entrypoint: "sdk-cli"`: the session went on through the SDK, but it is interactive. |
| B `22222222-...` | same | Grep, Glob, Bash `ls`, Bash `git status`, partial Read of `pipeline/METHOD.md` (40 lines), Bash `cat` of `compare.md`, failed Read of `compare-demand.md`, partial Read of the orphan, a correction that names `second-iteration/direction.md`, then its Read. Prompt 1 is longer than 300 characters. One damaged JSON line. The `git status` output holds the marker `private-marker-x9q4`. |
| C `33333333-...` | same | @-mention (`file` attachment), `nested_memory` for `frontend/CLAUDE.md`, Skill call and body, slash command `/brief` with its body, AskUserQuestion answer, rejected Bash call, Agent call, task notification, interruption, compaction with a compact summary and a restore, prompt 2, a repeat Read, a Read in `~/.claude/`. |
| C subagent | `.../33333333-.../subagents/agent-a1.jsonl` and `agent-a1.meta.json` | One Grep and one Read of `pipeline/cli.py`. The results have no `toolUseResult`, as on the real server. |
| D `44444444-...` | `-Users-example-projects-indoeuromap--worktrees-fix-city/` | Worktree session. `cwd` and paths are under `.worktrees/fix-city/`. |
| E `55555555-...` | `-Users-example-projects-indoeuromap/` | Headless: all records have `entrypoint: "sdk-cli"`. Skipped. |
| F `66666666-...` | same | No user message. Skipped. |
| G `77777777-...` | `-Users-example-projects-indoeuromap-old/` | Sibling folder with the same name prefix. Its `cwd` is not under the root. Not read. |

## Score cases

Step 6 adds no session file here. `test/e2e-score.test.mjs` copies `claude-settings-home/` into its temp folder and writes 5 sessions there (S1 to S5, ids `96000001-...` to `96000005-...`). Their read texts are filler of an exact length, so the tokens are known (4 x k characters is k tokens). The fake answers are in `fake-claude/9600000*.json`: intents for S1, S2, S3 (exit code 1) and S5, and the had check for S1 and S5. S4 is too long, so it has no answer. The cases and the hand-worked numbers are in the step 6 failure list and in the comments of the test. The test also scores the fixture sessions B and C.

## Page cases

Step 7 adds no session file here. `test/e2e-page.test.mjs` copies `claude-settings-home/` into its temp folder and writes 2 sessions there. The cases are in the step 7 failure list.

| Session | Case |
|---|---|
| P1 `97000001-...` | 3 user messages with HTML in them (a script tag, a closing details tag, quotes). The fake answers in `fake-claude/97000001-...` have HTML in the goal and in the quote of a `missing-context` correction, and a check that does not find it. Intent i1 has only a missing need, intent i2 needs no context. |
| P2 `97000002-...` | A first message of 5,000 characters with a marker after character 300. It has no fake answer, so its status is `failed`. |

## Review fix cases

Added for the review fixes (the review notes). No session file is added here. Each test writes its sessions into its own copy of `claude-settings-home/`, so the session lists of the other tests do not change.

| Session | Test | Case |
|---|---|---|
| H `98000001-...` | `test/e2e-sessions.test.mjs` | A moved session (finding 7). The first records have `cwd` `/Users/other/work/indoeuromap` and a start load from `/Users/other/.claude/CLAUDE.md` (another machine). Later records use the fixture root. A second `instructions` attachment comes later and is not the start load. |
| I `98000002-...` | `test/e2e-sessions.test.mjs` | Bash reads (findings 4 and 5). `cat city.md area.md` in one command, then a Read of `first-iteration/docs/NOW.md`, which only `area.md` names. Then `cat .gitignore && find second-iteration/outreach -name '*.md'`, then a Read of `show-hn.md`, which only the find output names. |
| S6 `96000006-...` | `test/e2e-score.test.mjs` | Two subagents (findings 2 and 3). The main thread reads `city.md` in i1. In i2, subagent h1 reads `city.md` and `METHOD.md`, and subagent h2 searches (200 tokens) and reads `METHOD.md`. The test writes the subagent files and their meta files. Fake answer: `fake-claude/96000006-...intents.json`. |
| S7 `96000007-...` | `test/e2e-score.test.mjs` | An intent whose only need is a file that is not on disk and not on the map (finding 1, state `gone`). Fake answer: `fake-claude/96000007-...intents.json`. |

Fixture session C now also gives 2 needs from loads (decision D2): the nested `frontend/CLAUDE.md` and the skill body `.claude/skills/city-batch/SKILL.md`. The score test S1 file `second-iteration/old-gone.md` and the needs test N1 file `second-iteration/old-plan.md` are now `gone`, not `no_path`.

## Routes cases

Added for step 8 (routes and the new page). No session file is added here. `test/e2e-routes.test.mjs` copies `claude-settings-home/` into its temp folder and writes 4 sessions there. Their read texts are the real fixture files, so `knownFrom` names the file before. The cases are in the step 8 failure list.

| Session | Case |
|---|---|
| R1 `91000001-...` | Links all the way: `AGENTS.md` (named by `CLAUDE.md` in the start load), `decisions/index.md` (named by `AGENTS.md`), `decisions/city.md` (named by `index.md`). |
| R2 `91000002-...` | `decisions/city.md` found by a Grep. |
| R3 `91000003-...` | `decisions/city.md` found by a Grep, the orphan tiktok file with nothing that names it, and a missing-context correction. The fake goal and the correction text have an em dash and an en dash (as `\u2014` and `\u2013` in the JSON), so the test checks that the page and the prompt show a plain hyphen. |
| R4 `91000004-...` | `llms.txt` found by a Grep, `direction.md` named by `llms.txt` (a weak route), `metrics.md` named by the user message. |

The groups answers are named by the run id of the call (`run-<12 hex>`, a hash of the intent lines):

| File | Used by | Case |
|---|---|---|
| `run-2903081c0fc8.intent-groups.json` | the demo with the fake binary | B, C i1, C i2: 2 groups. |
| `run-46cb097e6704.intent-groups.json` | `test/e2e-routes.test.mjs` | The 7 intents of the fixture and R1 to R4: 4 groups, one with 3 members. |
| `run-3bd4ed4c6696.intent-groups.json` | `test/e2e-routes.test.mjs` (`--sessions 2`) | A bad answer: an unknown intent number. |
| `run-c5cbce4a57d9.intent-groups.json` | `test/e2e-routes.test.mjs` (`--sessions 3`) | A label of 12 words, with spaces at the ends. |
| `run-56b824cb7ff4.intent-groups.json` | `test/e2e-page.test.mjs` | HTML in a label and an em dash in a label. |

A change of a goal in the fake intents answers of B, C, P1 or R1 to R4 changes the run id, so these files must get the new name. The other tests have no groups answer: their groups call fails, and each intent is its own group.

## `context-ab/`

The A/B demo: a bad context (`context-ab/bad/`, a copy of `indoeuromap/` with planted faults), patches that improve it, and 6 recorded sessions in `context-ab/claude-home/`. Run `npm run ab`. The fake answers are `fake-claude/9900000*.intents.json`. Details: `context-ab/README.md` and `context-ab/CHANGES.md`. A snapshot of the same folder in main, copied for step 9.

## Duplicate cases (step 9)

The run id of a duplicates call is a hash of the sorted file paths, not of their text. So one fake answer serves every text version of the same files, and the code drops each quote that a version does not have.

| Answer file | Used by | Case |
|---|---|---|
| `run-23cc20f73920.duplicates.json` | `test/e2e-context-ab.test.mjs`, `npm run ab` | The A/B files: 8 facts, with the planted D1 to D3 and the copies that were already in the source fixture. C4 removes 3 of the quotes. |
| `run-1152cd2eb881.duplicates.json` | the tests that copy `indoeuromap/` and add one ignored research file | 5 facts that are in `indoeuromap/`. |
| `run-eaca45df67b2.duplicates.json` | `npm run demo` in a git copy with no ignored research files | The same 5 facts. |
| `run-2537a5b1f3f3.duplicates.json` | `test/e2e-context-ab.test.mjs` (D6) | The A/B files plus `notes/extra.md`. A place with a path that is not in the input: a bad answer. |

In a checkout that has the 3 ignored research files, the demo has the same file paths as the A/B fixture, so it uses `run-23cc20f73920`. The quotes that are only in `bad/` are dropped, with notes.

## Step 10 cases

Added for step 10 (the 9 faults of the real trial, the step 10 failure list). No file is added to `indoeuromap/`, `claude-settings-home/` or `context-ab/`: each test makes its projects, settings homes, memory folders and sessions in its temporary folder. New files are only fake answers in `fake-claude/`. Session ids: `92000001-...` (paths, start load, map), `94000001-...` (duplicates), `93000001-...` (told facts), `89000001-...` (health, prompt, page).

### Worktree paths, start load and map (`test/e2e-step-10-a.test.mjs`)

Added for step 10. No file is added to `indoeuromap/` or to `claude-settings-home/`. `test/e2e-step-10-a.test.mjs` makes each project, each settings home, each memory folder and each session in its temp folder. The checks are listed in the step 10 failure list (W, M, A, the map data of R and F, G) and in the list of worker A (W14 to W19, M15 to M19, A8 to A16, E1 to E3, N1 to N3, V1, V2).
Two fake answers are new: `fake-claude/92000001-...intents.json` and `fake-claude/92000004-...intents.json` (one intent each, no correction, so no needs check call). The test has no groups answer and no duplicates answer: both calls fail, each intent is its own group, and only the exact copies are checked.
Each project copy gets the 3 `data/research/*/README.md` files when the repo copy does not have them (git ignores them).

#### Projects (copies of `indoeuromap/` in the temp folder)

| Project | Path in the temp folder | Case |
|---|---|---|
| P | `my proj_1.x/indoeuromap` | The main project. Its path has a space, `_` and `.` (the memory folder name). One commit, then a real git worktree made by `git worktree add .claude/worktrees/w1`. A file `second-iteration/only-in-worktree.md` is only in the worktree. `.gitignore` gets the line `work/`. The git-ignored folder `work/model-calls/` has `index.md` (links `changes.md`, `bench.md`, `measures.md` and the folder `runs/`), the 3 linked files, `runs/r1.md` and the code file `run.py`. One new line at the end of `second-iteration/plan.md` names `work/model-calls` as plain text. One new line at the end of `second-iteration/status.md` names `work/model-calls/` and `work/model-calls` (2 times on one line), `second-iteration/decisions` (each file there has a route) and the bare word `work`. |
| N | `noclaude/above/indoeuromap` | No `CLAUDE.md` and no project commands (the command bodies name so many files that almost each file has a route with no start file). `AGENTS.md` gets the line `@README.md`. New: `.claude/AGENTS.md`, `pipeline/AGENTS.md` (links `METHOD.md` and the missing `../CLAUDE.md`), `frontend/AGENTS.md` (its folder has a CLAUDE.md). The folder above has `AGENTS.md` and `.claude/AGENTS.md`. |
| PLAIN | `plain/indoeuromap` | The fixture as it is. |
| A3A, A3B | `a3a/indoeuromap`, `a3b/indoeuromap` | No `CLAUDE.md`. A `.claude/CLAUDE.md` (A3A) or a `CLAUDE.local.md` (A3B). |
| A3C, A3D | `a3c/above/indoeuromap`, `a3d/above/indoeuromap` | No `CLAUDE.md`. The folder above has `CLAUDE.md` (A3C) or `.claude/CLAUDE.md` (A3D). |
| A8 | `a8/indoeuromap` | `CLAUDE.md` gets the line `@AGENTS.md`. New: `frontend/AGENTS.md`. |
| BARE | `bare/indoeuromap` | No `CLAUDE.md` and no `AGENTS.md`. |
| NOGIT | `nogit/indoeuromap` | No git. Worktree copies in `.claude/worktrees/w1/copy.md` and `.worktrees/w0/copy.md`. Two paths that only look like a worktree: `docs/worktrees/x/a.md` and `.claude/worktrees.md`. |

#### Settings homes

| Home | Content |
|---|---|
| `settings` | A copy of `claude-settings-home/`, plus the 4 sessions and the memory folders below. Used for P, for N (default mode) and for PLAIN (the 25 KB index). |
| `settings-off` | A copy of `settings`, plus `settings.json` with `"autoMemoryEnabled": false`. |
| `settings-claude-md` | A copy of `claude-settings-home/`, plus `settings.json` with `pluginConfigs["cc-plugin-agents-md@builtin"].options.instructionFiles` = `claude-md`. |
| `settings-managed` | The same with the old plugin id `agents-md@builtin` and the value `managed-only`. |
| `settings-both` | The same with the value `claude-md-and-agents-md`. |
| `settings-bad`, `settings-unknown` | A `settings.json` that is not JSON, and one with the value `something-new`. |

The other runs use `claude-settings-home/` of the repo. It has no memory folder for a temp project.

#### Memory folders (in `settings/projects/`)

| Folder | Files | Case |
|---|---|---|
| The folder of P (the path of P with `-` for each other character) | `MEMORY.md` of 260 lines. Line 3 `[Alpha](a.md)`, line 4 `[Beta](./b.md)`, line 5 `[Gamma](sub/c.md)`, line 6 `[[d]]`, line 7 a link to the missing `missing.md`, line 8 `[[nope]]`, line 9 links to `../other/x.md` and to `notes.txt`, line 10 a link in a code span, line 11 `[[decide-first]]`, line 12 `[[feedback-keep-short]]`, line 13 `[[short-rows]]`, line 14 `[[twin]]`, line 250 `[Late](late.md)`. | Lines 1 to 200 load. `a.md` links `second-iteration/plan.md` and names `first-iteration/docs/NOW.md` as plain text (paths from the project root). `sub/c.md` has `[[d]]` and `[beta](../b.md)`. `orphan.md` has no link to it. `feedback_decide_first.md` has `name: decide-first` in its front matter. `feedback_keep_short.md` matches by its file name. `feedback_short_rows.md` has `name: feedback-short-rows` (the link gives only the end). `feedback_twin.md` and `project_twin.md` both end with `twin`, so `[[twin]]` is broken. `notes.txt` is not Markdown. |
| `-Users-example-projects-indoeuromap/memory/` | `MEMORY.md`, `old.md` | The memory of the `--old-path` folder. Not read. |
| `-Users-example-projects-other/memory/` | `MEMORY.md` | The memory of another project. Not read. |
| The folder of the real path of P | `MEMORY.md`, `root-note.md` | Only when the real path is not the given path (macOS: `/private/var` and `/var`). A root that is a subfolder (`P/frontend`) or the git worktree (`P/.claude/worktrees/w1`) uses this folder: git gives the real path of the repository root. |
| The folder of N | `x.md` | Memory files and no index. |
| The folder of PLAIN | `MEMORY.md` (line 2 `[Early](early.md)`, then 6 lines of 5,000 characters, then `[Deep](deep.md)`), `early.md`, `deep.md` | An index above 25 KB: 25,000 bytes load (6,250 tokens). |

#### Sessions (in `settings/projects/`, all with the fake root `/Users/example/projects/indoeuromap`)

| Session | Folder | Case |
|---|---|---|
| S1 `92000001-...` | `-Users-example-projects-indoeuromap--claude-worktrees-w1/` | Each path is in `.claude/worktrees/w1`. The start load names the worktree copy of `CLAUDE.md`. Message 1 names `.claude/worktrees/w1/second-iteration/metrics.md` (a relative path with the worktree part). Events: 5 Reads along the link chain (`CLAUDE.md`, `AGENTS.md`, `plan.md`, `direction.md`, `metrics.md`), a Grep in `second-iteration`, `ls` of `decisions`, `ls` of the worktree folder (the target is `.`), `ls` of 2 full paths with an error line in the output, a Read of `notes.md` with the `cwd` `.../w1/docs`, Reads of `docs/worktrees/x/a.md` and `.claude/worktrees.md` in the main folder, a Read of `only-in-worktree.md`, a Read of `decisions/index.md` in the main folder and then of its worktree copy, an Edit, a failed Read, a `nested_memory` load of `frontend/CLAUDE.md`, and `cd .claude/worktrees/w1 && cat second-iteration/outreach/index.md` with a `cwd` that is already in the worktree. Message 2 has a file @-mention and a folder @-mention in the worktree. 2 user messages, so it has needs. |
| S2 `92000002-...` | `-Users-example-projects-indoeuromap/` | One user message. An Agent call. The subagent `a1` works in `.claude/worktrees/agent-a1`: a Grep, a Read of `pipeline/README.md`, and a Read of `llms.txt` with the `cwd` `.../agent-a1/pipeline`. The test writes the subagent file and its meta file. |
| S3 `92000003-...` | `-Users-example-projects-indoeuromap--claude-worktrees-w2/` | The first `cwd` is the main folder (as in the real folder `...--claude-worktrees-simpler-addition`). A later Read has a `cwd` in `.claude/worktrees/w2`. |
| S4 `92000004-...` | `-Users-example-projects-indoeuromap/` | Reads of `MEMORY.md`, `a.md` and `orphan.md` with their paths in the settings home of the run, of `work/model-calls/index.md`, `changes.md` and `runs/r1.md` (git-ignored context files), of `work/model-calls/run.py` (code), of `work/model-calls/not-on-disk.md`, of `/Users/example/notes/outside.md`, and of the git-ignored research README that `llms.txt` links. 2 user messages, so it has needs. |

Fixture session D (`44444444-...`, `.worktrees/fix-city`) is in the copy too. Its paths must stay as before (W2).

The main run (P, `settings`, `--old-path`, `--intents` with the fake binary) is the artifact `out/e2e-step-10-a/`. Its `report.json` holds temp folder names (the project root and the memory folder name), so it is the same on 2 runs of one test process, not between 2 test processes. This is the same as for `project.root` in the other artifacts.

### Duplicates (`test/e2e-step-10-b.test.mjs`)

#### The answers of "Duplicate cases (step 9)" in the shape of `duplicates-v2`

The 4 answer files keep their names (the run id does not hold the prompt version). Each fact now has the verdict `same` of `duplicates-v2`:

| Answer file | Change |
|---|---|
| `run-23cc20f73920.duplicates.json` | `same: false` for the 3 planted disagreements (the line limit of status.md, the origin groups of a profile, the smallest group). `same: true` for the 5 copies. |
| `run-1152cd2eb881.duplicates.json` | `same: true` for the 5 facts. |
| `run-eaca45df67b2.duplicates.json` | `same: true` for the 5 facts. |
| `run-2537a5b1f3f3.duplicates.json` | `same: true`, so the answer is still bad only for its unknown path. |

One more line for the text under the table: after C4, the fact "The line limit of status.md" keeps `same: false` in the answer, but its 3 places left all say 60 lines. The code finds no different number, so the fact is a copy, with a note.

Added for step 10, faults 2 and 9. The checks are in `test/e2e-step-10-b.test.mjs`. No file is added to `indoeuromap/`, `context-ab/` or the settings homes: the test writes its files into its own temporary copies.

#### Part X: the code guard

The test makes a git copy of `indoeuromap/`, writes the 3 research files when they are missing, and adds 3 files: `step10/guard-a.md`, `step10/guard-b.md` and `step10/guard-c.md`. Each quote of the fake answer is one list item of its file, so the answer file is the only place that holds the sentences. The sentences are invented. Their values follow the pairs of the real trial, with other names. The project has no session.

| Answer file | Used by | Case |
|---|---|---|
| `run-e242eab1c417.duplicates.json` | part X | 31 facts in the 3 guard files. The table `X_CASES` of the test gives, for each fact, the values, the verdict `same` of the fake model, and the `differ` that the code must give. |
| `run-34f0d3c17d44.duplicates.json` | X5 | The guard files plus `step10/extra-1.md`. One fact with no `same`: a bad answer. |
| `run-52750cae75ed.duplicates.json` | X17 | The guard files plus `step10/extra-1.md` and `step10/extra-2.md`. One fact with `"same": "false"` (a text, not a boolean): a bad answer. |

The 31 facts of `run-e242eab1c417`:

| Facts | `same` in the answer | Result | Case |
|---|---|---|---|
| 13 facts: "100 messages" and "100 new messages", "1 to 3" and "3 or less", "one recovery" and "at most one", "before 2090" and "before 2090-01-01", "only when asked" and "only when told", "no dependencies" and "no npm dependencies", "no em dashes" and "no long dashes", the index mode ("code default, claude off switch" and "code default, claude switches back"), "casa.example.org" and "casa.example.org to 4321", the plugin scope (3 places), "only under books dir" and "only under ~/example-books", "replaces the first run" and "replaces the earlier run", "off by default" and "off is the default" | `false` | copy, with a note | X1, X3: the same value in other words, or with more detail. |
| "60 lines" and "80 lines", "Node 24.22.1" and "Node 24.21.0", "default steps" and "default two-calls", "five variables" and "six variables" | `false` | disagree | X2, X6. In the capture mode case, each quote also names the literal of the other place (X15), and "two-calls" starts with a number word (X11). In the variables case, the quotes hold no number: the model counted the names. |
| "30 days" and "4 weeks" | `true` | copy, no note | X4: the numbers differ, but the model says that the values are the same. |
| "five settings" and "5 settings" | `false` | copy, with a note | X6: a number word. |
| "top 8", "top 8" and "top 10" | `false` | disagree | X7: 3 places, one with another number. |
| "1 to 3 tries" and "1-3 tries" | `false` | copy, with a note | X12: a range with a hyphen gives its number parts. The date "2090-01-01" of the first row is the other X12 case. |
| "Node 24" and "Node 24.22.1". "1 second" and "1.5 seconds" | `false` | copy. disagree | X13: a number that is the start of a version with 3 parts. A decimal is not such a version. |
| "the 1st run" and "the 2nd run" | `false` | copy, with a note | X14: an ordinal is not a number. |
| "ask the owner first" and "tell the owner first" | `false` | copy, with a note | X16: each quote has a sentence of 9 words in double quotes. It gives no literal. |
| "60s" and "60 seconds". "10,000 rows" and "10000 rows". "status.example.org" and "https://status.example.org:8443". "notes.md" and "docs/notes.md". "top-8 groups" and "top 8 groups" | `false` | copy, with a note | X19 to X22, X24: a joined unit, a separator in a number, a link scheme and a port, a longer path, a number joined to a word. |
| "fast" and "full" | `false` | disagree | X23: the quotes have the literals `mode=fast` and `mode=full`. |

#### Part L: the input limit

The test makes a copy of `context-ab/bad/` and a copy of `context-ab/claude-home/` (the 6 recorded sessions). It changes the project copy so that the context text is above the limit of 240,000 characters:

| Change in the copy | Case |
|---|---|
| `pipeline/METHOD.md` (4 uses) grows to a little under the limit (237,461 characters), with filler lines of 3 words. It fits after `AGENTS.md`, and then no other needed file fits | L13: a large file with many uses. With "more uses first", `AGENTS.md` and `METHOD.md` went in: 2 needed files, 10 of the 20 needs. With uses for each character, the 5 small needed files go in first and `METHOD.md` is left out: 5 needed files, 15 of the 20 needs. |
| `second-iteration/decisions/method-and-data-rules.md` (1 use) grows to 245,000 characters | L2: a needed file that is larger than the limit by itself. It is the last needed file. It is left out, and the files after it go in. |
| `second-iteration/direction.md` (3 uses) grows to 3k characters and `second-iteration/decisions/compare.md` (2 uses) to 2k characters, with the same k (now 2,115 and 1,410) | L14: the same uses for each character. `direction.md` goes first because it has more uses, though `compare.md` comes first in path order. |
| New file `aaa-filler/big.md` (120,000 characters, no link to it, no use) | L1: a file with no route goes last, also when its path comes early. It is left out, and the 3 small files with no route after it go in. The 3 user files that no intent read (`~/.claude/` command and skills) come last: the files of the project go before the files outside it. |
| New session `94000001-...` in the copy of the settings home. It reads `second-iteration/plan.md` through the worktree path `.claude/worktrees/w1/` | L6: the read counts for the main file, so `plan.md` is a needed file with 1 use. No worktree path is in the input. |

So the list has 59 files and 7 needed files. The input has 56 files and 5 needed files. The needed files of the input, in their order: `index.md` (3 uses, 680 characters), `AGENTS.md` (6 uses), `direction.md`, `compare.md`, `plan.md` (1 use). The file sizes come from the fixture files at the time of the run: the test works out the filler sizes from them.

| Answer file | Used by | Case |
|---|---|---|
| `run-49c1c35d7a09.duplicates.json` | part L | The A/B files plus `aaa-filler/big.md`. 2 facts whose places are all in the input: the line limit of status.md (`same: false`, 60 and 80 lines) and the batch rule (`same: true`). |
| `94000001-0000-0000-0000-000000000000.intents.json` | part L | One intent, no correction, for the new session. |

A run of part L with no `--old-path` has no session. It gives the same run id (`run-49c1c35d7a09`) with another order of the files (L4).

The run ids come from the file paths. When the file list of `indoeuromap/` or of `context-ab/bad/` changes (a new file, or a new rule for the map files), these 4 answer files and the 4 old ones need new names. The test names the id that it expects in its first lines (`X_RUN`, `L_RUN`) and in the X5 test.

### Told facts (`test/e2e-step-10-c.test.mjs`)

Added for fault 8 (a told fact is checked against the context files of today). No file is added to `claude-settings-home/` or to `indoeuromap/`. `test/e2e-step-10-c.test.mjs` copies both into its temp folder and writes there: a memory folder for the project, and 6 sessions (T1 to T6, ids `93000001-...` to `93000006-...`). All texts are invented. The cases are in the step 10 failure list (S1 to S26).

The memory folder of a project has the project root in its name (`projects/<root with each character that is not a letter or a digit as ->/memory/`), and the root of the test is a new temp folder on each run. So the fake answers `fake-claude/9300000*.needs-check.json` hold the word `MEMORY_DIR` in the place of the memory folder (`~/.claude/projects/<folder>/memory`). The test copies `test/fake-claude.mjs` and `fake-claude/` into its temp folder and puts the real folder in. These 6 answers work only in that test. The demo does not use them.

A Write to a memory file in a fake session uses the path `/Users/example/.claude/projects/<folder>/memory/<name>.md`. The fake home is the home of another machine, so the tool maps it to `~/.claude/projects/<folder>/memory/<name>.md`, the memory folder of the test project.

The memory folder of the test:

| File | Case |
|---|---|
| `MEMORY.md` | The index. It links `decision-edits-ask-first.md` and `legend-colours.md` only. |
| `decision-edits-ask-first.md` | T1 writes it after its correction. The text on disk is not the text of the Write call. |
| `legend-colours.md` | A fact of T2. The index links it. T2 did not write it: the word match finds it. |
| `export-folder-note.md` | A fact of T2 in a memory file that the index does not link (S6). |
| `wm-quorblix-1.md` to `-6.md`, `wm-quorblix-one-word.md` | The word match of T4 c1: 5, 4, 3, 2, 2 and 2 shared words (invented words), and a file with 1 shared word. |
| `wm-glimfar-short.md`, `wm-glimfar-long.md` | T4 c2: the long file (1,000 more words) shares 3 words, the short file 2 of them. The short file comes first (S25). |
| `wm-brimwok-stub.md`, `wm-brimwok-full.md` | T4 c3: the stub (2 words) shares 2 words, the full file 3. The full file comes first (S26). |
| `limit-written-1.md` to `-4.md` | T5 writes them after its correction: 13,000, 13,000 and 7,000 characters, and a short file with no shared word. |
| `limit-match-1.md` to `-5.md` | Word matches of T5 and T6: 13,000, 11,900 and 13,000 characters, and 2 short files. |

A second copy of the settings home (`claude-settings-home-b`) has another text in `decision-edits-ask-first.md`, without the saved sentence (S8).

| Session | Case |
|---|---|
| T1 `93000001-...` | Reads `decisions/city.md`. Correction at message 2. Then a Write of the memory file `decision-edits-ask-first.md`, a Write of 2 files that are not on disk (a memory file and a project file, S16), and a Write of a code file. Markers in the Write texts, in an agent text and in a later user message must not be in the check input (S5, S22). The fake check gives `now` with the memory file: the need has `savedPath` (S1). |
| T2 `93000002-...` | The start load has an older text of `CLAUDE.md`. 4 corrections, no Write. Each fact is in a file of today: a linked memory file, the start file `CLAUDE.md`, `pipeline/steps/info/8_sync_frontend.md` (5 steps from the start, the sentence is on 2 lines in the file), a memory file with no link (S3, S6). |
| T3 `93000003-...` | 12 corrections with invented words (no word match). The fake check gives one bad or good `now` for each: a path that is not in the input, a quote that is not in the file, a `had` fact with a good `now`, a bad `found` quote with a good `now`, a string, a list, a quote of 5 characters, no quote, no `now` key, `null`, numbers, and a good quote in `~/.claude/CLAUDE.md` (S2, S10, S17, S18). |
| T4 `93000004-...` | 3 corrections with invented words for the word match: the order by score, the path order for equal files, 5 matches at most, the order by rank over the corrections (S15, S21, S23, S25, S26). |
| T5 `93000005-...` | One correction, then a Write of the 4 `limit-written` files. The part reaches the limit: the third written file waits and goes in at the end, the third match file is left out, the files after it go in (S4, S24). The fake check names the file that was left out (S19). |
| T6 `93000006-...` | 19 reads of 12,000 characters before the correction (files `notes/filler-NN.md` that are not on disk). The v1 part has about 230,000 characters, so the new part gets about 10,000 (S13). The fake check has the v1 shape (S9). |

Fake answers: `fake-claude/9300000N-....intents.json` and `fake-claude/9300000N-....needs-check.json` for N from 1 to 6. The test also uses the fixture sessions B and C. The answer of B (`22222222-...needs-check.json`) has the v1 shape, with no `now` (S9).

The old needs-check answers (`22222222`, `91000003`, `95000001`, `95000003`, `96000001`, `96000005`, `97000001`) did not change. They have no `now`, so no fact of the old tests is saved.

The test has no groups answer and no duplicates answer for its file list: those 2 calls fail in each run with `--intents`, and the report still comes out.

### Health, prompt and page (`test/e2e-step-10-d.test.mjs`)

Step 10, part D adds no session file and no project file here. `test/e2e-step-10-d.test.mjs` makes 4 git copies of `indoeuromap/` and 8 settings homes in its temporary folder. Each settings home is a copy of `claude-settings-home/` without its `projects/` folder, so no session of the fixture counts. The test writes each session, each memory file and each new project file. All texts are invented.
The cases are in the step 10 failure list (R, C, F, T, the health side of S, L3, G) and in the list of worker D (D1 to D17).

#### Fake answers

| File in `fake-claude/` | Case |
|---|---|
| `89000001-...` to `89000005-...` `.intents.json` | One intent that starts at message 1, with no correction. Each test home uses these ids for its plain sessions, with other reads in each home. |
| `89000006-...` `.intents.json` and `.needs-check.json` | One `missing-context` correction at message 2. The check finds it in no file (`now: null`). |
| `89000007-...` `.intents.json` and `.needs-check.json` | 5 `missing-context` corrections at messages 2 to 6. The check gives a file of today for 4 of them: a memory file that the index links, a memory file with no link, `second-iteration/decisions/city.md`, and `~/.claude/CLAUDE.md`. The 2 memory paths hold the word `MEMORY_DIR`. |

The memory folder of a project has the project root in its name, and the root of the test is a new temporary folder on each run. So the test copies `test/fake-claude.mjs` and `fake-claude/` into its temporary folder and puts the real folder in the place of `MEMORY_DIR` (the way of `test/e2e-step-10-c.test.mjs`).
No intent group answer and no duplicate answer is there for these runs, so the group call and the duplicate call fail (each intent is its own group, and One source uses the exact copies). One exception: for the project BIG, the test reads the run id of the duplicate call from the call log of a first run, writes an answer with no fact for that id into its copy of `fake-claude/`, and runs again.

#### Projects (in the temporary folder)

| Project | Change to the copy | Case |
|---|---|---|
| M (main) | `.gitignore` gets `work/`. New: `work/model-calls/index.md` (links `changes.md` and `bench.md`), `work/extra/p.md` and `q.md`, `notes/now.md`, `guides/deploy.md` and `release.md`, `notes/chain/a.md` to `c.md`, `notes/cycle/x.md` and `y.md`, `notes/orphan.md`. `CLAUDE.md` gets a link to `notes/now.md` and a folder link to `guides/`. `second-iteration/plan.md` gets a line that names `notes/`. | A git-ignored index with no link to it (F4, F7). A folder name in plain text in a file 1 step away that a link names (`notes/now.md`), in a file 1 step away that only a folder link reaches (`guides/deploy.md`), in the memory index, and in a file 2 steps away (F10, D2, D3, D16). 2 files with no link in one named folder (D1). A chain of 3 files and a cycle of 2 files with no route (F5, F6). An orphan (F3). A file 1 step away by a folder link (F1). |
| N (agents) | No `CLAUDE.md`, no project commands. New: `notes/orphan.md`. | `AGENTS.md` is the start file (F8, R7). With the setting `instructionFiles: "claude-md"` it does not load: the root item with an import (R2 to R6, R9). |
| BARE | No `CLAUDE.md`, no `AGENTS.md`, no project commands. New: `notes/orphan.md`. | The root item with no import (R1). `README.md` and `llms.txt` link each other. |
| BIG | New: `notes/big-log.md`, 250,000 characters in lines of 3 words. | The file does not fit in the input of the duplicate check (L3). It is 1 of the 2 needed files. |

#### Settings homes and sessions

| Home | Sessions | Case |
|---|---|---|
| main (project M) | `89000001` reads the 3 model call notes and the 2 extra notes. `89000002` reads `changes.md` (the user gives its path), `notes/chain/c.md` and `notes/cycle/y.md`. `89000003` finds `city.md` by a Grep and reads `guides/deploy.md`, the orphan, `~/.claude/notes/user-notes.md` and the old orphan of the fixture. `89000004` reads `AGENTS.md`, `pipeline/METHOD.md` and 2 memory files. `89000007` has the 5 told facts. It writes 2 memory files and `city.md` after the corrections, and its start load has an older text of the user file. | 18 file needs and 5 told facts. Found 9 of 23, Close 6.25 of 23 (the test has the sum). 11 lost files in 9 groups. 3 saved facts (S1, S7, D6, D7), 1 fact in a file with no route (S6), 1 fact in no file. A file in `~/.claude/` that the map does not know (F9). A memory file with no link (D10) and a memory file that the index links (D5). |
| main, memory folder | `MEMORY.md` links `saved-rule.md` and `legend.md` and names `work/model-calls` as plain text. `loose-note.md` has no link. | The memory side of the cases above. |
| thin-5-20 | 5 sessions, 4 reads each. | 5 analysed sessions and 20 needs: not thin, no skipped file, no line (T2, T5). With `--sessions 2`: 2 of 5 analysed (T1, T6). |
| thin-5-19 | 5 sessions, 19 reads. 2 headless files (`89000091`, `89000092`) and 1 file with no user message (`89000093`). | Thin by the needs (T2). The skipped line (T3). With no `--intents`: no score, only the skipped line (T4). With no `--old-path`: no sessions, no line (T4). |
| thin-4-20 | 4 sessions, 5 reads each. | Thin by the sessions (T2). |
| agents (project N) | `89000001` and `89000002` read `METHOD.md`, `decisions/index.md`, `city.md` (one time by a Grep) and the orphan. `89000006` has 1 told fact. The start load of each record has `AGENTS.md`. | Each fix names `AGENTS.md` (F8, D12). |
| agents-off (project N) | The same reads, plus `AGENTS.md` itself. The start load of each record has only the user file. `settings.json` has `instructionFiles: "claude-md"`. | The root item with `@AGENTS.md`: 4 lost files under it, the orphan as its own item (R2 to R6). Close: "8 needs have no route" (C1, C2). |
| bare (project BARE) | `89000001` finds `README.md` by a Grep and reads `llms.txt` and the orphan. `89000002` reads `README.md`. | The root item "Create CLAUDE.md" with the 3 lost files under it (R1). |
| big (project BIG) | 2 sessions read `AGENTS.md`. One reads the big file. | The One source line with the counts (L3). Close: "1 need has no route" (C4). |

#### Artifacts

`out/e2e-step-10-d/`: `report.json` and `report.html` (the main run), `health-cases.md` (the score, the answers, the data lines and fix 1 of each run), `thin-data.html` and `root-item.html` (2 more pages for the browser check at 400 pixels).

#### Old tests that changed

- `test/e2e-context-ab.test.mjs`: the Close answer of bad is "4 files far, 3 needs have no route" (the 3 needs of `direction.md`). New checks: `close.noRoute`, the Close answer of C3, "Yes" only at 100, the fix and the gap of `direction.md`, the root item is `null`, and the coverage of the duplicate check (58 of 58, no line). The scores did not change.
- `test/e2e-page.test.mjs`: the Close answer is "5 files far, 3 needs have no route" (the orphan and the 2 told facts).
- `test/e2e-routes.test.mjs`: 4 fix texts of the prompt come from the real routes now (`city.md`, the orphan, `llms.txt`, `metrics.md`), and one new check of section 4.

## Step 11 cases

### Only real context files count (`test/e2e-step-11-a.test.mjs`)

Added for step 11, change 1. No file is added to `indoeuromap/` or to `claude-settings-home/`. `test/e2e-step-11-a.test.mjs` makes each project, each settings home, the memory folder, each session and each config file in its temp folder. The checks are listed in the step 11 failure list (CF1 to CF29, CG1 to CG10, DR1 to DR8) and in the list of worker A (CF30 to CF42, CG11, CG12, DR9, DR10). Session ids: `81000001-...` to `81000003-...`.
One file is new in `context-ab/`: `context-files.json`, the config file of the A/B runs.
Each project copy gets the 3 `data/research/*/README.md` files when the repo copy does not have them (git ignores them).

#### Projects (copies of `indoeuromap/` in the temp folder)

| Project | Path in the temp folder | Case |
|---|---|---|
| P | `p/indoeuromap` | The main project, with the case files of the table below. `.gitignore` gets the lines `work/`, `CLAUDE.local.md`, `.claude/skills/local-skill/`, `private/` and `forced/`. `.git/info/exclude` gets the line `local/`. `forced/index.md` is added with `git add -f`. `cfg.json` at the root is the config file that the command must refuse. |
| N | `n/indoeuromap` | No `CLAUDE.md`. The root README has the name `readme.md`. `AGENTS.md` gets the line `@src/prompts/agents-import.md`. New: `src/prompts/agents-import.md`, `sub2/AGENTS.md`, `fixtures/p/AGENTS.md`, `docs/a.mdx`. |
| NOGIT | `nogit/indoeuromap` | No git. New: `node_modules/x/README.md`, `.claude/worktrees/w1/docs/copy.md`, `work/notes.md`, `tests/t.md`. |

#### The case files of P

| Files | Case | Result |
|---|---|---|
| `tests/t.md`, `test/t.md`, `pkg/__tests__/t.md`, `e2e/t.md`, `fixtures/p/a.md`, `deep/a/b/tests/c/t.md`, `TestData/t.md`, `__snapshots__/s.md`, `tests/w.md` | Test folders at the root and deep in the tree. `TestData` has upper case letters. `tests/t.md` names `docs/a.md` as plain text and links `notes/c.md`. | Out (`test`). |
| `artifacts/run.md`, `dist/readme.md`, `out/report.md`, `coverage/c.md`, `build/b.md`, `tmp/t.md` | Output folders. | Out (`output`). |
| `work/notes.md`, `local/l.md` | Git ignores them (`.gitignore`, `.git/info/exclude`). A session reads both. | Out (`ignored`). Not map files. |
| `work/linked.md`, `tests/README.md` | `CLAUDE.md` links both. `tests/README.md` links `docs/deep.md`. | Out (`ignored`, `test`). Map files with 1 step. |
| `forced/index.md` | In an ignored folder, but tracked. | In (`index`). |
| `tests/CLAUDE.md`, `fixtures/p/AGENTS.md`, `sub/CLAUDE.md`, `sub/AGENTS.md` | Nested instruction files. | The 2 first are out (`test`) and not in `later`. The 2 others are in (`instructions`). |
| `.claude/notes.md`, `.claude/plans/p.md`, `.claude/agents/reviewer.md`, `.claude/rules/style.md`, `.claude/rules/cond.md` (it has `paths: src/**`) | The files of `.claude/`. | The 2 first are out (`not-linked`). The agent and the 2 rules are in (`claude-folder`). |
| `CLAUDE.local.md` (links `notes/local.md`), `.claude/skills/local-skill/SKILL.md`, `private/rules.md` (`CLAUDE.md` has `@private/rules.md`) | Claude Code loads them, and git ignores them. | In (`instructions`, `claude-folder`, `start-load`), with `ignored: true`. `notes/local.md` is `linked`. |
| `CONTRIBUTING.md`, `sub/README.md` | Root documents and a README with no link. | `root-doc`, and out (`not-linked`). |
| `docs/a.md`, `docs/a.mdx`, `dev/now/b.md`, `packages/x/docs/c.md`, `Doc/a.md`, `docs/deep.md`, `docs/old/o1.md`, `docs/old/o2.md`, `docs/review.md`, `src/docs/d.md` | Docs folders. `docs/a.md` links `src/prompts/linked.md` and `notes/plain.md`. `docs/review.md` has the words of the second correction of S2. | In (`docs-folder`). `src/docs/d.md` is out (`code-folder`). `docs/deep.md` has no route. |
| `src/api/index.md`, `src/llms.txt`, `tests/index.md` | Index files. | In (`index`), and out (`test`). |
| `src/prompts/p.md`, `src/prompts/plain.md`, `src/prompts/linked.md`, `src/prompts/imported.md`, `src/main.py` | Prompt templates in a code folder: no link, a plain path in `CLAUDE.md`, a Markdown link in `docs/a.md` (and a plain path in `AGENTS.md`), an `@` line in `CLAUDE.md`. `CLAUDE.md` also links the folder `src/prompts/`. | Out (`code-folder`) for the 2 first. `linked` from `docs/a.md`. `start-load`. The code file stays code. |
| `notes/none.md`, `notes/plain.md`, `notes/link.md` | A plain folder: no name, a plain path in `AGENTS.md` (and a link in `docs/a.md`), a Markdown link in `AGENTS.md`. | Out (`not-linked`). `linked` from `AGENTS.md` for the 2 others. |
| `notes/a.md`, `notes/b.md`, `notes/c.md`, `alpha/early.md`, `aaa/earlier.md` | `CLAUDE.md` links `a.md`. `a.md` links `b.md` and `alpha/early.md`. `alpha/early.md` links `aaa/earlier.md`. Only `tests/t.md` links `c.md`. | `linked` with 1, 2, 2 and 3 steps. `c.md` is out (`not-linked`). |
| `notes/x.md`, `notes/y.md`, `notes/x2.md`, `notes/y2.md` | 2 pairs that link each other. `CLAUDE.md` links `x2.md`. | The first pair is out. The second pair is `linked`. |
| `notes/m.md` | Only the memory file `a.md` links it. | `linked` from the memory file. Out with the memory off. |
| `tests/facts.md`, `tests/notes.md`, `tests/written.md`, `tests/copy.md` | The fact of the first correction of S2. The words of the second correction (2 files). A sentence of `AGENTS.md`, word for word. | Out (`test`). Not in the "Files now" part, not in the duplicate check. |
| `.claude/skills/build/SKILL.md`, `.claude/skills/build/notes.md`, `.claude/skills/build/tests/t.md`, `.agents/skills/e2e/SKILL.md` | Skills with the name of an output folder and of a test folder. | In (`claude-folder`). The file in `tests/` below the skill is out (`test`). |
| `.agents/skills/linked/SKILL.md`, `.agents/skills/linked/references/commands.md`, and the symbolic link `.claude/skills/linked` to `../../.agents/skills/linked` | One skill folder with 2 paths. Git lists the link, and no file behind it. | The 4 paths are in (`claude-folder`). The 2 paths below `.claude/` have `ignored: true` and a route (1 and 2 steps). The duplicate check reads each file one time. |
| `fixtures/p/.mcp.json`, `sub/.mcp.json` | Config files in a fixture folder and in a plain folder. | Out (`test`), and in (`start-load`, `kind: "config"`). |
| `glob-root.md`, `ga/a.md`, `ga/sub/c.md`, `gb/a.md`, `gb/sub/c.md`, `gb/sub/deep/d.md`, `gc/a.md`, `gc/ab.md`, `gd/x.md`, `gd/deep/y.md` | Files for the globs. No file names them. | Out (`not-linked`) with no config. |

The lines that the test adds to `CLAUDE.md` of P: a link to `notes/a.md` and to `notes/x2.md`, a link to `tests/README.md` and to `work/linked.md`, a link to the folder `src/prompts/`, the plain path `src/prompts/plain.md`, and the 2 lines `@private/rules.md` and `@src/prompts/imported.md`. The line that it adds to `AGENTS.md`: the plain path `notes/plain.md`, a link to `notes/link.md`, and the plain path `src/prompts/linked.md`.

#### Settings homes

| Home | Content |
|---|---|
| `settings` | A copy of `claude-settings-home/` without its `projects/` folder, plus `plans/p.md`, the memory folder of another project (`projects/-Users-example-projects-other/memory/x.md`), the memory folder of P and the 3 sessions below. |
| `settings-off` | A copy of `settings`, plus `settings.json` with `"autoMemoryEnabled": false`. |
| `settings-claude-md` | A copy of `claude-settings-home/`, plus `settings.json` with `instructionFiles` = `claude-md`. With it, N has no start file, so the map runs a second time. |

The memory folder of P has `MEMORY.md` (it links `a.md`) and `a.md` (it links `notes/m.md`, a path from the project root).

#### Sessions (in `settings/projects/-Users-example-projects-indoeuromap/`, with the fake root `/Users/example/projects/indoeuromap`)

| Session | Case |
|---|---|
| S1 `81000001-...` | 3 user messages, 3 intents. Intent 1: Reads of `tests/t.md`, `docs/a.md`, `src/prompts/p.md` (2 times), `work/notes.md`, `local/l.md`, `tests/README.md`, `work/linked.md`, `.mcp.json`, `.claude/settings.json`, `CLAUDE.local.md`, `.claude/skills/local-skill/SKILL.md`, `private/rules.md`, 2 `nested_memory` loads (`tests/CLAUDE.md`, `sub/CLAUDE.md`), Reads of `~/.claude/plans/p.md`, of the memory file of another project, of `~/.claude/skills/unslop/SKILL.md`, of the memory file `a.md` of P, of `tests/w.md` and `dev/now/b.md` through the worktree path `.claude/worktrees/w1/`, of `notes/gone.md` and `tests/gone.md` (not on disk), of `src/main.py`, of `TestData/t.md` and of `.claude/skills/linked/references/commands.md`. Intent 2: Reads of `src/prompts/p.md` and `notes/none.md`. Intent 3: one Read of `tests/t.md`. Result: 10 file needs in intent 1, none in intents 2 and 3, and 15 dropped needs. |
| S2 `81000002-...` | 3 user messages, 1 intent, 2 `missing-context` corrections (messages 2 and 3). The agent reads `tests/facts.md` before message 2. After message 3 the session edits `tests/written.md` and `docs/review.md`. Result: 1 dropped need (`tests/facts.md`), the first correction is `had` with the path `tests/facts.md`, the second is `missing` and not saved. |
| S3 `81000003-...` | One user message, so it is not analysed. Reads of `tests/t.md` and `src/prompts/plain.md`. They are not dropped reads. |

#### Config files (in `config/` of the temp folder)

| File | Content | Case |
|---|---|---|
| `empty.json` | `{}` | The same report as with no config, but for `contextRules.config`. |
| `include.json` | `include`: `notes/**`, `work/**`, `src/**`, `tests/**`. `exclude`: `notes/a.md` | Files with no link and ignored files come in as `config`. `notes/a.md` is in both lists: out. `src/main.py` stays code. `tests/CLAUDE.md` is in `later` again. |
| `exclude.json` | `exclude`: `docs/old/**`, `CLAUDE.md`, `notes/a.md`, `.mcp.json`, `sub/CLAUDE.md` | `CLAUDE.md` stays. The chain behind `notes/a.md` goes out (`not-linked`). `sub/CLAUDE.md` leaves `later`. |
| `globs.json` | `include`: `*.md`, `ga/*`, `gb/**`, `gc/?.md` | One glob for each form. |
| `all.json` | `include`: `**/*.md` | Each Markdown file that the tool sees is `config`. Only `fixtures/p/.mcp.json` is out. |
| `forms.json` | `include`: `./gc/ab.md`, `/ga/sub/*.md`, `gd/`, `**/glob-root.md` | The forms of a glob. |
| `missing.json` (not written), the folder `config/`, `bad-json.json` (`{`), `bad-list.json` (`[]`), `bad-shape.json` (`{"include": "docs"}`), `bad-entry.json` (`{"include": [1]}`), `bad-empty.json` (`{"exclude": [""]}`), `bad-key.json` (`{"includes": []}`), and `cfg.json` in P | | The command stops with exit code 1 and one line. |

#### Fake answers

| Answer file | Used by | Case |
|---|---|---|
| `81000001-...intents.json` | S1 | 3 intents (they start at messages 1, 2 and 3), no correction. |
| `81000002-...intents.json` | S2 | 1 intent, 2 `missing-context` corrections at messages 2 and 3. |
| `81000002-...needs-check.json` | S2 | c1: `found: true` in `tests/facts.md` (a file that is out, and that the agent read). c2: `found: false`, and `now` names `tests/notes.md` (a file that is out, so it is not in the input and the fact is not saved). |
| `run-672816a2e233.intent-groups.json` | the main run | The 4 intents of S1 and S2 in 3 groups. |
| `run-f01e914a3f59.duplicates.json` | the tests that copy `indoeuromap/` and run with `--intents` (`e2e-intents`, `e2e-needs`, `e2e-page`, `e2e-routes`, `e2e-score`), and the demo with the fake binary | A copy of `run-1152cd2eb881.duplicates.json`: the same 5 facts. The list of files is now `indoeuromap/` without the 2 index files of `data/` (no file names them) and without the research files (git ignores them), with or without the research files on disk. |

The duplicates answer of the main run of `test/e2e-step-11-a.test.mjs` is not a file of the repo: its run id holds the memory folder of P, which has the temp folder in its name. The test copies `test/fake-claude.mjs` and `fake-claude/` into its temp folder (the way of `test/e2e-step-10-c.test.mjs`). A first run gives the run id (its duplicates call fails). Then the test writes an answer with one fact (the line limit of `status.md`, in `AGENTS.md` and `second-iteration/direction.md`) and runs again.

Two answer files are not used by a test now: `run-1152cd2eb881.duplicates.json` and `run-eaca45df67b2.duplicates.json`. Both lists of files are now the list of `run-f01e914a3f59`. The sentence of "Duplicate cases (step 9)" about the demo in a checkout with the 3 research files is not true now: the demo uses `run-f01e914a3f59` in each checkout.

The main run (P, `settings`, `--old-path`, `--intents` with the fake binary) is the artifact `out/e2e-step-11-a/`. Its `report.json` holds temp folder names (the project root and the memory folder name), so it is the same on 2 runs of one test process, not between 2 test processes.

#### Changes to the fixtures of the old tests

| Test | Change | Why |
|---|---|---|
| `test/e2e-step-10-a.test.mjs` | The runs `main` and `off` pass a config file with `include: ["work/**"]`. A new run `main-no-config` has no config file. | The checks of the folder mentions and of the links of `work/` need the ignored files of `work/` as context files with no route. The new run shows the step 11 result: the files of `work/` that a session read are not on the map and are in `contextRules.excluded`. |
| `test/e2e-step-10-b.test.mjs` | Each run passes a config file. Part X: `include: ["step10/**", "data/**"]`. Part L: the globs of `context-ab/context-files.json` and `aaa-filler/**`. | The test checks the duplicate check on a fixed list of files. With the config files the lists are the lists of step 10, so the 4 run ids and their answers do not change. |
| `test/e2e-step-10-d.test.mjs` | Each run passes a config file with `include: ["notes/**", "guides/**", "work/**", "data/**"]`. The user notes file moved from `~/.claude/notes/user-notes.md` to `~/.claude/plugins/demo/skills/review/user-notes.md`. | The lost files of the test are files that no context file names, files behind a folder link, and ignored files. With the rule alone they are not context files. A file of `~/.claude/notes/` is not a need path now (`user-other`). The new path is in a `skills` folder, the map does not know it, and it sorts at the same place as the old path. |
| `test/e2e-context-ab.test.mjs`, `fixtures/context-ab/apply.mjs` | Each run passes `fixtures/context-ab/context-files.json` (`include`: `second-iteration/**`, `pipeline/**`, `data/**`). The D6 run passes a config file with `notes/**` too. | In `bad/`, no file links `second-iteration/direction.md`, so the rule alone drops its 3 reads. `data/**` keeps the list of files of step 10, so `run-23cc20f73920` and `run-2537a5b1f3f3` still fit. |

### The counts, the page, the fixes and the prompt (`test/e2e-step-11-b.test.mjs`, `test/e2e-step-11-c.test.mjs`)

No file is added to `indoeuromap/` or to `claude-settings-home/`. Each of the 2 test files writes its projects, its settings homes, its sessions and its fake answers in its temp folder. `test/e2e-step-11-c.test.mjs` has a run with 12 causes (10 fixes and 2 smaller items).

Stale since step 11: the fake answers `run-1152cd2eb881.duplicates.json` and `run-eaca45df67b2.duplicates.json` (the file list of the demo changed, its answer is `run-f01e914a3f59.duplicates.json`). The sentence above that says that the demo uses `run-23cc20f73920` is not true now.
