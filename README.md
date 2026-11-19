<p align="center"><img src="docs/logo/lockup.svg" alt="reachloop" width="360"></p>

**reachloop** is a personal Instagram helper for a photographer reviving their account. It helps you post good work consistently, learn from your own numbers, and get better reach without turning into a marketer.

It runs in two places from the same file:
- **As an installable phone app** (PWA, hosted on Cloudflare Pages): works offline, keeps everything on your device, shares slides and reels straight to Instagram, receives photos shared from your gallery on Android, and runs the AI features through Gemini once you add your passcode in Profile.
- **Inside Claude** (a Claude artifact): syncs between devices and adds the Claude features (captions, reach check, reel ideas, shot lists).

## What it does

**Workspaces**
- Run several accounts from one app (for example your photography and a product's brand account), each with its own posts, grid, plan, voice, hashtags, results and AI context
- Product workspaces add a short brief (what it is, who it's for, link), brand colours and a logo
- Optional crypto compliance for India: adds the ASCI risk disclaimer to captions and slides, flags risky wording (returns, prices, urgency, comparisons with regulated investments) and gives the AI matching rules. A helper, not legal advice

**Text carousels**
- Type a topic and the AI drafts 6 to 8 teaching slides plus the caption, hashtags, alt text and first comment
- Edit every slide (cover, points with bullets, last slide with a call to action) and redraw them in the workspace's brand style


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

`public/index.html` is the whole app: HTML, CSS and JavaScript in one file, no build step. Beside it in `public/`:

| File | Purpose |
|---|---|
| `manifest.webmanifest` | App name, icons, shortcuts, and the share target that receives photos from the gallery |
| `sw.js` | Service worker: offline app shell, cached fonts and MP4 library, share target handling |
| `icons/` | App icons (any, maskable, Apple touch) made from the aperture loop mark |
| `_headers` | Cloudflare Pages cache rules so updates arrive promptly |

**As a phone app** it stores posts, shot lists and settings in IndexedDB on the device. Profile has install help, storage used, and backup/restore (a single JSON file you can keep on Google Drive or move to another device). Saving slides or a reel opens the phone's share sheet, so you can post to Instagram or save to Photos in one tap.

**Inside Claude** it uses the artifact runtime (`window.claude.use(...)`) for:

| Capability | Used for |
|---|---|
| `db` + `user` | Syncing posts, shot lists and settings between phone and desktop |
| `assets` | Storing photos |
| `sample` (with images) | Captions, reach checks, reel ideas, shot lists, place names, learnings |
| `downloads` | Saving slides and MP4s |

**AI in the phone app** goes through `functions/api/ai.js`, a Cloudflare Pages Function that calls the Gemini API. The key lives only in Cloudflare; the app sends a passcode you choose with each request. Until a passcode is entered, the AI features are hidden.

## Deploy

Cloudflare Pages, connected to this repo: production branch `main`, framework preset None, build command empty, build output directory `public`. Every push to `main` deploys, including `functions/`.

Secrets (Settings → Variables and Secrets, Production): `GEMINI_API_KEY` and `APP_PASSCODE`; optionally `GEMINI_MODEL` to pin a model. Optional free backup: `OPENROUTER_API_KEY` (and `OPENROUTER_MODEL`) lets NVIDIA Nemotron answer when every Gemini model is busy; each workspace decides whether it may be used, because free endpoints log prompts. Redeploy after adding secrets. After changing anything in `public/`, bump `VERSION` in `public/sw.js` so installed apps refresh.

External code: [`mp4-muxer`](https://github.com/Vanilagy/mp4-muxer) 5.2.2 from jsDelivr for MP4 export (WebCodecs, with a MediaRecorder fallback), and Google Fonts (Outfit, Manrope, JetBrains Mono).

## Brand

- Name: **reachloop**, lowercase, set in Manrope ExtraBold with "loop" in red
- Mark: the aperture loop, a camera aperture inside a loop arrow (`docs/logo/`)
- Colors: ink `#151718`, red `#C2302A` (light) / `#FF5A4E` (dark)
- UI type: Outfit

## Roadmap

1. ~~Installable web app (PWA): manifest, offline shell, home-screen icon~~ (done); push reminders at posting times
2. ~~AI in the phone app~~ (done, via Gemini); sync between devices and image storage
3. Instagram Graph API: pull Insights automatically; optionally publish posts
