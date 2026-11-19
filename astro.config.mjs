// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

import node from '@astrojs/node';
import vercel from '@astrojs/vercel';

const sitemapSeen = new Set();

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
		'/start': '/use-cases/save-in-chf',
		'/de/start': '/de/use-cases/save-in-chf',

		// Old static site (Frankencoin-ZCHF/www) pages and files that still get visits and search traffic.
		'/index.html': '/',
		'/en': '/',
		'/fps.html': '/fcs',
		'/fps': '/fcs',
		'/de/fps': '/de/fcs',
		'/pool': '/fcs',
		'/de/pool': '/de/fcs',
		'/governance/fcs': '/governance',
		'/what-is-frankencoin.html': '/what-is-frankencoin',
		'/ecosystem.html': '/ecosystem',
		'/faq.html': '/faq',
		'/media_kit/frankencoin_brand_guidelines.pdf': '/Frankencoin_Brand_Guidelines.pdf',
		'/assets/v2/Frankencoin_Brand_Guidelines.pdf': '/Frankencoin_Brand_Guidelines.pdf',
		'/de/Frankencoin_Brand_Guidelines.pdf': '/Frankencoin_Brand_Guidelines.pdf',
		'/documents/ZCHF_MiCA_Memo.pdf': '/20260209 ZCHF MiCA Frankencoin Association Public Summary FINAL.pdf',
		'/documents/ZCHF_FPS_Memo.pdf': '/compliance',
		'/2025-01-04_Frankencoin_MiCA_Classification.pdf': '/20260209 ZCHF MiCA Frankencoin Association Public Summary FINAL.pdf',
		'/de/2025-01-04_Frankencoin_MiCA_Classification.pdf': '/20260209 ZCHF MiCA Frankencoin Association Public Summary FINAL.pdf',
		// Links to the MiCA PDF get cut at the first space by some apps.
		'/20260209': '/20260209 ZCHF MiCA Frankencoin Association Public Summary FINAL.pdf',
		'/de/20260209': '/20260209 ZCHF MiCA Frankencoin Association Public Summary FINAL.pdf',
		'/thesis-preprint-frankencoin.pdf': 'https://www.zora.uzh.ch/entities/publication/b1bff836-6852-457d-93e6-496807db37fa',

		// Paths people guess.
		'/savings': '/use-cases/save-in-chf',
		'/de/savings': '/de/use-cases/save-in-chf',
		'/mint': '/use-cases/borrow',
		'/de/mint': '/de/use-cases/borrow',
		'/about': '/association',
		'/de/about': '/de/association',
		'/contact': '/association',
		'/de/contact': '/de/association',
		'/blog': '/news',
		'/bug-bounty': '/security',
		'/docs': 'https://docs.frankencoin.com',
		'/whitepaper': 'https://docs.frankencoin.com',
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
			// Same address as the canonical tag: no trailing slash (server.mjs redirects /path/ to /path).
			serialize: (item) => {
				const strip = (u) => u.replace(/(frankencoin\.com\/.+?)\/+$/, '$1');
				item.url = strip(item.url);
				// Prerendered and customPages entries can now be the same URL: keep the first.
				if (sitemapSeen.has(item.url)) return undefined;
				sitemapSeen.add(item.url);
				item.links = item.links?.map((l) => ({ ...l, url: strip(l.url) }));
				return item;
			},
			// Server-rendered pages are not discovered automatically.
			customPages: [
				...['fcs', 'use-cases/save-in-chf', 'use-cases/borrow', 'for/savers', 'for/treasuries', 'for/exchanges-wallets', 'for/developers', 'integrate', 'integrate/collateral', 'referral', 'transparency', 'security', 'how-it-works', 'faq', 'glossary', 'compare', 'news', 'press', 'association', 'privacy'].flatMap((p) => [`https://frankencoin.com/${p}`, `https://frankencoin.com/de/${p}`]),
			],
		}),
	],

	vite: {
		plugins: [tailwindcss()],
	},

	// Production runs the standalone Node server; on Vercel (preview deployments) use its serverless adapter.
	adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
});
