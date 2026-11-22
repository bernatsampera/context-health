# Method and data rules

The method is described in `pipeline/METHOD.md`, next to the code. This file records the decisions.

## Current rule set (2026-10-18)

- Profile rule `raw_mix` in `pipeline/settings/profile-rules.yaml`: hard assignment at 0.55, a name counts at most three times per district, 200 classified records per profile, no official scaling.
- Spain adds the `latam_names` rule. Eleven Balkan countries share one local label group (2026-09-26).
- Classifier cascade: saved LLM labels, then fastText, then Unicode script, then names-dataset. No live LLM call in the names step.
- Small cells of 1 to 4 are pooled into Other when the pool reaches 5. Otherwise they become ambiguous.

## Known faults

- European surnames labelled Middle Eastern (Tallinn shows 3% to 6%). Causes: bad token cache labels, the surname-wins rule ignores a conflicting given name, Israel counts as Middle Eastern in names-dataset, stale score files.
- Estonia's all-East-Asian split came from stale data (fixed by a rerun). Zero African in eight countries came from suppressed leaf cells (fixed in F1). The Africa under-count in the display split is fixed in F2.
- fastText accepts at 0.35 in practice. The configured 0.50 is not passed to the cascade.

## Decisions

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-09-20 | Census anchors are off for all countries. Raw mix everywhere. | Anchors were stale. | first-iteration/docs/NOW.md |
| 2026-09-22 | No census, birthplace, or citizenship data as validation references. | Owner decision. | first-iteration/revision/info.md |
| 2026-09-26 | Shared local group for Albania, Bosnia and Herzegovina, Bulgaria, Croatia, Greece, Kosovo, Montenegro, North Macedonia, Romania, Serbia, Slovenia. | Display definition of local. | first-iteration/revision/local-group-update.md |
| 2026-10-11 | Public copy: figures are IndoEuroMap data, our source of truth. No reviewer, Google, name-roots, or estimate wording. A percentage is a share of retained classified records, not of residents. | The method stays ours. | first-iteration/docs/business/public-wording-plan-2026-10-11.md |
| 2026-10-19 | Public site text does not say that the method uses names (owner ruling). "Name" wording removed from the home page, footer, meta descriptions, methodology, about, data sources, map guide, legend and tooltip, country pages ("Classified records"), city pages ("Categories in <city>"), compare pages, roots H1, llms.txt, and the country method notes. The privacy page keeps its sentence that the private pipeline stores and uses names. | The method stays ours. The privacy notice must state what personal data is processed. | frontend/src (commit of 2026-10-19), second-iteration/outreach/findings.md point 2 |
| 2026-10-18 | Fix the classifier once (package F1). Then run names and profiles for all cities on buildserver. This is data version 2. Live numbers change one time, before the coverage waves ship. | New and old cities must share one classifier. | second-iteration/plan.md |
| 2026-10-18 | No other method research in this iteration. | Direction. | second-iteration/direction.md |
| 2026-10-18 | Classifier version 2 rules (package F1): a non-European surname-position token label that conflicts with another confident token label sends the name to the next tier; 111 token labels unset by the dated patch `token_label_patches/2026-10-18.json`; Israel gives no names-dataset evidence (Palestine also not, in the Israel shadow); fastText uses the configured 0.50 threshold; private leaf counts keep all cells; score files carry `classifier_version: 2`. | Tallinn false Middle Eastern labels, ignored fastText setting, zero African splits. | pipeline/METHOD.md (Data version 2), data/research/classifier-v2/ |
| 2026-10-18 | Middle Eastern and African display groups follow the broad scores of the retained records in each area (package F2). Leaf counts split this parent only when the broad scores give no split. Asia keeps the leaf split. Pooling and integer allocation stay the same. | Leaf counts gave Africa half or less of its broad share (Tallinn v2: 5.9% against 14.1% of the parent). The broad classifier already separates the two regions. | pipeline/METHOD.md (Missing values and subgroup splits; Data version 2), data/research/classifier-v2/africa-split/ |
| 2026-10-18 | Data version 2 batch (package V2): names and profiles reran on buildserver for 731 cities in the 35 published countries (714 with a valid reviews step, plus 17 live cities with finished but incomplete review runs). No city failed. The export has 736 cities and 6,117 profiles. The live numbers change once, when the owner releases this export. | One classifier for all published cities. The September score files were stale (Paris South Asian 0.01%, now 1.70%). | pipeline/METHOD.md (Data version 2), data/research/classifier-v2/batch-2026-10/report.md |

| 2026-10-21 | Hold Valletta, Birkirkara, and Sarajevo from new exports. Do not relabel records without evidence. | Malta has no Maltese taxonomy label. Sarajevo has reviews in only one of 17 areas. Five real profile rebuilds match saved outputs. The suspected Bosniak classification fault is not proven. | data/research/data-quality-2026-10-21/README.md |

## Privacy and limits


- Reviewer records and individual labels stay private under `data/`. The frontend receives aggregates only.
- GDPR Article 9 covers the classification step. Get a lawyer's opinion before any paid sale.
- Coverage score is records per resident compared with Barcelona. It is not accuracy.

## Open

- Implausible small shares: Paris South Asian 0.01%, Madrid South Asian 0.01% in the saved profiles (E1 finding, 2026-10-18). Check after data version 2.
- "haddad" is not in the token cache, so "Karim Haddad" is Western European in both versions. The LLM label cache misses 118,882 tokens. Fill the cache before or during the version 2 batch if time allows.
- The fastText model is weak on common names (david, heli as Persian). A retrain is method research and is out of this iteration.
