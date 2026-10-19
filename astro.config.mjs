// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

import node from '@astrojs/node';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	site: process.env.SITE ?? 'https://frankencoin.com',

	server: {
		port: parseInt(process.env.PORT ?? '3000'),
		host: true,
		allowedHosts: ['frankencoin.com'],
	},

	integrations: [
		sitemap({
			i18n: {
				defaultLocale: 'en',
				locales: {
					en: 'en',
					de: 'de',
				},
			},
			filter: (page) => !page.includes('/verify/'),
			// Server-rendered pages are not discovered automatically.
			customPages: [
				...['fcs', 'start', 'save-invest', 'partners', 'developers'].flatMap((p) => [`https://frankencoin.com/${p}/`, `https://frankencoin.com/de/${p}/`]),
			],
		}),
	],

	vite: {
		plugins: [tailwindcss()],
	},

	// Production runs the standalone Node server; on Vercel (preview deployments) use its serverless adapter.
	adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
});
