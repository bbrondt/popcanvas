import type { APIRoute } from 'astro';
import { extract } from '@/lib/extractors';
import { getServiceClient } from '@/lib/supabase/server';
import type { NodeKind } from '@/lib/types';
import crypto from 'node:crypto';

export const prerender = false;

/**
 * POST /api/extract
 *
 * For text + url + youtube nodes, the body is JSON: { kind, payload }.
 * For pdf + image nodes, the body is multipart form-data with a 'file' field.
 *
 * Caches results in source_extractions keyed by a hash of the payload, so
 * the same YouTube URL or file content extracted across multiple canvases
 * only hits the underlying service once.
 */
export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('multipart/form-data')) {
      return handleFileUpload(request);
    }
    return handleJson(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: msg }, { status: 500 });
  }
};

async function handleJson(request: Request): Promise<Response> {
  const body = (await request.json()) as { kind: NodeKind; payload: Record<string, unknown> };

  const cacheKey = makeCacheKey(body.kind, JSON.stringify(body.payload));
  const cached = await readCache(cacheKey);
  if (cached) return Response.json(cached);

  const result = await extract(body);
  await writeCache(cacheKey, body.kind, result);
  return Response.json(result);
}

async function handleFileUpload(request: Request): Promise<Response> {
  const form = await request.formData();
  const kind = form.get('kind') as NodeKind | null;
  const file = form.get('file') as File | null;
  if (!kind || !file) return new Response('Missing kind or file', { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const cacheKey = makeCacheKey(kind, hashBuffer(buffer));
  const cached = await readCache(cacheKey);
  if (cached) return Response.json(cached);

  const result = await extract({
    kind,
    payload: { buffer, filename: file.name },
  });
  await writeCache(cacheKey, kind, result);
  return Response.json(result);
}

function makeCacheKey(kind: NodeKind, identifier: string): string {
  return `${kind}:${crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 32)}`;
}

function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function readCache(key: string): Promise<unknown | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('source_extractions')
    .select('title, content, meta')
    .eq('source_key', key)
    .maybeSingle();
  return data;
}

async function writeCache(
  key: string,
  kind: NodeKind,
  result: { title: string; content: string; meta?: Record<string, unknown> },
): Promise<void> {
  const supabase = getServiceClient();
  await supabase
    .from('source_extractions')
    .upsert(
      {
        source_key: key,
        source_type: kind,
        title: result.title,
        content: result.content,
        meta: result.meta ?? {},
      },
      { onConflict: 'source_key' },
    );
}
