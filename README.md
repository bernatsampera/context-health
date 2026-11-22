# context-health

Go into a project and see in a moment how its agent context is placed and how it works.

## Install

You need Node.js 24 or later and the [Claude Code](https://claude.com/claude-code) CLI (`claude`). The tool reads the Claude Code sessions of a project in `~/.claude/projects/`. The intent analysis uses `claude -p`, so it uses your Claude account.

```
npm install -g context-health
```

Then `context-health` works in any folder. The reports go to `~/.context-health/<project name>/`. Set `CONTEXT_HEALTH_HOME` to use another folder.

## Run it

### Demo

Clone this repo, then run from it:

```
npm run demo
```

With counts and fixes, from the fixed answers of the fake model (no real model call):

```
CONTEXT_HEALTH_CLAUDE_BIN=test/fake-claude.mjs npm run demo -- --intents --cache /tmp/context-health-cache
```

Or by hand:

```
cd fixtures/indoeuromap
node ../../bin/context-health.mjs --claude-settings-home ../claude-settings-home
```

### In a real project

Install it one time (see "Install"). In a clone of this repo, `npm link` also works.

The loop:

1. `cd ~/some-project` and run `context-health`.
   - When sessions are new, the command asks: "N new sessions to analyse: about M or more sonnet calls (claude -p). Run them? [y/N]". Type `y` to analyse them. Type Enter to use only the cache (no cost).
   - The page opens: the score, the 4 questions, the fixes and the map.
2. Run `context-health fix`.
   - It starts `claude` in the project with the improvement prompt. Read each edit before you accept it.
   - When the agent is done, type `/exit`. The command then writes the report again.
   - The fix session does not count as a session of the project.
3. Read the page again. A line under the score shows the last other result and the change: "Last run (...): 50 mixed, 4 fixes. Now: 64 mixed (+14), 2 fixes."
4. Use the project for some days. Then run `context-health` again. Only the new sessions cost calls.

The options of a run are saved in `<out>/settings.json`. For example, give `--old-path /the/old/folder` one time, and the next runs use it. An option on the command line replaces the saved value.

Each run with a new result adds one line to `<out>/history.json`.

### Options

- `[folder]`: the project to read. Default: the current folder.
- `fix [folder]`: start `claude` in the folder with the improvement prompt of the last report, then write the report again.
- `--yes`, `-y` (or `--intents`): make the model calls with no question.
- `--no-calls`: make no model call. Use only the cache.
- `--old-path <path>`: an earlier place of the project. Its sessions count too. It can repeat. The demo passes `--old-path /Users/example/projects/indoeuromap`.
- `--sessions <n>`: how many of the newest sessions with 2 or more user messages to analyse. Default: 20.
- `--config <file>`: a JSON file that adds context files or takes them out, for example `{ "include": ["notes/**"], "exclude": ["docs/old/**"] }`. It must be outside the project. See "What counts as a context file".
- `--intents-model <name>`: the model for the calls. Default: `sonnet`.
- `--claude-settings-home <dir>`: the folder to read instead of `~/.claude` (your global CLAUDE.md, `settings.json`, skills, commands, agents, and in `projects/` the sessions and the auto memory of the project). You need it only for the demo and the test.
- `--out <dir>`: where to write the report, the saved options and the history. Default: `<data>/<project name>/`. `<data>` is `out/` in a git checkout of this repo, else `~/.context-health/`. It must be outside the project.
- `--cache <dir>`: where the model answers are kept. Default: `<data>/.cache/<project name>/`. It must be outside the project.
- `--no-open`: do not open the page.
- `--no-save`: do not read or write the saved options and the history. The tests use it, so that two runs give the same page.

The model calls find the intents of the sessions, check the missing-context corrections (did the agent have the fact, is the fact in a context file today, and is it a lasting rule or a request for one task), group the intents, and find the facts that are in two files with other words or values (one call per run). They cost tokens. Without a terminal (for example in a script), the command makes no call unless you give `--yes`.

Without calls, the command writes `report.json` and `report.html`, then opens the page (`open` on macOS, `xdg-open` elsewhere). The report command never writes into the project. Only `fix` changes the project, through `claude`, and you accept each edit.

Our code never writes into `~/.claude`. One exception comes from the `claude` binary itself: each `claude -p` call runs in a new temporary folder with no session file (`--no-session-persistence`), but the binary still updates `~/.claude.json` (and keeps a backup in `~/.claude/backups/`) and writes a lock file in `~/.claude/sessions/`. No session text goes there. The `fix` session is a normal Claude Code session in `~/.claude/projects/`.

## The page

One file, `report.html`, with no network. Light design, little text: the first view is simple, and the details come on a click.

- **Top:** the project name, then the health score: one number (0 to 100), its word (good from 80, mixed from 50, else poor), "method v1", and the base ("from N of M sessions, K needs"). The page shows the number only when the proof passes. Else it shows "Score not proven" with the numbers of the proof, or "Not enough data" (fewer than 5 analysed sessions or fewer than 20 needs). See "The health score".
- **4 questions**, each with a short answer. A click on a question opens its list, and closes the others.
  - "Can the agent find what it needs?": the needed files with no route, and the rules that you typed and that no file with a route holds.
  - "Are the needed files close to the start?": the needed files with a route of 2 or more steps, or with only a folder link. Each has the file and the line to change.
  - "Did you have to tell the agent?": the lasting rules that you typed, with "already saved in <file>" when a file with a route holds the rule now. A request for one task only is not in this list.
  - "Is the start load lean?": the tokens of the start load, the penalty, and the start items that no intent used, biggest first.
- **Fixes:** each fix is under its question, 10 at most in total, the fix that covers the most needs first. The other causes are in a closed part ("N smaller items"). A fix never tells the agent to edit a test file, a file that git ignores, or a file that counts only because another file links it. The tool gives no fix for a copy of a fact. It gives a fix for a fact with different values only when both files are named context files.
- **Prompt:** "Copy improvement prompt" copies a prompt for an agent: what was explored (with the health score line and the 5 counts), what the agent needs most, the routes to the hot files, the problems, the same fixes as on the page (10 at most), and what to do then. "Show prompt" shows it, with "What to improve" marked.
- **Middle:** the map. One column for each number of steps from the start load, one box for each context file, darker when more intents used it, faint when no intent did. A lane at the bottom holds the files with no path. Hover a box for its route, its use count, and how the selected intents reached it. Click a box to copy its full path.
- **Right:** a list with an Intents and Sessions switch. Intents: similar intents of all sessions are one group, with a count, most frequent first, with the filters All, 2+ times, Weak links, Told by user. Click a group: the map shows its routes in blue (a search jump is dashed amber, a thicker line is a route more intents took), and the lines under the map show only its problems. Its session dates come under it: click one to open that session. Sessions: one row per session, newest first, with its first message and its number of intents (or why it has none). Click a row: the map shows all the files the session used, with its problems, and its groups come under the row.

The groups come from one model call per run with `--intents` (prompt `src/prompts/intent-groups-v1.md`), with the same cache as the intents.

## The health score

Method v1. The method has a version: a later change of the tool that moves a real score by more than 5 points must be "v2", with a note.

- Each need gets a grade on the map of today. A need is a context file that an intent read, or a lasting rule that you had to type. It counts one time for each intent.
  - Served: a link that names the file, 0 or 1 step from the start load. An `@` import is 0 steps.
  - Slow: a route of 2 or more steps, or a route through a link that names only a folder.
  - Missed: no route. Also a rule that you typed and that no file with a route holds.
- Score = 100 x (Served + 0.5 x Slow) / all needs, minus the start load penalty, from 0 to 100.
- The start load penalty: 1 point for each full 1,000 tokens of start load text that no intent used, after the first 3,000 tokens. 15 points at most. An instruction file (`CLAUDE.md`, `AGENTS.md`, a rule) is used when 1 or more intents ran. An `@` import of another file and the memory index are used when an intent needed the file or a file that it links. A skill, command or agent description is used when a session loaded its body.
- The grade comes from the map, not from the sessions. So a fix of the context changes the score on the same recorded sessions.

The proof, before the page shows a number: for each analysed session, the tool finds the commit of the project at the start time of the session (read-only git commands), builds the map of that commit, and gives each file need its grade on that map. Then it compares what the agent did. The proof passes when the agent got a Served file with no link (a search, a path from you, nothing that named the file) less often than a Missed file, and when you typed no more rules in the intents with Served needs than in the intents with Missed needs. Each group must have 10 or more needs. The memory files and the files of `~/.claude` are not in git, so the proof uses their state of today. A session with no commit before it, or a project with no git, is left out with the reason. The files of each old commit are kept in `<cache>/history/`.

## What counts as a context file

Only these files count. A read of each other file is not a need, and `report.json` says how many reads were dropped and why (`needs.dropped`).

- `CLAUDE.md`, `AGENTS.md` and `CLAUDE.local.md` in any folder.
- The skills, commands, agents and rules of `.claude/`, and `.agents/skills/`.
- The auto memory of the project (`MEMORY.md` and its files).
- `README.md` and `CONTRIBUTING.md` at the root.
- Each file in a folder `docs/`, `doc/` or `dev/`, each `index.md`, and each `llms.txt`.
- Each Markdown file that one of these files names, and each file that such a file names (the rule repeats). In a code folder (`src`, `lib`, `libs`, `app`, `bin`, `cmd`, `pkg`, `internal`, `scripts`, `source`) only a Markdown link or an `@` import counts. In each other folder, a path in plain text counts too. A link to a folder brings no file in.
- Each file that Claude Code loads by itself (the start load, the body of a project skill), also when git ignores it.

Always out, also with a link: a file in a test or output folder (`test`, `tests`, `__tests__`, `e2e`, `fixtures`, `fixture`, `__fixtures__`, `testdata`, `__snapshots__`, `artifacts`, `node_modules`, `dist`, `build`, `out`, `coverage`, `tmp`, `temp`), and a file that git ignores (`.gitignore` and `.git/info/exclude`).

A project that keeps its documents in another folder can add them with `--config <file>`. The file is a JSON object with the keys `include` and `exclude`, each a list of globs from the project root (`*` and `?` stay in one folder, `**` crosses folders). `exclude` wins over `include`, and `include` wins over each rule above. The file must be outside the project.

A file from the first 5 points, or from `include`, is a named file. The tool tells the agent to edit only named files.

## What counts as the start load

- Your `~/.claude/CLAUDE.md`, each CLAUDE.md (also `.claude/CLAUDE.md` and `CLAUDE.local.md`) of the project folder and of the folders above it, their `@` imports, and the rules.
- AGENTS.md, as Claude Code 2.1.277 or later reads it: only when no CLAUDE.md is in the project folder or above it. Then each `AGENTS.md` of the project folder and of the folders above it loads. The setting `instructionFiles` in `settings.json` of the settings home changes this (`claude-md-and-agents-md`, `claude-md`).
- The auto memory index: the first 200 lines (or 25 KB) of `~/.claude/projects/<project folder>/memory/MEMORY.md`. The memory files that it links are 1 step away on the map.
- The descriptions of the skills, commands and agents, and the MCP servers.

A file in a worktree (`.claude/worktrees/<name>/` or `.worktrees/<name>/`) is the same file as in the main folder: the tool maps each session path to the main path.

## Structure

- `bin/context-health.mjs`: the command. It runs the steps in order and writes the report.
- `src/context-files.mjs`: step 11. The rule that says which files are context files, the config file, and the reasons for the files that are out.
- `src/collect.mjs`: step 1. Reads the project and `~/.claude`, and builds the start load (with the AGENTS.md rule and the memory index), what loads behind a trigger, and the context files.
- `src/memory.mjs`: step 10. Reads the auto memory folder of the project. It only reads.
- `src/map.mjs`: step 2. How the agent reaches each file from the start load, and in how many steps. The memory files and the context files that a session read are on the map too. For a project with no start file of its own, it runs a second time with a virtual CLAUDE.md to see what that file would bring in.
- `src/sessions.mjs`: step 3. Reads the Claude Code sessions of the project (also the sessions of its worktrees): messages, reads, searches, and where the agent knew each path from.
- `src/intents.mjs`: step 4. Cuts each session into intents and finds the corrections, with one model call per session (`--intents`) and a cache. Prompt: `src/prompts/intents-v2.md` (`intents-v1.md` is the old version, kept for the record).
- `src/needs.mjs`: step 5. The context files each intent needed, how the agent got them, and the context the user had to give. Prompt of the check: `src/prompts/needs-check-v3.md` (`needs-check-v1.md` and `needs-check-v2.md` are the old versions). The check also says where a told fact is today, and if the fact is a lasting rule or a request for one task. Only a lasting rule is a need.
- `src/score.mjs`: step 6. The scores. It only calculates. The page does not show them now, but `report.json` keeps them.
- `src/groups.mjs`: step 8. Groups similar intents of all sessions, with one model call per run (`--intents`) and a cache. Prompt: `src/prompts/intent-groups-v1.md`.
- `src/routes.mjs`: step 8. The route the agent took to each needed file, the problems and the heat of the map. It only calculates.
- `src/duplicates.mjs`: step 9. The facts that are in two or more context files: the exact copies on every run, and one model call per run (`--intents`) with a cache for the others. Each model quote is checked against the file. Two places disagree only when the model says so and the code finds a different number, literal or name. The files that the intents needed go into the model input first. Prompt: `src/prompts/duplicates-v2.md` (`duplicates-v1.md` is the old version).
- `src/health.mjs`: steps 9 and 11. The 5 counts (`health.counts`, in `report.json` and in the prompt; the page does not show the 5 rows now), the why and the place of the link of each lost file, and how much data there is. The health score of step 9 and its 3 parts stay in `report.json` for comparison. The page does not show them. It only calculates.
- `src/score-v1.mjs`: step 12. The health score, method v1 (`health.v1`): the grade of each need, the start load penalty, the 4 questions and their items. It only calculates.
- `src/history.mjs`: step 12. The proof of the score: the commit of each session, the map of that commit (read-only git commands, the files go to `<cache>/history/`), and the rates for each grade.
- `src/found.mjs`: step 11. How the sessions found each needed file (by links, by a search, from the user, with nothing that named it). The counts and the fixes use it. It only calculates.
- `src/fixes.mjs`: step 11. One fix for each root cause, 10 at most (`fixes`). The page and the prompt use the same list. It only calculates.
- `src/prompt.mjs`: step 8. The improvement prompt. It only calculates.
- `src/render.mjs`: the page. It calculates nothing: it embeds the data as one JSON object. `src/page/page.js` draws the map and the list and handles the clicks, `src/page/page.css` is the style, `src/page/copy-markdown.html` is the Copy markdown button. the ui v4 sketch is the approved sketch of the page.
- `vendor/show-context/`: a copy of one file of show-context (shell command kinds).
- `fixtures/indoeuromap/`: the demo project, a smaller copy of diversity-map. `fixtures/claude-settings-home/`: a fake `~/.claude` with fixed content and fake sessions, so the demo and the test do not depend on your real settings. `fixtures/fake-claude/`: the fixed answers of the fake model. `fixtures/README.md` lists the deliberate cases.
- `test/`: one E2E file for each step (`e2e.test.mjs`, `e2e-map`, `e2e-sessions`, `e2e-intents`, `e2e-needs`, `e2e-score`, `e2e-routes`, `e2e-page`, `e2e-context-ab`, `e2e-step-10-a` to `e2e-step-10-d` for step 10, `e2e-step-11-a` to `e2e-step-11-c` for step 11, and `e2e-step-12-a` to `e2e-step-12-c` for step 12). Each runs the command on a git copy of the fixture. `test/step-10-real-trial.mjs` and `test/step-11-real-trial.mjs` are not tests: each builds a before and after table from 2 report folders of a real project (`out/e2e-step-10/before-after.md`, `out/e2e-step-11/before-after.md`). `test/step-12-real-trial.mjs` builds the validation table of the score from the step 12 reports (`out/e2e-step-12/validation.md`). `test/fake-claude.mjs` is a fake `claude` binary, so no test calls a model. Run `npm test`. The artifacts are in `out/e2e-*/`.
- `archive/`: the first investigation (2026-11-18). Not used by the code.

## License

MIT. See `LICENSE`.
