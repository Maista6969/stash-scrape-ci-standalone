# scrape-ci-standalone

Automated scraper validation, but scaled up

## improvements

- image caching (31d)
- persistent scrape storage (to mongodb)
- per-use apikey with ratelimits (200 scrapes/day)
- runs through commercial VPN

## Differences

- only supports scenes types

## infra

- mongodb for storage
- valkey for ratelimit monitoring
- byparr for cloudflare bypass
- gluetun for VPN

## deploying

Start from `.env.example`, `deploy/docker-compose.example.yml`, and
`deploy/gluetun.env.example`. API keys, their usage, and recent scrapes are manageable at
`/admin.html` (auth with `ADMIN_KEY`) instead of raw API calls
