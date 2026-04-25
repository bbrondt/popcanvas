import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY,
});

export interface StreamChatArgs {
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  onText: (chunk: string) => void;
  /** Override default max_tokens. Long-form artifacts need more headroom. */
  maxTokens?: number;
  /** Override the default model. */
  model?: string;
}

/**
 * Stream a Claude completion. Caller passes a callback that receives
 * text chunks as they arrive. Returns the full assembled text when done.
 *
 * Uses Sonnet 4.6 by default for cost. Swap to claude-opus-4-7 for
 * higher quality on complex multi-source synthesis.
 *
 * Pattern follows the official SDK streaming example:
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/streaming.ts
 */
export async function streamChat({
  systemPrompt,
  messages,
  onText,
  maxTokens = 4096,
  model = 'claude-sonnet-4-6',
}: StreamChatArgs): Promise<string> {
  const stream = client.messages
    .stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    })
    .on('text', (text) => {
      onText(text);
    });

  const finalMessage = await stream.finalMessage();

  // The final message has an array of content blocks; concat the text ones.
  const fullText = finalMessage.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('');

  return fullText;
}
