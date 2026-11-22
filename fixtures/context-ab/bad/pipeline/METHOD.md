# Method

Checked against executable source and saved aggregate output on 2026-09-26.
This describes the local prepared website data. It does not establish the deployed site's state.

## Meaning and denominators

The map shows labels assigned to reviewer name records at selected Google Maps places.
The reviewed place determines the area. The reviewer's home does not.
Names do not establish ethnicity, nationality, residence, or culture.
Reviewers can include visitors and repeated records.

Area shares use retained classified records after the repeat cap and initial small-cell pooling.
Unknown and ambiguous records do not enter this denominator. Retained Other counts do.
City shares combine published area counts, then divide by their total.
Low-data areas supply no breakdown counts. This is not a mean of district percentages.
Country and region shares combine published counts from covered cities only.
These figures do not measure the resident population.

groups.ts defines the headline and group rows.
copy.ts combines city counts.
cities.ts combines country and region counts.

The headline excludes local, Western, Eastern European, and Other groups.
Anglo labels enter Western. The Middle Eastern display group includes North African labels.
Country codes in profile rows are display keys, not inferred citizenship.
For example, CO represents the Latin American group.
Group shares are rounded to one decimal. Headlines are rounded to whole percentages.
The display can hide a folded group with fewer than five counts.

One rule applies at every level: area, city, region, country, and the Europe overview.
Other stays in the denominator and never enters the headline numerator (changed 2026-10-18).
The enlarged home bars also change visual widths. Their labels retain the actual shares.
The main map uses a non-linear colour scale, with a maximum colour at 30% or more.

## Collection

[run_city.py](steps/run_city.py) controls current city steps.
city_config.py loads city inputs and search categories.
gen_queries.py builds business searches.
sample_places.py assigns and samples places.
budget.py sets the default quotas.
extract_reviews.mjs collects recent reviews.

Saved city plans and run files select cities. There is no universal population sample.
Default planning settings use 100,000 residents, but explicit plans can differ.
Searches include restaurants, grocery shops, hairdressers, and extended business categories.
Discovery results need a usable place ID, coordinates, and at least five reviews.
The sampler removes duplicate and excluded place IDs and places outside the chosen polygons.
It shuffles with seed 42 and cycles through categories.
The default city budget is round(population / 1,000), limited to 150 to 3,000.
The per-area quota is ceil(budget / areas), limited to 20 to 150.
Without population, the saved flat quota applies. Extensions can add more places.
These are targets, not achieved sample sizes.

The review collector requests newest reviews, with a default budget of 60 records (six logical pages of 10).
The local batched adapter can obtain that budget in fewer HTTP requests. It does not change the record selection.
Settings and command options can change this limit.
It saves name, language, review ID, time, and rating with place metadata.
It does not verify residence. It does not select a random set of residents.
The profile loader reads saved top-level review JSON files by their `barri` area field.
It does not rejoin each review to the current place sample.
Only districts in the saved geometry are published.

## Classification: current code and saved output

count_name_origins.py builds private spelling scores.
cascade.py contains the current cascade.
cached_llm_labels.py reads saved model labels.
names_dataset.py converts country ranks to region evidence.
normalize.py defines token and repeat keys.

The wrapper first returns ambiguous for a confident full-name or selected token Other label.
Cache confidence must be at least 0.60.
Otherwise the cascade tries saved LLM labels, fastText, Unicode script, and names-dataset.
The first non-empty result wins. No live LLM call occurs in this name step.
Full-name cache keys preserve case and collapse spaces.
Version 1 (saved output before the 2026-10-18 version 2 batch): the token cache picks the last
confident non-Other token, often the surname. The current code adds the version 2 rules below.
Tokens shorter than three characters are ignored by the cache and fastText tiers.
Dataset tokenization removes one-character words and configured connectors.
Script routing needs 60% of letters in a supported script.
Names-dataset uses inverse country ranks, averages token evidence, takes the largest
country score within each region, and normalizes the resulting region scores.
These scores are not calibrated identity probabilities.
There is no reliable person or residence check in the active wrapper.

Confirmed fastText integration limits in version 1 (fixed in version 2, see below):

