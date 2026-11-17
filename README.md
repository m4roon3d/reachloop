<p align="center"><img src="docs/logo/lockup.svg" alt="reachloop" width="360"></p>

**reachloop** is a personal Instagram helper for a photographer reviving their account. It helps you post good work consistently, learn from your own numbers, and get better reach without turning into a marketer.

It runs today as a single-page web app inside Claude (a Claude artifact). This repo is its home as it grows into an installable phone app.

## What it does

**Create**
- Add up to 20 photos or a reel clip; camera data (body, lens, focal length, aperture, shutter, ISO), GPS and date taken are read from the files
- Crop to 3:4, 4:5 or 1:1 with a tap-to-set focus point, add white, black or blurred borders, or split a panorama into a seamless carousel
- Claude writes the caption, three alternative hooks, five hashtags (Instagram's limit), alt text and a pinned first comment
- A final caption preview with the "…more" cut line, a camera line and your signature, ready to copy
- Saves finished 1080px slides

**Reach check**
- Instant checks: hashtag count, hook length, a question for comments, alt text, location, shape, resolution, posting time
- Claude reviews the post against what Instagram ranks on (watch time, sends, saves, likes per reach) and offers one-tap fixes

**Reels**
- Three reel concepts from your photos, at least two buildable straight away
- In-browser reel builder: photo dump, slow pans, panorama pan, before/after wipe, settings reveal; BPM-matched cuts; exports a 1080×1920 MP4
- Video clips are read as six frames so Claude can follow what happens
- Shot lists for photo walks, with tick-off checklists

**Grid and Plan**
- Preview your profile grid (3:4 tiles) with upcoming posts, and swap their order
- Your best posting times, a 14-day view, a queue, weekly goal and streak, Google Calendar reminders
- Results log: enter Insights numbers after posting; rates per reach show what is working, and Claude turns them into findings that feed back into every caption and reach check

**Places**
- Save named places; photos taken within 300 m are tagged automatically
- Claude can suggest a place name from GPS for new spots

## How it runs

`index.html` is the whole app: HTML, CSS and JavaScript in one file, no build step.

Inside Claude it uses the artifact runtime (`window.claude.use(...)`) for:

| Capability | Used for |
|---|---|
| `db` + `user` | Syncing posts, shot lists and settings between phone and desktop |
| `assets` | Storing photos |
| `sample` (with images) | Captions, reach checks, reel ideas, shot lists, place names, learnings |
| `downloads` | Saving slides and MP4s |

Opened in a normal browser, it falls back to this-device storage (localStorage) and hides the Claude features.

External code: [`mp4-muxer`](https://github.com/Vanilagy/mp4-muxer) 5.2.2 from jsDelivr for MP4 export (WebCodecs, with a MediaRecorder fallback), and Google Fonts (Outfit, Manrope, JetBrains Mono).

## Brand

- Name: **reachloop**, lowercase, set in Manrope ExtraBold with "loop" in red
- Mark: the aperture loop, a camera aperture inside a loop arrow (`docs/logo/`)
- Colors: ink `#151718`, red `#C2302A` (light) / `#FF5A4E` (dark)
- UI type: Outfit

## Roadmap

1. Installable web app (PWA): manifest, offline shell, home-screen icon, push reminders at posting times
2. Own backend: Anthropic API for the Claude features, a database for sync, image storage
3. Instagram Graph API: pull Insights automatically; optionally publish posts
