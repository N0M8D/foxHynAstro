import rss from '@astrojs/rss';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';
import { getPosts } from '../lib/cms/blog';

export const prerender = false;

export async function GET(context) {
	let posts;
	try {
		posts = await getPosts();
	} catch (error) {
		console.error('[rss] Načtení článků selhalo.', error);
		return new Response('Obsah je dočasně nedostupný.', { status: 503 });
	}
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts.map((post) => ({
			title: post.title,
			description: post.description,
			pubDate: post.pubDate,
			link: `/blog/${post.slug}/`,
		})),
	});
}
