// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import node from '@astrojs/node';

// Výchozí je statický výstup; stránky s obsahem z CMS (blog, rss) mají `prerender = false`
// a renderují se za běhu, aby build nezávisel na CMS.
// https://astro.build/config
export default defineConfig({
  site: 'https://foxhyn.com',
  integrations: [mdx(), sitemap(), react()],
  adapter: node({ mode: 'standalone' }),
});
