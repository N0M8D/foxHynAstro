# foxhyn.com – dokumentace pro agenty

Astro 5 web (foxhyn.com), běží jako Docker kontejner v Portaineru za nginx-proxy. Obsah blogu se čte za běhu ze sdíleného Payload CMS (`https://payload.czechnomad.cz`, tenant `foxhyn`).

## Architektura
- Výstup je **statický + SSR** (`@astrojs/node`, standalone). Statické: úvod, o nás, aktivity, štěňata atd. (MDX v `src/content/`). SSR (`prerender = false`): `/blog`, `/blog/[...slug]`, `/rss.xml`, `/sitemap-blog.xml`, `/api/*`.
- **Build nesmí záviset na CMS ani na tajemstvích.** Obsah blogu se načítá až za běhu.
- `src/lib/cms/`: `env.ts` (čtení env za běhu), `payload.ts` (klient, API key), `strapi.ts` (původní zdroj, záloha), `blog.ts` (společný tvar `BlogPost`, `getPosts`, `findPost`), `cache.ts` (paměťová cache, TTL 5 min, stale-if-error).
- `CONTENT_SOURCE=strapi|payload` (výchozí `strapi`). Přepnutí = změna env v Portaineru + redeploy, vratné.
- `/api/revalidate` (POST, hlavička `x-revalidate-secret`) maže cache; volá ho Payload hook. `/api/health` je healthcheck.
- Staré URL článků (Strapi `documentId`) se přesměrují 301 na slug.

## Nasazení
GitHub Actions (`.github/workflows/docker.yml`) při pushi do `main` staví image `ghcr.io/n0m8d/foxhynastro` (`latest`, `sha-…`). Portainer jen stahuje (stack z `docker-compose.yml`). Sítě: externí `nginx-proxy` a `payload-net` (musí existovat). Proměnné: `.env.example`. Nová proměnná = `.env.example` + compose + upozornit majitele.

## Migrace Strapi → Payload
`scripts/migrate-posts-to-payload.mjs` (dry-run výchozí, `--apply`, idempotentní). Env: `STRAPI_URL`, `STRAPI_TOKEN`, `PAYLOAD_URL`, `PAYLOAD_WRITE_API_KEY`, `PAYLOAD_TENANT`. Po migraci write klíč zrušit.

## Otevřené
- Kolekce `posts` v Payloadu nemá pole `gallery` a `author` → galerie a autor se z Payloadu nezobrazí, dokud se nepřidají (repo `A:\Dev\payload\payload-cms`, migrace s falešnou `DATABASE_URL`, nikdy proti produkci).
- Cache je jen v paměti (po restartu prázdná). Při výpadku Payloadu těsně po startu vrací blog 503. Případně doplnit diskový snapshot.
- Obrázky ze CMS se bez Payloadu nenačtou.
- Zálohy DB a volume `payload_media`, monitoring `https://payload.czechnomad.cz/api/media?limit=1`.
- Po ověření Payloadu odstranit Strapi (`src/lib/cms/strapi.ts`, env `STRAPI_*`) a nepoužívané `src/content/blog/*.mdx`.

## Pasti
- `docker build` neběží v compose sítích; nikdy nevolat CMS při buildu.
- POST na `/api/revalidate` musí mít `content-type: application/json` (Astro blokuje cross-site form POST).
- Skript pro Payload repo: lokální příkazy v PowerShellu, VPS v bashi; pnpm 10.18.3.
- nginx-proxy omezuje upload na Payloadu na 1 MB (`client_max_body_size 50m` ve `vhost.d/payload.czechnomad.cz`) – týká se migrace obrázků.
