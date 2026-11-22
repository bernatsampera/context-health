# Design

Short design summary for agents. The full rules are in [README.md](README.md).

## Type

- Font: Instrument Sans. Use `font-sans` for all text.
- Headings use the semibold weight. Body text uses the regular weight.

## Color

- Data colors and control colors are separate.
- The data scale runs from blue through teal and ochre to dark red.
- Light gray: no data. Darker neutral gray: water. Off-white: nearby places outside the area.

## Layout

- `LayoutV2.astro` supplies the page shell. React components supply the content.
- Check desktop and phone layouts after a layout change.
- Phone touch targets are at least 44 pixels tall.

## Scope

These rules sit under the frontend rules: @./CLAUDE.md
