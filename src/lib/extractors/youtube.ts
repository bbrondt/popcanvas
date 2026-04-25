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
  const segments = await YoutubeTranscript.fetchTranscript(videoId);
  if (!segments.length) {
    throw new Error('No transcript available for this video.');
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
