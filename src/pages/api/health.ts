import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * GET /api/health
 *
 * Lightweight readiness probe. Reports whether the env vars the app needs are
 * present (without revealing their values). Use this to verify Vercel env
 * wiring before triggering a real extraction or chat request.
 */
export const GET: APIRoute = async () => {
  const env = {
    hasAnthropic: Boolean(import.meta.env.ANTHROPIC_API_KEY),
    hasSupabase:
      Boolean(import.meta.env.PUBLIC_SUPABASE_URL) &&
      Boolean(import.meta.env.SUPABASE_SERVICE_ROLE_KEY),
    hasSupabaseAnon: Boolean(import.meta.env.PUBLIC_SUPABASE_ANON_KEY),
    hasFirecrawl: Boolean(import.meta.env.FIRECRAWL_API_KEY),
    hasAssemblyAI: Boolean(import.meta.env.ASSEMBLYAI_API_KEY),
  };

  return Response.json({ ok: true, env });
};
