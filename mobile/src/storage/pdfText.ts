/**
 * Lightweight PDF text extractor for React Native / Expo.
 * Reads digital PDFs (text layer). Scanned PDFs return little/no text.
 */

import { inflateSync } from 'fflate';

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    out += String.fromCharCode.apply(null, Array.from(slice) as number[]);
  }
  return out;
}

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === 'n') {
      out += '\n';
      i += 1;
    } else if (next === 'r') {
      out += '\r';
      i += 1;
    } else if (next === 't') {
      out += '\t';
      i += 1;
    } else if (next === 'b' || next === 'f') {
      i += 1;
    } else if (next === '(' || next === ')' || next === '\\') {
      out += next;
      i += 1;
    } else if (/[0-7]/.test(next)) {
      let oct = next;
      i += 1;
      if (/[0-7]/.test(raw[i + 1] ?? '')) {
        i += 1;
        oct += raw[i];
        if (/[0-7]/.test(raw[i + 1] ?? '')) {
          i += 1;
          oct += raw[i];
        }
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
      i += 1;
    }
  }
  return out;
}

function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

function extractTextOperators(content: string): string {
  const pieces: string[] = [];

  const tjArrayRe = /\[([\s\S]*?)\]\s*TJ/g;
  let match: RegExpExecArray | null;
  while ((match = tjArrayRe.exec(content)) !== null) {
    const inner = match[1];
    const innerLiterals = /\((?:\\.|[^\\)])*\)/g;
    let innerMatch: RegExpExecArray | null;
    while ((innerMatch = innerLiterals.exec(inner)) !== null) {
      const body = innerMatch[0].slice(1, -1);
      const text = decodePdfLiteralString(body);
      if (text.trim()) pieces.push(text);
    }
    const innerHex = /<([0-9A-Fa-f\s]+)>/g;
    while ((innerMatch = innerHex.exec(inner)) !== null) {
      const text = decodePdfHexString(innerMatch[1]);
      if (text.trim()) pieces.push(text);
    }
  }

  const literalRe = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")/g;
  while ((match = literalRe.exec(content)) !== null) {
    const close = match[0].lastIndexOf(')');
    const body = match[0].slice(1, close);
    const text = decodePdfLiteralString(body).trim();
    if (text) pieces.push(text);
  }

  const hexRe = /<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")/g;
  while ((match = hexRe.exec(content)) !== null) {
    const text = decodePdfHexString(match[1]).trim();
    if (text) pieces.push(text);
  }

  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

function tryInflate(data: Uint8Array): Uint8Array | null {
  try {
    return inflateSync(data);
  } catch {
    // Some streams include an extra zlib header byte pair already handled by inflateSync;
    // try skipping common PDF predictor wrappers is out of scope.
    return null;
  }
}

function findStreamPayloads(pdfBytes: Uint8Array): Uint8Array[] {
  const payloads: Uint8Array[] = [];
  const marker = [115, 116, 114, 101, 97, 109]; // "stream"
  const endMarker = [101, 110, 100, 115, 116, 114, 101, 97, 109]; // "endstream"

  for (let i = 0; i < pdfBytes.length - 6; i += 1) {
    let isStream = true;
    for (let j = 0; j < marker.length; j += 1) {
      if (pdfBytes[i + j] !== marker[j]) {
        isStream = false;
        break;
      }
    }
    if (!isStream) continue;

    // stream must be a keyword boundary
    const before = i === 0 ? 32 : pdfBytes[i - 1];
    if (before > 32 && before !== 13 && before !== 10) continue;

    let dataStart = i + marker.length;
    if (pdfBytes[dataStart] === 13) dataStart += 1;
    if (pdfBytes[dataStart] === 10) dataStart += 1;

    let end = -1;
    for (let k = dataStart; k < pdfBytes.length - endMarker.length; k += 1) {
      let isEnd = true;
      for (let j = 0; j < endMarker.length; j += 1) {
        if (pdfBytes[k + j] !== endMarker[j]) {
          isEnd = false;
          break;
        }
      }
      if (isEnd) {
        end = k;
        break;
      }
    }
    if (end < 0) continue;

    let dataEnd = end;
    if (pdfBytes[dataEnd - 1] === 10) dataEnd -= 1;
    if (pdfBytes[dataEnd - 1] === 13) dataEnd -= 1;

    const dictStart = Math.max(0, i - 500);
    const dictWindow = bytesToLatin1(pdfBytes.subarray(dictStart, i));
    const isFlate = /\/Filter\s*\/FlateDecode|\/Filter\s*\[\s*\/FlateDecode/.test(dictWindow);
    const raw = pdfBytes.subarray(dataStart, dataEnd);
    if (isFlate) {
      const inflated = tryInflate(raw);
      if (inflated) payloads.push(inflated);
    } else {
      payloads.push(raw);
    }

    i = end + endMarker.length;
  }

  return payloads;
}

/**
 * Extract readable text from a PDF byte array.
 */
export function extractTextFromPdfBytes(pdfBytes: Uint8Array): string {
  const chunks: string[] = [];
  for (const payload of findStreamPayloads(pdfBytes)) {
    const content = bytesToLatin1(payload);
    if (!/Tj|TJ|'|"/.test(content)) continue;
    const text = extractTextOperators(content);
    if (text.length >= 2) chunks.push(text);
  }

  const combined = chunks
    .join('\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return combined
    .split('')
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 10 || code === 13 || (code >= 32 && code < 127) || code > 159;
    })
    .join('')
    .trim();
}

/**
 * Best-effort page count from PDF object markers (no heavyweight PDF lib).
 */
export function estimatePdfPageCount(pdfBytes: Uint8Array): number | undefined {
  if (!pdfBytes.length) return undefined;
  const latin1 = bytesToLatin1(pdfBytes);
  // "/Type /Page" is also a prefix of "/Type /Pages", so subtract tree nodes.
  const pages =
    (latin1.match(/\/Type\s*\/Page/g) || []).length -
    (latin1.match(/\/Type\s*\/Pages/g) || []).length;
  if (pages <= 0) return undefined;
  return pages;
}
