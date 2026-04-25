import type { CanvasNode, CanvasEdge, SourceNodeData } from '../types';

/**
 * Find every node that feeds into the given chat node.
 *
 * For now this is "direct neighbors with an edge pointing into the chat node."
 * Later you could make this transitive (sources connected to other sources
 * connected to the chat) but that gets confusing fast for users.
 */
export function findConnectedSources(
  chatNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): SourceNodeData[] {
  const incomingNodeIds = new Set(
    edges.filter((e) => e.target === chatNodeId).map((e) => e.source),
  );

  return nodes
    .filter((n) => incomingNodeIds.has(n.id) && n.data.kind !== 'chat')
    .map((n) => n.data as SourceNodeData);
}

/**
 * Format a single source as an XML-tagged block. Claude responds well
 * to XML structure for multi-document context, see Anthropic's prompting
 * docs on long-context techniques.
 */
function formatSource(source: SourceNodeData, index: number): string {
  if (source.status !== 'ready' || !source.content) {
    return `<source index="${index}" type="${source.kind}" status="${source.status}">
  [Source not ready: ${source.error ?? 'still extracting'}]
</source>`;
  }

  const titleAttr = source.title ? ` title="${escapeXmlAttr(source.title)}"` : '';
  const urlAttr = 'url' in source && source.url ? ` url="${escapeXmlAttr(source.url)}"` : '';

  return `<source index="${index}" type="${source.kind}"${titleAttr}${urlAttr}>
${source.content.trim()}
</source>`;
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Build the system prompt. The connected sources go here so they're
 * always present as background context regardless of what the user asks.
 */
export function buildSystemPrompt(sources: SourceNodeData[]): string {
  const header = `You are an assistant working inside a spatial canvas application. The user has placed several source documents on the canvas and connected them to this chat. Use the sources below as ground truth context for the conversation. When you reference a source, mention it naturally (e.g. "the YouTube video" or "the ICP doc") rather than by index number.

If the user asks for something that the sources don't cover, answer using your own knowledge but flag clearly that you're going beyond what's in the connected sources.`;

  if (sources.length === 0) {
    return `${header}\n\n<sources>\n  [No sources connected to this chat yet.]\n</sources>`;
  }

  const blocks = sources.map((s, i) => formatSource(s, i + 1)).join('\n\n');

  return `${header}\n\n<sources>\n${blocks}\n</sources>`;
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
