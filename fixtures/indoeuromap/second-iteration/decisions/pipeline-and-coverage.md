# Pipeline and coverage

Six steps per city: zones, places, population, reviews, names, profiles. Names are in `pipeline/runtime/steps.py`. Outputs live under `data/<country>/<city>/`.
Operate with the MCP tools `diversity-map-data` and `diversity-map-jobs`. See `pipeline/city-factory/README.md`.

## Machines (2026-10-18)

- Mac: zones, population, `make sync`, export, build. Since B2 it no longer runs places, reviews, names, or profiles for new cities.
- Buildserver: the city factory (places, reviews, names, profiles) in tmux `factory`, and the review queue in tmux `cs`. Ubuntu x86_64, 4 cores, 14 GB RAM, 51 GB free. Git checkout at `/home/owner/diversity-map` (since B2), with uv, Node 22, and gosom. See `pipeline/home_server/README.md`.
- Build and deploy: GitHub Actions builds the image, GHCR stores it, Coolify pulls it. About 30 minutes.

## The Europe-wide city rule

Current target (2026-10-21): up to 50,000 new places across enabled European countries, with no minimum population threshold. The fixed plan is `data/coverage/plan.json`. The following numbers describe the old population-limited plan. Source: `data/europe/registry.json` (GeoNames). `make europe-plan` on 2026-10-18 with the sub-city rule: 35 countries have `published: true` (Cyprus and Denmark do not), 1,251 cities, 634 live, 914 with a data folder, 337 new. The list is `data/europe/europe-plan.csv`. Waves go by population, biggest first, across all countries.
The old per-country lists for Germany and Italy were a sample. They are not a target. Data collected for them stays.

## State (2026-10-18)

- 641 cities live. About 650 have profiles. 85 cities got their reviews exported today and wait for names and profiles.
- Wave 1 on buildserver: 200 cities (Germany 104, Italy 96), 29,064 places, started 07:39 UTC. Plus 14 cities from the old queue.

