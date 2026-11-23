import { getServerConfig, isAllowedMegambdHost, validateMegambdUrl } from './config.ts';
import { getCached, recordApiError, setCached } from './store.ts';

export interface MegambdCategory {
  category_id: string;
  category_name: string;
  parent_id?: number;
}

export interface MegambdVodStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  rating: string;
  added: string;
  category_id: string;
  container_extension: string;
  tmdb_id?: string | number;
}

export interface MegambdSeriesItem {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  rating: string;
  category_id: string;
  tmdb_id?: string | number;
}

export interface MegambdStatusReport {
  configured: boolean;
  serverHost: string;
  authValid: boolean;
  accountStatus: string;
  message: string;
  expDate: string | null;
  activeConnections: string | null;
  maxConnections: string | null;
  serverProtocol: string | null;
  lastChecked: string;
}

export interface EmbedMirror {
  label: string;
  url: string;
}

interface RawAuthResponse {
  user_info?: {
    username?: string;
    auth?: number | string;
    status?: string;
    exp_date?: string | null;
    is_trial?: string;
    active_cons?: string;
    created_at?: string;
    max_connections?: string;
    allowed_output_formats?: string[];
    message?: string;
  };
  server_info?: {
    url?: string;
    port?: string;
    https_port?: string;
    server_protocol?: string;
    timezone?: string;
  };
}

function sanitizeSafePlaybackUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (!isAllowedMegambdHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildMegaEmbedMirrors(opts: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
}): EmbedMirror[] {
  if (!Number.isInteger(opts.tmdbId) || opts.tmdbId <= 0) {
    return [];
  }

  const cfg = getServerConfig();
  const primaryOrigin = sanitizeSafePlaybackUrl(cfg.megambdEmbedUrl)
    ? new URL(cfg.megambdEmbedUrl).origin
    : 'https://megaembed.com';

  const season =
    opts.mediaType === 'tv' && Number.isInteger(opts.season) && (opts.season as number) >= 0 && (opts.season as number) <= 200
      ? (opts.season as number)
      : 1;
  const episode =
    opts.mediaType === 'tv' && Number.isInteger(opts.episode) && (opts.episode as number) >= 1 && (opts.episode as number) <= 2000
      ? (opts.episode as number)
      : 1;

  const buildForOrigin = (origin: string) =>
    opts.mediaType === 'movie'
      ? `${origin}/embed/movie?tmdb=${opts.tmdbId}`
      : `${origin}/embed/tv?tmdb=${opts.tmdbId}&season=${season}&episode=${episode}`;

  const mirrors: EmbedMirror[] = [
    { label: 'MegaEmbed HD', url: buildForOrigin(primaryOrigin) },
  ];

  if (primaryOrigin !== 'https://mgeb.space') {
    mirrors.push({ label: 'Servidor MGEB', url: buildForOrigin('https://mgeb.space') });
  } else {
    mirrors.push({ label: 'MegaEmbed HD', url: buildForOrigin('https://megaembed.com') });
  }

  return mirrors;
}

