import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { extractTextFromPdfBytes } from './pdfText';

export type ExtractedContent = {
  text: string;
  method: 'pdf-text' | 'ocr' | 'empty';
  warning?: string;
};

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const outLength = ((cleaned.length * 3) / 4) | 0;
  const bytes = new Uint8Array(outLength - padding);

  let byteIndex = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const enc1 = BASE64_ALPHABET.indexOf(cleaned[i]);
    const enc2 = BASE64_ALPHABET.indexOf(cleaned[i + 1]);
    const enc3 = BASE64_ALPHABET.indexOf(cleaned[i + 2]);
    const enc4 = BASE64_ALPHABET.indexOf(cleaned[i + 3]);

    const bitmap =
      ((enc1 & 63) << 18) | ((enc2 & 63) << 12) | ((enc3 & 63) << 6) | (enc4 & 63);

    if (byteIndex < bytes.length) bytes[byteIndex++] = (bitmap >> 16) & 255;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (bitmap >> 8) & 255;
    if (byteIndex < bytes.length) bytes[byteIndex++] = bitmap & 255;
  }

  return bytes;
}

async function readFileBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

async function extractPdfText(uri: string): Promise<string> {
  const base64 = await readFileBase64(uri);
  const data = decodeBase64ToBytes(base64);
  return extractTextFromPdfBytes(data);
}

/**
 * OCR a note photo with Tesseract.js (JS-only; first run may download language data).
 */
async function extractImageText(uri: string): Promise<string> {
  const Tesseract = await import('tesseract.js');
  const base64 = await readFileBase64(uri);
  const mime = uri.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${base64}`;

  const worker = await Tesseract.createWorker('eng', 1, {
    logger: () => undefined,
  });
  try {
    const result = await worker.recognize(dataUrl);
    return (result.data.text || '').trim();
  } finally {
    await worker.terminate();
  }
}

export async function extractTextFromSource(input: {
  sourceType: 'pdf' | 'photo';
  uri: string;
}): Promise<ExtractedContent> {
  try {
    if (input.sourceType === 'pdf') {
      const text = await extractPdfText(input.uri);
      if (text.length >= 40) {
        return { text, method: 'pdf-text' };
      }
      return {
        text,
        method: 'empty',
        warning:
          text.length > 0
            ? 'Only a little text was found in this PDF. It may be scanned — try photographing a page instead.'
            : 'No readable text was found in this PDF. If it is scanned, take a photo of the page and generate from that.',
      };
    }

    const text = await extractImageText(input.uri);
    if (text.length >= 20) {
      return { text, method: 'ocr' };
    }
    return {
      text,
      method: 'empty',
      warning:
        'Could not read enough text from this photo. Use a clearer, well-lit picture of your notes.',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown extraction error';
    return {
      text: '',
      method: 'empty',
      warning: `Could not analyze the ${input.sourceType}: ${detail}`,
    };
  }
}

export function summarizeExtractionPlatformNote(): string | undefined {
  if (Platform.OS === 'web') {
    return 'On web, large PDFs/photos may be slower to analyze.';
  }
  return undefined;
}
