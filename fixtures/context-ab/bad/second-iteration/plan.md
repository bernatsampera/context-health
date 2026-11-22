# Plan: second iteration

Approved by the owner on 2026-10-18. Window: 18 October to 13 December 2026.
Numbers go to [metrics.md](metrics.md). The current state is in [status.md](status.md). Keep it under 80 lines.

## Rules for all work

- Every change on the site gets a row in its file under [decisions/](decisions/).
- No tests. A real run proves each package. The proof is written in the package.
- Agents are Opus 5.5 subagents in separate worktrees. Claude Fable reviews every diff and merges.
- Commit after each verified package. No push and no deploy without the owner's word.
- URLs, titles, H1, and intros are frozen until the 3 November reading.
- Never discard collected data. Move files to the Trash or to `first-iteration/`. Never delete.

## Phase 0: clean start (18 October, done)

| Step | Result |
|---|---|
| Commit and clean git | 16 branches, 2 worktrees, 3 stashes removed. One branch: master. |
| Archive | docs, seo, revision, experiments, archive, context, product, wireframes, design handoffs, and batch logs moved to `first-iteration/`. gcontext, superpowers, and caches moved to the Trash. |
| New entry files | `second-iteration/` with direction, plan, metrics, status, and decisions. Short AGENTS.md and llms.txt. |
| Coverage start | Reviews for 85 cities exported from buildserver. Wave 1 of 200 cities queued and running on buildserver. |

## Phase 1: parallel packages (weeks 1 to 3)

| Package | Work | Proof | Files |
|---|---|---|---|
| A1 Frontend trim | Remove tests, screenshots, old notes, and unused components. Drop the `test` script. | Build gives the same page count. Ten sample pages have identical HTML before and after. | `frontend/` only |
| B1 Pipeline trim | Remove the admin UI, the shell script, migration scripts, fleet files, tests, and research code (`research/`, `evaluation/`, `show/`, training scripts). Cut the Makefile to about 15 targets. Move removed code to `first-iteration/pipeline/`. | Profiles dry run on Berlin. Names run on one city. Export plan. `make site-data`. | `pipeline/`, `Makefile`. Not `pipeline/methods/name_origins/` except training folders. |
| F1 Classifier fix | Conflict rule between given name and surname. Token cache audit. Israel routing. Pass the configured fastText threshold. Data version 2 note in METHOD.md. | Names rerun on Tallinn, Berlin, Barcelona. Middle Eastern share in Tallinn drops without touching known Middle Eastern names. Before and after tables saved under `data/research/classifier-v2/`. | `pipeline/methods/name_origins/`, `pipeline/METHOD.md` |
| C1 Roots group pages | Build `/roots/<group>/` pages for every city and group that passes the gate: 300 or more classified names in the city, group share of 3% or more, 3 or more areas with the group. Wave 1: cities above 200,000 people. Page: one answer line, a ranked area table, the map, one method line. | Build passes. Sitemap count. Ten sample pages checked. No page below the gate. | `frontend/src/pseo/`, `frontend/src/pages/[...pseo].astro` |
| D2 Authority | Five citable findings with stable URLs and share images. One Show HN draft. Two Reddit drafts. Ten messages for data desks in Germany, Spain, France, and the Netherlands. | Every figure checked against the live page. Drafts in `second-iteration/outreach/`. | `second-iteration/outreach/` |
| E1 TikTok packages | Sixteen packages for the biggest cities, light theme, cover 3b, group 4a. Remove the "1 / 10" pill on the cover. Caption rule applied. | Sixteen folders under `data/social/tiktok/wave-1/` with preview pages. Image hashes recorded. | `social/tiktok/` |
| D1 Measurement | Fill metrics.md on 20 October. | The row exists with the same filters as the baseline. | `second-iteration/metrics.md` |

Order inside the phase: A1, B1, F1, C1, D2, E1 start together. B2 starts when B1 and F1 are merged.

## Phase 1b: buildserver runs the pipeline (weeks 2 to 3)

| Package | Work | Proof |
|---|---|---|
| B2 Factory on buildserver | Install the factory service on buildserver. Places, reviews, names, and profiles run there in one queue. The Mac pulls aggregates only, then exports, builds, and ships. One command adds cities from the Europe-wide rule: `make city-add COUNTRY=x` or a city list. | Five German cities end to end: queue on buildserver, aggregates pulled, export, local build. Cities per day measured and written in status.md. |
| V2 Data version 2 | Run names and profiles for all cities on buildserver with the fixed classifier. Export. Build. | Profile manifest changes once. Country totals before and after saved under `data/research/classifier-v2/`. Owner approves the release. |

## Phase 2: coverage and growth (weeks 4 to 8)

- Queue all cities from the Europe-wide rule, biggest first. Ship coverage in waves after each export and build. The owner approves each release.
- C2: comparison pages grow from 26 to about 150 pairs. Fix the cut label.
- C1 wave 2: roots pages for cities between 50,000 and 200,000 people, if wave 1 gets impressions.
- The owner sends the outreach and posts two TikToks per week.
- Readings on 3 November and 13 December. A short retrospective in `second-iteration/retro.md` on 13 December.

## Decisions made by Claude

- The 3,000 neighbourhood pages stay indexed as they are. They carry 90% of impressions.
- Belarus, Kosovo, Turkey, and Ukraine stay out. They have no country settings and no methodology entry.
- The self-hosted vote service stays untouched.
- The Germany and Italy city data from the first-iteration sample stays and enters the queue, because the cities pass the 50,000 rule.