- The model exists locally and loads. Its effective acceptance threshold is 0.35.
- The cascade does not pass the configured threshold of 0.50 or model path.
- The model returns leaf categories. The 2026-09-26 conversion fix maps them to host-aware regions at the fastText classifier interface. The profile input loader applies the same conversion to saved scores before counting. Existing region scores remain unchanged. This code change does not itself rewrite saved profiles or prepared website data.
- The score writer labels non-cache, non-script results as dataset. This obscures fastText provenance.
- The six inspected saved score files date from 17 or 18 September. They contain only region keys.
- No new classification run was made. The full effect of the current fastText path remains unverified.

The `evidence_fusion` and `hybrid` implementations are separate methods.
The active wrapper constructs CascadeClassifier directly.
Files under `playground` are not all experiments: `pipeline/profiles.py` imports their active count path.
Training and benchmark scripts remain separate from the normal city job.

## Data version 2 (October 2026)

Package F1 changed the classifier on 2026-10-18. The code is in place.

Version 2 batch (package V2, 2026-10-18, buildserver): the names step and the profiles step ran for
731 cities in the 35 published countries. No city failed. Selection: the reviews step is valid on
the Mac (714 cities), plus 17 live cities whose finished review runs fail the strict file check
(for example Bucharest and Dublin). The frontend export has 736 cities (665 before) and 6,117 profiles.
Cities outside the batch keep version 1 files: the unpublished Cyprus and Denmark cities, and cities
whose reviews still run. A later names run on the server gives them version 2.
Most of the measured change comes from replacing stale version 1 score files (17 and 18 September),
not from the five rules below. Those files predate the 19 September token cache, the working fastText
tier, and the United Kingdom host settings. Paris example: the same 194,344 names give 109,989 clear
names (0.55 or more) in version 1 and 153,278 in version 2. Retained records rise by about a third in
many cities, and the new confident names are mostly European.
Median city change in the non-European headline: -2.0 points (641 cities with data both times).
Evidence: `data/research/classifier-v2/batch-2026-10/` (`report.md`, `compare-tables.md`,
`before-live.json` and `after-live.json` from the committed and the new manifests, server tables
`server/names-times.tsv` and `server/profiles-times.tsv`, and the scripts).
Score files mark the version: `_meta.classifier_version` is 2 in `name_scores.json` and
`origin_group_counts.json`. Version 1 files have no such key.

Rules that changed:

1. Token conflict rule (cached_llm_labels.py).
   The token tier collects confident (0.60 or more) token labels that are not Other, in name order.
   The last of them is usually the surname.
   One region: the last label wins, as in version 1.
   Two or more regions and the last label is Latin America, Middle East, Sub-Saharan Africa, or Asia:
   a conflict. The token tier abstains. The cascade then tries fastText, Unicode script, and names-dataset.
   Two or more regions and the last label is European (local slot, Western Europe, Eastern Europe, Anglo):
   the last label wins, as in version 1.
   Example: "Jari Hartikainen" (Scandinavian given name, Israeli surname label) is a conflict.
   "Amir Hodžić" (Arab given name label, Bosnian surname) keeps the surname label.
   Two rejected variants, measured on the conflict rule alone:
   a conflict on any two regions removed 1,506 Tallinn records from the classified count (this rule: 238);
   a conflict whenever a non-European region takes part moved Bosnian Muslim names out of local
   (Tuzla local share 73.0% to 71.3%; this rule: 73.2%).
   The rule uses the taxonomy region of each label, not the host slot.
2. Token label patches. The loader applies dated files in
   `data/experiments/llm-name-classification/token_label_patches/` in file-name order.
   The action `unset` removes a token label at load time. The cache file stays unchanged.
   `2026-10-18.json` unsets 111 Middle Eastern token labels: 52 other European, 26 Latin American
   or Spanish, 26 Albanian or Bosniak, and 7 Finnic or Baltic tokens.
   Selection: a names-dataset rank rule (European evidence at least 10 times the non-European
   evidence, or a European rank of 200 or better above every non-European rank) gave 321 suspects.
   A manual review kept diaspora and minority spellings of Middle Eastern names, Hebrew and Mizrahi
   names, shared names, and unclear tokens. The Albanian and Bosniak group follows the 2026-09-26
   Balkan local group decision.
   `_meta.token_label_patches` lists the applied files. Buildserver needs the patch folder
   next to `token_labels.json`. Without it the loader prints a warning.
