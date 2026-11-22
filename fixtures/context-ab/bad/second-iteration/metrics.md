# Metrics

One row per reading. Same filters every time: Search Console web search, all countries, all devices, 30 days.
Below 30 clicks, report counts only. Do not compute rates.

## Readings

| Date | Search clicks (30 d) | Impressions (30 d) | Position | Umami visits (30 d) | Referring domains | Live cities | Sitemap URLs | TikTok posts | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 2026-10-07 | 120 | 14,310 | 12.4 | 380 | 0 | 641 | 4,038 | 1 | Baseline. Impressions fell by half on 23 September. |
| 2026-10-20 (read 21 Oct) | 102 | 9,620 | 11.9 | 310* | unavailable | 713* | 4,973* | unavailable | Search window: 20 September to 19 October. Retrieved 21 October at 10:18 UTC. *Site counts checked 21 October. Umami: 310 visits across all hosts; 247 on the public host. |
| 2026-11-03 | | | | | | | | | Title freeze ends after this reading. |
| 2026-12-13 | | | | | | | | | End of the iteration. |

## Sources

- Search Console: the current read-only collection script is `data/research/growth-metrics-2026-10-21/collect.py`. It reads the existing local secret store without exporting credentials. Change its fixed dates for a new reading. Keep the query settings the same.
- Umami: site `umami.example.com`, website `00000000`. Read visits, referrers, and the five events: search, group_filter, share, vote_submit, sign_in.
- Referring domains: Search Console Links report.
- Live cities and sitemap URLs: `curl -sL https://indoeuromap.com/sitemap-0.xml | grep -c '<loc>'` and the home page description.
- TikTok: the Studio analytics page, by hand.

## Reading rules

- The 11 October release is the reference for search comparisons.
- Area pages carry most impressions from bare place-name queries. A small fall there is not a failure.
- Watch first: clicks and impressions for "most diverse cities in ..." and "how multicultural is ..." queries. Then country and city page impressions. Then total clicks.
- Record every page change in the decision file of its section with the date and the commit.

## 20 October reading, collected on 21 October

Search Console returned the full 30-day window, 20 September to 19 October 2026.
The query used web search, all countries, all devices, and `dataState=all`.
This matches the saved 7 October query settings. Dates use Pacific Time.
The response had no incomplete-data marker. Later revisions remain possible with `dataState=all`.
The saved baseline covers 7 September to 6 October, not a window ending on 7 October.
The two windows overlap. They are not independent before-and-after samples.

Clicks fell from 120 to 102. Impressions fell from 14,310 to 9,620.
Average position changed from 12.4 to 11.9.
Do not attribute these changes to titles. The windows include different dates and releases.
Release 1 went live on 18 October at 20:20 UTC. This reading has little data after that release.
The 19 October roots H1 change is another measurement limit.

| Page group | Clicks, baseline | Clicks, new window | Impressions, baseline | Impressions, new window |
|---|---:|---:|---:|---:|
| Roots pages | 15 | 16 | 1,040 | 770 |
| Comparison pages | 3 | 1 | 410 | 398 |

These are sums of returned page rows, not property totals. No rates are shown for these groups.
Roots pages have a small, repeated signal. Madrid Latin and Munich East Asian each received four clicks.
France received five clicks. Germany received two. Spain received three.
The query "most diverse cities in germany" received one click and 12 impressions.
These counts do not support a large page expansion yet.
Keep the title and URL freeze. On 3 November, check these existing pages before adding new ones.

The owner approved administrator credentials for read-only Umami reports on 21 October.
The report covers 20 September to 19 October in America/Los_Angeles, to match Search Console.
All hosts: 310 visits, 266 visitors, 1,340 page views.
Public host `indoeuromap.com`: 247 visits, 239 visitors, 531 page views.
The hostname report confirms that localhost, 127.0.0.1, and a preview host enter the same property.
The filtered hostname report contains only indoeuromap.com.
Do not compare the public-host count with the old 380 visits until its host and time filters are known.
All-host event counts: group_filter 23, search 1. Public-host events: group_filter 22.
No public-host search, share, vote_submit, or sign_in events were returned.
This does not prove that each event is correctly installed or that nobody used those actions.
Umami returned six traffic referrer hostnames. These are not Search Console linking domains.
The repeat command is in the reading record. No account settings changed.
Search Console Links and TikTok Studio were not available through the permitted tools.
Do not carry the old zero referring-domain count forward as a new result.

The live home page reports 713 cities in 35 countries. The live sitemap has 4,973 unique URLs.
These are coverage counts, not traffic measures. Both were checked by HTTP on 21 October.

Evidence: [reading record](../data/research/growth-metrics-2026-10-21/README.md).
