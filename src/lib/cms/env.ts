/** Proměnné se čtou za běhu (Portainer), import.meta.env je jen záloha pro `astro dev`. */
export function env(key: string): string | undefined {
	return process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];
}

export type ContentSource = 'strapi' | 'payload';

export function getContentSource(): ContentSource {
	return env('CONTENT_SOURCE') === 'payload' ? 'payload' : 'strapi';
}