async function callMegambdApi<T>(action?: string, extraParams: Record<string, string> = {}): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}> {
  const cfg = getServerConfig();
  if (!cfg.megambdUsername || !cfg.megambdPassword) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'Credenciais Xtream MegamBD não configuradas no servidor.',
    };
  }

  const hostCheck = validateMegambdUrl(cfg.megambdServerUrl);
  if (!hostCheck.valid || !hostCheck.normalized) {
    return {
      ok: false,
      status: 403,
      data: null,
      error: hostCheck.error || 'Servidor MegamBD não autorizado.',
    };
  }

  const url = new URL(hostCheck.normalized);
  url.searchParams.set('username', cfg.megambdUsername);
  url.searchParams.set('password', cfg.megambdPassword);
  if (action) {
    url.searchParams.set('action', action);
  }
  for (const [k, v] of Object.entries(extraParams)) {
    if (v) url.searchParams.set(k, v);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });

    const text = await response.text();
    let parsed: T | null = null;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      const msg = `Resposta inválida (não JSON) do servidor mgeb.space (HTTP ${response.status}).`;
      recordApiError('MegamBD', action || 'auth', response.status, msg);
      return { ok: false, status: response.status, data: null, error: msg };
    }

    if (!response.ok) {
      const authObj = parsed as unknown as RawAuthResponse;
      const errMsg = authObj?.user_info?.message || `HTTP ${response.status} em mgeb.space`;
      recordApiError('MegamBD', action || 'auth', response.status, errMsg);
      return { ok: false, status: response.status, data: parsed, error: errMsg };
    }

    return { ok: true, status: response.status, data: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro de conexão com mgeb.space';
    recordApiError('MegamBD', action || 'auth', 503, msg);
    return { ok: false, status: 503, data: null, error: msg };
  }
}

