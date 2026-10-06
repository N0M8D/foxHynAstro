import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { clearCache } from '../../lib/cms/cache';
import { env } from '../../lib/cms/env';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function validSecret(received: string | null) {
	const expected = env('REVALIDATE_SECRET');
	if (!expected || !received) return false;
	const a = Buffer.from(received);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Webhook sdíleného Payloadu (tenant -> revalidation.url). */
export const POST: APIRoute = async ({ request }) => {
	if (!env('REVALIDATE_SECRET')) return json({ ok: false, error: 'Revalidace není nastavena.' }, 503);
	if (!validSecret(request.headers.get('x-revalidate-secret'))) return json({ ok: false }, 401);

	clearCache();
	return json({ ok: true, revalidated: true });
};
