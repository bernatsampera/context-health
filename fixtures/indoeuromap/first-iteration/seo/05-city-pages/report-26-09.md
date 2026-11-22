# City page handoff, 26 September 2026

## Changes

Added CitySampleSummary.astro to the shared city route.
The component adds a static summary to five selected cities.
It reads prepared aggregates during the build.
It states the record total and available area breakdowns.
It links to three areas with the largest published record counts.
It explains sample limits and links to the guide and method.
It adds no client-side hydration.

| City | Published records | Areas with breakdown / mapped areas |
| --- | ---: | ---: |
| Berlin | 36,763 | 12 / 12 |
| Madrid | 140,043 | 21 / 21 |
| Hamburg | 20,056 | 6 / 7 |
| Milan | 64,641 | 9 / 9 |
| Barcelona | 401,402 | 67 / 73 |

These counts are dated saved results, not unique residents.
Bergedorf had no published breakdown.
Six Barcelona areas had no published breakdown.
A larger sample does not establish higher classification accuracy.

## Checks

All five summaries appeared in the initial HTML.
Their counts and coverage matched the independent aggregate report.
Their canonical URLs matched the intended city URLs.
All 25 summary links returned HTTP 200.
Fifteen layout checks passed at widths of 320, 390, and 1440 pixels.
Each page had one H1 and a focusable first area link.
No overflow or clipped summary links were found.
Ten screenshots were saved.
Berlin phone and Barcelona desktop screenshots received visual review.

The first preview on port 4338 returned old HTML.
A fresh preview on port 4339 returned the new summaries.
Later work changed the method link to /methodology/.
Recheck links against the next build.

## Repeat

Use a fresh build and preview as described in the technical handoff.
Copy review.mjs into data/seo/city-pages/YYYY-MM-DD/.
The script needs the existing Indem automation browser on port 9222.
Use the browser connection notes to start that profile if required.
The script opens its own tab and blocks Umami requests in that tab.

~~~text
node data/seo/city-pages/YYYY-MM-DD/review.mjs http://127.0.0.1:4339 next-review
~~~

Read the saved JSON and inspect the screenshots.
Check counts again if prepared data changed.
The aggregate-verification JSON is saved evidence, not a runnable script.

## Evidence

- Summary component: Current city summaries and dynamic counts.
- Detailed city report: Scope, failure cases, and preview issue.
- Browser script: Repeatable real-page inspection.
- Browser results: Saved layout and link results.
- Berlin phone: Saved phone screenshot.
- Barcelona desktop: Saved desktop screenshot.
- Aggregate evidence: Accepted profile counts and hash results.
- Technical handoff: Build and preview procedure.
- Main handoff: Overall results.
