import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Generated videos live in the same bucket as the rest of canvas-uploads
 * (PDFs, images). Bucket is private, so playback uses signed URLs.
 */
export const VIDEO_BUCKET = 'canvas-uploads';

/** ~30 days. Long enough that everyday use never hits expiry. The client
 *  re-signs on mount via /api/videos/sign for older canvases. */
export const VIDEO_URL_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function signVideoUrl(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(storagePath, VIDEO_URL_TTL_SECONDS);
  if (error) throw new Error(`signVideoUrl: ${error.message}`);
  if (!data?.signedUrl) throw new Error('signVideoUrl: empty signed URL');
  return data.signedUrl;
}
