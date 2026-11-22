# TikTok first post: Barcelona, 2026-09-27

Post-mortem for the first indoeuromap TikTok photo slideshow.

## Result

- Account: @indoeuromap on TikTok. The handle change from the old name succeeded before this session.
- Package: `data/social/tiktok/barcelona-post-01` (cover 3b, group 4a, seed v5, light theme, ten slides).
- Scheduled through TikTok Studio for 2026-09-27 at 19:00 Madrid time.
- URL: https://www.tiktok.com/@indoeuromap/video/7689971172208921878
- Manifest status: `posted_by_user`, recorded 2026-09-26 22:17 UTC. Not verified against the live post.
- Sound: Calm Lofi/Cafe/Study/Vlog (1492712), Tana Music, 1:13.
- Settings: Everyone, comments on, reuse on, disclosure on with Your brand, no AI label, no location.

## Caption used

Title: Barcelona. Where is it most multicultural?

Description: top 5 neighbourhoods list, "The data is an approximation of the presence of each group in Barcelona.", "Find your city, region or country: indoeuromap.com", hashtags #Barcelona #Catalunya #maps #dataviz #IndoEuroMap.

The owner rejected the generated caption. Reasons: too many loaded words (roots, mapped, peaks, swipe), the method note was too explicit, and the boundary credit was not wanted on social. The generated caption is kept as `caption.generated.txt` in the package.

## What worked

- The fresh render was byte-identical to the approved v5d deck for the cover and the caption. The tool is repeatable.
- The Chrome Indem browser route worked end to end: discard old draft, `DOM.setFileInputFiles` with ten PNGs in manifest order, title and description via `Input.insertText`, sound search and Use, disclosure toggle, Schedule with a time picker, and the Posts page listing the scheduled post.
- The Feed preview in TikTok Studio confirmed the slide fills the phone screen and the headline, map, and numbers stay clear of TikTok's overlays.

## What did not work

- The editor already held an unpublished old dark-theme draft from a previous session. It had to be discarded first.
- The old caption in the editor and the TikTok Studio title field were not covered by UPLOAD.md. Studio has a separate 90 character title.
- Cover 3b keeps its own "1 / 10" pill. TikTok draws its own counter next to it. Consider removing the pill on the cover.
- The Studio sound panel does not show the Commercial Music Library flag. The track was chosen by name and catalog number, not by a verified licence label.
- The time picker is a scroll column. Clicking an item needs `scrollIntoView` first. The "Your brand" checkbox needs a click on the input itself, not on the label.
- The scheduling happened at 00:30 Madrid time, so the post was queued for the evening rather than posted live.

## First 24 hour numbers

To be filled by the owner after 2026-09-28 19:00 Madrid time.

| Metric | Value |
| --- | --- |
| Views | |
| Likes | |
| Comments | |
| Shares | |
| Saves | |
| Profile visits | |
| Follows | |
| Site visits from TikTok (Umami) | |

## Next steps

- Verify the post went live at 19:00 and that the image order is correct in the app.
- Fill the table above and decide on the second post (Madrid, Spain, or Barcelona province).
- Decide on removing the cover counter pill.
- Watch the account for any restriction after the first automated publish.
