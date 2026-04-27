import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import type { ExtractionResult } from './index';

/**
 * Generic file extractor — routes to the right parser by extension or
 * mime type, returning a uniform { title, content, meta } shape so
 * downstream chat / artifact nodes don't care what the source was.
 *
 * Supported types:
 *   .pdf                    → pdf-parse
 *   .md, .markdown          → utf-8 decode (markdown is just text)
 *   .txt, .csv, .log, .tsv  → utf-8 decode
 *   .docx                   → mammoth (Word's modern XML format)
 *
 * Unsupported (.doc binary Word, .pages, .key, .odt, etc.) returns
 * an explicit error so the user knows what to convert.
 */
export async function extractFile({
  buffer,
  filename,
  mimeType,
}: {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
}): Promise<ExtractionResult> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  // PDF
  if (ext === 'pdf' || mimeType === 'application/pdf') {
    const result = await pdfParse(buffer);
    return {
      title: filename,
      content: result.text.replace(/\s+/g, ' ').trim(),
      meta: {
        fileType: 'pdf',
        pageCount: result.numpages,
        mimeType: mimeType ?? 'application/pdf',
      },
    };
  }

  // Word (.docx) — modern Office Open XML. The legacy binary .doc
  // format isn't supported here; users need to save-as .docx in Word
  // first (or convert via libreoffice).
  if (
    ext === 'docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    const content = result.value.replace(/\s+/g, ' ').trim();
    return {
      title: filename,
      content,
      meta: {
        fileType: 'docx',
        pageCount: wordCount(content),
        mimeType: mimeType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // Mammoth surfaces conversion warnings (lost styles, unsupported
        // elements). Pass them through so the user can see if anything
        // important didn't make it.
        warnings: result.messages.map((m) => m.message),
      },
    };
  }

  // Markdown — strip nothing, the text is the content. Renderers
  // downstream can re-parse it if they want; we just hand it raw.
  if (ext === 'md' || ext === 'markdown' || mimeType === 'text/markdown') {
    const content = buffer.toString('utf-8').trim();
    return {
      title: filename,
      content,
      meta: {
        fileType: 'markdown',
        pageCount: wordCount(content),
        mimeType: mimeType ?? 'text/markdown',
      },
    };
  }

  // CSV / TSV — for now we just decode as plain text. Future: parse
  // and surface column headers / row counts in meta if useful.
  if (ext === 'csv' || ext === 'tsv' || mimeType === 'text/csv') {
    const content = buffer.toString('utf-8').trim();
    return {
      title: filename,
      content,
      meta: {
        fileType: 'csv',
        pageCount: content.split('\n').length,
        mimeType: mimeType ?? 'text/csv',
      },
    };
  }

  // Plain text catchall — also handles .log, .json, code files, etc.
  // We try a UTF-8 decode and only error out if the bytes don't look
  // text-like (high ratio of replacement characters or null bytes).
  if (
    ext === 'txt' ||
    ext === 'log' ||
    ext === 'json' ||
    ext === 'rtf' || // crude — RTF still decodes to readable-ish text
    mimeType?.startsWith('text/')
  ) {
    const content = buffer.toString('utf-8').trim();
    if (looksBinary(content)) {
      throw new Error(
        `File "${filename}" doesn't look like text. Convert it to PDF, DOCX, MD, or TXT first.`,
      );
    }
    return {
      title: filename,
      content,
      meta: {
        fileType: 'text',
        pageCount: wordCount(content),
        mimeType: mimeType ?? 'text/plain',
      },
    };
  }

  // Last resort: attempt UTF-8 decode anyway. Some users upload files
  // with no extension (e.g. README) that are still text. If it
  // decodes cleanly, accept it as text.
  const speculative = buffer.toString('utf-8').trim();
  if (!looksBinary(speculative) && speculative.length > 0) {
    return {
      title: filename,
      content: speculative,
      meta: {
        fileType: 'other',
        pageCount: wordCount(speculative),
        mimeType: mimeType ?? 'application/octet-stream',
      },
    };
  }

  throw new Error(
    `Unsupported file type "${ext || mimeType || 'unknown'}". Supported: PDF, DOCX, MD, TXT, CSV. Convert .doc files to .docx in Word, and .pages / .odt to PDF first.`,
  );
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function looksBinary(s: string): boolean {
  if (!s) return false;
  let bad = 0;
  // Sample the first 4KB — enough to detect binary, fast for large files.
  const sample = s.slice(0, 4096);
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0xfffd || code === 0) bad++;
  }
  return bad / sample.length > 0.05;
}
