// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

import node from '@astrojs/node';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	// With a preview password every page must be rendered on request so the middleware can gate it.
	output: process.env.PREVIEW_PASSWORD ? 'server' : 'static',

	site: process.env.SITE ?? 'https://frankencoin.com',

	// Pages that moved in the audience-first restructure.
	redirects: {
		'/save-invest': '/for/savers',
		'/de/save-invest': '/de/for/savers',
		'/developers': '/for/developers',
		'/de/developers': '/de/for/developers',
		'/partners': '/integrate',
		'/de/partners': '/de/integrate',
	},

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
				...['fcs', 'start', 'use-cases/save-in-chf', 'use-cases/borrow', 'for/savers', 'for/treasuries', 'for/exchanges-wallets', 'for/developers', 'integrate', 'integrate/collateral', 'referral', 'transparency', 'security', 'how-it-works', 'faq', 'glossary', 'compare', 'news', 'press'].flatMap((p) => [`https://frankencoin.com/${p}/`, `https://frankencoin.com/de/${p}/`]),
			],
		}),
	],

	vite: {
		plugins: [tailwindcss()],
	},

	// Production runs the standalone Node server; on Vercel (preview deployments) use its serverless adapter.
	adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
});
