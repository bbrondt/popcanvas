import { YoutubeTranscript } from 'youtube-transcript';
import ytdl from '@distube/ytdl-core';
import { AssemblyAI } from 'assemblyai';
import type { ExtractionResult } from './index';
import { parseVideoId } from './youtube-shared';

export { parseVideoId };

/**
 * Two-tier extraction:
 *   1. Try YouTube's own captions via youtube-transcript (free, instant).
 *   2. If captions are missing/disabled and ASSEMBLYAI_API_KEY is present,
 *      stream the audio with @distube/ytdl-core, hand it to AssemblyAI for
 *      ASR, and return that. ~30–90s, costs roughly $0.006/min.
 *
 * Title comes from oEmbed regardless of which path produced the transcript.
 */
export async function extractYoutube({ url }: { url: string }): Promise<ExtractionResult> {
  const videoId = parseVideoId(url);
  if (!videoId) {
    throw new Error('Could not parse a video ID from that URL.');
  }

  const title = await fetchTitle(url, videoId);

  const captions = await tryYoutubeCaptions(videoId);
  if (captions) {
    return {
      title,
      content: captions.transcript,
      meta: {
        videoId,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        source: 'youtube-captions',
        segmentCount: captions.segmentCount,
      },
    };
  }

  const apiKey = import.meta.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      `This video doesn't have a readable YouTube transcript, and no AssemblyAI fallback is configured. Set ASSEMBLYAI_API_KEY to transcribe audio for any video.`,
    );
  }

  return await transcribeWithAssemblyAI({ videoId, url, title, apiKey });
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

async function downloadAudio(url: string): Promise<Buffer> {
  // ytdl emits Buffer chunks; we collect them. If YouTube serves a bot-check
  // page from a datacenter IP, ytdl throws with a recognizable message — we
  // re-throw with a clearer one.
  try {
    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'lowestaudio',
      highWaterMark: 1 << 25, // 32MB internal buffer to ride out YT throttling
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
        `YouTube is challenging this request as a bot. Try again in a minute, or configure ytdl cookies if it persists.`,
      );
    }
    throw new Error(`Could not download audio from YouTube: ${raw}`);
  }
}
