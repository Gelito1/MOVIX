import type {
  AdCampaign,
  AdPacingConfig,
  AdPlacement,
  AdStatsResponse,
  AdStatus,
  AdminAccountSafe,
  AdminAuditLog,
  AdminPermission,
  AdminRole,
  AdmOverviewResponse,
  BackupMeta,
  GlobalPlaybackServer,
  ManagedEpisode,
  ManagedGenre,
  ManagedMovie,
  ManagedSeason,
  ManagedSeries,
  PublicAdItem,
  RegisteredUserRecord,
  SiteIdentityConfig,
  StoredMediaFile,
} from '../types/adm';
import {
  cloudAdToPublicAdItem,
  fetchCloudMovies,
  fetchCloudPublicAds,
  fetchCloudSeries,
  fetchCloudSystemConfig,
  getCachedCloudActiveAds,
  getCachedCloudSystemConfig,
  hasCloudActiveAdsLoaded,
  isVerifiedFirebaseAdmin,
  resolveCloudMediaUrl,
  upsertCloudMediaAsset,
} from './firebase';
import { lookupKnownAdCta, normalizeAdUiLang, translateAdCtaText } from './adCtaI18n';

const clientAdTextTranslationCache = new Map<
  string,
  { title: string; description: string; ctaText: string }
>();

const SHOWCASE_PLACEMENTS = new Set<AdPlacement>([
  'home',
  'between_movies',
  'categories_page',
  'movie_detail',
  'series_detail',
  'footer',
]);

function parseAdTimestampMs(raw: string | undefined | null): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : 0;
}

function isWithinAdSchedule(startDate?: string, endDate?: string, nowMs = Date.now()): boolean {
  const rawStart = (startDate || '').trim();
  const rawEnd = (endDate || '').trim();
  if (rawStart) {
    const startMs = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? `${rawStart}T00:00:00.000Z` : rawStart);
    if (!Number.isNaN(startMs) && nowMs < startMs) return false;
  }
  if (rawEnd) {
    const endMs = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? `${rawEnd}T23:59:59.999Z` : rawEnd);
    if (!Number.isNaN(endMs) && nowMs > endMs) return false;
  }
  return true;
}

async function admFetch<T>(url: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...options, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error(data.error || `Erro HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

export function detectClientDevice(): 'desktop' | 'mobile' | 'tablet' {
  if (typeof window === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua) || window.innerWidth < 768) {
    return 'mobile';
  }
  return 'desktop';
}

export function getAdSessionId(): string {
  try {
    const existing = sessionStorage.getItem('movix_ad_sid');
    if (existing) return existing;
    const next = `sid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('movix_ad_sid', next);
    return next;
  } catch {
    return 'sid_anon';
  }
}

async function compressImageIfRequested(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || !file.type.startsWith('image/') || file.size < 180 * 1024) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1920;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const outType = file.type === 'image/png' ? 'image/png' : 'image/webp';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), outType, 0.86)
    );
    if (blob && blob.size > 0 && blob.size < file.size) {
      return blob;
    }
  } catch {
    // Fallback to original file
  }
  return file;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Falha ao ler ficheiro para cópia na nuvem.'));
    reader.readAsDataURL(blob);
  });
}

async function compressImageToCloudBudget(blob: Blob, maxDataUrlChars = 650000): Promise<{ blob: Blob; dataUrl: string } | null> {
  try {
    const directUrl = await blobToDataUrl(blob);
    if (directUrl.length <= maxDataUrlChars) {
      return { blob, dataUrl: directUrl };
    }
    if (!blob.type.startsWith('image/') || blob.type === 'image/gif') {
      return null;
    }
    const bitmap = await createImageBitmap(blob);
    const maxDims = [1400, 1080, 840, 640];
    const qualities = [0.82, 0.72, 0.62, 0.5];
    for (const maxDim of maxDims) {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const quality of qualities) {
        const outBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/webp', quality)
        );
        if (!outBlob) continue;
        const dataUrl = await blobToDataUrl(outBlob);
        if (dataUrl.length <= maxDataUrlChars) {
          bitmap.close?.();
          return { blob: outBlob, dataUrl };
        }
      }
    }
    bitmap.close?.();
  } catch {
    // ignore compression errors
  }
  return null;
}

