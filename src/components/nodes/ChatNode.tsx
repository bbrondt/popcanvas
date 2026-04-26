import { useState, useRef, useEffect } from 'react';
import { useReactFlow, useStore, type Node, type Edge, type NodeProps } from '@xyflow/react';
import { NodeShell } from './NodeShell';
import { nanoid } from 'nanoid';
import {
  NODE_WIDTH,
  type ArtifactNodeData,
  type ArtifactTemplateId,
  type ChatNodeData,
  type ChatMessage,
  type SourceNodeData,
} from '@/lib/types';

export function ChatNode({ id, data, selected }: NodeProps) {
  const d = data as ChatNodeData;
  const flow = useReactFlow();
  const [draft, setDraft] = useState('');
  const [streamingText, setStreamingText] = useState('');
  // Local streaming flag avoids conflicts with the ReactFlow internal store
  // during high-frequency stream updates. We only commit to the node's data
  // once when the stream starts and once when it completes.
  const [isStreaming, setIsStreaming] = useState(false);

  // Reactive: the upstream context updates as edges are wired/unwired. This
  // is the same transitive walk the server does, so the panel matches what
  // Claude actually sees. Includes sources, prior chats, and prior artifacts.
  const upstream = useStore((s) => walkUpstream(id, s.nodes, s.edges));

  const messages = d.messages ?? [];

  const handleSend = async () => {
    if (!draft.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: draft.trim(),
      createdAt: new Date().toISOString(),
    };

    const userMessageText = draft.trim();
    setDraft('');
    setStreamingText('');
    setIsStreaming(true);

    // Single commit to the node store: append user message.
    flow.setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, messages: [...messages, userMsg], isStreaming: true } }
          : n,
      ),
    );

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canvasId: 'demo',
          chatNodeId: id,
          userMessage: userMessageText,
          // Pass the pre-mutation history so the server doesn't double-append
          // the user message it sees in the just-updated chatNode.data.messages.
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          nodes: flow.getNodes(),
          edges: flow.getEdges(),
        }),
      });

      // /api/chat returns 200 with an SSE body on success. Anything else means
      // the server failed before streaming started (auth, env vars, etc.) and
      // the body is JSON like {"error":"...","scope":"..."}, not SSE.
      if (!res.ok) {
        const raw = await res.text();
        let msg = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            msg = String((parsed as { error: unknown }).error);
          }
        } catch {
          // not JSON, use raw
        }
        throw new Error(msg || `chat request failed (${res.status})`);
      }
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';

      // Stream loop. Updates LOCAL component state on each frame.
      streamLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          // Parse JSON. If it fails, the frame is malformed — skip it.
          let event: { type: string; text?: string; error?: string } | null = null;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (!event) continue;
          if (event.type === 'text' && event.text) {
            assembled += event.text;
            setStreamingText(assembled);
          } else if (event.type === 'tool_use') {
            // Claude wants to spawn an asset. Create the artifact node now
            // and connect it to this chat (and to the same sources). It
            // auto-generates as soon as it mounts.
            handleToolUse(event as unknown as { name: string; input: unknown });
          } else if (event.type === 'error') {
            // Server-side stream error. Stop reading and bubble up to the
            // outer catch with the actual message instead of swallowing it.
            throw new Error(event.error ?? 'Stream error');
          } else if (event.type === 'done') {
            break streamLoop;
          }
        }
      }

      if (!assembled.trim()) {
        throw new Error(
          'Claude returned an empty response. Check Vercel function logs for [chat:stream] errors.',
        );
      }

      // Single commit to the node store at the end with the full message.
      const assistantMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: assembled,
        createdAt: new Date().toISOString(),
      };

      flow.setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  messages: [...messages, userMsg, assistantMsg],
                  isStreaming: false,
                },
              }
            : n,
        ),
      );
      setStreamingText('');
      setIsStreaming(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ChatNode] send failed:', err);
      flow.setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  messages: [...messages, userMsg],
                  isStreaming: false,
                  error: msg,
                },
              }
            : n,
        ),
      );
      setStreamingText('');
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * Spawn a new ArtifactNode in response to Claude's create_artifact tool
   * call. Wire it to this chat AND to the same sources (so it inherits
   * the chat's context). Position to the right of this node, stacking
   * downward if there are already artifacts in that column.
   */
  const handleToolUse = (event: { name: string; input: unknown }) => {
    if (event.name !== 'create_artifact') return;
    const input = (event.input ?? {}) as { template?: string; instructions?: string };
    const tplId = isValidTemplate(input.template) ? input.template : 'custom';
    const customInstructions = input.instructions?.trim() || '';

    const allNodes = flow.getNodes();
    const me = allNodes.find((n) => n.id === id);
    if (!me) return;

    const artifactId = `artifact-${nanoid(6)}`;

    // Stack vertically if other artifacts already sit to my right.
    const myRight = me.position.x + (me.width ?? NODE_WIDTH.chat);
    const stackedY = allNodes
      .filter((n) => (n.data as { kind?: string })?.kind === 'artifact' && n.position.x > myRight - 40)
      .reduce((max, n) => Math.max(max, n.position.y + (n.height ?? 400) + 24), me.position.y);

    const artifactNode: Node = {
      id: artifactId,
      type: 'artifact',
      position: { x: myRight + 80, y: stackedY === me.position.y ? me.position.y : stackedY },
      data: {
        kind: 'artifact',
        status: 'pending',
        template: tplId,
        customInstructions,
        autoGenerate: true,
      } satisfies ArtifactNodeData,
    };

    // Single edge: chat -> artifact. The transitive context walk in
    // walkContext means the artifact still inherits this chat's sources +
    // history without us duplicating edges. The lineage stays clean:
    //   source -> chat -> artifact
    // so future artifacts spawned from the same chat all hang off the chat.
    const newEdges: Edge[] = [
      { id: `e-${id}-${artifactId}`, source: id, target: artifactId, animated: true },
    ];

    flow.addNodes(artifactNode);
    flow.addEdges(newEdges);
  };

  return (
    <NodeShell
      id={id}
      selected={!!selected}
      width={NODE_WIDTH.chat}
      inputHandle
      outputHandle
      status={isStreaming ? 'pending' : 'ready'}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="node-label">⌘ chat</span>
        <span className={`node-label ${isStreaming ? 'text-ember' : 'text-moss'}`}>
          {isStreaming ? 'thinking…' : 'ready'}
        </span>
      </div>

      <UpstreamPanel upstream={upstream} />

      <MessagesScroller
        messages={messages}
        streamingText={streamingText}
        emptyHint={upstream.length === 0
          ? 'Connect sources, then ask a question.'
          : 'Ask a question about your context.'}
        error={!isStreaming ? d.error : undefined}
        onDismissError={() => flow.updateNodeData(id, { ...d, error: undefined })}
      />

      <div className="border-t border-ink-600 pt-2">
        {upstream.length > 0 && !isStreaming && (
          <QuickActions onPick={(prompt) => setDraft(prompt)} disabled={isStreaming} />
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask something about your sources…"
          rows={2}
          disabled={isStreaming}
          className="nodrag w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-sm resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="node-label opacity-60">⌘↵ to send</span>
          <button
            onClick={handleSend}
            disabled={!draft.trim() || isStreaming}
            className="pill-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isStreaming ? 'thinking…' : 'send'}
          </button>
        </div>
      </div>
    </NodeShell>
  );
}

function MessagesScroller({
  messages,
  streamingText,
  emptyHint,
  error,
  onDismissError,
}: {
  messages: ChatMessage[];
  streamingText: string;
  emptyHint: string;
  error: string | undefined;
  onDismissError: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Auto-scroll to the bottom whenever new content arrives. Otherwise long
  // conversations and streaming responses get pushed below the visible area
  // and the user thinks the chat froze.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, error]);

  return (
    <div
      ref={ref}
      className="max-h-80 overflow-y-auto space-y-3 mb-3 pr-1 scroll-smooth"
    >
      {messages.length === 0 && !streamingText && (
        <div className="text-bone-400 font-mono text-[11px] py-4 text-center">
          {emptyHint}
          <br />
          <span className="opacity-60">⌘ + Enter to send</span>
        </div>
      )}
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
      {streamingText && (
        <Message
          message={{
            id: 'streaming',
            role: 'assistant',
            content: streamingText,
            createdAt: '',
          }}
        />
      )}
      {error && <ChatError message={error} onDismiss={onDismissError} />}
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`text-[12px] ${isUser ? 'text-bone-200' : 'text-bone-50'}`}>
      <div className="node-label mb-1">{isUser ? '› you' : '⌘ claude'}</div>
      <div className="font-sans leading-relaxed whitespace-pre-wrap">{message.content}</div>
    </div>
  );
}

const VALID_TEMPLATES: ArtifactTemplateId[] = [
  'youtube-script',
  'video-script',
  'lead-magnet',
  'ad-copy',
  'tweet-thread',
  'blog-post',
  'email-sequence',
  'linkedin-post',
  'custom',
];

function isValidTemplate(t: string | undefined): t is ArtifactTemplateId {
  return !!t && (VALID_TEMPLATES as string[]).includes(t);
}

const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  { label: 'summarize', prompt: 'Give me a concise summary of the connected sources, highlighting the most important points.' },
  { label: 'takeaways', prompt: 'List the 5 most important takeaways from the connected sources, each as a single clear sentence.' },
  { label: 'angles', prompt: 'Brainstorm 10 distinct content angles I could use for marketing material based on the connected sources. For each, give a one-line description and the audience it would best serve.' },
  { label: 'questions', prompt: "What follow-up questions should I be asking based on these sources? List 5–10 questions that would deepen my understanding or surface what's missing." },
  { label: 'quotes', prompt: 'Pull the 5 most quotable lines or statistics from the connected sources. For each, include the source it came from.' },
];

function QuickActions({ onPick, disabled }: { onPick: (p: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {QUICK_PROMPTS.map((q) => (
        <button
          key={q.label}
          onClick={() => onPick(q.prompt)}
          disabled={disabled}
          className="pill-btn text-[10px] py-1 px-2"
          title={q.prompt}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

function ChatError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="border border-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] font-sans text-red-300 rounded-sm flex items-start gap-2">
      <div className="flex-1 leading-snug">
        <div className="node-label text-red-400 mb-0.5">chat error</div>
        {message}
      </div>
      <button onClick={onDismiss} className="text-red-300 hover:text-red-100 font-mono text-xs leading-none">
        ×
      </button>
    </div>
  );
}

// Local upstream walker — mirrors the server-side walkContext but returns
// flat row entries the panel can render. Includes hop distance so we can
// dim out further-upstream items so the user sees the lineage at a glance.
type UpstreamItem =
  | { id: string; kind: 'source'; data: SourceNodeData; hop: number }
  | { id: string; kind: 'chat'; messageCount: number; hop: number }
  | { id: string; kind: 'artifact'; template: string; status: string; hop: number };

function walkUpstream(
  consumerId: string,
  nodes: { id: string; data: { kind?: string } & Record<string, unknown> }[],
  edges: { source: string; target: string }[],
): UpstreamItem[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>([consumerId]);
  const queue: { id: string; hop: number }[] = [{ id: consumerId, hop: 0 }];
  const out: UpstreamItem[] = [];

  while (queue.length > 0) {
    const { id, hop } = queue.shift()!;
    for (const e of edges) {
      if (e.target !== id || visited.has(e.source)) continue;
      visited.add(e.source);
      const node = nodeById.get(e.source);
      if (!node) continue;
      const k = node.data?.kind;
      const nextHop = hop + 1;
      queue.push({ id: e.source, hop: nextHop });
      if (k === 'chat') {
        const c = node.data as unknown as ChatNodeData;
        out.push({ id: e.source, kind: 'chat', messageCount: c.messages?.length ?? 0, hop: nextHop });
      } else if (k === 'artifact') {
        const a = node.data as unknown as { template: string; status: string };
        out.push({ id: e.source, kind: 'artifact', template: a.template, status: a.status ?? 'idle', hop: nextHop });
      } else if (k && k !== 'chat' && k !== 'artifact') {
        out.push({ id: e.source, kind: 'source', data: node.data as unknown as SourceNodeData, hop: nextHop });
      }
    }
  }
  return out;
}

function UpstreamPanel({ upstream }: { upstream: UpstreamItem[] }) {
  if (upstream.length === 0) return null;
  const directCount = upstream.filter((u) => u.hop === 1).length;
  const indirectCount = upstream.length - directCount;
  return (
    <div className="border-y border-ink-600 py-2 mb-2 -mx-1 px-1">
      <div className="node-label opacity-60 mb-1.5">
        upstream context · {upstream.length}
        {indirectCount > 0 && (
          <span className="opacity-60"> ({directCount} direct, {indirectCount} via chain)</span>
        )}
      </div>
      <div className="space-y-1">
        {upstream.map((u) => (
          <UpstreamRow key={u.id} item={u} />
        ))}
      </div>
    </div>
  );
}

const KIND_SYMBOL: Record<string, string> = {
  youtube: '▶',
  pdf: '⌹',
  url: '↗',
  image: '▢',
  text: '¶',
  chat: '⌘',
  artifact: '✦',
};

function UpstreamRow({ item }: { item: UpstreamItem }) {
  const dim = item.hop > 1 ? 'opacity-60' : '';
  if (item.kind === 'source') {
    const symbol = KIND_SYMBOL[item.data.kind] ?? '·';
    const label =
      item.data.title ||
      ('url' in item.data && item.data.url) ||
      ('filename' in item.data && item.data.filename) ||
      item.data.kind;
    const statusColor =
      item.data.status === 'error'
        ? 'text-red-400'
        : item.data.status === 'pending'
          ? 'text-ember'
          : item.data.status === 'ready'
            ? 'text-moss'
            : 'text-bone-400';
    return (
      <div className={`flex items-center gap-2 text-[11px] font-mono ${dim}`}>
        <span className="text-ember w-3 text-center flex-shrink-0">{symbol}</span>
        <span className="text-bone-200 truncate flex-1">{String(label)}</span>
        <span className={`${statusColor} flex-shrink-0 uppercase tracking-wider`}>{item.data.status}</span>
      </div>
    );
  }
  if (item.kind === 'chat') {
    return (
      <div className={`flex items-center gap-2 text-[11px] font-mono ${dim}`}>
        <span className="text-ember w-3 text-center flex-shrink-0">{KIND_SYMBOL.chat}</span>
        <span className="text-bone-200 truncate flex-1">prior chat</span>
        <span className="text-bone-400 flex-shrink-0 uppercase tracking-wider">{item.messageCount} turns</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 text-[11px] font-mono ${dim}`}>
      <span className="text-neon w-3 text-center flex-shrink-0">{KIND_SYMBOL.artifact}</span>
      <span className="text-bone-200 truncate flex-1">prior artifact ({item.template})</span>
      <span
        className={`flex-shrink-0 uppercase tracking-wider ${
          item.status === 'ready' ? 'text-moss' : item.status === 'pending' ? 'text-ember' : 'text-bone-400'
        }`}
      >
        {item.status}
      </span>
    </div>
  );
}
