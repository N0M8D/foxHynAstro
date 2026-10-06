#!/usr/bin/env node
/**
 * Jednorázová migrace obsahu webu (aktivity, psi, vrh A, chovatelská stanice) do sdíleného Payloadu.
 * Vytvoří kolekce groups, pages a profiles a nahraje obrázky z public/ do media.
 *
 * Výchozí je DRY-RUN (jen čte a vypíše plán, nic nenahrává). Zápis až s --apply.
 * Idempotentní: existující záznam (slug v tenantovi) se aktualizuje, existující obrázek se znovu nenahrává.
 *
 * Zdroje: src/content/{activities,puppies}/*.mdx a zkopírované původní stránky ve scripts/legacy/.
 *
 * Proměnné prostředí:
 *   PAYLOAD_URL            https://payload.czechnomad.cz
 *   PAYLOAD_WRITE_API_KEY  API klíč uživatele s právem zápisu (super-admin/editor); po migraci zrušit
 *   PAYLOAD_TENANT         slug tenanta (výchozí foxhyn)
 *   PAYLOAD_PUBLIC_URL     veřejná adresa Payloadu pro obrázky v textech (výchozí PAYLOAD_URL)
 *
 * Použití:
 *   node scripts/migrate-content-to-payload.mjs            # dry-run
 *   node scripts/migrate-content-to-payload.mjs --apply    # zápis
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import TurndownService from 'turndown';

const apply = process.argv.includes('--apply');
const payloadUrl = process.env.PAYLOAD_URL;
const apiKey = process.env.PAYLOAD_WRITE_API_KEY;
const tenantSlug = process.env.PAYLOAD_TENANT || 'foxhyn';
const publicUrl = (process.env.PAYLOAD_PUBLIC_URL || payloadUrl || '').replace(/\/$/, '');

if (!payloadUrl || !apiKey) {
	console.error('Chybí PAYLOAD_URL nebo PAYLOAD_WRITE_API_KEY.');
	process.exit(1);
}

const root = process.cwd();
const publicDir = path.join(root, 'public');
const legacy = (name) => readFile(path.join(root, 'scripts', 'legacy', name), 'utf-8');

const MIME = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.avif': 'image/avif',
	'.svg': 'image/svg+xml',
};
const MAX_SIDE = 2400;

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
	const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(120_000) });
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

// ---------- obrázky ----------

const imageCache = new Map(); // zdrojová cesta -> { id, url }
const missing = new Set();
let uploaded = 0;
let reused = 0;

/** /images/a/b/c.JPG -> a-b-c.jpg (unikátní název v rámci tenanta). */
function mediaFilename(src) {
	return src
		.replace(/^\/?images\//, '')
		.replace(/[\\/]+/g, '-')
		.toLowerCase();
}

async function ensureImage(src, alt, tenantId) {
	if (!src) return undefined;
	if (imageCache.has(src)) return imageCache.get(src);

	const filePath = path.join(publicDir, src);
	let buffer;
	try {
		buffer = await readFile(filePath);
	} catch {
		missing.add(src);
		return undefined;
	}

	const filename = mediaFilename(src);
	const ext = path.extname(filename);
	const mime = MIME[ext];
	if (!mime) {
		missing.add(`${src} (nepodporovaný typ)`);
		return undefined;
	}

	const { docs } = await api('GET', 'media', {
		query: { 'where[filename][equals]': filename, 'where[tenant][equals]': tenantId, limit: 1, depth: 0 },
	});
	if (docs[0]) {
		reused++;
		const result = { id: docs[0].id, url: docs[0].url };
		imageCache.set(src, result);
		return result;
	}

	if (!apply) {
		const result = { id: undefined, url: undefined };
		imageCache.set(src, result);
		uploaded++;
		return result;
	}

	if (ext !== '.svg' && ext !== '.gif') {
		// Originály z foťáku jsou obrovské; pro web stačí zmenšená verze.
		buffer = await sharp(buffer)
			.rotate()
			.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
			.toBuffer();
	}

	const form = new FormData();
	form.append('file', new Blob([buffer], { type: mime }), filename);
	form.append('_payload', JSON.stringify({ alt: alt || filename, tenant: tenantId }));
	const { doc } = await api('POST', 'media', { form });
	uploaded++;
	console.log(`    nahráno ${filename} (${Math.round(buffer.length / 1024)} kB)`);
	const result = { id: doc.id, url: doc.url };
	imageCache.set(src, result);
	return result;
}

async function ensureGallery(sources, alt, tenantId) {
	const rows = [];
	for (const src of sources ?? []) {
		const img = await ensureImage(src, alt, tenantId);
		if (img?.id) rows.push({ image: img.id });
	}
	return rows;
}

// ---------- záznamy ----------

async function getTenantId() {
	const { docs } = await api('GET', 'tenants', { query: { 'where[slug][equals]': tenantSlug, limit: 1, depth: 0 } });
	if (!docs[0]) throw new Error(`Tenant "${tenantSlug}" v Payloadu neexistuje.`);
	return docs[0].id;
}

async function upsert(collection, slug, data, tenantId) {
	const { docs } = await api('GET', collection, {
		query: { 'where[slug][equals]': slug, 'where[tenant][equals]': tenantId, draft: true, limit: 1, depth: 0 },
	});
	const existingId = docs[0]?.id;
	const doc = { tenant: tenantId, slug, _status: 'published', ...data };
	if (!apply) return { id: existingId, action: existingId ? 'aktualizace' : 'vytvoření' };
	if (existingId) {
		await api('PATCH', `${collection}/${existingId}`, { json: doc });
		return { id: existingId, action: 'aktualizace' };
	}
	const created = await api('POST', collection, { json: doc });
	return { id: created.doc.id, action: 'vytvoření' };
}

// ---------- převody obsahu ----------

const turndown = new TurndownService({ headingStyle: 'atx', emDelimiter: '*' });

function htmlBetween(html, startMarker, endMarker) {
	const start = html.indexOf(startMarker);
	if (start < 0) throw new Error(`Nenalezen začátek: ${startMarker}`);
	const from = start + startMarker.length;
	const end = html.indexOf(endMarker, from);
	if (end < 0) throw new Error(`Nenalezen konec: ${endMarker}`);
	return html.slice(from, end);
}

const toMarkdown = (html) => turndown.turndown(html.replace(/<!--[\s\S]*?-->/g, '')).trim();

/** MDX komponenta YouTubeEmbed -> čisté HTML (Markdown pak vykreslí marked). */
function convertMdx(body) {
	return body
		.replace(/^import .*$/gm, '')
		.replace(
			/<YouTubeEmbed\s+videoId="([^"]+)"(?:\s+title="([^"]*)")?\s*\/>/g,
			(_, id, title = '') =>
				`\n\n<div class="video-container"><iframe src="https://www.youtube.com/embed/${id}" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>\n\n`,
		)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Položky { title, href, imageUrl } z původních výpisů (pořadí a náhledy). */
function parseItems(source) {
	const items = [];
	const re = /title:\s*"([^"]*)",\s*href:\s*"([^"]*)",\s*imageUrl:\s*"([^"]*)"/g;
	let m;
	while ((m = re.exec(source))) items.push({ title: m[1], href: m[2], imageUrl: m[3] });
	return items;
}