## Decisions

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-09-15 | Fleet is retired. Buildserver pulls reviews only through `make cs-*`. | One review path. | first-iteration/docs/NOW.md |
| 2026-09-20 | Gosom concurrency is 2. Never 4. | Blocks at 4. | pipeline/settings/pipeline.yaml |
| 2026-09-26 | Never discard collected data. Rename partial outputs to `.partial`. | Data costs days. | pipeline/city-factory/README.md |
| 2026-10-18 | The Europe-wide rule above replaces the per-country plans. | Widest coverage with one rule. | second-iteration/plan.md |
| 2026-10-18 | B2: the factory runs on buildserver for places, reviews, names, and profiles in one queue. The Mac pulls aggregates only. | The laptop must not be the pipeline machine. | second-iteration/plan.md, package B2 |
| 2026-10-18 | Belarus, Kosovo, Turkey, Ukraine: out of this iteration. Istanbul (one zone) and Skopje (Cyrillic file names) stay blocked. | No settings, no methodology entry, known blockers. | second-iteration/status.md |
| 2026-10-18 | B1 pipeline trim: the factory admin UI and its two services, `evaluation/`, `research/`, `show/`, `tests/`, the artifact migration tool, and the unified status script moved to `first-iteration/pipeline/`. The census scorer left `profiles.py`. Status code is one package in `pipeline/status/`. The Makefile went from 59 to 37 targets. Fleet files went to the Trash. | Less code to read and run. Profiles, export plan, and frontend data are unchanged. | data/research/pipeline-trim-2026-10/report.md |
| 2026-10-18 | B2 code delivery: buildserver is a git checkout. The Mac pushes to the bare repository `/home/owner/diversity-map.git` (branch `live`) with `make cs-code`. The checkout is detached at `origin/live`. Sparse checkout leaves `data/` out. The old rsync code copy went to `~/trash/` on the server. | The server has no GitHub credentials. One known commit runs on the server. Data stays out of version control. | data/research/buildserver-factory-2026-10/report.md |
| 2026-10-18 | B2 factory on the server: the city factory runs on buildserver in tmux `factory` with its own `data/factory.db`, 2 workers, and the step limits `places=1,reviews=1`. Places, reviews (direct `extract_reviews.mjs` with the `pipeline.yaml` delays), names, and profiles run there. The Mac keeps zones, population, `make sync`, export, and build. New Mac commands: `cs-code`, `cs-factory`, `cs-push-names`, `cs-push-inputs`, `cs-run`, `cs-jobs`, `cs-pull-outputs`. | The laptop must not be the pipeline machine. One review job from the factory while the queue runner works. | data/research/buildserver-factory-2026-10/report.md |
| 2026-10-18 | B2 Europe plan: `make europe-plan` writes `data/europe/europe-plan.csv` with every registry city of 50,000 or more people in the published countries, marked live, data, or new. It does not scaffold or run cities. | One list for the Europe-wide rule, biggest first. | pipeline/steps/europe_plan.py |
| 2026-10-18 | B2 sub-city rule: the Europe plan keeps only GeoNames codes `PPL`, `PPLA` to `PPLA4`, `PPLC`, and `PPLG` (The Hague), and drops an entry whose point lies in a zone of a larger planned or live city. Result: 1,251 cities (634 live, 914 with data, 337 new). 217 dropped by code (202 PPLX), 119 inside a larger city. 23 live cities are flagged and stay live until the owner decides. Region-wide zone files (Tilburg, UK metropolitan counties) also drop Breda, 's-Hertogenbosch, Bradford, and Bath. | Districts and communes must not count as cities. | data/europe/europe-plan-dropped.csv, data/research/buildserver-factory-2026-10/report.md |
| 2026-10-18 | B2 gosom on buildserver: the server runs the patched gosom build (with `-list-only`) cross-compiled on the Mac from `~/tools/google-maps-scraper`, not the upstream release. | The upstream v1.17.4 release has no `-list-only`. The places top-up uses it. | data/research/buildserver-factory-2026-10/report.md |
| 2026-10-20 | Finish the existing 200-city wave on buildserver through the factory API. Preserve older review folders in each city archive. Keep failed prerequisites visible. Server monitors save batch state every minute. Always inspect live jobs and timestamps before reporting status. | Reviews finished, but the review queue has no automatic names/profile handoff. The saved Sunday status was stale. | data/research/wave-1-finish-2026-10-20/README.md; server tmux wave1-finish and wave1-recovery |
| 2026-10-20 | The owner allows up to 50,000 new cities, spread across countries. Keep the existing minimum population of 50,000. Prepare the 337 new plan candidates across 12 countries on buildserver. Submit one accepted city per country in each round, through profiles. Hold uncertain boundaries and preserve the reason. | Expand coverage beyond Germany and Italy. The limit refers to the number of new cities, not their population. | Owner request; data/research/europe-expansion-2026-10-20/README.md |
| 2026-10-21 | Live check: 191 expansion cities submitted across 11 countries; 112 done, 78 queued, 1 running, no failures. Keep 146 preparation holds visible with evidence and next actions. Register every expansion batch in the normal status command. | Confirm server progress after the interrupted session. Avoid stale status and duplicate submissions. | data/research/europe-expansion-2026-10-20/progress.md |

| 2026-10-21 | Replace the 50,000-person threshold with a fixed 50,000-new-place plan across 35 enabled countries. Include the prior 337 within the cap. Use a persistent feeder with at most 100 outstanding runs. Add a private status page with country totals, city filters, holds, daily completions, and stale-state alerts. Run the factory and feeder as user systemd services. | The owner requested thousands of places and a repeatable overall status check. Both tmux sessions were absent at the live check. | pipeline/home_server/COVERAGE.md; data/coverage/plan.json |

| 2026-10-21 | Show coverage by country, then region, then city. Show one percentage: validated analyses divided by tracked places. Move job states into work details. Keep unmatched regions visible. | The owner asked for clear geographic progress and clickable country details. | pipeline/home_server/COVERAGE.md |