3. Israel routing (names_dataset.py).
   Israel gives no names-dataset region evidence.
   Palestine evidence for a first-name or last-name role is also removed when Israel ranks the
   same role at an equal or better rank. Arabic names keep their other Arab-country ranks.
   The LLM leaf `israeli` stays Middle Eastern: it marks Hebrew name origin.
4. fastText threshold (cascade.py).
   The cascade reads `fasttext_tier` in pipeline.yaml:
   threshold 0.50 on the top leaf probability, model path from the repository root.
   Version 1 accepted at 0.35. The saved benchmark gives 51.9% region accuracy for 0.4 to 0.5
   and 72.4% for 0.5 to 0.6.
   The score tier field now says `fasttext` for these results (version 1 said `dataset`).
5. Private leaf counts keep every cell (count_name_origins.py).
   Version 1 suppressed leaf cells under 5 per area before the subgroup split.
   This set the African subgroup to zero in eight countries.
   Display cells of one to four still go to Other at profile time.

Measured on saved reviews (hard 0.55, cap 3, share of classified records):

| City | Middle Eastern, saved v1 | v1 code, current caches | v2 | Middle Eastern records, saved v1 to v2 |
| --- | ---: | ---: | ---: | ---: |
| Tallinn | 4.58% | 3.84% | 3.68% | 1,541 to 1,477 |
| Berlin | 14.74% | 11.24% | 11.49% | 5,418 to 5,587 |
| Badalona | 2.83% | 2.38% | 2.37% | 318 to 309 |

Most of the change comes from stale version 1 score files (17 and 18 September).
Inside version 2, the conflict rule, the patches, and Israel routing remove Middle Eastern records
(Tallinn 83, 32, and 35 records). The fastText threshold adds some (Tallinn 41, Berlin 158),
because more names reach names-dataset. It also moves names to ambiguous:
Tallinn classified records fall from 41,302 to 40,138.
20 common Middle Eastern control names keep their labels in EE, DE, and ES hosts.
Version 2 code on saved version 1 scores gives no profile change for Zagreb (shared local group host).
The Tallinn display group Middle East rises from 2.3% to 3.7% and Africa falls from 2.8% to 0.1%.
The old Tallinn split came from the country-mode fallback, because no leaf count file existed.
The combined Middle Eastern and African display share falls from 5.1% to 3.8%.

Display split (package F2, 2026-10-18). The Middle Eastern and African display groups now follow
the broad scores of the retained records in each area, not the leaf counts
(see "Missing values and subgroup splits"). The parent total does not change. Asia keeps the leaf split.
Measured with profile dry runs, share of display records in areas with a breakdown:

| City and scores | Middle Eastern, before to after | African, before to after | Broad African share | Areas changed (of areas with a breakdown) |
| --- | ---: | ---: | ---: | ---: |
| Tallinn v2 | 4.04% to 3.68% | 0.21% to 0.61% | 0.61% | 8 of 8 |
| Berlin v2 | 12.04% to 11.50% | 0.37% to 0.93% | 0.93% | 12 of 12 |
| Badalona v2 | 2.55% to 2.35% | 0.09% to 0.36% | 0.36% | 5 of 5 |
| Tallinn v1 | 3.12% to 4.58% | 2.53% to 1.08% | 1.08% | 8 of 8 |
| Berlin v1 | 15.34% to 14.74% | 1.65% to 2.27% | 2.27% | 10 of 12 |
| Badalona v1 | 2.53% to 2.80% | 1.00% to 0.73% | 0.73% | 5 of 5 |

After the fix, each display count is within one record of its broad count.
The combined share can rise a little (at most 0.06 points here): the leaf split made African cells
of one to four, and the display pooled them into Other. Only Middle Eastern, African, and Other change.
The version 1 effect shows that leaf and country-mode splits can err in both directions:
Tallinn v1 used the country-mode fallback and showed too much African.
Evidence: `data/research/classifier-v2/africa-split/` (`compare-tables.md`, `label-check.txt`,
dry-run outputs, and `measure.py`).

Known limits after version 2:

- One confident token label still decides alone when the other tokens have no cache label.
- The fastText model gives high confidence to wrong labels for some common names
  (for example `david` Persian 0.97, `heli` Persian 1.00).
- Equal Asian thirds remain where a city has fewer than 60 Asian leaf observations.

