import type { APIRoute } from 'astro';
import { searchYouTubeTrending } from '@/lib/trending/youtube';
import { searchTikTokTrending, searchInstagramTrending } from '@/lib/trending/apify';
import type {
  TrendingPlatform,
  TrendingResult,
  TrendingSearchInput,
  TrendingSearchResponse,
} from '@/lib/trending/types';

export const prerender = false;

/**
 * POST /api/trending
 *
 * Body: { query, platforms: ['youtube' | 'tiktok' | 'instagram'], limit }
 * Response: { results: TrendingResult[], errors: { platform, message }[] }
 *
 * Each platform's searcher runs in parallel via Promise.allSettled — one
 * failing source doesn't kill the whole response. Failures are reported
 * back to the client so the UI can show "TikTok unavailable" without
 * blocking results from the other platforms.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: TrendingSearchInput;
  try {
    body = (await request.json()) as TrendingSearchInput;
  } catch (err) {
    return logAndFail('trending:parse', err);
  }

  const query = (body.query ?? '').trim();
  if (!query) {
    return Response.json({ error: 'Query is required.' }, { status: 400 });
  }
  const platforms = (body.platforms?.length ? body.platforms : ['youtube', 'tiktok', 'instagram']) as TrendingPlatform[];
  const limit = Math.max(1, Math.min(body.limit ?? 8, 25));

  const youtubeKey = import.meta.env.YOUTUBE_API_KEY;
  const apifyToken = import.meta.env.APIFY_API_TOKEN;

  const tasks: Promise<{ platform: TrendingPlatform; results: TrendingResult[] }>[] = [];
  for (const p of platforms) {
    if (p === 'youtube') {
      if (!youtubeKey) {
        tasks.push(Promise.reject(new PlatformError('youtube', 'YOUTUBE_API_KEY not set in env.')));
        continue;
      }
      tasks.push(
        searchYouTubeTrending(query, limit, youtubeKey)
          .then((results) => ({ platform: 'youtube' as const, results }))
          .catch((e) => Promise.reject(new PlatformError('youtube', getMessage(e)))),
      );
    } else if (p === 'tiktok') {
      if (!apifyToken) {
        tasks.push(Promise.reject(new PlatformError('tiktok', 'APIFY_API_TOKEN not set in env.')));
        continue;
      }
      tasks.push(
        searchTikTokTrending(query, limit, apifyToken)
          .then((results) => ({ platform: 'tiktok' as const, results }))
          .catch((e) => Promise.reject(new PlatformError('tiktok', getMessage(e)))),
      );
    } else if (p === 'instagram') {
      if (!apifyToken) {
        tasks.push(Promise.reject(new PlatformError('instagram', 'APIFY_API_TOKEN not set in env.')));
        continue;
      }
      tasks.push(
        searchInstagramTrending(query, limit, apifyToken)
          .then((results) => ({ platform: 'instagram' as const, results }))
          .catch((e) => Promise.reject(new PlatformError('instagram', getMessage(e)))),
      );
    }
  }

  const settled = await Promise.allSettled(tasks);
  const results: TrendingResult[] = [];
  const errors: { platform: TrendingPlatform; message: string }[] = [];

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(...s.value.results);
    } else {
      const reason = s.reason;
      if (reason instanceof PlatformError) {
        errors.push({ platform: reason.platform, message: reason.message });
      } else {
        errors.push({ platform: 'youtube', message: getMessage(reason) });
      }
    }
  }

  // Sort: highest views first, but interleave platforms a bit so one source
  // doesn't dominate the top of the list.
  const ranked = interleaveByPlatform(results.sort((a, b) => (b.views ?? 0) - (a.views ?? 0)));

  const response: TrendingSearchResponse = { results: ranked, errors };
  return Response.json(response);
};

class PlatformError extends Error {
  constructor(public platform: TrendingPlatform, message: string) {
    super(message);
  }
}

function getMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Round-robin platforms so the top of the results list is mixed.
 * Within each platform, view-count order is preserved.
 */
function interleaveByPlatform(rs: TrendingResult[]): TrendingResult[] {
  const buckets = new Map<TrendingPlatform, TrendingResult[]>();
  for (const r of rs) {
    const arr = buckets.get(r.platform) ?? [];
    arr.push(r);
    buckets.set(r.platform, arr);
  }
  const out: TrendingResult[] = [];
  let drained = false;
  while (!drained) {
    drained = true;
    for (const arr of buckets.values()) {
      const next = arr.shift();
      if (next) {
        out.push(next);
        drained = false;
      }
    }
  }
  return out;
}

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
