# Comparison pages

URL `/compare/<a>-vs-<b>/`. Composer `frontend/src/pseo/composers/compare.ts`. 26 pages are live: city pairs in Spain, Germany, and France.

## Current state (2026-10-18)

- Each page has a verdict, a dumbbell chart, top-5 tables, and a share row.
- The dumbbell label is cut at the right edge on desktop (seen 2026-10-07).
- Demand evidence for comparisons is sparse.

## Decisions

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-09-26 | Plan comparisons only where both cities have good coverage. | Avoid thin pages. | first-iteration/seo/07-comparisons/README.md |
| 2026-10-18 | Grow to about 150 pairs in phase 2: same-country big cities and capital pairs. Fix the cut label in the same package. | Modest growth with the demand evidence we have. | second-iteration/plan.md, package C2 |

## Open

- Check search demand for pairs before phase 2. Notes: [comparison demand](compare-demand.md).
