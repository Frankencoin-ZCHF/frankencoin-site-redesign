const FETCH_TIMEOUT = 8000;

interface YouTubeData {
  title: string;
  description: string;
  thumbnail: string;
  author: string;
  url: string;
  publishedDate: string;
  videoId: string;
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
    /youtube\.com\/embed\/([^&\s]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&quot;': '"',
    '&#34;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&amp;': '&',
    '&#38;': '&',
    '&lt;': '<',
    '&#60;': '<',
    '&gt;': '>',
    '&#62;': '>',
    '&nbsp;': ' ',
    '&#160;': ' ',
  };

  return text.replace(/&[#\w]+;/g, (entity) => entities[entity] || entity);
}

async function fetchYouTubeDataUncached(url: string): Promise<YouTubeData | null> {
  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      console.error(`Could not extract video ID from ${url}`);
      return null;
    }

    // Fetch the YouTube page to get metadata
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Extract metadata from Open Graph tags
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1] || '';
    const ogDescription = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1] || '';
    const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i)?.[1] || '';
    const author = html.match(/<link[^>]*itemprop=["']name["'][^>]*content=["']([^"']*)["']/i)?.[1] || '';

    // Extract publication date
    const datePublished = html.match(/<meta[^>]*itemprop=["']datePublished["'][^>]*content=["']([^"']*)["']/i)?.[1] || '';
    const uploadDate = html.match(/<meta[^>]*itemprop=["']uploadDate["'][^>]*content=["']([^"']*)["']/i)?.[1] || '';

    // Format the date
    const rawDate = datePublished || uploadDate;
    let formattedDate = '';
    if (rawDate) {
      try {
        const date = new Date(rawDate);
        if (!isNaN(date.getTime())) {
          formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          });
        }
      } catch (e) {
        console.error('Error parsing date:', e);
      }
    }

    // Use YouTube's reliable thumbnail URL directly
    // hqdefault.jpg (480x360) is always available for all videos
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
      title: decodeHtmlEntities(ogTitle.trim()),
      description: decodeHtmlEntities(ogDescription.trim()),
      thumbnail,
      author: decodeHtmlEntities(author.trim()),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedDate: formattedDate,
      videoId,
    };
  } catch (error) {
    console.error(`Error fetching YouTube data for ${url}:`, error);
    return null;
  }
}

/* In-memory cache per URL, built so that a page request never waits on a slow publisher site:
 * - fresh entry (one hour; five minutes after a failure): returned at once;
 * - stale entry: returned at once, refreshed in the background (a failed refresh keeps the last good data);
 * - no entry yet (first request after a deploy): wait at most WAIT ms, then return null so the page renders
 *   with the hand-written metadata from media.json while the fetch finishes in the background.
 * Each fetch is aborted after FETCH_TIMEOUT ms. */
const TTL_OK = 60 * 60 * 1000;
const TTL_FAIL = 5 * 60 * 1000;
const WAIT = 1200;
const cache = new Map<string, { at: number; data: YouTubeData | null }>();
const inflight = new Map<string, Promise<YouTubeData | null>>();
export async function fetchYouTubeData(url: string): Promise<YouTubeData | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.data ? TTL_OK : TTL_FAIL)) return hit.data;
  let run = inflight.get(url);
  if (!run) {
    run = fetchYouTubeDataUncached(url)
      .catch(() => null)
      .then((data) => { cache.set(url, { at: Date.now(), data: data ?? hit?.data ?? null }); inflight.delete(url); return data; });
    inflight.set(url, run);
  }
  if (hit) return hit.data;
  return Promise.race([run, new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT))]);
}
