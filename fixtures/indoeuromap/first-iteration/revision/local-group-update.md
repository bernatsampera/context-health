# Shared local group update

Date: 2026-09-26.
State: Implemented in the pipeline. The figures below are an in-memory preview.
Saved profiles, prepared frontend data, and deployed data have not been replaced.

## Approved rule

Hosts: Albania, Bosnia and Herzegovina, Bulgaria, Croatia, Greece, Kosovo, Montenegro, North Macedonia, Romania, Serbia, and Slovenia. Turkey is excluded.

Local labels: Albanian, Bosnian, Bulgarian, Croatian, Greek, Macedonian, Romanian, Serbian, Slovenian, German, Dutch, Scandinavian, and British.
The existing taxonomy has no separate Montenegrin or Kosovar leaf. Their available Serbian and Albanian labels are included.
This is the owner-selected meaning of local. It is not a measured increase in classification accuracy.

## Implementation

- Country settings define the same local label set for all 11 hosts.
- Future cached LLM labels and fastText leaf scores use that set.
- The profile loader converts existing leaf scores before counting.
- For existing broad scores, a confident saved detailed label can move an OK entry to local.
- Unknown and ambiguous saved entries keep their status. A confident Other label blocks this move.
- A broad European score without detailed evidence stays unchanged.
- The country-frequency fallback is unchanged. It cannot identify every member of the shared local group from an already merged region score.

No census, migration, birthplace, or citizenship data was used.

## Country preview

Both sides use the same saved review records for each compared city. The old side uses the pre-fix counter. The new side includes the conversion fix and the shared local rule. This comparison does not isolate the two changes.

| Country | Cities compared | Blocked previews | Local before | Local after | Count before | Count after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Albania | 3 | 0 | 37.01% | 50.99% | 15,093 | 17,536 |
| Bosnia and Herzegovina | 2 | 1 | 14.89% | 81.33% | 6,414 | 7,584 |
| Bulgaria | 13 | 4 | 36.51% | 47.17% | 51,922 | 54,501 |
| Croatia | 7 | 0 | 27.22% | 75.32% | 130,095 | 141,593 |
| Greece | 35 | 6 | 43.06% | 48.33% | 207,745 | 210,003 |
| Kosovo | 0 | 0 | unknown | unknown | 0 | 0 |
| Montenegro | 2 | 0 | 38.89% | 59.35% | 7,950 | 8,088 |
| North Macedonia | 3 | 0 | 20.71% | 68.73% | 9,748 | 13,223 |
| Romania | 41 | 0 | 61.65% | 70.24% | 177,293 | 181,681 |
| Serbia | 1 | 3 | 0.38% | 82.61% | 5,463 | 5,623 |
| Slovenia | 2 | 0 | 19.30% | 72.14% | 5,016 | 5,046 |

The comparison uses only cities that completed both calculations. Bulgaria, Greece, and Serbia are partial previews. Bosnia has no scores for Sarajevo. Kosovo has no saved score inputs.
Counts can rise because more names pass the region threshold or more areas reach the 200-name minimum. These counts are name contributions, not unique people.

## Blocked inputs

These are existing input or area-ID problems. They were not repaired in this rule change.

| City | Failed step | Evidence and cause | Next action |
| --- | --- | --- | --- |
| bosnia-and-herzegovina/sarajevo | Profile preview | No saved name scores are available for profiles. Input: `data/bosnia-and-herzegovina/sarajevo/name_origins/name_scores.json` | Complete saved name scores. |
| bulgaria/plovdiv | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/bulgaria/plovdiv/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| bulgaria/sofia | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/bulgaria/sofia/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| bulgaria/stara-zagora | Profile preview | No saved name scores are available for profiles. Input: `data/bulgaria/stara-zagora/name_origins/name_scores.json` | Complete saved name scores. |
| bulgaria/varna | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/bulgaria/varna/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| greece/chalkida | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/greece/chalkida/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| greece/irakleion | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/greece/irakleion/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| greece/kalamata | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/greece/kalamata/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| greece/lamia | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/greece/lamia/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| greece/rhodes | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/greece/rhodes/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| greece/serres | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/greece/serres/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| serbia/belgrade | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/serbia/belgrade/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| serbia/nis | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/serbia/nis/raw/districts.geojson` | Make area IDs distinct before writing profiles. |
| serbia/subotica | Profile preview | Duplicate profile IDs in saved geometry. Input: `data/serbia/subotica/raw/districts.geojson` | Make area IDs distinct before writing profiles. |

Duplicate IDs occur when area names produce the same ASCII profile ID. Missing score payloads prevent profile input loading.
No batch was submitted. No profiles were written. No export, build, commit, or deployment ran.

## Verification

All 13 labels were found in the saved full-name or token caches. All 143 label-host checks mapped them to local. Turkey kept its existing routing.
The country previews completed for 109 cities. 14 city previews remain blocked.
No test files or test suites were used. Verification used saved labels, scores, and review records.

## Evidence

- Preview results: Country counts, routing counts, and blocked inputs.
- Routing checks: All approved label-host pairs and the Turkey exclusion.
- Repeat script: Recompute the comparison from saved inputs without writing profiles.
- Saved baseline counter: Exact pre-fix counting source used in this comparison.
- Country overview: Earlier saved-profile snapshot, kept separate from this preview.
