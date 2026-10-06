import { cached } from './cache';
import { getContentSource } from './env';
import { getPayloadTenant, payloadFetch, payloadMediaUrl, type PayloadList } from './payload';
import { fetchStrapiPosts } from './strapi';

/** Společný tvar článku pro všechny zdroje (shodný s dřívější content collection `blog`). */
export type BlogPost = {
	slug: string;
	/** Dřívější URL (Strapi documentId), které se přesměrují na kanonický slug. */
	legacySlugs: string[];
	title: string;
	description: string;
	pubDate: Date;
	updatedDate?: Date;
	heroImage?: string;
	content: string;
	author?: string;
	gallery: string[];
};

type PayloadMedia = { url?: string | null } | number | null | undefined;

type PayloadPost = {
	slug: string;
	title: string;
	summary: string;
	body: string;
	publishedAt?: string | null;
	createdAt: string;
	updatedAt?: string;
	image?: PayloadMedia;
	author?: string | null;
	gallery?: { image?: PayloadMedia }[] | null;
};

const mediaUrl = (media: PayloadMedia) =>
	typeof media === 'object' && media?.url ? payloadMediaUrl(media.url) : undefined;

function fromPayload(doc: PayloadPost): BlogPost {
	return {
		slug: doc.slug,
		legacySlugs: [],
		title: doc.title,
		description: doc.summary,
		pubDate: new Date(doc.publishedAt ?? doc.createdAt),
		updatedDate: doc.updatedAt ? new Date(doc.updatedAt) : undefined,
		heroImage: mediaUrl(doc.image),
		content: doc.body,
		author: doc.author ?? undefined,
		gallery: (doc.gallery ?? []).map((g) => mediaUrl(g.image)).filter((u): u is string => Boolean(u)),
	};
}

async function loadPosts(): Promise<BlogPost[]> {
	if (getContentSource() === 'payload') {
		const result = await payloadFetch<PayloadList<PayloadPost>>('posts', {
			'where[_status][equals]': 'published',
			'where[tenant.slug][equals]': getPayloadTenant(),
			depth: 2,
			limit: 200,
			sort: '-publishedAt',
		});
		return result.docs.map(fromPayload);
	}
	return fetchStrapiPosts();
}

export async function getPosts(): Promise<BlogPost[]> {
	const posts = await cached(`posts:${getContentSource()}`, loadPosts);
	return [...posts].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());
}

/** Vrací článek podle slugu; `redirectTo` je vyplněné, pokud jde o starou URL. */
export async function findPost(
	slug: string,
): Promise<{ post: BlogPost; redirectTo?: string } | undefined> {
	const posts = await getPosts();
	const post = posts.find((p) => p.slug === slug);
	if (post) return { post };
	const legacy = posts.find((p) => p.legacySlugs.includes(slug));
	return legacy ? { post: legacy, redirectTo: `/blog/${legacy.slug}/` } : undefined;
}
