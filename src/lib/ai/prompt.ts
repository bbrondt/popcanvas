import type {
  CanvasNode,
  CanvasEdge,
  SourceNodeData,
  ChatNodeData,
  ArtifactNodeData,
} from '../types';
import { TEMPLATES } from './templates';

/**
 * Walk the graph backwards from a consumer (chat / artifact / etc) and
 * collect everything reachable upstream. Sources, prior chats, and prior
 * artifacts are kept separate so buildSystemPrompt can format them
 * differently.
 *
 * Walk semantics:
 *  - BFS following edges where target === current node
 *  - Cycle-safe via a visited set
 *  - Order preserved by hop distance (closer first)
 *
 * Why transitive: when an artifact is downstream of a chat that's downstream
 * of a source, the artifact should still see the source. The same applies
 * for chained artifacts (artifact A's output feeds into artifact B).
 */
export interface ContextWalk {
  sources: SourceNodeData[];
  chats: ChatNodeData[];
  artifacts: ArtifactNodeData[];
}

export function walkContext(
  consumerId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): ContextWalk {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>([consumerId]);
  const queue: string[] = [consumerId];

  const sources: SourceNodeData[] = [];
  const chats: ChatNodeData[] = [];
  const artifacts: ArtifactNodeData[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.target !== current || visited.has(edge.source)) continue;
      visited.add(edge.source);
      queue.push(edge.source);

      const node = nodeById.get(edge.source);
      if (!node) continue;
      const kind = (node.data as { kind?: string })?.kind;
      if (kind === 'chat') {
        chats.push(node.data as ChatNodeData);
      } else if (kind === 'artifact') {
        artifacts.push(node.data as ArtifactNodeData);
      } else if (kind && kind !== 'chat' && kind !== 'artifact') {
        sources.push(node.data as SourceNodeData);
      }
    }
  }

  return { sources, chats, artifacts };
}

/**
 * Direct upstream nodes only — used by node UIs to show a quick "what am I
 * connected to" preview that updates as edges are wired.
 */
export function findDirectUpstream(
  consumerId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): CanvasNode[] {
  const incoming = new Set(edges.filter((e) => e.target === consumerId).map((e) => e.source));
  return nodes.filter((n) => incoming.has(n.id));
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function formatSource(source: SourceNodeData, index: number): string {
  if (source.status !== 'ready' || !source.content) {
    return `<source index="${index}" type="${source.kind}" status="${source.status}">
  [Source not ready: ${source.error ?? 'still extracting'}]
</source>`;
  }
  const titleAttr = source.title ? ` title="${escapeXmlAttr(source.title)}"` : '';
  const urlValue = 'url' in source && source.url ? String(source.url) : '';
  const urlAttr = urlValue ? ` url="${escapeXmlAttr(urlValue)}"` : '';
  return `<source index="${index}" type="${source.kind}"${titleAttr}${urlAttr}>
${source.content.trim()}
</source>`;
}

function formatChat(chat: ChatNodeData, index: number): string {
  const messages = chat.messages ?? [];
  if (messages.length === 0) {
    return `<chat index="${index}" status="empty"></chat>`;
  }
  const turns = messages
    .map((m) => `  <${m.role}>${escapeXmlBody(m.content)}</${m.role}>`)
    .join('\n');
  return `<chat index="${index}" turns="${messages.length}">
${turns}
</chat>`;
}

function formatArtifact(art: ArtifactNodeData, index: number): string {
  const tpl = TEMPLATES.find((t) => t.id === art.template);
  const label = tpl?.label ?? art.template ?? 'artifact';
  const titleAttr = art.title ? ` title="${escapeXmlAttr(art.title)}"` : '';
  if (!art.output || art.output.trim().length === 0) {
    return `<prior_artifact index="${index}" template="${escapeXmlAttr(label)}" status="${art.status}"${titleAttr}>
  [Artifact not ready: ${art.error ?? 'still generating'}]
</prior_artifact>`;
  }
  return `<prior_artifact index="${index}" template="${escapeXmlAttr(label)}"${titleAttr}>
${art.output.trim()}
</prior_artifact>`;
}

function escapeXmlBody(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the system prompt for any consumer node, given a fully walked
 * context. Sources, prior conversations, and prior artifacts get separate
 * top-level XML sections so Claude can tell the difference between "raw
 * material" and "things I or another instance previously produced."
 */
export function buildSystemPrompt(context: ContextWalk): string {
  const header = `You are an assistant working inside a spatial canvas. The user wires nodes together — sources (videos, PDFs, URLs, images, text) feed into chats and artifacts, and artifacts can chain into further artifacts. The XML below is the full upstream context for the node you're working in.

Use <sources> as ground-truth research material.
Use <prior_conversations> as context for what was already discussed.
Use <prior_artifacts> as work already produced — extend, refine, or build on those rather than restarting from scratch.

When you reference an item, do so naturally ("the YouTube video", "the ICP doc", "the script you wrote earlier") instead of by index number. If asked for something the upstream context doesn't cover, answer using your own knowledge but flag that you're going beyond it.`;

  const sections: string[] = [];

  if (context.sources.length > 0) {
    const blocks = context.sources.map((s, i) => formatSource(s, i + 1)).join('\n\n');
    sections.push(`<sources>\n${blocks}\n</sources>`);
  }
  if (context.chats.length > 0) {
    const blocks = context.chats.map((c, i) => formatChat(c, i + 1)).join('\n\n');
    sections.push(`<prior_conversations>\n${blocks}\n</prior_conversations>`);
  }
  if (context.artifacts.length > 0) {
    const blocks = context.artifacts.map((a, i) => formatArtifact(a, i + 1)).join('\n\n');
    sections.push(`<prior_artifacts>\n${blocks}\n</prior_artifacts>`);
  }

  if (sections.length === 0) {
    return `${header}\n\n[No upstream context connected yet.]`;
  }
  return `${header}\n\n${sections.join('\n\n')}`;
}

/**
 * Convert chat history + a new user turn into the format Claude's API expects.
 * The history must already be in alternating user/assistant order; we just
 * append the new user message at the end.
 */
export function buildMessages(
  history: { role: 'user' | 'assistant'; content: string }[],
  newUserMessage: string,
): { role: 'user' | 'assistant'; content: string }[] {
  return [...history, { role: 'user' as const, content: newUserMessage }];
}
