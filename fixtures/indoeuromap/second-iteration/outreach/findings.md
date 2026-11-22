# Five citable findings

Numbers: data version 2, live since 2026-10-18 20:20 UTC. Checked on 2026-10-18.

Status: drafts. The owner sends. Nothing in this folder is sent or posted by an agent.
Every number below matched the live page on 2026-10-18.

Words used in all findings:

- A percentage is a share of classified records at places in the area. It is not a share of residents.

## Before you send

Each point can make a journalist distrust a number. Fix it or plan the answer first.

1. Recheck every number on the send day. Wrocław, Łódź, and Białystok are held from the export until the slug fix. When they return, the Poland list, the city count (713), and the record total change.
2. Fixed on 2026-10-19: the public site text no longer says "name" about the method. The privacy page still says that the private pipeline stores and uses names, because the privacy notice must state what personal data is processed. Labels changed: "Classified records" on country pages, "Categories in <city>" on city pages, roots H1 "Where in <city> is the <group> share highest?".
3. Resolved on 2026-10-18: the home ranking now shows the city page value (top 12 checked). The share cards now say "of classified records in non-European categories" and show the shared page rank (Berlin card: "Rank 10 of 86", page rank 10). The default card (13%) matches the explore page (13%).
4. Some places appear two times. Several Brussels communes are also separate one-area places in the Belgium list, with their own sample. Example: Molenbeek-Saint-Jean is 49% as a Brussels area and 52% as its own place. Spain lists Sant Martí, a Barcelona district, as a city. Poland lists Warsaw districts such as Mokotów next to Warsaw. Explain this or fix it before you pitch Belgium, Spain, or Poland.

## How the numbers were checked

- A read-only script applied the site share rules (cityOriginUnit and nonEuropeanRootsShare) to frontend/src/data/profiles/ and frontend/src/data/cities-meta.json (data version 2 export).
- The script output matched all 713 city values in https://indoeuromap.com/home-cities.json and all 713 rows of the 35 country ranking tables (rank and value).
- The script output matched the country figure, "Areas with results", and record count on all 35 country pages. It also matched every area row, "Across" line, and page data record count on the 43 city pages used here.
- "Ranking table" means the "Compare cities" or "Compare areas" table on the page. "Page data" means the dataCoverage block in the page HTML. "Sample sentence" means "The current city figure uses ... classified records", which only some city pages show. "Profile file" means the prepared data file only.
- All share image URLs below returned HTTP 200 with image/png on 2026-10-18.

## 1. The ten most multicultural cities of one million people or more

**Finding.** London has the highest share among the 22 European cities of one million people or more on IndoEuroMap. At places in London, 33% of classified records fall in non-European categories. Brussels follows at 26% and Paris at 23%. Seven of the ten cities are capitals. Three are in Germany: Köln, Berlin, and Hamburg. The list of ten ends with Hamburg, Oslo, and Vienna at 20%.

| Home rank | City | Country | Share | Classified records |
|---|---|---|---|---|
| 1 | London | United Kingdom | 33% | 95,202 |
| 2 | Brussels | Belgium | 26% | 39,463 |

## 2. Toulouse and Brussels have the widest gaps between their own areas

**Finding.** Toulouse has the widest gap between its areas among well-covered cities on IndoEuroMap. In two Toulouse areas, Pont des Demoiselles / Ormeau/ Montaudran / La Terrasse / Malepère and Sept Deniers / Ginestous-Sesquières / Lalande, 13% of classified records fall in non-European categories. In Mirail-Université / Reynerie / Bellefontaine, the share is 51%. The gap is 38 points. The Toulouse city figure is 21%. Brussels is second, with 37 points: from 12% in Watermael-Boitsfort to 49% in Molenbeek-Saint-Jean. We compared 38 cities. Each one has six or more areas, a published breakdown for every area, and 1,000 or more classified records in each area. Köln (30 points) and Montpellier (26 points) have the next widest gaps.

| City | Lowest area | Highest area | Gap | City figure | Areas with a breakdown |
|---|---|---|---|---|---|
| Toulouse | Pont des Demoiselles / Ormeau/ Montaudran / La Terrasse / Malepère, and Sept Deniers / Ginestous-Sesquières / Lalande, 13% | Mirail-Université / Reynerie / Bellefontaine, 51% | 38 points | 21% | 20 of 20 |
| Brussels | Watermael-Boitsfort, 12% | Molenbeek-Saint-Jean, 49% | 37 points | 26% | 19 of 19 |

## 3. Amstelveen leads the Netherlands, ahead of the four largest cities

**Finding.** Amstelveen has the highest share among the 53 covered Dutch cities on IndoEuroMap. At places in Amstelveen, 26% of classified records fall in non-European categories. Eindhoven and Rotterdam follow at 24%, then Almere Stad, Amsterdam, and The Hague at 23%, and Utrecht at 21%. All four of the largest Dutch cities (Rotterdam, Amsterdam, The Hague, and Utrecht) are in the top seven, but none of them is first. The figure for all 53 cities is 16%. In Amstelveen, Elsrijk has the highest share (43%). In Rotterdam, Delfshaven has the highest share (33%).

| Rank | City | Share | Classified records |
|---|---|---|---|
| 1 | Amstelveen | 26% | 8,644 |
| 2 | Eindhoven | 24% | 65,685 |

## 4. Five capitals side by side

**Finding.** Of five European capitals, Paris and Amsterdam have the highest share on IndoEuroMap, both at 23%. Berlin follows at 21%, then Vienna (20%) and Madrid (14%). The range inside each city differs. Amsterdam runs from 14% in Weesp to 38% in Nieuw-West. Madrid has the narrowest range, from 10% to 19%. No Paris arrondissement is below 21%. Vienna ranks first in Austria and Amsterdam fourth in the Netherlands. Madrid, Berlin, and Paris rank ninth to eleventh in their countries.

| Capital | City figure | Lowest area | Highest area | Rank in country | Classified records |
|---|---|---|---|---|---|
| Paris | 23% | 5e, 6e, 7e, and 14e arrondissements, 21% | 16e arrondissement, 32% | 11 of 41 (shared) | 180,108 |
| Amsterdam | 23% | Weesp, 14% | Nieuw-West, 38% | 4 of 53 (shared) | 52,095 |

## 5. Berlin ranks tenth in Germany

**Finding.** Berlin is not the German city with the highest share on IndoEuroMap. Essen and Gelsenkirchen lead at 29%, then Duisburg and Düsseldorf (27%) and Dortmund (25%). Bonn, Frankfurt am Main, Herne, and Köln follow at 22%. Berlin shares tenth place with Aachen, Bremen, Oberhausen, and Stuttgart at 21%. Eight of the nine cities above Berlin are in North Rhine-Westphalia. The figure for all 86 listed German cities is 18%.

| Rank | City | Share | Classified records | Areas with a breakdown |
|---|---|---|---|---|
| 1 | Essen | 29% | 18,852 | 6 of 9 |
| 1 | Gelsenkirchen | 29% | 20,656 | 5 of 5 |
