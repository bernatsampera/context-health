# 7. Build profiles

Make the area profile that the frontend shows for each district. Step 7 creates
`data/<country>/<city>/area_profiles/*.json`. The step merges the nine
regions to eight. It calculates one scale factor for the city: official share divided by the
mean raw foreign share. It applies the factor to each foreign region. Local is the rest.
A district with too few classified names gets a low-data flag and no breakdown. Asia and
MENA-Africa split into display subgroups. The profiles step file is build_profiles.py
in run_city.py. The logic is in methods/profiles/build.py.

## 1. Input

- name_origins/name_scores.json: private per-name region scores from step 6.
- name_origins/region_shares.json and name_origins/origin_group_shares.json: from step 6.
  Step 6 also writes country_shares.json and origin_group_counts.json.
- official/population_share.json: from the population step. The artifact reader also
  accepts the older official/anchor.json path. Without an anchor the step stops,
  unless the run explicitly uses --no-population.
- reviews/: for the count of names for each district.
- raw/districts.geojson: the district list.
- run.yaml: the city name and key.

## 2. Output

- data/<country>/<city>/area_profiles/<area>.json: one file for each district. Shares for each display group,
  the low-data flag, the counts and the source of the anchor.
- data/<country>/<city>/logs/profiles.log and logs/profiles.done after a successful run.
  A marker alone does not prove that current output is complete. Check the profiles
  against the saved district IDs.

## 3. External services

- None.

## 4. Variables

| Variable | Location | Value | Effect |
|---|---|---|---|
| profiles.min_classified_names | pipeline.yaml | 200 | a district under this gets the low-data flag |
| profiles.calibration_method | pipeline.yaml | raw+city-anchor | the scale rule |
| profiles.display_groups | pipeline.yaml | 11 groups | the groups the frontend shows |
| profiles.uniform_subgroups | pipeline.yaml | asia 1/3 each, mena_africa 1/2 each | split when step 6 has no measured composition |
| policy.small_cell | pipeline.yaml | 5 | cells under this count pool into other |
| --no-population | pipeline/cli.py flag, make sync POPULATION=off | off | builds without the official share |
| --force | make profiles FORCE=1 | off | rebuilds existing profiles |

## 5. Run

Preview the profiles for one city without a write:

```
uv run pipeline/profiles.py --city estonia/tallinn --dry-run
```

Other targets: `--country estonia` or `--all`. Add `--compare` for the before and after
report. Add `--rules <name>` to switch the profile rules.
Add `--trace` to print the four playground helper steps.