export interface UploadResult {
  ok: boolean;
  url: string;
  filename: string;
  folder: string;
  mimeType: string;
  kind: 'image' | 'video';
  sizeBytes: number;
  cloudPersisted?: boolean;
  cloudMediaId?: string;
  cloudWarning?: string;
}

export async function uploadMediaFile(params: {
  token: string;
  file: File;
  folder: 'posters' | 'backdrops' | 'ads-images' | 'ads-videos' | 'branding' | 'notifications' | 'categories';
  kind: 'image' | 'video' | 'both';
  compressImage?: boolean;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult> {
  const payloadBlob =
    params.compressImage && params.file.type.startsWith('image/')
      ? await compressImageIfRequested(params.file)
      : params.file;

  const url = `/api/adm/upload?folder=${encodeURIComponent(params.folder)}&kind=${encodeURIComponent(params.kind)}`;

  const serverResult = await new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${params.token}`);
    xhr.setRequestHeader('Content-Type', payloadBlob.type || 'application/octet-stream');

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && params.onProgress) {
        const pct = Math.min(92, Math.round((ev.loaded / ev.total) * 92));
        params.onProgress(pct);
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}') as UploadResult & { error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && parsed.ok) {
          resolve(parsed);
        } else {
          reject(new Error(parsed.error || `Falha no envio (${xhr.status})`));
        }
      } catch {
        reject(new Error(`Resposta inválida do servidor (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Erro de rede ao enviar o ficheiro.'));
    xhr.send(payloadBlob);
  });

  // Persist image (or small video <= 480 KB) permanently in Cloud Firestore /publicMedia
  // so uploaded creatives survive every app update and container rebuild.
  if (serverResult.kind === 'video' && payloadBlob.size > 480 * 1024) {
    params.onProgress?.(100);
    return {
      ...serverResult,
      cloudPersisted: false,
      cloudWarning:
        'Vídeo grande guardado no servidor atual. Para permanecer para sempre após atualizações do app, recomendamos usar um link HTTPS externo permanente do vídeo.',
    };
  }

  if (!isVerifiedFirebaseAdmin()) {
    params.onProgress?.(100);
    return {
      ...serverResult,
      cloudPersisted: false,
      cloudWarning:
        'Sessão Google da nuvem não ligada. Clique em "Ativar Backup Permanente" no topo para garantir que a imagem permaneça após atualizações.',
    };
  }

  try {
    const cloudPrepared = await compressImageToCloudBudget(payloadBlob, 650000);
    if (cloudPrepared) {
      const mimeType = cloudPrepared.blob.type || serverResult.mimeType || 'image/webp';
      const mediaId = await upsertCloudMediaAsset({
        folder: serverResult.folder,
        filename: serverResult.filename,
        mimeType,
        dataUrl: cloudPrepared.dataUrl,
        sizeBytes: cloudPrepared.blob.size,
      });
      if (mediaId) {
        params.onProgress?.(100);
        const sep = serverResult.url.includes('?') ? '&' : '?';
        return {
          ...serverResult,
          url: `${serverResult.url}${sep}cm=${encodeURIComponent(mediaId)}`,
          cloudPersisted: true,
          cloudMediaId: mediaId,
        };
      }
    }
  } catch {
    // Non-blocking fallback to server URL
  }

  params.onProgress?.(100);
  return {
    ...serverResult,
    cloudPersisted: false,
    cloudWarning:
      'Ficheiro enviado localmente, mas excedeu o limite da cópia na nuvem. Use uma imagem mais leve ou um URL HTTPS.',
  };
}

export const admApi = {
  // Auth
  getAuthStatus: (token?: string | null) =>
    admFetch<{
      authenticated: boolean;
      requiresSetup: boolean;
      envPasscodeConfigured: boolean;
      hasMultiAdminAccounts?: boolean;
      admin?: AdminAccountSafe | null;
    }>('/api/admin/auth/status', token || null),

  setupPrincipalAdmin: (payload: { name: string; email: string; password: string }) =>
    admFetch<{ ok: boolean; token: string; admin: AdminAccountSafe }>('/api/admin/auth/setup', null, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email?: string; password: string }) =>
    admFetch<{ ok: boolean; token: string; admin: AdminAccountSafe }>('/api/admin/auth/login', null, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  loginWithFirebase: (idToken: string) =>
    admFetch<{ ok: boolean; token: string; admin: AdminAccountSafe }>('/api/admin/auth/firebase-login', null, {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),

  changeMyPassword: (token: string, payload: { password: string; email?: string }) =>
    admFetch<{ ok: boolean; admin: AdminAccountSafe }>('/api/admin/auth/change-password', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Public Sync & Telemetry
  trackView: (payload: {
    mediaType: 'movie' | 'tv';
    id: string | number;
    title: string;
    posterUrl?: string | null;
    uid?: string | null;
  }) => {
    void fetch('/api/analytics/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaType: payload.mediaType,
        id: String(payload.id),
        title: payload.title,
        posterUrl: payload.posterUrl || '',
        uid: payload.uid || undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  },

  syncPublicUser: (payload: {
    uid: string;
    displayName: string;
    email: string;
    photoURL?: string | null;
    provider?: string;
    preferredLanguage?: string;
    favoritesCount?: number;
    watchCount?: number;
  }) =>
    admFetch<{ ok: boolean; status: 'active' | 'blocked'; role: 'user' | 'vip' | 'moderator' }>(
      '/api/users/sync',
      null,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  getActiveAds: async (
    placement: AdPlacement,
    lang?: string,
    device?: 'desktop' | 'mobile' | 'tablet'
  ): Promise<{ enabled: boolean; pacing?: AdPacingConfig; ads: PublicAdItem[] }> => {
    const dev = device || detectClientDevice();
    const resolvedLang =
      lang || (typeof document !== 'undefined' && document.documentElement.lang) || 'pt-BR';

    type LocalActiveAdsResp = {
      enabled: boolean;
      pacing?: AdPacingConfig;
      ads: PublicAdItem[];
      inactiveAds?: Array<{ id: string; status: AdStatus; updatedAt: string }>;
      totalStoredAds?: number;
    };

    const localPromise = admFetch<LocalActiveAdsResp>(
      `/api/ads/active?placement=${encodeURIComponent(placement)}&device=${encodeURIComponent(
        dev
      )}&lang=${encodeURIComponent(resolvedLang)}`,
      null
    ).catch(
      (): LocalActiveAdsResp => ({
        enabled: true,
        pacing: undefined,
        ads: [],
        inactiveAds: [],
        totalStoredAds: 0,
      })
    );

    const cloudCfgPromise =
      getCachedCloudSystemConfig() !== null
        ? Promise.resolve(getCachedCloudSystemConfig())
        : fetchCloudSystemConfig().catch(() => null);

    const cloudAdsPromise =
      getCachedCloudActiveAds() !== null
        ? Promise.resolve(getCachedCloudActiveAds()!)
        : fetchCloudPublicAds(false).catch(() => null);

    const [localRes, cloudCfg, cloudActiveAds] = await Promise.all([
      localPromise,
      cloudCfgPromise,
      cloudAdsPromise,
    ]);

    const effectiveEnabled =
      cloudCfg !== null ? Boolean(cloudCfg.adsGlobalEnabled) : localRes.enabled !== false;

    const effectivePacing: AdPacingConfig | undefined = cloudCfg
      ? {
          dismissCooldownMinutes: cloudCfg.dismissCooldownMinutes,
          largeAdIntervalMinutes: cloudCfg.largeAdIntervalMinutes,
          playerAdIntervalMinutes: cloudCfg.playerAdIntervalMinutes,
          headerAdAlwaysVisible: cloudCfg.headerAdAlwaysVisible,
        }
      : localRes.pacing;

    if (!effectiveEnabled) {
      return { enabled: false, pacing: effectivePacing, ads: [] };
    }

    const localById = new Map<string, PublicAdItem>();
    for (const item of localRes.ads || []) {
      localById.set(item.id, item);
    }

    // Track every campaign explicitly paused/draft/expired/scheduled on the Express server
    // so a stale cloud copy can NEVER resurrect a paused ad!
    const localInactiveById = new Map<string, { status: AdStatus; updatedAtMs: number }>();
    for (const inactive of localRes.inactiveAds || []) {
      if (inactive && inactive.id && inactive.status !== 'active') {
        localInactiveById.set(inactive.id, {
          status: inactive.status,
          updatedAtMs: parseAdTimestampMs(inactive.updatedAt),
        });
      }
    }

    const hydrateAdsMedia = async (items: PublicAdItem[]): Promise<PublicAdItem[]> =>
      Promise.all(
        items.map(async (ad) => {
          const [resolvedImg, resolvedVid] = await Promise.all([
            ad.imageUrl && ad.imageUrl.includes('cm=')
              ? resolveCloudMediaUrl(ad.imageUrl)
              : Promise.resolve(ad.imageUrl),
            ad.videoUrl && ad.videoUrl.includes('cm=')
              ? resolveCloudMediaUrl(ad.videoUrl)
              : Promise.resolve(ad.videoUrl),
          ]);
          if (resolvedImg === ad.imageUrl && resolvedVid === ad.videoUrl) return ad;
          return {
            ...ad,
            imageUrl: resolvedImg,
            videoUrl: resolvedVid,
          };
        })
      );

    const isShowcaseSlot = SHOWCASE_PLACEMENTS.has(placement);
    const nowMs = Date.now();
    const cloudAuthoritative =
      cloudActiveAds !== null && (hasCloudActiveAdsLoaded() || cloudActiveAds.length > 0);

    if (cloudAuthoritative && (cloudCfg !== null || cloudActiveAds.length > 0)) {
      const matchingCloud = cloudActiveAds
        .filter((ad) => {
          // Strict active-only guard: paused, draft, scheduled, expired ads NEVER render
          if (ad.status !== 'active') return false;
          if (!isWithinAdSchedule(ad.startDate, ad.endDate, nowMs)) return false;
          if (ad.maxImpressions !== null && ad.maxImpressions > 0 && ad.impressions >= ad.maxImpressions) {
            return false;
          }

          // Respect any local pause/disable that is newer than (or equal to) the cloud snapshot
          const localInactive = localInactiveById.get(ad.id);
          if (localInactive) {
            const cloudTs = parseAdTimestampMs(ad.updatedAt);
            if (localInactive.updatedAtMs === 0 || localInactive.updatedAtMs + 5000 >= cloudTs) {
              return false;
            }
          }

          if (ad.devices.length > 0 && !ad.devices.includes('all') && !ad.devices.includes(dev)) {
            return false;
          }
          if (ad.placements.includes(placement)) return true;
          if (isShowcaseSlot && ad.placements.some((p) => SHOWCASE_PLACEMENTS.has(p))) {
            return true;
          }
          return false;
        })
        .sort((a, b) => {
          const aExact = a.placements.includes(placement) ? 0 : 1;
          const bExact = b.placements.includes(placement) ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          return (b.priority || 10) - (a.priority || 10);
        })
        .map((cloudAd) => {
          const base = cloudAdToPublicAdItem(cloudAd);
          const localMatch = localById.get(cloudAd.id);
          const isPortuguese = normalizeAdUiLang(resolvedLang).startsWith('pt');
          // Preserve server-translated texts when local container has a localized version of the same ad
          if (localMatch && !isPortuguese) {
            return {
              ...base,
              title: localMatch.title || base.title,
              description: localMatch.description || base.description,
              ctaText: translateAdCtaText(localMatch.ctaText || base.ctaText, resolvedLang),
            };
          }
          return {
            ...base,
            ctaText: translateAdCtaText(base.ctaText, resolvedLang),
          };
        });

      const normalizedLang = normalizeAdUiLang(resolvedLang);
      const isPt = normalizedLang.startsWith('pt');
      const needsRemoteTranslate: Array<{
        id: string;
        cacheKey: string;
        title: string;
        description: string;
        ctaText: string;
      }> = [];

      const preLocalized = matchingCloud.map((ad) => {
        const hasLocalLocalized = Boolean(localById.get(ad.id)) && !isPt;
        const knownCta = lookupKnownAdCta(ad.ctaText, normalizedLang);
        const cacheKey = `${normalizedLang}|${ad.id}|${ad.title}|${ad.description}|${ad.ctaText}`;
        const cached = clientAdTextTranslationCache.get(cacheKey);
        if (cached) {
          return {
            ...ad,
            title: cached.title || ad.title,
            description: cached.description || ad.description,
            ctaText: translateAdCtaText(cached.ctaText || ad.ctaText, normalizedLang),
          };
        }
        if (!hasLocalLocalized && (!isPt || !knownCta)) {
          const hasTranslatable = Boolean(
            (!knownCta && ad.ctaText) || (!isPt && (ad.title || ad.description))
          );
          if (hasTranslatable) {
            needsRemoteTranslate.push({
              id: ad.id,
              cacheKey,
              title: ad.title,
              description: ad.description,
              ctaText: ad.ctaText,
            });
          }
        }
        return ad;
      });

      let localizedCloud = preLocalized;
      if (needsRemoteTranslate.length > 0) {
        try {
          const translatedRes = await admFetch<{
            translations?: Record<string, { title: string; description: string; ctaText: string }>;
          }>('/api/ads/translate-texts', null, {
            method: 'POST',
            body: JSON.stringify({
              lang: normalizedLang,
              items: needsRemoteTranslate.map(({ id, title, description, ctaText }) => ({
                id,
                title,
                description,
                ctaText,
              })),
            }),
          });
          const map = translatedRes.translations || {};
          const keyById = new Map(needsRemoteTranslate.map((item) => [item.id, item.cacheKey]));
          localizedCloud = preLocalized.map((ad) => {
            const tr = map[ad.id];
            if (!tr) return ad;
            const cKey = keyById.get(ad.id);
            const resolvedCta = translateAdCtaText(tr.ctaText || ad.ctaText, normalizedLang);
            if (cKey) {
              clientAdTextTranslationCache.set(cKey, {
                title: tr.title || ad.title,
                description: tr.description || ad.description,
                ctaText: resolvedCta,
              });
            }
            return {
              ...ad,
              title: tr.title || ad.title,
              description: tr.description || ad.description,
              ctaText: resolvedCta,
            };
          });
        } catch {
          // Keep instant client-side CTA translations if network translate fails
        }
      }

      return {
        enabled: true,
        pacing: effectivePacing,
        ads: await hydrateAdsMedia(localizedCloud),
      };
    }

    const safeLocalAds = (localRes.ads || [])
      .filter((ad) => !localInactiveById.has(ad.id))
      .map((ad) => ({
        ...ad,
        ctaText: translateAdCtaText(ad.ctaText, resolvedLang),
      }));
    return {
      enabled: true,
      pacing: effectivePacing,
      ads: await hydrateAdsMedia(safeLocalAds),
    };
  },

  trackAdEvent: (
    adId: string,
    event: 'impression' | 'click' | 'video_start' | 'video_partial' | 'video_complete',
    watchSeconds = 0
  ) => {
    const device = detectClientDevice();
    const sessionId = getAdSessionId();
    void fetch(`/api/ads/${encodeURIComponent(adId)}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, device, sessionId, watchSeconds }),
      keepalive: true,
    }).catch(() => {});
  },

  getCustomMovie: async (id: string | number): Promise<{ movie: ManagedMovie }> => {
    try {
      return await admFetch<{ movie: ManagedMovie }>(
        `/api/catalog/custom/movie/${encodeURIComponent(String(id))}`,
        null
      );
    } catch (err) {
      const cloudMovies = await fetchCloudMovies(false).catch(() => []);
      const numId = Number(id);
      const found = cloudMovies.find(
        (m) => m.id === String(id) || (Number.isFinite(numId) && numId > 0 && m.tmdbId === numId)
      );
      if (found) return { movie: found };
      throw err;
    }
  },

  getCustomSeries: async (id: string | number): Promise<{ series: ManagedSeries }> => {
    try {
      return await admFetch<{ series: ManagedSeries }>(
        `/api/catalog/custom/series/${encodeURIComponent(String(id))}`,
        null
      );
    } catch (err) {
      const cloudSeries = await fetchCloudSeries(false).catch(() => []);
      const numId = Number(id);
      const found = cloudSeries.find(
        (s) => s.id === String(id) || (Number.isFinite(numId) && numId > 0 && s.tmdbId === numId)
      );
      if (found) return { series: found };
      throw err;
    }
  },

  rehydrateCloud: (
    token: string,
    payload: {
      siteConfig?: Partial<SiteIdentityConfig>;
      ads?: AdCampaign[];
      movies?: ManagedMovie[];
      series?: ManagedSeries[];
      genres?: ManagedGenre[];
      servers?: GlobalPlaybackServer[];
      banners?: unknown[];
      highlights?: unknown[];
      categories?: unknown[];
      mediaAssets?: Array<{ folder: string; filename: string; dataUrl: string }>;
    }
  ) =>
    admFetch<{ ok: boolean; changed?: boolean; restoredCounts: Record<string, number | boolean> }>(
      '/api/adm/rehydrate-cloud',
      token,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Dashboard Overview
  getOverview: (token: string, range: '1d' | '7d' | '30d' | '90d' | 'custom', from?: string, to?: string) => {
    const qp = new URLSearchParams({ range });
    if (range === 'custom' && from) qp.set('from', from);
    if (range === 'custom' && to) qp.set('to', to);
    return admFetch<AdmOverviewResponse>(`/api/adm/overview?${qp.toString()}`, token);
  },

  // Movies
  listMovies: (token: string) => admFetch<{ movies: ManagedMovie[] }>('/api/adm/movies', token),
  importMovieFromTmdb: (token: string, tmdbId: number) =>
    admFetch<{ movie: ManagedMovie; alreadyExists?: boolean }>('/api/adm/movies/import-tmdb', token, {
      method: 'POST',
      body: JSON.stringify({ tmdbId }),
    }),
  createMovie: (token: string, movie: Partial<ManagedMovie>) =>
    admFetch<{ movie: ManagedMovie }>('/api/adm/movies', token, {
      method: 'POST',
      body: JSON.stringify(movie),
    }),
  updateMovie: (token: string, id: string, patch: Partial<ManagedMovie>) =>
    admFetch<{ movie: ManagedMovie }>(`/api/adm/movies/${encodeURIComponent(id)}`, token, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteMovie: (token: string, id: string) =>
    admFetch<{ ok: boolean }>(`/api/adm/movies/${encodeURIComponent(id)}`, token, { method: 'DELETE' }),

  // Series / Seasons / Episodes
  listSeries: (token: string) => admFetch<{ series: ManagedSeries[] }>('/api/adm/series', token),
  importSeriesFromTmdb: (token: string, tmdbId: number) =>
    admFetch<{ series: ManagedSeries; alreadyExists?: boolean }>('/api/adm/series/import-tmdb', token, {
      method: 'POST',
      body: JSON.stringify({ tmdbId }),
    }),
  createSeries: (token: string, payload: Partial<ManagedSeries>) =>
    admFetch<{ series: ManagedSeries }>('/api/adm/series', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSeries: (token: string, id: string, patch: Partial<ManagedSeries>) =>
    admFetch<{ series: ManagedSeries }>(`/api/adm/series/${encodeURIComponent(id)}`, token, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteSeries: (token: string, id: string) =>
    admFetch<{ ok: boolean }>(`/api/adm/series/${encodeURIComponent(id)}`, token, { method: 'DELETE' }),
  addSeason: (token: string, seriesId: string, payload: Partial<ManagedSeason>) =>
    admFetch<{ series: ManagedSeries; season: ManagedSeason }>(
      `/api/adm/series/${encodeURIComponent(seriesId)}/seasons`,
      token,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  updateSeason: (token: string, seriesId: string, seasonId: string, patch: Partial<ManagedSeason>) =>
    admFetch<{ series: ManagedSeries; season: ManagedSeason }>(
      `/api/adm/series/${encodeURIComponent(seriesId)}/seasons/${encodeURIComponent(seasonId)}`,
      token,
      { method: 'PUT', body: JSON.stringify(patch) }
    ),
  deleteSeason: (token: string, seriesId: string, seasonId: string) =>
    admFetch<{ series: ManagedSeries }>(
      `/api/adm/series/${encodeURIComponent(seriesId)}/seasons/${encodeURIComponent(seasonId)}`,
      token,
      { method: 'DELETE' }
    ),
  addEpisode: (token: string, seriesId: string, seasonId: string, payload: Partial<ManagedEpisode>) =>
    admFetch<{ series: ManagedSeries; episode: ManagedEpisode }>(
      `/api/adm/series/${encodeURIComponent(seriesId)}/seasons/${encodeURIComponent(seasonId)}/episodes`,
      token,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  updateEpisode: (
    token: string,
    seriesId: string,
    seasonId: string,
    epId: string,
    patch: Partial<ManagedEpisode>
  ) =>
    admFetch<{ series: ManagedSeries; episode: ManagedEpisode }>(
      `/api/adm/series/${encodeURIComponent(seriesId)}/seasons/${encodeURIComponent(seasonId)}/episodes/${encodeURIComponent(epId)}`,
      token,
      { method: 'PUT', body: JSON.stringify(patch) }
    ),
  deleteEpisode: (token: string, seriesId: string, seasonId: string, epId: string) =>
    admFetch<{ series: ManagedSeries }>(
      `/api/adm/series/${encodeURIComponent(seriesId)}/seasons/${encodeURIComponent(seasonId)}/episodes/${encodeURIComponent(epId)}`,
      token,
      { method: 'DELETE' }
    ),

  // MOVIX ADS
  getAdPacing: (token: string) =>
    admFetch<{ pacing: AdPacingConfig; adsGlobalEnabled: boolean }>('/api/adm/ads-pacing', token),
  updateAdPacing: (
    token: string,
    payload: Partial<AdPacingConfig> & { adsGlobalEnabled?: boolean }
  ) =>
    admFetch<{ ok: boolean; pacing: AdPacingConfig; adsGlobalEnabled: boolean }>(
      '/api/adm/ads-pacing',
      token,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),
  listAds: (token: string) => admFetch<{ ads: AdCampaign[] }>('/api/adm/ads', token),
  createAd: (token: string, payload: Partial<AdCampaign> & { notifyUsers?: boolean }) =>
    admFetch<{
      ad: AdCampaign;
      notification?: {
        sent: boolean;
        campaignId?: string;
        targetedCount: number;
        successCount: number;
        note?: string;
      } | null;
    }>('/api/adm/ads', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAd: (token: string, id: string, patch: Partial<AdCampaign> & { notifyUsers?: boolean }) =>
    admFetch<{
      ad: AdCampaign;
      notification?: {
        sent: boolean;
        campaignId?: string;
        targetedCount: number;
        successCount: number;
        note?: string;
      } | null;
    }>(`/api/adm/ads/${encodeURIComponent(id)}`, token, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteAd: (token: string, id: string) =>
    admFetch<{ ok: boolean }>(`/api/adm/ads/${encodeURIComponent(id)}`, token, { method: 'DELETE' }),
  getAdStats: (token: string, period: '7d' | '30d' | '90d' = '30d') =>
    admFetch<AdStatsResponse>(`/api/adm/ads/stats?period=${period}`, token),

  // Users
  listUsers: (token: string) => admFetch<{ users: RegisteredUserRecord[] }>('/api/adm/users', token),
  updateUser: (
    token: string,
    uid: string,
    patch: { status?: 'active' | 'blocked'; role?: 'user' | 'vip' | 'moderator'; displayName?: string }
  ) =>
    admFetch<{ user: RegisteredUserRecord }>(`/api/adm/users/${encodeURIComponent(uid)}`, token, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteUser: (token: string, uid: string) =>
    admFetch<{ ok: boolean }>(`/api/adm/users/${encodeURIComponent(uid)}`, token, { method: 'DELETE' }),

  // Genres & Servers
  listGenres: (token: string) => admFetch<{ genres: ManagedGenre[] }>('/api/adm/genres', token),
  saveGenres: (token: string, genres: ManagedGenre[]) =>
    admFetch<{ genres: ManagedGenre[] }>('/api/adm/genres', token, {
      method: 'PUT',
      body: JSON.stringify({ genres }),
    }),
  listServers: (token: string) => admFetch<{ servers: GlobalPlaybackServer[] }>('/api/adm/servers', token),
  saveServers: (token: string, servers: GlobalPlaybackServer[]) =>
    admFetch<{ servers: GlobalPlaybackServer[] }>('/api/adm/servers', token, {
      method: 'PUT',
      body: JSON.stringify({ servers }),
    }),
  testServer: (token: string, id: string) =>
    admFetch<{ server: GlobalPlaybackServer; online: boolean; statusCode: number; latencyMs: number; message: string }>(
      `/api/adm/servers/${encodeURIComponent(id)}/test`,
      token,
      { method: 'POST' }
    ),

  // Site Identity & Institutional Pages
  getSiteConfig: (token: string) => admFetch<{ siteConfig: SiteIdentityConfig }>('/api/adm/site-config', token),
  saveSiteConfig: (token: string, patch: Partial<SiteIdentityConfig> & { previousMaintenanceMode?: boolean }) =>
    admFetch<{
      siteConfig: SiteIdentityConfig;
      notification?: {
        sent: boolean;
        mode: 'maintenance_on' | 'maintenance_off';
        campaignId?: string;
        targetedCount: number;
        successCount: number;
        note?: string;
      } | null;
    }>('/api/adm/site-config', token, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  // Admins & RBAC
  listAdmins: (token: string) => admFetch<{ admins: AdminAccountSafe[] }>('/api/adm/admins', token),
  createAdmin: (
    token: string,
    payload: { name: string; email: string; password: string; role: AdminRole; permissions?: AdminPermission[] }
  ) =>
    admFetch<{ admin: AdminAccountSafe }>('/api/adm/admins', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAdmin: (
    token: string,
    id: string,
    patch: {
      name?: string;
      role?: AdminRole;
      permissions?: AdminPermission[];
      active?: boolean;
      newPassword?: string;
    }
  ) =>
    admFetch<{ admin: AdminAccountSafe }>(`/api/adm/admins/${encodeURIComponent(id)}`, token, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteAdmin: (token: string, id: string) =>
    admFetch<{ ok: boolean }>(`/api/adm/admins/${encodeURIComponent(id)}`, token, { method: 'DELETE' }),
  revokeAllSessions: (token: string) =>
    admFetch<{ ok: boolean }>('/api/adm/sessions/revoke-all', token, { method: 'POST' }),

  // Logs, Media & Backups
  listLogs: (token: string) => admFetch<{ logs: AdminAuditLog[] }>('/api/adm/logs', token),
  listMedia: (token: string) => admFetch<{ files: StoredMediaFile[]; totalBytes: number }>('/api/adm/media', token),
  deleteMedia: (token: string, folder: string, filename: string) =>
    admFetch<{ ok: boolean }>(
      `/api/adm/media/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      token,
      { method: 'DELETE' }
    ),
  cleanupMedia: (token: string) =>
    admFetch<{ ok: boolean; removedCount: number; freedBytes: number }>('/api/adm/media/cleanup', token, {
      method: 'POST',
    }),
  listBackups: (token: string) => admFetch<{ backups: BackupMeta[] }>('/api/adm/backups', token),
  createBackup: (token: string, note: string) =>
    admFetch<{ backup: BackupMeta; backups: BackupMeta[] }>('/api/adm/backups/create', token, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  restoreBackup: (token: string, id: string) =>
    admFetch<{ ok: boolean }>(`/api/adm/backups/${encodeURIComponent(id)}/restore`, token, { method: 'POST' }),
  downloadBackup: async (token: string, id: string, filename: string) => {
    const res = await fetch(`/api/adm/backups/${encodeURIComponent(id)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Falha ao baixar backup.');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  },
};
