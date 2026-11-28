# Context Health workspace

- [Dashboard guide](../README.md#improve-a-context-map-step-by-step) explains how to refactor with a project agent, review the changes and compare versions using shared questions.
- [Saved versions](../src/ui/map-versions.mjs) stores each map, tracks an open refactor and saves reviewed files as a child of the starting version.
- [Version review](../src/ui/version-review.mjs) uses saved documents and recorded needs to score a version and propose edits.
- [Version reports](../src/ui/version-report.mjs) rebuilds the folder map and full report from a version's saved files and session evidence.
- [Benchmark questions](../src/ui/map-questions.mjs) generates questions from the selected intents and checks their expected answers against the saved guides.
- [Version workflow check](../test/e2e-version-proposals.test.mjs) starts with an older saved map and verifies that a selected fix creates an independent version.
- [External refactor check](../test/e2e-context-refactor.test.mjs) tests a server restart, checks the saved folder maps and recorded session activity, and compares benchmark results.
- [Benchmark workflow check](../test/e2e-benchmark-questions.test.mjs) exercises question generation and verifies the evidence behind a correct or incorrect answer.

- [Dashboard interface](../src/ui/page/app.js) presents projects, settings, report updates and activity across the dashboard.
- [Version and benchmark interface](../src/ui/page/map-versions.js) handles map selection, review of struggles, shared questions and grade evidence.
- [Workspace layout](../src/ui/page/workspace.css) sets the desktop and phone layouts for versions, questions and results.
- [Local map worker](../src/ui/map-worker.mjs) performs map reviews and version changes while the dashboard responds to activity requests.
- [Dashboard workflow check](../test/e2e-dashboard-workflow.test.mjs) drives the interface against a local server and saves the activity and verdict shown to the owner.
- [Test dependency lock](../package-lock.json) pins the document simulator used by the dashboard workflow check.

## Design prototypes

- [Context exploration](context-exploration-prototype.html) shows where an agent looked and what it opened directly on a map of the project folders.
- [Earlier workspace prototype](context-workspace-prototype.html) shows the first version of the workspace design.