async function resolveWithMegambdApiKey(opts: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
}): Promise<{ streamUrl?: string | null; embedUrl?: string | null } | null> {
  const cfg = getServerConfig();
  if (!cfg.megambdApiKey || !Number.isInteger(opts.tmdbId) || opts.tmdbId <= 0) {
    return null;
  }

  // Avoid repeatedly hitting Cloudflare-challenged endpoints on server-side
  const challengeLock = getCached<boolean>('megambd:apikey:cf-challenged');
  if (challengeLock) {
    return null;
  }

  const season = opts.season ?? 1;
  const episode = opts.episode ?? 1;
  const cacheKey = `megambd:apikey:resolve:${opts.mediaType}:${opts.tmdbId}:${season}:${episode}`;
  const cached = getCached<{ streamUrl?: string | null; embedUrl?: string | null }>(cacheKey);
  if (cached) {
    return cached;
  }

  const endpointPath =
    opts.mediaType === 'movie'
      ? `/v1/movie/${opts.tmdbId}`
      : `/v1/tv/${opts.tmdbId}/${season}/${episode}`;

  try {
    const res = await fetch(`https://api.mgeb.space${endpointPath}`, {
      headers: {
        Authorization: `Bearer ${cfg.megambdApiKey}`,
        'X-API-Key': cfg.megambdApiKey,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 403 && res.headers.get('cf-mitigated') === 'challenge') {
      setCached('megambd:apikey:cf-challenged', true, 10 * 60 * 1000);
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return null;
    }

    const streamUrl = sanitizeSafePlaybackUrl(body.streamUrl ?? body.stream_url ?? body.hls ?? body.mp4);
    const embedUrl = sanitizeSafePlaybackUrl(body.embedUrl ?? body.embed_url ?? body.player ?? body.url);

    if (streamUrl || embedUrl) {
      const resolved = { streamUrl, embedUrl };
      setCached(cacheKey, resolved, 5 * 60 * 1000);
      return resolved;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getMegambdStatus(forceRefresh = false): Promise<MegambdStatusReport> {
  const cfg = getServerConfig();
  const host = new URL(cfg.megambdServerUrl).hostname;

  if (!cfg.megambdUsername || !cfg.megambdPassword) {
    if (cfg.megambdApiKey) {
      return {
        configured: true,
        serverHost: new URL(cfg.megambdEmbedUrl).hostname,
        authValid: true,
        accountStatus: 'API Key Ativa',
        message: 'API Key MegamBD configurada para reprodução automática via TMDB e player embed.',
        expDate: null,
        activeConnections: null,
        maxConnections: null,
        serverProtocol: 'https',
        lastChecked: new Date().toISOString(),
      };
    }

    return {
      configured: true,
      serverHost: new URL(cfg.megambdEmbedUrl).hostname,
      authValid: true,
      accountStatus: 'Embed Ativo',
      message:
        'Reprodução MegamBD/MegaEmbed pronta via TMDB. Adicione MEGAMBD_API_KEY nas variáveis de ambiente para vincular a sua chave.',
      expDate: null,
      activeConnections: null,
      maxConnections: null,
      serverProtocol: 'https',
      lastChecked: new Date().toISOString(),
    };
  }

  const cacheKey = `megambd:status:${cfg.megambdUsername}`;
  if (!forceRefresh) {
    const cached = getCached<MegambdStatusReport>(cacheKey);
    if (cached) return cached;
  }

  const res = await callMegambdApi<RawAuthResponse>();
  const ui = res.data?.user_info;
  const si = res.data?.server_info;

  const authNum = Number(ui?.auth ?? 0);
  const authValid = res.ok && authNum === 1 && ui?.status === 'Active';

  let message = ui?.message || res.error || '';
  if (!message) {
    if (authValid) {
      message = 'Conta MegamBD autenticada e ativa em mgeb.space.';
    } else if (ui?.status) {
      message = `Conta MegamBD devolveu auth=${authNum} e estado "${ui.status}" em mgeb.space.`;
    } else {
      message = 'Não foi possível validar a conta MegamBD.';
    }
  }

  if (!authValid && ui) {
    recordApiError('MegamBD', 'player_api.php (auth)', res.status, message);
  }

  const report: MegambdStatusReport = {
    configured: true,
    serverHost: si?.url || host,
    authValid,
    accountStatus: ui?.status || (res.ok ? 'Desconhecido' : `Erro HTTP ${res.status}`),
    message,
    expDate: ui?.exp_date ? new Date(Number(ui.exp_date) * 1000).toISOString() : null,
    activeConnections: ui?.active_cons ?? null,
    maxConnections: ui?.max_connections ?? null,
    serverProtocol: si?.server_protocol ?? null,
    lastChecked: new Date().toISOString(),
  };

  // Cache for 60 seconds to respect mgeb.space rate-limit / security lockouts
  setCached(cacheKey, report, 60 * 1000);
  return report;
}

function isAdultLabel(name: string | undefined): boolean {
  if (!name) return false;
  return /(\+18|18\+|adult|adulto|xxx|porn|erotic|erotico|hot\s*movies|sexo)/i.test(name);
}

export async function getMegambdCategories(includeAdult = false) {
  const cfg = getServerConfig();
  if (!cfg.megambdUsername || !cfg.megambdPassword) {
    const status = await getMegambdStatus();
    return {
      available: false,
      status,
      vodCategories: [] as MegambdCategory[],
      seriesCategories: [] as MegambdCategory[],
    };
  }

  const status = await getMegambdStatus();
  if (!status.authValid) {
    return {
      available: false,
      status,
      vodCategories: [] as MegambdCategory[],
      seriesCategories: [] as MegambdCategory[],
    };
  }

  const cacheKey = 'megambd:categories';
  let cached = getCached<{ vodCategories: MegambdCategory[]; seriesCategories: MegambdCategory[] }>(cacheKey);
  if (!cached) {
    const [vodRes, serRes] = await Promise.all([
      callMegambdApi<MegambdCategory[]>('get_vod_categories'),
      callMegambdApi<MegambdCategory[]>('get_series_categories'),
    ]);

    cached = {
      vodCategories: Array.isArray(vodRes.data) ? vodRes.data : [],
      seriesCategories: Array.isArray(serRes.data) ? serRes.data : [],
    };
    setCached(cacheKey, cached, 10 * 60 * 1000);
  }

  return {
    available: true,
    status,
    vodCategories: includeAdult
      ? cached.vodCategories
      : cached.vodCategories.filter((c) => !isAdultLabel(c.category_name)),
    seriesCategories: includeAdult
      ? cached.seriesCategories
      : cached.seriesCategories.filter((c) => !isAdultLabel(c.category_name)),
  };
}

export async function getMegambdVodStreams(opts: {
  categoryId?: string;
  search?: string;
  page?: number;
  limit?: number;
  includeAdult?: boolean;
}) {
  const cfg = getServerConfig();
  const status = await getMegambdStatus();
  if (!cfg.megambdUsername || !cfg.megambdPassword || !status.authValid) {
    return {
      available: false,
      status,
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [] as MegambdVodStream[],
    };
  }

  const cacheKey = `megambd:vod:${opts.categoryId || 'all'}`;
  let all = getCached<MegambdVodStream[]>(cacheKey);
  if (!all) {
    const res = await callMegambdApi<MegambdVodStream[]>(
      'get_vod_streams',
      opts.categoryId ? { category_id: opts.categoryId } : {}
    );
    all = Array.isArray(res.data) ? res.data : [];
    setCached(cacheKey, all, 10 * 60 * 1000);
  }

  let filtered = opts.includeAdult ? all : all.filter((item) => !isAdultLabel(item.name));
  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter((item) => item.name?.toLowerCase().includes(q));
  }

  const limit = Math.max(1, Math.min(60, opts.limit || 24));
  const totalResults = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / limit));
  const page = Math.max(1, Math.min(totalPages, opts.page || 1));
  const start = (page - 1) * limit;

  return {
    available: true,
    status,
    page,
    totalPages,
    totalResults,
    results: filtered.slice(start, start + limit),
  };
}

export async function getMegambdVodInfo(vodId: string) {
  const cfg = getServerConfig();
  const status = await getMegambdStatus();
  if (!cfg.megambdUsername || !cfg.megambdPassword || !status.authValid) {
    return { available: false, status, info: null };
  }

  const cacheKey = `megambd:vod_info:${vodId}`;
  const cached = getCached<Record<string, unknown>>(cacheKey);
  if (cached) {
    return { available: true, status, info: cached };
  }

  const res = await callMegambdApi<Record<string, unknown>>('get_vod_info', { vod_id: vodId });
  if (!res.ok || !res.data) {
    return { available: false, status, info: null, error: res.error };
  }

  setCached(cacheKey, res.data, 10 * 60 * 1000);
  return { available: true, status, info: res.data };
}

export async function getMegambdSeriesList(opts: { categoryId?: string; search?: string; page?: number; limit?: number }) {
  const cfg = getServerConfig();
  const status = await getMegambdStatus();
  if (!cfg.megambdUsername || !cfg.megambdPassword || !status.authValid) {
    return {
      available: false,
      status,
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [] as MegambdSeriesItem[],
    };
  }

  const cacheKey = `megambd:series:${opts.categoryId || 'all'}`;
  let all = getCached<MegambdSeriesItem[]>(cacheKey);
  if (!all) {
    const res = await callMegambdApi<MegambdSeriesItem[]>(
      'get_series',
      opts.categoryId ? { category_id: opts.categoryId } : {}
    );
    all = Array.isArray(res.data) ? res.data : [];
    setCached(cacheKey, all, 10 * 60 * 1000);
  }

  let filtered = all;
  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = all.filter((item) => item.name?.toLowerCase().includes(q));
  }

  const limit = Math.max(1, Math.min(60, opts.limit || 24));
  const totalResults = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / limit));
  const page = Math.max(1, Math.min(totalPages, opts.page || 1));
  const start = (page - 1) * limit;

  return {
    available: true,
    status,
    page,
    totalPages,
    totalResults,
    results: filtered.slice(start, start + limit),
  };
}

