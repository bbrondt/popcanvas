import { extractYoutube } from './youtube';
import { extractPdf } from './pdf';
import { extractFile } from './file';
import { extractUrl } from './url';
import { extractImage } from './image';
import type { NodeKind } from '../types';

export interface ExtractionInput {
  kind: NodeKind;
  /** Whatever payload the extractor needs. For URL/YouTube it's a url, for files it's a Buffer or storage path. */
  payload: Record<string, unknown>;
}

export interface ExtractionResult {
  title: string;
  content: string;
  meta?: Record<string, unknown>;
}

export async function extract(input: ExtractionInput): Promise<ExtractionResult> {
  switch (input.kind) {
    case 'youtube':
      return extractYoutube(input.payload as { url: string });
    case 'pdf':
      return extractPdf(input.payload as { buffer: Buffer; filename: string });
    case 'file':
      return extractFile(
        input.payload as { buffer: Buffer; filename: string; mimeType?: string },
      );
    case 'url':
      return extractUrl(input.payload as { url: string });
    case 'image':
      return extractImage(input.payload as { buffer: Buffer; filename: string });
    case 'text':
      // Text nodes don't need extraction. They store content directly.
      return {
        title: 'Pasted text',
        content: (input.payload.content as string) ?? '',
      };
    case 'chat':
      throw new Error('Chat nodes are not extractable sources.');
    case 'artifact':
      throw new Error('Artifact nodes are not extractable sources — they consume sources.');
    case 'image-gen':
    case 'video-gen':
      throw new Error('Generator nodes are not extractable — they produce media, not text.');
    default: {
      const _exhaustive: never = input.kind;
      throw new Error(`Unknown node kind: ${_exhaustive as string}`);
    }
  }
}
