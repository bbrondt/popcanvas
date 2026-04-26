/**
 * Thin wrapper around OpenAI's images endpoint for gpt-image-2. Uses
 * fetch directly so we don't pull in the openai SDK just for one call.
 *
 * Two modes:
 *   - generate: text-to-image via /v1/images/generations (JSON).
 *   - edit:     reference-aware via /v1/images/edits     (multipart).
 *
 * Both return a base64 PNG data URL ready to drop onto the canvas.
 */

const OPENAI_IMAGE_MODEL = 'gpt-image-2';
const OPENAI_BASE = 'https://api.openai.com/v1';

/** OpenAI's API accepts a closed set of size strings. We map our 5
 *  canvas aspect ratios into the closest supported size at 1K — bigger
 *  sizes start to charge meaningfully more without much benefit on a
 *  node thumbnail. */
function mapSize(aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | undefined): string {
  switch (aspectRatio) {
    case '16:9':
      return '1536x1024';
    case '9:16':
      return '1024x1536';
    case '4:3':
    case '3:4':
    case '1:1':
    default:
      return '1024x1024';
  }
}

interface ImageReference {
  mimeType: string;
  /** Base64 image bytes (no data: prefix). */
  data: string;
}

interface OpenAiImageResult {
  dataUrl: string;
  mimeType: string;
}

interface OpenAiImageError {
  error?: { message?: string; type?: string; code?: string };
}

interface OpenAiImageResponse {
  data?: { b64_json?: string }[];
}

async function readError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const parsed = JSON.parse(raw) as OpenAiImageError;
    return parsed.error?.message ?? raw;
  } catch {
    return raw || `OpenAI returned ${res.status}`;
  }
}

export async function generateWithOpenAi(opts: {
  apiKey: string;
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  /** When provided, switches to /images/edits so gpt-image-2 can use the
   *  references for identity preservation, style match, etc. */
  references?: ImageReference[];
  /** OpenAI quality tier. 'medium' is the cost/quality sweet spot. */
  quality?: 'low' | 'medium' | 'high' | 'auto';
}): Promise<OpenAiImageResult> {
  const size = mapSize(opts.aspectRatio);
  const quality = opts.quality ?? 'medium';

  let res: Response;
  if (opts.references && opts.references.length > 0) {
    // Edits endpoint: multipart, n images appended under image[].
    const form = new FormData();
    form.append('model', OPENAI_IMAGE_MODEL);
    form.append('prompt', opts.prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('n', '1');
    opts.references.forEach((ref, idx) => {
      const bytes = Uint8Array.from(atob(ref.data), (c) => c.charCodeAt(0));
      const ext = ref.mimeType.split('/')[1]?.split(';')[0] || 'png';
      form.append('image[]', new Blob([bytes], { type: ref.mimeType }), `ref-${idx}.${ext}`);
    });

    res = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
  } else {
    res = await fetch(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt: opts.prompt,
        size,
        quality,
        n: 1,
      }),
    });
  }

  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const json = (await res.json()) as OpenAiImageResponse;
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI returned no image bytes.');
  }
  return {
    dataUrl: `data:image/png;base64,${b64}`,
    mimeType: 'image/png',
  };
}
