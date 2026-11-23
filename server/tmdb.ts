import { AsyncLocalStorage } from 'node:async_hooks';
import { getServerConfig } from './config.ts';
import { getCached, recordApiError, setCached } from './store.ts';

const ALLOWED_TMDB_LANGS = new Set([
  'pt-BR',
  'pt-PT',
  'en-US',
  'es-MX',
  'es-ES',
  'fr-FR',
  'it-IT',
]);

const tmdbLangStorage = new AsyncLocalStorage<string>();

export function sanitizeTmdbLanguage(raw: string | undefined | null): string {
  if (!raw) return 'pt-BR';
  const cleaned = raw.trim();
  if (ALLOWED_TMDB_LANGS.has(cleaned)) return cleaned;
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('en')) return 'en-US';
  if (lower === 'pt-pt') return 'pt-PT';
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower === 'es-es') return 'es-ES';
  if (lower.startsWith('es')) return 'es-MX';
  if (lower.startsWith('fr')) return 'fr-FR';
  if (lower.startsWith('it')) return 'it-IT';
  return 'pt-BR';
}

export function runWithTmdbLanguage<T>(lang: string | undefined | null, fn: () => T): T {
  return tmdbLangStorage.run(sanitizeTmdbLanguage(lang), fn);
}

const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';

