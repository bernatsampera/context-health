---
name: "source-command-brief"
description: "Session brief: live state, running jobs, next steps"
---

# source-command-brief

Use this skill when the user asks to run the migrated source command `brief`.

## Command Template

Read second-iteration/status.md and second-iteration/plan.md.

Call the diversity-map-jobs pipeline_status tool.

Print a 15-line brief with:
- Live cities and sitemap URLs from status.md
- Running jobs and stuck cities from pipeline_status
- The next three steps from status.md
- Blockers from status.md

Do not update any file.
