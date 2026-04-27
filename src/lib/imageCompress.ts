/**
 * Resize a base64 image data URL to a max edge and re-encode as JPEG.
 *
 * Why: high-res image-gen outputs (e.g. Flux 1.1 Pro Ultra at 2160px+)
 * blow Vercel's 4.5MB request body cap when:
 *   - shipped as a starting frame to /api/generate/video
 *   - persisted into a canvas autosave that already has other node data
 *
 * Veo internally downsamples whatever starting frame it gets, so 1280px
 * @ JPEG 85% is plenty of fidelity for downstream use. No-op when the
 * source is already small enough.
 *
 * Browser-only (uses HTMLImageElement and HTMLCanvasElement).
 */
export async function compressImageDataUrl(
  dataUrl: string,
  opts: { maxEdge?: number; quality?: number; thresholdBytes?: number } = {},
): Promise<string> {
  const maxEdge = opts.maxEdge ?? 1280;
  const quality = opts.quality ?? 0.85;
  // Default 800KB threshold — small enough to leave room for several
  // image nodes plus chat history in a single canvas autosave body.
  const thresholdBytes = opts.thresholdBytes ?? 800_000;

  if (dataUrl.length < thresholdBytes) return dataUrl;

  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not load image for compression.'));
  });

  const longEdge = Math.max(img.width, img.height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable for image compression.');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