export interface TmdbMediaSummary {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: string;
  releaseDate: string;
  rating: number;
  voteCount: number;
  genreIds: number[];
  popularity: number;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

interface RawTmdbItem {
  id: number;
  adult?: boolean;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  genres?: TmdbGenre[];
  popularity?: number;
}

export function tmdbImg(filePath: string | null | undefined, size = 'w500'): string | null {
  if (!filePath) return null;
  return `${TMDB_IMG_BASE}/${size}${filePath}`;
}

function normalizeItem(raw: RawTmdbItem, forcedType?: 'movie' | 'tv'): TmdbMediaSummary {
  const mediaType: 'movie' | 'tv' =
    forcedType || (raw.media_type === 'tv' || (!raw.title && Boolean(raw.name)) ? 'tv' : 'movie');
  const releaseDate = raw.release_date || raw.first_air_date || '';
  return {
    id: raw.id,
    mediaType,
    title: raw.title || raw.name || 'Sem título',
    originalTitle: raw.original_title || raw.original_name || raw.title || raw.name || '',
    overview: raw.overview || '',
    posterUrl: tmdbImg(raw.poster_path, 'w500'),
    backdropUrl: tmdbImg(raw.backdrop_path, 'w1280'),
    year: releaseDate ? releaseDate.slice(0, 4) : '',
    releaseDate,
    rating: Number((raw.vote_average ?? 0).toFixed(1)),
    voteCount: raw.vote_count ?? 0,
    genreIds: raw.genre_ids || (raw.genres ? raw.genres.map((g) => g.id) : []),
    popularity: raw.popularity ?? 0,
  };
}

const failedBearerTokens = new Set<string>();

export async function tmdbFetch<T>(
  endpoint: string,
  params: Record<string, string | number | boolean> = {},
  ttlMs = 5 * 60 * 1000
): Promise<T> {
  const cfg = getServerConfig();
  if (!cfg.tmdbApiKey && !cfg.tmdbReadToken) {
    throw new Error('TMDB_NOT_CONFIGURED');
  }

  const searchParams = new URLSearchParams();
  if (!params.language) {
    searchParams.set('language', tmdbLangStorage.getStore() || 'pt-BR');
  }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      searchParams.set(k, String(v));
    }
  }

  const cacheKey = `tmdb:${endpoint}?${searchParams.toString()}`;
  const cached = getCached<T>(cacheKey);
  if (cached) {
    return cached;
  }

  const buildUrl = (includeApiKey: boolean) => {
    const qp = new URLSearchParams(searchParams);
    if (includeApiKey && cfg.tmdbApiKey) {
      qp.set('api_key', cfg.tmdbApiKey);
    }
    return `${cfg.tmdbBaseUrl}${endpoint}?${qp.toString()}`;
  };

  let response: Response | null = null;

  // Prefer Bearer token first unless previously rejected with 401 (when api_key fallback exists)
  const canTryBearer =
    Boolean(cfg.tmdbReadToken) && !(failedBearerTokens.has(cfg.tmdbReadToken) && cfg.tmdbApiKey);

  if (canTryBearer) {
    response = await fetch(buildUrl(false), {
      headers: {
        Authorization: `Bearer ${cfg.tmdbReadToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 401 && cfg.tmdbApiKey) {
      failedBearerTokens.add(cfg.tmdbReadToken);
      response = await fetch(buildUrl(true), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
    }
  } else {
    response = await fetch(buildUrl(true), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const msg = `TMDB HTTP ${response.status}: ${errText.slice(0, 200)}`;
    recordApiError('TMDB', endpoint, response.status, msg);
    throw new Error(msg);
  }

  const data = (await response.json()) as T;
  setCached(cacheKey, data, ttlMs);
  return data;
}

export async function testTmdbAuth() {
  const cfg = getServerConfig();
  if (!cfg.tmdbApiKey && !cfg.tmdbReadToken) {
    return {
      configured: false,
      connected: false,
      authMethod: 'none',
      message: 'Credenciais TMDB não configuradas nas variáveis de ambiente.',
    };
  }

  let bearerOk = false;
  let apiKeyOk = false;
  let lastError = '';

  if (cfg.tmdbReadToken) {
    try {
      const r = await fetch(`${cfg.tmdbBaseUrl}/authentication`, {
        headers: { Authorization: `Bearer ${cfg.tmdbReadToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        bearerOk = true;
      } else {
        lastError = `Bearer Token retornou HTTP ${r.status}`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Erro de rede no Bearer Token';
    }
  }

  if (cfg.tmdbApiKey) {
    try {
      const r = await fetch(`${cfg.tmdbBaseUrl}/configuration?api_key=${encodeURIComponent(cfg.tmdbApiKey)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        apiKeyOk = true;
      } else {
        lastError = `API Key retornou HTTP ${r.status}`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Erro de rede na API Key';
    }
  }

  return {
    configured: true,
    connected: bearerOk || apiKeyOk,
    bearerOk,
    apiKeyOk,
    authMethod: bearerOk ? 'Bearer Token' : apiKeyOk ? 'API Key (v3)' : 'Falha',
    message:
      bearerOk || apiKeyOk
        ? `Conexão TMDB ativa via ${bearerOk && apiKeyOk ? 'Bearer Token + API Key' : bearerOk ? 'Bearer Token' : 'API Key'}.`
        : lastError || 'Falha na autenticação TMDB.',
  };
}

interface TmdbListResponse {
  page: number;
  total_pages: number;
  total_results: number;
  results: RawTmdbItem[];
}

function cleanList(items: RawTmdbItem[], forcedType?: 'movie' | 'tv'): TmdbMediaSummary[] {
  return items
    .filter((item) => !item.adult && Boolean(item.poster_path))
    .map((item) => normalizeItem(item, forcedType));
}

export type ThematicSection = 'novelas' | 'doramas' | 'dramas' | 'animes' | 'infantil' | 'documentarios';

function getSectionQuery(
  section: ThematicSection,
  page: number,
  year?: string,
  sortBy?: string
): { endpoint: string; forcedType: 'movie' | 'tv'; params: Record<string, string | number | boolean> } {
  const movieSort = sortBy || 'popularity.desc';
  const tvSort = movieSort === 'primary_release_date.desc' ? 'first_air_date.desc' : movieSort;
  switch (section) {
    case 'novelas':
      return {
        endpoint: '/discover/tv',
        forcedType: 'tv',
        params: {
          page,
          with_genres: '10766',
          first_air_date_year: year || '',
          sort_by: tvSort,
          include_adult: false,
        },
      };
    case 'doramas':
      return {
        endpoint: '/discover/tv',
        forcedType: 'tv',
        params: {
          page,
          with_original_language: 'ko',
          with_genres: '18',
          first_air_date_year: year || '',
          sort_by: tvSort,
          include_adult: false,
        },
      };
    case 'dramas':
      return {
        endpoint: '/discover/movie',
        forcedType: 'movie',
        params: {
          page,
          with_genres: '18',
          primary_release_year: year || '',
          sort_by: movieSort,
          include_adult: false,
        },
      };
    case 'animes':
      return {
        endpoint: '/discover/tv',
        forcedType: 'tv',
        params: {
          page,
          with_genres: '16',
          with_original_language: 'ja',
          first_air_date_year: year || '',
          sort_by: tvSort,
          include_adult: false,
        },
      };
    case 'infantil':
      return {
        endpoint: '/discover/movie',
        forcedType: 'movie',
        params: {
          page,
          with_genres: '10751,16',
          certification_country: 'US',
          'certification.lte': 'PG',
          primary_release_year: year || '',
          sort_by: movieSort,
          include_adult: false,
        },
      };
    case 'documentarios':
      return {
        endpoint: '/discover/movie',
        forcedType: 'movie',
        params: {
          page,
          with_genres: '99',
          primary_release_year: year || '',
          sort_by: movieSort,
          include_adult: false,
        },
      };
  }
}

export async function getHomeCatalog() {
  const [
    popularMovies,
    nowPlaying,
    popularTv,
    novelas,
    doramas,
    dramas,
    animes,
    infantil,
    documentarios,
    movieGenres,
    tvGenres,
  ] = await Promise.all([
    tmdbFetch<TmdbListResponse>('/movie/popular', { page: 1, include_adult: false }),
    tmdbFetch<TmdbListResponse>('/movie/now_playing', { page: 1, include_adult: false }),
    tmdbFetch<TmdbListResponse>('/tv/popular', { page: 1, include_adult: false }),
    tmdbFetch<TmdbListResponse>('/discover/tv', {
      page: 1,
      with_genres: '10766',
      sort_by: 'popularity.desc',
      include_adult: false,
    }),
    tmdbFetch<TmdbListResponse>('/discover/tv', {
      page: 1,
      with_original_language: 'ko',
      with_genres: '18',
      sort_by: 'popularity.desc',
      include_adult: false,
    }),
    tmdbFetch<TmdbListResponse>('/discover/movie', {
      page: 1,
      with_genres: '18',
      sort_by: 'popularity.desc',
      include_adult: false,
    }),
    tmdbFetch<TmdbListResponse>('/discover/tv', {
      page: 1,
      with_genres: '16',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      include_adult: false,
    }),
    tmdbFetch<TmdbListResponse>('/discover/movie', {
      page: 1,
      with_genres: '10751,16',
      certification_country: 'US',
      'certification.lte': 'PG',
      sort_by: 'popularity.desc',
      include_adult: false,
    }),
    tmdbFetch<TmdbListResponse>('/discover/movie', {
      page: 1,
      with_genres: '99',
      sort_by: 'popularity.desc',
      include_adult: false,
    }),
    tmdbFetch<{ genres: TmdbGenre[] }>('/genre/movie/list', {}, 60 * 60 * 1000),
    tmdbFetch<{ genres: TmdbGenre[] }>('/genre/tv/list', {}, 60 * 60 * 1000),
  ]);

  return {
    popularMovies: cleanList(popularMovies.results, 'movie'),
    nowPlayingMovies: cleanList(nowPlaying.results, 'movie'),
    popularSeries: cleanList(popularTv.results, 'tv'),
    novelas: cleanList(novelas.results, 'tv'),
    doramas: cleanList(doramas.results, 'tv'),
    dramas: cleanList(dramas.results, 'movie'),
    animes: cleanList(animes.results, 'tv'),
    infantil: cleanList(infantil.results, 'movie'),
    documentarios: cleanList(documentarios.results, 'movie'),
    movieGenres: movieGenres.genres,
    tvGenres: tvGenres.genres,
  };
}

export async function getSectionCatalog(
  section: ThematicSection,
  opts: { page?: number; year?: string; sortBy?: string }
) {
  const page = Math.max(1, Math.min(500, opts.page || 1));
  const q = getSectionQuery(section, page, opts.year, opts.sortBy);
  const data = await tmdbFetch<TmdbListResponse>(q.endpoint, q.params);
  return {
    page: data.page,
    totalPages: Math.min(data.total_pages, 500),
    totalResults: data.total_results,
    results: cleanList(data.results, q.forcedType),
  };
}

export async function getStreamingProviderCatalog(
  providerId: number,
  mediaType: 'all' | 'movie' | 'tv' = 'all',
  pageInput = 1
) {
  const page = Math.max(1, Math.min(500, pageInput || 1));
  const baseParams = {
    page,
    with_watch_providers: String(providerId),
    watch_region: 'BR',
    sort_by: 'popularity.desc',
    include_adult: false,
  };

  if (mediaType === 'movie') {
    const data = await tmdbFetch<TmdbListResponse>('/discover/movie', baseParams);
    return {
      page: data.page,
      totalPages: Math.min(data.total_pages, 500),
      totalResults: data.total_results,
      results: cleanList(data.results, 'movie'),
    };
  }

  if (mediaType === 'tv') {
    const data = await tmdbFetch<TmdbListResponse>('/discover/tv', baseParams);
    return {
      page: data.page,
      totalPages: Math.min(data.total_pages, 500),
      totalResults: data.total_results,
      results: cleanList(data.results, 'tv'),
    };
  }

  const [movies, tv] = await Promise.all([
    tmdbFetch<TmdbListResponse>('/discover/movie', baseParams),
    tmdbFetch<TmdbListResponse>('/discover/tv', baseParams),
  ]);

  const combined = [...cleanList(movies.results, 'movie'), ...cleanList(tv.results, 'tv')].sort(
    (a, b) => b.popularity - a.popularity
  );

  return {
    page,
    totalPages: Math.min(Math.max(movies.total_pages, tv.total_pages), 500),
    totalResults: movies.total_results + tv.total_results,
    results: combined,
  };
}

export async function getAdultCatalog(pageInput = 1) {
  const page = Math.max(1, Math.min(500, pageInput || 1));
  const data = await tmdbFetch<TmdbListResponse>('/discover/movie', {
    page,
    include_adult: true,
    certification_country: 'US',
    'certification.gte': 'NC-17',
    sort_by: 'popularity.desc',
  });
  return {
    page: data.page,
    totalPages: Math.min(data.total_pages, 500),
    totalResults: data.total_results,
    results: data.results.filter((i) => Boolean(i.poster_path)).map((i) => normalizeItem(i, 'movie')),
  };
}

export async function getMoviesCatalog(opts: {
  category?: string;
  genre?: string;
  year?: string;
  sortBy?: string;
  page?: number;
}) {
  const page = Math.max(1, Math.min(500, opts.page || 1));
  const hasFilters = Boolean(opts.genre || opts.year || opts.sortBy);

  let data: TmdbListResponse;
  if (hasFilters || opts.category === 'discover') {
    data = await tmdbFetch<TmdbListResponse>('/discover/movie', {
      page,
      with_genres: opts.genre || '',
      primary_release_year: opts.year || '',
      sort_by: opts.sortBy || 'popularity.desc',
      include_adult: false,
    });
  } else {
    const validCat = ['popular', 'now_playing', 'top_rated', 'upcoming'].includes(opts.category || '')
      ? opts.category
      : 'popular';
    data = await tmdbFetch<TmdbListResponse>(`/movie/${validCat}`, { page, include_adult: false });
  }

  return {
    page: data.page,
    totalPages: Math.min(data.total_pages, 500),
    totalResults: data.total_results,
    results: cleanList(data.results, 'movie'),
  };
}

export async function getSeriesCatalog(opts: {
  category?: string;
  genre?: string;
  year?: string;
  sortBy?: string;
  page?: number;
}) {
  const page = Math.max(1, Math.min(500, opts.page || 1));
  const hasFilters = Boolean(opts.genre || opts.year || opts.sortBy);

  let data: TmdbListResponse;
  if (hasFilters || opts.category === 'discover') {
    data = await tmdbFetch<TmdbListResponse>('/discover/tv', {
      page,
      with_genres: opts.genre || '',
      first_air_date_year: opts.year || '',
      sort_by: opts.sortBy || 'popularity.desc',
      include_adult: false,
    });
  } else {
    const validCat = ['popular', 'top_rated', 'on_the_air', 'airing_today'].includes(opts.category || '')
      ? opts.category
      : 'popular';
    data = await tmdbFetch<TmdbListResponse>(`/tv/${validCat}`, { page, include_adult: false });
  }

  return {
    page: data.page,
    totalPages: Math.min(data.total_pages, 500),
    totalResults: data.total_results,
    results: cleanList(data.results, 'tv'),
  };
}

interface RawCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

interface RawVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export async function getMovieDetails(id: number) {
  const raw = await tmdbFetch<{
    id: number;
    title: string;
    original_title: string;
    tagline?: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date: string;
    runtime: number | null;
    vote_average: number;
    vote_count: number;
    genres: TmdbGenre[];
    status: string;
    credits?: { cast: RawCastMember[] };
    videos?: { results: RawVideo[] };
    recommendations?: { results: RawTmdbItem[] };
    similar?: { results: RawTmdbItem[] };
    release_dates?: {
      results: Array<{
        iso_3166_1: string;
        release_dates: Array<{ certification: string }>;
      }>;
    };
  }>(
    `/movie/${id}`,
    {
      append_to_response: 'credits,videos,recommendations,similar,release_dates',
      include_video_language: 'pt,pt-PT,pt-BR,en,null',
    },
    10 * 60 * 1000
  );

  // If Portuguese overview is empty, try pt-BR or en-US fallback
  let overview = raw.overview;
  if (!overview) {
    try {
      const br = await tmdbFetch<{ overview?: string }>(`/movie/${id}`, { language: 'pt-BR' }, 10 * 60 * 1000);
      overview = br.overview || '';
    } catch {
      // ignore fallback errors
    }
  }

  const certEntry =
    raw.release_dates?.results?.find((r) => r.iso_3166_1 === 'PT') ||
    raw.release_dates?.results?.find((r) => r.iso_3166_1 === 'BR') ||
    raw.release_dates?.results?.find((r) => r.iso_3166_1 === 'US');
  const certification = certEntry?.release_dates?.find((d) => d.certification)?.certification || '';

  const relatedRaw =
    raw.recommendations?.results && raw.recommendations.results.length > 0
      ? raw.recommendations.results
      : raw.similar?.results || [];

  const trailers = (raw.videos?.results || [])
    .filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
    .map((v) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      type: v.type,
      official: v.official,
    }));

  return {
    id: raw.id,
    mediaType: 'movie' as const,
    title: raw.title,
    originalTitle: raw.original_title,
    tagline: raw.tagline || '',
    overview,
    posterUrl: tmdbImg(raw.poster_path, 'w342'),
    backdropUrl: tmdbImg(raw.backdrop_path, 'w1280'),
    releaseDate: raw.release_date || '',
    year: raw.release_date ? raw.release_date.slice(0, 4) : '',
    runtime: raw.runtime || 0,
    rating: Number((raw.vote_average ?? 0).toFixed(1)),
    voteCount: raw.vote_count ?? 0,
    certification,
    genres: raw.genres || [],
    cast: (raw.credits?.cast || []).slice(0, 14).map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profileUrl: tmdbImg(c.profile_path, 'w185'),
    })),
    trailers,
    related: relatedRaw.slice(0, 12).map((r) => normalizeItem(r, 'movie')),
  };
}

export async function getSeriesDetails(id: number) {
  const raw = await tmdbFetch<{
    id: number;
    name: string;
    original_name: string;
    tagline?: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    first_air_date: string;
    episode_run_time?: number[];
    number_of_seasons: number;
    number_of_episodes: number;
    vote_average: number;
    vote_count: number;
    genres: TmdbGenre[];
    seasons: Array<{
      id: number;
      season_number: number;
      name: string;
      overview: string;
      poster_path: string | null;
      episode_count: number;
      air_date: string | null;
    }>;
    credits?: { cast: RawCastMember[] };
    videos?: { results: RawVideo[] };
    recommendations?: { results: RawTmdbItem[] };
    similar?: { results: RawTmdbItem[] };
    content_ratings?: { results: Array<{ iso_3166_1: string; rating: string }> };
  }>(
    `/tv/${id}`,
    {
      append_to_response: 'credits,videos,recommendations,similar,content_ratings',
      include_video_language: 'pt,pt-PT,pt-BR,en,null',
    },
    10 * 60 * 1000
  );

  let overview = raw.overview;
  if (!overview) {
    try {
      const br = await tmdbFetch<{ overview?: string }>(`/tv/${id}`, { language: 'pt-BR' }, 10 * 60 * 1000);
      overview = br.overview || '';
    } catch {
      // ignore fallback errors
    }
  }

  const certEntry =
    raw.content_ratings?.results?.find((r) => r.iso_3166_1 === 'PT') ||
    raw.content_ratings?.results?.find((r) => r.iso_3166_1 === 'BR') ||
    raw.content_ratings?.results?.find((r) => r.iso_3166_1 === 'US');

  const relatedRaw =
    raw.recommendations?.results && raw.recommendations.results.length > 0
      ? raw.recommendations.results
      : raw.similar?.results || [];

  const trailers = (raw.videos?.results || [])
    .filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
    .map((v) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      type: v.type,
      official: v.official,
    }));

  return {
    id: raw.id,
    mediaType: 'tv' as const,
    title: raw.name,
    originalTitle: raw.original_name,
    tagline: raw.tagline || '',
    overview,
    posterUrl: tmdbImg(raw.poster_path, 'w342'),
    backdropUrl: tmdbImg(raw.backdrop_path, 'w1280'),
    releaseDate: raw.first_air_date || '',
    year: raw.first_air_date ? raw.first_air_date.slice(0, 4) : '',
    episodeRuntime: raw.episode_run_time?.[0] || 45,
    numberOfSeasons: raw.number_of_seasons || 0,
    numberOfEpisodes: raw.number_of_episodes || 0,
    rating: Number((raw.vote_average ?? 0).toFixed(1)),
    voteCount: raw.vote_count ?? 0,
    certification: certEntry?.rating || '',
    genres: raw.genres || [],
    seasons: (raw.seasons || [])
      .filter((s) => s.season_number > 0)
      .map((s) => ({
        id: s.id,
        seasonNumber: s.season_number,
        name: s.name,
        overview: s.overview,
        posterUrl: tmdbImg(s.poster_path, 'w342'),
        episodeCount: s.episode_count,
        airDate: s.air_date || '',
      })),
    cast: (raw.credits?.cast || []).slice(0, 14).map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profileUrl: tmdbImg(c.profile_path, 'w185'),
    })),
    trailers,
    related: relatedRaw.slice(0, 12).map((r) => normalizeItem(r, 'tv')),
  };
}

export async function getSeriesSeason(tvId: number, seasonNumber: number) {
  const raw = await tmdbFetch<{
    id: number;
    name: string;
    overview: string;
    season_number: number;
    episodes: Array<{
      id: number;
      episode_number: number;
      season_number: number;
      name: string;
      overview: string;
      still_path: string | null;
      runtime: number | null;
      air_date: string | null;
      vote_average: number;
    }>;
  }>(`/tv/${tvId}/season/${seasonNumber}`, {}, 10 * 60 * 1000);

  return {
    id: raw.id,
    seasonNumber: raw.season_number,
    name: raw.name,
    overview: raw.overview,
    episodes: (raw.episodes || []).map((ep) => ({
      id: ep.id,
      episodeNumber: ep.episode_number,
      seasonNumber: ep.season_number,
      name: ep.name || `Episódio ${ep.episode_number}`,
      overview: ep.overview || 'Sinopse indisponível em português para este episódio.',
      stillUrl: tmdbImg(ep.still_path, 'w500'),
      runtime: ep.runtime || 0,
      airDate: ep.air_date || '',
      rating: Number((ep.vote_average ?? 0).toFixed(1)),
    })),
  };
}

export async function searchTmdb(query: string, type: 'multi' | 'movie' | 'tv' = 'multi', page = 1) {
  const trimmed = query.trim();
  if (!trimmed) {
    return { page: 1, totalPages: 1, totalResults: 0, results: [] };
  }

  const endpoint = type === 'movie' ? '/search/movie' : type === 'tv' ? '/search/tv' : '/search/multi';
  const data = await tmdbFetch<TmdbListResponse>(endpoint, { query: trimmed, page, include_adult: false });

  const filtered = data.results.filter((item) => {
    if (item.adult || !item.poster_path) return false;
    if (type !== 'multi') return true;
    return item.media_type === 'movie' || item.media_type === 'tv';
  });

  return {
    page: data.page,
    totalPages: Math.min(data.total_pages, 500),
    totalResults: data.total_results,
    results: filtered.map((item) => normalizeItem(item, type === 'multi' ? undefined : type)),
  };
}

export async function getAllGenres() {
  const [movies, tv] = await Promise.all([
    tmdbFetch<{ genres: TmdbGenre[] }>('/genre/movie/list', {}, 60 * 60 * 1000),
    tmdbFetch<{ genres: TmdbGenre[] }>('/genre/tv/list', {}, 60 * 60 * 1000),
  ]);
  return {
    movieGenres: movies.genres,
    tvGenres: tv.genres,
  };
}
