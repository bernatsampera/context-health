# Status

Updated: 2026-10-21 (quality and metrics review; server counts from 08:05 UTC). Replace this file. Do not append. Keep it under 60 lines.

## Live

- indoeuromap.com: release 1 of the second iteration, live since 2026-10-18 20:20 UTC (commit 10d40ca4).
  - 713 published cities, 35 countries, 4,973 sitemap URLs (was 641 cities, 4,040 URLs). The export has 733 cities; Cyprus, Denmark, and cities without a published breakdown are not counted.
  - Data version 2 for all published cities. Roots pages, share card and rounding fixes, one headline rule.
  - Wrocław, Łódź, Białystok are held (`pipeline/settings/export-hold.txt`) until the Polish slug fix.
  - 123 old URLs left the sitemap because their areas fell under the data minimum. The pages still exist with noindex.
- Deploy: GitHub Actions builds the image and Coolify pulls it. A push that touches `frontend/**` deploys.

## Running now

- Overall status: `make coverage`, then open http://127.0.0.1:8011. Click country, region, then city. Coverage shows analyzed / tracked places. Terminal: `make coverage-status`.
- At 08:05 UTC: 1,047 validated city analyses, 713 cities in the recorded public release, 98 queued, 2 running, 184 held, 2 failed. Counts change as work runs.
- New fixed plan: 50,000 places across 35 enabled countries. No minimum population threshold. The earlier 337 candidates count within this cap.
- Server feeder has started. First admissions include Pogradec, Dornbirn, Slavonski Brod, and Karvina. Planned does not mean analyzed.
- Factory and feeder use automatic-restart user services: `diversity-map-factory` and `diversity-map-coverage`.
- At 07:11 UTC the factory API and old tmux monitors were absent. Cause is not known. The factory was restored. Two interrupted jobs were requeued after a process check.
- The feeder keeps at most 100 outstanding runs. It holds uncertain boundaries and stops admissions below 5 GB free space.
- Exact plan, cursor, holds, and status: `data/coverage/`. Operation guide: `pipeline/home_server/COVERAGE.md`.
- Review audit runs every ten minutes on buildserver. Run `make coverage-check` for an immediate check. The first audit passed 4 cities, 643 places, and 30,472 review records.
- Read live timestamps before reporting. This file is a dated snapshot. No automatic chat alerts are configured.

## Done

- Faster reviews are active on buildserver: batched responses at 09:51 UTC, then two place workers with one request timer at 10:01 UTC. Two real 20-place runs fell from about 36 s to 23 s and 20 s, with identical outputs. Evidence: `data/research/extraction-speed-2026-10-21/README.md`.

- 2026-10-21 check: the previous Germany and Italy wave finished 200 of 200. Cava de' Tirreni used the normal no-anchor population output and completed.
- 2026-10-19: the public site no longer says that the method uses names (privacy page excepted, by law).

- Phase 0, E1, A1, D2, F1, B1, C1, F2, B2, B2 follow-up, V2. Report: `data/research/classifier-v2/batch-2026-10/report.md`.
- Rsync to buildserver: timeout, keepalive, shared connection, one retry.
- Rules: the Mac is not needed while a batch runs. No `caffeinate`. Long packages run on buildserver (`send-to-server`).

## Next

1. Owner: post TikTok wave 1 by hand. Packages rendered again from data version 2, 16 of 16 pass. First post Fri 2026-10-23 19:00 Madrid (Berlin). Oslo replaces Budapest in slot 9.
2. Search Console reading saved on 21 October: 102 clicks, 9,620 impressions for 20 September to 19 October. Umami: 310 visits across all hosts; 247 on the public host. Next reading: 3 November.
3. Let the server feed the fixed Europe plan. Pull validated aggregates and review the export. Deployment needs owner approval.
4. Review held candidates in the dashboard. Keep uncertain boundaries and duplicate profile IDs out of collection.

## Blocked or open

- Slugs drop the Polish "ł" (live Płock, Wałbrzych, Włocławek, Białołęka, Praga-Południe, Małopolskie, area slugs). Fix with 301 redirects after 3 November, then publish the three held cities.
- Malta: no Maltese taxonomy label. Only the final dataset tier assigns local. Valletta and Birkirkara now have local export holds. A validated reference is needed for correction.
- Sarajevo: only one of 17 areas has reviews. The suspected Bosniak label error is not proven. Local export hold added. Check coverage and labels before any Balkan post.
- Boundary review: Tilburg and five UK cities have local export holds. Tilburg CBS repair inputs are separate from saved profiles. UK cities need complete ward data. Local prevention changes await deployment. Other zone concerns include Magdeburg and Targu Mures.
- 23 live sub-city places (Brussels communes, Warsaw districts, others): owner decides.
- Cyprus and Denmark have data but are not published. They keep version 1 scores. Decide.
- Belarus, Kosovo, Turkey, Ukraine: out of this iteration. Istanbul and Skopje stay blocked.
- Coventry and Birkirkara: under the 20-place minimum.
