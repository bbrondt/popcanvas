import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

export const prerender = false;

/**
 * GET /api/health
 *   Reports which env vars are wired (without revealing values).
 *
 * GET /api/health?ping=anthropic
 *   Additionally fires a tiny request at Claude using your configured key
 *   and model, and returns success/error. Use this to verify the chat
 *   path independently of any UI/SSE plumbing — if this works and the
 *   chat node doesn't, the bug is in the streaming/SSE layer, not auth.
 *
 * GET /api/health?ping=supadata
 *   Tests the Supadata key + endpoint with a known video URL.
 */
export const GET: APIRoute = async ({ url }) => {
  const env = {
    hasAnthropic: Boolean(import.meta.env.ANTHROPIC_API_KEY),
    hasSupabase:
      Boolean(import.meta.env.PUBLIC_SUPABASE_URL) &&
      Boolean(import.meta.env.SUPABASE_SERVICE_ROLE_KEY),
    hasSupabaseAnon: Boolean(import.meta.env.PUBLIC_SUPABASE_ANON_KEY),
    hasFirecrawl: Boolean(import.meta.env.FIRECRAWL_API_KEY),
    hasAssemblyAI: Boolean(import.meta.env.ASSEMBLYAI_API_KEY),
    hasYoutubeCookies: Boolean(import.meta.env.YT_COOKIES),
    hasSupadata: Boolean(import.meta.env.SUPADATA_API_KEY),
  };

  const result: Record<string, unknown> = { ok: true, env };

  const ping = url.searchParams.get('ping');

  if (ping === 'anthropic') {
    result.anthropicPing = await pingAnthropic();
  }

  if (ping === 'supadata') {
    result.supadataPing = await pingSupadata();
  }

  return Response.json(result);
};

async function pingAnthropic(): Promise<Record<string, unknown>> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY is not set in env.' };

  const model = 'claude-sonnet-4-6';
  const t0 = Date.now();
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with only the word: pong' }],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')
      .trim();
    return {
      ok: true,
      model,
      ms: Date.now() - t0,
      stopReason: response.stop_reason,
      reply: text,
      keyPrefix: apiKey.slice(0, 12) + '…',
    };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error('[health:anthropic] ping failed:', e.message, '\n', e.stack);
    return {
      ok: false,
      model,
      ms: Date.now() - t0,
      error: e.message,
      keyPrefix: apiKey.slice(0, 12) + '…',
    };
  }
}

async function pingSupadata(): Promise<Record<string, unknown>> {
  const apiKey = import.meta.env.SUPADATA_API_KEY;
  if (!apiKey) return { ok: false, error: 'SUPADATA_API_KEY is not set in env.' };

  const t0 = Date.now();
  try {
    const endpoint = new URL('https://api.supadata.ai/v1/youtube/transcript');
    // dQw4w9WgXcQ is famously captioned, so this should always work.
    endpoint.searchParams.set('url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    endpoint.searchParams.set('text', 'true');
    const res = await fetch(endpoint, { headers: { 'x-api-key': apiKey } });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      bodyPreview: body.slice(0, 200),
    };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return { ok: false, ms: Date.now() - t0, error: e.message };
  }
}
