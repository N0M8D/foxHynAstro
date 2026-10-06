#!/usr/bin/env node
/**
 * Jednorázová migrace blogových článků ze Strapi do sdíleného Payload CMS.
 *
 * Výchozí je DRY-RUN (jen čte a vypíše plán). Zápis až s --apply.
 * Idempotentní: existující článek (stejný slug v tenantovi) se aktualizuje, existující obrázek
 * (stejný název souboru v tenantovi) se znovu nenahrává.
 *
 * Proměnné prostředí:
 *   STRAPI_URL, STRAPI_TOKEN   zdroj (dosažitelný z tohoto počítače)
 *   PAYLOAD_URL                https://payload.czechnomad.cz
 *   PAYLOAD_WRITE_API_KEY      API klíč uživatele s právem zápisu (super-admin/editor); po migraci zrušit
 *   PAYLOAD_TENANT             slug tenanta (výchozí foxhyn)
 *
 * Použití:
 *   node scripts/migrate-posts-to-payload.mjs            # dry-run
 *   node scripts/migrate-posts-to-payload.mjs --apply    # zápis
 *   node scripts/migrate-posts-to-payload.mjs --only=<slug>
 *
 * Pole `gallery` a `author` se odesílají, ale Payload je uloží jen pokud je kolekce `posts`
 * má definovaná; jinak je tiše zahodí (viz poznámka na konci běhu).
 * Obrázky uvnitř těla článků se nepřepisují.
 */
import path from 'node:path';

const apply = process.argv.includes('--apply');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const strapiUrl = (process.env.STRAPI_URL || '').replace(/\/$/, '');
const strapiToken = process.env.STRAPI_TOKEN || '';
const payloadUrl = process.env.PAYLOAD_URL;
const apiKey = process.env.PAYLOAD_WRITE_API_KEY;
const tenantSlug = process.env.PAYLOAD_TENANT || 'foxhyn';

if (!strapiUrl || !payloadUrl || !apiKey) {
	console.error('Chybí STRAPI_URL, PAYLOAD_URL nebo PAYLOAD_WRITE_API_KEY.');
	process.exit(1);
}

const MIME = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.avif': 'image/avif',
	'.svg': 'image/svg+xml',
};

async function api(method, apiPath, { query, json, form } = {}) {
	const url = new URL(`/api/${apiPath}`, payloadUrl);
	for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
	const headers = { Authorization: `users API-Key ${apiKey}` };
	let body;
	if (json) {
		headers['content-type'] = 'application/json';
		body = JSON.stringify(json);
	} else if (form) {
		body = form;
	}
	const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(60_000) });
	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { raw: text };
	}
	if (!res.ok) {
		const detail = data?.errors?.map((e) => e.message || JSON.stringify(e)).join('; ') || text.slice(0, 300);
		throw new Error(`${method} ${apiPath} -> ${res.status}: ${detail}`);
	}
	return data;
}

const abs = (u) => (u?.startsWith('http') ? u : u ? `${strapiUrl}${u}` : undefined);

function mediaUrls(media) {
	if (!media) return [];
	const items = Array.isArray(media) ? media : Array.isArray(media?.data) ? media.data : media?.data ? [media.data] : [media];
	return items.map((m) => abs(m?.attributes?.url ?? m?.url)).filter(Boolean);
}

