# SEO hard-truths plan (2026-10-06)

Branch: `seo/hard-truths`. Worktree: `../diversity-map-seo-truths`.
Baseline data: `data/seo/search-analysis/2026-10-06/` (main repo, not committed).
Owner drives. Each task gets an analysis, then owner approval, then work.

## Facts at the start

- Impressions fell from about 550-750/day to about 250/day on 23-25 Sep, before the 26 Sep deploy.
- Last 10 days: 31 clicks, 2,480 impressions, position 12.3.
- Live sitemap: 4,079 URLs. 3,002 are neighbourhood pages (depth 3). GSC sitemap report: 0 indexed (spot checks say indexed).
- Titles target "reviewer name shares", a phrase nobody searches.
- Most impressions come from place-name queries at positions 40-98.
- The roots group pages (`/<country>/<city>/roots/<group>/`) got clicks, but only 1 is in the sitemap.

## Tasks

| # | Task | Problem | Output | Status |
|---|------|---------|--------|--------|
| 1 | Target queries | Pages target phrases with no demand | Map of real queries to page types (from GSC data and Google autocomplete, no invented volumes) | done |
| 2 | Head page rewrite | Titles, H1 and intro do not answer the query | New title, H1 and first paragraph templates for home, country and city pages | done |
| 3 | Europe ranking page | No page for "most diverse cities in Europe/Germany/..." | Decide: improve home/country pages, or add ranking pages | done |
| 4 | Thin page index policy | 3,002 neighbourhood pages with about 370 words, mostly repeated disclaimer | Rule for which pages are `noindex` and leave the sitemap | done |
| 5 | Copy credibility | "29% ... about 1 in 4 people" error; disclaimer repeated on every page | Fix the 1-in-N math; replace the repeated disclaimer with one line and a method link | done |
| 6 | Roots group pages | Claim was wrong: all 86 roots pages are in the sitemap (first check counted lines in one-line XML) | No change | dropped |
| 7 | Authority and links | New domain, sensitive topic, probably no links | Outreach list and pitch (press, data communities); no code | plan ready, owner sends |
| 8 | Measurement | Small counts, easy to misread | Recheck date (about 20 Oct and 3 Nov) with fixed comparison periods | rules ready |

## Order

5 (quick, clear error) -> 1 -> 2 -> 3 -> 4 -> 6 -> 7 -> 8.
Code tasks go to Codex after approval. No tests. Prove each task with a real build and live-page check.

## Task 1 result: target queries

Source: GSC query+page rows, 2026-09-01 to 2026-10-06 (1,401 rows), and Google autocomplete (gl=gb).
GSC hides most queries: visible queries carry 9 clicks out of about 130 total.

| Intent | Queries | Impressions | Clicks | Avg position |
|---|---|---|---|---|
| Place name only ("gentbrugge", "kesklinna linnaosa") | 1,120 | 3,192 | 5 | 19.4 |
| District/arrondissement name | 176 | 574 | 1 | 19.7 |
| Diversity, demographics, groups | 70 | 211 | 2 | 20.9 |
| Map | 15 | 21 | 0 | 29.1 |

Real demand that matches the product:

- Ranking: "most diverse cities in germany/europe/france/spain", "most diverse city in X". Position 5-21. This is the only family that got clicks at a good position.
- City question: "how diverse is amsterdam", "is madrid/barcelona/vienna diverse", "vienna multicultural", "frankfurt diversity".
- City + group: "arabs in marseille", "how many arabs live in marseille", "indian population in barcelona", "dusseldorf asian population". This matches the roots group pages (Task 6).
- Demographics: "lille demographics", "strasbourg ethnic composition", autocomplete "berlin demographics by race / ethnicity / nationality". People expect census numbers here.

Not our demand: "X population" (total head count, positions 45-89), bare place names. These impressions do not convert and should not drive decisions.

Decision needed: which words the titles use (see Task 2).

## Task 3, 4, 6 findings (Claude decisions)

Task 3. Home and country pages become the ranking pages (Task 2 titles). Gap: the country page's numbered city list is sorted by city size, not by diversity, and the "Highest in" box mixes regions (Arnsberg) with cities. Decision: sort the numbered list by non-European share, head it "Most diverse cities in {Country}", and keep only cities in "Highest in". No new pages.

Task 4. Visible GSC rows, 1 Sep-6 Oct: area pages 7 clicks / 3,920 impressions (554 pages); city pages 0 / 270; country 1 / 51. Area pages carry 90% of impressions at a 0.16% click rate, almost all from bare place-name queries.
Built: 4,914 area pages, 1,912 already noindex (low data or under 5 groups), about 3,000 indexed.
Classified names per area: median 663; 3,986 of 5,518 have 300 or more.
Decision: also noindex areas with fewer than 300 classified names (a share of 30% then has a margin near +/-5 points). No mass noindex: these pages are the only ones Google shows now, and a sudden cut of 3,000 URLs has more risk than gain before tasks 2 and 3 are measured.

Task 6. Dropped, see table.

## Task 8: measurement rules

- Release date of this branch = day zero. Record it in this file when it goes live.
- Script: `data/seo/search-analysis/2026-10-06/gsc.py` (main repo). Run it through the `run_adhoc_script` agent tool.
- Checks: day zero + 14 days and day zero + 28 days. Compare with the 14 days before day zero, same filters (web, all countries, all devices).
- Watch in this order: (1) clicks and impressions for "most diverse cities in ..." and "how diverse is ..." queries, (2) country and city page impressions (they were 51 and 270), (3) total clicks. Area-page impressions are expected to fall a little; that is not a failure.
- Below 30 clicks in a period, report counts only, no rates.
- Referring domains from the GSC Links report at each check (Task 7).

Result: sitemap 4,079 -> 4,038 URLs; area noindex 1,912 -> 1,953. Most thin areas were already excluded.

Day zero: 2026-10-06. Commit 851e461a live at 14:55 UTC (Coolify app000000000000000000000). Checks due 2026-10-20 and 2026-11-03.
