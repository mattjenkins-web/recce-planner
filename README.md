# Handoff: Recce Planner (shoot light-scouting tool)

## Overview
A browser tool for DOPs/clients to pick camera positions for a shoot. Left column: current frame photo, 3-star rating, thumbnail filmstrip, comments. Right column: Esri satellite map with geotagged pins and a live sun-path ring for the shoot date. Built for job "Eats Eats Phew — C7 Promo" at the MCG, but designed to extend to multiple jobs/locations.

## About the design files
`Recce.dc.html` is a **working prototype**, not a placeholder mock — it's a real, functioning single-file HTML app (React-based "Design Component" runtime + `support.js`). It is intended to become the actual production site, deployed as-is (or lightly adapted) to Netlify — this is NOT a "recreate this in React" handoff. Read it as the app's current source.

- `Recce.dc.html` — main app (map, frames, sun path, comments, rating, editable job title/location/date)
- `photo-sun.js` — sun-position math (azimuth/elevation) used for the sun ring and cones
- `support.js` — runtime shim the DC format needs to execute as a plain HTML page (keep as-is, load order matters — see `<head>` of Recce.dc.html)
- `photos/` — the 20 scouted stills for this job (`shot-01.jpg`...`shot-20.jpg`)

## Fidelity
High-fidelity and functional — colors, type, layout, and interactions (map, rating, comments, editable fields) are final, not sketches.

## Repo / deploy target
- GitHub repo: `mattjenkins-web/recce-planner` (empty — nothing pushed yet)
- Intended host: Netlify, connected to that repo for auto-deploy on push
- Eventually embedded on the user's Squarespace site via iframe/embed block pointing at the Netlify URL

## What's built
- Frame info, 3-star rating (multi-click toggle, live count), All-20/star-filter pill
- Draggable thumbnail filmstrip with per-thumb star + comment icons
- Comments panel per frame, name-prompt modal on first rate/comment (saved to localStorage), initials badge once signed in
- Leaflet + Esri satellite/terrain map, draggable resizer between columns, adjustable map opacity/mode/labels via bottom control bar
- Sun-path ring (Sun-Seeker style hourly arrows) computed from `photo-sun.js`, keyed off an **editable shoot date** (click the date to change it — recalculates sun path live)
- Editable job title (click to rename)
- Location pills under the job title with a "+" to add a new named location; non-MCG locations currently show an empty state ("No frames scouted here yet") in place of the photo/comments panel — the map itself doesn't yet re-scope per location

## What Claude Code should build next
1. **Get it live**: `git init`/push this bundle's contents to `mattjenkins-web/recce-planner` as `index.html` + assets, connect the repo to Netlify (new site → import from GitHub), confirm auto-deploy on push.
2. **Photo uploads**: replace the static `photos/` folder + hardcoded `SHOTS` array with real upload — drag-and-drop into the per-location empty state, storing images + GPS/EXIF (lat/lon/bearing/tilt/lens/time) to a backend. Needs a small serverless function + object storage (Cloudflare Workers + R2, or Netlify Functions + S3/Supabase) since Netlify alone is static-only.
3. **Dropbox sync (phase 2)**: folder structure `(Job Name)/(Location Name)/`, Dropbox App + webhook → serverless relay → same storage/backend as #2, so new files dropped in Dropbox appear in the tool without a manual re-scout step.
4. **Multi-location data model**: currently only `mcg` has real shot data hardcoded in `SHOTS`; extend so each location in the `locations` array owns its own shots/map center/bounds, and the map actually re-centers/re-populates when switching location pills.
5. **Persistence**: ratings/comments/username currently live in `localStorage` only (per-browser, not shared) — move to the same backend once one exists, so comments/ratings are shared across the team.

## Design tokens
Colors/type come from the "Organic" design system CSS variables loaded in `<helmet>` (`_ds/organic-.../styles.css` + `_ds_bundle.js`) plus a small local `PALETTES` array in `Recce.dc.html` (6 selectable UI palettes, `pal` state index) that maps to CSS custom properties like `--ui-panel`, `--ui-ink`, `--ui-accent`, `--ui-sun`, etc. — see the `applyPalette` method and the `PALETTES` constant near the top of the script.

## Files in this bundle
- `Recce.dc.html` — the app
- `photo-sun.js`, `support.js` — supporting scripts it loads
- `photos/` — the 20 reference stills
- `github.md` — records the intended repo/deploy association