function slugify(input) {
	return String(input ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

async function getTenantId() {
	const { docs } = await api('GET', 'tenants', { query: { 'where[slug][equals]': tenantSlug, limit: 1, depth: 0 } });
	if (!docs[0]) throw new Error(`Tenant "${tenantSlug}" v Payloadu neexistuje.`);
	return docs[0].id;
}

async function findMediaId(filename, tenantId) {
	const { docs } = await api('GET', 'media', {
		query: { 'where[filename][equals]': filename, 'where[tenant][equals]': tenantId, limit: 1, depth: 0 },
	});
	return docs[0]?.id;
}

/** Stáhne obrázek ze Strapi a nahraje ho do Payloadu. V dry-runu id nevzniká. */
async function ensureImage(url, alt, tenantId) {
	const filename = decodeURIComponent(path.basename(new URL(url).pathname));
	const mime = MIME[path.extname(filename).toLowerCase()];
	if (!mime) return { note: `nepodporovaný typ: ${filename}` };

	const existing = await findMediaId(filename, tenantId);
	if (existing) return { id: existing, note: `už je v Payloadu (${filename})` };
	if (!apply) return { note: `nahraje ${filename}` };

	const res = await fetch(url, { headers: { Authorization: `Bearer ${strapiToken}` }, signal: AbortSignal.timeout(60_000) });
	if (!res.ok) return { note: `STAŽENÍ SELHALO ${res.status}: ${url}` };
	const form = new FormData();
	form.append('file', new Blob([await res.arrayBuffer()], { type: mime }), filename);
	form.append('_payload', JSON.stringify({ alt: alt || filename, tenant: tenantId }));
	const { doc } = await api('POST', 'media', { form });
	return { id: doc.id, note: `nahráno ${filename}` };
}

async function findPostId(slug, tenantId) {
	const { docs } = await api('GET', 'posts', {
		query: { 'where[slug][equals]': slug, 'where[tenant][equals]': tenantId, draft: true, limit: 1, depth: 0 },
	});
	return docs[0]?.id;
}

const strapiRes = await fetch(`${strapiUrl}/api/fox-hyn-posts?populate=*&pagination[pageSize]=200`, {
	headers: { Authorization: `Bearer ${strapiToken}` },
});
if (!strapiRes.ok) {
	console.error(`Strapi vrátilo ${strapiRes.status}.`);
	process.exit(1);
}
const items = (await strapiRes.json()).data;

console.log(`${apply ? 'ZÁPIS' : 'DRY-RUN'} -> ${payloadUrl}, tenant "${tenantSlug}", články: ${items.length}\n`);
const tenantId = await getTenantId();
const failures = [];
let processed = 0;

for (const item of items) {
	const a = item.attributes || item;
	const documentId = String(item.documentId ?? a.documentId ?? item.id);
	// Stejná logika jako web (src/lib/cms/strapi.ts), aby se URL nezměnily.
	const explicit = typeof a.slug === 'string' ? a.slug.trim() : '';
	const base = slugify(a.title);
	const slug = explicit || (base ? `${base}-${documentId.slice(0, 8)}` : documentId.slice(0, 8));
	if (only && slug !== only) continue;
	processed++;

	try {
		for (const field of ['title', 'description', 'pubDate']) {
			if (!a[field]) throw new Error(`chybí pole "${field}"`);
		}

		const cover = (await Promise.all(mediaUrls(a.heroImage).slice(0, 1).map((u) => ensureImage(u, a.title, tenantId))))[0];
		const galleryResults = [];
		for (const u of mediaUrls(a.gallery)) galleryResults.push(await ensureImage(u, a.title, tenantId));
		const galleryIds = galleryResults.map((g) => g.id).filter(Boolean);

		const doc = {
			tenant: tenantId,
			title: a.title,
			slug,
			publishedAt: new Date(a.pubDate).toISOString(),
			summary: a.description,
			body: String(a.body ?? '').trim(),
			_status: 'published',
			...(cover?.id ? { image: cover.id } : {}),
			...(typeof a.author === 'string' && a.author ? { author: a.author } : {}),
			...(galleryIds.length ? { gallery: galleryIds.map((id) => ({ image: id })) } : {}),
		};

		const existingId = await findPostId(slug, tenantId);
		console.log(
			`- ${slug}: ${existingId ? 'aktualizace' : 'vytvoření'}; titulní: ${cover?.note ?? 'bez obrázku'}; galerie: ${galleryResults.length}; ${doc.body.length} znaků`,
		);
		for (const g of galleryResults.filter((r) => /SELHALO|nepodporovan/.test(r.note))) console.log(`    ! ${g.note}`);

		if (apply) {
			if (existingId) await api('PATCH', `posts/${existingId}`, { json: doc });
			else await api('POST', 'posts', { json: doc });
		}
	} catch (error) {
		failures.push(slug);
		console.error(`- ${slug}: CHYBA ${error.message}`);
	}
}

console.log(`\nHotovo. ${processed - failures.length}/${processed} v pořádku${apply ? '' : ' (nic nebylo zapsáno, přidej --apply)'}.`);
console.log('Pozn.: pokud kolekce posts v Payloadu nemá pole "gallery"/"author", se zahodí.');
if (failures.length) {
	console.error(`Selhalo: ${failures.join(', ')}`);
	process.exit(1);
}
