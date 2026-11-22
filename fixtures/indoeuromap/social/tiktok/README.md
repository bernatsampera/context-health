# TikTok slideshow creation

Create a complete photo slideshow from saved city, region, or country data.
Run one command from the project root:

```text
node social/tiktok/create.mjs --city barcelona
node social/tiktok/create.mjs --region ES511
node social/tiktok/create.mjs --country spain
```

Use Node 24 or later. The renderer uses the existing frontend dependencies.
Run `npm --prefix frontend install` if those dependencies are missing.
The first render downloads Schibsted Grotesk from Google Fonts into `data/cache/tiktok/fonts/`.

## Configuration

The command reads config.json for copy, group selection, and small layout switches.
Use `--config PATH` to merge a JSON override over these defaults.
The merge goes one level deep. An unknown top-level key stops the run.
The effective config goes into `manifest.json` under `config` and into `source/config.json`.

```text
node social/tiktok/create.mjs --city barcelona --config data/social/tiktok/override-roots.json
```

| Key | Default | Effect |

## Output and upload

Each run creates a folder under `data/social/tiktok/` with:

- `slides/`: Numbered 1080 x 1920 PNG files, ready to transfer to a phone. Names are 01-cover, 02-ranking, one file per group key, then NN-outro.
- `preview.html`: A local review page with all slides and the caption.
- `contact-sheet.png`: A small view of the whole slideshow.
- `caption.txt`: Simple post copy from `caption` in the config. Paste it as the description. In TikTok Studio, use its first line as the title.
- `caption.generated.txt`: The earlier long caption with the method note and boundary credits. For reference only. Do not post it.

See the upload guide for the complete process.
The Chrome Indem route also supports photo selection in TikTok Studio.

See the Instagram workflow for its browser process and post recorder.

## Saved designs

These IDs follow the owner's message. The original handoff uses different labels.
The source files remain unchanged. Use the catalog to map the IDs.

| ID | Role | Design | Original handoff label |
| --- | --- | --- | --- |
| 3a | Cover | Standout roots map | 4a |
| 3b | Cover | Diversity map and composition bar | 4b |

- Design catalog: Stable IDs, roles, selectors, source labels, and reference hash.
- Visual reference: All four original HTML artboards with placeholder data.
- Original handoff: Original type, colour, spacing, map, and copy requirements.
- Plan selector: Choose designs once and record the layout for every slide.
- Create command: Generate PNGs, preview, caption, ZIP, and upload instructions.
- Default config: Copy, group selection, and brand line defaults.
- Aggregate loader: Match places to accepted data and geometry at each level.
- Slide renderer: Draw the six designs with the approved font and safe-zone checks.
- Post record command: Record a user-supplied TikTok post URL locally.
- [Navigation](llms.txt): Links to the slideshow files.

## Select a slideshow

Run from the project root. Supply real group keys in the required display order.
The selector does not impose the eight placeholder groups from the handoff.
This example plans two group slides. It does not claim to cover every Barcelona group.

```text
node social/tiktok/plan.mjs --city barcelona --groups latin,western --output data/social/tiktok/barcelona-example/plan.json
```

Random selection is the default. The saved seed repeats the same selection.
Cover and group choices use separate random draws derived from that seed.

## Data and rendering rules

The original reference artboards retain their placeholder data. Do not post them.
The create command uses accepted frontend profiles and verifies their saved hashes.
It also checks metadata and selected city geometry hashes.
It only uses countries marked published in the website metadata.

City maps show neighbourhood samples. Region maps show covered city samples over a region outline.
Country maps show region samples. Their totals combine covered places only.

## Saved verification

- Wave 1 schedule: Sixteen city packages (light, cover 3b, group 4a), Tuesday and Friday slots, and their captions.
- Wave 1 verification: PNG sizes, image hashes, no counter pill, no cut name, the 1% rule, ranking values against `frontend/src/data/profiles`, and caption format. Rerun with `node data/social/tiktok/wave-1/verify.mjs`.
- Check renders: Barcelona and Madrid before and after the cover pill removal, and the follow-up renders (`v3-<city>`, `barcelona-3b-v3`).
- Wave 1 first render: The 16 packages before the 1% rule, the full pill removal, and the name fixes.

- Barcelona website palette: Diversity cover with the website palette and group slides with their own colors.

- Barcelona group layout 4a: Corrected group colors in the large-statistic layout.
- Barcelona group layout 4b: Corrected group colors in the large-map layout.

- Barcelona light v4: Site colors, light theme, other-roots ranking, cover sub-hook, and the new outro.
- Barcelona dark v4: The same slideshow with the dark theme for comparison.

- Barcelona v5: Presence wording, no note line, flowing group layout 4a, and the Europe map outro.
- Barcelona v5 4b: The same run with cover 3a and the large-map group design.
- Spain v5: Country run with the Europe map outro.
- Barcelona province v5: Region run. The long place name shrinks the 4b share line.
- Instagram Barcelona v5: The 1080 x 1350 carousel with the same changes.

- Creation report: Three complete runs, PNG sizes and hashes, aggregate totals, design consistency, and ZIP contents.
- Barcelona preview: Ten city slides using cover 3b and group design 4a.
- Barcelona province preview: Ten region slides using cover 3b and group design 4b.
- Spain preview: Ten country slides from default seeded design selection.

- Barcelona selection report: Real runs for random selection and all four explicit pairs, using groups from 73 accepted profiles.
- Random Barcelona plan: Saved cover choice, shared group choice, seed, and slide order.
