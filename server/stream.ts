import type { Request, Response } from 'express';
import { Readable } from 'stream';
import { getServerConfig, validateMegambdUrl } from './config.ts';
import { getMegambdStatus } from './megambd.ts';
import { recordApiError } from './store.ts';

const ALLOWED_EXTENSIONS = new Set(['mp4', 'mkv', 'm3u8', 'ts', 'webm']);

export async function handleMediaStreamProxy(
  req: Request,
  res: Response,
  kind: 'movie' | 'series'
): Promise<void> {
  const rawId = req.params.id || '';
  if (!/^\d+$/.test(rawId)) {
    res.status(400).json({ error: 'Identificador de conteúdo inválido.' });
    return;
  }

  const rawExt = typeof req.query.ext === 'string' ? req.query.ext.toLowerCase().trim() : 'mp4';
  const ext = ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : 'mp4';

  const cfg = getServerConfig();
  if (!cfg.megambdUsername || !cfg.megambdPassword) {
    res.status(503).json({
      error: 'Credenciais MegamBD não configuradas no servidor.',
      code: 'MEGAMBD_UNCONFIGURED',
    });
    return;
  }

  const hostCheck = validateMegambdUrl(cfg.megambdServerUrl);
  if (!hostCheck.valid || !hostCheck.normalized) {
    res.status(403).json({ error: 'Servidor não autorizado.' });
    return;
  }

  const status = await getMegambdStatus();
  if (!status.authValid) {
    res.status(403).json({
      error: status.message || `Conta MegamBD indisponível (${status.accountStatus}).`,
      code: 'MEGAMBD_ACCOUNT_INACTIVE',
      accountStatus: status.accountStatus,
    });
    return;
  }

  const origin = new URL(hostCheck.normalized).origin;
  const upstreamUrl = `${origin}/${kind}/${encodeURIComponent(cfg.megambdUsername)}/${encodeURIComponent(
    cfg.megambdPassword
  )}/${rawId}.${ext}`;

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (req.headers.range) {
    upstreamHeaders.Range = req.headers.range;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok && upstream.status !== 206) {
      recordApiError('Stream', `/${kind}/${rawId}.${ext}`, upstream.status, `Upstream HTTP ${upstream.status}`);
      res.status(upstream.status).json({
        error: `O servidor mgeb.space devolveu HTTP ${upstream.status} para este stream.`,
        code: 'STREAM_UPSTREAM_ERROR',
      });
      return;
    }

    res.status(upstream.status);
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forwardHeaders) {
      const val = upstream.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    if (!upstream.headers.get('content-type')) {
      res.setHeader('content-type', ext === 'm3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp4');
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream);
    nodeStream.on('error', () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    req.on('close', () => {
      nodeStream.destroy();
    });
    nodeStream.pipe(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha na transmissão do stream.';
    recordApiError('Stream', `/${kind}/${rawId}.${ext}`, 502, msg);
    if (!res.headersSent) {
      res.status(502).json({ error: msg, code: 'STREAM_PROXY_ERROR' });
    }
  }
}
