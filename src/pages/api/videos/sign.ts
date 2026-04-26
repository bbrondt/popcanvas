import type { APIRoute } from 'astro';
import { getServiceClient } from '@/lib/supabase/server';
import { signVideoUrl } from '@/lib/videoStorage';

export const prerender = false;

/**
 * POST /api/videos/sign
 *
 * Body: { storagePath: string }
 * Returns: { url: string }
 *
 * Re-signs a Supabase Storage path so VideoGen nodes can recover a fresh
 * playback URL when the one persisted on the canvas has expired (signed
 * URLs from /api/generate/video have a finite TTL — see videoStorage.ts).
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { storagePath?: string };
  try {
    body = (await request.json()) as { storagePath?: string };
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const storagePath = body.storagePath?.trim();
  if (!storagePath) {
    return Response.json({ error: 'storagePath is required.' }, { status: 400 });
  }

  // Defense-in-depth: only allow paths inside the videos/ prefix. Stops a
  // malicious caller from minting signed URLs for PDFs or images by guessing
  // their storage paths.
  if (!storagePath.startsWith('videos/')) {
    return Response.json({ error: 'Path is not a video.' }, { status: 400 });
  }

  try {
    const url = await signVideoUrl(getServiceClient(), storagePath);
    return Response.json({ url });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error('[videos:sign] failed:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
};
