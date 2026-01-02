import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';
import fetchApi from './lib/strapi';

const STRAPI_BASE_URL = import.meta.env.STRAPI_URL || 'http://localhost:1337';

function toAbsoluteUrl(url?: string) {
	if (!url) return undefined;
	if (!url.startsWith('http')) return `${STRAPI_BASE_URL}${url}`;
	return url;
}

function extractStrapiMediaUrl(media: any): string | undefined {
	if (!media) return undefined;
	if (typeof media === 'string') return toAbsoluteUrl(media);

	const url = media?.data?.attributes?.url ?? media?.attributes?.url ?? media?.url;
	return toAbsoluteUrl(url);
}

function extractStrapiMediaUrls(media: any): string[] {
	if (!media) return [];
	if (Array.isArray(media)) {
		return media
			.map((item): string | undefined => extractStrapiMediaUrl(item))
			.filter((url): url is string => Boolean(url));
	}

	const data = Array.isArray(media?.data)
		? media.data
		: media?.data
			? [media.data]
			: [];

	return data
		.map((item: any): string | undefined => extractStrapiMediaUrl(item))
		.filter((url): url is string => Boolean(url));
}

// Blog kolekce
const blog = defineCollection({
	loader: async () => {
		const data = await fetchApi<any[]>({
			endpoint: 'fox-hyn-posts', // Zkontrolujte, zda se endpoint jmenuje 'posts' nebo 'foxhyn-posts'
			query: { populate: '*' },
			wrappedByKey: 'data',
		});

		return data.map((item) => {
			const attributes = item.attributes || item;
			const id = attributes.slug || item.id.toString();

			const heroImage = extractStrapiMediaUrl(attributes.heroImage);
			const gallery = extractStrapiMediaUrls(attributes.gallery);

			return {
				id,
				title: attributes.title,
				description: attributes.description,
				pubDate: attributes.pubDate,
				updatedDate: attributes.updatedAt,
				heroImage: heroImage,
				content: attributes.body, // Tady bereme Markdown z pole 'body'
				author: typeof attributes.author === 'string' ? attributes.author : undefined,
				gallery: gallery,
			};
		});
	},
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		heroImage: z.string().optional(),
		content: z.string().optional(),
		author: z.string().optional(),
		gallery: z.array(z.string()).optional(),
	}),
});

// Puppies kolekce
const puppies = defineCollection({
	loader: glob({ base: './src/content/puppies', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		name: z.string(),
		breed: z.string(),
		born: z.coerce.date(),
		coat: z.string().optional(),
		health: z.string().optional(),
		activities: z.string().optional(),
		titles: z.string().optional(),
		shows: z.string().optional(),
		parents: z
			.object({
				mom: z.string(),
				dad: z.string(),
			})
			.optional(),
		gallery: z.array(z.string()).optional(),
	}),
});

// Nová kolekce pro Aktivity
const activities = defineCollection({
	loader: glob({ base: './src/content/activities', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
		gallery: z.array(z.string()).optional(),
	}),
});

export const collections = {
	blog,
	puppies,
	activities,
};
