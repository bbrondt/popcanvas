/**
 * Tiny browser-safe helpers for the YouTube extractor. Lives in its own file
 * so client-side components (YoutubeNode) can import parseVideoId without
 * dragging the server-only ytdl-core / AssemblyAI deps into the client bundle.
 */

const VIDEO_ID_RE = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;

export function parseVideoId(url: string): string | null {
  const m = url.match(VIDEO_ID_RE);
  return m ? m[1] : null;
}