export async function getMegambdSeriesInfo(seriesId: string) {
  const cfg = getServerConfig();
  const status = await getMegambdStatus();
  if (!cfg.megambdUsername || !cfg.megambdPassword || !status.authValid) {
    return { available: false, status, info: null };
  }

  const cacheKey = `megambd:series_info:${seriesId}`;
  const cached = getCached<Record<string, unknown>>(cacheKey);
  if (cached) {
    return { available: true, status, info: cached };
  }

  const res = await callMegambdApi<Record<string, unknown>>('get_series_info', { series_id: seriesId });
  if (!res.ok || !res.data) {
    return { available: false, status, info: null, error: res.error };
  }

  setCached(cacheKey, res.data, 10 * 60 * 1000);
  return { available: true, status, info: res.data };
}

function normalizeTitleForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function matchMegambdContent(opts: {
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
}) {
  const cfg = getServerConfig();
  const hasXtream = Boolean(cfg.megambdUsername && cfg.megambdPassword);

  // 1. Try Xtream VOD / Series match first when username/password are configured and active
  if (hasXtream) {
    const status = await getMegambdStatus();
    if (status.authValid) {
      const targets = [opts.title, opts.originalTitle].filter(Boolean).map((t) => normalizeTitleForMatch(t!));

      if (opts.mediaType === 'movie') {
        const vodList = await getMegambdVodStreams({ limit: 5000, page: 1 });
        const allVod = getCached<MegambdVodStream[]>('megambd:vod:all') || vodList.results;
        const found = allVod.find((item) => {
          if (opts.tmdbId && item.tmdb_id && Number(item.tmdb_id) === opts.tmdbId) return true;
          const norm = normalizeTitleForMatch(item.name || '');
          return targets.some((t) => norm === t || (t.length > 4 && norm.includes(t)));
        });

        if (found) {
          const ext = (found.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
          return {
            matched: true,
            megambdActive: true,
            playbackMode: 'stream' as const,
            streamId: found.stream_id,
            title: found.name,
            extension: ext,
            streamUrl: `/api/stream/vod/${found.stream_id}?ext=${encodeURIComponent(ext)}`,
          };
        }
      } else {
        const serList = await getMegambdSeriesList({ limit: 5000, page: 1 });
        const allSer = getCached<MegambdSeriesItem[]>('megambd:series:all') || serList.results;
        const foundSer = allSer.find((item) => {
          if (opts.tmdbId && item.tmdb_id && Number(item.tmdb_id) === opts.tmdbId) return true;
          const norm = normalizeTitleForMatch(item.name || '');
          return targets.some((t) => norm === t || (t.length > 4 && norm.includes(t)));
        });

        if (foundSer) {
          const infoRes = await getMegambdSeriesInfo(String(foundSer.series_id));
          return {
            matched: true,
            megambdActive: true,
            playbackMode: 'stream' as const,
            seriesId: foundSer.series_id,
            title: foundSer.name,
            seriesInfo: infoRes.info,
          };
        }
      }
    }
  }

  // 2. Resolve via MegamBD API Key / TMDB MegaEmbed Player
  if (opts.tmdbId && Number.isInteger(opts.tmdbId) && opts.tmdbId > 0) {
    const apiResolved = await resolveWithMegambdApiKey({
      mediaType: opts.mediaType,
      tmdbId: opts.tmdbId,
      season: opts.season,
      episode: opts.episode,
    });

    const embedMirrors = buildMegaEmbedMirrors({
      mediaType: opts.mediaType,
      tmdbId: opts.tmdbId,
      season: opts.season,
      episode: opts.episode,
    });

    if (apiResolved?.embedUrl && !embedMirrors.some((m) => m.url === apiResolved.embedUrl)) {
      embedMirrors.unshift({ label: 'MegamBD API', url: apiResolved.embedUrl });
    }

    return {
      matched: true,
      megambdActive: true,
      playbackMode: apiResolved?.streamUrl ? ('stream' as const) : ('embed' as const),
      streamUrl: apiResolved?.streamUrl || undefined,
      embedUrl: embedMirrors[0]?.url || undefined,
      embedMirrors,
      apiKeyConfigured: Boolean(cfg.megambdApiKey),
      title: opts.title,
      message: 'Reprodução disponível via Player MegamBD.',
    };
  }

  return {
    matched: false,
    megambdActive: false,
    accountStatus: 'Indisponível',
    message: 'Identificador TMDB indisponível para reprodução no MegamBD.',
  };
}
