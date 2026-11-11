export type XerberusRating = {
	type: string;
	id: string;
	name: string;
	score: number | null;
	platform: string | null;
	address: string | null;
};

// Snapshot of the scores shown on frankencoin.com on 2026-10-27, used only when no API key is
// configured (preview deployments). Replace by setting XERBERUS_API_URL / _KEY / _USER_EMAIL.
const STATIC_RATINGS: XerberusRating[] = [
	{ type: 'protocol', id: 'frankencoin', name: 'Frankencoin Protocol', score: 77, platform: null, address: null },
	{ type: 'organisation', id: 'frankencoin-dao', name: 'Frankencoin DAO', score: 75, platform: null, address: null },
	{ type: 'pool', id: 'frankencoin-savings-eth', name: 'Frankencoin Savings Ethereum Vault', score: 81, platform: null, address: null },
];

let _cache: { data: XerberusRating[]; expiresAt: number } | null = null;

export async function fetchXerberusRatings(): Promise<XerberusRating[]> {
	const now = Date.now();
	if (_cache && now < _cache.expiresAt) return _cache.data;

	const apiUrl = import.meta.env.XERBERUS_API_URL as string | undefined;
	const apiKey = import.meta.env.XERBERUS_API_KEY as string | undefined;
	const userEmail = import.meta.env.XERBERUS_USER_EMAIL as string | undefined;

	if (!apiUrl || !apiKey || apiKey === '...') return STATIC_RATINGS;

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);
		const res = await fetch(`${apiUrl}/registry/scores?type=protocol,organisation,pool`, {
			headers: {
				'x-api-key': apiKey,
				'x-user-email': userEmail ?? '',
			},
			signal: controller.signal,
		});
		clearTimeout(timeout);
		if (!res.ok) return [];
		const json = await res.json();
		const data: XerberusRating[] = Array.isArray(json.data) ? json.data : [];
		_cache = { data, expiresAt: now + 60 * 60 * 1000 }; // 1h TTL
		return data;
	} catch {
		return [];
	}
}
