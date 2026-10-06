/** Dosavadní zdroj (Strapi); zůstává jako záloha, dokud se obsah nepřepne na Payload. */
import type { BlogPost } from './blog';
import { env } from './env';

function slugify(input: string) {
	return input
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

const baseUrl = () => env('STRAPI_URL') || 'http://localhost:1337';

function toAbsoluteUrl(url?: string) {
	if (!url) return undefined;
	return url.startsWith('http') ? url : `${baseUrl()}${url}`;
}

export function extractMediaUrl(media: any): string | undefined {
	if (!media) return undefined;
	if (Array.isArray(media)) return extractMediaUrl(media[0]);
	if (typeof media === 'string') return toAbsoluteUrl(media);
	if (Array.isArray(media?.data)) return extractMediaUrl(media.data[0]);
	return toAbsoluteUrl(media?.data?.attributes?.url ?? media?.attributes?.url ?? media?.url);
}

function extractMediaUrls(media: any): string[] {
	if (!media) return [];
	const items = Array.isArray(media)
		? media
		: Array.isArray(media?.data)
			? media.data
			: media?.data
				? [media.data]
				: [];
	return items.map(extractMediaUrl).filter((u: string | undefined): u is string => Boolean(u));
}

export async function fetchStrapiRaw(): Promise<any[]> {
	const url = new URL(`${baseUrl()}/api/fox-hyn-posts`);
	url.searchParams.set('populate', '*');
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${env('STRAPI_TOKEN') || ''}` },
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) throw new Error(`Strapi -> ${res.status}`);
	return (await res.json()).data;
}

export async function fetchStrapiPosts(): Promise<BlogPost[]> {
	const data = await fetchStrapiRaw();
	return data.map((item) => {
		const a = item.attributes || item;
		const documentId = String(item.documentId ?? a.documentId ?? item.id);
		const explicit = typeof a.slug === 'string' ? a.slug.trim() : '';
		const base = slugify(typeof a.title === 'string' ? a.title : '');
		const generated = base ? `${base}-${documentId.slice(0, 8)}` : documentId.slice(0, 8);
		const slug = explicit || generated;
		return {
			slug,
			legacySlugs: slug !== documentId ? [documentId] : [],
			title: a.title,
			description: a.description ?? '',
			pubDate: new Date(a.pubDate),
			updatedDate: a.updatedAt ? new Date(a.updatedAt) : undefined,
			heroImage: extractMediaUrl(a.heroImage),
			content: a.body ?? '',
			author: typeof a.author === 'string' ? a.author : undefined,
			gallery: extractMediaUrls(a.gallery),
		};
	});
}