| 2026-10-21 | Prepare a batched review adapter with the same 60-record budget. Keep the installed parser at 3.0.0. Reject malformed or incomplete pagination. Leave production unchanged pending deployment approval. | Reviews are the main extraction cost. A real 20-place command run was 1.52 times faster with identical saved outputs. | data/research/extraction-speed-2026-10-21/README.md |

| 2026-10-21 | Activate the validated batched review collector on buildserver with owner approval. Preserve the original files and allow the current review process to finish. | Apply the measured improvement to new jobs without interrupting existing work. | data/research/extraction-speed-2026-10-21/deployment.json |

| 2026-10-21 | Use two place workers inside one review job, with one shared request timer and breaker. Keep sample size and request spacing. Reject connection reuse after its full run was slower. | Two real comparisons returned identical outputs and improved elapsed time by 1.6 to 1.8 times. | data/research/extraction-speed-2026-10-21/overlap-deployment.json |

| 2026-10-21 | Audit extraction outputs every ten minutes on buildserver. Check file coverage, identity, districts, counts, duplicates, request spacing, and completed profiles. Show failures and stale checks in the dashboard. | The owner requested ongoing checks after speed changes. | pipeline/home_server/COVERAGE.md |

| 2026-10-21 | Hold Tilburg and five UK cities from new exports. Keep repair inputs separate. Add local extent checks and use the configured Dutch CBS source. | Saved zones cover parent regions. Tilburg CBS inputs pass validation. UK cities need complete ward data. Local code is not deployed. | data/research/boundary-quality-2026-10-21/README.md |

## Operating rules


- Restart the factory after any change in `pipeline/city-factory/src/`.
- Evidence is cached by file signature. Rerun a step with `--force` after a validator change.
- A failed `work_status` blocks a `run_batch` retry. Use `make city-step` or clear it through the API.
- Warm the names lookup cache after new reviews arrive.
- Commit verified work before a second session touches the tree.
- The Mac is not needed while a batch runs. A server batch runs in one tmux session with a resume table. The Mac pushes inputs before the batch and pulls outputs after it. No Mac-side waiter, no chaining from the Mac, no `caffeinate` (owner rule, 2026-10-18).
- A long package runs as an agent on buildserver, not on the Mac. `send-to-server` (a remote agent tool) moves the chat and the project there and frees the Mac. `buildserver <command>` runs one command on the server over the shared ssh connection. The pipeline data on the server stays in `/home/owner/diversity-map/data`. The Mac starts work and collects results.

## Open

- Review throughput on buildserver is not measured. Measure cities per day in week 1.
- Coventry and Birkirkara fail the 20-place minimum.
- Europe plan containment rule drops some real cities because a few zone files cover a region, not one city (Tilburg drops Breda and 's-Hertogenbosch; Leeds drops Bradford; Coventry drops Wolverhampton; Manchester drops Bolton; Bristol drops Bath). Fix the zone files or add a keep list before wave 2. List: data/europe/europe-plan-dropped.csv.
- 23 live cities are sub-city places (nine Brussels communes, eight Warsaw districts, Sant Martí, Cergy-Pontoise, Bradford, Petržalka, Tallaght, Stodůlky). They stay live. The owner decides whether to keep them on the site.
- `cs-push-inputs` ends with a full factory seed on the server. The seed scans all 922 cities and takes about 5 minutes per push. Seed only the pushed cities, or seed once per session, before wave 2.
- One rsync transfer hung for 1.5 hours on 2026-10-18 (romania/giurgiu, one small file). Since then every rsync has `--timeout=120`, ssh keepalive, one shared ssh connection, and one retry. Watch for `rsync exited` lines in push logs.
- A new city still needs a push of `run.yaml`, zones, and population from the Mac. B3 makes zones on the server. After B3, make `run.yaml` and population on the server too, so a new city needs no Mac step until the final export.
