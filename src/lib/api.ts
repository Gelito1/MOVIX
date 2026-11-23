import type {
  ApiErrorLog,
  AppRoute,
  BannerItem,
  EmbedMirror,
  GenreItem,
  HighlightItem,
  ManagedCategory,
  MediaSummary,
  MegambdStatusReport,
  MovieDetails,
  PushCampaignRecord,
  PushCategory,
  PushOverviewResponse,
  SeasonDetails,
  SeriesDetails,
  ThematicSection,
} from '../types/movix';
import type {
  GlobalPlaybackServer,
  ManagedGenre,
  PublicManagedMovieSummary,
  PublicManagedSeriesSummary,
  SiteIdentityConfig,
} from '../types/adm';
import type { SupportedLanguage } from './firebase';
import { getTmdbLanguageCode } from './i18n';
import { readCachedMetadata } from './offlineCache';
import { getOnboardingState } from './onboarding';
import { getStreamingPlatformBySlug, STREAMING_PLATFORMS } from './providers';

const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: unknown;
  expiresAt: number;
  seeded?: boolean;
}

const clientCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();
let backgroundPrefetchStarted = false;
let activeTmdbLang: string = getTmdbLanguageCode(getOnboardingState().preferredLanguage);

function withLangParam(url: string): string {
  if (!url.startsWith('/api/tmdb/')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}lang=${encodeURIComponent(activeTmdbLang)}`;
}

function getClientCached<T>(key: string): T | null {
  const entry = clientCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    clientCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setClientCached(key: string, data: unknown, ttlMs = CLIENT_CACHE_TTL_MS, seeded = false) {
  if (seeded) {
    const existing = clientCache.get(key);
    if (existing && !existing.seeded && Date.now() <= existing.expiresAt) {
      return;
    }
  }
  clientCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    seeded,
  });
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const finalUrl = withLangParam(url);
  const headers = new Headers(options.headers || {});
  if (url.startsWith('/api/tmdb/')) {
    headers.set('X-Movix-Lang', activeTmdbLang);
  }
  const res = await fetch(finalUrl, { ...options, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    const err = new Error(data.error || `Erro HTTP ${res.status}`) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

async function cachedGet<T>(url: string, options: RequestInit = {}, ttlMs = CLIENT_CACHE_TTL_MS): Promise<T> {
  const cacheUrl = withLangParam(url);
  const fresh = getClientCached<T>(cacheUrl);
  if (fresh && !(clientCache.get(cacheUrl)?.seeded)) {
    return fresh;
  }

  // If offline, read immediately from the Service Worker Cache API
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const offlineData =
      (await readCachedMetadata<T>(cacheUrl)) || (await readCachedMetadata<T>(url));
    if (offlineData) {
      setClientCached(cacheUrl, offlineData, ttlMs, false);
      return offlineData;
    }
  }

  const existingPromise = inFlightRequests.get(cacheUrl);
  if (existingPromise) {
    return existingPromise as Promise<T>;
  }

  const promise = requestJson<T>(url, options)
    .then((data) => {
      setClientCached(cacheUrl, data, ttlMs, false);
      return data;
    })
    .catch(async (err) => {
      const offlineData =
        (await readCachedMetadata<T>(cacheUrl)) || (await readCachedMetadata<T>(url));
      if (offlineData) {
        setClientCached(cacheUrl, offlineData, ttlMs, false);
        return offlineData;
      }
      throw err;
    })
    .finally(() => {
      inFlightRequests.delete(cacheUrl);
    });

  inFlightRequests.set(cacheUrl, promise);
  return promise;
}

function moviesUrl(params: { category?: string; genre?: string; year?: string; sortBy?: string; page?: number }) {
  const qp = new URLSearchParams();
  if (params.category) qp.set('category', params.category);
  if (params.genre) qp.set('genre', params.genre);
  if (params.year) qp.set('year', params.year);
  if (params.sortBy) qp.set('sortBy', params.sortBy);
  if (params.page) qp.set('page', String(params.page));
  return `/api/tmdb/movies?${qp.toString()}`;
}

function seriesUrl(params: { category?: string; genre?: string; year?: string; sortBy?: string; page?: number }) {
  const qp = new URLSearchParams();
  if (params.category) qp.set('category', params.category);
  if (params.genre) qp.set('genre', params.genre);
  if (params.year) qp.set('year', params.year);
  if (params.sortBy) qp.set('sortBy', params.sortBy);
  if (params.page) qp.set('page', String(params.page));
  return `/api/tmdb/series?${qp.toString()}`;
}

function sectionUrl(section: ThematicSection, params: { page?: number; year?: string; sortBy?: string } = {}) {
  const qp = new URLSearchParams();
  if (params.page) qp.set('page', String(params.page));
  if (params.year) qp.set('year', params.year);
  if (params.sortBy) qp.set('sortBy', params.sortBy);
  return `/api/tmdb/section/${section}?${qp.toString()}`;
}

function providerUrl(providerId: number, params: { mediaType?: 'all' | 'movie' | 'tv'; page?: number } = {}) {
  const qp = new URLSearchParams();
  if (params.mediaType) qp.set('mediaType', params.mediaType);
  if (params.page) qp.set('page', String(params.page));
  return `/api/tmdb/provider/${providerId}?${qp.toString()}`;
}

function seedFromHomeCatalog(home: HomeCatalogResponse) {
  const wrapPage1 = (results: MediaSummary[]): PaginatedCatalogResponse => ({
    page: 1,
    totalPages: 500,
    totalResults: results.length,
    results,
  });

  if (home.popularMovies?.length) {
    setClientCached(withLangParam(moviesUrl({ category: 'popular', page: 1 })), wrapPage1(home.popularMovies), CLIENT_CACHE_TTL_MS, true);
  }
  if (home.popularSeries?.length) {
    setClientCached(withLangParam(seriesUrl({ category: 'popular', page: 1 })), wrapPage1(home.popularSeries), CLIENT_CACHE_TTL_MS, true);
  }
  const sectionMap: Record<ThematicSection, MediaSummary[] | undefined> = {
    animes: home.animes,
    novelas: home.novelas,
    doramas: home.doramas,
    dramas: home.dramas,
    infantil: home.infantil,
    documentarios: home.documentarios,
  };
  for (const [sec, list] of Object.entries(sectionMap) as Array<[ThematicSection, MediaSummary[] | undefined]>) {
    if (list?.length) {
      setClientCached(withLangParam(sectionUrl(sec, { page: 1 })), wrapPage1(list), CLIENT_CACHE_TTL_MS, true);
    }
  }
}

export interface PublicConfigResponse {
  tmdbConfigured: boolean;
  megambdConfigured: boolean;
  banners: BannerItem[];
  highlights: HighlightItem[];
  categories: ManagedCategory[];
  siteConfig?: SiteIdentityConfig;
  adsGlobalEnabled?: boolean;
  genres?: ManagedGenre[];
  servers?: GlobalPlaybackServer[];
  managedMovies?: PublicManagedMovieSummary[];
  managedSeries?: PublicManagedSeriesSummary[];
}

export interface HomeCatalogResponse {
  popularMovies: MediaSummary[];
  nowPlayingMovies: MediaSummary[];
  popularSeries: MediaSummary[];
  novelas: MediaSummary[];
  doramas: MediaSummary[];
  dramas: MediaSummary[];
  animes: MediaSummary[];
  infantil: MediaSummary[];
  documentarios: MediaSummary[];
  movieGenres: GenreItem[];
  tvGenres: GenreItem[];
}

export interface PaginatedCatalogResponse {
  page: number;
  totalPages: number;
  totalResults: number;
  results: MediaSummary[];
}

export const movixApi = {
  setLanguage: (lang: SupportedLanguage) => {
    const next = getTmdbLanguageCode(lang);
    if (next === activeTmdbLang) return;
    activeTmdbLang = next;
    clientCache.clear();
    inFlightRequests.clear();
    backgroundPrefetchStarted = false;
  },

  getCachedPublicConfig: () => getClientCached<PublicConfigResponse>('/api/config/public'),
  getPublicConfig: () => cachedGet<PublicConfigResponse>('/api/config/public', {}, 15 * 1000),
  refreshPublicConfig: async () => {
    clientCache.delete('/api/config/public');
    const data = await requestJson<PublicConfigResponse>('/api/config/public');
    setClientCached('/api/config/public', data, 15 * 1000, false);
    return data;
  },

  getCachedHomeCatalog: () => getClientCached<HomeCatalogResponse>(withLangParam('/api/tmdb/home')),
  getHomeCatalog: async () => {
    const data = await cachedGet<HomeCatalogResponse>('/api/tmdb/home');
    seedFromHomeCatalog(data);
    return data;
  },

  getGenres: () => cachedGet<{ movieGenres: GenreItem[]; tvGenres: GenreItem[] }>('/api/tmdb/genres'),

  getCachedMovies: (params: { category?: string; genre?: string; year?: string; sortBy?: string; page?: number }) =>
    getClientCached<PaginatedCatalogResponse>(withLangParam(moviesUrl(params))),
  getMovies: (params: { category?: string; genre?: string; year?: string; sortBy?: string; page?: number }) =>
    cachedGet<PaginatedCatalogResponse>(moviesUrl(params)),

  getCachedSeries: (params: { category?: string; genre?: string; year?: string; sortBy?: string; page?: number }) =>
    getClientCached<PaginatedCatalogResponse>(withLangParam(seriesUrl(params))),
  getSeries: (params: { category?: string; genre?: string; year?: string; sortBy?: string; page?: number }) =>
    cachedGet<PaginatedCatalogResponse>(seriesUrl(params)),

  getCachedSection: (
    section: ThematicSection,
    params: { page?: number; year?: string; sortBy?: string } = {}
  ) => getClientCached<PaginatedCatalogResponse>(withLangParam(sectionUrl(section, params))),
  getSection: (
    section: ThematicSection,
    params: { page?: number; year?: string; sortBy?: string } = {}
  ) => cachedGet<PaginatedCatalogResponse>(sectionUrl(section, params)),

  getCachedStreamingProvider: (
    providerId: number,
    params: { mediaType?: 'all' | 'movie' | 'tv'; page?: number } = {}
  ) => getClientCached<PaginatedCatalogResponse>(withLangParam(providerUrl(providerId, params))),
  getStreamingProvider: (
    providerId: number,
    params: { mediaType?: 'all' | 'movie' | 'tv'; page?: number } = {}
  ) => cachedGet<PaginatedCatalogResponse>(providerUrl(providerId, params)),

  prefetchRoute: (route: AppRoute) => {
    if (route.page === 'home') {
      void movixApi.getHomeCatalog().catch(() => {});
    } else if (route.page === 'movies') {
      void movixApi.getMovies({ category: 'popular', page: 1 }).catch(() => {});
    } else if (route.page === 'series') {
      void movixApi.getSeries({ category: 'popular', page: 1 }).catch(() => {});
    } else if (route.page === 'section') {
      void movixApi.getSection(route.section, { page: 1 }).catch(() => {});
    } else if (route.page === 'provider') {
      const plat = getStreamingPlatformBySlug(route.slug);
      void movixApi.getStreamingProvider(plat.providerId, { mediaType: 'all', page: 1 }).catch(() => {});
    }
  },

  prefetchBrowseCatalogs: () => {
    if (backgroundPrefetchStarted) return;
    backgroundPrefetchStarted = true;
    const sections: ThematicSection[] = ['animes', 'novelas', 'doramas', 'dramas', 'infantil', 'documentarios'];
    void Promise.allSettled([
      movixApi.getMovies({ category: 'popular', page: 1 }),
      movixApi.getSeries({ category: 'popular', page: 1 }),
      movixApi.getAdultAuthStatus(),
      ...sections.map((s) => movixApi.getSection(s, { page: 1 })),
    ]).then(() =>
      Promise.allSettled(
        STREAMING_PLATFORMS.map((p) => movixApi.getStreamingProvider(p.providerId, { mediaType: 'all', page: 1 }))
      )
    );
  },

  getCachedAdultAuthStatus: (token?: string) =>
    getClientCached<{ unlocked: boolean; requiresSetup: boolean; envPinConfigured: boolean }>(
      `/api/adult/auth/status::${token || 'anon'}`
    ),
  getAdultAuthStatus: async (token?: string) => {
    const data = await requestJson<{ unlocked: boolean; requiresSetup: boolean; envPinConfigured: boolean }>(
      '/api/adult/auth/status',
      token ? { headers: { Authorization: `Bearer ${token}` } } : {}
    );
    setClientCached(`/api/adult/auth/status::${token || 'anon'}`, data, 60 * 1000);
    return data;
  },

  setupAdultPin: (pin: string) =>
    requestJson<{ ok: boolean; token: string }>('/api/adult/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    }),

  unlockAdult: (pin: string) =>
    requestJson<{ ok: boolean; token: string }>('/api/adult/auth/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    }),

  getCachedAdultCatalog: (token: string, page = 1) =>
    getClientCached<
      PaginatedCatalogResponse & {
        megambdAvailable: boolean;
        megambdAdultCategories: Array<{ category_id: string; category_name: string }>;
      }
    >(`/api/adult/catalog?page=${page}::${token.slice(-12)}`),

  getAdultCatalog: async (token: string, page = 1) => {
    const key = `/api/adult/catalog?page=${page}::${token.slice(-12)}`;
    const cached = getClientCached<
      PaginatedCatalogResponse & {
        megambdAvailable: boolean;
        megambdAdultCategories: Array<{ category_id: string; category_name: string }>;
      }
    >(key);
    if (cached) return cached;
    const data = await requestJson<
      PaginatedCatalogResponse & {
        megambdAvailable: boolean;
        megambdAdultCategories: Array<{ category_id: string; category_name: string }>;
      }
    >(`/api/adult/catalog?page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setClientCached(key, data);
    return data;
  },

  getMovieDetails: (id: number) => cachedGet<MovieDetails>(`/api/tmdb/movie/${id}`),
  getSeriesDetails: (id: number) => cachedGet<SeriesDetails>(`/api/tmdb/tv/${id}`),
  getSeriesSeason: (id: number, seasonNumber: number) =>
    cachedGet<SeasonDetails>(`/api/tmdb/tv/${id}/season/${seasonNumber}`),

  search: (q: string, type: 'multi' | 'movie' | 'tv' = 'multi', page = 1) => {
    const qp = new URLSearchParams({ q, type, page: String(page) });
    return cachedGet<PaginatedCatalogResponse>(`/api/tmdb/search?${qp.toString()}`, {}, 2 * 60 * 1000);
  },

  getMegambdStatus: () => requestJson<MegambdStatusReport>('/api/megambd/status'),

  getMegambdCategories: () =>
    requestJson<{
      available: boolean;
      status: MegambdStatusReport;
      vodCategories: Array<{ category_id: string; category_name: string }>;
      seriesCategories: Array<{ category_id: string; category_name: string }>;
    }>('/api/megambd/categories'),

  getMegambdVod: (params: { categoryId?: string; search?: string; page?: number; limit?: number }) => {
    const qp = new URLSearchParams();
    if (params.categoryId) qp.set('category_id', params.categoryId);
    if (params.search) qp.set('search', params.search);
    if (params.page) qp.set('page', String(params.page));
    if (params.limit) qp.set('limit', String(params.limit));
    return requestJson<{
      available: boolean;
      status: MegambdStatusReport;
      page: number;
      totalPages: number;
      totalResults: number;
      results: Array<{
        stream_id: number;
        name: string;
        stream_icon: string;
        rating: string;
        added: string;
        category_id: string;
        container_extension: string;
      }>;
    }>(`/api/megambd/vod?${qp.toString()}`);
  },

  getMegambdSeries: (params: { categoryId?: string; search?: string; page?: number; limit?: number }) => {
    const qp = new URLSearchParams();
    if (params.categoryId) qp.set('category_id', params.categoryId);
    if (params.search) qp.set('search', params.search);
    if (params.page) qp.set('page', String(params.page));
    if (params.limit) qp.set('limit', String(params.limit));
    return requestJson<{
      available: boolean;
      status: MegambdStatusReport;
      page: number;
      totalPages: number;
      totalResults: number;
      results: Array<{
        series_id: number;
        name: string;
        cover: string;
        plot: string;
        genre: string;
        releaseDate: string;
        rating: string;
        category_id: string;
      }>;
    }>(`/api/megambd/series?${qp.toString()}`);
  },

  getMegambdSeriesInfo: (seriesId: number) =>
    requestJson<{
      available: boolean;
      episodes?: Record<
        string,
        Array<{
          id: string | number;
          episode_num: number | string;
          title?: string;
          container_extension?: string;
        }>
      >;
    }>(`/api/megambd/series/${seriesId}`),

  matchMegambd: (params: {
    mediaType: 'movie' | 'tv';
    title: string;
    originalTitle?: string;
    tmdbId?: number;
    season?: number;
    episode?: number;
  }) => {
    const qp = new URLSearchParams({
      mediaType: params.mediaType,
      title: params.title,
    });
    if (params.originalTitle) qp.set('originalTitle', params.originalTitle);
    if (params.tmdbId) qp.set('tmdbId', String(params.tmdbId));
    if (params.season !== undefined) qp.set('season', String(params.season));
    if (params.episode !== undefined) qp.set('episode', String(params.episode));
    return requestJson<{
      matched: boolean;
      megambdActive: boolean;
      playbackMode?: 'stream' | 'embed';
      accountStatus?: string;
      message?: string;
      streamId?: number;
      seriesId?: number;
      streamUrl?: string;
      embedUrl?: string;
      embedMirrors?: EmbedMirror[];
      apiKeyConfigured?: boolean;
      seriesInfo?: {
        episodes?: Record<
          string,
          Array<{
            id: string | number;
            episode_num: number | string;
            title?: string;
            container_extension?: string;
          }>
        >;
      };
    }>(`/api/megambd/match?${qp.toString()}`);
  },

  // Admin APIs
  getAdminAuthStatus: (token?: string) =>
    requestJson<{ authenticated: boolean; requiresSetup: boolean; envPasscodeConfigured: boolean }>(
      '/api/admin/auth/status',
      token ? { headers: { Authorization: `Bearer ${token}` } } : {}
    ),

  setupAdminPassword: (password: string) =>
    requestJson<{ ok: boolean; token: string }>('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),

  loginAdmin: (password: string) =>
    requestJson<{ ok: boolean; token: string }>('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),

  getAdminDashboard: (token: string) =>
    requestJson<{
      configStatus: {
        tmdbConfigured: boolean;
        tmdbApiKeySet: boolean;
        tmdbApiKeyMasked: string;
        tmdbReadTokenSet: boolean;
        tmdbReadTokenMasked: string;
        tmdbBaseUrl: string;
        megambdConfigured: boolean;
        megambdServerUrl: string;
        megambdEmbedUrl: string;
        megambdApiKeySet: boolean;
        megambdApiKeyMasked: string;
        megambdUsernameSet: boolean;
        megambdUsernameMasked: string;
        megambdPasswordSet: boolean;
        adminEnvPasscodeSet: boolean;
        fcmServiceAccountSet?: boolean;
        fcmProjectId?: string;
      };
      megambdStatus: MegambdStatusReport;
      cacheStats: { activeEntries: number };
      banners: BannerItem[];
      highlights: HighlightItem[];
      categories: ManagedCategory[];
      errorLogs: ApiErrorLog[];
    }>('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  testAdminApis: (token: string) =>
    requestJson<{
      testedAt: string;
      tmdb: {
        configured: boolean;
        connected: boolean;
        bearerOk?: boolean;
        apiKeyOk?: boolean;
        authMethod: string;
        message: string;
      };
      megambd: MegambdStatusReport;
      errorLogs: ApiErrorLog[];
    }>('/api/admin/diagnostics/test-apis', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  saveAdminBanners: (token: string, banners: BannerItem[]) =>
    requestJson<{ banners: BannerItem[] }>('/api/admin/banners', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ banners }),
    }),

  saveAdminHighlights: (token: string, highlights: HighlightItem[]) =>
    requestJson<{ highlights: HighlightItem[] }>('/api/admin/highlights', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ highlights }),
    }),

  saveAdminCategories: (token: string, categories: ManagedCategory[]) =>
    requestJson<{ categories: ManagedCategory[] }>('/api/admin/categories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ categories }),
    }),

  saveAdminEnv: (
    token: string,
    payload: {
      tmdbApiKey?: string;
      tmdbReadToken?: string;
      tmdbBaseUrl?: string;
      megambdServerUrl?: string;
      megambdEmbedUrl?: string;
      megambdApiKey?: string;
      megambdUsername?: string;
      megambdPassword?: string;
      firebaseServiceAccountJson?: string;
    }
  ) =>
    requestJson<{ ok: boolean }>('/api/admin/env', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),

  clearAdminCache: (token: string) =>
    requestJson<{ ok: boolean; cleared: number }>('/api/admin/cache/clear', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  clearAdminErrors: (token: string) =>
    requestJson<{ ok: boolean }>('/api/admin/errors', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  updateAdminAdultPin: (token: string, pin: string) =>
    requestJson<{ ok: boolean }>('/api/admin/adult-pin', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pin }),
    }),

  getAdminPushOverview: (token: string) =>
    requestJson<PushOverviewResponse>('/api/admin/notifications/overview', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  sendAdminPushNotification: (
    token: string,
    payload: {
      title: string;
      body: string;
      image_url?: string;
      target_url?: string;
      category: PushCategory;
      scheduled_for?: string | null;
    }
  ) =>
    requestJson<{ ok: boolean; campaign: PushCampaignRecord; overview: PushOverviewResponse }>(
      '/api/admin/notifications/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }
    ),

  cancelScheduledPush: (token: string, id: string) =>
    requestJson<{ ok: boolean; overview: PushOverviewResponse }>(
      `/api/admin/notifications/scheduled/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    ),
};
