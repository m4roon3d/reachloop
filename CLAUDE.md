# reachloop

Personal Instagram helper for a photographer. `index.html` is the whole app (single file, no build). See README.md.

## Ship
target: artifact
merge: direct-to-main
checks: load index.html in headless Chrome and confirm no page errors
release: none
preview: the live app is the claude.ai artifact https://claude.ai/artifact/MyAyQv46hUBi5zB6gZzdmU (slug a9ce91f6-999d-4d6f-b4ea-221c2015d0ab); republish index.html there after each change

## Notes
- Keep the app one self-contained file until the PWA work starts.
- The Claude features rely on the artifact runtime (`window.claude.use`); code must render without it.
- Instagram allows at most 5 hashtags per post; keep that limit in prompts and checks.
