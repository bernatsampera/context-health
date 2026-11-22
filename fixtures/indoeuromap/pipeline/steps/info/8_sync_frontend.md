# 8. Sync frontend

Validate the saved area profiles and district polygons. Copy accepted aggregate profiles
and map boundaries into the frontend. Step 8 does not calculate area profiles. Step 7
creates them. Write cities-meta.json with the NUTS region of each city. Build the NUTS
and LAU polygons the map needs. Commit and push are separate actions.

## 1. Input

- data/<country>/<city>/area_profiles/*.json: from step 7.
- data/<country>/<city>/raw/districts.geojson: from step 2.
- data/<country>/<city>/run.yaml: center, for the NUTS lookup.
- data/europe/nuts/: NUTS polygons, downloaded on first use.
- data/europe/registry.json: the population of each city.

The shared zone check accepts one valid zone below 400,000 people. A city with
population of 400,000 or more needs two valid zones. The same applies when population
is unknown. A registry value matched by `geonames_id` has priority. A usable
`run.yaml` population is the fallback. `one_zone_ok: true` and
`zones_allowed: single` permit an explicit one-zone exception.
`zones_allowed: multiple` requires two zones. A conflict between these settings
blocks export. The check rejects invalid geometry in all cases. Profiles must also
pass the profile validation check before export.

## 2. Output

- data/europe/cities-meta.json: one entry for each city with the NUTS code and region name.
- frontend/src/data/profiles/<country>/<city>/: the area profiles.
- frontend/src/data/profile-manifest.json: the accepted profile file list and hashes.
- frontend/public/geo/cities/: the district polygons.
- frontend/public/geo/ NUTS and LAU files.
- An event in logs/events.jsonl with the gate staged.

The completed manifest lists the exact copied aggregate profile files. The frontend
reads this list and checks the file hashes at build time. Old files that are not in
the manifest do not enter the website data. They can remain on disk. The frontend
build uses its prepared copy and does not need local pipeline data.

## 3. External services

- GISCO, Eurostat: gisco-services.ec.europa.eu/distribution/v2/nuts and /lau. Downloaded once
  and cached in data/europe/.
- Git: the gate shipped checks origin/master with git ls-tree.

## 4. Variables

| Variable | Location | Value | Effect |
|---|---|---|---|
| regions.default_nuts_level | pipeline.yaml | 2 | NUTS level when the country sets none |
| regions.nuts_level | countries/<c>.yaml | Spain 3, Sweden 3 | NUTS level of the region label |
| regions.overrides | countries/<c>.yaml | Spain: 8 cities | fixed NUTS code when the center is on a border |
| regions.live_base_url | pipeline.yaml | https://indoeuromap.com | base URL of the live site |
| paths.frontend_profiles | pipeline.yaml | frontend/src/data/profiles | target of the profiles |
| paths.frontend_geo | pipeline.yaml | frontend/public/geo/cities | target of the polygons |
| paths.cities_meta | pipeline.yaml | data/europe/cities-meta.json | the meta file |
| zones.single_zone_population_limit | pipeline.yaml | 400000 | one-zone population limit |
| one_zone_ok, zones_allowed | run.yaml | absent | explicit single-zone exception or multiple-zone requirement |
