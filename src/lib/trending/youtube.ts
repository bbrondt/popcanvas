import type { TrendingResult } from './types';

/**
 * YouTube Data API v3 search. Free up to 10k units/day; each search call
 * costs ~100 units. We fetch search results sorted by view count and then
 * enrich with statistics (search alone doesn't return view count).
 *
 * Setup: console.cloud.google.com → enable YouTube Data API v3 → create an
 * API key restricted to that API. Set as YOUTUBE_API_KEY in Vercel env.
 */
export async function searchYouTubeTrending(
  query: string,
  limit: number,
  apiKey: string,
): Promise<TrendingResult[]> {
  // Search restricted to the last 90 days so "trending" actually means recent.
  const after = new Date();
  after.setDate(after.getDate() - 90);

  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('order', 'viewCount');
  searchUrl.searchParams.set('maxResults', String(Math.min(limit, 25)));
  searchUrl.searchParams.set('publishedAfter', after.toISOString());
  searchUrl.searchParams.set('relevanceLanguage', 'en');
  searchUrl.searchParams.set('key', apiKey);

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    const body = await searchRes.text().catch(() => '');
    throw new Error(`YouTube search ${searchRes.status}: ${body.slice(0, 200)}`);
  }
  const search = (await searchRes.json()) as {
    items?: Array<{
      id: { videoId: string };
      snippet: {
        title: string;
        channelTitle: string;
        publishedAt: string;
        description: string;
        thumbnails: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
      };
    }>;
  };
  const items = search.items ?? [];
  if (items.length === 0) return [];

  // Enrich with view counts.
  const ids = items.map((i) => i.id.videoId).join(',');
  const statsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  statsUrl.searchParams.set('part', 'statistics');
  statsUrl.searchParams.set('id', ids);
  statsUrl.searchParams.set('key', apiKey);

  const statsRes = await fetch(statsUrl);
  const statsByVideo = new Map<string, { viewCount?: string; likeCount?: string }>();
  if (statsRes.ok) {
    const statsBody = (await statsRes.json()) as {
      items?: Array<{ id: string; statistics: { viewCount?: string; likeCount?: string } }>;
    };
    for (const it of statsBody.items ?? []) {
      statsByVideo.set(it.id, it.statistics);
    }
  }

  return items.map((it) => {
    const stats = statsByVideo.get(it.id.videoId) ?? {};
    const thumb =
      it.snippet.thumbnails.high?.url ??
      it.snippet.thumbnails.medium?.url ??
      it.snippet.thumbnails.default?.url;
    return {
      platform: 'youtube' as const,
      url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
      title: it.snippet.title,
      thumbnail: thumb,
      author: it.snippet.channelTitle,
      views: stats.viewCount ? Number(stats.viewCount) : undefined,
      likes: stats.likeCount ? Number(stats.likeCount) : undefined,
      publishedAt: it.snippet.publishedAt,
      description: it.snippet.description?.slice(0, 280),
    };
  });
}
