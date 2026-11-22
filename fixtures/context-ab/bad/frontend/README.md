# Frontend

The public website uses Astro, React, and Tailwind.
It reads prepared aggregate profiles and map boundaries from this folder.
Use [llms.txt](llms.txt) to find the relevant code.

## Setup and checks

Run these commands from the repository root.

```text
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix frontend run preview
```

`npm --prefix frontend run dev` exports local data before starting the dev server.
To use the existing data copy without an export, run `npx astro dev` from this folder.
Local development uses `frontend/.env.development`. An ignored
`frontend/.env.local` overrides it. Set `PUBLIC_SUPABASE_URL` to
`https://api.indoeuromap.com` and use the public anon key from
`frontend/.env.production` if you have an old local override. The
`supabase-js` client uses the self-hosted PostgREST and GoTrue services.
Restart the dev server after an env change.

### Share image cache

The build keeps rendered share images in `../data/cache/og-images/`.
It reuses an image when its input values, card template, fonts, palette,
generator code, and dependency lockfile have not changed.
Page and CSS changes outside the image renderer do not clear this cache.
The first build fills it. Later builds still list the image routes, but read
the saved PNG files instead of rendering them again.
The build prints the number of reused and rendered images at exit.

Set `OG_IMAGE_CACHE_DIR` to use a different persistent cache folder.
The Docker build uses a BuildKit cache mount at `/data/cache/og-images`.
Keep the same builder to reuse that cache across builds.
Do not commit cached images.

## Sitemap output

Article links use the publication plan and available group data.
They point to generated group pages, or to the city page when a group article is unavailable.
Related article lists omit unavailable group pages.

The sitemap filter reads final generated HTML during build completion.
It excludes pages with noindex directives and HTML redirects.
The filter runs before the sitemap integration and uses Astro's output directory.
A missing expected HTML file fails the build instead of adding an unchecked URL.
The helper assumes this site's directory output and root site URL.
Review it before changing either setting.

## Pipeline inputs

- `src/data/profiles/<country>/<city>/area_profiles/` holds aggregate profiles.
- `src/data/profile-manifest.json` lists accepted profile files and their hashes.
- `src/data/cities-meta.json` holds city metadata.
- `public/geo/` holds map geometry.
- `src/data/methodology/` holds country source and publication metadata.

The input type is `AreaProfile` in `src/data/areas.ts`.
The country methodology registry rejects profile countries with missing metadata.
Only countries with `published: true` enter the public profile loader.
Do not change this flag just to make a pipeline batch appear complete.

Step 7 of the pipeline creates local area profiles. Step 8 validates the profiles
and copies accepted data here. A city with one valid zone passes the shared zone
check when its population is positive and below 400,000. At 400,000 or more,
the city needs two valid zones. Unknown population also needs two. A registry
population matched by `geonames_id` has priority. A usable `run.yaml` value is
the fallback. An explicit `one_zone_ok: true` or `zones_allowed: single` permits
one valid zone. `zones_allowed: multiple` requires two. A conflicting exception
blocks export. Invalid geometry always blocks export.

The completed manifest selects the exact profile files that the website reads.
The build checks each listed file and its hash. An old file outside the manifest
does not enter the website data. Old files can remain on disk.

Export local data with `npm --prefix frontend run sync:data`.
This copies accepted aggregate data and writes the completed manifest. Inspect
the output and diff.
Then run `npm --prefix frontend run build`.
An export or a build does not deploy the site.
`make ship` is a separate commit and deployment action.

The Docker build uses only this folder.
Keep every public build input inside it.
Do not import raw review data or depend on local `data/` during a build.

## Design and display rules

