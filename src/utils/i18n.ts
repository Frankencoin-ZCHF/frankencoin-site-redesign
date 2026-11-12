export const languages = {
	en: 'English',
	de: 'Deutsch',
	// fr: 'Français', // French temporarily disabled
} as const;

// All languages including disabled ones (for URL parsing)
export const allLanguages = {
	en: 'English',
	de: 'Deutsch',
	fr: 'Français',
} as const;

export type Language = keyof typeof languages;

export const defaultLang: Language = 'en';

export function getLanguageFromURL(pathname: string): Language {
	const langMatch = pathname.match(/^\/(en|de)(\/|$)/);
	if (langMatch) {
		return langMatch[1] as Language;
	}
	// Handle disabled French URLs - redirect to English
	const frMatch = pathname.match(/^\/(fr)(\/|$)/);
	if (frMatch) {
		return defaultLang;
	}
	return defaultLang;
}

export function getLocalizedPath(path: string, lang: Language): string {
	if (lang === defaultLang) {
		return path;
	}
	// Files (PDFs, images) are served from the root for every language
	if (/\.[a-z0-9]{2,5}(?:[?#]|$)/i.test(path)) {
		return path;
	}
	// Remove leading slash if present
	const cleanPath = path.startsWith('/') ? path.slice(1) : path;
	return `/${lang}/${cleanPath}`;
}

export function stripLangFromPath(pathname: string): string {
	// Also strip fr for backwards compatibility
	return pathname.replace(/^\/(en|de|fr)(\/|$)/, '/');
}

// Get browser language preference
export function getBrowserLanguage(): Language {
	if (typeof window === 'undefined') return defaultLang;

	const browserLang = navigator.language.toLowerCase();

	// Check for exact match
	if (browserLang in languages) {
		return browserLang as Language;
	}

	// Check for language prefix (e.g., 'de-CH' -> 'de')
	const langPrefix = browserLang.split('-')[0];
	if (langPrefix in languages) {
		return langPrefix as Language;
	}

	return defaultLang;
}

// Load content for a specific language
export async function loadContent<T>(contentFile: string, lang: Language): Promise<T> {
	try {
		const content = await import(`../content/${lang}/${contentFile}.json`);
		return content.default;
	} catch (error) {
		console.error(`Failed to load ${contentFile}.json for language ${lang}:`, error);
		// Fallback to English
		const fallbackContent = await import(`../content/en/${contentFile}.json`);
		return fallbackContent.default;
	}
}

// Load shared content for a specific language
export async function loadSharedContent<T>(contentFile: string, lang: Language): Promise<T> {
	try {
		const content = await import(`../content/${lang}/shared/${contentFile}.json`);
		return content.default;
	} catch (error) {
		console.error(`Failed to load shared/${contentFile}.json for language ${lang}:`, error);
		// Fallback to English
		const fallbackContent = await import(`../content/en/shared/${contentFile}.json`);
		return fallbackContent.default;
	}
}

// Load globally shared content (not language-specific)
export async function loadGlobalSharedContent<T>(contentFile: string): Promise<T> {
	const content = await import(`../content/shared/${contentFile}.json`);
	return content.default;
}
