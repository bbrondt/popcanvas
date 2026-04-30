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

  // When this chat was spawned as a branch (via spawn_branches), the
  // parent passes a starter message via pendingMessage. Auto-fire it
  // exactly once on mount so each branch arrives with an answer ready
  // — that's the whole point of parallel branches. The flag is then
  // cleared on the node so a refresh / canvas reload doesn't re-fire.
  // Guard with a ref to prevent double-fire under React StrictMode.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (!d.pendingMessage || isStreaming || messages.length > 0) return;
    autoFiredRef.current = true;
    const msg = d.pendingMessage;
    // Clear the flag from the node BEFORE sending so a re-render
    // mid-stream can't double-fire it.
    flow.updateNodeData(id, { ...d, pendingMessage: undefined });
    void handleSend(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.pendingMessage]);

  const handleSend = async (override?: string) => {
    // `override` lets the auto-fire path (pendingMessage from a spawned
    // branch) send a message without that text being in the draft input.
    // Manual sends pass nothing and use the draft state as before.
    const text = (override ?? draft).trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    const userMessageText = text;
    if (!override) setDraft('');
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
   * Dispatch tool_use events from Claude. Two flavors:
   *   - create_artifact   → one artifact node
   *   - spawn_branches    → N nodes (chat or artifact) fanned below this
   *                          chat, each carrying its own topic / message.
   *                          Used when the user asks for parallel work
   *                          ("a branch for each archetype") so we don't
   *                          stuff everything into a single chat reply.
   */
  const handleToolUse = (event: { name: string; input: unknown }) => {
    if (event.name === 'create_artifact') {
      handleCreateArtifact(event.input);
    } else if (event.name === 'spawn_branches') {
      handleSpawnBranches(event.input);
    }
  };

  const handleCreateArtifact = (rawInput: unknown) => {
    const input = (rawInput ?? {}) as { template?: string; instructions?: string };
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

  /**
   * Fan an array of new nodes out below this chat. Each branch is either
   * a chat (with an auto-firing starterMessage) or an artifact (with a
   * template + instructions). All connect upward to this chat, so they
   * inherit its source context via walkContext's transitive walk.
   *
   * Layout: horizontal row of equal-spaced nodes, centered under this
   * chat, with a fixed vertical gap. If the row gets too wide it'll
   * spill past viewport edges — fit-view (Cmd+0) reframes everything.
   */
  const handleSpawnBranches = (rawInput: unknown) => {
    const input = (rawInput ?? {}) as {
      branches?: {
        kind?: 'chat' | 'artifact';
        title?: string;
        starterMessage?: string;
        template?: string;
        instructions?: string;
      }[];
    };
    const branches = Array.isArray(input.branches) ? input.branches : [];
    if (branches.length === 0) return;

    const allNodes = flow.getNodes();
    const me = allNodes.find((n) => n.id === id);
    if (!me) return;

    const meWidth = me.width ?? NODE_WIDTH.chat;
    const meHeight = me.height ?? 500;
    const colGap = 32;
    const rowGap = 96;

    // Center the row under this chat. Use the chat width per branch so
    // the spacing matches the visible node sizes regardless of kind.
    const itemWidth = NODE_WIDTH.chat;
    const totalWidth = branches.length * itemWidth + (branches.length - 1) * colGap;
    const startX = me.position.x + meWidth / 2 - totalWidth / 2;
    const baseY = me.position.y + meHeight + rowGap;

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    branches.forEach((branch, i) => {
      const x = startX + i * (itemWidth + colGap);
      const y = baseY;
      const title = branch.title?.trim() || (branch.kind === 'chat' ? 'Branch' : 'Asset');

      if (branch.kind === 'artifact') {
        const tplId = isValidTemplate(branch.template) ? branch.template : 'custom';
        const customInstructions = [
          title ? `# ${title}` : '',
          branch.instructions?.trim() ?? '',
        ]
          .filter(Boolean)
          .join('\n\n');
        const artifactId = `artifact-${nanoid(6)}`;
        newNodes.push({
          id: artifactId,
          type: 'artifact',
          position: { x, y },
          data: {
            kind: 'artifact',
            status: 'pending',
            template: tplId,
            customInstructions,
            autoGenerate: true,
          } satisfies ArtifactNodeData,
        });
        newEdges.push({
          id: `e-${id}-${artifactId}`,
          source: id,
          target: artifactId,
          animated: true,
        });
      } else {
        // Chat branch. The pendingMessage gets auto-sent on mount via
        // an effect inside the spawned ChatNode (see useEffect below);
        // we DON'T add it to messages here because that'd double-send.
        const chatId = `chat-${nanoid(6)}`;
        newNodes.push({
          id: chatId,
          type: 'chat',
          position: { x, y },
          data: {
            kind: 'chat',
            status: 'idle',
            messages: [],
            branchTitle: title,
            pendingMessage: branch.starterMessage?.trim() || undefined,
          } satisfies ChatNodeData,
        });
        newEdges.push({
          id: `e-${id}-${chatId}`,
          source: id,
          target: chatId,
          animated: true,
        });
      }
    });

    flow.addNodes(newNodes);
    flow.addEdges(newEdges);
  };

  const headerTitle = d.branchTitle?.trim() || 'AI Assistant';
  const focusSelf = () => {
    flow.fitView({ nodes: [{ id }], padding: 0.4, duration: 320 });
  };
  const showHero = messages.length === 0 && !streamingText && !d.error;

  return (
    <NodeShell
      id={id}
      selected={!!selected}
      width={NODE_WIDTH.chat}
      inputHandle
      outputHandle
      status={isStreaming ? 'pending' : 'ready'}
    >
      <ChatHeader title={headerTitle} isStreaming={isStreaming} onFocus={focusSelf} />

      <UpstreamPanel upstream={upstream} />

      {showHero ? (
        <AiActionsHero
          onPick={(prompt) => {
            void handleSend(prompt);
          }}
          disabled={isStreaming || upstream.length === 0}
          hasUpstream={upstream.length > 0}
        />
      ) : (
        <MessagesScroller
          messages={messages}
          streamingText={streamingText}
          error={!isStreaming ? d.error : undefined}
          onDismissError={() => flow.updateNodeData(id, { ...d, error: undefined })}
        />
      )}

      <div className="pt-2">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message…"
            rows={1}
            disabled={isStreaming}
            className="nodrag nowheel flex-1 bg-ink-900/80 border border-ink-600 px-4 py-2 text-[12px] font-sans text-bone-100 placeholder:text-bone-400 focus:border-ember/60 outline-none rounded-2xl resize-none leading-snug min-h-[36px] max-h-32"
          />
          <button
            onClick={() => handleSend()}
            disabled={!draft.trim() || isStreaming}
            className="send-button nodrag"
            title="Send (⌘↵)"
            aria-label="Send message"
          >
            <ArrowUpIcon />
          </button>
        </div>
        <div className="mt-1.5 text-center">
          <span className="node-label opacity-50">⌘↵ to send</span>
        </div>
      </div>
    </NodeShell>
  );
}

function ChatHeader({
  title,
  isStreaming,
  onFocus,
}: {
  title: string;
  isStreaming: boolean;
  onFocus: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 pb-2.5 mb-3 border-b border-ink-600/70">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-ember/25 to-neon/20 border border-ember/30 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_-2px_rgba(0,229,255,0.4)]">
        <ChatBubbleIcon />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-display text-[13px] font-medium text-bone-50 truncate leading-tight">
          {title}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              isStreaming ? 'bg-ember animate-pulse' : 'bg-moss'
            }`}
          />
          <span className="node-label opacity-70">
            {isStreaming ? 'thinking' : 'ready'}
          </span>
        </div>
      </div>
      <button
        onClick={onFocus}
        className="nodrag w-6 h-6 flex items-center justify-center text-bone-300 hover:text-ember hover:bg-ember/10 rounded transition-colors"
        title="Focus this node"
        aria-label="Focus this node"
      >
        <ExpandIcon />
      </button>
    </div>
  );
}

function AiActionsHero({
  onPick,
  disabled,
  hasUpstream,
}: {
  onPick: (prompt: string) => void;
  disabled: boolean;
  hasUpstream: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 px-2 mb-2">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-ember/15 to-neon/15 border border-ember/30 flex items-center justify-center mb-3 shadow-[0_0_18px_-4px_rgba(0,229,255,0.45)]">
        <SparkleIcon />
      </div>
      <div className="font-display text-[14px] text-bone-50 mb-1 font-medium">AI Actions</div>
      <div className="node-label opacity-60 mb-3">
        {hasUpstream ? 'pick an action or type below' : 'connect a source to get started'}
      </div>
      <div className="flex flex-col gap-1.5 w-full max-w-[260px]">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q.label}
            onClick={() => onPick(q.prompt)}
            disabled={disabled}
            className="action-pill nodrag"
            title={q.prompt}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatBubbleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-ember">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-ember">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function MessagesScroller({
  messages,
  streamingText,
  error,
  onDismissError,
}: {
  messages: ChatMessage[];
  streamingText: string;
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
      className="nowheel max-h-80 overflow-y-auto space-y-3 mb-3 pr-1 scroll-smooth"
    >
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
  { label: 'Summarize', prompt: 'Give me a concise summary of the connected sources, highlighting the most important points.' },
  { label: 'Key insights', prompt: 'List the 5 most important takeaways from the connected sources, each as a single clear sentence.' },
  { label: 'Find new ideas', prompt: 'Brainstorm 10 distinct content angles I could use for marketing material based on the connected sources. For each, give a one-line description and the audience it would best serve.' },
];

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
