import type { Node } from '@xyflow/react';

/**
 * Strip large base64 / data-URL fields from a canvas snapshot before
 * shipping it to a server endpoint that doesn't need the image bytes
 * inline. Vercel's request body cap is 4.5MB; one ImageGen output is
 * ~1–2MB base64, so a few of those plus chat history is enough to hit
 * the FUNCTION_PAYLOAD_TOO_LARGE wall.
 *
 * The fields removed:
 *   - dataUrl          (Image source node — original upload as base64)
 *   - outputDataUrl    (ImageGen node — generated image)
 *   - outputUrl        (VideoGen node — signed playback URL, server doesn't need it inline)
 *   - thumbnail        (YouTube node — small but no harm dropping)
 *   - thumbnailUrl     (Image node — blob: URL, server-useless anyway)
 *
 * Endpoints that genuinely need the image bytes pass them as separate
 * top-level fields in the request body (startingImageDataUrl for
 * VideoGen, references[] for ImageGen) so the bytes only travel once,
 * at the client's discretion, instead of getting splatted into every
 * upstream node.
 */
const HEAVY_FIELDS = [
  'dataUrl',
  'outputDataUrl',
  'outputUrl',
  'thumbnail',
  'thumbnailUrl',
] as const;

export function slimNodesForApi(nodes: Node[]): Node[] {
  return nodes.map((n) => {
    const data = n.data ? { ...n.data } : {};
    for (const f of HEAVY_FIELDS) {
      if (f in data) {
        delete (data as Record<string, unknown>)[f];
      }
    }
    return { ...n, data };
  });
}
