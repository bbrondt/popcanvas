import type { NodeKind, CanvasNodeData } from './types';

export const SOURCE_KINDS: { kind: NodeKind; label: string; symbol: string }[] = [
  { kind: 'youtube', label: 'YouTube', symbol: '▶' },
  { kind: 'pdf', label: 'PDF', symbol: '⌹' },
  { kind: 'url', label: 'URL', symbol: '↗' },
  { kind: 'image', label: 'Image', symbol: '▢' },
  { kind: 'text', label: 'Text', symbol: '¶' },
];

export const CONSUMER_KINDS: { kind: NodeKind; label: string; symbol: string }[] = [
  { kind: 'chat', label: 'Chat', symbol: '⌘' },
  { kind: 'artifact', label: 'Artifact', symbol: '✦' },
  { kind: 'image-gen', label: 'Image Gen', symbol: '◇' },
  { kind: 'video-gen', label: 'Video Gen', symbol: '▷' },
];

export const ALL_KINDS = [...SOURCE_KINDS, ...CONSUMER_KINDS];

/**
 * Default node data for a freshly added node of a given kind. Shared so the
 * left toolbar AND the per-handle add-button can both call it.
 */
export function defaultData(kind: NodeKind): CanvasNodeData {
  switch (kind) {
    case 'youtube':
      return { kind, status: 'idle', url: '' };
    case 'pdf':
      return { kind, status: 'idle' };
    case 'url':
      return { kind, status: 'idle', url: '' };
    case 'image':
      return { kind, status: 'idle' };
    case 'text':
      return { kind, status: 'idle', content: '', title: 'Pasted text' };
    case 'chat':
      return { kind, status: 'idle', messages: [] };
    case 'artifact':
      return { kind, status: 'idle', template: 'youtube-script' };
    case 'image-gen':
      return { kind, status: 'idle', prompt: '', aspectRatio: '1:1' };
    case 'video-gen':
      return {
        kind,
        status: 'idle',
        prompt: '',
        aspectRatio: '16:9',
        durationSec: 8,
      };
  }
}