- Use one public methodology page. Keep actual country differences in its country section. Old country methodology routes redirect there. Country map pages hold sample counts and their reading notes.
- Use the tokens in `src/styles/global.css` and their Tailwind mappings.
- Use the shared UI components in `src/components/ui/`.
- `LayoutV2.astro` supplies the page shell. React page components supply content.
- Use `font-sans` for text. Keep data colors separate from control colors.
- Use `src/data/groups.ts` for origin rows and local-root calculations.
- Keep unknown, suppressed, and low-data values distinct from measured zero.
- Use off-white for nearby places outside the selected area. Use light gray for places with no data and a darker neutral gray for water. Keep blue for the data scale.
- Use the shared palette in `src/data/mix-stops.mjs` for the non-European share map and its key. The scale runs from blue through teal and ochre to dark red.
- Use `mixPosition` in `src/data/cultures.ts` for the map color scale. It reaches olive at 9%, orange near 15%, red near 22%, and dark red at 30% or more.
- Show aggregate figures. Do not show individual origin labels or individual records.
- Public copy contract: figures are presented as IndoEuroMap data, our source of truth, not as estimates. Use the strings and rules in `src/data/publicCopy.ts`. Keep "experimental", reviewer wording, and the exact input source out of public copy. A category percentage is a share of retained classified source records, not a percentage of residents. High-volume search phrases such as "most multicultural cities in Europe" need attribution in the same surface. Do not use "multiculturality" in headlines or title tags. Share text stays free of numbers and group names. Keep required boundary and dataset credits accurate.
- Check desktop and phone layouts after a layout change.
- The footer uses a light surface, a large brand introduction, map and city actions, and separate featured-city and help columns. Use darker secondary text for links. Keep the legal links on the bottom row.
- Keep the boundary source credit in the shared map key and on the Data sources page. Do not repeat it in the footer.
- The footer country links sit in a rounded panel. Use two columns on phones, three on small screens, four on large screens, and five on wide screens. Keep long country names visible and let them wrap. Keep phone touch targets at least 44 pixels tall.
- Check the six featured city routes and usable area profiles after data exports. Keep the map guide, data source notes, and contact page linked. Source dates describe the named input, not the age of all map data.
- The home page uses a country dropdown on desktop and in the phone Filters panel. Close the dropdown after selection. Match consecutive letters without case sensitivity. Keep All countries first, sort country names alphabetically, mark the current country, and limit the list height. Use a thin line below the search row to show focus.
- The home page Cultural mix sort ranks cities by the displayed non-European category percentage, highest first. Exclude local, other European, and unknown. Use city names to break ties. Old `sort=nonw` links use this same ranking.
- Keep home page bar labels hidden until the full text fits inside the segment padding. Check label width again when segments resize or fonts load. Keep full group names and percentages in hover text and Details.
- All map views use the shared tooltip to show group percentages at widths of 1024 pixels or more with a mouse or trackpad. Use `displayRows` for these groups so suppressed values stay hidden.
- Country, region, and city hover boxes show one muted line: `Data coverage: 50%`. Divide the place's names per resident by Barcelona's names per resident, then multiply by 100. Use the current accepted Barcelona profiles and its saved city population. Barcelona is always 100%. Scores can exceed 100% when a place has more names per resident than Barcelona.
- Country boxes use the full country population. Region boxes use the full region population. City boxes use the saved city population. Do not use a city population for a neighbourhood.
- Coverage counts use `coverage_note.classified_names` from accepted, published profiles. Count each area once. Include low-data areas in the total for a mapped city. These are name records, not unique residents. Records can include visitors and repeats. This ratio does not measure accuracy or the percentage of residents analysed.
- Hide the coverage line when name counts, population figures, or the Barcelona reference are missing. A positive score below 0.1% shows as `<0.1%`. All scores change when the Barcelona reference changes.
- Country population totals: Saved 2024 totals from [World Bank indicator SP.POP.TOTL](https://data.worldbank.org/indicator/SP.POP.TOTL), under CC BY 4.0. The file includes the source URL and dates. Builds use this saved copy without a network request.
- Region population totals: Saved population totals for 1 January 2024 from [Eurostat table demo_r_pjanaggr3](https://ec.europa.eu/eurostat/databrowser/view/demo_r_pjanaggr3/default/table?lang=en). Use the total age group and both sexes. Match each region by its NUTS code. Builds use this saved copy without a network request.

## Place page layout

Country, region, and city routes render a compact answer before the map. The route owns the navigation, main landmark, H1, and breadcrumb. The map uses embedded mode. `/explore/` keeps the standalone map shell.

The static comparison uses the published non-European category share from the prepared aggregates. Map filters do not change this table. Equal displayed shares have competition ranks (1, 1, 3). Missing values have no rank. City-only pages show the city overview and omit an empty area table. Empty regions keep `noindex,follow`.

Map links use `#map`. Editorial comparison links use normal routes. Map URLs accept `scope=outside` or `scope=europe`, one `group`, or ordered comma-separated `groups`. Known legacy group keys remain valid. Same-page changes keep other query fields and history state. Place changes carry only the map selection. Selected-area normalization retains the query and fragment. The selection hook reads reload and `popstate` state. Runtime browser behavior requires a separate browser review.

## Other website tools

### About page

`src/pages/about.astro` contains the About page content, FAQs, and page styles.
Use the site's cream surfaces, sand header, three-color wordmark, and home page button styles.
Keep the reference site's influence limited to content structure.
The `company` object holds the public story, project, funding, location, and contact text.
Describe the site as an independent, bootstrapped passion project.
Show Estonia as the location. Omit the legal company name, street address, and phone.
Omit unconfirmed founding dates and social links instead of showing blank fields.
The AboutPage metadata describes the website without unconfirmed company details.
The FAQ metadata uses the same answers as the visible FAQ section.

`pseo/plan.py` manages article candidates in `src/pseo/plan.yaml`.
Use `make pseo-plan`, `make pseo-set`, and `make pseo-status`.
Roots group pages use the gate and waves in pseo/act.pseo.md.
The website authentication service is documented in [../selfhost/README.md](../selfhost/README.md).
