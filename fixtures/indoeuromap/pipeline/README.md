# Pipeline

The pipeline creates data for the public website.
AI controls approved city batches through the factory backend.
Use [llms.txt](llms.txt) to find source files.
Use [city-factory/README.md](city-factory/README.md) to operate jobs.
Run `make help` for the command targets.

## Main parts

| Part | Purpose | Source |
|---|---|---|
| Country preparation | Country settings, city lists, and shared inputs | `settings/countries/`, `steps/select_cities/` |
| Zone preparation | Country, region, city, and district boundaries | `methods/zones/`, `methods/regions/`, `steps/build_zones.py` |
| City extraction | Sample places, collect reviews, and calculate name-origin signals | `steps/`, `methods/places/`, `methods/name_origins/` |
| Profiles | Build switchable district profiles and compare rule sets | `profiles.py`, `methods/profiles/` |
| Operation | Submit jobs, inspect evidence, track failures, and continue work | `city-factory/`, `runtime/`, `status/` |

Country and region preparation provides shared inputs.
A country setting or boundary file does not prove that every city is ready.
Check the selected city's actual inputs and outputs.

## City steps

The canonical step names are defined in `runtime/steps.py`.

| Step | Main output under `data/<country>/<city>/` |
|---|---|
| `zones` | `raw/districts.geojson` |
| `places` | `places/places_for_reviews.json` |
| `population` | `official/population_share.json` |
| `reviews` | `reviews/*.json` |
| `names` | `name_origins/*.json` |
| `profiles` | `area_profiles/*.json` |

Population reference data does not depend on reviews.
Profiles need the required aggregate signals and population inputs.
Use the evidence checks to determine the next operation.
A marker or a zero exit code alone does not prove valid output.
`artifacts.py` defines canonical files and legacy readers.

## Machines

| Machine | Steps and work |
|---|---|
| Mac | `zones`, `population`, profile rebuild (`make sync`), frontend export, build |
| Buildserver | `places`, `reviews`, `names`, `profiles` in its own city factory, and the review queue |

The Mac pushes code (`make cs-code`) and city inputs (`make cs-push-inputs`), submits batches (`make cs-run`), and pulls outputs back (`make cs-pull-outputs`).
See home_server/README.md for the commands and their rules.
Every step reads and writes the files under `data/` of its machine.
Generated status reports go to `data/europe/city-status.md`.

## Europe-wide city plan

`make europe-plan` (`uv run pipeline/cli.py europe-plan --min-pop 50000`) lists every registry city with 50,000 or more people in the published countries.
It marks each city `live`, `data` (a data folder exists), or `new`, and writes `data/europe/europe-plan.csv` sorted by population.
It leaves out sub-city entries: GeoNames codes other than `PPL`, `PPLA` to `PPLA4`, `PPLC`, and `PPLG`, and entries whose point lies in a zone (`raw/districts.geojson`) of a larger planned or live city.
The left-out entries, with the rule and the containing city, go to `data/europe/europe-plan-dropped.csv`. Live cities in that file stay live until the owner decides.
It does not scaffold or run cities.

## Settings and methods

Shared settings are in `settings/pipeline.yaml`.
Profile switches and thresholds are in `settings/profile-rules.yaml`.
Country settings and plans are in `settings/countries/`.
Read their current values instead of copying thresholds into documentation.

The production cascade uses cached name labels, Unicode script, and names-dataset evidence.
Its implementation is `methods/name_origins/cascade.py`.
Name-origin estimates do not establish a person's ethnicity or culture.
The pipeline aggregates results by polygon.
Small-cell suppression is implemented in `methods/policy/small_cell.py`.
The frontend receives aggregate profiles, not reviewer records or individual labels.

The rule set named by `in_use` in `settings/profile-rules.yaml` controls the normal profile build.
The rule set decides whether census scaling applies. See [METHOD.md](METHOD.md) for details.
Use `uv run pipeline/profiles.py --city country/city --compare --dry-run` to compare all rule sets without writing files.
Preserve the source, date, and population concept.
Birthplace, citizenship, and migration background are different measures.
Do not present them as interchangeable.
Do not treat low-data or unknown results as measured zero.

Alternative methods and old experiments are not proof of production accuracy.
The first-iteration validation, research, and walkthrough code is in `first-iteration/pipeline/`.
Do not copy old accuracy scores into claims about a new country.

## Completion

The factory's `profiles` target produces local profiles.
AI must then check outputs, export frontend data, and run the local website build.
Keep failed cities visible and continue the other cities.
Report the error and its cause, or state that the cause is unknown.

```text
make site-data
npm --prefix frontend run build
```

Export replaces prepared frontend data files.
Inspect the export output and changed files.
Respect the frontend methodology and publication gates.
Stop after the local build passes.
Deployment is separate.

## Local checks

This project has no tests. Prove work with a real run on the data:

```text
uv run pipeline/profiles.py --city germany/berlin --dry-run
make site
```

Do not start extraction, refresh production state, or overwrite city output just to check a code change.