const slugOf = (href) => href.replace(/\/$/, '').split('/').pop();

const markdownImage = (alt, media) => (media?.url ? `\n\n![${alt}](${publicUrl}${media.url})` : '');

// ---------- běh ----------

console.log(`${apply ? 'ZÁPIS' : 'DRY-RUN'} -> ${payloadUrl}, tenant "${tenantSlug}"\n`);
const tenantId = await getTenantId();
const groupIds = {};
const failures = [];

async function step(label, fn) {
	try {
		const result = await fn();
		console.log(`- ${label}: ${result}`);
	} catch (error) {
		failures.push(label);
		console.error(`- ${label}: CHYBA ${error.message}`);
	}
}

// 1) Skupiny
const stationHtml = await legacy('chovatelskaStanice_index.astro');
const litterHtml = await legacy('chovatelskaStanice_vrhA_index.astro');
const dogsSource = await legacy('myDogs.astro');
const activitiesIndex = await legacy('activities_index.astro');

await step('skupina chovatelska-stanice', async () => {
	const body0 = toMarkdown(htmlBetween(stationHtml, '<h2>✨ Jak vzniklo', '</div>').replace(/^/, '<h2>✨ Jak vzniklo'));
	const cert = await ensureImage('/images/chovatelska_stanice/chovatelska_stanice.jpg', 'Certifikát chovatelské stanice Foxhyn', tenantId);
	const body = body0 + markdownImage('Certifikát chovatelské stanice Foxhyn', cert);
	const r = await upsert('groups', 'chovatelska-stanice', { title: 'Chovatelská stanice Foxhyn', order: 0, body }, tenantId);
	groupIds['chovatelska-stanice'] = r.id;
	return `${r.action}; ${body.length} znaků`;
});

