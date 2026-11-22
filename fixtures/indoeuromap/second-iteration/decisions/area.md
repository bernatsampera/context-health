# Neighbourhood pages

URL `/<country>/<city>/<area>/`. Route and content `frontend/src/pages/[country]/[slug]/[area].astro`.
About 4,900 pages are built. About 2,960 are in the sitemap. The rest are `noindex`.

## Current state (2026-10-18)

- Index rule: `noindex` when the area is low data, has fewer than 5 groups, or has fewer than 300 classified names.
- These pages carry about 90% of all impressions, from bare place-name queries, at a 0.16% click rate.
- A one-zone city shows its polygon as plain text, with no self-link.

## Decisions

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-10-03 | No self-link from a one-zone city to an area page. | The route builder skips that page. | first-iteration/docs/NOW.md |
| 2026-10-06 | Add `noindex` for areas under 300 classified names. No mass `noindex`. | A 30% share then has a margin near 5 points. A sudden cut of 3,000 URLs is a risk. | first-iteration/seo/hard-truths-plan.md, task 4 |
| 2026-10-18 | Keep the index rule as it is for the whole iteration. | These pages are the only ones search engines show today. | second-iteration/plan.md |

## Open

- Few next steps to nearby areas on the page. Decide after traffic data exists.

## See also

- [city.md](city.md): City pages. Each area page links back to its city.
