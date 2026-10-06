/**
 * Paměťová cache se "stale-if-error": po vypršení TTL se zkusí načíst nová data,
 * při chybě zdroje se vrátí poslední úspěšná odpověď. Webhook /api/revalidate cache smaže.
 */
const TTL_MS = 5 * 60 * 1000;

type Entry = { value: unknown; fetchedAt: number };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
	const hit = store.get(key);
	if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value as T;

	const pending = inflight.get(key);
	if (pending) return pending as Promise<T>;

	const promise = load()
		.then((value) => {
			store.set(key, { value, fetchedAt: Date.now() });
			return value;
		})
		.catch((error) => {
			if (hit) {
				console.error(`[cms] "${key}" selhalo, používám starší data.`, error);
				return hit.value as T;
			}
			throw error;
		})
		.finally(() => inflight.delete(key));

	inflight.set(key, promise);
	return promise;
}

/** Po smazání cache se příští požadavek načte z CMS (stará data se při chybě už nepoužijí). */
export function clearCache() {
	store.clear();
}
