interface OgData {
  title: string;
  description: string;
  image: string;
  siteName: string;
  url: string;
  publishedDate: string;
}

async function fetchOgDataUncached(url: string): Promise<OgData | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,de;q=0.8,fr;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Helper to extract meta content from various formats
    const getMeta = (patterns: string[]): string => {
      for (const pattern of patterns) {
        // Try property="..." content="..."
        let match = html.match(new RegExp(`<meta\\s+property=["']${pattern}["']\\s+content=["']([^"']*?)["']`, 'i'));
        if (match?.[1]) return match[1];

        // Try content="..." property="..."
        match = html.match(new RegExp(`<meta\\s+content=["']([^"']*?)["']\\s+property=["']${pattern}["']`, 'i'));
        if (match?.[1]) return match[1];

        // Try name="..." content="..."
        match = html.match(new RegExp(`<meta\\s+name=["']${pattern}["']\\s+content=["']([^"']*?)["']`, 'i'));
        if (match?.[1]) return match[1];

        // Try content="..." name="..."
        match = html.match(new RegExp(`<meta\\s+content=["']([^"']*?)["']\\s+name=["']${pattern}["']`, 'i'));
        if (match?.[1]) return match[1];
      }
      return '';
    };

    // Extract Open Graph and Twitter Card tags
    const ogTitle = getMeta(['og:title', 'twitter:title']);
    const ogDescription = getMeta(['og:description', 'twitter:description', 'description']);
    const ogImage = getMeta(['og:image', 'twitter:image']);
    const ogSiteName = getMeta(['og:site_name', 'twitter:site', 'application-name']);
    const ogPublishedTime = getMeta([
      'article:published_time',
      'og:published_time',
      'article:published',
      'published_time',
      'publication_date',
      'datePublished',
      'publishdate',
      'pubdate',
      'date',
      'DC.date',
      'DC.date.issued',
      'sailthru.date',
      'article.published',
      'bt:pubdate'
    ]);

    // Fallback to title tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = ogTitle || (titleMatch?.[1] || '');

    // Make image URL absolute if relative
    let imageUrl = ogImage;
    if (imageUrl && !imageUrl.startsWith('http')) {
      try {
        const baseUrl = new URL(url);
        imageUrl = new URL(imageUrl, baseUrl.origin).href;
      } catch (e) {
        imageUrl = '';
      }
    }

    // Generate site name from hostname if not found
    let siteName = ogSiteName;
    if (!siteName) {
      try {
        const hostname = new URL(url).hostname;
        siteName = hostname.replace('www.', '').split('.')[0];
        siteName = siteName.charAt(0).toUpperCase() + siteName.slice(1);
      } catch (e) {
        siteName = '';
      }
    }

    // Format date
    let formattedDate = '';
    if (ogPublishedTime) {
      try {
        const date = new Date(ogPublishedTime);
        if (!isNaN(date.getTime())) {
          formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          });
        }
      } catch (e) {
        // Ignore date parsing errors
      }
    }

    return {
      title: title.trim(),
      description: ogDescription.trim(),
      image: imageUrl.trim(),
      siteName: siteName.trim(),
      url,
      publishedDate: formattedDate,
    };
  } catch (error) {
    console.error(`Error fetching OG data for ${url}:`, error);
    return null;
  }
}

/* One-hour in-memory cache per URL (the metadata of a published article does not change), so a page
 * request does not refetch every source. A failed fetch is cached for five minutes to avoid hammering. */
const TTL_OK = 60 * 60 * 1000;
const TTL_FAIL = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: OgData | null }>();
const inflight = new Map<string, Promise<OgData | null>>();
export async function fetchOgData(url: string): Promise<OgData | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.data ? TTL_OK : TTL_FAIL)) return hit.data;
  const pending = inflight.get(url);
  if (pending) return pending;
  const run = fetchOgDataUncached(url).then((data) => { cache.set(url, { at: Date.now(), data }); inflight.delete(url); return data; });
  inflight.set(url, run);
  return run;
}
