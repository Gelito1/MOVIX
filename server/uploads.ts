import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';

export const UPLOADS_ROOT = path.resolve(process.cwd(), 'data', 'uploads');

export type UploadFolder =
  | 'posters'
  | 'backdrops'
  | 'ads-images'
  | 'ads-videos'
  | 'branding'
  | 'notifications'
  | 'categories';

const ALLOWED_FOLDERS = new Set<UploadFolder>([
  'posters',
  'backdrops',
  'ads-images',
  'ads-videos',
  'branding',
  'notifications',
  'categories',
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

export interface DetectedFileType {
  kind: 'image' | 'video';
  ext: 'jpg' | 'png' | 'webp' | 'gif' | 'mp4' | 'webm';
  mime: string;
}

/**
 * Inspects true binary magic bytes to prevent spoofed file extensions or malicious uploads.
 */
export function detectMagicFileType(buf: Buffer): DetectedFileType | null {
  if (!buf || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { kind: 'image', ext: 'png', mime: 'image/png' };
  }
  // GIF: GIF87a or GIF89a
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return { kind: 'image', ext: 'gif', mime: 'image/gif' };
  }
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { kind: 'image', ext: 'webp', mime: 'image/webp' };
  }
  // MP4: ISO Base Media file format (bytes 4..7 === 'ftyp')
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return { kind: 'video', ext: 'mp4', mime: 'video/mp4' };
  }
  // WEBM / Matroska EBML header: 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { kind: 'video', ext: 'webm', mime: 'video/webm' };
  }

  return null;
}

export function sanitizeFolder(raw: string): UploadFolder {
  const clean = (raw || '').trim().toLowerCase() as UploadFolder;
  return ALLOWED_FOLDERS.has(clean) ? clean : 'ads-images';
}

export function saveUploadedBuffer(params: {
  buffer: Buffer;
  folder: UploadFolder;
  allowedKinds?: Array<'image' | 'video'>;
}): { ok: boolean; url?: string; filename?: string; folder?: UploadFolder; kind?: 'image' | 'video'; mime?: string; sizeBytes?: number; error?: string } {
  const { buffer, folder, allowedKinds = ['image', 'video'] } = params;
  const detected = detectMagicFileType(buffer);
  if (!detected) {
    return {
      ok: false,
      error: 'Formato não suportado ou ficheiro inválido. Formatos aceites: JPG, PNG, WEBP, GIF, MP4 e WEBM.',
    };
  }
  if (!allowedKinds.includes(detected.kind)) {
    return {
      ok: false,
      error: detected.kind === 'video' ? 'Este campo aceita apenas imagens.' : 'Este campo aceita apenas vídeos MP4 ou WEBM.',
    };
  }
  const maxBytes = detected.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (buffer.length > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, error: `O ficheiro excede o limite máximo permitido de ${mb} MB.` };
  }

  const targetDir = path.resolve(UPLOADS_ROOT, folder);
  if (!targetDir.startsWith(UPLOADS_ROOT + path.sep)) {
    return { ok: false, error: 'Pasta de destino inválida.' };
  }
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filename = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${detected.ext}`;
  const fullPath = path.resolve(targetDir, filename);
  if (!fullPath.startsWith(targetDir + path.sep)) {
    return { ok: false, error: 'Nome de ficheiro inválido.' };
  }

  fs.writeFileSync(fullPath, buffer);
  return {
    ok: true,
    url: `/api/media/${folder}/${filename}`,
    filename,
    folder,
    kind: detected.kind,
    mime: detected.mime,
    sizeBytes: buffer.length,
  };
}

export function restoreUploadedBuffer(params: {
  buffer: Buffer;
  folder: string;
  filename: string;
}): { ok: boolean; restored: boolean; url?: string; error?: string } {
  const folderClean = (params.folder || '').trim().toLowerCase() as UploadFolder;
  const filename = (params.filename || '').trim();
  if (!ALLOWED_FOLDERS.has(folderClean)) {
    return { ok: false, restored: false, error: 'Pasta inválida.' };
  }
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(filename)) {
    return { ok: false, restored: false, error: 'Nome de ficheiro inválido.' };
  }
  const detected = detectMagicFileType(params.buffer);
  if (!detected) {
    return { ok: false, restored: false, error: 'Assinatura binária inválida.' };
  }
  const maxBytes = detected.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (params.buffer.length > maxBytes) {
    return { ok: false, restored: false, error: 'Ficheiro excede o tamanho máximo.' };
  }

  const targetDir = path.resolve(UPLOADS_ROOT, folderClean);
  if (!targetDir.startsWith(UPLOADS_ROOT + path.sep)) {
    return { ok: false, restored: false, error: 'Pasta de destino inválida.' };
  }
  const fullPath = path.resolve(targetDir, filename);
  if (!fullPath.startsWith(targetDir + path.sep)) {
    return { ok: false, restored: false, error: 'Caminho de ficheiro inválido.' };
  }
  if (fs.existsSync(fullPath)) {
    return { ok: true, restored: false, url: `/api/media/${folderClean}/${filename}` };
  }
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  fs.writeFileSync(fullPath, params.buffer);
  return { ok: true, restored: true, url: `/api/media/${folderClean}/${filename}` };
}

export interface StoredMediaFile {
  folder: UploadFolder;
  filename: string;
  url: string;
  sizeBytes: number;
  kind: 'image' | 'video';
  createdAt: string;
}

export function listAllMediaFiles(): StoredMediaFile[] {
  const results: StoredMediaFile[] = [];
  if (!fs.existsSync(UPLOADS_ROOT)) return results;

  for (const folder of ALLOWED_FOLDERS) {
    const dir = path.join(UPLOADS_ROOT, folder);
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir);
    for (const filename of entries) {
      if (!/^[a-zA-Z0-9._-]+$/.test(filename)) continue;
      const fullPath = path.resolve(dir, filename);
      if (!fullPath.startsWith(dir + path.sep)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        const ext = path.extname(filename).toLowerCase();
        const kind: 'image' | 'video' = ext === '.mp4' || ext === '.webm' ? 'video' : 'image';
        results.push({
          folder,
          filename,
          url: `/api/media/${folder}/${filename}`,
          sizeBytes: stat.size,
          kind,
          createdAt: stat.mtime.toISOString(),
        });
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteMediaFile(folderRaw: string, filename: string): boolean {
  const folder = sanitizeFolder(folderRaw);
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return false;
  const dir = path.resolve(UPLOADS_ROOT, folder);
  const fullPath = path.resolve(dir, filename);
  if (!fullPath.startsWith(dir + path.sep)) return false;
  if (!fs.existsSync(fullPath)) return false;
  try {
    fs.unlinkSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export function serveMediaFile(req: Request, res: Response): void {
  const folderRaw = String(req.params.folder || '');
  const filename = String(req.params.filename || '');

  if (!ALLOWED_FOLDERS.has(folderRaw as UploadFolder) || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
    res.status(400).json({ error: 'Caminho de ficheiro inválido.' });
    return;
  }

  const dir = path.resolve(UPLOADS_ROOT, folderRaw);
  const fullPath = path.resolve(dir, filename);
  if (!fullPath.startsWith(dir + path.sep) || !fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Ficheiro não encontrado.' });
    return;
  }

  const stat = fs.statSync(fullPath);
  const ext = path.extname(filename).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  const fileSize = stat.size;

  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      res.status(416).end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(fullPath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(fileSize));
  fs.createReadStream(fullPath).pipe(res);
}
