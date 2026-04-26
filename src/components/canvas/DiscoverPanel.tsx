import { useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type {
  TrendingPlatform,
  TrendingResult,
  TrendingSearchResponse,
} from '@/lib/trending/types';
import type { CanvasNode, UrlNodeData, YoutubeNodeData } from '@/lib/types';

const ALL_PLATFORMS: { id: TrendingPlatform; label: string; symbol: string }[] = [
  { id: 'youtube', label: 'YouTube', symbol: '▶' },
  { id: 'tiktok', label: 'TikTok', symbol: '♪' },
  { id: 'instagram', label: 'Instagram', symbol: '◉' },
];

interface DiscoverPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Slide-in right panel for finding trending videos by topic across YouTube,
 * TikTok, and Instagram. Click a result card to drop the corresponding node
 * onto the canvas with the URL pre-filled. The panel persists open so you can
 * search → add several → search again without losing state.
 */
export function DiscoverPanel({ open, onClose }: DiscoverPanelProps) {
  const flow = useReactFlow();
  const [query, setQuery] = useState('');
  const [platforms, setPlatforms] = useState<Set<TrendingPlatform>>(
    new Set(['youtube', 'tiktok', 'instagram']),
  );
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TrendingResult[]>([]);
  const [errors, setErrors] = useState<{ platform: TrendingPlatform; message: string }[]>([]);
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const [topError, setTopError] = useState<string | null>(null);

  // Reset added marks when the panel re-opens.
  useEffect(() => {
    if (open) {
      setAddedUrls(new Set());
    }
  }, [open]);

  const togglePlatform = (p: TrendingPlatform) => {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const search = async () => {
    if (loading) return;
    if (!query.trim()) {
      setTopError('Type a niche or keyword first.');
      return;
    }
    if (platforms.size === 0) {
      setTopError('Pick at least one platform.');
      return;
    }
    setLoading(true);
    setTopError(null);
    setErrors([]);
    try {
      const res = await fetch('/api/trending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          platforms: Array.from(platforms),
          limit: 8,
        }),
      });
      if (!res.ok) {
        const raw = await res.text();
        let msg = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            msg = String((parsed as { error: unknown }).error);
          }
        } catch {
          /* not JSON */
        }
        throw new Error(msg || `Search failed (${res.status})`);
      }
      const data = (await res.json()) as TrendingSearchResponse;
      setResults(data.results);
      setErrors(data.errors);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void search();
    }
  };

  const addToCanvas = (r: TrendingResult) => {
    const center = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = nanoid();
    const jitter = () => Math.random() * 80 - 40;

    let node: CanvasNode;
    if (r.platform === 'youtube') {
      node = {
        id,
        type: 'youtube',
        position: { x: center.x + jitter(), y: center.y + jitter() },
        data: {
          kind: 'youtube',
          status: 'idle',
          url: r.url,
          title: r.title,
          thumbnail: r.thumbnail,
        } satisfies YoutubeNodeData,
      } as unknown as CanvasNode;
    } else {
      // TikTok and Instagram pages return 451 to Jina (and most scrapers).
      // Instead of asking the URL extractor to do an impossible thing, bake
      // the data we ALREADY paid Apify for directly into the node as content
      // and mark it ready. Claude reads d.content via the system prompt.
      // We also pass the cover thumbnail + platform tag so the node renders
      // as a TikTok/Instagram card on the canvas instead of a generic URL.
      node = {
        id,
        type: 'url',
        position: { x: center.x + jitter(), y: center.y + jitter() },
        data: {
          kind: 'url',
          status: 'ready',
          url: r.url,
          title: r.title,
          content: formatSocialContent(r),
          thumbnail: r.thumbnail,
          platform: r.platform,
        } satisfies UrlNodeData,
      } as unknown as CanvasNode;
    }
    flow.addNodes(node);
    setAddedUrls((s) => new Set(s).add(r.url));
  };

  return (
    <div
      className={`fixed top-0 right-0 bottom-0 w-[440px] z-40 transition-transform duration-300 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{
        background: 'rgba(13, 8, 32, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(0, 229, 255, 0.18)',
        boxShadow: '-12px 0 48px -8px rgba(0,0,0,0.6)',
      }}
    >
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between px-5 py-4 border-b border-ink-600">
          <div>
            <div className="font-display text-bone-50 text-lg tracking-tight">discover</div>
            <div className="node-label opacity-60 mt-0.5">trending in your niche</div>
          </div>
          <button
            onClick={onClose}
            className="text-bone-300 hover:text-ember transition-colors text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5"
            title="Close"
          >
            ×
          </button>
        </header>

        <div className="px-5 py-4 border-b border-ink-600 space-y-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="mortgage, agency growth, crypto, …"
            className="w-full bg-ink-900/60 border border-ink-600 px-3 py-2 text-sm font-mono text-bone-100 focus:border-ember outline-none rounded-md"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {ALL_PLATFORMS.map((p) => {
                const active = platforms.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePlatform(p.id)}
                    className={`pill-btn flex items-center gap-1.5 ${active ? 'border-ember text-ember' : ''}`}
                    style={
                      active
                        ? { boxShadow: '0 0 12px -2px rgba(0,229,255,0.45)', background: 'rgba(0,229,255,0.08)' }
                        : undefined
                    }
                    title={`${active ? 'Hide' : 'Show'} ${p.label} results`}
                  >
                    <span>{p.symbol}</span>
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={search}
              disabled={loading || !query.trim()}
              className="pill-btn-primary disabled:opacity-40"
            >
              {loading ? 'searching…' : 'search'}
            </button>
          </div>
          {topError && (
            <div className="text-[11px] font-sans text-red-300">{topError}</div>
          )}
          {errors.length > 0 && (
            <div className="text-[11px] font-mono text-bone-400 space-y-0.5">
              {errors.map((e, i) => (
                <div key={i}>
                  <span className="text-red-300/80 uppercase tracking-wider">{e.platform}</span>: {e.message}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {results.length === 0 && !loading && (
            <div className="text-center text-bone-400 font-mono text-[11px] py-8">
              {query ? 'no results yet — hit search' : 'type a niche to find trending videos'}
            </div>
          )}
          {loading && results.length === 0 && (
            <div className="text-center text-ember font-mono text-[11px] py-8 animate-pulse-glow">
              searching across platforms…
            </div>
          )}
          {results.map((r, idx) => (
            <ResultCard
              key={`${r.platform}-${r.url}-${idx}`}
              r={r}
              added={addedUrls.has(r.url)}
              onAdd={() => addToCanvas(r)}
            />
          ))}
        </div>

        <footer className="px-5 py-3 border-t border-ink-600 text-[10px] font-mono text-bone-400 leading-relaxed space-y-1">
          <div>
            click a card to add it as a source on your canvas. wire it to a chat
            or artifact node to analyze.
          </div>
          <div className="opacity-70">
            yt: official api, sorted by views, last 90d. tt/ig: apify search +
            filtered for &gt;=1k views &amp; recent posts.
          </div>
        </footer>
      </div>
    </div>
  );
}

function ResultCard({
  r,
  added,
  onAdd,
}: {
  r: TrendingResult;
  added: boolean;
  onAdd: () => void;
}) {
  const platformBadgeColor = {
    youtube: 'text-red-400',
    tiktok: 'text-neon',
    instagram: 'text-ember',
  }[r.platform];

  return (
    <button
      onClick={onAdd}
      className="w-full text-left node-frame p-3 group hover:border-ember transition-all"
      style={added ? { borderColor: 'rgba(74,222,128,0.5)' } : undefined}
    >
      <div className="flex gap-3">
        {r.thumbnail ? (
          <img
            src={r.thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            className="w-24 h-24 object-cover rounded-md flex-shrink-0 bg-ink-900"
          />
        ) : (
          <div className="w-24 h-24 rounded-md flex-shrink-0 bg-ink-900 flex items-center justify-center text-bone-400 text-2xl">
            {r.platform === 'youtube' ? '▶' : r.platform === 'tiktok' ? '♪' : '◉'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className={`node-label ${platformBadgeColor} uppercase tracking-wider`}>
              {r.platform}
            </span>
            {added && <span className="node-label text-moss">added ✓</span>}
          </div>
          <div className="font-display text-[13px] text-bone-50 leading-tight line-clamp-2 mb-1">
            {r.title}
          </div>
          {r.author && (
            <div className="text-[11px] font-mono text-bone-300 truncate">@{r.author}</div>
          )}
          <div className="flex gap-3 mt-1.5 text-[10px] font-mono text-bone-400">
            {typeof r.views === 'number' && <span>{formatCount(r.views)} views</span>}
            {typeof r.likes === 'number' && <span>{formatCount(r.likes)} likes</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Pack everything we know about a TikTok/Instagram post into the node's
 * content field, in a format Claude can quote from when it's connected to
 * a chat or artifact. Looks like:
 *
 *   Platform: TikTok
 *   Author: @brad
 *   Posted: 2025-04-01
 *   Views: 1.2M · Likes: 50K
 *   URL: https://...
 *
 *   Caption:
 *   <full caption text>
 */
function formatSocialContent(r: TrendingResult): string {
  const lines: string[] = [];
  lines.push(`Platform: ${r.platform.toUpperCase()}`);
  if (r.author) lines.push(`Author: @${r.author}`);
  if (r.publishedAt) {
    const d = new Date(r.publishedAt);
    if (!isNaN(d.getTime())) lines.push(`Posted: ${d.toISOString().slice(0, 10)}`);
  }
  const stats: string[] = [];
  if (typeof r.views === 'number') stats.push(`Views: ${r.views.toLocaleString()}`);
  if (typeof r.likes === 'number') stats.push(`Likes: ${r.likes.toLocaleString()}`);
  if (stats.length) lines.push(stats.join(' · '));
  lines.push(`URL: ${r.url}`);
  if (r.description) {
    lines.push('');
    lines.push('Caption:');
    lines.push(r.description);
  }
  return lines.join('\n');
}