Evidence: `data/research/classifier-v2/` (per-city tables `<city>.json`, rule effects
`ablation-<city>.txt`, control names `control.json`, token audit `token-audit.json` and
`audit_token_labels.py`, subgroup check `split-check.json`, profile dry runs `dry-runs/`).
Candidate outputs: `data/<country>/<city>/name_origins.v2-candidate-2026-10-18/` for Tallinn, Berlin, and Badalona.

## Active profile rules

profile-rules.yaml selects `raw_mix`.
profiles.py is the current profile command called by `run_city.py`.
rules.py counts names and makes profiles.
toolbox.py records profile traces.
display.py builds integer display counts.

`raw_mix` inherits these values from `standard`:

- Largest region score must reach 0.55 for a hard assignment.
- A normalized name counts at most three times per district.
- Normalization folds case and collapses spaces. It does not prove person identity.
- A profile needs 200 classified records.
- A city profile shows the top 10 origin groups.
- A group with fewer than 5 people is hidden.
- Official city-share scaling is off. The factor is 1.0.

Spain selects `latam_names` in its country settings.
latam_reference.py implements this rule.
It uses saved Forebears tables and a names-dataset rank exclusion check.
It requires a frequency ratio of at least 10 against ES, PT, IT, FR, and US.
A missing comparator name uses the lowest frequency in that comparator list.
A name needs 2 to 8 words and complete first-name and surname parses.
Every plausible parse must contain distinct regional evidence.
A competing region score at or above 0.55 prevents the adjustment.
Only an existing local score in an OK record moves to Latin America.
Shared names and unresolved statuses stay unchanged. No population scaling applies.
The reference is incomplete and its thresholds are experimental choices.

Other country changes are host-cache leaves, dataset-country mapping, boundaries, and region assignment.
On 2026-09-26 the owner selected a shared local label group for Albania, Bosnia and Herzegovina,
Bulgaria, Croatia, Greece, Kosovo, Montenegro, North Macedonia, Romania, Serbia, and Slovenia.
The group includes Albanian, Bosnian, Bulgarian, Croatian, Greek, Macedonian, Romanian,
Serbian, Slovenian, German, Dutch, Scandinavian, and British labels. Turkey is excluded.
This is a definition of the displayed local group, not evidence of higher classification accuracy.
The profile loader can apply confident saved detailed labels to existing OK scores.
Unknown and ambiguous entries remain unchanged. Broad scores without a detailed label remain unchanged.
The dataset country-frequency fallback is unchanged.
The pipeline rule and its in-memory preview do not update the prepared or deployed website data.
[Shared local report](../first-iteration/revision/local-group-update.md): Approved rule, preview figures, and blocked inputs.
Several countries share broad cache leaves. Estonia's local leaf is `baltic`.
It does not isolate Estonian names from Latvian and Lithuanian forms.
Some countries have no dataset host mapping. A configured mapping also does not prove lookup coverage.
The Dutch adapter uses CBS districts with municipal overrides for Amsterdam and The Hague.
Most other zone adapters use OpenStreetMap and country-specific level preferences.
Official population-share adapters still exist. They do not scale `raw_mix` profiles.

## Missing values and subgroup splits

small_cell.py pools region counts from one to four.
If their combined pool reaches five, it enters Other.
Otherwise it enters ambiguous under hard assignment (unknown under soft assignment).
Unknown and ambiguous percentages use all post-cap records as their denominator.
They include this suppression effect. They are not classification error rates.

The classified denominator retains source-region counts, including Other.
Region shares are normalized after unknown and ambiguous values are excluded.
mixing_matrix.py merges MENA and sub-Saharan Africa into one parent.
The merge comes from the old calibration fit: the Barcelona official data has one Africa group.
The display splits this parent again by the broad scores of the retained records in the area:
Middle Eastern gets `mena / (mena + subsaharan_africa)`, after small-cell pooling
(`broad_subgroup_split` in display.py).
The leaf split below applies to this parent only when the broad scores give no split:
a score file whose `_meta.regions` lacks one of the two regions, or no records in both.
The publish trace counts the areas of each source in `mena_africa_split`.
subgroup_composition.py splits Asia with leaf counts.
It also makes the fallback split of the Middle East and Africa parent.
An area needs 60 cached leaf observations for a parent-specific local split.
Otherwise it uses a city leaf pool at 60 or more observations.
The next fallback uses country-mode shares. That mode uses names-dataset alone.
Its city pool gives each district equal weight. Some boundary-country codes are excluded.
No evidence produces a uniform split. Saved source flags can identify these fallbacks.
The split is an allocation of the parent total, not an independent count of every subgroup.
Integer allocation uses largest remainders.
Final display cells from one to four are pooled into Other again.