await step('skupina activities', async () => {
	const intro = activitiesIndex.match(/activities__intro">\s*([\s\S]*?)\s*<\/p>/)?.[1].replace(/\s+/g, ' ') ?? '';
	const r = await upsert('groups', 'activities', { title: 'Aktivity', description: intro, order: 1 }, tenantId);
	groupIds.activities = r.id;
	return r.action;
});

await step('skupina smecka', async () => {
	const intro = dogsSource.match(/<p class="intro">\s*([\s\S]*?)\s*<\/p>/)?.[1].replace(/\s+/g, ' ') ?? '';
	const r = await upsert('groups', 'smecka', { title: 'Moje smečka', description: intro, order: 2 }, tenantId);
	groupIds.smecka = r.id;
	return r.action;
});

await step('skupina vrhA', async () => {
	const body0 = toMarkdown(htmlBetween(litterHtml, '<div class="vrh-a__text">', '</div>'));
	const poster = await ensureImage('/images/chovatelska_stanice/vrhA/plakat_kerka.png', 'Plakát vrhu', tenantId);
	const cover = await ensureImage('/images/chovatelska_stanice/vrhA/vrhA_nahled.jpg', 'Vrh A', tenantId);
	const body = body0 + markdownImage('Plakát vrhu', poster);
	const r = await upsert(
		'groups',
		'vrhA',
		{ title: 'Vrh A', order: 0, parent: groupIds['chovatelska-stanice'], body, ...(cover?.id ? { image: cover.id } : {}) },
		tenantId,
	);
	groupIds.vrhA = r.id;
	return `${r.action}; ${body.length} znaků`;
});

// 2) Stránky: aktivity
const activityItems = parseItems(activitiesIndex);
const activityFiles = (await readdir(path.join(root, 'src', 'content', 'activities'))).filter((f) => /\.mdx?$/.test(f)).sort();
for (const file of activityFiles) {
	const slug = file.replace(/\.mdx?$/, '');
	await step(`aktivita ${slug}`, async () => {
		const { data, content } = matter(await readFile(path.join(root, 'src', 'content', 'activities', file), 'utf-8'));
		const orderIdx = activityItems.findIndex((i) => slugOf(i.href) === slug);
		const item = activityItems[orderIdx];
		const cover = item ? await ensureImage(item.imageUrl, data.title, tenantId) : undefined;
		const gallery = await ensureGallery(data.gallery, data.title, tenantId);
		const r = await upsert(
			'pages',
			slug,
			{
				title: data.title,
				summary: data.description || '',
				body: convertMdx(content),
				group: groupIds.activities,
				order: orderIdx >= 0 ? orderIdx : 99,
				gallery,
				...(cover?.id ? { image: cover.id } : {}),
			},
			tenantId,
		);
		return `${r.action}; galerie ${data.gallery?.length ?? 0}; obrázek ${item ? 'ano' : 'ne'}`;
	});
}

// 3) Profily: štěňata vrhu A
const litterItems = parseItems(litterHtml);
const puppyFiles = (await readdir(path.join(root, 'src', 'content', 'puppies'))).filter((f) => /\.mdx?$/.test(f)).sort();
const puppySlugs = new Set(puppyFiles.map((f) => f.replace(/\.mdx?$/, '')));

const formatDate = (value) => new Date(value).toLocaleDateString('cs-CZ', { timeZone: 'UTC' });
const fact = (label, value) => (value ? [{ label, value: String(value) }] : []);

for (const file of puppyFiles) {
	const slug = file.replace(/\.mdx?$/, '');
	await step(`štěně ${slug}`, async () => {
		const { data, content } = matter(await readFile(path.join(root, 'src', 'content', 'puppies', file), 'utf-8'));
		const orderIdx = litterItems.findIndex((i) => slugOf(i.href) === slug);
		const item = litterItems[orderIdx];
		const cover = item ? await ensureImage(item.imageUrl, data.name, tenantId) : undefined;
		const gallery = await ensureGallery(data.gallery, data.name, tenantId);
		const facts = [
			...fact('Plemeno:', data.breed),
			...fact('Datum narození:', data.born && formatDate(data.born)),
			...fact('Matka:', data.parents?.mom),
			...fact('Otec:', data.parents?.dad),
			...fact('Srst:', data.coat),
			...fact('Zdraví:', data.health),
			...fact('Aktivity:', data.activities),
			...fact('Tituly:', data.titles),
			...fact('Závody:', data.shows),
		];
		const r = await upsert(
			'profiles',
			slug,
			{
				name: data.name,
				title: data.title,
				group: groupIds.vrhA,
				order: orderIdx >= 0 ? orderIdx : 99,
				facts,
				body: content.trim(),
				gallery,
				...(cover?.id ? { image: cover.id } : {}),
			},
			tenantId,
		);
		return `${r.action}; údajů ${facts.length}; galerie ${data.gallery?.length ?? 0}`;
	});
}

// 4) Profily: smečka (pole `dogs` z původní stránky myDogs.astro)
const dogsLiteral = dogsSource.match(/const dogs = (\[[\s\S]*?\n\]);/)?.[1];
if (!dogsLiteral) throw new Error('V scripts/legacy/myDogs.astro nenalezeno pole dogs.');
const dogs = new Function(`return ${dogsLiteral}`)();

for (const [index, dog] of dogs.entries()) {
	const dir = dog.imageUrl.split('/').slice(-2, -1)[0];
	const slug = puppySlugs.has(dir) ? `${dir}-smecka` : dir;
	await step(`pes ${slug}`, async () => {
		const cover = await ensureImage(dog.imageUrl, dog.name, tenantId);
		const facts = dog.details.map((d) => ({ label: d.label ?? '', value: d.value }));
		const body = dog.description.map((p) => p.trim()).filter(Boolean).join('\n\n');
		const r = await upsert(
			'profiles',
			slug,
			{
				name: dog.name,
				group: groupIds.smecka,
				order: index,
				facts,
				body,
				...(cover?.id ? { image: cover.id } : {}),
			},
			tenantId,
		);
		return `${r.action}; údajů ${facts.length}; ${body.length} znaků`;
	});
}

console.log(`\nObrázky: ${uploaded} ${apply ? 'nahráno' : 'k nahrání'}, ${reused} už v Payloadu.`);
if (missing.size) {
	console.log(`Chybějící soubory (${missing.size}):`);
	for (const m of missing) console.log(`  ! ${m}`);
}
console.log(`\nHotovo${apply ? '' : ' (nic nebylo zapsáno, přidej --apply)'}.`);
if (failures.length) {
	console.error(`Selhalo: ${failures.join(', ')}`);
	process.exit(1);
}
