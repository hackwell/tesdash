# Tesdash (server-backed fork)

Fork of [crstian19/tesdash](https://github.com/crstian19/tesdash), a dashboard for Tesla's in-car browser.
This fork keeps only the app grid and moves all settings from the browser's localStorage to the server,
so every device sees the same dashboard.

## What changed

- Header, URL launcher, clock, language/region picker, charging calculator, support/about/FAQ modals,
  analytics, `/me` and `/legal` are gone. The page is just the app cards.
- A small Bun server (`server/index.ts`) serves the built page and one shared JSON document:
  - `GET /api/state` – categories and apps
  - `PUT /api/state` – replace the document; requires the current `revision`, answers `409` with the newer
    state when another device saved in between
  - logo colors are computed in the browser (canvas); the server never fetches remote URLs
- Edit mode (pencil button): add, edit and delete apps, rename and delete categories, drag cards between
  categories and categories by their handle. On touch screens hold a card briefly to pick it up.
- Home bar (optional): car status and house controls from Home Assistant, configured in `home.json`
  (see `home.example.json`). Only the listed entities are exposed; covers open/close, lights and switches toggle.
  Tiles with `hold` need a long press, tiles with `geofenceMeters` only act when the browser's position (the car's
  GPS) is that close to HA's home location. Needs `HA_URL` and `HA_TOKEN`; without them the bar is hidden.
- Layout targets the car browser's 773 × 601 split view (Chromium 148, DPR 1.53, reports `hover` although it is a
  touchscreen): flat cards, no blur or hover effects, 48 px touch targets.
- There is no login. Put the server behind an authenticating reverse proxy (here: Authentik forward auth).

## Run

```sh
docker build -t tesdash .
docker run -p 3000:3000 -v tesdash-data:/data tesdash
```

On first start the state is seeded from `src/data/config.yml`, keeping apps available in `SEED_REGION`
(default `DE`). After that `config.yml` is no longer read; edit through the UI.

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `STATE_FILE` | `/data/state.json` | the persisted dashboard |
| `SEED_REGION` | `DE` | country filter for the first seed |
| `HOME_CONFIG` | `/app/home.json` | house tiles and status entities |
| `HA_URL`, `HA_TOKEN` | – | Home Assistant base URL and long-lived token |

## Develop

```sh
bun install
bun --bun run build   # Astro needs Node >= 22.22; --bun runs it on Bun instead
bun run start         # STATE_FILE=./state.json for local runs
bun test src server          # unit tests
bunx playwright test  # end-to-end tests against the real server, a throwaway state file and a mock Home Assistant
```

MIT licensed, like the original.
