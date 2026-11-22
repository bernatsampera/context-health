# City pages

URL `/<country>/<city>/`. Route `frontend/src/pages/[country]/[slug].astro`, content `frontend/src/components/pages/CityPageV2.tsx`.
This is the best page of the site. It gives the city headline, the district map, the ranked areas, and the vote.

## Current state (2026-10-18)

- Title "How multicultural is {City}? Compare areas".
- Order: question, compact answer, key findings, map, area comparison table, method line, FAQ, related pages.
- Absent groups show "Not enough data", never 0%. Share text has no numbers and no group names.
- Five cities have a sample summary: Berlin, Madrid, Hamburg, Milan, Barcelona.
- Votes ("Does this match what you see?") stay. Sign-in only saves votes.

## Decisions

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-09-26 | Sample summaries with record counts and area links on five cities. | First SEO cycle, pages with the most impressions. | first-iteration/seo/05-city-pages/report-26-09.md |
| 2026-10-06 | Say "N in 10 names". One short method line with a link replaces the repeated disclaimer. | "1 in 4 people" was wrong. The disclaimer hurt every page. | first-iteration/seo/hard-truths-plan.md, task 5 |
| 2026-10-07 | Absent groups show "Not enough data". Share text has no numbers or group names. Method caption inside the map frame. | Trust and reputation. | first-iteration/docs/business/review-2026-10-07.md |
| 2026-10-11 | Answer before the map. Full static comparison table. Map keeps URL state. | Search intent order. | first-iteration/docs/business/search-page-implementation-plan-2026-10-11.md |
| 2026-10-18 | The "Highest in" box must use the same rounding as the ranking table (Hamburg and Rome differ by one point). | One number per area everywhere. | second-iteration/outreach/findings.md, point 5 |
| 2026-10-18 | Done: the "Highest in" box shows the ranking table value for the default selection (all non-European categories). Other selections keep the map value. | Hamburg showed Harburg 30% in the box and 29% in the table. | C1 follow-up, `RootsPanel.tsx`, `CityPageV2.tsx` |
| 2026-10-18 | Share cards for countries, regions, cities, and areas: the place name is the title line. The value line is "{n}% of classified records in non-European categories". The old text "{n}% of {Place} has non-European categories" read as a share of residents. | Percentages are shares of classified records. | C1 follow-up, `og/OgCard.tsx` |
| 2026-10-18 | Share card rank uses the page competition rank (1, 1, 3) and the page total: "Rank 9 of 41 cities in Germany". | Berlin card said #10, the page says rank 9 (shared). | C1 follow-up, `og/[country]/[slug].png.ts`, `og/[country]/[slug]/[area].png.ts` |
| 2026-10-18 | The roots links section line is "Categories by neighbourhood". It replaces reviewer wording. | Public copy rules. | C1, `pages/[country]/[slug].astro` |
| 2026-10-18 | One non-European headline rule at every level (area, city, region, country, Europe): it excludes local, Western, Eastern European, and Other. Other stays in the denominator. The map panel "Across" line, tooltip, map colour, and "Highest in" box use it (`sumSel`, default view). The "Across" line now equals the intro and the ranking tables. | 319 of 641 city pages showed two different city values. | C1 follow-up, `rootsModel.ts`, pipeline/METHOD.md |

## Open

- Browser behaviour of the map URL state was never checked in a real browser.

## See also

- [area.md](area.md): Neighbourhood pages. A city page links to each of its areas.
