# Project instructions

IndoEuroMap shows how multicultural each European city and neighbourhood is. `pipeline/` makes the data. `frontend/` shows it. `social/` makes posts. `selfhost/` runs the vote service.

## Start here

1. Read [second-iteration/status.md](second-iteration/status.md). It is the current state.
2. Read [second-iteration/plan.md](second-iteration/plan.md) for the work and its order.
3. For a section of the site or a process, read its file in [second-iteration/decisions/](second-iteration/decisions/index.md).
4. For numbers, profiles, or the map, read [pipeline/METHOD.md](pipeline/METHOD.md).
5. To find files, read [llms.txt](llms.txt). Then read only what the task needs.
6. `first-iteration/` is the archive. Read it only when a decision file points there.

## Work rules

- Write in ASD-STE100 Simplified Technical English: short sentences, active voice. No en or em dashes.
- Use `uv run` for Python. Do not use pip.
- No tests. Do not write, run, or keep tests. Prove work with a real run on the data.
- Do not commit, push, or deploy unless the owner asks for that action.
- Do not delete files. Move them to the Trash or to `first-iteration/`.
- Keep raw data, caches, logs, and databases under `data/`. Never export reviewer records or individual labels.
- After a change on the site, add a row to its decision file. Then replace `second-iteration/status.md` (60 lines maximum).
- After adding, moving, or removing files, update the affected `llms.txt`.
- Do not add tool layers: no knowledge tree, no context system, no session journal.

## Pipeline operation

- Inspect saved data with the `diversity-map-data` tools. Control work with the `diversity-map-jobs` tools.
- Present the exact city batch before `run_batch`. It submits at once.
- Keep failed cities visible. Report the city, the step, the error, the evidence, the cause, and the next action.
- Stop before deployment. Local profiles, exported data, and deployed data are separate states.
- Operating rules are in [second-iteration/decisions/pipeline-and-coverage.md](second-iteration/decisions/pipeline-and-coverage.md) and [pipeline/city-factory/README.md](pipeline/city-factory/README.md).
