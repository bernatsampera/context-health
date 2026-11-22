# Home page

URL `/`. Route `frontend/src/pages/index.astro`, content `frontend/src/components/pages/HomePage.tsx`.
The home page is the Europe ranking page. It answers "most multicultural cities in Europe".

## Current state (2026-10-18)

- Title "Multicultural cities in Europe | IndoEuroMap". H1 "How multicultural is your city?".
- Hero, then the city ranking with a country dropdown and group filters, sorted by the non-European share.
- Figures are presented as IndoEuroMap data. The sub-headline is a plain benefit line.

## Decisions

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-09-22 | The Cultural mix sort ranks cities by the displayed non-European share. Old `sort=nonw` links keep working. | One ranking, same as the map. | first-iteration/docs/NOW.md |
| 2026-09-22 | Country buttons became a dropdown on desktop and in the phone Filters panel. | 35 countries did not fit as buttons. | first-iteration/docs/NOW.md |
| 2026-10-06 | The home page is the Europe ranking page. No separate ranking page. | Avoid two pages for one query. | first-iteration/seo/hard-truths-plan.md, task 3 |
| 2026-10-07 | Smaller hero. Plain sub-headline instead of method language. | The ranking must show near the top. | first-iteration/docs/business/tasks/task-04-home-value-line.md |
| 2026-10-11 | Headline "How multicultural is your city?". Figures are IndoEuroMap data, not estimates. | Confident wording on high-volume phrases. | first-iteration/docs/business/public-wording-plan-2026-10-11.md |
| 2026-10-18 | Freeze the title, H1, and intro until the 3 November reading. | Two title changes in one week were never measured. | second-iteration/plan.md |
| 2026-10-18 | The home ranking must show the same value as the city page. The home sum of rounded group values gives one point more for Brussels, Birmingham, Hamburg, and Stockholm. Fix: use the city value. | One number per city everywhere. | second-iteration/outreach/findings.md, point 2 |
| 2026-10-18 | Done: the home ranking value and sort use `cityNonEuropeanShare()`, the value of the city page and the country table. The "#N in {Country}" rank uses shared ranks (1, 1, 3). | Brussels, Birmingham, Hamburg, and Stockholm showed one point more. | C1 follow-up, `index.astro`, `home-cities.json.ts`, `HomePage.tsx` |
| 2026-10-18 | Done: the default share card (`/og/default.png`) shows the Europe value of the `/explore/` summary, not a mean of country values. The explore page is unchanged. | One number for Europe. | C1 follow-up, `og/default.png.ts` |
| 2026-10-18 | The "Across Europe" line on `/explore/` uses the same headline rule as every other level. Other stays in the denominator only. The value stays 16%: Other has 0 retained records at Europe level. The 13% on the old default card was the mean of 35 country values, a different aggregate. The default share card follows the explore line (16%). The documented Europe exception is removed from the methodology page, the map guide, and `/llms.txt`. | One rule for all levels. | C1 follow-up, `rootsModel.ts`, `methodology/index.astro`, `llms.txt.ts` |

## Open

- `/explore/` has the same search intent as the home page. Decide after the 3 November reading.
- The old hero notes are not kept. See the [section list](#decisions) above.

Old note, kept as an example only:

```text
[old hero copy](old-hero-copy.md)
Route list: second-iteration/direction.md
```
