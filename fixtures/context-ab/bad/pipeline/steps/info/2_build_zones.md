# 2. Build zones

Make the district polygons of one city. The step reads OSM administrative
boundaries from a local extract in data/europe/osm/. The extract comes from Geofabrik, through
make osm-extract COUNTRY=x.
The step tries each admin level in the ladder of the country. It clips the boundaries to
the city. It keeps the first level that gives a zone count in the accepted range. The
Netherlands uses CBS wijken. Amsterdam and The Hague use stadsdelen.

## Flow

The step runs these phases in this order. No network call. The step takes about one second.

1. Read run.yaml. Get the city key, the center point and the population.
2. Read settings/countries/<country>.yaml. Get the ladder (zones.admin_levels) and the
   boundary level. When the country file has no ladder, use the default ladder [9, 10].
3. Load the local OSM extract data/europe/osm/<country>-boundaries.geojson.
4. Find the city boundary. Take the polygon at the boundary level that covers the center point.
5. For each level in the ladder, count the polygons at that level inside the city boundary.
   Reject a level with fewer than 2 or more than 35 zones. Accept the other levels.
6. Compute the zone target: population / 60000, clamped to 3..20. Choose the accepted level
   with the zone count nearest to the target. When the population is unset, choose the first
   accepted level.
7. When no level is accepted, write the city boundary as one zone. This is the fallback.
   The shared zone check decides if this one-zone result can proceed.
8. Write raw/districts.geojson with admin_level_used and source osm.

## Log

Each line of the terminal output belongs to one phase.

```
STEP 2 zones  city=amadora country=portugal
INPUT  run.yaml   214 B
INPUT  data/europe/osm/portugal-boundaries.geojson   51.6 MB
SETTING min_count=2  max_count=35  target_per_people=60000  target_min=3  target_max=20  default_admin_levels=[9, 10]
COUNTRY source=osm  admin_levels=[8]  boundary_level=7
BOUNDARY level 7 name=Amadora osm_id=5400888
LADDER levels [8]: keep a level with 2 to 35 zones
  level 8: 16 polygons near Amadora, 6 inside, 10 outside
  level 8: 6 zones, accept
TARGET population 178858 / 60000 = 2.98, clamped to 3..20 = 3
CHOICE level 8 with 6 zones is nearest to the target 3
ZONES 6: Alfragide, Encosta do Sol, Falagueira-Venda Nova, Mina de Água, Venteira, Águas Livres
WROTE .../data/portugal/amadora/raw/districts.geojson
OUTPUT districts.geojson   88 KB   6 features
DONE   zones  1.0 s
```

| Line | Meaning |
|---|---|
| INPUT | the files the step reads, with size |
| SETTING | the values from pipeline.yaml zones block |
| COUNTRY | the values from settings/countries/<country>.yaml |
| BOUNDARY | the city polygon used for the clip |
| LADDER, level | one line for each level: polygons near the city, inside, outside, then the verdict |
| TARGET | the zone target from the population |
| CHOICE | the level that won and why |
| FALLBACK | shown only when no level was accepted; the city becomes one zone |
| ZONES | the names of the zones |
| OUTPUT, DONE | the file written, its size, feature count and the run time |

Rerun the step with `make city-step CITY=<key> STEP=zones FORCE=1`. The old file is kept
as districts.geojson.bak-<date>. A hand-made file (no admin_level_used) is never replaced.

## 1. Input

- data/<country>/<city>/run.yaml: center, population, key.
- data/europe/osm/<country>-boundaries.geojson: the local boundary extract. 27 countries have
  one, Spain and Sweden included. On first use, the zones step downloads the Geofabrik extract
  and builds this file. Run make osm-extract COUNTRY=x for a forced refresh.
- settings/countries/<country>.yaml: zones.source, zones.admin_levels, zones.boundary_level.

## 2. Output

- data/<country>/<city>/raw/districts.geojson: one polygon for each district, with name and
  admin_level.

## 3. External services

- Geofabrik: download.geofabrik.de/europe/<country>-latest.osm.pbf. Only make osm-extract
  calls it. The zones step reads the local result.
- PDOK CBS wijken WFS: service.pdok.nl/cbs/wijkenbuurten. Netherlands only.
- Amsterdam open data: api.data.amsterdam.nl/v1/gebieden/stadsdelen. Amsterdam only.
- Den Haag open data: den-haag-opendata.opendatasoft.com. The Hague only.

## 4. Variables

| Variable | Location | Value | Effect |
|---|---|---|---|
| zones.min_count | pipeline.yaml | 2 | a level with fewer zones is rejected |
| zones.max_count | pipeline.yaml | 35 | a level with more zones is rejected |
| zones.target_per_people | pipeline.yaml | 60000 | one zone for each 60,000 people, used by budget.py |
| zones.target_min, target_max | pipeline.yaml | 3, 20 | limits of the zone target |
| zones.default_admin_levels | pipeline.yaml | [9, 10] | ladder when the country has none |
| zones.source | countries/<c>.yaml | osm, cbs_wijken or stadsdelen | which method runs |
| zones.admin_levels | countries/<c>.yaml | Spain [9, 10], Sweden [9, 10] | ladder of admin levels |
| zones.boundary_level | countries/<c>.yaml | null | admin level of the city boundary for the clip |
| zones.single_zone_population_limit | pipeline.yaml | 400000 | population must be below this value for one zone without an exception |
| one_zone_ok, zones_allowed | run.yaml | absent | explicit single-zone exception or multiple-zone requirement |
| --source | build_zones.py flag | osm | always uses local OSM extract |
| REFRESH=1 | make osm-extract | off | downloads the Geofabrik file again |
| --force | make zones FORCE=1 | off | rebuilds an existing districts file |

## Zone acceptance

The shared check accepts one valid zone when the city population is positive and below
400,000. It requires at least two valid zones at 400,000 or more. Unknown or invalid
population also requires two. Missing or invalid geometry always blocks the city.
The check first uses a usable registry population matched by `geonames_id`. It uses
`run.yaml` population only when that registry value is not usable. It records the
selected source. It does not treat an unknown population as zero.

`one_zone_ok: true` or `zones_allowed: single` in `run.yaml` permits one valid zone as
an explicit exception. `zones_allowed: multiple` requires at least two valid zones,
even for a small city. A single-zone exception and `zones_allowed: multiple` together
are a configuration error. The population rule is a check on the saved geometry. It
does not change how the zone builder chooses polygons.
