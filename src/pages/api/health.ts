export const prerender = false;

/** Healthcheck kontejneru; nezávisí na CMS. */
export const GET = () =>
	new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
