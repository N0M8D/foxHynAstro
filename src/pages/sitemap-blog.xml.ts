import type { APIRoute } from 'astro';
import { getPosts } from '../lib/cms/blog';

export const prerender = false;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sitemap blogových článků (sitemap integrace vidí jen statické stránky). */
export const GET: APIRoute = async ({ site }) => {
	let posts;
	try {
		posts = await getPosts();
	} catch (error) {
		console.error('[sitemap-blog] Načtení článků selhalo.', error);
		return new Response('Obsah je dočasně nedostupný.', { status: 503 });
	}

	const origin = (site ?? new URL('https://foxhyn.com')).origin;
	const urls = posts
		.map((p) => {
			const lastmod = (p.updatedDate ?? p.pubDate).toISOString();
			return `<url><loc>${escape(`${origin}/blog/${p.slug}/`)}</loc><lastmod>${lastmod}</lastmod></url>`;
		})
		.join('');

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
		{ headers: { 'content-type': 'application/xml' } },
	);
};
