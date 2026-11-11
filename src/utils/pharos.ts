export type PharosPillarKey = "backing" | "exit" | "control";

export type PharosPillarRating = {
	grade: string;
	score: number | null;
	detail: string;
};

export type PharosRating = {
	id: string;
	overallGrade: string;
	overallScore: number | null;
	methodologyVersion: string | null;
	updatedAt: number | null;
	pillars: Record<PharosPillarKey, PharosPillarRating>;
};

const STABLECOIN_ID = "zchf-frankencoin";
const PILLAR_KEYS: PharosPillarKey[] = ["backing", "exit", "control"];

// Snapshot of the ZCHF safety score shown on frankencoin.com on 2026-10-27, used only when no
// PHAROS_API_KEY is configured (preview deployments).
const STATIC_RATING: PharosRating = {
	id: STABLECOIN_ID,
	overallGrade: 'A',
	overallScore: 84,
	methodologyVersion: '10.34',
	updatedAt: Date.UTC(2026, 9, 27) / 1000,
	pillars: {
		backing: { grade: 'B+', score: 79, detail: 'Strong evidence' },
		exit: { grade: 'A+', score: 99, detail: 'Strong evidence · Current data' },
		control: { grade: 'B+', score: 75, detail: 'Limited evidence' },
	},
};

let _cache: { data: PharosRating; expiresAt: number } | null = null;

export async function fetchPharosRating(): Promise<PharosRating | null> {
	const now = Date.now();
	if (_cache && now < _cache.expiresAt) return _cache.data;

	const apiKey = import.meta.env.PHAROS_API_KEY as string | undefined;
	if (!apiKey || apiKey === '...') return STATIC_RATING;

	const baseUrl = (import.meta.env.PHAROS_API_URL as string | undefined) ?? 'https://api.pharos.watch';

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);
		// Pharos's safety-score model is versioned in the path (currently v9); unversioned
		// /api/report-cards was retired and now 404s.
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/report-cards/v9`, {
			headers: { 'X-API-Key': apiKey, accept: 'application/json' },
			signal: controller.signal,
		});
		clearTimeout(timeout);
		if (!res.ok) {
			console.error(`[pharos] report-cards request failed: ${res.status} ${res.statusText}`);
			return null;
		}
		const body = await res.json() as unknown;
		const rating = parsePharosRating(body);
		if (!rating) {
			console.error('[pharos] report-cards response did not match the expected shape');
			return null;
		}
		_cache = { data: rating, expiresAt: now + 60 * 60 * 1000 }; // 1h TTL
		return rating;
	} catch (err) {
		console.error('[pharos] failed to fetch report-cards', err);
		return null;
	}
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

function strOrNull(v: unknown): string | null {
	return typeof v === 'string' && v ? v : null;
}

function numOrNull(v: unknown): number | null {
	return typeof v === 'number' && isFinite(v) ? v : null;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// Pharos publishes a numeric score per pillar but no per-pillar letter grade, so we
// derive one using the same bands implied by their published overall score->grade pairs.
function scoreToGrade(score: number): string {
	if (score >= 90) return 'A+';
	if (score >= 83) return 'A';
	if (score >= 80) return 'A-';
	if (score >= 75) return 'B+';
	if (score >= 70) return 'B';
	if (score >= 65) return 'B-';
	if (score >= 60) return 'C+';
	if (score >= 55) return 'C';
	if (score >= 50) return 'C-';
	if (score >= 40) return 'D';
	return 'F';
}

function pillarDetail(pillar: Record<string, unknown>): string {
	const evidence = strOrNull(pillar.evidenceLevel);
	const freshness = strOrNull(pillar.freshness);
	const parts: string[] = [];
	if (evidence) parts.push(`${capitalize(evidence)} evidence`);
	if (freshness && freshness !== 'unknown') parts.push(`${capitalize(freshness)} data`);
	return parts.length ? parts.join(' · ') : 'Detail unavailable';
}

function parsePharosRating(body: unknown): PharosRating | null {
	if (!isRecord(body) || !Array.isArray(body.cards)) return null;
	const card = body.cards.find((c: unknown) => isRecord(c) && c.id === STABLECOIN_ID);
	if (!isRecord(card) || !isRecord(card.pillars)) return null;

	const pillars = PILLAR_KEYS.reduce((acc, key) => {
		const p = (card.pillars as Record<string, unknown>)[key];
		const rawScore = isRecord(p) ? numOrNull(p.score) : null;
		const score = rawScore != null ? Math.round(rawScore) : null;
		acc[key] = isRecord(p) && score != null
			? { grade: scoreToGrade(score), score, detail: pillarDetail(p) }
			: { grade: 'NR', score: null, detail: 'Dimension unavailable' };
		return acc;
	}, {} as Record<PharosPillarKey, PharosPillarRating>);

	const methodology = isRecord(body.methodology) ? body.methodology : null;
	const overallScore = numOrNull(card.score);

	return {
		id: STABLECOIN_ID,
		overallGrade: strOrNull(card.grade) ?? (overallScore != null ? scoreToGrade(overallScore) : 'NR'),
		overallScore,
		methodologyVersion: methodology ? strOrNull(methodology.version) : null,
		updatedAt: numOrNull(body.updatedAt),
		pillars,
	};
}
