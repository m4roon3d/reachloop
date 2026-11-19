# reachloop

Personal Instagram helper for a photographer. `public/index.html` is the whole app (single file, no build). See README.md.

It ships two ways from the same file:
- **Installable web app (PWA)** on Cloudflare Pages: build output directory `public`, no build command. Data stays on the device (IndexedDB), with backup/restore in Profile. AI features run through the Pages Function `functions/api/ai.js`, which calls Gemini; the app talks to it through a stand-in for Claude's `sample` interface (`makeWebSample`), so every AI feature uses one code path.
- **Claude artifact**: syncs via the artifact runtime and has the Claude features. Its link and slug are in the private claude.ai Project "reachloop" (doc `claude/deploy-notes.md`), not in this public repo.

## Ship
target: cloudflare
merge: direct-to-main
checks: `node --check` on the app script; unit-test functions/api/ai.js with a mocked fetch; serve public/ on localhost and load it in headless Chrome: no page errors; service worker registers; a post survives a reload; backup downloads and restores; AI passcode flow works against a mocked /api/ai
release: bump VERSION in public/sw.js whenever any file in public/ changes
preview: Cloudflare Pages deploys main automatically (production) and gives preview URLs for other branches; after pushing, also republish public/index.html to the Claude artifact (link in the Project's deploy notes)

## Public repo
This repository is public. Never commit:
- API keys, passcodes, tokens or any secret (they live only in Cloudflare; local secrets go in `.dev.vars`, which is gitignored)
- personal details (email, phone, address, location history, photos)
- unannounced plans, launch dates or business details for hodlr or other projects
Before committing, scan the diff for anything that looks like a key (e.g. `AIza…`, `sk-…`) or personal data.

## Notes
- Cloudflare secrets for AI: `GEMINI_API_KEY`, `APP_PASSCODE`; optional `GEMINI_MODEL`; optional `OPENROUTER_API_KEY` (free NVIDIA Nemotron backup, used only when Gemini fails and the workspace allows it; free endpoints log prompts, so it defaults off for product workspaces) and `OPENROUTER_MODEL`. Never put keys in the app or the repo.
- UI text says `${AI}` ("Claude" inside Claude, "AI" in the installed app); prompts stay model-neutral.
- Keep the app one self-contained file; PWA extras live beside it in public/ (manifest.webmanifest, sw.js, icons/, _headers).
- The code must run in both places: inside Claude (`window.claude.use`, framed) and standalone (no `window.claude`). Never register the service worker inside Claude.
- Instagram allows at most 5 hashtags per post; keep that limit in prompts and checks.
