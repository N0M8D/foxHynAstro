import { cached } from './cache';
import { getPayloadTenant, payloadFetch, payloadMediaUrl, type PayloadList } from './payload';

/** Obecné kolekce sdíleného Payloadu: skupiny (oddíly webu), stránky a profily. */

export type Fact = { label: string; value: string };

type Common = {
	slug: string;
	order: number;
	image?: string;
	body: string;
	/** Slug skupiny, do které záznam patří. */
	group?: string;
};

export type Group = Common & {
	title: string;
	description: string;
	/** Slug nadřazené skupiny. */
	parent?: string;
};
export type Page = Common & { title: string; summary: string; gallery: string[] };
export type Profile = Common & { name: string; title: string; facts: Fact[]; gallery: string[] };

type Media = { url?: string | null } | number | null | undefined;
type Rel = { slug?: string } | number | null | undefined;

type RawCommon = {
	slug: string;
	order?: number | null;
	image?: Media;
	body?: string | null;
	group?: Rel;
	gallery?: { image?: Media }[] | null;
};

const mediaUrl = (m: Media) => (typeof m === 'object' && m?.url ? payloadMediaUrl(m.url) : undefined);
const relSlug = (r: Rel) => (typeof r === 'object' && r?.slug ? r.slug : undefined);
const galleryUrls = (g: RawCommon['gallery']) =>
	(g ?? []).map((x) => mediaUrl(x.image)).filter((u): u is string => Boolean(u));

function common(d: RawCommon): Common {
	return {
		slug: d.slug,
		order: d.order ?? 0,
		image: mediaUrl(d.image),
		body: d.body ?? '',
		group: relSlug(d.group),
	};
}

async function loadAll<T>(collection: string, map: (raw: any) => T): Promise<T[]> {
	const result = await payloadFetch<PayloadList<unknown>>(collection, {
		'where[_status][equals]': 'published',
		'where[tenant.slug][equals]': getPayloadTenant(),
		depth: 1,
		limit: 500,
		sort: 'order',
	});
	return result.docs.map(map);
}

const groups = () =>
	cached('groups', () =>
		loadAll<Group>('groups', (d) => ({
			...common(d),
			title: d.title,
			description: d.description ?? '',
			parent: relSlug(d.parent),
		})),
	);

const pages = () =>
	cached('pages', () =>
		loadAll<Page>('pages', (d) => ({
			...common(d),
			title: d.title,
			summary: d.summary ?? '',
			gallery: galleryUrls(d.gallery),
		})),
	);

const profiles = () =>
	cached('profiles', () =>
		loadAll<Profile>('profiles', (d) => ({
			...common(d),
			name: d.name,
			title: d.title ?? '',
			facts: (d.facts ?? []).map((f: { label?: string | null; value: string }) => ({
				label: f.label ?? '',
				value: f.value,
			})),
			gallery: galleryUrls(d.gallery),
		})),
	);

export async function getGroup(slug: string) {
	return (await groups()).find((g) => g.slug === slug);
}

export async function getChildGroups(parentSlug: string) {
	return (await groups()).filter((g) => g.parent === parentSlug);
}

export async function getPages(groupSlug: string) {
	return (await pages()).filter((p) => p.group === groupSlug);
}

export async function getPage(slug: string, groupSlug?: string) {
	return (await pages()).find((p) => p.slug === slug && (!groupSlug || p.group === groupSlug));
}

export async function getProfiles(groupSlug: string) {
	return (await profiles()).filter((p) => p.group === groupSlug);
}

export async function getProfile(slug: string, groupSlug: string) {
	return (await profiles()).find((p) => p.slug === slug && p.group === groupSlug);
}

/** Všechny veřejné adresy z těchto kolekcí (pro sitemap), skládané podle struktury webu. */
export async function getContentPaths(): Promise<{ path: string; lastmod?: Date }[]> {
	const [g, p, pr] = await Promise.all([groups(), pages(), profiles()]);
	return [
		...g.filter((x) => x.parent === 'chovatelska-stanice').map((x) => ({ path: `/chovatelskaStanice/${x.slug}/` })),
		...p.filter((x) => x.group === 'activities').map((x) => ({ path: `/activities/${x.slug}/` })),
		...pr
			.filter((x) => x.group && g.find((y) => y.slug === x.group)?.parent === 'chovatelska-stanice')
			.map((x) => ({ path: `/chovatelskaStanice/${x.group}/${x.slug}/` })),
	];
}