Unknown means no usable saved result. Ambiguous means unresolved or below threshold.
Suppressed means withheld or pooled. Low data means the area lacks 200 classified records.
Current low-data profiles have empty breakdowns.
An omitted or hidden group cannot be interpreted as measured zero.

## Export and coverage

frontend_export_plan.py selects accepted files.
[artifacts.py](artifacts.py) checks saved file shape and profile constraints.
The frontend export uses exact file paths and hashes in its manifest.
The website also filters countries by their publication flag.
These checks do not require a current classifier accuracy score.

data-coverage.ts counts classified records from accepted profiles.
Each area ID counts once. Low-data areas in mapped cities are included.
Coverage is 100 times the place's records per saved resident divided by Barcelona's ratio.
City population comes from saved city metadata.
Country and region scores use full saved 2024 population totals.
Barcelona is 100%. Scores can exceed 100%. Missing inputs hide the score.
Coverage does not measure accuracy, unique reviewers, or the fraction of residents studied.

## Calibration and evaluation

No official scaling appears in the inspected prepared profiles with breakdowns: each reports `raw`.
The old `standard` profile rule and legacy `methods/profiles/build.py` can still apply an anchor.
Their existence does not establish current use.
The old `two-tier name signal` coverage field is stale descriptive metadata.

No evaluation code runs in the active path. On 2026-10-18 the official-data scorer call left `profiles.py`.
That call printed comparison metrics only. It did not change shares or gate publication.
The comparison commands are archived in `first-iteration/pipeline/evaluation/`.
Old MAE and rank metrics compare official population axes with earlier profile rules.
They are not error rates for the current reviewer name measure.

The saved fastText benchmark reports 896 scored names from a 1,000-name reference set.
It reports method agreement at specified settings and excludes ambiguous and non-person labels.
The report itself marks the work as incomplete. Model settings differ from the current wrapper.
Reference independence, representativeness, and correspondence to current exported profiles are unproven.
No site-wide or country error rate is established by this evidence.

Removed unsupported claims include fixed ambiguous rates, a universal Arabic-script rate,
resident-share comparisons, mandatory country validation, and a single collection date or open licence.
Such claims require a defined sample, date, method version, and comparable target.

## Saved evidence and repeatable inspection

Audit script: Read accepted profiles and print aggregate facts only.
Saved output: Manifest hashes, representative counts, score metadata, and profile traces.
Audit report: Scope, verification results, and unresolved issues.

Run from the project root:

```text
uv run --no-sync data/research/methodology/2026-09-26/audit.py
```

| City | Published count denominator | Coverage count | Low-data areas |
| --- | ---: | ---: | ---: |
| Barcelona | 454120 | 454414 | 6 of 73 |
| Berlin | 48598 | 48598 | 0 of 12 |
| Tallinn | 40137 | 40137 | 0 of 8 |
| Utrecht | 46140 | 46140 | 0 of 10 |
| London | 95006 | 95202 | 1 of 33 |
| Bucharest | 23345 | 23345 | 0 of 6 |

These are confirmed saved facts, not population estimates or model accuracy evidence.
The counts come from the data version 2 export (2026-10-18). The same audit, with its output
moved to the batch folder, wrote `data/research/classifier-v2/batch-2026-10/six-city-audit-before.json`
(the committed version 1 export) and `six-city-audit-after.json` (`six_city_audit.py` in that folder).
The 2026-09-26 audit gave Barcelona 401402, Berlin 36763, Tallinn 33669, Utrecht 33229,
London 260 (31 of 32 areas low-data), and Bucharest 18965.
A city headline can depend on very limited area coverage. London had that fault on 2026-09-26.
The coverage count is larger than the published count when a city has low-data profiles,
because the coverage count includes them.

Reviewer records and individual labels remain private under `data/`.
Do not export them into frontend data, documentation, or browser artifacts.
