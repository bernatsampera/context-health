# Pipeline operations

This package provides the factory backend and the two AI tool servers.
AI is the operator interface.
The admin interface was removed on 2026-10-18. Its code is in `first-iteration/pipeline/city-factory/`.
The `/api` routes stay. The MCP tools, the Makefile, and manual `curl` calls use them.

## Start and inspect

Run commands from the repository root.

```text
uv sync --project pipeline/city-factory
uv run --project pipeline/city-factory city-factory --help
```

Start the backend only when queued work may run:

```text
uv run --project pipeline/city-factory city-factory serve --host 127.0.0.1 --port 8010
```

Starting the service starts the scheduler.
The service uses `data/factory.db` and the city files under `data/`.
The old package database is preserved at `data/factory/legacy-package.db`.
It is not the active database.
The MCP configuration is in root `.mcp.json` and `.codex/config.toml`.
`CITY_FACTORY_URL` sets the jobs tool API URL. Its default is `http://localhost:8010`.
`CITY_FACTORY_LOCAL_WORKERS` sets the number of parallel jobs. Its default is 1.
`CITY_FACTORY_STEP_LIMITS` caps parallel jobs per step, for example `places=1,reviews=1`. Unset means no step cap.

## Factory on buildserver

The production queue for places, reviews, names, and profiles runs on buildserver.
`make cs-factory` starts it there in the tmux session `factory` with 2 workers and `places=1,reviews=1`.
It has its own `data/factory.db`. The Mac factory database does not see its jobs.
Use `make cs-push-inputs`, `make cs-run`, `make cs-jobs`, and `make cs-pull-outputs` from the Mac.
See ../home_server/README.md.
To use the jobs MCP tools against the server, open a tunnel (`ssh -N -L 18010:127.0.0.1:8010 owner@buildserver`) and set `CITY_FACTORY_URL=http://localhost:18010`.

## Tools

| Server | Tools and purpose |
|---|---|
| `diversity-map-data` | `city_missing`, `country_accuracy`, `coverage_report`, and `europe_totals` answer from saved data |
| `diversity-map-data` | `method_summary` returns the active profile rule set, overrides, and headline explanation |
| `diversity-map-data` | `city_explain(country, city)` returns profile trace, area stats, and recomputed headline |
| `diversity-map-jobs` | `pipeline_status` and `city_detail` inspect pipeline state |
| `diversity-map-jobs` | `country_gaps` lists cities where zones is done but places is not, or places done but reviews is not |
| `diversity-map-jobs` | `run_batch` submits an exact city list |
| `diversity-map-jobs` | `batch_status` and `job_log` track work and errors |
| `diversity-map-jobs` | `review_queue_status` and `review_queue_action` operate the review queue |
| `diversity-map-jobs` | `seed` updates city records; `sync` builds profiles and can export frontend data |

Saved observations can be old. Check their timestamps.
When a new observation is needed, run `make factory-seed`, then `uv run --project pipeline/city-factory city-factory ask-refresh`.
Use `seed` after adding city configurations.

## Batch workflow

1. Read the user's requested area and selection rule.
2. Inspect existing city data and required inputs.
3. Present the exact city batch and explain the required work.
4. Submit the approved city keys with `run_batch`.
5. Monitor batch results and job logs.
6. Handle temporary failures with bounded retries.
7. Leave unresolved cities blocked and continue the other cities.
8. Validate successful city outputs before frontend export.
9. Export the results and run the local frontend build.
10. Report successful cities, blocked cities, export results, and build results.

For each failure, report the city, step, error, evidence, cause, and next action.
If the evidence does not establish a cause, say that the cause is unknown.
Keep job identifiers and log paths so another session can continue the work.
Do not clear claims or change database states to force a retry.

## Current limits

`run_batch` creates a backend preview and submits it in one call.
It is not a preview-only tool. Get approval for the city list before calling it.

