import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

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
	puppies,
	activities,
};
