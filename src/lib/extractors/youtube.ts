import { YoutubeTranscript } from 'youtube-transcript';
import type { ExtractionResult } from './index';

const VIDEO_ID_RE = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;

export function parseVideoId(url: string): string | null {
  const m = url.match(VIDEO_ID_RE);
  return m ? m[1] : null;
}

export async function extractYoutube({ url }: { url: string }): Promise<ExtractionResult> {
  const videoId = parseVideoId(url);
  if (!videoId) {
    throw new Error('Could not parse a video ID from that URL.');
  }

  // youtube-transcript returns an array of { text, duration, offset } chunks.
  // Errors from the package are prefixed `[YoutubeTranscript] 🚨 ` — strip that
  // so the node UI shows a clean human message.
  let segments: Awaited<ReturnType<typeof YoutubeTranscript.fetchTranscript>>;
  try {
    segments = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const cleaned = raw.replace(/^\[YoutubeTranscript\]\s*🚨?\s*/u, '').trim();
    throw new Error(friendlyYoutubeError(cleaned, videoId));
  }
  if (!segments.length) {
    throw new Error(friendlyYoutubeError('No transcript available for this video.', videoId));
  }

  const transcript = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();

  // We can't get the title from youtube-transcript alone. For a real build,
  // hit the oEmbed endpoint: https://www.youtube.com/oembed?url=...&format=json
  // For the scaffold, we fetch oEmbed inline.
  let title = `YouTube video ${videoId}`;
  try {
    const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (oembed.ok) {
      const data = (await oembed.json()) as { title?: string };
      if (data.title) title = data.title;
    }
  } catch {
    // Non-fatal. Keep the placeholder title.
  }

  return {
    title,
    content: transcript,
    meta: {
      videoId,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      segmentCount: segments.length,
    },
  };
}

/**
 * Most YouTube extraction failures come from the same root cause: the uploader
 * disabled captions, or this is a video type (Shorts, livestreams, music
 * videos) where YouTube doesn't auto-generate them. Surface that plainly so
 * the user knows to try a different video instead of debugging.
 */
function friendlyYoutubeError(reason: string, videoId: string): string {
  const lower = reason.toLowerCase();
  const isCaptionIssue =
    lower.includes('disabled') ||
    lower.includes('no transcript') ||
    lower.includes('not available') ||
    lower.includes('captions');
  if (isCaptionIssue) {
    return `This YouTube video (${videoId}) doesn't have a readable transcript — captions are either disabled or this video type doesn't get them. Try a video where the CC button works on YouTube (TED Talks, conference talks, podcasts, most educational channels).`;
  }
  if (lower.includes('captcha') || lower.includes('too many requests')) {
    return `YouTube is rate-limiting transcript fetches from this server. Wait a few minutes and try again, or use a different video.`;
  }
  if (lower.includes('no longer available') || lower.includes('unavailable')) {
    return `This video isn't available (private, deleted, or region-locked).`;
  }
  return reason;
}