The `profiles` target ends at local profiles.
AI must perform the export and build checks after the batch.
`sync(site_data=True)` calls `make sync` and `make site-data`.
It does not build or deploy the website.
`make sync` builds profiles, writes the status doc, and reseeds the factory. It does not pull reviews.
Use the review queue tools to pull and export remote reviews when needed.

The local finish commands are:

```text
make site-data
npm --prefix frontend run build
```

The export works across eligible local cities, not only the latest batch.
Inspect the changed frontend data files.
Respect the frontend methodology and publication gates.
Report an export, metadata, or build block instead of claiming completion.
Do not run `make ship`, commit, push, or deploy as part of pipeline completion.

The requested retry and error-report workflow is an AI operating rule.
Do not assume that every recovery action is automatic in the backend.
Read the current service implementation before changing recovery behavior.

## State and validation

The database holds requests, attempts, claims, and saved observations.
Output files provide evidence of data readiness.
A done marker or zero exit code alone does not prove valid data.
A terminal batch can contain failed or blocked cities.
Local profiles, frontend copies, and deployed pages are separate states.

Use [llms.txt](llms.txt) to find the relevant service.

## Operating rules

These rules come from experience. They apply to every session.

- **Restart after code changes.** Kill the factory process, reinstall the package, then restart after any change in `src/city_factory/`. The server caches Python modules at import time. Command: `kill $(pgrep -f 'city-factory serve')`, then `uv sync --project pipeline/city-factory`, then start again.
- **Evidence cache uses file signatures.** `city_observations` caches each step verdict by file signature. After a validator change, an unchanged artifact keeps its old verdict. Rerun the step with `--force` to rewrite the file, then refresh.
- **Failed work_status sticks.** A city with `work_status=failed` blocks `run_batch` retry even when all steps are valid. The factory answers "Only a failed or interrupted run can retry." Workaround: run steps with `make city-step` or clear through the batch API.
- **Reviews run only on buildserver.** Run new cities with `target=profiles` on the server factory (`make cs-run`). It runs places, reviews, names, and profiles in one queue. Do not run `target=profiles` on the Mac factory: the Mac does not scrape reviews. The review queue (`make cs-add-places`, `make cs-start`, `make cs-status`, `make cs-pull`, `make cs-stop`, `make cs-export-reviews`) still serves cities whose places the Mac sampled.
- **One review job at a time from the server factory** while the review queue runner works. `CITY_FACTORY_STEP_LIMITS=places=1,reviews=1` enforces it.
- **Gosom concurrency is 2.** Set in `pipeline/settings/pipeline.yaml`. Never use 4.
- **Never discard collected data.** Rename partial outputs to `.partial` instead of deleting. The pipeline deduplicates by stable place id.
- **Commit verified work before concurrent sessions.** A concurrent Codex worker can clean the working tree and lose uncommitted changes.
- **No push, commit, or ship without an explicit ask.** "Approve" or "continue" is not a ship request. Stop at local completion.
- **Fleet is retired (2026-09-15).** No fleet markers, fleet.yaml, or make start/stop/pull/push. Buildserver pulls reviews only through `make cs-*` targets.
- **New country sequence:** cities.csv, scaffold with `add_city.py`, OSM boundaries via MCP, prep_country via MCP, zones and population on the Mac, then `make cs-push-inputs` and `make cs-run` for places, reviews, names, and profiles on buildserver, then `make cs-pull-outputs` and `make sync`.
- **Canonical step names** are in `pipeline/runtime/steps.py`: zones, places, population, reviews, names, profiles.
- **Names lookup cache.** Warm it after new reviews arrive: `uv run pipeline/steps/count_name_origins.py --warm-lookup --reviews-root data`. Batch run: `make names-batch COUNTRY=x`.
- **Factory admin UI is removed (2026-10-18).** Use the MCP tools. For manual actions, call the `/api` routes, for example `POST /api/cities/<country>/<key>/refresh`.
