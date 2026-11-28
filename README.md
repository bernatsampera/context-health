# context-health

Go into a project and see in a moment how its agent context is placed and how it works.

## Install

You need Node.js 24 or later and the [Claude Code](https://claude.com/claude-code) CLI (`claude`). The tool reads the Claude Code sessions of a project in `~/.claude/projects/`. The intent analysis uses `claude -p`, so it uses your Claude account.

```
npm install -g context-health
```

Then `context-health` works in any folder. The reports go to `~/.context-health/<project name>-<hash>/` (the hash comes from the path, so two projects with one name do not share a report; a folder with the old name is renamed at its next use). Set `CONTEXT_HEALTH_HOME` to use another folder.

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
   - The terminal shows a minimum call estimate and the data Claude will receive. Type `y` to continue or press Enter for a cache-only report.
   - The first report lists the context files found and offers **Explore files**. If sessions are ready, it also offers analysis. For a moved project, add its previous folder to find the old sessions.
2. Choose **Fix in terminal** on a suggested fix, or run `context-health fix` for the full list.
   - It starts `claude` in the project with the improvement prompt. Read each edit before you accept it.
   - When the agent is done, type `/exit`. The command then writes the report again.
   - The fix session does not count as a session of the project.
3. Read **After the fix** to compare the same recorded sessions against the files before and after the edit. The report names changed routes and checks the exact wording of suggested rules.
4. Use the project again, then analyse new sessions to see whether Claude followed a link to an affected file or searched for it. The tool reuses successful checks. New or changed inputs and retries can use more calls.

The options of a run are saved in `<out>/settings.json`. For example, give `--old-path /the/old/folder` one time, and the next runs use it. An option on the command line replaces the saved value.

Each run with a new result adds one line to `<out>/history.json`.

### The dashboard

```
context-health ui
```

Open a project at `http://127.0.0.1:4747` to see its context score, saved versions, shared benchmarks and current map.

Choose a **Map version** to see its context files grouped by folder. **Opened files** shows files the agent read. **Explored folders** shows folders it listed or searched directly. Use either filter or both across the version's recorded sessions, or select one session to narrow the view. Select a file to inspect its lookup path and references. **View full report** opens the score details, findings, sessions and intents for that same version. Changing versions updates both views. Saved reports use the files and session evidence captured for that version, so you can revisit them after editing the project folder or refreshing its report.

- **Add project** lets you pick a folder that has Claude Code sessions or browse local folders. The first report reads files locally.
- **Update project report** offers a local refresh of the project folder or an AI analysis of session evidence. The AI option shows the model, the minimum number of calls and what Claude will read before you start it.
- The **activity button** at the top stays visible across projects. It shows when an AI call is actually running, when work is local and when the connection is lost. Open it to see the task, model, map or question, available progress, and whether you can stop it.
- **Refactor context** lets you reorganize the project's guidance with your own agent and review the edited files before saving a new version.
- **Review struggles** opens the evidence for the selected version. You can request proposed edits and save the ones you choose as a new version.
- **Project settings** lets you change the model, session limit, previous folders, and which personal instructions or skills to exclude from the score. A paid analysis can still send text from these files to Claude.

The server listens on `127.0.0.1` only, checks the Host, and needs the token of its page for each request. `--port <n>` sets the port. `--no-open` does not open the page.

### Improve a context map, step by step

1. Open your project. The map, sessions and intents show where agents looked for information. If this is your first comparison, save the current context files as a named version.
   A saved map version with no recorded sessions shows **0/100** for context health. Running benchmark questions updates the benchmark results separately.
2. Under **Shared benchmarks**, add a question and its expected answer, or choose **Generate from intents** and select the work you want to test. **Copy prompt** gives you the project intents and existing questions to discuss with your own agent.
3. Run the questions on the starting version. Open a verdict to see the answer and the file the agent cited.
4. Select your starting version and choose **Refactor context** beside its score. If the project folder already differs from that version, review those files before continuing. Use **Copy refactor prompt** and paste it into your agent at the project root. The agent shows the proposed file tree, what it would rewrite and why. Ask for changes or approve the plan in that chat. After approval, the agent rewrites the guides and updates the entry files. Benchmark questions and expected answers stay in Context Health.
5. Come back to **Review file changes** when the agent finishes. You can close and reopen the dashboard in between. Open a file to see what changed in it. Once the changes are ready, give the new version a name and choose **Save new version**.
6. The shared benchmarks now show the starting version and its child side by side. Run the pending checks to compare answers, sources and times. The original keeps its saved files and results.

Questions belong to the project. Each version keeps its own results. A correct answer must contain the expected phrase and quote text the agent read in its cited file. Time includes waiting for Claude. Editing a question clears its previous results. Updating a version from changed project files clears the results for that version.

Saving versions and reviewing proposed links run locally. Generating questions sends the selected intents and excerpts of saved project guides to the configured Claude model. Running a benchmark sends the question and excerpts from the selected version to Claude Sonnet. A benchmark can use up to seven calls per question per version. Completed results stay saved until you choose to run them again or their inputs change.

### Verify the dashboard

Run `npm ci` and then `npm test` from the repository. The dashboard tests start local servers with temporary projects, SQLite databases and a fixture that answers in place of Claude. Run `node --test test/e2e-context-refactor.test.mjs` to repeat the external refactor, including a dashboard restart and an edit made after review. It saves the two reports and `comparison.json` with the reviewed files, version history, recorded exploration and both benchmark answers under `out/e2e-context-refactor/`. The interface check writes its results to `out/e2e-dashboard-workflow/activity-and-verdict.json`. Other checks save proposed edits to `out/e2e-version-proposals/comparison.json` and grading evidence to `out/e2e-benchmark-questions/evidence.json`.

### Options

- `[folder]`: the project to read. Default: the current folder.
- `fix [folder]`: start `claude` in the folder with the improvement prompt of the last report, then write the report again.
- `--yes`, `-y` (or `--intents`): make the model calls with no question.
- `--no-calls` runs with cached results. Combining it with `--yes` or `--intents` stops the command.
- `--verbose` shows the individual analysis stages on a cache-only run.
- `fix --finding <id>` passes one finding from the current report to Claude. The command in the report checks that the finding still matches.
- `--old-path <path>`: an earlier place of the project. Its sessions count too. It can repeat. The demo passes `--old-path /Users/example/projects/indoeuromap`.
- `--sessions <n>`: how many of the newest sessions with 2 or more user messages to analyse. Default: 20.
- `--config <file>`: a JSON file that adds context files or takes them out, for example `{ "include": ["notes/**"], "exclude": ["docs/old/**"] }`. It must be outside the project. See "What counts as a context file".
- `--ignore <user,skills|none>`: leave a part of the context out, as if the files were not there. Default: `user,skills`. `none` counts each file. `user`: each file outside the project (`~/.claude/CLAUDE.md`, `~/AGENTS.md`, the memory, the user skills, commands, agents and rules; a `CLAUDE.md` above the project in the same git repository stays). `skills`: the skills, commands and agents of the project and of the user. The model answers stay, so it costs no call. A file that only an ignored file links counts as missed, and a rule that only an ignored file holds counts as not saved. A score compares only with runs that ignore the same files.
- `--intents-model <name>`: the model for the calls. Default: `sonnet`.
- `--claude-settings-home <dir>`: the folder to read instead of `~/.claude` (your global CLAUDE.md, `settings.json`, skills, commands, agents, and in `projects/` the sessions and the auto memory of the project). You need it only for the demo and the test.
- `--out <dir>`: where to write the report, the saved options and the history. Default: `<data>/<project name>-<hash>/`. `<data>` is `out/` in a git checkout of this repo, else `~/.context-health/`. It must be outside the project.
- `--cache <dir>`: where the model answers are kept. Default: `<data>/.cache/<project name>-<hash>/`. It must be outside the project.
- `--no-open`: do not open the page.
- `--no-save`: do not read or write the saved options and the history. The tests use it, so that two runs give the same page.

The model calls find the intents of the sessions, check the missing-context corrections (did the agent have the fact, is the fact in a context file today, and is it a lasting rule or a request for one task), group the intents, and find the facts that are in two files with other words or values (one call per run). They cost tokens. Without a terminal (for example in a script), the command makes no call unless you give `--yes`.

Without calls, the command writes `report.json` and `report.html`, then opens the page (`open` on macOS, `xdg-open` elsewhere). The report command never writes into the project. Only a fix changes the project files: `fix` through `claude`, where you accept each edit, or Apply in the dashboard, where you pick each file.

Our code never writes into `~/.claude`. One exception comes from the `claude` binary itself: each `claude -p` call runs in a new temporary folder with no session file (`--no-session-persistence`), but the binary still updates `~/.claude.json` (and keeps a backup in `~/.claude/backups/`) and writes a lock file in `~/.claude/sessions/`. No session text goes there. The `fix` session is a normal Claude Code session in `~/.claude/projects/`.

## The page

One file, `report.html`, with no network. Light design, little text: the first view is simple, and the details come on a click.

- **Score.** A confirmed result shows a score out of 100. With fewer than five analysed sessions or 20 needs (files or lasting rules required for a task), the headline shows early findings. If the historical check is inconclusive, it says “Score not proven.” Open **How this score is made** to see the provisional estimate and evidence.
- **4 questions**, each with a short answer. A click on a question opens its list, and closes the others.
  - "Can the agent find what it needs?": the needed files with no route, and the rules that you typed and that no file with a route holds.
  - "Are the needed files close to the start?": the needed files with a route of 2 or more steps, or with only a folder link. Each has the file and the line to change.
  - "Did you have to tell the agent?": the lasting rules that you typed, with "already saved in <file>" when a file with a route holds the rule now. A request for one task only is not in this list.
  - "Is the start load lean?": the tokens of the start load, the penalty, and the start items that no intent used, biggest first.
- **Suggested changes** show what to improve and why it matters. The first suggestion is visible. Open its suggested edit for the details or expand the list to choose another. Findings with session evidence let you open the corresponding sessions.
- **Prompt:** "Copy improvement prompt" copies a prompt for an agent: what was explored (with the health score line and the 5 counts), what the agent needs most, the routes to the hot files, the problems, the same fixes as on the page (10 at most), and what to do then. "Show prompt" shows it, with "What to improve" marked.
- **Folder map.** Search by path or use the keyboard to select a file or folder. Select a session to highlight recorded activity in the project folders. A match shows that the search returned a path. An open shows that the agent read the file. Select an item to see its lookup connections and file references. Zoom and full screen are available.
- **Sessions and intents.** The session list starts with the newest session. Open a session to see what you asked, the start of the agent's answers, and which files changed. If it has no analysed intents, the overview uses your messages. Select a step for what you wrote and to see similar intents. The Intents tab groups similar work across sessions. Choose a group to highlight the files it used and see the sessions where it occurred.

The groups come from one model call per run with `--intents` (prompt `src/prompts/intent-groups-v1.md`), with the same cache as the intents.

## The health score

The method has a version: a later change of the tool that moves a real score by more than 5 points must be a new version, with a note.

- v1: each context file counts.
- v2: the same formula, without the user settings, the skills, or both (`--ignore`). Note: a project that leans on your own files gets a much lower score than with v1. The page says what it left out, and a score does not compare with a score that counts other files.
- v3 (now): the grade Searched. Note: a needed file with no route that the agent found by search has half of a point, not 0. So a project whose files the agent finds by search gets a higher score.

- Each need gets a grade on the map of today. A need is a context file that an intent read, or a lasting rule that you had to type. It counts one time for each intent.
  - Served: a link that names the file, 0 or 1 step from the start load. An `@` import is 0 steps.
  - Slow: a route of 2 or more steps, or a route through a link that names only a folder.
  - Searched: no route, and the agent found the file by a search in its session (grep, `ls`, find, glob), or through a file that it found by a search.
  - Missed: no route and no search. Also a rule that you typed and that no file with a route holds.
- Score = 100 x (Served + 0.5 x Slow + 0.5 x Searched) / all needs, minus the start load penalty, from 0 to 100.
- The start load penalty: 1 point for each full 1,000 tokens of start load text that no intent used, after the first 3,000 tokens. 15 points at most. An instruction file (`CLAUDE.md`, `AGENTS.md`, a rule) is used when 1 or more intents ran. An `@` import of another file and the memory index are used when an intent needed the file or a file that it links. A skill, command or agent description is used when a session loaded its body.
- The grade comes from the map. Only Searched also looks at the session. A link makes a Searched file Served or Slow. So a fix of the context changes the score on the same recorded sessions.

The proof, before the page shows a number: for each analysed session, the tool finds the commit of the project at the start time of the session (read-only git commands), builds the map of that commit, and gives each file need its grade on that map. Then it compares what the agent did. The proof passes when the agent got a Served file with no link (a search, a path from you, nothing that named the file) less often than a Missed file, and when you typed no more rules in the intents with Served needs than in the intents with Missed needs. Each group must have 10 or more needs. The proof grades by the map only: there is no Searched, so a search does not prove itself. The memory files and the files of `~/.claude` are not in git, so the proof uses their state of today. A session with no commit before it, or a project with no git, is left out with the reason. The files of each old commit are kept in `<cache>/history/`.

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
- `src/score-v1.mjs`: step 12. The health score, method v3 (`health.v1`): the grade of each need, the start load penalty, the 4 questions and their items. It only calculates.
- `src/history.mjs`: step 12. The proof of the score: the commit of each session, the map of that commit (read-only git commands, the files go to `<cache>/history/`), and the rates for each grade.
- `src/found.mjs`: step 11. How the sessions found each needed file (by links, by a search, from the user, with nothing that named it). The counts and the fixes use it. It only calculates.
- `src/fixes.mjs`: step 11. One fix for each root cause, 10 at most (`fixes`). The page and the prompt use the same list. It only calculates.
- `src/prompt.mjs`: step 8. The improvement prompt. It only calculates.
- `src/render.mjs`: the page. It calculates nothing: it embeds the data as one JSON object. `src/page/page.js` draws the map and the list and handles the clicks, `src/page/page.css` is the style, `src/page/copy-markdown.html` is the Copy markdown button. the ui v4 sketch is the approved sketch of the page.
- `src/data-folder.mjs`: the report folder of each project, and the rename of the old names.
- [src/fix-outcome.mjs](src/fix-outcome.mjs) measures file routes around an edit and checks usage in later sessions.
- `src/fix-worktree.mjs`: the fix of the dashboard: the temporary worktree, the patches in `<out>/fix.json`, Apply and Discard.
- `src/ignore.mjs`: the options that ignore the user settings or the skills (`--ignore`).
- `src/ui/`: the dashboard. `server.mjs` is the API and the pages, `projects.mjs` reads the projects and the suggestions, `runs.mjs` starts the command line tool for each run, `page/` is the page. Each run also writes `<out>/summary.json` for the cards.
- `vendor/show-context/`: a copy of one file of show-context (shell command kinds).
- `fixtures/indoeuromap/`: the demo project, a smaller copy of diversity-map. `fixtures/claude-settings-home/`: a fake `~/.claude` with fixed content and fake sessions, so the demo and the test do not depend on your real settings. `fixtures/fake-claude/`: the fixed answers of the fake model. `fixtures/README.md` lists the deliberate cases.
- `test/`: one E2E file for each step (`e2e.test.mjs`, `e2e-map`, `e2e-sessions`, `e2e-intents`, `e2e-needs`, `e2e-score`, `e2e-routes`, `e2e-page`, `e2e-context-ab`, `e2e-step-10-a` to `e2e-step-10-d` for step 10, `e2e-step-11-a` to `e2e-step-11-c` for step 11, `e2e-step-12-a` to `e2e-step-12-c` for step 12, and `e2e-ui` for the dashboard). Each runs the command on a git copy of the fixture. `test/step-10-real-trial.mjs` and `test/step-11-real-trial.mjs` are not tests: each builds a before and after table from 2 report folders of a real project (`out/e2e-step-10/before-after.md`, `out/e2e-step-11/before-after.md`). `test/step-12-real-trial.mjs` builds the validation table of the score from the step 12 reports (`out/e2e-step-12/validation.md`). `test/fake-claude.mjs` is a fake `claude` binary, so no test calls a model. Run `npm test`. The artifacts are in `out/e2e-*/`.
- `archive/`: the first investigation (2026-11-18). Not used by the code.

## License

MIT. See `LICENSE`.
