import type { APIRoute } from 'astro';
import { getPosts } from '../lib/cms/blog';
import { getContentPaths } from '../lib/cms/content';

export const prerender = false;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sitemap stránek z CMS (sitemap integrace vidí jen statické stránky). */
export const GET: APIRoute = async ({ site }) => {
	let posts, paths;
	try {
		[posts, paths] = await Promise.all([getPosts(), getContentPaths()]);
	} catch (error) {
		console.error('[sitemap-dynamic] Načtení článků selhalo.', error);
		return new Response('Obsah je dočasně nedostupný.', { status: 503 });
	}

	const origin = (site ?? new URL('https://foxhyn.com')).origin;
	const cmsUrls = paths.map((p) => `<url><loc>${escape(`${origin}${p.path}`)}</loc></url>`).join('');
	const urls = posts
		.map((p) => {
			const lastmod = (p.updatedDate ?? p.pubDate).toISOString();
			return `<url><loc>${escape(`${origin}/blog/${p.slug}/`)}</loc><lastmod>${lastmod}</lastmod></url>`;
		})
		.join('') + cmsUrls;

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
		{ headers: { 'content-type': 'application/xml' } },
	);
};
