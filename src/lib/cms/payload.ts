import { env } from './env';

const REQUEST_TIMEOUT_MS = 5000;

export type PayloadList<T> = { docs: T[]; totalDocs: number; hasNextPage: boolean };

export function getPayloadTenant() {
	return env('PAYLOAD_TENANT') || 'foxhyn';
}

/** Obrázky načítá prohlížeč, proto veřejná adresa Payloadu, ne interní. */
export function payloadMediaUrl(path: string) {
	if (/^https?:\/\//.test(path)) return path;
	const publicUrl = env('PAYLOAD_PUBLIC_URL') || 'https://payload.czechnomad.cz';
	return `${publicUrl.replace(/\/$/, '')}${path}`;
}

export async function payloadFetch<T>(
	path: string,
	query: Record<string, string | number | undefined> = {},
): Promise<T> {
	const baseUrl = env('PAYLOAD_URL');
	const apiKey = env('PAYLOAD_API_KEY');
	if (!baseUrl || !apiKey) {
		throw new Error('Payload CMS není nastaven (PAYLOAD_URL / PAYLOAD_API_KEY).');
	}

	const url = new URL(`/api/${path.replace(/^\//, '')}`, baseUrl);
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}

	const response = await fetch(url, {
		headers: { Authorization: `users API-Key ${apiKey}` },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Payload ${path} -> ${response.status}`);
	return (await response.json()) as T;
}
