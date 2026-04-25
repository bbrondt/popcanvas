import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult } from './index';

const client = new Anthropic({ apiKey: import.meta.env.ANTHROPIC_API_KEY });

/**
 * Send the image to Claude and ask it to:
 *   1. Transcribe any text exactly (OCR)
 *   2. Describe what's in the image in case there's no text
 *
 * The combined output becomes the node's content, which downstream chat
 * nodes will use as context.
 */
export async function extractImage({
  buffer,
  filename,
}: {
  buffer: Buffer;
  filename: string;
}): Promise<ExtractionResult> {
  const base64 = buffer.toString('base64');
  const mediaType = guessMediaType(filename);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `Analyze this image. Output your response in this exact format:

TEXT:
[Transcribe any text in the image verbatim. If there's no text, write "(none)".]

DESCRIPTION:
[A short paragraph describing what's visible: the subject, context, layout, notable visual elements. Be concrete and specific.]`,
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n');

  return {
    title: filename,
    content: text,
    meta: { mediaType, model: 'claude-sonnet-4-6' },
  };
}

function guessMediaType(filename: string): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}
