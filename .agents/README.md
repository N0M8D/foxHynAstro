# foxhyn.com – dokumentace pro agenty

Astro 5 web (foxhyn.com), běží jako Docker kontejner v Portaineru za nginx-proxy. Obsah blogu se čte za běhu ze sdíleného Payload CMS (`https://payload.czechnomad.cz`, tenant `foxhyn`).

## Architektura
- Výstup je **statický + SSR** (`@astrojs/node`, standalone). Statické: úvod, o nás, soukromí (texty v kódu). SSR (`prerender = false`, obsah z Payloadu): `/blog`, `/activities`, `/myDogs`, `/chovatelskaStanice`, `/chovatelskaStanice/[group]` (vrhy), `/rss.xml`, `/sitemap-dynamic.xml`, `/api/*`.
- **Build nesmí záviset na CMS ani na tajemstvích.** Obsah blogu se načítá až za běhu.
- `src/lib/cms/`: `env.ts` (čtení env za běhu), `payload.ts` (klient, API key), `strapi.ts` (původní zdroj, záloha), `blog.ts` (společný tvar `BlogPost`, `getPosts`, `findPost`), `cache.ts` (paměťová cache, TTL 5 min, stale-if-error).
- `CONTENT_SOURCE=strapi|payload` (výchozí `strapi`). Přepnutí = změna env v Portaineru + redeploy, vratné.
- Obecné kolekce Payloadu (`src/lib/cms/content.ts`): `groups` (oddíly s úvodem, podskupiny přes `parent`), `pages` (Markdown + galerie), `profiles` (volný seznam `facts` štítek–hodnota + galerie). Mapování na web: skupina `activities` + stránky = `/activities/*`; skupina `smecka` + profily = `/myDogs`; skupina `chovatelska-stanice` (podskupiny = vrhy, např. `vrhA`; profily vrhu = štěňata) = `/chovatelskaStanice/*`. Slugy těchto skupin jsou v kódu pevně.
- `/api/revalidate` (POST, hlavička `x-revalidate-secret`) maže cache; volá ho Payload hook. `/api/health` je healthcheck.
- Staré URL článků (Strapi `documentId`) se přesměrují 301 na slug.

## Nasazení
GitHub Actions (`.github/workflows/docker.yml`) při pushi do `main` staví image `ghcr.io/n0m8d/foxhynastro` (`latest`, `sha-…`). Portainer jen stahuje (stack z `docker-compose.yml`). Sítě: externí `nginx-proxy` a `payload-net` (musí existovat). Proměnné: `.env.example`. Nová proměnná = `.env.example` + compose + upozornit majitele.

## Migrace obsahu do Payloadu
- Blog: `scripts/migrate-posts-to-payload.mjs` (ze Strapi).
- Aktivity, psi, vrh A, chovatelská stanice: `scripts/migrate-content-to-payload.mjs` (z `src/content/*` a `scripts/legacy/*`, obrázky z `public/images` se zmenšují a nahrávají do `media`). Dry-run výchozí, `--apply`, idempotentní. Po migraci smazat `scripts/legacy/`, `src/content/activities|puppies` a obrázky v `public/images` (kromě `brand` a těch, které používají statické stránky).
- Nutné pořadí: nasadit Payload s kolekcemi → migrace → až potom nasadit web (jinak vrací tyto stránky 404/503).

## Migrace Strapi → Payload (blog)
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
