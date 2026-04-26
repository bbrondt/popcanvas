/**
 * Thin wrapper around fal.ai's Flux 1.1 Pro Ultra. The photoreal
 * portrait gold standard — outputs read as iPhone photos rather than
 * AI-generated. Worth the extra cost when feeding starting frames
 * into Veo for avatar work.
 *
 * Two endpoints:
 *   /v1.1-ultra        — text-to-image
 *   /v1.1-ultra/redux  — image-to-image / reference-driven
 *                        (single reference; fal.ai's Flux variant
 *                        doesn't accept multiple refs unlike Imagen
 *                        or gpt-image-2)
 */

const FAL_BASE_TXT2IMG = 'https://fal.run/fal-ai/flux-pro/v1.1-ultra';
const FAL_BASE_REDUX = 'https://fal.run/fal-ai/flux-pro/v1.1-ultra/redux';

interface ImageReference {
  mimeType: string;
  /** Base64 image bytes (no data: prefix). */
  data: string;
}

interface FluxImageResult {
  dataUrl: string;
  mimeType: string;
}

interface FluxResponse {
  images?: { url?: string; content_type?: string }[];
}

interface FluxError {
  error?: string;
  detail?: string | { msg?: string }[];
}

/** Map our 5 canvas aspect ratios into Flux's nine. Flux supports all
 *  of ours natively so this is a straight pass-through. */
function mapAspectRatio(
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | undefined,
): string {
  return aspectRatio ?? '1:1';
}

async function readError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const parsed = JSON.parse(raw) as FluxError;
    if (typeof parsed.error === 'string') return parsed.error;
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      const first = parsed.detail[0];
      if (typeof first === 'object' && first?.msg) return first.msg;
    }
    return raw;
  } catch {
    return raw || `fal.ai returned ${res.status}`;
  }
}

export async function generateWithFlux(opts: {
  apiKey: string;
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  /** When provided, switches to the redux (image-to-image) endpoint
   *  using the FIRST reference as the seed. Flux's Pro Ultra Redux
   *  variant only accepts one reference image. */
  references?: ImageReference[];
}): Promise<FluxImageResult> {
  const aspect = mapAspectRatio(opts.aspectRatio);

  let endpoint: string;
  let body: Record<string, unknown>;
  if (opts.references && opts.references.length > 0) {
    const ref = opts.references[0];
    endpoint = FAL_BASE_REDUX;
    body = {
      prompt: opts.prompt,
      image_url: `data:${ref.mimeType};base64,${ref.data}`,
      aspect_ratio: aspect,
      num_images: 1,
      output_format: 'png',
      // Default 0.1 leans heavily on the prompt; bump to 0.5 so the
      // reference actually steers the output (subject identity / pose).
      image_prompt_strength: 0.5,
    };
  } else {
    endpoint = FAL_BASE_TXT2IMG;
    body = {
      prompt: opts.prompt,
      aspect_ratio: aspect,
      num_images: 1,
      output_format: 'png',
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Key ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const json = (await res.json()) as FluxResponse;
  const imageUrl = json.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error('fal.ai returned no image URL.');
  }

  // Fetch the bytes and base64-encode so the rest of the pipeline can
  // treat this exactly like any other generated image (data URL form).
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`Could not download Flux result (${imgRes.status}).`);
  }
  const imgBuf = await imgRes.arrayBuffer();
  const mimeType = json.images?.[0]?.content_type ?? 'image/png';
  const base64 = Buffer.from(imgBuf).toString('base64');
  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
  };
}
