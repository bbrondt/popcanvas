import { YoutubeTranscript } from 'youtube-transcript';
import ytdl from '@distube/ytdl-core';
import { AssemblyAI } from 'assemblyai';
import type { ExtractionResult } from './index';
import { parseVideoId } from './youtube-shared';

export { parseVideoId };

/**
 * Three-tier extraction. Each tier is tried in order until one returns text:
 *
 *   1. youtube-transcript via InnerTube. Free, instant, but only works when
 *      the uploader left captions on.
 *
 *   2. ytdl-core audio download + AssemblyAI ASR. Works for any video that
 *      ytdl can fetch — but YouTube blocks unauthenticated datacenter IPs
 *      with a "Sign in" page. Set YT_COOKIES to bypass. ~30–90s, $0.006/min.
 *
 *   3. Supadata.ai (or any compatible service exposing a YouTube transcript
 *      API). Fully managed; they handle bot detection on their end. Last
 *      resort because it's a paid third-party. Set SUPADATA_API_KEY to use.
 *
 * Title comes from oEmbed regardless of which tier produced the transcript.
 */
export async function extractYoutube({ url }: { url: string }): Promise<ExtractionResult> {
  const videoId = parseVideoId(url);
  if (!videoId) {
    throw new Error('Could not parse a video ID from that URL.');
  }

  const title = await fetchTitle(url, videoId);
  const baseMeta = {
    videoId,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };

  const captions = await tryYoutubeCaptions(videoId);
  if (captions) {
    return {
      title,
      content: captions.transcript,
      meta: { ...baseMeta, source: 'youtube-captions', segmentCount: captions.segmentCount },
    };
  }

  const errors: string[] = [];

  const assemblyKey = import.meta.env.ASSEMBLYAI_API_KEY;
  if (assemblyKey) {
    try {
      return await transcribeWithAssemblyAI({ videoId, url, title, apiKey: assemblyKey });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[youtube] AssemblyAI tier failed, will try Supadata if configured:', msg);
      errors.push(`AssemblyAI: ${msg}`);
    }
  }

  const supadataKey = import.meta.env.SUPADATA_API_KEY;
  if (supadataKey) {
    try {
      const transcript = await transcribeWithSupadata({ url, apiKey: supadataKey });
      return {
        title,
        content: transcript,
        meta: { ...baseMeta, source: 'supadata' },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[youtube] Supadata tier failed:', msg);
      errors.push(`Supadata: ${msg}`);
    }
  }

  if (errors.length === 0) {
    throw new Error(
      `This video has no readable YouTube transcript and no fallback is configured. Set ASSEMBLYAI_API_KEY (with YT_COOKIES) or SUPADATA_API_KEY to transcribe any video.`,
    );
  }
  throw new Error(`All transcript tiers failed: ${errors.join(' · ')}`);
}

interface CaptionsResult {
  transcript: string;
  segmentCount: number;
}

async function tryYoutubeCaptions(videoId: string): Promise<CaptionsResult | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    if (!segments.length) return null;
    const transcript = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    return { transcript, segmentCount: segments.length };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.warn('[youtube] captions path failed, will try ASR fallback if configured:', raw);
    return null;
  }
}

async function fetchTitle(url: string, videoId: string): Promise<string> {
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    );
    if (oembed.ok) {
      const data = (await oembed.json()) as { title?: string };
      if (data.title) return data.title;
    }
  } catch {
    // non-fatal
  }
  return `YouTube video ${videoId}`;
}

async function transcribeWithAssemblyAI(args: {
  videoId: string;
  url: string;
  title: string;
  apiKey: string;
}): Promise<ExtractionResult> {
  const client = new AssemblyAI({ apiKey: args.apiKey });

  // Pull audio-only stream from YouTube into memory. For long videos this
  // could be tens of MB; that's fine within Vercel's 1024MB function memory.
  // We pick lowest-bitrate audio because ASR doesn't need fidelity.
  const audioBuffer = await downloadAudio(args.url);

  // AssemblyAI SDK uploads + polls for completion in one call.
  const transcript = await client.transcripts.transcribe({
    audio: audioBuffer,
    speech_model: 'universal',
  });

  if (transcript.status === 'error') {
    throw new Error(`AssemblyAI: ${transcript.error ?? 'transcription failed'}`);
  }
  if (!transcript.text || !transcript.text.trim()) {
    throw new Error('AssemblyAI returned an empty transcript.');
  }

  return {
    title: args.title,
    content: transcript.text.trim(),
    meta: {
      videoId: args.videoId,
      thumbnail: `https://i.ytimg.com/vi/${args.videoId}/hqdefault.jpg`,
      source: 'assemblyai',
      audioDuration: transcript.audio_duration,
      assemblyaiId: transcript.id,
    },
  };
}

/**
 * Supadata.ai exposes a hosted YouTube transcript API at
 *   GET https://api.supadata.ai/v1/youtube/transcript?url=<url>&text=true
 *   header: x-api-key: <key>
 * Response shape: { content: string, lang?: string, ... } on success.
 *
 * If you swap to a different provider (SearchAPI, Apify, etc.), replace the
 * URL/header here — the rest of the pipeline doesn't care.
 */
async function transcribeWithSupadata(args: { url: string; apiKey: string }): Promise<string> {
  const endpoint = new URL('https://api.supadata.ai/v1/youtube/transcript');
  endpoint.searchParams.set('url', args.url);
  endpoint.searchParams.set('text', 'true');

  const res = await fetch(endpoint, {
    headers: { 'x-api-key': args.apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supadata returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: string; text?: string };
  const text = (data.content ?? data.text ?? '').trim();
  if (!text) throw new Error('Supadata returned an empty transcript.');
  return text;
}

async function downloadAudio(url: string): Promise<Buffer> {
  // YouTube blocks unauthenticated requests from datacenter IPs (Vercel) by
  // serving a "Sign in to confirm you're not a bot" page. If YT_COOKIES is
  // set, pass the cookie header so we look like a logged-in user. Format:
  // a single string copy-pasted from the Cookie header in browser devtools.
  const cookies = import.meta.env.YT_COOKIES;
  const requestOptions: { headers?: Record<string, string> } = {};
  if (cookies) {
    requestOptions.headers = {
      cookie: cookies,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    };
  }

  try {
    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'lowestaudio',
      highWaterMark: 1 << 25,
      requestOptions,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes('Sign in') || raw.includes('confirm') || raw.includes('bot')) {
      throw new Error(
        cookies
          ? `YouTube rejected our cookies as expired or invalid. Refresh YT_COOKIES from a logged-in browser session.`
          : `YouTube blocks audio downloads from datacenter IPs without authentication. Set YT_COOKIES in Vercel env (paste the Cookie header from a logged-in YouTube tab) to bypass this.`,
      );
    }
    throw new Error(`Could not download audio from YouTube: ${raw}`);
  }
}
