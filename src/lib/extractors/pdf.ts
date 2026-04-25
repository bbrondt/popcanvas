import pdfParse from 'pdf-parse';
import type { ExtractionResult } from './index';

export async function extractPdf({
  buffer,
  filename,
}: {
  buffer: Buffer;
  filename: string;
}): Promise<ExtractionResult> {
  const result = await pdfParse(buffer);

  return {
    title: filename,
    content: result.text.replace(/\s+/g, ' ').trim(),
    meta: {
      pageCount: result.numpages,
      info: result.info,
    },
  };
}
