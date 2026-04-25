import type { ExtractionResult } from './index';

/**
 * Naive URL extractor. Fetches the page, strips scripts and styles, pulls
 * text out of the body. Good enough for a learning scaffold.
 *
 * Production alternatives, in rough order of preference:
 *   - Firecrawl (https://firecrawl.dev) — best for JS-heavy pages
 *   - Jina Reader (https://r.jina.ai/<url>) — free, returns clean markdown
 *   - Self-hosted Readability via @mozilla/readability + jsdom
 */
export async function extractUrl({ url }: { url: string }): Promise<ExtractionResult> {
  const firecrawlKey = import.meta.env.FIRECRAWL_API_KEY;
  if (firecrawlKey) {
    return extractWithFirecrawl(url, firecrawlKey);
  }
  return extractWithJina(url);
}

async function extractWithFirecrawl(url: string, apiKey: string): Promise<ExtractionResult> {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  });
  if (!res.ok) throw new Error(`Firecrawl failed: ${res.status}`);
  const data = (await res.json()) as { data?: { markdown?: string; metadata?: { title?: string } } };
  const content = data.data?.markdown ?? '';
  const title = data.data?.metadata?.title ?? new URL(url).hostname;
  return { title, content, meta: { source: 'firecrawl' } };
}

async function extractWithJina(url: string): Promise<ExtractionResult> {
  // r.jina.ai is a free reader endpoint that returns clean markdown.
  // Default to it if no Firecrawl key is configured.
  const readerUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(readerUrl, {
    headers: { Accept: 'text/markdown' },
  });
  if (!res.ok) throw new Error(`Jina reader failed: ${res.status}`);
  const markdown = await res.text();

  // Jina prepends a "Title: ..." line we can parse out for the node title.
  const titleMatch = markdown.match(/^Title:\s*(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? new URL(url).hostname;

  return { title, content: markdown, meta: { source: 'jina' } };
}
