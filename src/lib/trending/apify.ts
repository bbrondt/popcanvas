import type { TrendingResult } from './types';

/**
 * Apify run-sync endpoint pattern: POST a small input JSON, get the dataset
 * items back in the same response. Works for short scrapes (<5 min). Longer
 * runs would need run + poll, but our caps are small enough that sync is fine.
 *
 * Apify uses the `~` separator (not `/`) in actor IDs in URLs.
 */
async function runActorSync<T>(
  actorIdSlash: string,
  input: Record<string, unknown>,
  apiToken: string,
  timeoutMs = 90_000,
): Promise<T[]> {
  const actorId = actorIdSlash.replace('/', '~');
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(apiToken)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apify ${actorIdSlash} ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T[];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TikTok trending search via the popular community actor "clockworks/tiktok-scraper".
 * Input shape from the actor's docs:
 *   searchQueries: string[]   // search keywords
 *   resultsPerPage: number    // max per query
 *   shouldDownloadVideos: false
 *
 * If you swap to a different TikTok actor, the unwrap shape below is the part
 * to update. Other reasonable actors: apidojo/tiktok-scraper, novi/tiktok-api.
 */
interface TikTokItem {
  webVideoUrl?: string;
  videoUrl?: string;
  text?: string;
  playCount?: number;
  diggCount?: number;
  shareCount?: number;
  commentCount?: number;
  createTimeISO?: string;
  authorMeta?: { name?: string; nickName?: string };
  videoMeta?: { coverUrl?: string; originalCoverUrl?: string };
}

export async function searchTikTokTrending(
  query: string,
  limit: number,
  apiToken: string,
): Promise<TrendingResult[]> {
  const items = await runActorSync<TikTokItem>(
    'clockworks/tiktok-scraper',
    {
      searchQueries: [query],
      resultsPerPage: Math.min(limit, 20),
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
    },
    apiToken,
  );

  return items
    .filter((it) => !!it.webVideoUrl)
    .slice(0, limit)
    .map((it) => ({
      platform: 'tiktok' as const,
      url: it.webVideoUrl!,
      title: (it.text ?? 'TikTok').slice(0, 120) || 'TikTok',
      thumbnail: it.videoMeta?.coverUrl ?? it.videoMeta?.originalCoverUrl,
      author: it.authorMeta?.nickName ?? it.authorMeta?.name,
      views: it.playCount,
      likes: it.diggCount,
      publishedAt: it.createTimeISO,
      description: it.text?.slice(0, 280),
    }));
}

/**
 * Instagram trending via "apify/instagram-hashtag-scraper". For "trending in
 * a niche" the hashtag is the closest signal — we'll use the first word of
 * the query as the hashtag (people search "mortgage" not "mortgage tips").
 *
 * Input:
 *   hashtags: string[]
 *   resultsLimit: number
 */
interface InstagramItem {
  url?: string;
  shortCode?: string;
  caption?: string;
  ownerUsername?: string;
  ownerFullName?: string;
  likesCount?: number;
  videoViewCount?: number;
  commentsCount?: number;
  displayUrl?: string;
  videoUrl?: string;
  timestamp?: string;
}

export async function searchInstagramTrending(
  query: string,
  limit: number,
  apiToken: string,
): Promise<TrendingResult[]> {
  // Strip non-alphanumeric and use first hashtag-friendly token.
  const hashtag = query.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60) || query.toLowerCase();
  const items = await runActorSync<InstagramItem>(
    'apify/instagram-hashtag-scraper',
    {
      hashtags: [hashtag],
      resultsLimit: Math.min(limit, 20),
      resultsType: 'posts',
    },
    apiToken,
  );

  return items
    .filter((it) => !!(it.url ?? it.shortCode))
    .slice(0, limit)
    .map((it) => {
      const url = it.url ?? `https://www.instagram.com/p/${it.shortCode}/`;
      const title = (it.caption ?? '').slice(0, 120) || `@${it.ownerUsername ?? 'instagram'}`;
      return {
        platform: 'instagram' as const,
        url,
        title,
        thumbnail: it.displayUrl,
        author: it.ownerUsername,
        views: it.videoViewCount,
        likes: it.likesCount,
        publishedAt: it.timestamp,
        description: it.caption?.slice(0, 280),
      };
    });
}
