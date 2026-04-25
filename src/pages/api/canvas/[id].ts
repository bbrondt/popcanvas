import type { APIRoute } from 'astro';
import { getServiceClient } from '@/lib/supabase/server';

export const prerender = false;

/**
 * GET /api/canvas/[id] -> returns the canvas row.
 * PUT /api/canvas/[id] -> upserts nodes, edges, viewport.
 *
 * For learning mode this skips real auth and pretends every request
 * is the same demo user. Wire up Supabase Auth + cookie-based sessions
 * before exposing this anywhere real.
 */

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

export const GET: APIRoute = async ({ params }) => {
  try {
    const id = params.id;
    if (!id) return new Response('Missing id', { status: 400 });

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('canvases')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[canvas:GET] supabase error:', error.message, error);
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data) return new Response('Not found', { status: 404 });

    return Response.json(data);
  } catch (err) {
    return logAndFail('canvas:GET', err);
  }
};

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const id = params.id;
    if (!id) return new Response('Missing id', { status: 400 });

    const body = (await request.json()) as {
      title?: string;
      nodes?: unknown;
      edges?: unknown;
      viewport?: unknown;
    };

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('canvases')
      .upsert(
        {
          id,
          user_id: DEMO_USER_ID,
          title: body.title ?? 'Untitled canvas',
          nodes: body.nodes ?? [],
          edges: body.edges ?? [],
          viewport: body.viewport ?? { x: 0, y: 0, zoom: 1 },
        },
        { onConflict: 'id' },
      )
      .select()
      .single();

    if (error) {
      console.error('[canvas:PUT] supabase error:', error.message, error);
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json(data);
  } catch (err) {
    return logAndFail('canvas:PUT', err);
  }
};

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
