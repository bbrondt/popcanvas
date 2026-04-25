import type { APIRoute } from 'astro';
import { getServiceClient } from '@/lib/supabase/server';

export const prerender = false;

/**
 * GET /api/canvases  -> list canvases (most recent first).
 * POST /api/canvases -> create a new empty canvas, return { id }.
 *
 * No auth yet — every canvas belongs to the demo user. Add real auth
 * before exposing this beyond the personal scaffold.
 */

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

export const GET: APIRoute = async () => {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('canvases')
      .select('id, title, nodes, edges, updated_at, created_at')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[canvases:GET] supabase error:', error.message, error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    // Return a slim shape — the full nodes/edges arrays could be huge.
    const summaries = (data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      updated_at: c.updated_at,
      created_at: c.created_at,
      nodeCount: Array.isArray(c.nodes) ? c.nodes.length : 0,
      edgeCount: Array.isArray(c.edges) ? c.edges.length : 0,
    }));
    return Response.json({ canvases: summaries });
  } catch (err) {
    return logAndFail('canvases:GET', err);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    let body: { title?: string } = {};
    try {
      body = (await request.json()) as { title?: string };
    } catch {
      // empty body is fine
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('canvases')
      .insert({
        user_id: DEMO_USER_ID,
        title: body.title ?? 'Untitled canvas',
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      })
      .select('id, title')
      .single();

    if (error) {
      console.error('[canvases:POST] supabase error:', error.message, error);
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json(data);
  } catch (err) {
    return logAndFail('canvases:POST', err);
  }
};

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
