# Show HN draft

The owner posts by hand from his own Hacker News account. The post is about the method and the coverage, not the ranking.
Recheck the coverage numbers on the post day (see findings.md, "Before you send").

## Post

URL field: https://indoeuromap.com/explore/ (the full map, not the ranking)

Title:

Show HN: IndoEuroMap, one method to compare neighbourhoods in 713 European cities

Text:

I built IndoEuroMap to compare neighbourhoods across European countries with one method.

How it works:

- IndoEuroMap's own method classifies public online records at public places, such as shops and restaurants, into broad categories and counts the results by area.
- A repeated record counts at most three times per area. An area needs 200 classified records for a breakdown. Small counts are pooled.

Coverage: 713 cities in 35 countries, about 9.8 million classified records, and 4,791 areas with a breakdown.

Limits:

- A percentage is a share of classified records at places in the area, not a share of residents.
- The place sets the area, not the home of the person. Records include visitors and repeats.
- A category does not show anyone's ethnicity, nationality, or residence.
- There is no measured classification error rate yet.

Method and limits: https://indoeuromap.com/methodology/. I would like feedback on the method and on what the limits page misses.

## Rules applied

- Show HN is for something people can try. The site is free to use, with no sign-up.
- The title starts with "Show HN:" and has no superlative or marketing words.
- The post links to the full map, which people can use at once. The text links the methodology page.
- Do not ask anyone for votes. Do not post again if the post gets no attention.
- Stay online for the first hours and answer comments.

## Notes for replies

- Answer only with method facts. Do not argue about politics or groups.
- Questions about the record source: use the method line above. Do not name the input platform.
- Questions about accuracy: there is no measured error rate. Coverage compares records per resident with Barcelona. It measures data volume, not accuracy.
- Questions about privacy: the website receives area aggregates only. It does not receive individual records or individual labels.

## Check

| Number | Value | URL checked | Where | Date |
|---|---|---|---|---|
| Cities and countries | 713 cities, 35 countries | https://indoeuromap.com/data-for-research/ | Coverage section | 2026-10-18 |
| Classified records | 9,802,923 (about 9.8 million) | The 35 country pages, for example https://indoeuromap.com/germany/ | Sum of the "Classified records" values | 2026-10-18 |
| Areas with a breakdown | 4,791 | The 35 country pages | Sum of the "Areas with results" values | 2026-10-18 |
| Repeat limit, 200 records, pooling | 3 per area, 200, small counts pooled | https://indoeuromap.com/methodology/ | "Count and publish" step | 2026-10-18 |
| No measured error rate | Stated | https://indoeuromap.com/methodology/ | "What the data can tell you" section | 2026-10-18 |

Note: the research page says "5987 areas". That count includes areas without a breakdown. The post uses 4,791, the sum of "Areas with results".
