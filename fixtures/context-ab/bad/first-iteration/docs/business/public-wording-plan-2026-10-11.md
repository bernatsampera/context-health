# Public wording plan

Date: 2026-10-11. State: plan only. No public copy or data has changed.

## Aim

Use a confident, professional presentation. Present the figures as IndoEuroMap data, our own source of truth, instead of as "estimates". The main headline is "How multicultural is your city?". Keep the exact input source out of future public copy. Remove "experimental" and explicit reviewer and name-source wording from public headings, descriptions, map labels, FAQs, and share cards.

The project presents this data as its source of truth, is aware of its own bias, and can be wrong. State this position once, with conviction, on the methodology page. Do not hedge per figure. Two sentences must stay because they are the difference between a bold claim and a false one: percentages are shares of retained classified source records, not percentages of residents, and rankings are attributed to IndoEuroMap data.

Keep one brief accuracy statement on the methodology page. Use method links elsewhere. Keep number definitions and missing-data instructions. These explain the measure and are not repeated accuracy notices.

This change cannot make previous disclosures secret. Existing pages, search snippets, source history, shared images, and external copies can retain them. Do not promise secrecy or change history.

## Facts that constrain the copy

`pipeline/METHOD.md` describes the actual measure. Percentages use retained classified source records. They do not use residents as their denominator. City, country, and region figures combine published counts. Records can repeat and can come from visitors. Unknown and ambiguous records do not enter the share denominator. Other counts do. Low-data areas have no breakdown.

The current categories derive from name patterns. A change in wording does not establish ethnicity, culture, nationality, or residence. Retain category keys and calculations. Present each category as an algorithm category, not as a counted population. Do not write "20% of residents are African" or "20% of the area has African culture".

Local is a configured host category. It can include several countries' labels. Middle Eastern includes North African labels. Anglo labels enter Western. Subgroup shares can use fallback allocations. The Europe headline includes Other, unlike the other headline functions. Explain these rules in source-neutral method copy. Do not hide these differences with a new label or change them in this copy task.

Coverage compares record density with Barcelona. It is not confidence, accuracy, or a percentage of residents studied. Missing and suppressed values are not measured zero.

The code supports "our algorithm that analyses public online data". It uses external models, datasets, and rules. `frontend/src/pages/terms.astro` asserts project ownership, but that statement does not prove exclusive rights over all method components. Use "our algorithm" as the supported fallback. Use "proprietary" only if existing ownership and licence evidence supports it. Preserve required third-party attribution and licence terms. Check those obligations before removing source credits.

## Proposed copy contract

| Surface | Proposed wording or rule |
| --- | --- |
| Main headline | How multicultural is your city? |
| Main description | Compare cultural name patterns across European cities and neighbourhoods. IndoEuroMap data. |
| Title tag pattern | Multicultural cities in Europe - IndoEuroMap |

## Work order

1. Add a small shared copy contract beside `frontend/src/data/seo.ts`, or use an existing shared copy module if its role fits. Keep text separate from numeric helpers in `frontend/src/data/copy.ts`. Update `frontend/llms.txt` if a file is added. Use the existing styles and component structure. Do not create a new design system.
2. Update the main copy in `frontend/src/components/pages/HomePage.tsx`, `frontend/src/pages/index.astro`, `frontend/src/pages/explore.astro`, and `frontend/src/layouts/LayoutV2.astro`. Check titles, leads, descriptions, default metadata, and accessible labels.
3. Update map copy in `frontend/src/components/roots/rootsModel.ts`, `RootsMapPage.tsx`, `RootsPanel.tsx`, `RootsTooltip.tsx`, `RootsFilters.tsx`, and `RootsLegend.tsx`. Review `frontend/src/components/pages/CityPageV2.tsx`, `CountryPageV2.tsx`, and `AreaPageV2.tsx`. Keep category mapping, rounding, sorting, palettes, suppression, and denominators unchanged. Use a method link in place of the repeated panel notice.
4. Update public route copy and FAQs in `frontend/src/pages/[country]/index.astro`, `[country]/[slug].astro`, and `[country]/[slug]/[area].astro`. Review `frontend/src/components/pages/CitySampleSummary.astro`, `frontend/src/components/patterns/NavSearch.tsx`, `DisclaimerText.tsx`, `ShareRow.tsx`, `ShareMenu.tsx`, and map help popovers. Keep aggregate sample information with a source-neutral unit such as "classified records".
5. Rewrite `frontend/src/pages/methodology/index.astro`. Keep the single accuracy statement above. Keep truthful source-neutral descriptions of selection, counting, aggregation, subgroup allocation, local categories, missing values, and coverage. Remove source-specific collection steps and name-specific technical detail from public copy. Preserve useful section IDs and country redirects. Review public strings in `frontend/src/data/methodology/`, including Spain's "experimental threshold" text. Do not change publication flags or routing settings.

## Acceptance and verification

Run these checks during implementation. This plan does not run a build or change public output.

- Record the initial working tree and preserve existing edits. Save aggregate input hashes and representative displayed values before editing. Use the prepared frontend data. Do not submit pipeline jobs or run a new export for a wording change.
- Run `npm --prefix frontend run build`. Save the build log under `data/`. Require the manifest guard and Astro build to succeed. Report the actual page count and OG reuse/render counts.
- Read generated HTML for home, explore, one country, one region, one city, one area, methodology, About, sources, legal pages, report offers, and each generated article type. Include Barcelona, Berlin, Tallinn, London, one low-data area, and a suppressed group. Check titles, descriptions, headings, JSON-LD, FAQs, links, aria labels, and image alt text.
- Search all public HTML, public text output, and built JavaScript for "experimental", "reviewer", "Google reviews", "Google Maps places", "name roots", "name-share", and equivalent source disclosures. Inspect each match in context. Do not ban legitimate boundary attribution such as Google or OpenStreetMap by a broad string rule. Required credits must remain accurate.
