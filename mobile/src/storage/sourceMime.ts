/**
 * Upload source kinds + MIME helpers for Gemini multimodal analysis.
 */

export type SourceKind =
  | 'pdf'
  | 'photo'
  | 'docx'
  | 'doc'
  | 'pptx'
  | 'ppt'
  | 'xlsx'
  | 'xls'
  | 'csv'
  | 'txt'
  | 'rtf';

/** MIME types accepted by the document picker (notes → flashcards). */
export const DOCUMENT_PICKER_TYPES: string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/rtf',
  'application/rtf',
];

const EXT_TO_KIND: Record<string, SourceKind> = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'doc',
  pptx: 'pptx',
  ppt: 'ppt',
  xlsx: 'xlsx',
  xls: 'xls',
  csv: 'csv',
  txt: 'txt',
  text: 'txt',
  md: 'txt',
  rtf: 'rtf',
  png: 'photo',
  jpg: 'photo',
  jpeg: 'photo',
  webp: 'photo',
  heic: 'photo',
  gif: 'photo',
};

const KIND_TO_MIME: Record<SourceKind, string> = {
  pdf: 'application/pdf',
  photo: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  txt: 'text/plain',
  rtf: 'text/rtf',
};

const MIME_TO_KIND: Record<string, SourceKind> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/rtf': 'rtf',
  'application/rtf': 'rtf',
  'image/jpeg': 'photo',
  'image/png': 'photo',
  'image/webp': 'photo',
  'image/heic': 'photo',
  'image/gif': 'photo',
};

function extensionOf(nameOrUri?: string): string {
  if (!nameOrUri) return '';
  const clean = nameOrUri.split('?')[0].split('#')[0];
  const base = clean.split(/[/\\]/).pop() ?? clean;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function detectSourceKind(input: {
  filename?: string;
  uri?: string;
  mimeType?: string | null;
  fallback?: SourceKind;
}): SourceKind {
  const mime = (input.mimeType || '').toLowerCase().trim();
  if (mime && MIME_TO_KIND[mime]) return MIME_TO_KIND[mime];

  const ext =
    extensionOf(input.filename) || extensionOf(input.uri) || '';
  if (ext && EXT_TO_KIND[ext]) return EXT_TO_KIND[ext];

  return input.fallback ?? 'pdf';
}

export function mimeForSource(
  kind: SourceKind,
  filename?: string,
  uri?: string,
): string {
  if (kind === 'photo') {
    const name = `${filename ?? ''} ${uri ?? ''}`.toLowerCase();
    if (name.includes('.png')) return 'image/png';
    if (name.includes('.webp')) return 'image/webp';
    if (name.includes('.gif')) return 'image/gif';
    return 'image/jpeg';
  }
  return KIND_TO_MIME[kind] || 'application/octet-stream';
}

export function labelForSource(kind: SourceKind): string {
  switch (kind) {
    case 'pdf':
      return 'PDF document';
    case 'photo':
      return 'photo of student notes';
    case 'docx':
    case 'doc':
      return 'Word document';
    case 'pptx':
    case 'ppt':
      return 'PowerPoint presentation';
    case 'xlsx':
    case 'xls':
      return 'Excel spreadsheet';
    case 'csv':
      return 'CSV spreadsheet';
    case 'txt':
      return 'text file';
    case 'rtf':
      return 'rich text document';
    default:
      return 'study document';
  }
}

export function shortLabelForSource(kind: SourceKind): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'photo':
      return 'Photo';
    case 'docx':
    case 'doc':
      return 'Word';
    case 'pptx':
    case 'ppt':
      return 'PowerPoint';
    case 'xlsx':
    case 'xls':
    case 'csv':
      return 'Excel';
    case 'txt':
    case 'rtf':
      return 'Text';
    default:
      return 'File';
  }
}
